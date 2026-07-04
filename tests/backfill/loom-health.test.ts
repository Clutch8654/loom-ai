/**
 * tests/backfill/loom-health.test.ts
 *
 * Behavioral backfill for scripts/loom-health.ts (F-11, defect 6 — Phase 14b
 * batch B1). The subprocess-injection surface is already covered by
 * tests/scripts/loom-health-exec.test.ts; this suite pins the pure scoring
 * logic that composes the 0-10 health score, exercising real inputs through
 * the real functions and asserting on returned values (not source text).
 *
 * The health module is CJS-guarded (`require.main === module`), so importing it
 * runs no main() side effects — the exported scoring functions are called
 * directly. Assertions route through the shared backfill template's
 * `runAndAssert`, which captures the observable return value of each call.
 *
 * Run: bunx vitest run tests/backfill/loom-health.test.ts
 */

import { describe, it, expect } from "vitest";
import { runAndAssert } from "../helpers/backfill-template.js";
import { linearScore, computeComposite } from "../../scripts/loom-health.js";

describe("loom-health linearScore (error-count → 0..10)", () => {
  it("scores a clean run (zero errors) as a perfect 10", async () => {
    await runAndAssert(() => linearScore(0, 10), { returns: 10 });
  });

  it("scores at or above the ceiling as 0", async () => {
    await runAndAssert(() => linearScore(10, 10), { returns: 0 });
    await runAndAssert(() => linearScore(25, 10), { returns: 0 });
  });

  it("interpolates linearly between zero and the ceiling", async () => {
    // 5 errors of a 10 ceiling → halfway → 5.0.
    await runAndAssert(() => linearScore(5, 10), { returns: 5 });
    // 5 errors of a 20 ceiling → 10 * (1 - 5/20) = 7.5.
    await runAndAssert(() => linearScore(5, 20), { returns: 7.5 });
  });
});

describe("loom-health computeComposite (weighted, re-normalized 0..10)", () => {
  it("re-normalizes over only the components that actually ran", async () => {
    // One perfect, one zero, equal weights → weighted average 5.0. A skipped
    // component with NaN rawScore is excluded from both numerator and the
    // weight-sum denominator, so it does not drag the composite toward zero.
    const components = [
      { tool: "typecheck", rawScore: 10, weight: 0.3, skipped: false },
      { tool: "lint", rawScore: 0, weight: 0.3, skipped: false },
      { tool: "tests", rawScore: NaN, weight: 0.3, skipped: true },
    ];
    await runAndAssert(() => computeComposite(components), { returns: 5 });
  });

  it("returns a perfect 10 when every scored component is perfect", async () => {
    const components = [
      { tool: "typecheck", rawScore: 10, weight: 0.3, skipped: false },
      { tool: "lint", rawScore: 10, weight: 0.2, skipped: false },
      { tool: "shell", rawScore: NaN, weight: 0.1, skipped: true },
    ];
    await runAndAssert(() => computeComposite(components), { returns: 10 });
  });

  it("returns 0 when nothing scored (all components skipped)", async () => {
    const components = [
      { tool: "typecheck", rawScore: NaN, weight: 0.3, skipped: true },
      { tool: "tests", rawScore: NaN, weight: 0.3, skipped: true },
    ];
    await runAndAssert(() => computeComposite(components), { returns: 0 });
  });

  it("rounds the composite to a single decimal place", async () => {
    // rawScores 10 (w .3) and 8 (w .1) → (3.0 + 0.8) / 0.4 = 9.5.
    const outcome = await runAndAssert(
      () =>
        computeComposite([
          { tool: "typecheck", rawScore: 10, weight: 0.3, skipped: false },
          { tool: "shell", rawScore: 8, weight: 0.1, skipped: false },
        ]),
      { returns: 9.5 },
    );
    expect(Number.isInteger(outcome.returned! * 10)).toBe(true);
  });
});
