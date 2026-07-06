/**
 * skills/loom-retro/append-guard.ts
 *
 * Deterministic append-only enforcement for /loom-retro's writes to
 * .loom/learnings.toon and .loom/regressions.toon.
 *
 * The SKILL body states two invariants the ceremony MUST uphold:
 *   1. Append-only — historic rows are never mutated.
 *   2. Sequential ids — `L-NNN` / `R-NNN` allocated by reading the highest
 *      existing id and incrementing.
 *
 * These are pure functions, wired here and proven behaviorally in
 * tests/skills/workflow-batch.test.ts.
 */

const APPEND_VIOLATION = "RETRO_APPEND_VIOLATION";

/**
 * Compute the next sequential id for a prefix (`L` or `R`) given the existing
 * ids. Reads the highest `PREFIX-NNN` and increments; zero-pads to 3 digits.
 */
export function nextSequentialId(prefix: string, existingIds: string[]): string {
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const id of existingIds) {
    const m = id.match(re);
    if (m) {
      const n = Number(m[1]);
      if (n > max) max = n;
    }
  }
  const next = max + 1;
  return `${prefix}-${String(next).padStart(3, "0")}`;
}

export interface AppendCheck {
  ok: boolean;
  /** `RETRO_APPEND_VIOLATION` when a historic row was dropped or mutated. */
  code?: string;
  reason?: string;
}

/**
 * Enforce append-only semantics: `next` is a valid successor of `prior` only
 * when it preserves every prior row byte-for-byte as a prefix and adds ≥0 new
 * rows. Any reordering, deletion, or in-place edit of a historic row is a
 * violation.
 */
export function assertAppendOnly(prior: string[], next: string[]): AppendCheck {
  if (next.length < prior.length) {
    return {
      ok: false,
      code: APPEND_VIOLATION,
      reason: `row count shrank ${prior.length} → ${next.length}`,
    };
  }
  for (let i = 0; i < prior.length; i++) {
    if (next[i] !== prior[i]) {
      return {
        ok: false,
        code: APPEND_VIOLATION,
        reason: `historic row ${i} was mutated`,
      };
    }
  }
  return { ok: true };
}

export { APPEND_VIOLATION };
