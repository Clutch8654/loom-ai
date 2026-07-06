/**
 * tests/commands/loom-roadmap-review-lenses.test.ts
 *
 * Structural tests for the conditional M-04 strategic lenses added to
 * `/loom-roadmap review` (commands/loom-roadmap/review.md), Phase 3 (w1-p3)
 * of PLAN-thinking-gate.
 *
 * Covers:
 *   - The 4 M-04 lenses (plan-{eng,devex,ceo,design}-review-agent) are added.
 *   - They are CONDITIONAL: gated on "think-review not run" (C-09), so
 *     /loom-auto (which runs its own think-review gate) never double-runs them.
 *   - The archetype selection rule (protocols/think-review.schema.md) drives
 *     which lenses fire.
 *   - No bare-"4" drift: description/prose/synthesis/agents[N] table are all
 *     updated; agentCount is not hardcoded to 4.
 *
 * Run: bunx vitest run tests/commands/loom-roadmap-review-lenses.test.ts
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const REVIEW_PATH = join(REPO_ROOT, "commands/loom-roadmap/review.md");

const M04_LENSES = [
  "plan-eng-review-agent",
  "plan-devex-review-agent",
  "plan-ceo-review-agent",
  "plan-design-review-agent",
] as const;

let content: string;

beforeAll(() => {
  content = readFileSync(REVIEW_PATH, "utf8");
});

describe("commands/loom-roadmap/review.md — conditional M-04 lenses", () => {
  it("the command file exists", () => {
    expect(existsSync(REVIEW_PATH)).toBe(true);
  });

  // ── The 4 M-04 lenses are added ─────────────────────────────────────────

  describe("M-04 lenses are added", () => {
    for (const lens of M04_LENSES) {
      it(`references the ${lens}`, () => {
        expect(content).toContain(lens);
      });
    }
  });

  // ── The lenses are CONDITIONAL (gated on think-review not run) ───────────

  describe("lenses are conditional (C-09 — think-review not run)", () => {
    it("documents that lenses fire only when think-review was skipped", () => {
      expect(content).toMatch(/only\s+when\s+think-review\s+was\s+skipped/i);
    });

    it("documents the human-path framing for firing the lenses", () => {
      expect(content).toMatch(/human path/i);
    });

    it("documents SKIPPING the lenses when think-review already ran", () => {
      expect(content).toMatch(/think-review already ran/i);
    });

    it("names the double-run hazard the gate prevents (/loom-auto)", () => {
      expect(content).toMatch(/double-run/i);
      expect(content).toContain("/loom-auto");
    });

    it("detects think-review via a ThinkReviewVerdict artifact", () => {
      expect(content).toMatch(/ThinkReviewVerdict|verdict\.toon/);
    });

    it("emits a one-line skip note instead of silently dropping the lenses", () => {
      expect(content).toMatch(/Strategic lenses skipped/i);
    });

    it("cites the C-09 contract id for the gate", () => {
      expect(content).toContain("C-09");
    });
  });

  // ── Archetype selection drives the fired set ────────────────────────────

  describe("archetype-selected lens set", () => {
    it("references the normative archetype→lens selection rule", () => {
      expect(content).toMatch(/think-review\.schema\.md/);
      expect(content).toMatch(/lensSelectionRule|Archetype.?→.?Lens|archetype-selected/i);
    });

    it("documents a variable strategic-lens count (not a fixed number)", () => {
      // "0, 2, 3, or 4" / "size 2-4" / "never a fixed number" style language
      expect(content).toMatch(/never (a fixed number|assume a fixed number)|2[–-]4|0,\s*2,\s*3,\s*or\s*4/i);
    });
  });

  // ── No bare-"4" drift ───────────────────────────────────────────────────

  describe("no bare-4 drift", () => {
    it("frontmatter description no longer claims a flat 4 parallel agents", () => {
      const desc = content.split("---")[1] ?? "";
      expect(desc).not.toMatch(/Launch 4 parallel agents/);
    });

    it("opening prose no longer claims a flat '4 specialized agents'", () => {
      expect(content).not.toMatch(/Launches 4 specialized agents in parallel/);
    });

    it("synthesis prose no longer says 'Four specialized agents reviewed'", () => {
      expect(content).not.toMatch(/Four specialized agents reviewed/);
    });

    it("synthesis prose no longer says 'After all 4 agents return'", () => {
      expect(content).not.toMatch(/After all 4 agents return/);
    });

    it("agentCount is NOT hardcoded to a flat 4 in the saved-findings schema", () => {
      // The old drift site was: agentCount: {4 + project-specific count}
      expect(content).not.toMatch(/agentCount:\s*\{4 \+ project-specific count\}/);
    });

    it("agentCount is documented to equal the number of agents[] rows", () => {
      expect(content).toMatch(/agentCount[\s\S]{0,120}number of (agents\[\] )?rows/i);
    });
  });

  // ── agents[N] table matches the agents that ran ─────────────────────────

  describe("agents[N] saved-findings table", () => {
    it("keeps the 4 core agent rows", () => {
      expect(content).toContain("scope-feasibility-agent,");
      expect(content).toContain("feature-coverage-agent,");
      expect(content).toContain("strategy-agent,");
      expect(content).toContain("ux-agent,");
    });

    it("adds a per-strategic-lens row that is omitted when think-review ran", () => {
      expect(content).toMatch(/one additional row per strategic lens that fired/i);
    });

    it("records which path ran (thinkReviewRan) and which lenses fired (strategicLenses)", () => {
      expect(content).toMatch(/thinkReviewRan:/);
      expect(content).toMatch(/strategicLenses/);
    });
  });

  // ── Spawn step gates the lenses ─────────────────────────────────────────

  describe("Step R2 spawns the lenses conditionally", () => {
    it("instructs to spawn the strategic lenses only on the human path", () => {
      expect(content).toMatch(/only if Step R1c resolved the human path|only on the human path/i);
    });

    it("keeps the 4 core agents unconditional", () => {
      expect(content).toMatch(/always run|Core agents \(always run\)/i);
    });
  });
});
