/**
 * tests/eval/t3-gating.test.ts — Phase 20 (F-21).
 *
 * Covers the opt-in, advisory-only T3 LLM-judge tier:
 *   - LOOM_EVAL_LLM unset      => status `skipped`, exit 0, zero llmCalls.
 *   - LOOM_EVAL_LLM set + mock  => judgedScore recorded; floor comparison emits
 *     EVAL_FLOOR_REGRESSION (below floor) / EVAL_FLOOR_MISSING (no floor) as
 *     advisory WARNINGS, always exit 0.
 *   - No CI config makes T3 merge-blocking.
 *
 * The judge is ALWAYS mocked — there is never a live network call.
 *
 * Run: bunx vitest run tests/eval/t3-gating.test.ts
 */

import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { serializeToon } from "../../lib/index.js";
import type { ToonValue } from "../../lib/index.js";
import { runT3, type Judge } from "../../scripts/eval/tiers/t3-judge.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

let tmpDirs: string[] = [];
function mkTmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "loom-t3-"));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

/** A judge that always returns `score` — a stand-in, never a network call. */
function fixedJudge(score: number): Judge {
  return () => ({ score });
}

/** Write a synthetic main-branch floor artifact with a given judged score. */
function writeFloor(dir: string, runId: string, judgedScore: number): void {
  const artifact: ToonValue = {
    evalTierResult: {
      runId,
      tier: "t3",
      gitRef: "main0000",
      status: "passed",
      llmCalls: 2,
      floorRef: null,
      results: [
        { evalId: "a", outcome: "passed", score: judgedScore / 10, judgedScore },
        { evalId: "b", outcome: "passed", score: judgedScore / 10, judgedScore },
      ],
    },
  };
  fs.writeFileSync(path.join(dir, `${runId}.toon`), serializeToon(artifact));
}

describe("T3 gating on LOOM_EVAL_LLM", () => {
  it("is skipped (exit 0, zero llmCalls) when LOOM_EVAL_LLM is unset", async () => {
    const out = await runT3({ env: {}, judge: fixedJudge(9) });
    expect(out.status).toBe("skipped");
    expect(out.exitCode).toBe(0);
    expect(out.llmCalls).toBe(0);
    expect(out.results).toHaveLength(0);
    expect(out.judgedScore).toBeNull();
  });

  it("is skipped (advisory) when the flag is set but no judge is wired", async () => {
    const out = await runT3({ env: { LOOM_EVAL_LLM: "1" } });
    expect(out.status).toBe("skipped");
    expect(out.exitCode).toBe(0);
    expect(out.llmCalls).toBe(0);
    expect(out.warnings.join(" ")).toMatch(/no judge/i);
  });
});

describe("T3 judged-score floor comparison (advisory, never blocking)", () => {
  it("records a judgedScore and calls the judge once per prompt", async () => {
    const resultsDir = mkTmp();
    writeFloor(resultsDir, "2026-07-01-t3-mainflr", 5);
    const out = await runT3({
      env: { LOOM_EVAL_LLM: "1" },
      judge: fixedJudge(7),
      resultsDir,
      floorRef: "2026-07-01-t3-mainflr",
    });
    expect(out.status).toBe("passed");
    expect(out.exitCode).toBe(0);
    expect(out.llmCalls).toBeGreaterThan(0);
    expect(out.judgedScore).toBe(7);
    expect(out.floorRef).toBe("2026-07-01-t3-mainflr");
    expect(out.errorCode).toBeNull(); // 7 >= 5 floor, no regression
  });

  it("emits EVAL_FLOOR_REGRESSION (warning, exit 0) when below the main floor", async () => {
    const resultsDir = mkTmp();
    writeFloor(resultsDir, "2026-07-01-t3-mainflr", 9);
    const out = await runT3({
      env: { LOOM_EVAL_LLM: "1" },
      judge: fixedJudge(5),
      resultsDir,
      floorRef: "2026-07-01-t3-mainflr",
    });
    expect(out.status).toBe("passed");
    expect(out.exitCode).toBe(0); // NEVER merge-blocking
    expect(out.errorCode).toBe("EVAL_FLOOR_REGRESSION");
    expect(out.judgedScore).toBe(5);
    expect(out.warnings.join(" ")).toMatch(/EVAL_FLOOR_REGRESSION/);
  });

  it("emits EVAL_FLOOR_MISSING (warning, exit 0) when no floor run exists", async () => {
    const resultsDir = mkTmp(); // empty — no floor artifact
    const out = await runT3({
      env: { LOOM_EVAL_LLM: "1" },
      judge: fixedJudge(6),
      resultsDir,
    });
    expect(out.status).toBe("passed");
    expect(out.exitCode).toBe(0);
    expect(out.errorCode).toBe("EVAL_FLOOR_MISSING");
    expect(out.floorRef).toBeNull();
    expect(out.warnings.join(" ")).toMatch(/EVAL_FLOOR_MISSING/);
  });
});

describe("No CI config makes T3 merge-blocking", () => {
  const prGate = fs.readFileSync(path.join(REPO_ROOT, ".github/workflows/pr-gate.yml"), "utf8");
  const nightly = fs.readFileSync(path.join(REPO_ROOT, ".github/workflows/nightly-gate.yml"), "utf8");

  it("the PR (blocking) gate never invokes --tier t3", () => {
    expect(prGate).not.toContain("--tier t3");
  });

  it("no workflow runs the T3 judge tier at all (it is opt-in, out-of-band)", () => {
    expect(prGate).not.toContain("--tier t3");
    expect(nightly).not.toContain("--tier t3");
  });

  it("nightly runs the free hermetic tiers (eval-t1 and eval-t2)", () => {
    expect(nightly).toContain("--tier t1");
    expect(nightly).toContain("--tier t2");
  });
});
