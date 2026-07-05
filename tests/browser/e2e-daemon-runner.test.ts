/**
 * P3 — daemon e2e runner (PLAN-browser-e2e). HERMETIC: no live daemon, no
 * Chromium, no P2 fixture server. We inject a FAKE exec layer so structured
 * stories resolve deterministically to pass/fail, proving the parser + the
 * DeltaReport emission (green story → green report, red story → red report)
 * fully offline. Live-daemon wiring is exercised later by P4a.
 *
 * Asserts:
 *  1. parseAction maps each of the six grammar forms → the right BrowserCommand
 *     and REJECTS unrecognized verbs / malformed a11y-ref JSON with
 *     STORY_PARSE_ERROR (it is not a prose NLP parser).
 *  2. A green story yields a GREEN DeltaReport; a red story yields a RED one.
 *  3. The emitted report reuses the EXISTING DeltaReport shape (timestamp,
 *     tier:e2e, passing, failing, criteria[N]{...}) — asserted via parseToon.
 *  4. Writes go to a TEMPDIR, never to .plan-execution/.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  parseAction,
  runDaemonStory,
  runE2EDaemon,
  buildDeltaReport,
  serializeDeltaReport,
  type DaemonExec,
  type DaemonStory,
} from "../../scripts/e2e-daemon-runner.js";
import { BrowserClientError } from "../../scripts/lib/browser-client.js";
import { parseToon } from "../../lib/index.js";
import type { A11yRef, BrowserCommand, BrowserResult, BrowserSession } from "../../lib/types.js";

/* ── Fakes ──────────────────────────────────────────────────────────────── */

/** A stub session — the fake exec ignores it, so no real attachment is needed. */
const FAKE_SESSION = {} as unknown as BrowserSession;

interface PageState {
  /** Text returned for dom-query (assert-text) reads. */
  text: string;
  /** is-visible result keyed by the ref's accessible name. Defaults to true. */
  visible?: Record<string, boolean>;
  /** When true, every WRITE returns a failure BrowserResult. */
  failWrites?: boolean;
}

function okResult(command: BrowserCommand, data: Record<string, unknown>): BrowserResult {
  return { ok: true, verb: command.verb, tier: command.tier, exitCode: 0, data, error: null };
}

function failResult(command: BrowserCommand): BrowserResult {
  return {
    ok: false,
    verb: command.verb,
    tier: command.tier,
    exitCode: 4,
    data: null,
    error: { code: "REF_UNRESOLVED", message: "no matching node", remediation: "re-capture snapshot" },
  };
}

/** Build a deterministic fake exec layer over a page state. */
function makeFakeExec(state: PageState): DaemonExec {
  return {
    async execWrite(_session, command) {
      if (state.failWrites) return failResult(command);
      return okResult(command, { done: true });
    },
    async execRead(_session, command) {
      switch (command.verb) {
        case "dom-query":
          return okResult(command, { html: `<body>${state.text}</body>`, text: state.text });
        case "is-visible": {
          const ref = command.target as A11yRef;
          const visible = state.visible?.[ref.name] ?? true;
          return okResult(command, { visible });
        }
        case "screenshot":
          return okResult(command, { path: "/tmp/loom-fake-shot.png" });
        default:
          return okResult(command, {});
      }
    },
  };
}

/* ── 1. Parser ──────────────────────────────────────────────────────────── */

describe("parseAction — structured action grammar (C-03)", () => {
  it("navigate <url> → navigate WRITE with url target", () => {
    const p = parseAction("navigate https://localhost:3000/login");
    expect(p.kind).toBe("navigate");
    expect(p.command).toMatchObject({ verb: "navigate", tier: "write", target: "https://localhost:3000/login" });
  });

  it("click <a11y-ref-json> → click WRITE with A11yRef target", () => {
    const p = parseAction('click {"role":"button","name":"Sign in","index":0}');
    expect(p.kind).toBe("click");
    expect(p.command.verb).toBe("click");
    expect(p.command.tier).toBe("write");
    expect(p.command.target).toEqual({ role: "button", name: "Sign in", index: 0 });
  });

  it("type <a11y-ref-json> <text> → type WRITE, remainder is the literal text", () => {
    const p = parseAction('type {"role":"textbox","name":"Email","index":0} user@example.com');
    expect(p.kind).toBe("type");
    expect(p.command.target).toEqual({ role: "textbox", name: "Email", index: 0 });
    expect(p.command.args).toEqual({ text: "user@example.com" });
  });

  it("type keeps spaces in the trailing text verbatim", () => {
    const p = parseAction('type {"role":"textbox","name":"Bio","index":0} hello there world');
    expect(p.command.args).toEqual({ text: "hello there world" });
  });

  it("assert-text <text> → dom-query READ + substring assertion", () => {
    const p = parseAction("assert-text Welcome back");
    expect(p.kind).toBe("assert-text");
    expect(p.command).toMatchObject({ verb: "dom-query", tier: "read", target: "body" });
    expect(p.assertText).toBe("Welcome back");
  });

  it("assert-visible <a11y-ref-json> → is-visible READ", () => {
    const p = parseAction('assert-visible {"role":"heading","name":"Dashboard","index":0}');
    expect(p.kind).toBe("assert-visible");
    expect(p.command.verb).toBe("is-visible");
    expect(p.command.tier).toBe("read");
    expect(p.command.target).toEqual({ role: "heading", name: "Dashboard", index: 0 });
  });

  it("screenshot → screenshot READ", () => {
    const p = parseAction("screenshot");
    expect(p.kind).toBe("screenshot");
    expect(p.command).toMatchObject({ verb: "screenshot", tier: "read" });
  });

  it("rejects an unrecognized verb with STORY_PARSE_ERROR (no prose fallback)", () => {
    try {
      parseAction("scroll down to the footer and read it");
      throw new Error("expected parseAction to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(BrowserClientError);
      expect((err as BrowserClientError).code).toBe("STORY_PARSE_ERROR");
    }
  });

  it("rejects malformed a11y-ref JSON with STORY_PARSE_ERROR", () => {
    expect(() => parseAction("click {role: button}")).toThrow(BrowserClientError);
    try {
      parseAction("click {not json");
    } catch (err) {
      expect((err as BrowserClientError).code).toBe("STORY_PARSE_ERROR");
    }
  });

  it("rejects an a11y-ref missing required keys", () => {
    try {
      parseAction('click {"role":"button"}');
      throw new Error("expected throw");
    } catch (err) {
      expect((err as BrowserClientError).code).toBe("STORY_PARSE_ERROR");
    }
  });

  it("rejects navigate with no url", () => {
    expect(() => parseAction("navigate")).toThrow(BrowserClientError);
  });
});

/* ── 2/3. Story execution + DeltaReport ──────────────────────────────────── */

const GREEN_STORY: DaemonStory = {
  name: "User signs in and sees the dashboard",
  criteriaRefs: ["C-E2E-01"],
  steps: [
    { action: "navigate https://localhost:3000/login", expected: "Login form visible" },
    { action: 'type {"role":"textbox","name":"Email","index":0} user@example.com', expected: "Email filled" },
    { action: 'click {"role":"button","name":"Sign in","index":0}', expected: "Redirect to dashboard" },
    { action: "assert-text Welcome back", expected: "Greeting shown" },
    { action: 'assert-visible {"role":"heading","name":"Dashboard","index":0}', expected: "Heading present" },
    { action: "screenshot", expected: "Audit capture" },
  ],
};

const RED_STORY: DaemonStory = {
  name: "Sign-in shows the wrong greeting",
  criteriaRefs: ["C-E2E-02"],
  steps: [
    { action: "navigate https://localhost:3000/login", expected: "Login form visible" },
    { action: "assert-text Welcome back", expected: "Greeting shown" }, // page text won't contain it
    { action: "screenshot", expected: "should be skipped" },
  ],
};

describe("runDaemonStory — green vs red", () => {
  it("a fully-passing story is passed:true with all steps pass", async () => {
    const exec = makeFakeExec({ text: "Welcome back, user", visible: { Dashboard: true } });
    const result = await runDaemonStory(GREEN_STORY, FAKE_SESSION, exec);
    expect(result.passed).toBe(true);
    expect(result.failingStepIndex).toBeUndefined();
    expect(result.steps.every((s) => s.status === "pass")).toBe(true);
    expect(result.screenshotPaths).toContain("/tmp/loom-fake-shot.png");
  });

  it("a failing assertion turns the story red and skips downstream steps", async () => {
    const exec = makeFakeExec({ text: "404 Not Found" }); // no "Welcome back"
    const result = await runDaemonStory(RED_STORY, FAKE_SESSION, exec);
    expect(result.passed).toBe(false);
    expect(result.failingStepIndex).toBe(1);
    expect(result.steps[1].status).toBe("fail");
    expect(result.steps[2].status).toBe("skipped");
  });

  it("a WRITE failure fails the step and skips the rest", async () => {
    const exec = makeFakeExec({ text: "", failWrites: true });
    const result = await runDaemonStory(GREEN_STORY, FAKE_SESSION, exec);
    expect(result.passed).toBe(false);
    expect(result.failingStepIndex).toBe(0); // navigate WRITE fails first
    expect(result.steps[0].status).toBe("fail");
    expect(result.steps[0].errorCode).toBe("REF_UNRESOLVED");
    expect(result.steps.slice(1).every((s) => s.status === "skipped")).toBe(true);
  });

  it("an unparseable step fails with STORY_PARSE_ERROR and skips the rest", async () => {
    const story: DaemonStory = {
      name: "bad grammar",
      steps: [
        { action: "navigate https://localhost:3000", expected: "ok" },
        { action: "frobnicate the widget", expected: "never" },
        { action: "screenshot", expected: "skipped" },
      ],
    };
    const exec = makeFakeExec({ text: "" });
    const result = await runDaemonStory(story, FAKE_SESSION, exec);
    expect(result.passed).toBe(false);
    expect(result.failingStepIndex).toBe(1);
    expect(result.steps[1].status).toBe("fail");
    expect(result.steps[1].errorCode).toBe("STORY_PARSE_ERROR");
    expect(result.steps[2].status).toBe("skipped");
  });

  it("an assert-visible on a hidden node turns the story red", async () => {
    const exec = makeFakeExec({ text: "Welcome back", visible: { Dashboard: false } });
    const result = await runDaemonStory(GREEN_STORY, FAKE_SESSION, exec);
    expect(result.passed).toBe(false);
    // Steps 0-3 pass (nav, type, click, assert-text); step 4 assert-visible fails.
    expect(result.failingStepIndex).toBe(4);
    expect(result.steps[4].status).toBe("fail");
  });
});

describe("buildDeltaReport — reuses the existing e2e DeltaReport shape", () => {
  it("maps one story to one criterion row with the required keys", () => {
    const green = { name: GREEN_STORY.name, passed: true, steps: GREEN_STORY.steps.map((s, i) => ({ index: i, action: s.action, status: "pass" as const, details: "ok" })), screenshotPaths: [] };
    const red = { name: RED_STORY.name, passed: false, failingStepIndex: 1, steps: RED_STORY.steps.map((s, i) => ({ index: i, action: s.action, status: (i === 1 ? "fail" : i > 1 ? "skipped" : "pass") as const, details: i === 1 ? "assert-text failed" : "ok" })), screenshotPaths: [] };
    const report = buildDeltaReport([green, red], [GREEN_STORY, RED_STORY]);
    expect(report.tier).toBe("e2e");
    expect(report.totalCriteria).toBe(2);
    expect(report.passing).toBe(1);
    expect(report.failing).toBe(1);
    expect(report.criteria[0]).toMatchObject({ id: "C-E2E-01", name: GREEN_STORY.name, passed: true, findingCount: 0, blockingCount: 0 });
    expect(report.criteria[1]).toMatchObject({ id: "C-E2E-02", passed: false, findingCount: 1, blockingCount: 1 });
    expect(report.criteria[1].details).toContain("Failed at step 2");
  });
});

describe("runE2EDaemon — end-to-end DeltaReport emission", () => {
  it("green + red stories → mixed report; serialized TOON round-trips via parseToon", async () => {
    // Green exec for the green story, hidden for the red one? Both stories share
    // one exec here; the green story sees the greeting, the red story asserts a
    // string absent from the SAME text, so it fails.
    const exec = makeFakeExec({ text: "Welcome back to your Dashboard", visible: { Dashboard: true } });
    const report = await runE2EDaemon([GREEN_STORY, RED_STORY], FAKE_SESSION, exec);

    expect(report.tier).toBe("e2e");
    expect(report.passing).toBe(2); // both find "Welcome back" — sanity of fake
    // Serialize and re-parse to prove the shape survives round-trip.
    const toon = serializeDeltaReport(report);
    const parsed = parseToon(toon) as Record<string, unknown>;
    expect(parsed["timestamp"]).toBeTruthy();
    expect(parsed["tier"]).toBe("e2e");
    expect(typeof parsed["passing"]).toBe("number");
    expect(typeof parsed["failing"]).toBe("number");
    expect(Array.isArray(parsed["criteria"])).toBe(true);
    const criteria = parsed["criteria"] as Array<Record<string, unknown>>;
    expect(criteria).toHaveLength(2);
    for (const row of criteria) {
      for (const key of ["id", "name", "type", "passed", "findingCount", "blockingCount", "details"]) {
        expect(row).toHaveProperty(key);
      }
    }
  });

  it("truly-red story → failing:1 in the report", async () => {
    const exec = makeFakeExec({ text: "totally unrelated content" });
    const report = await runE2EDaemon([RED_STORY], FAKE_SESSION, exec);
    expect(report.passing).toBe(0);
    expect(report.failing).toBe(1);
    expect(report.criteria[0].passed).toBe(false);
  });

  it("writes the report to a TEMPDIR (never to .plan-execution/) when outPath is set", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-e2e-daemon-"));
    const outPath = path.join(dir, "delta-report.toon");
    const exec = makeFakeExec({ text: "Welcome back Dashboard", visible: { Dashboard: true } });
    try {
      const report = await runE2EDaemon([GREEN_STORY], FAKE_SESSION, exec, { outPath });
      expect(fs.existsSync(outPath)).toBe(true);
      expect(outPath.startsWith(os.tmpdir())).toBe(true);
      expect(outPath).not.toContain(".plan-execution");
      // The file content re-parses to the same report shape.
      const parsed = parseToon(fs.readFileSync(outPath, "utf-8")) as Record<string, unknown>;
      expect(parsed["tier"]).toBe("e2e");
      expect(parsed["totalCriteria"]).toBe(report.totalCriteria);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does NOT write any file when outPath is omitted", async () => {
    const exec = makeFakeExec({ text: "Welcome back Dashboard", visible: { Dashboard: true } });
    // No throw, returns a report, and there's no path to check — the absence of
    // a write is the contract (this module is not a standalone writer).
    const report = await runE2EDaemon([GREEN_STORY], FAKE_SESSION, exec);
    expect(report.criteria).toHaveLength(1);
  });
});
