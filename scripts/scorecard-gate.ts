#!/usr/bin/env -S bunx tsx
/**
 * scripts/scorecard-gate.ts — M-09 acceptance gate (F-25, C-09).
 *
 * Reads the pinned baseline rubric (planning/reports/scorecard-baseline.toon)
 * and the comparative rerun (planning/reports/scorecard-rerun.toon) and decides
 * whether the "exceed gstack" bar was cleared.
 *
 * Acceptance (PASS ⇒ exit 0) requires BOTH:
 *   1. Every dimension delta (loomScore − pinned gstackScore) ≥ 0.
 *   2. The rerun overall > gstackOverall (8.3).
 *
 * Anything else ⇒ exit 2:
 *   - REFUSED   — rerun.rubricRef ≠ baseline path (anti-drift, C-09), or a
 *                 rerun gstackScore was mutated from the pinned baseline, or a
 *                 baseline dimension is missing from the rerun.
 *   - PENDING   — the rerun still holds placeholder (non-numeric) scores.
 *   - BELOW-TARGET — one or more dimensions trail; each trailing dimension is
 *                 printed with its loop-back milestone + responsible fix-features.
 *
 * TOON I/O goes through the sanctioned lib/ core (parseToon) — no hand-rolled
 * TOON parsing (C-02 / eslint ban). Schema types: `ScorecardResult`,
 * `ScorecardDimension` in lib/types.ts.
 *
 * Usage:
 *   bun scripts/scorecard-gate.ts            # gate the committed reports
 *   bun scripts/scorecard-gate.ts --baseline <path> --rerun <path>
 *
 * Exit codes:  0 pass · 2 refused | pending | below-target · 3 read error
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseToon, isMain } from "../lib/index.js";
import type { ToonValue } from "../lib/index.js";

/** Repo-relative default artifact locations. */
export const BASELINE_REL_PATH = "planning/reports/scorecard-baseline.toon";
export const RERUN_REL_PATH = "planning/reports/scorecard-rerun.toon";

/* ────────────────────────────────────────────────────────────────────────
 * Normalized shapes consumed by the pure gate function
 * ──────────────────────────────────────────────────────────────────────── */

export interface BaselineDimension {
  dimension: string;
  gstackScore: number;
  verdict: string;
  recorded: boolean;
}

export interface BaselineLoopBack {
  dimension: string;
  milestone: string;
  fixFeatures: string;
}

export interface Baseline {
  rubricRef: string;
  gstackOverall: number;
  dimensions: BaselineDimension[];
  loopBack: BaselineLoopBack[];
}

/** A rerun dimension as read off disk — scores may still be the `pending` token. */
export interface RerunDimension {
  dimension: string;
  loomScore: ToonValue;
  gstackScore: ToonValue;
}

export interface Rerun {
  rubricRef: string;
  overall: ToonValue;
  dimensions: RerunDimension[];
}

export type GateOutcome = "pass" | "below-target" | "refused" | "pending";

export interface TrailingDimension {
  dimension: string;
  loomScore: number;
  gstackScore: number;
  delta: number;
  milestone: string;
  fixFeatures: string;
}

export interface GateEvaluation {
  outcome: GateOutcome;
  reason: string;
  /** Numeric rerun overall once evaluable, else null. */
  overall: number | null;
  gstackOverall: number;
  overallPass: boolean;
  /** Every dimension whose delta < 0, with its loop-back target. */
  trailing: TrailingDimension[];
  /** 0 only for a PASS; 2 otherwise. */
  exitCode: number;
}

/* ────────────────────────────────────────────────────────────────────────
 * Pure gate — no I/O, fully unit-testable
 * ──────────────────────────────────────────────────────────────────────── */

function isFiniteNumber(v: ToonValue): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Decide the gate outcome from an already-parsed baseline + rerun. Pure: given
 * the same inputs it always returns the same evaluation and never touches disk.
 */
export function evaluateGate(baseline: Baseline, rerun: Rerun): GateEvaluation {
  const gstackOverall = baseline.gstackOverall;
  const fail = (outcome: GateOutcome, reason: string): GateEvaluation => ({
    outcome,
    reason,
    overall: isFiniteNumber(rerun.overall) ? rerun.overall : null,
    gstackOverall,
    overallPass: false,
    trailing: [],
    exitCode: 2,
  });

  // 1. Anti-drift: the rerun must cite the exact pinned baseline path (C-09).
  if (rerun.rubricRef !== baseline.rubricRef) {
    return fail(
      "refused",
      `rubricRef mismatch: rerun cites "${rerun.rubricRef}" but the pinned baseline is "${baseline.rubricRef}". The rerun must re-run the SAME rubric (C-09).`,
    );
  }

  const baselineByDim = new Map(baseline.dimensions.map((d) => [d.dimension, d]));
  const rerunByDim = new Map(rerun.dimensions.map((d) => [d.dimension, d]));

  // 2. Every pinned dimension must be present in the rerun.
  const missing = baseline.dimensions
    .filter((d) => !rerunByDim.has(d.dimension))
    .map((d) => d.dimension);
  if (missing.length > 0) {
    return fail(
      "refused",
      `rerun is missing pinned dimension(s): ${missing.join(", ")}. All ${baseline.dimensions.length} baseline dimensions must be scored.`,
    );
  }

  // 3. gstack must NOT be re-scored — every rerun gstackScore must match the pin.
  for (const bd of baseline.dimensions) {
    const rd = rerunByDim.get(bd.dimension)!;
    if (isFiniteNumber(rd.gstackScore) && rd.gstackScore !== bd.gstackScore) {
      return fail(
        "refused",
        `gstackScore for "${bd.dimension}" was altered (${rd.gstackScore} vs pinned ${bd.gstackScore}). gstack is never re-scored (C-09).`,
      );
    }
  }

  // 4. Placeholder guard — the rerun still holds non-numeric (pending) scores.
  const pendingDims = baseline.dimensions
    .filter((bd) => !isFiniteNumber(rerunByDim.get(bd.dimension)!.loomScore))
    .map((bd) => bd.dimension);
  if (pendingDims.length > 0 || !isFiniteNumber(rerun.overall)) {
    const parts: string[] = [];
    if (pendingDims.length > 0) parts.push(`dimensions [${pendingDims.join(", ")}]`);
    if (!isFiniteNumber(rerun.overall)) parts.push("overall");
    return fail(
      "pending",
      `rerun still holds placeholder scores for ${parts.join(" and ")}. The 4-agent comparative review must fill real Loom scores before the gate can evaluate.`,
    );
  }

  // 5. Deltas + overall. Everything below here has numeric scores.
  const loopByDim = new Map(baseline.loopBack.map((l) => [l.dimension, l]));
  const trailing: TrailingDimension[] = [];
  for (const bd of baseline.dimensions) {
    const rd = rerunByDim.get(bd.dimension)!;
    const loomScore = rd.loomScore as number;
    const delta = loomScore - bd.gstackScore;
    if (delta < 0) {
      const lb = loopByDim.get(bd.dimension);
      trailing.push({
        dimension: bd.dimension,
        loomScore,
        gstackScore: bd.gstackScore,
        delta,
        milestone: lb?.milestone ?? "n/a",
        fixFeatures: lb?.fixFeatures ?? "(no mapped fix-feature — investigate manually)",
      });
    }
  }

  const overall = rerun.overall as number;
  const overallPass = overall > gstackOverall;

  if (trailing.length === 0 && overallPass) {
    return {
      outcome: "pass",
      reason: `All ${baseline.dimensions.length} dimensions ≥ gstack and overall ${overall} > ${gstackOverall}.`,
      overall,
      gstackOverall,
      overallPass,
      trailing,
      exitCode: 0,
    };
  }

  const reasons: string[] = [];
  if (trailing.length > 0) {
    reasons.push(`${trailing.length} dimension(s) trailing gstack`);
  }
  if (!overallPass) {
    reasons.push(`overall ${overall} ≤ gstack floor ${gstackOverall}`);
  }
  return {
    outcome: "below-target",
    reason: reasons.join("; "),
    overall,
    gstackOverall,
    overallPass,
    trailing,
    exitCode: 2,
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * TOON readers (parseToon only — no hand-rolled parsing, C-02)
 * ──────────────────────────────────────────────────────────────────────── */

function asObject(v: ToonValue): { [k: string]: ToonValue } {
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    return v as { [k: string]: ToonValue };
  }
  throw new Error("expected a TOON object");
}

function asArray(v: ToonValue): ToonValue[] {
  if (Array.isArray(v)) return v;
  throw new Error("expected a TOON array");
}

function reqString(o: { [k: string]: ToonValue }, key: string): string {
  const v = o[key];
  if (typeof v !== "string") throw new Error(`expected string field "${key}"`);
  return v;
}

function reqNumber(o: { [k: string]: ToonValue }, key: string): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`expected numeric field "${key}"`);
  }
  return v;
}

/** Parse + normalize the pinned baseline rubric. */
export function loadBaseline(file: string): Baseline {
  const root = asObject(parseToon(fs.readFileSync(file, "utf8")));
  const dimensions: BaselineDimension[] = asArray(root.dimensions).map((row) => {
    const r = asObject(row);
    return {
      dimension: reqString(r, "dimension"),
      gstackScore: reqNumber(r, "gstackScore"),
      verdict: typeof r.verdict === "string" ? r.verdict : "",
      recorded: r.recorded === true,
    };
  });
  const loopBack: BaselineLoopBack[] = asArray(root.loopBack ?? []).map((row) => {
    const r = asObject(row);
    return {
      dimension: reqString(r, "dimension"),
      milestone: reqString(r, "milestone"),
      fixFeatures: reqString(r, "fixFeatures"),
    };
  });
  return {
    rubricRef: reqString(root, "rubricRef"),
    gstackOverall: reqNumber(root, "gstackOverall"),
    dimensions,
    loopBack,
  };
}

/** Parse + normalize the rerun scorecard (scores may still be `pending`). */
export function loadRerun(file: string): Rerun {
  const root = asObject(parseToon(fs.readFileSync(file, "utf8")));
  const dimensions: RerunDimension[] = asArray(root.dimensions).map((row) => {
    const r = asObject(row);
    return {
      dimension: reqString(r, "dimension"),
      loomScore: r.loomScore,
      gstackScore: r.gstackScore,
    };
  });
  return {
    rubricRef: reqString(root, "rubricRef"),
    overall: root.overall,
    dimensions,
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * CLI
 * ──────────────────────────────────────────────────────────────────────── */

function parseFlag(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Render an evaluation to stderr/stdout and return its exit code. */
export function reportEvaluation(evalResult: GateEvaluation): number {
  const w = evalResult.exitCode === 0 ? process.stdout : process.stderr;
  if (evalResult.outcome === "pass") {
    w.write(`SCORECARD_GATE_PASS: ${evalResult.reason}\n`);
    return 0;
  }
  const tag =
    evalResult.outcome === "refused"
      ? "SCORECARD_GATE_REFUSED"
      : evalResult.outcome === "pending"
        ? "SCORECARD_GATE_PENDING"
        : "SCORECARD_BELOW_TARGET";
  w.write(`${tag}: ${evalResult.reason}\n`);
  if (evalResult.trailing.length > 0) {
    w.write("Trailing dimensions (loop back to the responsible milestone):\n");
    for (const t of evalResult.trailing) {
      w.write(
        `  - ${t.dimension}: loom ${t.loomScore} < gstack ${t.gstackScore} ` +
          `(delta ${t.delta}) -> ${t.milestone} [${t.fixFeatures}]\n`,
      );
    }
  }
  if (evalResult.outcome === "below-target" && !evalResult.overallPass && evalResult.overall !== null) {
    w.write(
      `  - overall ${evalResult.overall} must exceed gstack floor ${evalResult.gstackOverall}\n`,
    );
  }
  return evalResult.exitCode;
}

export function main(argv: string[], repoRoot: string = process.cwd()): number {
  const baselinePath = path.resolve(
    repoRoot,
    parseFlag(argv, "--baseline") ?? BASELINE_REL_PATH,
  );
  const rerunPath = path.resolve(repoRoot, parseFlag(argv, "--rerun") ?? RERUN_REL_PATH);

  let baseline: Baseline;
  let rerun: Rerun;
  try {
    baseline = loadBaseline(baselinePath);
  } catch (err) {
    process.stderr.write(`scorecard-gate: cannot read baseline ${baselinePath}: ${(err as Error).message}\n`);
    return 3;
  }
  try {
    rerun = loadRerun(rerunPath);
  } catch (err) {
    process.stderr.write(`scorecard-gate: cannot read rerun ${rerunPath}: ${(err as Error).message}\n`);
    return 3;
  }

  return reportEvaluation(evaluateGate(baseline, rerun));
}

if (isMain(import.meta)) {
  process.exit(main(process.argv.slice(2)));
}
