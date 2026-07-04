/**
 * tests/scripts/changelog-metrics-match.test.ts — M-09 close (C-04 / C-09 / C-12).
 *
 * Guards the cascade "MetricsSnapshot regeneration requires changelog re-validation"
 * (PLAN-exceed-gstack MetricsSnapshot cascade table). The final measured changelog
 * entry MUST embed the snapshot's seven pre-registered metric values VERBATIM — no
 * prose estimates — and MUST record the HONEST M-09 acceptance outcome (BELOW-TARGET,
 * scorecard overall 8.07 ≤ the pinned 8.3 floor), never an inflated "passed" story.
 *
 * If someone regenerates planning/reports/metrics-snapshot.toon without updating
 * planning/history/changelog.md (or vice-versa), this test fails.
 *
 * Run: bunx vitest run tests/scripts/changelog-metrics-match.test.ts
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseToon } from "../../lib/index.js";
import type { ToonValue } from "../../lib/index.js";
import { REPORT_REL_PATH } from "../../scripts/metrics-snapshot";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHANGELOG_REL_PATH = "planning/history/changelog.md";

/** The seven pre-registered metric names, frozen order. */
const EXPECTED_METRICS = [
  "typecheck-errors",
  "test-source-ratio",
  "tautological-tests",
  "defects-closed",
  "ci-gates-green",
  "meta-tests-firing",
  "scorecard-overall",
] as const;

function asObject(v: ToonValue): { [k: string]: ToonValue } {
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    return v as { [k: string]: ToonValue };
  }
  throw new Error("expected a TOON object");
}

/** Parse the committed snapshot into its metric rows + equivalence block. */
function loadSnapshot(): {
  rows: { metric: string; value: ToonValue; pass: boolean }[];
  equivalence: { [k: string]: ToonValue } | null;
} {
  const doc = asObject(parseToon(fs.readFileSync(path.join(REPO_ROOT, REPORT_REL_PATH), "utf8")));
  const snap = asObject(doc.metricsSnapshot);
  const metrics = Array.isArray(snap.metrics) ? snap.metrics : [];
  const rows = metrics.map((m) => {
    const o = asObject(m);
    return {
      metric: String(o.metric),
      value: o.value,
      pass: o.pass === true,
    };
  });
  const equivalence =
    snap.equivalence && typeof snap.equivalence === "object" && !Array.isArray(snap.equivalence)
      ? (snap.equivalence as { [k: string]: ToonValue })
      : null;
  return { rows, equivalence };
}

const readChangelog = (): string =>
  fs.readFileSync(path.join(REPO_ROOT, CHANGELOG_REL_PATH), "utf8");

describe("changelog embeds the MeasuredSnapshot values verbatim", () => {
  it("carries all seven pre-registered metrics in the snapshot", () => {
    const { rows } = loadSnapshot();
    expect(rows.map((r) => r.metric)).toEqual([...EXPECTED_METRICS]);
  });

  it("embeds each metric's exact `metric: value` string (no prose estimate)", () => {
    const { rows } = loadSnapshot();
    const changelog = readChangelog();
    for (const row of rows) {
      // Numbers render as-is; booleans as true/false — the verbatim snapshot value.
      const rendered = typeof row.value === "boolean" ? String(row.value) : String(row.value);
      expect(
        changelog,
        `changelog must embed "${row.metric}: ${rendered}" verbatim from the snapshot`,
      ).toContain(`${row.metric}: ${rendered}`);
    }
  });

  it("embeds the C-21 equivalence computedValue verbatim", () => {
    const { equivalence } = loadSnapshot();
    expect(equivalence).not.toBeNull();
    const computed = equivalence!.computedValue;
    expect(typeof computed).toBe("number");
    expect(readChangelog()).toContain(String(computed));
  });
});

describe("changelog records the HONEST M-09 acceptance outcome", () => {
  it("names the below-target result and does not spin it as a pass", () => {
    const changelog = readChangelog();
    expect(changelog).toContain("BELOW-TARGET");
    // The honest scorecard overall + the pinned floor must both appear.
    expect(changelog).toContain("8.07");
    expect(changelog).toContain("8.3");
  });

  it("scorecard-overall fails the gate in BOTH the snapshot and the changelog", () => {
    const { rows } = loadSnapshot();
    const scorecard = rows.find((r) => r.metric === "scorecard-overall");
    expect(scorecard, "scorecard-overall row must exist").toBeDefined();
    // Honest gate: 8.07 does not exceed the 8.3 floor.
    expect(scorecard!.pass).toBe(false);
    expect(scorecard!.value).toBe(8.07);
    // The changelog must mark it FAIL, not PASS.
    const changelog = readChangelog();
    expect(changelog).toMatch(/scorecard-overall: 8\.07.*FAIL/s);
  });

  it("the other six metrics pass in the snapshot", () => {
    const { rows } = loadSnapshot();
    for (const row of rows) {
      if (row.metric === "scorecard-overall") continue;
      expect(row.pass, `${row.metric} should pass`).toBe(true);
    }
  });
});

describe("the committed snapshot is fresh (report matches repo state)", () => {
  it("`metrics-snapshot.ts --check` exits 0", () => {
    const r = spawnSync("bun", ["scripts/metrics-snapshot.ts", "--check"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("metricsValid");
  });
});
