/**
 * scripts/eval/tiers/t1-static.ts — T1 static / in-process eval tier
 * (Phase 20, F-20). Contract: protocols/eval-tier.schema.md.
 *
 * T1 runs on every PR (blocking). Every eval is a DETERMINISTIC in-process
 * assertion over the sanctioned shared core (lib/) — zero network, zero LLM
 * calls. `llmCalls` is invariantly 0 (free-by-default, C-03).
 */

import {
  serializeToon,
  parseToon,
  splitCsvLine,
  joinCsvLine,
} from "../../../lib/index.js";
import type { EvalResultRow, ToonValue } from "../../../lib/index.js";
import type { TierRunOutput } from "../run-evals.js";

/** Structural deep-equality over plain JSON-ish values (order-sensitive). */
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * grammar-roundtrip: `parseToon(serializeToon(x))` must deep-equal `x` for a
 * spread of representative TOON shapes (scalars, inline arrays, tables, nested
 * blocks, escape-sensitive strings). This is the C-02 round-trip guarantee
 * exercised as an eval.
 */
function grammarRoundtrip(): EvalResultRow {
  const samples: ToonValue[] = [
    { key: "value", n: 42, flag: true, nothing: null },
    { list: ["a", "b", "c"] },
    {
      rows: [
        { id: 1, name: "alpha" },
        { id: 2, name: "beta" },
      ],
    },
    { nested: { deep: { deeper: "x" } } },
    { tricky: 'has "quotes", commas, and\nnewlines' },
    { empty: "", arr: [] },
  ];
  const passed = samples.every((s) => deepEqual(parseToon(serializeToon(s)), s));
  return { evalId: "grammar-roundtrip", outcome: passed ? "passed" : "failed", score: passed ? 1 : 0 };
}

/**
 * csv-escape-parity: `splitCsvLine(joinCsvLine(fields))` must recover the
 * original fields, including delimiters and quotes inside quoted fields — the
 * single-source-of-truth CSV convention shared by lib/toon.ts (defect 8).
 */
function csvEscapeParity(): EvalResultRow {
  const cases: string[][] = [
    ["4471", "Doe, Jane", "shipped"],
    ['a "quoted" cell', "plain", ""],
    ["trailing space ", " leading", "mid,dle"],
    ["line1\nline2", "tab\tsep", "ok"],
  ];
  const passed = cases.every((fields) =>
    deepEqual(splitCsvLine(joinCsvLine(fields), { trim: false }), fields),
  );
  return { evalId: "csv-escape-parity", outcome: passed ? "passed" : "failed", score: passed ? 1 : 0 };
}

/**
 * Run all T1 evals. Deterministic and in-process — `llmCalls` is always 0.
 * Any failed eval flips the tier to `failed` with exit 1 (PR-blocking).
 */
export function runT1(): TierRunOutput {
  const results: EvalResultRow[] = [grammarRoundtrip(), csvEscapeParity()];
  const failed = results.some((r) => r.outcome === "failed");
  return {
    status: failed ? "failed" : "passed",
    llmCalls: 0,
    results,
    floorRef: null,
    exitCode: failed ? 1 : 0,
    errorCode: null,
    warnings: [],
  };
}
