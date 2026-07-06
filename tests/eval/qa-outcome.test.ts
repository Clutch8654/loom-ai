/**
 * tests/eval/qa-outcome.test.ts — ground-truth outcome eval tier (P8a).
 *
 * Covers the opt-in qa-outcome tier that scores a QA report against planted
 * bugs with PER-category, PER-severity detection:
 *   - LOOM_EVAL_LLM unset      => status `skipped`, exit 0, actionable reason
 *     (MIRRORS scripts/eval/tiers/t3-judge.ts:132-146).
 *   - LOOM_EVAL_LLM set + fixed reporter stub (NO live network, NO Chromium)
 *     => per-category detectionRate / falsePositives scored against the
 *     ground-truth fixture; detectionRate >= floor and falsePositives <= max.
 *   - The OutcomeEval artifact (TOON) carries perCategory[]{category,severity,
 *     detected}.
 *
 * The reporter is ALWAYS a fixed stub (pattern mirrors t3-gating.test.ts:39-42's
 * `fixedJudge`) — there is never a live daemon drive or network call here.
 *
 * Run: bunx vitest run tests/eval/qa-outcome.test.ts
 */

import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { parseToon } from "../../lib/index.js";
import type { ToonValue } from "../../lib/index.js";
import {
  parseGroundTruth,
  runQaOutcome,
  scoreOutcome,
  type DetectedIssue,
  type QaReport,
  type QaReporter,
} from "../../scripts/eval/tiers/qa-outcome.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const GROUND_TRUTH = path.join(REPO_ROOT, "evals/fixtures/qa-ground-truth.toon");

let tmpDirs: string[] = [];
function mkTmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "loom-qa-outcome-"));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

/**
 * A reporter that always returns the SAME issues per fixture — a stand-in for
 * the LLM-backed QA drive, never a network call (mirrors fixedJudge).
 */
function fixedReporter(byFixture: Record<string, DetectedIssue[]>): QaReporter {
  return ({ fixture }): QaReport => ({
    fixture,
    issues: byFixture[fixture] ?? [],
  });
}

/** The full set of correctly-detected issues (matches every planted bug). */
const PERFECT_ISSUES: Record<string, DetectedIssue[]> = {
  "evals/fixtures/planted-bugs.html": [
    { category: "functional", severity: "critical", selector: "#submit-btn" },
    { category: "visual", severity: "major", selector: ".low-contrast" },
    { category: "overflow", severity: "minor", selector: ".overflow-box" },
  ],
  "evals/fixtures/planted-bugs-spa.html": [
    { category: "console", severity: "major", selector: "#load-error" },
    { category: "functional", severity: "major", selector: "#next-step" },
  ],
};

describe("qa-outcome gating on LOOM_EVAL_LLM (mirrors t3-judge)", () => {
  it("is skipped (exit 0, zero llmCalls) with an actionable reason when unset", async () => {
    const out = await runQaOutcome({
      env: {},
      reporter: fixedReporter(PERFECT_ISSUES),
    });
    expect(out.status).toBe("skipped");
    expect(out.exitCode).toBe(0);
    expect(out.llmCalls).toBe(0);
    expect(out.results).toHaveLength(0);
    expect(out.warnings.join(" ")).toMatch(/LOOM_EVAL_LLM/);
    // Actionable: names the flag and how to run it.
    expect(out.warnings.join(" ")).toMatch(/set it to run/i);
  });

  it("is skipped (advisory) when the flag is set but no reporter is wired", async () => {
    const out = await runQaOutcome({ env: { LOOM_EVAL_LLM: "1" } });
    expect(out.status).toBe("skipped");
    expect(out.exitCode).toBe(0);
    expect(out.llmCalls).toBe(0);
    expect(out.warnings.join(" ")).toMatch(/no QA reporter/i);
  });
});

describe("qa-outcome ground-truth fixture", () => {
  it("covers >=2 fixtures spanning functional + visual/overflow + console", () => {
    const gt = parseGroundTruth(GROUND_TRUTH);
    expect(gt.fixtures.length).toBeGreaterThanOrEqual(2);
    const categories = new Set(gt.plantedBugs.map((b) => b.category));
    expect(categories.has("functional")).toBe(true);
    expect(categories.has("visual")).toBe(true);
    expect(categories.has("overflow")).toBe(true);
    expect(categories.has("console")).toBe(true);
    // Every category has a threshold row.
    for (const cat of categories) {
      expect(gt.thresholds.some((t) => t.category === cat)).toBe(true);
    }
  });
});

describe("qa-outcome per-category / per-severity scoring", () => {
  it("scores detectionRate >= floor and falsePositives <= max per category (fixed stub)", () => {
    const gt = parseGroundTruth(GROUND_TRUTH);
    const reports = [
      fixedReporter(PERFECT_ISSUES)({
        fixture: "evals/fixtures/planted-bugs.html",
        groundTruthRef: GROUND_TRUTH,
      }),
      fixedReporter(PERFECT_ISSUES)({
        fixture: "evals/fixtures/planted-bugs-spa.html",
        groundTruthRef: GROUND_TRUTH,
      }),
    ] as QaReport[];

    const scored = scoreOutcome({
      reports,
      groundTruth: gt,
      evalId: "qa-outcome-test",
      groundTruthRef: "evals/fixtures/qa-ground-truth.toon",
    });

    // The core assertion: per-category thresholds hold.
    for (const c of scored.perCategoryScore) {
      expect(c.detectionRate).toBeGreaterThanOrEqual(c.floor);
      expect(c.falsePositives).toBeLessThanOrEqual(c.max);
      expect(c.passed).toBe(true);
    }
    expect(scored.passed).toBe(true);
    expect(scored.outcomeEval.detectionRate).toBe(1);
    expect(scored.outcomeEval.falsePositives).toBe(0);

    // The visual category (P1a css/is-visible/bounding-box READs) IS detected.
    const visualRow = scored.outcomeEval.perCategory.find(
      (r) => r.category === "visual",
    );
    expect(visualRow?.detected).toBe(true);
  });

  it("marks a missed category as not-detected and fails its threshold", () => {
    const gt = parseGroundTruth(GROUND_TRUTH);
    // Drop the overflow detection and add one bogus report (a false positive).
    const missing: Record<string, DetectedIssue[]> = {
      "evals/fixtures/planted-bugs.html": [
        { category: "functional", severity: "critical", selector: "#submit-btn" },
        { category: "visual", severity: "major", selector: ".low-contrast" },
        // overflow omitted -> not detected
        { category: "visual", severity: "minor", selector: ".ghost" }, // false positive
      ],
      "evals/fixtures/planted-bugs-spa.html": [
        { category: "console", severity: "major", selector: "#load-error" },
        { category: "functional", severity: "major", selector: "#next-step" },
      ],
    };
    const reports = gt.fixtures.map((f) =>
      fixedReporter(missing)({ fixture: f, groundTruthRef: GROUND_TRUTH }),
    );
    const scored = scoreOutcome({
      reports,
      groundTruth: gt,
      evalId: "qa-outcome-miss",
      groundTruthRef: "evals/fixtures/qa-ground-truth.toon",
    });

    const overflow = scored.perCategoryScore.find((c) => c.category === "overflow");
    expect(overflow?.detectionRate).toBe(0);
    expect(overflow?.passed).toBe(false);
    expect(scored.passed).toBe(false);
    // The overflow perCategory row reflects the miss.
    const overflowRow = scored.outcomeEval.perCategory.find(
      (r) => r.category === "overflow",
    );
    expect(overflowRow?.detected).toBe(false);
    expect(scored.outcomeEval.falsePositives).toBeGreaterThanOrEqual(1);
  });
});

describe("qa-outcome scored run emits an OutcomeEval artifact (TOON)", () => {
  it("writes perCategory[]{category,severity,detected} and passes end-to-end", async () => {
    const outDir = mkTmp();
    const out = await runQaOutcome({
      env: { LOOM_EVAL_LLM: "1" },
      reporter: fixedReporter(PERFECT_ISSUES),
      groundTruthPath: GROUND_TRUTH,
      outDir,
      evalId: "qa-outcome-artifact",
    });

    expect(out.status).toBe("passed");
    expect(out.exitCode).toBe(0);
    expect(out.llmCalls).toBe(2); // one reporter pass per fixture
    expect(out.results.length).toBeGreaterThan(0);
    expect(out.results.every((r) => r.outcome === "passed")).toBe(true);

    // The OutcomeEval TOON artifact carries the perCategory table.
    const artifact = path.join(outDir, "qa-outcome-artifact.toon");
    expect(fs.existsSync(artifact)).toBe(true);
    const parsed = parseToon(fs.readFileSync(artifact, "utf8")) as {
      [k: string]: ToonValue;
    };
    const oe = parsed.outcomeEval as { [k: string]: ToonValue };
    expect(oe.tier).toBe("qa-outcome");
    expect(oe.status).toBe("passed");
    const perCategory = oe.perCategory as ToonValue[];
    expect(Array.isArray(perCategory)).toBe(true);
    expect(perCategory.length).toBeGreaterThanOrEqual(4);
    const first = perCategory[0] as { [k: string]: ToonValue };
    expect(first).toHaveProperty("category");
    expect(first).toHaveProperty("severity");
    expect(first).toHaveProperty("detected");
  });
});
