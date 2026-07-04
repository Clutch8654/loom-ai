/**
 * tests/lib/dedup-migration.test.ts — PLAN-exceed-gstack Phase 11a
 * (F-08, defect 8).
 *
 * The Phase 11a strangler migration deletes the local CSV splitters under
 * hooks/lib/** and routes them through the shared-core `splitCsvLine`
 * (lib/csv.ts). This suite pins the behavioral change that migration produced.
 *
 * Scenario S-01 — the load-bearing regression:
 *   The former `hooks/lib/toon-reader.ts:125` `splitCsvRow` toggled `inQuotes`
 *   on every `"` and therefore LOST an escaped `""` (embedded quote): a cell
 *   `"say ""hi"""` came back as `say hi` instead of `say "hi"`. After routing
 *   through lib/ `splitCsvLine`, the embedded quote is preserved — matching the
 *   lib/ reference behavior exercised directly below.
 *
 * Run: bunx vitest run tests/lib/dedup-migration.test.ts
 */

import { describe, it, expect } from "vitest";

import { splitCsvLine } from "../../lib/index.js";
import { parseToonArray } from "../../hooks/lib/toon-reader.js";

// ---------------------------------------------------------------------------
// S-01: toon-reader now preserves the embedded quote (matches lib reference)
// ---------------------------------------------------------------------------

describe("S-01 — toon-reader parses escaped `\"\"` via lib/ splitCsvLine", () => {
  it("preserves the embedded quote character in a typed-array cell", () => {
    // A typed-array row whose second cell is the quoted string  say "hi"
    // encoded per CSV convention:  "say ""hi"""
    const toon = ['items[1]{name,note}:', '  foo,"say ""hi"""'].join("\n");

    const rows = parseToonArray(toon, "items");

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("foo");
    // The old local splitter returned `say hi` (embedded quote LOST). The
    // migrated splitter preserves it.
    expect(rows[0].note).toBe('say "hi"');
    expect(rows[0].note).not.toBe("say hi");
  });

  it("matches the lib/ reference splitter for the same row", () => {
    const row = 'foo,"say ""hi"""';

    // lib/ reference behavior (the single source of truth): strip surrounding
    // quotes, collapse the escaped `""` to one literal `"`.
    const reference = splitCsvLine(row, { trim: true });
    expect(reference).toEqual(["foo", 'say "hi"']);

    // toon-reader, routed through the same splitter, agrees.
    const rows = parseToonArray(['items[1]{name,note}:', `  ${row}`].join("\n"), "items");
    expect([rows[0].name, rows[0].note]).toEqual(reference);
  });

  it("preserves an embedded delimiter inside a quoted cell", () => {
    // Regression guard: a quoted comma must not split the cell.
    const rows = parseToonArray(
      ['items[1]{name,note}:', '  foo,"a, b, c"'].join("\n"),
      "items"
    );
    expect(rows[0].note).toBe("a, b, c");
  });
});
