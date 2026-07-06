/**
 * PLAN-thinking-gate Phase 2 (w1-p2): the cross-model second-opinion marker
 * in skills/loom-think/SKILL.md must no longer be inert.
 *
 * Wave-0 contract facts this locks in (lib/types.ts + protocols/think-review.schema.md):
 *   - The marker `Cross-model review:` is CONSUMED, not left as a `PENDING` hook.
 *   - A REAL second-opinion pass runs against a NAMED second model that is NOT
 *     `fable` (memory `feedback_fable_for_planning`).
 *   - Divergence between the primary and second-model opinions is emitted as a
 *     ThinkReviewFinding row (lens/severity/fixable/remediation) that the P1
 *     fail-closed router (`scripts/lib/think-review-router.ts`,
 *     `decidedBy: think-review-router`) consumes via the C-02 decision table.
 *
 * Structural test only — asserts the SKILL body, no runtime spawn.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");
const SKILL_PATH = join(REPO_ROOT, "skills", "loom-think", "SKILL.md");

const skill = readFileSync(SKILL_PATH, "utf8");
const lines = skill.split("\n");
const markerLines = lines.filter((l) => l.includes("Cross-model review:"));

/** Handler / consumption tokens that prove the marker is wired, not inert. */
const HANDLER_TOKENS = ["think-review-router", "handler", "router", "finding"];
const NAMED_SECOND_MODEL = "sonnet";

describe("loom-think Phase 3.5 cross-model marker is active (w1-p2)", () => {
  // AC-1a: the "Do NOT auto-invoke" inert instruction is gone/replaced.
  it("removes the inert 'Do NOT auto-invoke' instruction", () => {
    expect(skill).not.toMatch(/Do NOT auto-invoke/i);
  });

  // AC-1a: the inert PENDING marker no longer exists.
  it("no longer carries the inert 'Cross-model review: PENDING' marker", () => {
    expect(skill).not.toContain("Cross-model review: PENDING");
  });

  // AC-1b: the marker string only co-occurs with a handler/consumption reference.
  it("keeps at least one 'Cross-model review:' marker, active", () => {
    expect(markerLines.length).toBeGreaterThan(0);
  });

  it("every 'Cross-model review:' line co-occurs with a handler/consumption reference", () => {
    for (const line of markerLines) {
      const wired = HANDLER_TOKENS.some((t) => line.includes(t));
      expect(wired, `marker line left inert: ${line.trim()}`).toBe(true);
    }
  });

  // AC-2: an ACTIVE consumption step names the second model, and it is NOT fable.
  it("names a concrete second model that is not fable", () => {
    expect(skill).toContain(NAMED_SECOND_MODEL);
    // The model actually spawned must be the named tier, never fable.
    expect(skill).toContain(`model: "${NAMED_SECOND_MODEL}"`);
    expect(skill).not.toContain('model: "fable"');
    // fable is only permitted to appear as an explicit prohibition.
    for (const line of lines.filter((l) => /\bfable\b/i.test(l))) {
      expect(
        /never|not|prohibit|forbid|may not|exhaust/i.test(line),
        `'fable' mentioned without a prohibition: ${line.trim()}`,
      ).toBe(true);
    }
  });

  it("describes an active pass (not a placeholder for later)", () => {
    expect(skill).toMatch(/mandatory, active|never leave it PENDING|active — never/i);
    expect(skill).not.toMatch(/placeholder for an adversarial review pass/i);
  });

  // AC-2: divergence is emitted as a ThinkReviewFinding the router consumes.
  it("emits a divergence finding in ThinkReviewFinding shape", () => {
    // The finding table header carries the four load-bearing columns.
    expect(skill).toMatch(
      /findings\[\d+\]\{id,lens,severity,confidence,fixable,remediation,message\}/,
    );
    // The finding is wired to the P1 router by name.
    expect(skill).toContain("think-review-router");
    expect(skill).toContain("decidedBy: think-review-router");
    // Divergence maps to the C-02 kill vs rewrite branches.
    expect(skill).toMatch(/rewrite-think/);
    expect(skill).toMatch(/kill/);
  });
});
