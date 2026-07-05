/**
 * P6 (PLAN-browser-e2e, Wave 5) — tdd-coach browser-e2e tracer-bullet RED mode.
 *
 * The tdd-coach RED step gains a browser-e2e tracer-bullet mode: when the
 * acceptance criterion is an observable browser behavior, the failing RED test
 * is P5's shell-executable daemon assertion
 * (`bun scripts/loop-browser-rung.ts …`) run BEFORE any implementation. This
 * proves BOTH halves of the contract:
 *
 *   (a) DOC ORDERING — `agents/tdd-coach.md` documents the daemon-assertion RED
 *       step (the `loop-browser-rung.ts` command) BEFORE the GREEN/impl step, so
 *       the browser tracer bullet is the failing test first in red-green-refactor
 *       order.
 *
 *   (b) GENUINELY RED — the SAME daemon assertion, run against a fixture page
 *       that LACKS the expected marker, exits NON-ZERO (RUNG4_EXIT.RED). We reuse
 *       P5's `scripts/loop-browser-rung.ts` in `--mode fetch` (hermetic — this
 *       env cannot live-drive CDP) against the real P2 fixture server, and also
 *       exercise P5's exported `runRung`/`evaluateAssertion` directly. The point:
 *       the browser assertion truly goes red when the expected element is absent,
 *       so a tdd-coach RED step built on it is a real failing test, not a stub.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  startFixtureServer,
  type FixtureServer,
} from "../browser/fixture-server.js";
import {
  runRung,
  evaluateAssertion,
  RUNG4_EXIT,
} from "../../scripts/loop-browser-rung.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const AGENT_PATH = path.join(REPO_ROOT, "agents", "tdd-coach.md");
const SCRIPT = path.join(REPO_ROOT, "scripts", "loop-browser-rung.ts");

const agentBody = readFileSync(AGENT_PATH, "utf-8");

// The marker the "fixed" page must contain; the "broken" page omits it.
const MARKER = "tracer-green";

// ---------------------------------------------------------------------------
// (a) Doc ordering: daemon-assertion RED step is documented before GREEN/impl
// ---------------------------------------------------------------------------

describe("tdd-coach.md — browser-e2e tracer-bullet RED mode is documented", () => {
  it("documents the daemon-assertion command as the RED-step browser tracer bullet", () => {
    expect(agentBody).toContain("bun scripts/loop-browser-rung.ts");
    expect(agentBody).toContain("--url");
    expect(agentBody).toContain("--expect");
    expect(agentBody).toContain("--mode daemon|fetch");
    expect(agentBody).toContain("loom-browser exec");
  });

  it("frames the browser tracer bullet as a RED step (a failing test first)", () => {
    expect(agentBody.toLowerCase()).toContain("browser-e2e tracer-bullet");
    expect(agentBody).toContain("RUNG4-RED");
  });

  it("orders the daemon-assertion RED step BEFORE the GREEN/impl step", () => {
    const redCmdIdx = agentBody.indexOf("bun scripts/loop-browser-rung.ts");
    const greenIdx = agentBody.indexOf("GREEN — Write minimal implementation");
    expect(redCmdIdx).toBeGreaterThan(-1);
    expect(greenIdx).toBeGreaterThan(-1);
    // The failing browser test (RED) must appear before the implementation step.
    expect(redCmdIdx).toBeLessThan(greenIdx);
  });

  it("documents the daemon-assertion inside the RED step, not the GREEN step", () => {
    const redHeaderIdx = agentBody.indexOf("RED — Write a failing test");
    const greenHeaderIdx = agentBody.indexOf("GREEN — Write minimal implementation");
    const redCmdIdx = agentBody.indexOf("bun scripts/loop-browser-rung.ts");
    expect(redHeaderIdx).toBeGreaterThan(-1);
    // The command is introduced between the RED header and the GREEN header.
    expect(redCmdIdx).toBeGreaterThan(redHeaderIdx);
    expect(redCmdIdx).toBeLessThan(greenHeaderIdx);
  });
});

// ---------------------------------------------------------------------------
// (b) Genuinely red: the daemon assertion exits non-zero when the marker absent
// ---------------------------------------------------------------------------

let server: FixtureServer;
/** Broken page: served content does NOT contain the expected marker. */
let redUrl: string;
/** Fixed page: served content DOES contain the expected marker. */
let greenUrl: string;

beforeAll(async () => {
  server = await startFixtureServer();
  redUrl = `${server.url}/echo?q=tracer-red`;
  greenUrl = `${server.url}/echo?q=${MARKER}`;
});

afterAll(async () => {
  await server?.stop();
});

/**
 * Run P5's rung script as a real bun subprocess. ASYNC (spawn, not spawnSync):
 * the in-process fixture server shares this worker's event loop, so a blocking
 * spawnSync would starve it and the child's fetch would hang.
 */
function runRungCli(args: string[]): Promise<{ status: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", [SCRIPT, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env },
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stderr }));
  });
}

describe("tdd-coach browser tracer bullet — the RED step genuinely goes red", () => {
  it("the shared assertion is false when the fixture lacks the expected marker", () => {
    // Direct reuse of P5's evaluator — the ONE thing the daemon assertion checks.
    expect(evaluateAssertion("You searched for: tracer-red", MARKER)).toBe(false);
    expect(evaluateAssertion(`You searched for: ${MARKER}`, MARKER)).toBe(true);
  });

  it("runRung reports pass:false (red) against a marker-less fixture page", async () => {
    const outcome = await runRung({
      url: redUrl,
      expect: MARKER,
      selector: "body",
      mode: "fetch",
      timeoutMs: 30_000,
    });
    expect(outcome.pass).toBe(false);
  });

  it("the daemon-assertion CLI exits NON-ZERO (RED) when the element is absent", async () => {
    const r = await runRungCli([
      "--mode",
      "fetch",
      "--url",
      redUrl,
      "--expect",
      MARKER,
    ]);
    // Non-zero, and specifically the RED exit code with a structured signal a
    // tdd-coach RED step (or a fixer) can parse verbatim.
    expect(r.status).toBe(RUNG4_EXIT.RED);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("RUNG4-RED");
    expect(r.stderr).toContain(`expected: ${MARKER}`);
  });

  it("the SAME command exits 0 (GREEN) once the page contains the marker", async () => {
    const r = await runRungCli([
      "--mode",
      "fetch",
      "--url",
      greenUrl,
      "--expect",
      MARKER,
    ]);
    // red → green on the identical assertion: the tracer bullet is genuine.
    expect(r.status).toBe(RUNG4_EXIT.GREEN);
  });
});
