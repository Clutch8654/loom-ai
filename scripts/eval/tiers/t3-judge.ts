/**
 * scripts/eval/tiers/t3-judge.ts — T3 opt-in LLM-judge eval tier
 * (Phase 20, F-21). Contract: protocols/eval-tier.schema.md.
 *
 * T3 is the ONLY tier permitted to call an LLM, and only when `LOOM_EVAL_LLM`
 * is set. It is ADVISORY-ONLY and NEVER merge-blocking: it always exits 0 on
 * judged-score grounds. When the flag is unset it is `skipped` (exit 0, zero
 * llmCalls).
 *
 * With the flag set and a judge wired, each live prompt is scored by the judge
 * (0–10). The aggregate is compared against the `main`-branch floor run
 * (`floorRef`):
 *   - below floor          -> EVAL_FLOOR_REGRESSION (warning, exit 0)
 *   - no floor found        -> EVAL_FLOOR_MISSING     (warning, exit 0)
 *
 * The judge is injected via a seam (`opts.judge`) so tests mock it — there is
 * NEVER a live network call in the test suite.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseToon } from "../../../lib/index.js";
import type { ToonValue } from "../../../lib/index.js";
import type { TierRunOutput } from "../run-evals.js";

/** One live prompt handed to the LLM judge. */
export interface JudgeInput {
  evalId: string;
  prompt: string;
  /** The candidate output to be judged. */
  target: string;
}

/** The judge's verdict for one prompt (score on a 0–10 scale). */
export interface JudgeResult {
  score: number;
}

/** The LLM-judge seam. Tests inject a mock; production wires a live judge. */
export type Judge = (input: JudgeInput) => JudgeResult | Promise<JudgeResult>;

export interface RunT3Options {
  env?: NodeJS.ProcessEnv;
  /** Injected judge. Absent + flag set => advisory skip (no judge wired). */
  judge?: Judge;
  /** Where prior EvalTierResult artifacts (incl. the floor) live. */
  resultsDir?: string;
  /** Explicit floor runId; else discovered as the latest other t3 run. */
  floorRef?: string | null;
  /** Live prompts to judge (default set below). */
  prompts?: JudgeInput[];
}

/** Default live prompts (only used when a real judge is wired). */
const DEFAULT_PROMPTS: JudgeInput[] = [
  {
    evalId: "plan-summary-quality",
    prompt: "Summarize the plan wave in one sentence.",
    target: "Ships a three-tier eval ladder: T1 static, T2 hermetic, T3 opt-in judge.",
  },
  {
    evalId: "review-tone-quality",
    prompt: "Rewrite the review finding to be actionable and specific.",
    target: "Extract the duplicated CSV splitter into lib/csv.ts and import it here.",
  },
];

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Aggregate judged score of a stored EvalTierResult, or null if none. */
function floorScoreOf(file: string): number | null {
  let parsed: ToonValue;
  try {
    parsed = parseToon(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  const root =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as { [k: string]: ToonValue })
      : {};
  const etr = root.evalTierResult;
  const rows =
    typeof etr === "object" && etr !== null && !Array.isArray(etr)
      ? (etr as { [k: string]: ToonValue }).results
      : undefined;
  if (!Array.isArray(rows)) return null;
  const scores: number[] = [];
  for (const row of rows) {
    if (typeof row === "object" && row !== null && !Array.isArray(row)) {
      const js = (row as { [k: string]: ToonValue }).judgedScore;
      if (typeof js === "number") scores.push(js);
    }
  }
  return scores.length === 0 ? null : mean(scores);
}

/** Resolve the floor run: explicit floorRef, else latest other t3 artifact. */
function resolveFloor(
  resultsDir: string | undefined,
  floorRef: string | null | undefined,
): { runId: string; score: number } | null {
  if (resultsDir === undefined) return null;
  if (floorRef) {
    const file = path.join(resultsDir, `${floorRef}.toon`);
    if (!fs.existsSync(file)) return null;
    const score = floorScoreOf(file);
    return score === null ? null : { runId: floorRef, score };
  }
  // Discovery: latest `*-t3-*.toon` by filename (date-prefixed => lexical).
  let candidates: string[];
  try {
    candidates = fs.readdirSync(resultsDir).filter((f) => f.includes("-t3-") && f.endsWith(".toon"));
  } catch {
    return null;
  }
  candidates.sort();
  for (const f of candidates.reverse()) {
    const score = floorScoreOf(path.join(resultsDir, f));
    if (score !== null) return { runId: f.replace(/\.toon$/, ""), score };
  }
  return null;
}

/**
 * Run T3. Gated on `LOOM_EVAL_LLM`; advisory-only; always exit 0 on
 * judged-score grounds.
 */
export async function runT3(opts: RunT3Options = {}): Promise<TierRunOutput> {
  const env = opts.env ?? process.env;

  // Gate: flag unset -> skipped, terminal, zero cost.
  if (!env.LOOM_EVAL_LLM) {
    return {
      status: "skipped",
      llmCalls: 0,
      results: [],
      floorRef: null,
      exitCode: 0,
      errorCode: null,
      warnings: [],
      judgedScore: null,
    };
  }

  // Flag set but no judge wired: still advisory — skip rather than block.
  if (!opts.judge) {
    return {
      status: "skipped",
      llmCalls: 0,
      results: [],
      floorRef: null,
      exitCode: 0,
      errorCode: null,
      warnings: [
        "LOOM_EVAL_LLM is set but no judge implementation is wired; T3 skipped (advisory)",
      ],
      judgedScore: null,
    };
  }

  const prompts = opts.prompts ?? DEFAULT_PROMPTS;
  const judge = opts.judge;
  let llmCalls = 0;
  const results = [];
  for (const p of prompts) {
    const verdict = await judge(p);
    llmCalls++;
    results.push({
      evalId: p.evalId,
      outcome: "passed" as const,
      score: verdict.score / 10,
      judgedScore: verdict.score,
    });
  }
  const judgedScore = mean(results.map((r) => r.judgedScore));

  const warnings: string[] = [];
  let errorCode: TierRunOutput["errorCode"] = null;
  const floor = resolveFloor(opts.resultsDir, opts.floorRef);

  if (floor === null) {
    errorCode = "EVAL_FLOOR_MISSING";
    warnings.push(
      "EVAL_FLOOR_MISSING: no main-branch t3 floor run found; judged score is advisory-only",
    );
    return {
      status: "passed",
      llmCalls,
      results,
      floorRef: null,
      exitCode: 0,
      errorCode,
      warnings,
      judgedScore,
    };
  }

  if (judgedScore < floor.score) {
    errorCode = "EVAL_FLOOR_REGRESSION";
    warnings.push(
      `EVAL_FLOOR_REGRESSION: judged ${judgedScore.toFixed(2)} < main floor ` +
        `${floor.score.toFixed(2)} (advisory; never merge-blocking)`,
    );
  }

  return {
    status: "passed",
    llmCalls,
    results,
    floorRef: floor.runId,
    exitCode: 0,
    errorCode,
    warnings,
    judgedScore,
  };
}
