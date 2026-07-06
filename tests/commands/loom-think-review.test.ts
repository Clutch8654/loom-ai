/**
 * tests/commands/loom-think-review.test.ts
 *
 * Spec tests for the /loom-think:review command (commands/loom-think/review.md).
 *
 * Validates the acceptance criteria that are enforceable against the command
 * spec text:
 *   - the file exists and auto-resolves as /loom-think:review (mirrors
 *     commands/loom-plan/review.md)
 *   - resolves the newest .loom/thinks/ doc on the current branch (or a path)
 *   - empty state prints "no think doc on branch X — run /loom-think first" and
 *     exits NON-ZERO (not a stack trace)
 *   - routes through the pure router scripts/lib/think-review-router.ts
 *   - documents fail-closed / quorum / any-blocking-wins
 *   - every verdict carries nextCommand (proceed/rewrite-think/kill mapping)
 *   - opt-in for humans; default-on only for /loom-auto (P6a)
 *   - does NOT edit commands/loom-think.md (ownership collision avoided —
 *     the interview entry keeps its agent: frontmatter)
 *
 * Run: bunx vitest run tests/commands/loom-think-review.test.ts
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const REVIEW_PATH = join(REPO_ROOT, "commands/loom-think/review.md");
const THINK_ENTRY_PATH = join(REPO_ROOT, "commands/loom-think.md");

let content = "";

beforeAll(() => {
  content = readFileSync(REVIEW_PATH, "utf8");
});

describe("/loom-think:review command spec", () => {
  it("commands/loom-think/review.md exists (auto-resolves as /loom-think:review)", () => {
    expect(existsSync(REVIEW_PATH)).toBe(true);
  });

  it("has frontmatter with a description", () => {
    expect(content).toMatch(/^---\n[\s\S]*?description:[\s\S]*?\n---/);
  });

  it("declares itself the review subcommand and mirrors /loom-plan review", () => {
    expect(content).toMatch(/##\s*Subcommand:\s*review/i);
    expect(content).toMatch(/loom-plan\/review\.md|loom-plan:review/);
  });

  describe("AC1: doc resolution + empty state", () => {
    it("resolves the newest .loom/thinks/ doc on the current branch", () => {
      expect(content).toMatch(/\.loom\/thinks/);
      expect(content).toMatch(/newest/i);
      expect(content).toMatch(/branch/i);
      // Newest is by datetime frontmatter, not filename.
      expect(content).toMatch(/datetime/i);
    });

    it("accepts an explicit <doc> path argument", () => {
      expect(content).toMatch(/explicit path|<doc>/i);
    });

    it("empty state prints the exact message and exits NON-ZERO", () => {
      expect(content).toMatch(
        /no think doc on branch <?X?[^\n]*> ?— run \/loom-think first|no think doc on branch/i,
      );
      expect(content).toMatch(/non-zero|exit code 1|exit 1/i);
      expect(content).toMatch(/not a (stack ?trace|crash)|do NOT print a stack trace/i);
    });
  });

  describe("AC2: routes through the pure fail-closed router", () => {
    it("references the router module scripts/lib/think-review-router.ts", () => {
      expect(content).toMatch(/scripts\/lib\/think-review-router\.ts/);
      expect(content).toMatch(/routeThinkReview/);
    });

    it("documents fail-closed / quorum / any-blocking-wins", () => {
      expect(content).toMatch(/fail-closed/i);
      expect(content).toMatch(/quorum/i);
      expect(content).toMatch(/⌈|ceil|panelSize\s*\/\s*2/i);
      expect(content).toMatch(/PANEL_INCOMPLETE/);
    });

    it("never proceeds on a sub-quorum / crashed panel", () => {
      expect(content).toMatch(/NEVER proceed|never `?proceed`?/i);
    });

    it("kill outranks rewrite (any-blocking-wins)", () => {
      expect(content).toMatch(/kill outranks rewrite|any-blocking-wins/i);
    });
  });

  describe("AC4: every verdict carries nextCommand", () => {
    it("documents the proceed → /loom-roadmap init mapping", () => {
      expect(content).toMatch(/proceed[\s\S]{0,40}\/loom-roadmap init/);
    });

    it("documents the rewrite-think → /loom-think --from <doc> mapping", () => {
      expect(content).toMatch(/rewrite-think[\s\S]{0,40}\/loom-think --from/);
    });

    it("documents the kill → archive guidance mapping", () => {
      expect(content).toMatch(/kill[\s\S]{0,60}archive/i);
    });
  });

  describe("AC5: opt-in for humans, default-on only for /loom-auto", () => {
    it("states the gate is opt-in / not required before /loom-roadmap init", () => {
      expect(content).toMatch(/opt-in/i);
      expect(content).toMatch(/not required before \/loom-roadmap init|NOT required/i);
    });

    it("states default-on only for /loom-auto (P6a wires it)", () => {
      expect(content).toMatch(/default-on only for `?\/loom-auto`?/i);
      expect(content).toMatch(/P6a/);
    });
  });

  describe("archetype→lens selection is consumed", () => {
    it("references the think-review schema archetype→lens rule", () => {
      expect(content).toMatch(/think-review\.schema\.md/);
      expect(content).toMatch(/Archetype.?→?.?Lens|lensSelectionRule/i);
    });

    it("notes eng fires for every archetype", () => {
      expect(content).toMatch(/eng[\s\S]{0,60}every archetype|approach-soundness is never optional/i);
    });
  });

  describe("P4 extension point is structured for the Wave-2 swap", () => {
    it("marks the panel/benchmark-presence swap as a P4 extension point", () => {
      expect(content).toMatch(/P4/);
      expect(content).toMatch(/benchmark-presence|BenchmarkScorecard/i);
    });
  });
});

describe("ownership collision avoided", () => {
  it("commands/loom-think.md still exists with its agent: frontmatter (untouched)", () => {
    expect(existsSync(THINK_ENTRY_PATH)).toBe(true);
    const entry = readFileSync(THINK_ENTRY_PATH, "utf8");
    expect(entry).toMatch(/^---\n[\s\S]*?agent:\s*skills\/loom-think\/SKILL\.md/m);
  });
});
