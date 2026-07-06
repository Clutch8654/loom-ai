/**
 * Phase 15 — Audit-report completeness guard (F-12, C-11 first half, defect 7).
 *
 * Guards that the tautological-test audit (scripts/audit-tests.ts) classifies
 * 100% of the flagged suspect set with valid, evidenced, state-machine-consistent
 * rows, and that the committed ledger (planning/reports/test-audit.toon) is the
 * byte-for-byte output of a fresh audit run (durable + re-runnable).
 *
 * This is a behavioral guard: it runs the audit generator and asserts invariants
 * over its output — an unclassified suspect, a missing evidence string, an
 * action that contradicts its classification, or a drifted on-disk ledger all
 * fail it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { splitCsvLine } from "../../lib/index.js";
import {
  SUSPECTS,
  VALID_CLASSIFICATIONS,
  AUDIT_EPOCH,
  REPORT_REL_PATH,
  buildAudit,
  renderAuditToon,
  unclassifiedSuspects,
} from "../../scripts/audit-tests.js";

const REPO_ROOT = join(__dirname, "..", "..");

describe("audit-report completeness (F-12)", () => {
  const audit = buildAudit();

  it("classifies 100% of the flagged suspect set (no unclassified rows)", () => {
    expect(unclassifiedSuspects(audit)).toHaveLength(0);
    expect(audit.rows).toHaveLength(SUSPECTS.length);
  });

  it("suspectCount equals the row count", () => {
    expect(audit.suspectCount).toBe(audit.rows.length);
  });

  it("every row carries a classification in the enum", () => {
    for (const row of audit.rows) {
      expect(VALID_CLASSIFICATIONS).toContain(row.classification);
    }
  });

  it("every non-behavioral row carries non-empty evidence", () => {
    for (const row of audit.rows) {
      if (row.classification !== "behavioral") {
        expect(row.evidence.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("action is consistent with classification (state-machine rule)", () => {
    for (const row of audit.rows) {
      if (row.classification === "behavioral") {
        expect(row.action).toBe("retained");
      } else {
        // tautological / prompt-grep suspects are confirmed no-value ⇒ deleted
        expect(row.action).toBe("deleted");
      }
      if (row.action === "backfilled") {
        expect(row.replacedBy).toBeTruthy();
      }
    }
  });

  it("testPaths are unique (pk_test)", () => {
    const paths = audit.rows.map((r) => r.testPath);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("auditedAt is the fixed epoch (deterministic, no wall-clock)", () => {
    expect(audit.auditedAt).toBe(AUDIT_EPOCH);
  });

  it("committed ledger matches a fresh render (durable + re-runnable)", () => {
    const onDisk = readFileSync(join(REPO_ROOT, REPORT_REL_PATH), "utf8");
    expect(onDisk).toBe(renderAuditToon(audit));
  });

  it("ledger parses back into rows whose fields round-trip", () => {
    const onDisk = readFileSync(join(REPO_ROOT, REPORT_REL_PATH), "utf8");
    const dataLines = onDisk
      .split("\n")
      .filter((l) => l.startsWith("    ")) // 4-space-indented data rows
      .map((l) => l.slice(4));
    expect(dataLines).toHaveLength(audit.rows.length);
    dataLines.forEach((line, i) => {
      const cells = splitCsvLine(line);
      expect(cells[0]).toBe(audit.rows[i].testPath);
      expect(cells[1]).toBe(audit.rows[i].classification);
      expect(cells[3]).toBe(audit.rows[i].action);
    });
  });
});
