/**
 * scripts/lib/think-review-router.ts
 *
 * The pre-plan thinking-review router — the deterministic, fail-closed core of
 * the thinking gate at the divergent→formality seam (PLAN-thinking-gate, C-02).
 *
 * `routeThinkReview` is a PURE function: given a lens panel's `findings[]`, the
 * resolved `PrePlanLensPanel`, and how many lenses actually reported, it emits
 * exactly one `ThinkReviewVerdict` per the normative decision table in
 * `protocols/think-review.schema.md § Decision Table (C-02)`. No I/O, no ambient
 * clock (an injectable `now()` is the only time source), no fs, no argv.
 *
 * Types are imported from `lib/types.ts` (Wave-0 source of truth) — NOT
 * re-declared here (see CLAUDE.md "Model resolution" / Wave-0 contract rules).
 *
 * ── The decision (precedence, most-authoritative first) ────────────────────
 *   1. FAIL-CLOSED FIRST. If quorum is not met (too few lenses reported, or a
 *      malformed/empty-because-crashed panel), synthesize `PANEL_INCOMPLETE`
 *      as a blocking condition and route to `rewrite-think`. This OUTRANKS a
 *      non-fixable blocking finding: a terminal `kill` must never be decided on
 *      sub-quorum (untrusted) evidence — kill halts the pipeline, so on
 *      incomplete evidence we loop, never terminate. NEVER `proceed`.
 *   2. KILL. Quorum met AND any `blocking` finding has `fixable === false` →
 *      `kill` (fatal approach error, no fix within this framing).
 *   3. REWRITE-THINK. Quorum met AND (any `blocking` finding OR any `warning`
 *      finding) → `rewrite-think` (repairable defect — re-think and re-review).
 *   4. PROCEED. Quorum met AND zero blocking and zero warning findings →
 *      `proceed` (info findings do not gate).
 *
 * The schema's `decisionTable` is written top-to-bottom, but its "Precedence,
 * stated explicitly" section makes fail-closed rule 1 outrank the kill row; this
 * implementation follows that explicit precedence so a sub-quorum panel with a
 * non-fixable blocking loops (rewrite-think) rather than terminally killing.
 */

import type {
  PrePlanLensPanel,
  ThinkReviewFinding,
  ThinkReviewVerdict,
} from "../../lib/types.js";

/** Stable id stamped into every verdict this module produces. */
export const THINK_REVIEW_ROUTER_ID = "think-review-router";

/** Deterministic nextCommand strings — the schema's `nextCommandMap` verbatim. */
export const NEXT_COMMAND = {
  proceed: "/loom-roadmap init",
  /** Placeholder used when no concrete think-doc path is supplied. */
  rewriteThink: (doc: string) => `/loom-think --from ${doc}`,
  kill:
    "archive the think doc (.loom/thinks/archive/) — do NOT proceed to roadmap",
} as const;

/**
 * Caller-supplied context for a single routing decision. `reportingLenses` is
 * REQUIRED: the router cannot derive how many lenses actually reported from
 * `findings[]` alone (a lens that passed with zero findings is indistinguishable
 * from a lens that crashed). Forcing the caller to state it is what makes the
 * gate fail closed by construction — omission cannot be read as a silent quorum.
 */
export interface RouteThinkReviewOptions {
  /**
   * Number of lenses that actually reported a well-formed result. A lens that
   * crashed / timed out / returned a malformed envelope does NOT count. REQUIRED.
   */
  reportingLenses: number;
  /** 0-indexed count of prior rewrite loops for this think doc. @default 0 */
  revisionCount?: number;
  /**
   * Concrete think-doc path woven into the `rewrite-think` nextCommand
   * (`/loom-think --from <docPath>`). Falls back to the literal `<doc>`.
   */
  docPath?: string;
  /** Verdict attribution. @default THINK_REVIEW_ROUTER_ID */
  decidedBy?: string;
  /** Injected clock for `decidedAt`. Keeps the function pure/testable. */
  now?: () => Date;
}

/** `⌈n/2⌉` without floating-point surprises. */
function quorumThreshold(m: number): number {
  return Math.ceil(m / 2);
}

/**
 * Route a lens panel's findings to a single deterministic verdict.
 *
 * Pure and fail-closed: no-quorum, a crashed/empty panel, or malformed input all
 * route to `rewrite-think` with `errorCode: "PANEL_INCOMPLETE"` — NEVER `proceed`.
 *
 * @param findings  Findings across the reporting lenses (may be empty).
 * @param panel     Resolved archetype→lens panel; `activeLenses.length` is M.
 * @param opts      Routing context; `reportingLenses` is required (see type).
 */
export function routeThinkReview(
  findings: ThinkReviewFinding[],
  panel: PrePlanLensPanel,
  opts: RouteThinkReviewOptions,
): ThinkReviewVerdict {
  const decidedBy = opts.decidedBy ?? THINK_REVIEW_ROUTER_ID;
  const revisionCount = Number.isInteger(opts.revisionCount)
    ? (opts.revisionCount as number)
    : 0;
  const now = opts.now ?? (() => new Date());
  const decidedAt = now().toISOString();
  const doc = opts.docPath && opts.docPath.length > 0 ? opts.docPath : "<doc>";

  // ── Panel size M (fail closed on a malformed / empty panel) ──────────────
  const activeLenses = Array.isArray(panel?.activeLenses)
    ? panel.activeLenses
    : [];
  const panelSize = activeLenses.length;

  // reportingLenses is clamped to a sane non-negative integer; anything
  // malformed collapses to 0, which cannot meet quorum (fail closed).
  const reportingLenses =
    Number.isInteger(opts.reportingLenses) && opts.reportingLenses >= 0
      ? Math.min(opts.reportingLenses, panelSize)
      : 0;

  const findingsSafe = Array.isArray(findings) ? findings : [];

  // Quorum requires a real panel (M ≥ 1) AND enough reporting lenses.
  const quorumMet =
    panelSize >= 1 && reportingLenses >= quorumThreshold(panelSize);

  const base = {
    decidedBy,
    revisionCount,
    panelSize,
    reportingLenses,
    findings: findingsSafe,
    decidedAt,
  };

  // ── Rule 1: FAIL-CLOSED FIRST ────────────────────────────────────────────
  // No quorum (or a malformed/crashed/empty panel) → treat PANEL_INCOMPLETE as
  // a synthetic blocking condition and loop. Outranks kill: never terminate on
  // untrusted sub-quorum evidence.
  if (!quorumMet) {
    return {
      ...base,
      decision: "rewrite-think",
      nextCommand: NEXT_COMMAND.rewriteThink(doc),
      quorumMet: false,
      errorCode: "PANEL_INCOMPLETE",
    };
  }

  // Quorum met — inspect the findings. Only `blocking` / `warning` gate;
  // `info` (and any non-gating severity) never blocks proceed.
  const hasNonFixableBlocking = findingsSafe.some(
    (f) => f?.severity === "blocking" && f?.fixable === false,
  );
  const hasBlocking = findingsSafe.some((f) => f?.severity === "blocking");
  const hasWarning = findingsSafe.some((f) => f?.severity === "warning");

  // ── Rule 2: KILL (kill outranks rewrite) ─────────────────────────────────
  if (hasNonFixableBlocking) {
    return {
      ...base,
      decision: "kill",
      nextCommand: NEXT_COMMAND.kill,
      quorumMet: true,
      errorCode: null,
    };
  }

  // ── Rule 3: REWRITE-THINK (any fixable blocking OR any warning) ──────────
  if (hasBlocking || hasWarning) {
    return {
      ...base,
      decision: "rewrite-think",
      nextCommand: NEXT_COMMAND.rewriteThink(doc),
      quorumMet: true,
      errorCode: null,
    };
  }

  // ── Rule 4: PROCEED (quorum met, no blocking, no warning) ────────────────
  return {
    ...base,
    decision: "proceed",
    nextCommand: NEXT_COMMAND.proceed,
    quorumMet: true,
    errorCode: null,
  };
}
