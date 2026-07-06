/**
 * tests/scripts/scorecard-gate.test.ts
 *
 * Behavioral tests for the M-09 acceptance gate (scripts/scorecard-gate.ts,
 * F-25 / C-09). Exercises the PURE `evaluateGate(baseline, rerun)` seam with
 * constructed fixtures — no shelling out to a live scorecard, no LLM, no disk.
 *
 * Coverage:
 *   (a) all deltas ≥ 0 AND overall > 8.3            -> pass (exit 0)
 *   (b) exactly one trailing dimension              -> below-target (exit 2),
 *                                                      names the dim + loop-back
 *   (c) overall ≤ 8.3 with all deltas ≥ 0           -> NOT pass (below-target)
 *   (d) rubricRef mismatch                          -> refused (exit 2)
 *   (+) pending placeholder scores                  -> pending (exit 2)
 *   (+) gstack score mutated                        -> refused (exit 2)
 *   (+) the committed on-disk baseline round-trips through loadBaseline
 */

import { describe, it, expect } from "vitest";
import * as path from "node:path";
import {
  evaluateGate,
  loadBaseline,
  BASELINE_REL_PATH,
  type Baseline,
  type Rerun,
  type RerunDimension,
} from "../../scripts/scorecard-gate.js";

const RUBRIC = "planning/reports/scorecard-baseline.toon";
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** The 7 pinned baseline dimensions (mirrors scorecard-baseline.toon). */
function makeBaseline(overrides: Partial<Baseline> = {}): Baseline {
  return {
    rubricRef: RUBRIC,
    gstackOverall: 8.3,
    dimensions: [
      { dimension: "prompt-assets", gstackScore: 7, verdict: "loom-leads", recorded: false },
      { dimension: "architecture", gstackScore: 8, verdict: "tie", recorded: false },
      { dimension: "docs", gstackScore: 8, verdict: "tie", recorded: false },
      { dimension: "code-quality", gstackScore: 8, verdict: "gstack-leads", recorded: true },
      { dimension: "tests", gstackScore: 9, verdict: "gstack-leads", recorded: true },
      { dimension: "extensibility", gstackScore: 8, verdict: "gstack-leads", recorded: true },
      { dimension: "ops-polish", gstackScore: 9, verdict: "gstack-leads", recorded: true },
    ],
    loopBack: [
      { dimension: "code-quality", milestone: "M-02", fixFeatures: "F-03 F-04 F-05 F-06 F-07" },
      { dimension: "tests", milestone: "M-04", fixFeatures: "F-11 F-12 F-13 F-14" },
      { dimension: "extensibility", milestone: "M-03", fixFeatures: "F-08 F-10" },
      { dimension: "ops-polish", milestone: "M-05", fixFeatures: "F-15 F-17" },
      { dimension: "docs", milestone: "M-06", fixFeatures: "F-18" },
    ],
    ...overrides,
  };
}

/** Build a rerun from a dimension->loomScore map, copying gstack from baseline. */
function makeRerun(
  loomScores: Record<string, number | string>,
  overall: number | string,
  rubricRef: string = RUBRIC,
  gstackOverrides: Record<string, number> = {},
): Rerun {
  const base = makeBaseline();
  const dimensions: RerunDimension[] = base.dimensions.map((d) => ({
    dimension: d.dimension,
    loomScore: loomScores[d.dimension],
    gstackScore: gstackOverrides[d.dimension] ?? d.gstackScore,
  }));
  return { rubricRef, overall, dimensions };
}

/** Loom scores that clear every gstack pin by ≥ 1. */
const WINNING_SCORES: Record<string, number> = {
  "prompt-assets": 9,
  architecture: 9,
  docs: 9,
  "code-quality": 9,
  tests: 10,
  extensibility: 9,
  "ops-polish": 10,
};

describe("evaluateGate — acceptance", () => {
  it("(a) passes when every delta ≥ 0 and overall > 8.3", () => {
    const result = evaluateGate(makeBaseline(), makeRerun(WINNING_SCORES, 9.1));
    expect(result.outcome).toBe("pass");
    expect(result.exitCode).toBe(0);
    expect(result.trailing).toHaveLength(0);
    expect(result.overallPass).toBe(true);
  });

  it("passes at the exact tie floor (delta 0 on every dimension) with overall just over 8.3", () => {
    const tie: Record<string, number> = {
      "prompt-assets": 7,
      architecture: 8,
      docs: 8,
      "code-quality": 8,
      tests: 9,
      extensibility: 8,
      "ops-polish": 9,
    };
    const result = evaluateGate(makeBaseline(), makeRerun(tie, 8.31));
    expect(result.outcome).toBe("pass");
    expect(result.exitCode).toBe(0);
  });
});

describe("evaluateGate — trailing dimensions", () => {
  it("(b) fails with exit 2 and names the single trailing dimension + its loop-back milestone", () => {
    const scores = { ...WINNING_SCORES, tests: 8 }; // tests: 8 < gstack 9
    const result = evaluateGate(makeBaseline(), makeRerun(scores, 9.0));
    expect(result.outcome).toBe("below-target");
    expect(result.exitCode).toBe(2);
    expect(result.trailing).toHaveLength(1);
    const trailing = result.trailing[0];
    expect(trailing.dimension).toBe("tests");
    expect(trailing.delta).toBe(-1);
    expect(trailing.milestone).toBe("M-04");
    expect(trailing.fixFeatures).toContain("F-14");
  });

  it("reports every trailing dimension when several trail", () => {
    const scores = { ...WINNING_SCORES, tests: 8, "code-quality": 7 };
    const result = evaluateGate(makeBaseline(), makeRerun(scores, 9.0));
    expect(result.outcome).toBe("below-target");
    const dims = result.trailing.map((t) => t.dimension).sort();
    expect(dims).toEqual(["code-quality", "tests"]);
    const cq = result.trailing.find((t) => t.dimension === "code-quality")!;
    expect(cq.milestone).toBe("M-02");
  });
});

describe("evaluateGate — overall floor", () => {
  it("(c) does NOT pass when overall ≤ 8.3 even though every delta ≥ 0", () => {
    const result = evaluateGate(makeBaseline(), makeRerun(WINNING_SCORES, 8.3));
    expect(result.outcome).not.toBe("pass");
    expect(result.outcome).toBe("below-target");
    expect(result.exitCode).toBe(2);
    expect(result.overallPass).toBe(false);
    expect(result.trailing).toHaveLength(0); // no dimension trails; only overall
  });
});

describe("evaluateGate — refusal (anti-drift, C-09)", () => {
  it("(d) refuses a rerun whose rubricRef differs from the baseline", () => {
    const rerun = makeRerun(WINNING_SCORES, 9.1, "some/other/rubric.toon");
    const result = evaluateGate(makeBaseline(), rerun);
    expect(result.outcome).toBe("refused");
    expect(result.exitCode).toBe(2);
    expect(result.reason).toContain("rubricRef");
  });

  it("refuses when a rerun gstackScore was mutated from the pinned baseline", () => {
    const rerun = makeRerun(WINNING_SCORES, 9.1, RUBRIC, { tests: 6 });
    const result = evaluateGate(makeBaseline(), rerun);
    expect(result.outcome).toBe("refused");
    expect(result.reason).toContain("tests");
  });

  it("refuses when a pinned dimension is missing from the rerun", () => {
    const rerun = makeRerun(WINNING_SCORES, 9.1);
    rerun.dimensions = rerun.dimensions.filter((d) => d.dimension !== "ops-polish");
    const result = evaluateGate(makeBaseline(), rerun);
    expect(result.outcome).toBe("refused");
    expect(result.reason).toContain("ops-polish");
  });
});

describe("evaluateGate — pending placeholders", () => {
  it("reports pending (exit 2) while loomScores are still the placeholder token", () => {
    const pending: Record<string, string> = {
      "prompt-assets": "pending",
      architecture: "pending",
      docs: "pending",
      "code-quality": "pending",
      tests: "pending",
      extensibility: "pending",
      "ops-polish": "pending",
    };
    const result = evaluateGate(makeBaseline(), makeRerun(pending, "pending"));
    expect(result.outcome).toBe("pending");
    expect(result.exitCode).toBe(2);
    expect(result.overall).toBeNull();
  });

  it("reports pending when even one dimension is still unscored", () => {
    const scores = { ...WINNING_SCORES, tests: "pending" as string };
    const result = evaluateGate(makeBaseline(), makeRerun(scores, 9.0));
    expect(result.outcome).toBe("pending");
    expect(result.reason).toContain("tests");
  });
});

describe("loadBaseline — committed on-disk rubric", () => {
  it("round-trips the pinned baseline file and exposes all 7 dimensions", () => {
    const baseline = loadBaseline(path.join(REPO_ROOT, BASELINE_REL_PATH));
    expect(baseline.rubricRef).toBe(RUBRIC);
    expect(baseline.gstackOverall).toBe(8.3);
    expect(baseline.dimensions).toHaveLength(7);
    const codeQuality = baseline.dimensions.find((d) => d.dimension === "code-quality")!;
    expect(codeQuality.gstackScore).toBe(8);
    expect(codeQuality.recorded).toBe(true);
    // Loop-back covers the four trailing + docs; not prompt-assets / architecture.
    expect(baseline.loopBack.map((l) => l.dimension).sort()).toEqual(
      ["code-quality", "docs", "extensibility", "ops-polish", "tests"],
    );
  });
});
