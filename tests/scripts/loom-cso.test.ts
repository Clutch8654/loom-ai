/**
 * tests/scripts/loom-cso.test.ts
 *
 * Unit coverage for the CSO gate's pure logic (PR #35 review follow-up):
 * computeScore, lastDailyScore, and decideGate are the arithmetic and
 * decisioning behind the daily 0/1/2 exit contract — a wrong result here
 * silently blocks every PR or lets a security regression through, so they
 * are the highest-value units to lock down.
 *
 * Run: bunx vitest run tests/scripts/loom-cso.test.ts
 */

import { describe, it, expect } from "vitest";
import { computeScore, lastDailyScore, decideGate } from "../../scripts/loom-cso";

const counts = (over: Partial<Record<string, number>> = {}) => ({
  secretsCount: 0,
  depVulnCount: 0,
  authGaps: 0,
  inputValidationGaps: 0,
  llmTrustIssues: 0,
  filePermIssues: 0,
  cicdIssues: 0,
  ...over,
});

describe("computeScore", () => {
  it("scores a clean repo (all zero) at 10", () => {
    expect(computeScore(counts())).toBe(10);
  });

  it("clamps at the floor of 0, never negative (5 secrets = deduction 15)", () => {
    expect(computeScore(counts({ secretsCount: 5 }))).toBe(0);
  });

  it("weights secrets ×3", () => {
    expect(computeScore(counts({ secretsCount: 1 }))).toBe(7);
  });

  it("weights authGaps and llmTrustIssues ×2", () => {
    expect(computeScore(counts({ authGaps: 1 }))).toBe(8);
    expect(computeScore(counts({ llmTrustIssues: 1 }))).toBe(8);
  });

  it("weights depVuln, inputValidation, filePerm, cicd ×1", () => {
    expect(computeScore(counts({ depVulnCount: 1 }))).toBe(9);
    expect(computeScore(counts({ inputValidationGaps: 1 }))).toBe(9);
    expect(computeScore(counts({ filePermIssues: 1 }))).toBe(9);
    expect(computeScore(counts({ cicdIssues: 1 }))).toBe(9);
  });
});

describe("lastDailyScore", () => {
  const header =
    "schemaVersion: 1\nentries[3]{timestamp,mode,score,confidenceFloor,secretsCount,depVulnCount,authGaps,inputValidationGaps,llmTrustIssues,filePermIssues,cicdIssues,gitSha}:";

  it("returns the last DAILY score, skipping later monthly rows", () => {
    const h = [
      header,
      "  2026-07-01T00:00:00Z,daily,9,8,0,0,0,0,0,0,0,aaa",
      "  2026-07-02T00:00:00Z,monthly,4,2,0,0,0,0,0,0,0,bbb",
    ].join("\n");
    // The newest row is monthly; the gate must compare against the last daily (9).
    expect(lastDailyScore(h)).toBe(9);
  });

  it("returns null on empty history", () => {
    expect(lastDailyScore("")).toBeNull();
    expect(lastDailyScore(header + "\n")).toBeNull();
  });

  it("returns null when the score column is non-numeric (disables the block branch)", () => {
    const h = header + "\n  2026-07-01T00:00:00Z,daily,notanumber,8,0,0,0,0,0,0,0,aaa";
    expect(lastDailyScore(h)).toBeNull();
  });

  it("ignores the header / schemaVersion lines (only 2-space-indented data rows count)", () => {
    // No data rows at all — header must never be mistaken for a row.
    expect(lastDailyScore(header)).toBeNull();
  });
});

describe("decideGate", () => {
  it("daily: regression vs previous daily → block", () => {
    expect(decideGate("daily", 7, 9, false)).toBe("block");
  });

  it("daily: below the 8 floor without regressing → warn", () => {
    expect(decideGate("daily", 6, null, false)).toBe("warn");
  });

  it("daily: a skipped lens degrades a clean score to warn (not-checked ≠ clean)", () => {
    expect(decideGate("daily", 10, 10, true)).toBe("warn");
  });

  it("daily: clean, at-or-above floor, no regression → pass", () => {
    expect(decideGate("daily", 10, 9, false)).toBe("pass");
    expect(decideGate("daily", 8, null, false)).toBe("pass");
  });

  it("monthly never gates, even with findings", () => {
    expect(decideGate("monthly", 2, 9, true)).toBe("pass");
  });
});
