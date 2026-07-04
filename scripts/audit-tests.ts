#!/usr/bin/env -S bunx tsx
/**
 * scripts/audit-tests.ts
 *
 * Tautological-test audit (M-07 F-12, C-11 first half, defect 7).
 *
 * Classifies every flagged suspect test into one of three buckets and records
 * the decision in a durable, re-runnable TOON ledger:
 *
 *   behavioral   — exercises real logic (input → observable output). KEEP.
 *   tautological — reimplements the code under test / asserts its own
 *                  construction. DELETE.
 *   prompt-grep  — asserts on the presence of strings in prompt/markdown/source
 *                  rather than on behavior. DELETE.
 *
 * The suspect set is a curated registry (below): the tests flagged during the
 * F-12 review because they carry an in-file `simulate*` harness or a verbatim
 * string fixture — the two surface signals of tautology. Each is classified
 * with EVIDENCE. Ambiguous cases are classified `behavioral` and retained
 * (conservative bias — a doubtful test keeps its place in the suite).
 *
 * State machine (protocols / PLAN §TautologicalTestAudit):
 *   suspect → classified → deleted   (never delete an unclassified suspect)
 * The audit row is written as the tombstone BEFORE the file is removed, so the
 * ledger is a stable historical record independent of what is on disk.
 *
 * Usage:
 *   bunx tsx scripts/audit-tests.ts                 # write the audit ledger
 *   bunx tsx scripts/audit-tests.ts --count-remaining
 *   bunx tsx scripts/audit-tests.ts --suspects <substr-or-glob>
 *
 * Exit codes:
 *   0  all suspects classified (ledger written) / --count-remaining printed
 *   1  unclassified suspects remain
 *   2  usage error
 *
 * Conventions: TOON ledger, deterministic body (fixed auditedAt epoch, registry
 * ordering — no wall-clock timestamps, no random ordering), atomic write.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteText, isMain } from "../lib/index.js";
import type {
  TestAuditAction,
  TestAuditRow,
  TestClassification,
  TautologicalTestAudit,
} from "../lib/index.js";

/** Ledger location, repo-relative. */
export const REPORT_REL_PATH = "planning/reports/test-audit.toon";

/**
 * Fixed audit epoch. The ledger is a durable tombstone record, so `auditedAt`
 * is a constant rather than a wall-clock read — this keeps a re-run byte-for-byte
 * identical (F-12 durable + re-runnable target).
 */
export const AUDIT_EPOCH = "2026-07-01T00:00:00Z";

export const VALID_CLASSIFICATIONS: readonly TestClassification[] = [
  "behavioral",
  "tautological",
  "prompt-grep",
];

/**
 * The flagged suspect set. Ordering here is the ledger's row ordering (stable).
 * Deletions carry action `deleted`; retained behavioral tests carry `retained`.
 */
export const SUSPECTS: readonly TestAuditRow[] = [
  {
    testPath: "tests/commands/loom-prototype.test.ts",
    classification: "tautological",
    evidence:
      "Defines an in-file simulateCompletionCeremony() that reimplements scripts/loom-prototype/completion-ceremony.ts and asserts against the copy; the production script is never exercised.",
    action: "deleted",
    replacedBy: null,
  },
  {
    testPath: "tests/regressions/stuck-at-loop-construction.test.ts",
    classification: "prompt-grep",
    evidence:
      "Builds stderr by joining the in-file UX_B2_LINES fixture then asserts stderr contains those same literals; no production code path runs — the test asserts its own construction.",
    action: "deleted",
    replacedBy: null,
  },
  {
    testPath: "tests/regressions/stuck-at-loop-construction-hitl.test.ts",
    classification: "prompt-grep",
    evidence:
      "Reads agents/convergence-driver.md and asserts verbatim markdown lines are present; a change-detector over prompt text that exercises no behavior.",
    action: "deleted",
    replacedBy: null,
  },
  {
    testPath: "tests/regressions/override-loop-gate-empty-reason.test.ts",
    classification: "behavioral",
    evidence:
      "simulateOverrideLoopGate runs the empty-reason gate over real TOON file I/O and asserts exit code, VALIDATION_ERROR, and that escapeReason stays null after rejection — emergent behavior, not self-assertion.",
    action: "retained",
    replacedBy: null,
  },
  {
    testPath: "tests/regressions/retired-loop-immutable.test.ts",
    classification: "behavioral",
    evidence:
      "Exercises retired-loop immutability against real fixture files; asserts the immutable-exit code and snapshot fields read back from disk after a re-retire attempt.",
    action: "retained",
    replacedBy: null,
  },
  {
    testPath: "tests/regressions/loom-converge-criteria-boundary.test.ts",
    classification: "behavioral",
    evidence:
      "Exercises criteria-mode boundary logic; asserts no loop files are created, the state-file contents, and the emitted convergence-plan stdout — observable outputs of the code path.",
    action: "retained",
    replacedBy: null,
  },
  {
    testPath: "tests/regressions/linked-loops-lint-typecheck.test.ts",
    classification: "behavioral",
    evidence:
      "Exercises sibling-loop linkage and lint/typecheck failure paths over real TOON mutations; asserts emergent file and state contents (sibling ids, verifiedRed flags, loop counts).",
    action: "retained",
    replacedBy: null,
  },
];

/** Simple `*`-glob / substring matcher for the optional --suspects filter. */
function matchesGlob(testPath: string, pattern: string): boolean {
  if (!pattern.includes("*")) return testPath.includes(pattern);
  const rx = new RegExp(
    "^" +
      pattern
        .split("*")
        .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*") +
      "$",
  );
  return rx.test(testPath);
}

/** Build the audit ledger from the (optionally filtered) suspect registry. */
export function buildAudit(opts: { suspects?: string } = {}): TautologicalTestAudit {
  const rows = opts.suspects
    ? SUSPECTS.filter((s) => matchesGlob(s.testPath, opts.suspects!))
    : [...SUSPECTS];
  return {
    auditedAt: AUDIT_EPOCH,
    suspectCount: rows.length,
    rows,
  };
}

/** CSV-encode one field, quoting when it carries a comma, quote, or newline. */
function csvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Render the audit as deterministic TOON (matches PLAN §TautologicalTestAudit). */
export function renderAuditToon(audit: TautologicalTestAudit): string {
  const lines: string[] = [];
  lines.push("testAudit:");
  lines.push(`  auditedAt: ${audit.auditedAt}`);
  lines.push(`  suspectCount: ${audit.suspectCount}`);
  lines.push(
    `  rows[${audit.rows.length}]{testPath,classification,evidence,action,replacedBy}:`,
  );
  for (const r of audit.rows) {
    const cells = [
      r.testPath,
      r.classification,
      csvField(r.evidence),
      r.action,
      r.replacedBy ?? "",
    ];
    lines.push(`    ${cells.join(",")}`);
  }
  return lines.join("\n") + "\n";
}

/** Suspects whose classification is not a valid enum member (unclassified). */
export function unclassifiedSuspects(
  audit: TautologicalTestAudit,
): TestAuditRow[] {
  return audit.rows.filter(
    (r) => !VALID_CLASSIFICATIONS.includes(r.classification),
  );
}

/**
 * Count tautological/prompt-grep tests still present on disk (metric source for
 * MetricsSnapshot.tautological-tests). Disk-aware — does NOT touch the ledger.
 */
export function countRemaining(repoRoot: string): number {
  return SUSPECTS.filter(
    (s) =>
      s.classification !== "behavioral" &&
      fs.existsSync(path.join(repoRoot, s.testPath)),
  ).length;
}

interface Parsed {
  countRemaining: boolean;
  suspects?: string;
}

function parseArgs(argv: string[]): Parsed {
  const parsed: Parsed = { countRemaining: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--count-remaining") {
      parsed.countRemaining = true;
    } else if (arg === "--suspects") {
      const next = argv[++i];
      if (!next) throw new Error("--suspects requires a glob/substring argument");
      parsed.suspects = next;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return parsed;
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const args = parseArgs(argv);
  const repoRoot = process.cwd();

  if (args.countRemaining) {
    process.stdout.write(`${countRemaining(repoRoot)}\n`);
    return 0;
  }

  const audit = buildAudit({ suspects: args.suspects });
  const unclassified = unclassifiedSuspects(audit);

  const reportPath = path.join(repoRoot, REPORT_REL_PATH);
  atomicWriteText(reportPath, renderAuditToon(audit));

  const behavioral = audit.rows.filter((r) => r.classification === "behavioral").length;
  const tautological = audit.rows.filter((r) => r.classification === "tautological").length;
  const promptGrep = audit.rows.filter((r) => r.classification === "prompt-grep").length;
  const deleted = audit.rows.filter((r) => r.action === "deleted").length;

  process.stdout.write(
    [
      `auditWritten: ${REPORT_REL_PATH}`,
      `suspectCount: ${audit.suspectCount}`,
      `behavioral: ${behavioral}`,
      `tautological: ${tautological}`,
      `promptGrep: ${promptGrep}`,
      `deleted: ${deleted}`,
      `unclassified: ${unclassified.length}`,
      "",
    ].join("\n"),
  );

  return unclassified.length === 0 ? 0 : 1;
}

if (isMain(import.meta)) {
  try {
    process.exit(main());
  } catch (err) {
    process.stderr.write(`audit-tests: ${(err as Error).message}\n`);
    process.exit(2);
  }
}
