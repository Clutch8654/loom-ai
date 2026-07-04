/**
 * scripts/eval/tiers/t2-hermetic.ts — T2 hermetic eval tier (Phase 20, F-20).
 * Contract: protocols/eval-tier.schema.md.
 *
 * T2 REPLAYS fixtured LLM I/O recorded under `evals/fixtures/` and runs a
 * deterministic in-process check over each recorded response. The recorded
 * response stands in for the model — so there is ZERO live LLM/network call
 * and `llmCalls` is invariantly 0 (free-by-default, C-03). Any attempt to
 * reach a live model would be an `EVAL_TIER_CONTRACT_VIOLATION`; because this
 * tier only ever reads fixtures off disk, that path is unreachable by
 * construction.
 *
 * A required fixture that is absent yields `EVAL_FIXTURE_MISSING` (exit 1) —
 * the tier refuses to silently pass with missing coverage.
 *
 * Fixture format (TOON), `evals/fixtures/{evalId}.toon`:
 *   evalId:   <id>
 *   prompt:   <the prompt that WAS sent to the model>
 *   response: <the recorded model output, replayed verbatim>
 *   <check-specific expected field>
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseToon, splitCsvLine } from "../../../lib/index.js";
import type { EvalResultRow, ToonValue } from "../../../lib/index.js";
import type { TierRunOutput } from "../run-evals.js";

export interface RunT2Options {
  /** Directory of committed fixtures (default resolved by the runner). */
  fixturesDir: string;
}

/** The fixtures T2 requires; a missing one is EVAL_FIXTURE_MISSING. */
const REQUIRED_EVALS = ["toon-summary-parity", "csv-row-extraction"] as const;
type RequiredEval = (typeof REQUIRED_EVALS)[number];

function asString(v: ToonValue): string {
  return typeof v === "string" ? v : String(v);
}

/**
 * Deterministic per-eval check over a replayed fixture. Returns a 0..1 score.
 * Reuses the sanctioned shared core (parseToon / splitCsvLine) so the eval
 * exercises real library behavior against recorded model output.
 */
function checkFixture(evalId: RequiredEval, fx: { [k: string]: ToonValue }): number {
  if (evalId === "toon-summary-parity") {
    // Recorded response is a TOON document; parse it and confirm the model's
    // `title` field matches the expected value.
    const parsed = parseToon(asString(fx.response));
    const title =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? asString((parsed as { [k: string]: ToonValue }).title)
        : "";
    return title === asString(fx.expectedTitle) ? 1 : 0;
  }
  // csv-row-extraction: recorded response is a CSV row (with an escaped comma
  // inside a quoted field); split it and confirm the 2nd column matches.
  const cells = splitCsvLine(asString(fx.response), { trim: true });
  return cells[1] === asString(fx.expectedName) ? 1 : 0;
}

/**
 * Run all T2 hermetic evals by replaying committed fixtures. `llmCalls` is
 * always 0. A missing required fixture returns `error` / EVAL_FIXTURE_MISSING
 * (exit 1); any red eval returns `failed` (exit 1).
 */
export function runT2(opts: RunT2Options): TierRunOutput {
  const results: EvalResultRow[] = [];

  for (const evalId of REQUIRED_EVALS) {
    const file = path.join(opts.fixturesDir, `${evalId}.toon`);
    if (!fs.existsSync(file)) {
      return {
        status: "error",
        llmCalls: 0,
        results,
        floorRef: null,
        exitCode: 1,
        errorCode: "EVAL_FIXTURE_MISSING",
        warnings: [`EVAL_FIXTURE_MISSING: ${path.relative(process.cwd(), file)}`],
      };
    }
    const raw = fs.readFileSync(file, "utf8");
    const parsed = parseToon(raw);
    const fx = (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed
      : {}) as { [k: string]: ToonValue };
    const score = checkFixture(evalId, fx);
    results.push({ evalId, outcome: score >= 1 ? "passed" : "failed", score });
  }

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
