/**
 * scripts/eval/tiers/qa-outcome.ts — ground-truth outcome eval tier (P8a).
 *
 * Ported from gstack's planted-bug outcome eval. The tier drives ≥2 planted-bug
 * fixtures (static + SPA/flow) through the /loom-browser daemon, produces a QA
 * report (the detections a QA agent would surface), then scores that report
 * against a ground-truth fixture with PER-category, PER-severity detection —
 * not a single global pass/fail. Per-category `floor`/`max` thresholds live in
 * the ground-truth fixture (evals/fixtures/qa-ground-truth.toon), joined at
 * scoring time.
 *
 * Gating mirrors t3-judge.ts EXACTLY (scripts/eval/tiers/t3-judge.ts:132-146):
 *   - LOOM_EVAL_LLM unset      -> status `skipped`, exit 0, zero llmCalls, with
 *     an ACTIONABLE skip reason (a QA report needs an LLM to interpret the
 *     driven page, so the tier is opt-in behind the same flag as T3).
 *   - flag set but no reporter  -> status `skipped` (advisory), exit 0.
 *
 * The QA reporter is injected via a seam (`opts.reporter`) so tests mock it —
 * there is NEVER a live network call (nor a live Chromium drive) in the test
 * suite. The real drive path (`driveFixture`) is exercised in the nightly CI
 * job P9a wires later.
 *
 * IMPORTANT (ownership): this module is NOT registered into run-evals.ts or the
 * EvalTier union — P8b (Wave 4) owns that. The signature MIRRORS the other tier
 * modules (`runT3` etc.): `run*(opts): Promise<TierRunOutput>`.
 *
 * Contract: protocols/outcome-eval.schema.md (OutcomeEval / OutcomeCategoryRow).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseToon, serializeToon, atomicWrite } from "../../../lib/index.js";
import type {
  OutcomeCategoryRow,
  OutcomeEval,
  OutcomeSeverity,
  ToonValue,
} from "../../../lib/index.js";
import type { TierRunOutput } from "../run-evals.js";
import {
  connect,
  execRead,
  execWrite,
  type BrowserSession,
} from "../../lib/browser-client.js";
import type { BrowserCommand } from "../../../lib/types.js";

/* ────────────────────────────────────────────────────────────────────────
 * Ground truth (planted bugs + thresholds) — parsed from the fixture.
 * ──────────────────────────────────────────────────────────────────────── */

/** One deliberately planted bug the QA drive is expected to detect. */
export interface PlantedBug {
  category: string;
  severity: OutcomeSeverity;
  selector: string;
  expectedDetection: string;
}

/** Per-category pass/fail thresholds (live in the ground-truth fixture). */
export interface CategoryThreshold {
  category: string;
  /** Minimum detectionRate for this category (0.0–1.0). */
  floor: number;
  /** Maximum falsePositives permitted in this category. */
  max: number;
}

export interface GroundTruth {
  plantedBugs: PlantedBug[];
  thresholds: CategoryThreshold[];
  /** Fixture pages the eval drives (from the fixture's `fixtures[]`). */
  fixtures: string[];
}

/* ────────────────────────────────────────────────────────────────────────
 * QA report — what the (LLM-backed) QA agent surfaces for a fixture.
 * ──────────────────────────────────────────────────────────────────────── */

/** One issue the QA agent reported for a fixture. */
export interface DetectedIssue {
  category: string;
  severity: OutcomeSeverity;
  /** Selector the issue was pinned to; used to disambiguate matches. */
  selector?: string;
}

export interface QaReport {
  fixture: string;
  issues: DetectedIssue[];
}

export interface QaReportInput {
  fixture: string;
  groundTruthRef: string;
}

/**
 * The QA-report seam. Tests inject a fixed stub (no network, no Chromium);
 * production wires a reporter that drives the fixture via `driveFixture` and
 * an LLM to interpret the observations into issues.
 */
export type QaReporter = (
  input: QaReportInput,
) => QaReport | Promise<QaReport>;

/* ────────────────────────────────────────────────────────────────────────
 * Scoring — the core of this tier (per-category, per-severity).
 * ──────────────────────────────────────────────────────────────────────── */

/** Per-category roll-up joined against the fixture's floor/max thresholds. */
export interface CategoryScore {
  category: string;
  detectionRate: number;
  falsePositives: number;
  floor: number;
  max: number;
  /** detectionRate >= floor AND falsePositives <= max. */
  passed: boolean;
}

export interface ScoredOutcome {
  outcomeEval: OutcomeEval;
  perCategoryScore: CategoryScore[];
  /** Every category passed its thresholds. */
  passed: boolean;
}

const SEVERITIES: readonly OutcomeSeverity[] = ["critical", "major", "minor"];

function toSeverity(raw: ToonValue): OutcomeSeverity {
  const s = String(raw ?? "").toLowerCase();
  return (SEVERITIES as string[]).includes(s)
    ? (s as OutcomeSeverity)
    : "minor";
}

function isRecord(v: ToonValue): v is { [k: string]: ToonValue } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Parse the ground-truth fixture (planted bugs + thresholds + fixtures). */
export function parseGroundTruth(fixturePath: string): GroundTruth {
  const parsed = parseToon(fs.readFileSync(fixturePath, "utf8"));
  if (!isRecord(parsed)) {
    throw new Error(`qa-outcome: ground truth ${fixturePath} is not a record`);
  }
  const bugsRaw = Array.isArray(parsed.plantedBugs) ? parsed.plantedBugs : [];
  const plantedBugs: PlantedBug[] = bugsRaw
    .filter(isRecord)
    .map((r) => ({
      category: String(r.category ?? ""),
      severity: toSeverity(r.severity),
      selector: String(r.selector ?? ""),
      expectedDetection: String(r.expectedDetection ?? ""),
    }))
    .filter((b) => b.category !== "");

  const thrRaw = Array.isArray(parsed.thresholds) ? parsed.thresholds : [];
  const thresholds: CategoryThreshold[] = thrRaw
    .filter(isRecord)
    .map((r) => ({
      category: String(r.category ?? ""),
      floor: Number(r.floor ?? 0),
      max: Number(r.max ?? 0),
    }))
    .filter((t) => t.category !== "");

  const fixturesRaw = Array.isArray(parsed.fixtures) ? parsed.fixtures : [];
  const fixtures = fixturesRaw.map((f) => String(f));

  return { plantedBugs, thresholds, fixtures };
}

/** A reported issue matches a planted bug on category, severity, and selector. */
function issueMatchesBug(issue: DetectedIssue, bug: PlantedBug): boolean {
  if (issue.category !== bug.category) return false;
  if (issue.severity !== bug.severity) return false;
  // Selector is a disambiguator: if BOTH sides pin a selector they must agree;
  // a report that omits the selector still matches on category+severity.
  if (issue.selector && bug.selector && issue.selector !== bug.selector) {
    return false;
  }
  return true;
}

/**
 * Score a set of QA reports against ground truth, computing per-category
 * detectionRate / falsePositives and joining the fixture's floor/max. Pure and
 * deterministic — the test calls this directly to assert the thresholds hold.
 */
export function scoreOutcome(args: {
  reports: QaReport[];
  groundTruth: GroundTruth;
  evalId: string;
  groundTruthRef: string;
}): ScoredOutcome {
  const { reports, groundTruth, evalId, groundTruthRef } = args;
  const issues = reports.flatMap((r) => r.issues);
  const bugs = groundTruth.plantedBugs;

  // perCategory rows: one per (category, severity) group, in fixture order.
  const perCategory: OutcomeCategoryRow[] = [];
  const seen = new Set<string>();
  for (const bug of bugs) {
    const key = `${bug.category} ${bug.severity}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const group = bugs.filter(
      (b) => b.category === bug.category && b.severity === bug.severity,
    );
    // Detected iff EVERY planted bug in the group is matched by some issue.
    const detected = group.every((b) =>
      issues.some((i) => issueMatchesBug(i, b)),
    );
    perCategory.push({ category: bug.category, severity: bug.severity, detected });
  }

  // Roll-ups. False positives = reported issues matching NO planted bug.
  const falsePositiveIssues = issues.filter(
    (i) => !bugs.some((b) => issueMatchesBug(i, b)),
  );
  const detectedBugs = bugs.filter((b) =>
    issues.some((i) => issueMatchesBug(i, b)),
  );
  const detectionRate =
    bugs.length === 0 ? 0 : detectedBugs.length / bugs.length;

  // Per-category scoring, joined against the fixture thresholds.
  const categories = [...new Set(bugs.map((b) => b.category))];
  const perCategoryScore: CategoryScore[] = categories.map((category) => {
    const catBugs = bugs.filter((b) => b.category === category);
    const catDetected = catBugs.filter((b) =>
      issues.some((i) => issueMatchesBug(i, b)),
    ).length;
    const rate = catBugs.length === 0 ? 0 : catDetected / catBugs.length;
    const catFp = falsePositiveIssues.filter(
      (i) => i.category === category,
    ).length;
    const thr = groundTruth.thresholds.find((t) => t.category === category);
    const floor = thr?.floor ?? 0;
    const max = thr?.max ?? 0;
    return {
      category,
      detectionRate: rate,
      falsePositives: catFp,
      floor,
      max,
      passed: rate >= floor && catFp <= max,
    };
  });

  const passed = perCategoryScore.every((c) => c.passed);

  const outcomeEval: OutcomeEval = {
    evalId,
    tier: "qa-outcome",
    status: passed ? "passed" : "failed",
    groundTruthRef,
    fixturesRun: reports.map((r) => r.fixture),
    perCategory,
    detectionRate,
    falsePositives: falsePositiveIssues.length,
  };

  return { outcomeEval, perCategoryScore, passed };
}

/* ────────────────────────────────────────────────────────────────────────
 * OutcomeEval serialization (TOON, per protocols/outcome-eval.schema.md).
 * ──────────────────────────────────────────────────────────────────────── */

/** Build the on-disk ToonValue for an OutcomeEval (root key `outcomeEval:`). */
export function outcomeToToon(e: OutcomeEval): ToonValue {
  return {
    outcomeEval: {
      evalId: e.evalId,
      tier: e.tier,
      status: e.status,
      groundTruthRef: e.groundTruthRef,
      fixturesRun: e.fixturesRun,
      perCategory: e.perCategory.map((r) => ({
        category: r.category,
        severity: r.severity,
        detected: r.detected,
      })),
      detectionRate: e.detectionRate,
      falsePositives: e.falsePositives,
      skipReason: e.skipReason ?? "",
    },
  };
}

/** Atomically write an OutcomeEval artifact; returns the absolute path. */
export function writeOutcome(e: OutcomeEval, outDir: string): string {
  const file = path.resolve(outDir, `${e.evalId}.toon`);
  atomicWrite(file, serializeToon(outcomeToToon(e)));
  return file;
}

/* ────────────────────────────────────────────────────────────────────────
 * Live daemon drive (P9a nightly path — NOT exercised in the hermetic test).
 *
 * Proves the fixtures are drivable through the /loom-browser daemon: attach
 * over CDP, navigate to the fixture, then collect the raw observations a
 * reporter's LLM would interpret (console entries + computed style + boxes).
 * The visual/overflow categories are detectable BECAUSE P1a added the
 * css / is-visible / bounding-box READ verbs.
 * ──────────────────────────────────────────────────────────────────────── */

export interface FixtureObservation {
  fixture: string;
  consoleEntries: unknown[];
  styles: Record<string, unknown>;
  boxes: Record<string, unknown>;
}

async function readVerb(
  session: BrowserSession,
  command: BrowserCommand,
): Promise<unknown> {
  const res = await execRead(session, command);
  return res.ok ? res.data : null;
}

/**
 * Drive one fixture through the daemon and return raw observations. Uses the
 * WRITE `navigate` verb and READ `console-log` / `css` / `bounding-box` verbs
 * from scripts/lib/browser-client.ts. Requires a live daemon (KNOWN-RUNTIME-GAP:
 * not runnable locally) — the hermetic test injects a reporter and never calls
 * this. P9a's nightly CI wires it to a live judge.
 */
export async function driveFixture(
  cdpEndpoint: string,
  fixtureUrl: string,
  selectors: string[],
): Promise<FixtureObservation> {
  const session = await connect(cdpEndpoint);
  try {
    await execWrite(session, {
      verb: "navigate",
      tier: "write",
      target: fixtureUrl,
    });
    const consoleData = await readVerb(session, {
      verb: "console-log",
      tier: "read",
    });
    const styles: Record<string, unknown> = {};
    const boxes: Record<string, unknown> = {};
    for (const selector of selectors) {
      styles[selector] = await readVerb(session, {
        verb: "css",
        tier: "read",
        target: selector,
        args: { property: "color" },
      });
      boxes[selector] = await readVerb(session, {
        verb: "bounding-box",
        tier: "read",
        target: selector,
      });
    }
    const consoleEntries =
      isRecord(consoleData as ToonValue) &&
      Array.isArray((consoleData as { entries?: unknown[] }).entries)
        ? ((consoleData as { entries: unknown[] }).entries)
        : [];
    return { fixture: fixtureUrl, consoleEntries, styles, boxes };
  } finally {
    await session.dispose();
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * Tier entry — gated on LOOM_EVAL_LLM (mirrors t3-judge.ts).
 * ──────────────────────────────────────────────────────────────────────── */

const DEFAULT_GROUND_TRUTH = "evals/fixtures/qa-ground-truth.toon";

const SKIP_REASON_NO_FLAG =
  "LOOM_EVAL_LLM unset — set it to run the scored qa-outcome eval " +
  "(the QA report needs an LLM to interpret the driven fixtures; T3 gate).";

const SKIP_REASON_NO_REPORTER =
  "LOOM_EVAL_LLM is set but no QA reporter is wired; qa-outcome skipped " +
  "(advisory). Wire a reporter (driveFixture + judge) to score detections.";

export interface RunQaOutcomeOptions {
  env?: NodeJS.ProcessEnv;
  /** Injected QA-report producer. Absent + flag set => advisory skip. */
  reporter?: QaReporter;
  /** Path to the ground-truth fixture (default DEFAULT_GROUND_TRUTH). */
  groundTruthPath?: string;
  /** Fixtures to drive; default = the fixture's `fixtures[]`. */
  fixtures?: string[];
  /** Where to write the OutcomeEval artifact (default: skip the write). */
  outDir?: string;
  /** Deterministic eval id (tests). */
  evalId?: string;
}

/**
 * Run the qa-outcome tier. Gated on `LOOM_EVAL_LLM`; returns a `TierRunOutput`
 * (same shape as runT1/runT2/runT3). When scored, also writes the OutcomeEval
 * artifact if `outDir` is provided.
 */
export async function runQaOutcome(
  opts: RunQaOutcomeOptions = {},
): Promise<TierRunOutput> {
  const env = opts.env ?? process.env;

  // Gate: flag unset -> skipped, terminal, zero cost (mirrors t3-judge.ts).
  if (!env.LOOM_EVAL_LLM) {
    return {
      status: "skipped",
      llmCalls: 0,
      results: [],
      floorRef: null,
      exitCode: 0,
      errorCode: null,
      warnings: [SKIP_REASON_NO_FLAG],
      judgedScore: null,
    };
  }

  // Flag set but no reporter wired: still advisory — skip rather than block.
  if (!opts.reporter) {
    return {
      status: "skipped",
      llmCalls: 0,
      results: [],
      floorRef: null,
      exitCode: 0,
      errorCode: null,
      warnings: [SKIP_REASON_NO_REPORTER],
      judgedScore: null,
    };
  }

  const groundTruthRef = opts.groundTruthPath ?? DEFAULT_GROUND_TRUTH;
  const groundTruth = parseGroundTruth(groundTruthRef);
  const fixtures =
    opts.fixtures ?? (groundTruth.fixtures.length > 0 ? groundTruth.fixtures : []);
  const evalId = opts.evalId ?? `qa-outcome-${Date.now()}`;

  const reporter = opts.reporter;
  const reports: QaReport[] = [];
  let llmCalls = 0;
  for (const fixture of fixtures) {
    reports.push(await reporter({ fixture, groundTruthRef }));
    llmCalls++; // each reporter pass is one (mocked) judge interpretation.
  }

  const scored = scoreOutcome({ reports, groundTruth, evalId, groundTruthRef });

  if (opts.outDir) writeOutcome(scored.outcomeEval, opts.outDir);

  const results = scored.perCategoryScore.map((c) => ({
    evalId: `qa-outcome-${c.category}`,
    outcome: c.passed ? ("passed" as const) : ("failed" as const),
    score: c.detectionRate,
    judgedScore: null,
  }));

  const warnings = scored.perCategoryScore
    .filter((c) => !c.passed)
    .map(
      (c) =>
        `qa-outcome[${c.category}]: detectionRate ${c.detectionRate.toFixed(2)} ` +
        `(floor ${c.floor}) falsePositives ${c.falsePositives} (max ${c.max})`,
    );

  return {
    status: scored.passed ? "passed" : "failed",
    llmCalls,
    results,
    floorRef: null,
    exitCode: scored.passed ? 0 : 1,
    errorCode: null,
    warnings,
    judgedScore: null,
  };
}
