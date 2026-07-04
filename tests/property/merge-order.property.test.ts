/**
 * tests/property/merge-order.property.test.ts — M-07 F-13 (property tests).
 *
 * Order-independence of the metric-row state merge. `mergeMetricRows` folds
 * rows keyed by the primary key (metric name) into the frozen pre-registered
 * order. The invariant: the MERGE RESULT does not depend on input order —
 *
 *   mergeMetricRows(perm_a(rows))  deep-equals  mergeMetricRows(perm_b(rows))
 *
 * for any two permutations of the same row set. This is the "state merge is
 * order-independent" property applied to a real merge in the codebase
 * (scripts/metrics-snapshot.ts), verified over randomly-generated row sets and
 * shuffles from a DETERMINISTIC seeded PRNG (no new dependency).
 *
 * Run: bunx vitest run tests/property/merge-order.property.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  mergeMetricRows,
  PRE_REGISTERED_METRICS,
} from "../../scripts/metrics-snapshot";
import type { MetricRow } from "../../lib/index.js";

/** Deterministic 32-bit PRNG (mulberry32). */
function makePrng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle driven by the seeded PRNG (pure — returns a copy). */
function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Build a distinct MetricRow for a metric name (values vary, pk is the name). */
function rowFor(name: MetricRow["metric"], rng: () => number): MetricRow {
  const isBool = name === "ci-gates-green";
  const value: MetricRow["value"] = isBool
    ? rng() < 0.5
    : Math.round(rng() * 1000) / 100;
  return {
    metric: name,
    value,
    target: isBool ? true : 1.4,
    derivedBy: `derive:${name}`,
    pass: rng() < 0.5,
  };
}

describe("metric-row merge order-independence (property)", () => {
  it("two shuffles of the same row set merge to an identical result", () => {
    const rng = makePrng(0xbeef01);
    for (let i = 0; i < 300; i++) {
      // Pick a random subset of the 7 pre-registered names (unique pks).
      const subset = PRE_REGISTERED_METRICS.filter(() => rng() < 0.6);
      if (subset.length === 0) continue;
      const rows = subset.map((m) => rowFor(m, rng));

      const a = mergeMetricRows(shuffle(rows, makePrng(i + 1)));
      const b = mergeMetricRows(shuffle(rows, makePrng(i + 9973)));

      expect(b, `iteration ${i}`).toEqual(a);

      // And the canonical result is always in pre-registered order.
      const order = a.map((r) => PRE_REGISTERED_METRICS.indexOf(r.metric));
      const sorted = [...order].sort((x, y) => x - y);
      expect(order, `iteration ${i} ordering`).toEqual(sorted);
    }
  });

  it("rejects a duplicate primary key (one value per metric)", () => {
    const dup: MetricRow[] = [
      rowFor("test-source-ratio", makePrng(1)),
      rowFor("test-source-ratio", makePrng(2)),
    ];
    expect(() => mergeMetricRows(dup)).toThrow(/duplicate metric/);
  });
});
