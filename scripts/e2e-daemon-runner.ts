/**
 * loom-browser daemon e2e runner — structured-action executor (PLAN-browser-e2e, P3).
 *
 * Consumes e2e-story steps written in the DAEMON-MODE STRUCTURED ACTION GRAMMAR
 * (the C-03 addendum in protocols/e2e-story.schema.md) and drives the daemon
 * through the browser-client exec layer (execRead / execWrite), producing the
 * EXISTING e2e DeltaReport shape (agents/e2e-runner-agent.md:159-183).
 *
 * This is NOT a prose NLP interpreter. Each `action` string is a single verb
 * line that parses deterministically into a BrowserCommand:
 *
 *   navigate <url>                    → verb navigate (WRITE)
 *   click <a11y-ref-json>             → verb click (WRITE)
 *   type <a11y-ref-json> <text>       → verb type (WRITE), args.text = <text>
 *   assert-text <text>                → READ (dom-query on body) + text-contains assertion
 *   assert-visible <a11y-ref-json>    → verb is-visible (READ), green iff visible
 *   screenshot                        → verb screenshot (READ), captures for the audit trail
 *
 * An unrecognized leading verb or malformed a11y-ref JSON is a STORY_PARSE_ERROR
 * — the executor NEVER falls back to prose interpretation (grammar note in the
 * addendum). A step that does not parse fails; subsequent steps are `skipped`.
 *
 * OWNERSHIP: this module is an INTERNAL LIBRARY for P4a's e2e-runner session
 * mode (sessionMode: daemon). It is NOT a standalone DeltaReport writer — the
 * e2e-runner-agent remains the sole writer to
 * `.plan-execution/convergence/e2e/delta-report.toon`. `runE2EDaemon` returns
 * the report and, only when an explicit `outPath` is provided, writes it there
 * (tests point that at a tempdir). This resolves the sole-writer conflict at
 * e2e-runner-agent.md:155.
 *
 * Types are imported from lib/types.ts (Wave-0 source of truth) and the exec
 * layer from scripts/lib/browser-client.ts (Waves 1-2) — nothing is redeclared.
 */

import {
  execRead as realExecRead,
  execWrite as realExecWrite,
  BrowserClientError,
  type BrowserSession,
} from "./lib/browser-client.js";
import type {
  A11yRef,
  BrowserCommand,
  BrowserErrorCode,
  BrowserResult,
} from "../lib/types.js";
import { serializeToon, atomicWrite, type ToonValue } from "../lib/index.js";

/* ────────────────────────────────────────────────────────────────────────
 * Story shape (subset). P4a parses on-disk YAML into this shape and hands it
 * in-process; hermetic tests construct it directly. Only the fields the daemon
 * executor reads are typed here — the full E2EStory schema lives in
 * protocols/e2e-story.schema.md.
 * ──────────────────────────────────────────────────────────────────────── */

export interface DaemonStoryStep {
  /** Structured-action-grammar line (NOT prose). */
  action: string;
  /** Human-readable expected outcome; surfaced in failure details. */
  expected: string;
  /** Optional per-step timeout in ms; overrides the command default. */
  stepTimeout?: number;
}

export interface DaemonStory {
  name: string;
  url?: string;
  /** Criterion IDs this story verifies; the first seeds the DeltaReport row id. */
  criteriaRefs?: string[];
  steps: DaemonStoryStep[];
  storyTimeout?: number;
}

/* ────────────────────────────────────────────────────────────────────────
 * Injectable exec layer. Defaults to the real browser-client dispatchers;
 * hermetic tests inject fakes so a story resolves to pass/fail with no live
 * daemon (P2's fixture server + P4a's live wiring exercise the real path).
 * ──────────────────────────────────────────────────────────────────────── */

export interface DaemonExec {
  execRead(session: BrowserSession, command: BrowserCommand): Promise<BrowserResult>;
  execWrite(session: BrowserSession, command: BrowserCommand): Promise<BrowserResult>;
}

/** Real exec layer — attaches through the P1a/P1b browser client. */
export const defaultDaemonExec: DaemonExec = {
  execRead: (session, command) => realExecRead(session, command),
  execWrite: (session, command) => realExecWrite(session, command),
};

/* ────────────────────────────────────────────────────────────────────────
 * Structured-action parser (criterion 1). Deterministic; never guesses.
 * ──────────────────────────────────────────────────────────────────────── */

/** The six closed action kinds of the daemon-mode grammar. */
export type ActionKind =
  | "navigate"
  | "click"
  | "type"
  | "assert-text"
  | "assert-visible"
  | "screenshot";

export interface ParsedAction {
  kind: ActionKind;
  /** The BrowserCommand this action compiles to. */
  command: BrowserCommand;
  /** For assert-text only: the substring the page text must contain. */
  assertText?: string;
}

function parseError(message: string): BrowserClientError {
  return new BrowserClientError("STORY_PARSE_ERROR", message);
}

function isA11yRefShape(v: unknown): v is A11yRef {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as A11yRef).role === "string" &&
    typeof (v as A11yRef).name === "string" &&
    typeof (v as A11yRef).index === "number"
  );
}

/** Parse a whole trimmed string as an A11yRef JSON object. */
function parseA11yRef(json: string): A11yRef {
  const trimmed = json.trim();
  if (!trimmed) throw parseError("Expected an a11y-ref JSON object but found nothing.");
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    throw parseError(`Malformed a11y-ref JSON: ${JSON.stringify(trimmed)}`);
  }
  if (!isA11yRefShape(value)) {
    throw parseError(
      `a11y-ref JSON must be {"role":..,"name":..,"index":..}: ${JSON.stringify(trimmed)}`
    );
  }
  return value;
}

/**
 * Scan a leading `{...}` JSON object out of `s` (quote/escape aware), returning
 * the index of the matching closing brace. Used by `type`, whose `<text>` is
 * the remainder of the line after the a11y-ref JSON.
 */
function scanJsonObjectEnd(s: string): number {
  if (s[0] !== "{") {
    throw parseError("Expected an a11y-ref JSON object starting with '{'.");
  }
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw parseError("Unterminated a11y-ref JSON object.");
}

/**
 * Parse a single structured-action-grammar line into a ParsedAction.
 * @throws BrowserClientError(STORY_PARSE_ERROR) on an unrecognized verb,
 *   a missing operand, or malformed a11y-ref JSON. Never falls back to prose.
 */
export function parseAction(action: string): ParsedAction {
  const line = action.trim();
  if (!line) throw parseError("Empty action line.");

  const wsIndex = line.search(/\s/);
  const keyword = wsIndex === -1 ? line : line.slice(0, wsIndex);
  const rest = wsIndex === -1 ? "" : line.slice(wsIndex + 1);

  switch (keyword) {
    case "navigate": {
      const url = rest.trim();
      if (!url) throw parseError("navigate requires a URL: `navigate <url>`.");
      return { kind: "navigate", command: { verb: "navigate", tier: "write", target: url } };
    }

    case "click": {
      const ref = parseA11yRef(rest);
      return { kind: "click", command: { verb: "click", tier: "write", target: ref } };
    }

    case "type": {
      const tail = rest.trimStart();
      const end = scanJsonObjectEnd(tail);
      const ref = parseA11yRef(tail.slice(0, end + 1));
      // The literal text is everything after the a11y-ref JSON (one separating
      // space stripped); the remainder is used verbatim.
      const text = tail.slice(end + 1).replace(/^\s/, "");
      return {
        kind: "type",
        command: { verb: "type", tier: "write", target: ref, args: { text } },
      };
    }

    case "assert-text": {
      const text = rest.trim();
      if (!text) throw parseError("assert-text requires text: `assert-text <text>`.");
      // Compiles to a READ over page text (dom-query on the body element); the
      // assertion is a substring-contains check against the returned text.
      return {
        kind: "assert-text",
        command: { verb: "dom-query", tier: "read", target: "body" },
        assertText: text,
      };
    }

    case "assert-visible": {
      const ref = parseA11yRef(rest);
      return {
        kind: "assert-visible",
        command: { verb: "is-visible", tier: "read", target: ref },
      };
    }

    case "screenshot": {
      return { kind: "screenshot", command: { verb: "screenshot", tier: "read" } };
    }

    default:
      throw parseError(
        `Unrecognized action verb ${JSON.stringify(keyword)}. ` +
          `The daemon executor accepts only: navigate, click, type, assert-text, assert-visible, screenshot.`
      );
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * Story execution (criteria 1-3).
 * ──────────────────────────────────────────────────────────────────────── */

export type StepStatus = "pass" | "fail" | "skipped";

export interface DaemonStepResult {
  index: number;
  action: string;
  status: StepStatus;
  details: string;
  /** Present on a failure that carried a browser/parse error code. */
  errorCode?: BrowserErrorCode;
}

export interface DaemonStoryResult {
  name: string;
  passed: boolean;
  steps: DaemonStepResult[];
  screenshotPaths: string[];
  /** 0-based index of the first failing step, or undefined when all passed. */
  failingStepIndex?: number;
}

interface StepOutcome {
  status: StepStatus;
  details: string;
  errorCode?: BrowserErrorCode;
  screenshotPath?: string;
}

async function executeParsed(
  parsed: ParsedAction,
  session: BrowserSession,
  exec: DaemonExec,
  expected: string
): Promise<StepOutcome> {
  const { kind, command } = parsed;
  const result =
    command.tier === "write"
      ? await exec.execWrite(session, command)
      : await exec.execRead(session, command);

  if (!result.ok) {
    return {
      status: "fail",
      errorCode: result.error?.code,
      details: `${command.verb} failed: ${result.error?.message ?? "unknown error"}`,
    };
  }

  switch (kind) {
    case "navigate":
    case "click":
    case "type":
      return { status: "pass", details: `${kind} ok` };

    case "screenshot": {
      const p = typeof result.data?.["path"] === "string" ? (result.data["path"] as string) : undefined;
      return { status: "pass", details: "screenshot captured", screenshotPath: p };
    }

    case "assert-visible": {
      const visible = result.data?.["visible"] === true;
      return visible
        ? { status: "pass", details: "element is visible" }
        : {
            status: "fail",
            details: `assert-visible failed: element is not visible (expected: ${expected})`,
          };
    }

    case "assert-text": {
      const pageText = String(result.data?.["text"] ?? result.data?.["html"] ?? "");
      const needle = parsed.assertText ?? "";
      return pageText.includes(needle)
        ? { status: "pass", details: `page text contains ${JSON.stringify(needle)}` }
        : {
            status: "fail",
            details: `assert-text failed: page text does not contain ${JSON.stringify(needle)} (expected: ${expected})`,
          };
    }
  }
}

/**
 * Run a single daemon-mode story against a live session. Parses each step's
 * structured action, drives the exec layer, and evaluates assertions. On the
 * FIRST failing step (parse error, WRITE failure, or a red assertion) the
 * remaining steps are marked `skipped` and the story is `passed: false`.
 *
 * @param exec injectable exec layer — defaults to the real browser client.
 *   Hermetic tests pass a fake so no daemon/Chromium is required.
 * @throws never — a parse error becomes a failed step, not a thrown error.
 */
export async function runDaemonStory(
  story: DaemonStory,
  session: BrowserSession,
  exec: DaemonExec = defaultDaemonExec
): Promise<DaemonStoryResult> {
  const steps: DaemonStepResult[] = [];
  const screenshotPaths: string[] = [];
  let failingStepIndex: number | undefined;

  for (let i = 0; i < story.steps.length; i++) {
    const raw = story.steps[i];

    // Once a step has failed, every subsequent step is `skipped` (schema Rule:
    // e2e-runner marks downstream steps skipped on a failure).
    if (failingStepIndex !== undefined) {
      steps.push({ index: i, action: raw.action, status: "skipped", details: "skipped after a prior step failed" });
      continue;
    }

    let parsed: ParsedAction;
    try {
      parsed = parseAction(raw.action);
    } catch (err) {
      const errorCode: BrowserErrorCode =
        err instanceof BrowserClientError ? err.code : "STORY_PARSE_ERROR";
      steps.push({
        index: i,
        action: raw.action,
        status: "fail",
        errorCode,
        details: `parse error: ${(err as Error).message}`,
      });
      failingStepIndex = i;
      continue;
    }

    // Per-step timeout overrides the command default when present.
    const timeout = raw.stepTimeout ?? story.storyTimeout;
    if (typeof timeout === "number") parsed.command.timeoutMs = timeout;

    const outcome = await executeParsed(parsed, session, exec, raw.expected);
    steps.push({
      index: i,
      action: raw.action,
      status: outcome.status,
      details: outcome.details,
      errorCode: outcome.errorCode,
    });
    if (outcome.screenshotPath) screenshotPaths.push(outcome.screenshotPath);
    if (outcome.status === "fail") failingStepIndex = i;
  }

  return {
    name: story.name,
    passed: failingStepIndex === undefined,
    steps,
    screenshotPaths,
    failingStepIndex,
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * DeltaReport emission (criterion 2) — REUSE the existing e2e shape
 * (agents/e2e-runner-agent.md:159-183). One story ⇒ one criterion row.
 * ──────────────────────────────────────────────────────────────────────── */

export interface DeltaCriterionRow {
  id: string;
  name: string;
  type: string;
  passed: boolean;
  findingCount: number;
  blockingCount: number;
  details: string;
}

export interface DeltaReport {
  timestamp: string;
  convergenceMode: string;
  tier: "e2e";
  totalCriteria: number;
  passing: number;
  failing: number;
  criteria: DeltaCriterionRow[];
  screenshotPaths: string[];
  consoleDumpPaths: string[];
}

function describeStory(result: DaemonStoryResult): string {
  if (result.passed) return `All ${result.steps.length} steps pass`;
  const idx = result.failingStepIndex ?? 0;
  const failing = result.steps[idx];
  return `Failed at step ${idx + 1}: ${failing?.details ?? "unknown failure"}`;
}

/** Build a DeltaReport from already-run story results (pure — no I/O). */
export function buildDeltaReport(results: DaemonStoryResult[], stories: DaemonStory[]): DeltaReport {
  const criteria: DeltaCriterionRow[] = results.map((r, i) => ({
    id: stories[i]?.criteriaRefs?.[0] ?? `C-E2E-${String(i + 1).padStart(2, "0")}`,
    name: r.name,
    type: "hard",
    passed: r.passed,
    findingCount: r.passed ? 0 : 1,
    blockingCount: r.passed ? 0 : 1,
    details: describeStory(r),
  }));
  const passing = criteria.filter((c) => c.passed).length;
  return {
    timestamp: new Date().toISOString(),
    convergenceMode: "criteria",
    tier: "e2e",
    totalCriteria: criteria.length,
    passing,
    failing: criteria.length - passing,
    criteria,
    screenshotPaths: results.flatMap((r) => r.screenshotPaths),
    consoleDumpPaths: [],
  };
}

/** Serialize a DeltaReport to canonical TOON (reuses lib/toon serializeToon). */
export function serializeDeltaReport(report: DeltaReport): string {
  // The report is already a ToonValue-compatible object graph (scalars, string
  // arrays, and a uniform-object criteria table); serializeToon renders the
  // criteria rows as the `criteria[N]{...}:` typed-array table.
  return serializeToon(report as unknown as ToonValue);
}

/**
 * Run a set of daemon-mode stories and produce the e2e DeltaReport.
 *
 * Writes the report to `options.outPath` ONLY when that path is provided. This
 * module is an internal library for P4a's session mode, NOT a standalone
 * writer to `.plan-execution/convergence/e2e/delta-report.toon` — the
 * e2e-runner-agent remains the sole writer of that canonical path. Tests point
 * `outPath` at a tempdir; production callers (P4a) read the returned report and
 * let the e2e-runner-agent own the canonical write.
 *
 * @returns the DeltaReport (also written to outPath when supplied).
 */
export async function runE2EDaemon(
  stories: DaemonStory[],
  session: BrowserSession,
  exec: DaemonExec = defaultDaemonExec,
  options: { outPath?: string } = {}
): Promise<DeltaReport> {
  const results: DaemonStoryResult[] = [];
  for (const story of stories) {
    results.push(await runDaemonStory(story, session, exec));
  }
  const report = buildDeltaReport(results, stories);
  if (options.outPath) {
    atomicWrite(options.outPath, serializeDeltaReport(report));
  }
  return report;
}
