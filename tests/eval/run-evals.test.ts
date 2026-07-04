/**
 * tests/eval/run-evals.test.ts — Phase 20 (F-20).
 *
 * Covers the free-by-default T1/T2 tiers of the eval ladder:
 *   - T1 static evals complete with `llmCalls: 0` and write a schema-conformant
 *     EvalTierResult artifact.
 *   - T2 replays committed fixtures with ZERO live LLM calls (asserted by
 *     trapping `globalThis.fetch`).
 *   - A missing T2 fixture yields EVAL_FIXTURE_MISSING and exit 1.
 *
 * Run: bunx vitest run tests/eval/run-evals.test.ts
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { parseToon } from "../../lib/index.js";
import type { ToonValue } from "../../lib/index.js";
import { main } from "../../scripts/eval/run-evals.js";
import { runT2 } from "../../scripts/eval/tiers/t2-hermetic.js";

const FIXTURES_DIR = fileURLToPath(new URL("../../evals/fixtures", import.meta.url));

let tmpDirs: string[] = [];
function mkTmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "loom-eval-"));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
  vi.restoreAllMocks();
});

/** Pull the `evalTierResult` block out of a written artifact. */
function readArtifact(file: string): { [k: string]: ToonValue } {
  const parsed = parseToon(fs.readFileSync(file, "utf8")) as { [k: string]: ToonValue };
  return parsed.evalTierResult as { [k: string]: ToonValue };
}

describe("run-evals T1 (static, free, PR-blocking)", () => {
  it("completes with llmCalls:0 and writes a schema-conformant artifact", async () => {
    const out = mkTmp();
    const code = await main(["--tier", "t1"], {
      resultsDir: out,
      date: "2026-07-04",
      shortSha: "deadbee",
      gitRef: "deadbeef00000000000000000000000000000000",
    });
    expect(code).toBe(0);

    const file = path.join(out, "2026-07-04-t1-deadbee.toon");
    expect(fs.existsSync(file)).toBe(true);
    // No stranded temp file from the atomic write.
    expect(fs.existsSync(file + ".tmp")).toBe(false);

    const etr = readArtifact(file);
    expect(etr.runId).toBe("2026-07-04-t1-deadbee");
    expect(etr.tier).toBe("t1");
    expect(etr.gitRef).toBe("deadbeef00000000000000000000000000000000");
    expect(etr.status).toBe("passed");
    expect(etr.llmCalls).toBe(0); // free-by-default invariant
    expect(Array.isArray(etr.results)).toBe(true);
    expect((etr.results as ToonValue[]).length).toBeGreaterThanOrEqual(1);
  });
});

describe("run-evals T2 (hermetic replay, free, zero live LLM)", () => {
  it("replays fixtures with zero live LLM calls — fetch is never invoked", () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("network access is forbidden in T2 (hermetic tier)");
    });
    // Trap any accidental network egress; a real call would throw here.
    vi.stubGlobal("fetch", fetchSpy);

    const out = runT2({ fixturesDir: FIXTURES_DIR });

    expect(out.status).toBe("passed");
    expect(out.llmCalls).toBe(0);
    expect(out.errorCode).toBeNull();
    expect(out.results.length).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("writes a conforming artifact with llmCalls:0 via the runner", async () => {
    const out = mkTmp();
    const code = await main(["--tier", "t2"], {
      resultsDir: out,
      fixturesDir: FIXTURES_DIR,
      date: "2026-07-04",
      shortSha: "cafef00",
      gitRef: "cafef00d00000000000000000000000000000000",
    });
    expect(code).toBe(0);
    const etr = readArtifact(path.join(out, "2026-07-04-t2-cafef00.toon"));
    expect(etr.tier).toBe("t2");
    expect(etr.status).toBe("passed");
    expect(etr.llmCalls).toBe(0);
  });

  it("a missing fixture yields EVAL_FIXTURE_MISSING and exit 1", async () => {
    const emptyFixtures = mkTmp();
    // Direct tier call: exact error code is surfaced on the TierRunOutput.
    const out = runT2({ fixturesDir: emptyFixtures });
    expect(out.status).toBe("error");
    expect(out.errorCode).toBe("EVAL_FIXTURE_MISSING");
    expect(out.exitCode).toBe(1);
    expect(out.llmCalls).toBe(0);

    // Runner call: non-zero exit + persisted `error` status.
    const resultsDir = mkTmp();
    const code = await main(["--tier", "t2"], {
      resultsDir,
      fixturesDir: emptyFixtures,
      date: "2026-07-04",
      shortSha: "0000000",
      gitRef: "0000000000000000000000000000000000000000",
    });
    expect(code).toBe(1);
    const etr = readArtifact(path.join(resultsDir, "2026-07-04-t2-0000000.toon"));
    expect(etr.status).toBe("error");
    expect(etr.llmCalls).toBe(0);
  });
});
