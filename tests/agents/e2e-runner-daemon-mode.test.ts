/**
 * P4a — e2e-runner-agent daemon session mode (PLAN-browser-e2e, Phase 4a).
 *
 * INTEGRATION test for the `sessionMode: daemon` branch of `e2e-runner-agent`.
 * The agent itself is a markdown prompt; this test exercises its CONCRETE
 * daemon-mode contract (agents/e2e-runner-agent.md § Daemon Mode) end-to-end:
 *
 *   1. Preflight (daemon-preflight.schema.md): daemon-down → HARD non-zero fail
 *      (exitCode 2, DAEMON_NOT_RUNNING). Never silent-skip / queue-return-0.
 *   2. When the daemon is up, a STRUCTURED-ACTION story is driven through the
 *      P3 executor `runE2EDaemon` (scripts/e2e-daemon-runner.ts) and produces
 *      the existing e2e DeltaReport with `tier: e2e, passing: 1, failing: 0`.
 *   3. Sole-writer invariant: the report lands at the caller-supplied path
 *      (a TEMPDIR here, standing in for the canonical
 *      .plan-execution/convergence/e2e/delta-report.toon the agent owns).
 *
 * HERMETIC: no live daemon and no Chromium (mid-drive gap is skip-gated in this
 * env, per rolling-context KNOWN-RUNTIME-GAP). We DO boot P2's real fixture
 * server (tests/browser/fixture-server.ts) and inject a `DaemonExec` whose
 * READ steps fetch the fixture pages over HTTP — so `assert-text` resolves
 * against REAL fixture HTML deterministically, exercising the structured
 * grammar → DeltaReport path through the actual runner, offline.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  runE2EDaemon,
  type DaemonExec,
  type DaemonStory,
  type DeltaReport,
} from "../../scripts/e2e-daemon-runner.js";
import {
  startFixtureServer,
  type FixtureServer,
} from "../browser/fixture-server.js";
import { parseToon } from "../../lib/index.js";
import type { BrowserCommand, BrowserResult, BrowserSession } from "../../lib/types.js";

/* ── Fakes / fixtures ─────────────────────────────────────────────────────── */

/** Stub session — the fixture exec ignores it; no live CDP attachment is made. */
const FAKE_SESSION = {} as unknown as BrowserSession;

function ok(command: BrowserCommand, data: Record<string, unknown>): BrowserResult {
  return { ok: true, verb: command.verb, tier: command.tier, exitCode: 0, data, error: null };
}

/**
 * A `DaemonExec` backed by the live P2 fixture server. WRITE `navigate` moves a
 * cursor URL; READ `dom-query` fetches that URL's real HTML so `assert-text`
 * checks against genuine fixture content. No daemon, no Chromium.
 */
function makeFixtureExec(server: FixtureServer, shotDir: string): DaemonExec {
  let currentUrl = server.url;
  let shotIndex = 0;
  return {
    async execWrite(_session, command) {
      if (command.verb === "navigate") currentUrl = String(command.target);
      return ok(command, { done: true });
    },
    async execRead(_session, command) {
      switch (command.verb) {
        case "dom-query": {
          const res = await fetch(currentUrl);
          const text = await res.text();
          return ok(command, { text });
        }
        case "is-visible":
          return ok(command, { visible: true });
        case "screenshot": {
          const p = path.join(shotDir, `shot-${shotIndex++}.png`);
          fs.writeFileSync(p, "");
          return ok(command, { path: p });
        }
        default:
          return ok(command, {});
      }
    },
  };
}

/* ── Model of the agent's daemon session mode ─────────────────────────────────
 * Mirrors agents/e2e-runner-agent.md § Daemon Mode: run the daemon preflight
 * (hard non-zero fail on daemon-down), then invoke the P3 executor, then let the
 * agent own the single canonical write (here: `deltaReportPath` in a tempdir).
 * ──────────────────────────────────────────────────────────────────────────── */

type SessionMode = "headless" | "chrome-mcp" | "daemon";

interface RunnerOutcome {
  status: "success" | "failure";
  verificationExitCode: number;
  errorCode?: string;
  report?: DeltaReport;
  deltaReportPath?: string;
}

async function runE2ERunnerDaemonMode(opts: {
  sessionMode: SessionMode;
  stories: DaemonStory[];
  session: BrowserSession;
  exec: DaemonExec;
  daemonRunning: boolean;
  deltaReportPath: string;
}): Promise<RunnerOutcome> {
  // Preflight (protocols/daemon-preflight.schema.md): the ONE sanctioned
  // daemon-down behavior — fail hard, non-zero, DAEMON_NOT_RUNNING. No write.
  if (opts.sessionMode === "daemon" && !opts.daemonRunning) {
    return { status: "failure", verificationExitCode: 2, errorCode: "DAEMON_NOT_RUNNING" };
  }
  // Sole-writer: the agent supplies the canonical outPath; the P3 runner writes
  // there and returns the report. (Tests point it at a tempdir.)
  const report = await runE2EDaemon(opts.stories, opts.session, opts.exec, {
    outPath: opts.deltaReportPath,
  });
  const green = report.failing === 0;
  return {
    status: green ? "success" : "failure",
    verificationExitCode: green ? 0 : 1,
    report,
    deltaReportPath: opts.deltaReportPath,
  };
}

/* ── Suite ────────────────────────────────────────────────────────────────── */

describe("e2e-runner-agent — daemon session mode (P4a)", () => {
  let server: FixtureServer;
  let tmpDir: string;

  beforeAll(async () => {
    server = await startFixtureServer();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-e2e-runner-daemon-"));
  });

  afterAll(async () => {
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("runs a structured-action story through the daemon runner → tier:e2e, passing:1, failing:0", async () => {
    const outPath = path.join(tmpDir, "green", "delta-report.toon");
    const shotDir = path.join(tmpDir, "green-shots");
    fs.mkdirSync(shotDir, { recursive: true });

    // Structured-action grammar ONLY — no prose. Drives real fixture pages.
    const story: DaemonStory = {
      name: "Fixture home renders the hero and search reflects the query",
      criteriaRefs: ["C-E2E-01"],
      steps: [
        { action: `navigate ${server.url}/`, expected: "Fixture home loads" },
        { action: "assert-text Fixture Home", expected: "Hero heading is present" },
        { action: `navigate ${server.url}/echo?q=loom-browser`, expected: "Echo page loads" },
        { action: "assert-text You searched for: loom-browser", expected: "Query is reflected" },
        { action: "screenshot", expected: "Audit capture" },
      ],
    };

    const outcome = await runE2ERunnerDaemonMode({
      sessionMode: "daemon",
      stories: [story],
      session: FAKE_SESSION,
      exec: makeFixtureExec(server, shotDir),
      daemonRunning: true,
      deltaReportPath: outPath,
    });

    expect(outcome.status).toBe("success");
    expect(outcome.verificationExitCode).toBe(0);

    // Concrete DeltaReport assertions (not "can route").
    const report = outcome.report!;
    expect(report.tier).toBe("e2e");
    expect(report.passing).toBe(1);
    expect(report.failing).toBe(0);
    expect(report.totalCriteria).toBe(1);
    expect(report.criteria[0]).toMatchObject({ id: "C-E2E-01", passed: true });
    expect(report.screenshotPaths.length).toBe(1);

    // Sole-writer: report written to the caller-supplied path (tempdir here),
    // never to .plan-execution/. Re-parse to prove the on-disk shape.
    expect(fs.existsSync(outPath)).toBe(true);
    expect(outPath).not.toContain(".plan-execution");
    const parsed = parseToon(fs.readFileSync(outPath, "utf-8")) as Record<string, unknown>;
    expect(parsed["tier"]).toBe("e2e");
    expect(parsed["passing"]).toBe(1);
    expect(parsed["failing"]).toBe(0);
  });

  it("daemon-down preflight fails hard: exitCode 2, DAEMON_NOT_RUNNING, no report written", async () => {
    const outPath = path.join(tmpDir, "down", "delta-report.toon");
    const story: DaemonStory = {
      name: "any story",
      steps: [{ action: `navigate ${server.url}/`, expected: "loads" }],
    };

    const outcome = await runE2ERunnerDaemonMode({
      sessionMode: "daemon",
      stories: [story],
      session: FAKE_SESSION,
      exec: makeFixtureExec(server, tmpDir),
      daemonRunning: false, // preflight sees the daemon down
      deltaReportPath: outPath,
    });

    expect(outcome.status).toBe("failure");
    expect(outcome.verificationExitCode).toBe(2);
    expect(outcome.errorCode).toBe("DAEMON_NOT_RUNNING");
    expect(outcome.report).toBeUndefined();
    // Nothing was written — the forbidden queue-return-0 path must not run.
    expect(fs.existsSync(outPath)).toBe(false);
  });

  it("a red assertion produces a failing:1 report (proves real pass/fail, not blind routing)", async () => {
    const outPath = path.join(tmpDir, "red", "delta-report.toon");
    const story: DaemonStory = {
      name: "Home page shows a greeting it does not actually contain",
      criteriaRefs: ["C-E2E-02"],
      steps: [
        { action: `navigate ${server.url}/`, expected: "Fixture home loads" },
        { action: "assert-text Totally Absent Marker", expected: "This string is not on the page" },
        { action: "screenshot", expected: "should be skipped" },
      ],
    };

    const outcome = await runE2ERunnerDaemonMode({
      sessionMode: "daemon",
      stories: [story],
      session: FAKE_SESSION,
      exec: makeFixtureExec(server, tmpDir),
      daemonRunning: true,
      deltaReportPath: outPath,
    });

    expect(outcome.status).toBe("failure");
    expect(outcome.verificationExitCode).toBe(1);
    expect(outcome.report!.passing).toBe(0);
    expect(outcome.report!.failing).toBe(1);
    expect(outcome.report!.criteria[0].passed).toBe(false);
  });

  it("daemon mode has NO prose fallback: a prose action fails with STORY_PARSE_ERROR", async () => {
    const outPath = path.join(tmpDir, "prose", "delta-report.toon");
    const story: DaemonStory = {
      name: "Prose story is rejected in daemon mode",
      criteriaRefs: ["C-E2E-03"],
      steps: [
        { action: `navigate ${server.url}/`, expected: "loads" },
        { action: "scroll down and read the tagline paragraph", expected: "never — prose is not grammar" },
      ],
    };

    const outcome = await runE2ERunnerDaemonMode({
      sessionMode: "daemon",
      stories: [story],
      session: FAKE_SESSION,
      exec: makeFixtureExec(server, tmpDir),
      daemonRunning: true,
      deltaReportPath: outPath,
    });

    expect(outcome.status).toBe("failure");
    expect(outcome.report!.failing).toBe(1);
    // The failure detail carries the STORY_PARSE_ERROR provenance from the parser.
    expect(outcome.report!.criteria[0].details.toLowerCase()).toContain("parse error");
  });
});
