#!/usr/bin/env -S bunx tsx
/**
 * scripts/eval/run-evals.ts — three-tier eval ladder runner (Phase 20, F-20 + F-21).
 *
 * Schema:  protocols/eval-tier.schema.md (EvalTierResult, tier lifecycle,
 *          state machine, error codes).
 * Types:   `EvalTier`, `EvalTierResult`, `EvalResultRow` in lib/types.ts.
 * Artifact: evals/results/{runId}.toon, runId = `{date}-{tier}-{shortsha}`.
 *
 * Free-by-default invariant (C-03):
 *   - T1 (static/in-process) and T2 (hermetic replay) make ZERO network/LLM
 *     calls — `llmCalls` MUST be 0.
 *   - Only T3 (LLM-judge) may call an LLM, and only when `LOOM_EVAL_LLM` is
 *     set — otherwise T3 is `skipped`, exit 0, and NEVER merge-blocking.
 *
 * TOON I/O goes through the sanctioned lib/ core (serializeToon /
 * atomicWriteText) — no local re-implementation (C-02).
 *
 * Usage:
 *   bun scripts/eval/run-evals.ts --tier t1     # PR gate (blocking, free)
 *   bun scripts/eval/run-evals.ts --tier t2     # nightly (advisory, hermetic)
 *   bun scripts/eval/run-evals.ts --tier t3     # opt-in behind LOOM_EVAL_LLM
 *   bun scripts/eval/run-evals.ts --tier qa-outcome  # ground-truth outcome eval, opt-in behind LOOM_EVAL_LLM
 *
 * Exit codes:
 *   0  tier passed / skipped (t3 always exits 0 on judged-score grounds)
 *   1  t1/t2 eval failed, fixture missing, or tier contract violation
 *   2  usage error
 */

import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { serializeToon, atomicWriteText, isMain } from "../../lib/index.js";
import type {
  EvalTier,
  EvalTierResult,
  EvalStatus,
  EvalResultRow,
  ToonValue,
} from "../../lib/index.js";
import { runT1 } from "./tiers/t1-static.js";
import { runT2 } from "./tiers/t2-hermetic.js";
import { runT3, type Judge } from "./tiers/t3-judge.js";
import { runQaOutcome } from "./tiers/qa-outcome.js";

/** Default artifact directories, repo-relative. */
export const RESULTS_DIR = "evals/results";
export const FIXTURES_DIR = "evals/fixtures";

/** Error codes shared by the tiers (protocols/eval-tier.schema.md). */
export type EvalErrorCode =
  | "EVAL_FIXTURE_MISSING"
  | "EVAL_TIER_CONTRACT_VIOLATION"
  | "EVAL_FLOOR_REGRESSION"
  | "EVAL_FLOOR_MISSING";

/**
 * The uniform value a tier returns to the runner. The runner stamps the
 * `runId`, `tier`, and `gitRef` onto it to build the EvalTierResult artifact.
 */
export interface TierRunOutput {
  status: EvalStatus;
  /** MUST be 0 for t1 and t2 (free-by-default invariant, C-03). */
  llmCalls: number;
  results: EvalResultRow[];
  /** main-branch floor runId (t3 only), else null. */
  floorRef: string | null;
  /** Process exit code. T3 is always 0 on judged-score grounds. */
  exitCode: number;
  /** Set on fixture/floor/contract conditions; advisory codes never fail CI. */
  errorCode: EvalErrorCode | null;
  /** Human-readable `::warning::` lines (advisory; never merge-blocking). */
  warnings: string[];
  /** Aggregate LLM-judge score, t3 only (0–10), else null. */
  judgedScore?: number | null;
}

/** Options seam for testability (dir overrides, injected judge, fixed ids). */
export interface RunOptions {
  repoRoot?: string;
  /** Where the EvalTierResult artifact is written (default RESULTS_DIR). */
  resultsDir?: string;
  /** Where T2 reads hermetic fixtures (default FIXTURES_DIR). */
  fixturesDir?: string;
  env?: NodeJS.ProcessEnv;
  /** Injected LLM judge for t3 (tests MUST inject a mock — never a live call). */
  judge?: Judge;
  /** Explicit t3 floor runId; else discovered from resultsDir. */
  floorRef?: string | null;
  /** Deterministic runId parts (tests). */
  date?: string;
  shortSha?: string;
  gitRef?: string;
}

const VALID_TIERS: readonly EvalTier[] = ["t1", "t2", "t3", "qa-outcome"];

function parseTier(argv: string[]): EvalTier {
  const i = argv.indexOf("--tier");
  const raw = i >= 0 ? argv[i + 1] : undefined;
  if (raw === undefined) {
    throw new UsageError("missing required --tier <t1|t2|t3|qa-outcome>");
  }
  if (!VALID_TIERS.includes(raw as EvalTier)) {
    throw new UsageError(
      `invalid tier "${raw}" (expected t1 | t2 | t3 | qa-outcome)`,
    );
  }
  return raw as EvalTier;
}

function parseFlag(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

class UsageError extends Error {}

function gitShort(repoRoot: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    return "nogit";
  }
}

function gitFull(repoRoot: string): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    return "0000000000000000000000000000000000000000";
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function resolveDir(dir: string, repoRoot: string): string {
  return path.isAbsolute(dir) ? dir : path.join(repoRoot, dir);
}

/** Build the on-disk ToonValue for an EvalTierResult (schema `evalTierResult:`). */
// eslint-disable-next-line no-restricted-syntax -- C-02: builds a ToonValue object only; actual serialization is delegated to lib's serializeToon (no hand-rolled serializer here)
function toToon(r: EvalTierResult): ToonValue {
  return {
    evalTierResult: {
      runId: r.runId,
      tier: r.tier,
      gitRef: r.gitRef,
      status: r.status,
      llmCalls: r.llmCalls,
      floorRef: r.floorRef ?? null,
      results: r.results.map((row) => ({
        evalId: row.evalId,
        outcome: row.outcome,
        score: row.score,
        judgedScore: row.judgedScore ?? null,
      })),
    },
  };
}

/** Atomically write the EvalTierResult artifact; returns the absolute path. */
export function writeResult(result: EvalTierResult, resultsDir: string): string {
  const outPath = path.join(resultsDir, `${result.runId}.toon`);
  atomicWriteText(outPath, serializeToon(toToon(result)));
  return outPath;
}

/**
 * Run one tier, write its artifact, emit advisory warnings, and return the
 * process exit code. Exported for in-process tests; the CLI wraps it below.
 */
export async function main(argv: string[], opts: RunOptions = {}): Promise<number> {
  let tier: EvalTier;
  try {
    tier = parseTier(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`run-evals: ${err.message}`);
      return 2;
    }
    throw err;
  }

  const repoRoot = opts.repoRoot ?? process.cwd();
  const env = opts.env ?? process.env;
  const resultsDir = resolveDir(
    opts.resultsDir ?? parseFlag(argv, "--out") ?? RESULTS_DIR,
    repoRoot,
  );
  const fixturesDir = resolveDir(opts.fixturesDir ?? FIXTURES_DIR, repoRoot);

  const date = opts.date ?? today();
  const shortSha = opts.shortSha ?? gitShort(repoRoot);
  const gitRef = opts.gitRef ?? gitFull(repoRoot);
  const runId = `${date}-${tier}-${shortSha}`;

  let out: TierRunOutput;
  if (tier === "t1") {
    out = runT1();
  } else if (tier === "t2") {
    out = runT2({ fixturesDir });
  } else if (tier === "t3") {
    out = await runT3({ env, judge: opts.judge, resultsDir, floorRef: opts.floorRef });
  } else {
    // qa-outcome: gated on LOOM_EVAL_LLM, mirrors t3. No reporter is wired from
    // the CLI, so with the flag set it advisory-skips; unset it skips (exit 0).
    // P9a's nightly CI job injects a reporter to score planted-bug detections.
    out = await runQaOutcome({ env });
  }

  const result: EvalTierResult = {
    runId,
    tier,
    gitRef,
    status: out.status,
    llmCalls: out.llmCalls,
    floorRef: out.floorRef,
    results: out.results,
  };
  writeResult(result, resultsDir);

  console.error(
    `run-evals ${tier}: status=${out.status} llmCalls=${out.llmCalls} ` +
      `results=${out.results.length} -> ${path.join(resultsDir, `${runId}.toon`)}`,
  );
  for (const w of out.warnings) {
    console.error(`::warning::${w}`);
  }

  return out.exitCode;
}

if (isMain(import.meta)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`run-evals: fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
      process.exit(1);
    });
}
