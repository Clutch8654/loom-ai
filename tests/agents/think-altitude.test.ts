/**
 * tests/agents/think-altitude.test.ts
 *
 * Phase 4 (w2-p4) spec tests: the think-altitude MODE on the 4 M-04 review
 * agents + the /loom-think:review panel swap and benchmark-presence check.
 *
 * These assert the acceptance criteria that are enforceable against the agent
 * and command spec text (the router behavior itself is covered by
 * tests/scripts/think-review-router.test.ts — run in the same suite to prove no
 * regression):
 *
 *   AC1 — each M-04 agent gains a `scope: think` framing altitude that reviews
 *         FRAMING (problem clarity, approach soundness, gap-closure, benchmark
 *         presence), emits ThinkReviewFinding rows on its own fixed lens, and
 *         PRESERVES its `model: opus` frontmatter + its existing plan-review
 *         behavior (additive mode, NO forked agent files).
 *   AC2 — /loom-think:review fires these 4 agents as its panel, counts
 *         well-formed lens envelopes into reportingLenses, and passes it to
 *         routeThinkReview.
 *   AC3 — the benchmark-presence check lives in the panel (reads the
 *         BenchmarkScorecard; missing OR thin ⇒ finding; thin = dimensions<3 OR
 *         any refScore unsourced). No new agent files.
 *
 * Run: bunx vitest run tests/agents/think-altitude.test.ts
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

const AGENTS = {
  eng: join(REPO_ROOT, "agents/plan-eng-review-agent.md"),
  devex: join(REPO_ROOT, "agents/plan-devex-review-agent.md"),
  ceo: join(REPO_ROOT, "agents/plan-ceo-review-agent.md"),
  design: join(REPO_ROOT, "agents/plan-design-review-agent.md"),
} as const;

const REVIEW_PATH = join(REPO_ROOT, "commands/loom-think/review.md");

type Lens = keyof typeof AGENTS;
const LENSES = Object.keys(AGENTS) as Lens[];

function read(path: string): string {
  return readFileSync(path, "utf8");
}

// ── AC1: the altitude MODE on each M-04 agent ────────────────────────────────

describe("AC1: think-altitude mode is added to each M-04 agent (additive, not forked)", () => {
  for (const lens of LENSES) {
    describe(`plan-${lens}-review-agent`, () => {
      const body = read(AGENTS[lens]);

      it("preserves its `model: opus` frontmatter", () => {
        expect(body).toMatch(/^---\n[\s\S]*?\bmodel:\s*opus\b[\s\S]*?\n---/);
      });

      it("keeps the agent's own name in frontmatter (same file, not forked)", () => {
        expect(body).toMatch(
          new RegExp(`^---\\n[\\s\\S]*?name:\\s*plan-${lens}-review-agent`, "m"),
        );
      });

      it("declares a think/framing altitude selected by a scope param", () => {
        expect(body).toMatch(/Think-Altitude Mode/i);
        expect(body).toMatch(/scope:\s*think/);
        // The plan altitude is still the default — additive, not a replacement.
        expect(body).toMatch(/scope:\s*plan/);
      });

      it("reviews FRAMING (not phases/waves) along the 4 framing dimensions", () => {
        expect(body).toMatch(/framing/i);
        expect(body).toMatch(/problem clarity/i);
        expect(body).toMatch(/approach soundness/i);
        expect(body).toMatch(/gap-closure/i);
        expect(body).toMatch(/benchmark presence/i);
        // Explicitly NOT phases/waves in think mode.
        expect(body).toMatch(/NOT (its )?phases|not phases or waves/i);
      });

      it("emits ThinkReviewFinding rows on its own fixed lens", () => {
        expect(body).toMatch(/ThinkReviewFinding/);
        expect(body).toMatch(
          /\{id,\s*lens,\s*severity,\s*confidence,\s*fixable,\s*remediation,\s*message\}/,
        );
        // The lens is pinned to THIS agent's lens.
        expect(body).toMatch(new RegExp(`always \`?${lens}\`?`, "i"));
      });

      it("makes `fixable` load-bearing for blocking (kill vs rewrite split)", () => {
        expect(body).toMatch(/load-bearing only for/i);
        expect(body).toMatch(/fixable:\s*false[\s\S]{0,140}kill/i);
        expect(body).toMatch(/fixable:\s*true[\s\S]{0,140}rewrite-think/i);
      });

      it("delegates the verdict to the router (does not decide it)", () => {
        expect(body).toMatch(/routeThinkReview/);
        expect(body).toMatch(/do NOT decide the verdict/i);
      });

      it("PRESERVES its existing plan-review behavior (additive mode)", () => {
        // A signature marker of each agent's original plan-review body is intact.
        const PLAN_MARKER: Record<Lens, RegExp> = {
          eng: /## Multi-Pass Structure/,
          devex: /predictedTTHW/,
          ceo: /SCOPE_EXPANSION/,
          design: /Information Architecture \(IA\)/,
        };
        expect(body).toMatch(PLAN_MARKER[lens]);
      });
    });
  }

  it("NO forked -think agent files were created", () => {
    for (const lens of LENSES) {
      expect(
        existsSync(join(REPO_ROOT, `agents/plan-${lens}-review-think-agent.md`)),
      ).toBe(false);
    }
  });
});

// ── AC2: /loom-think:review fires the altitude panel + counts reportingLenses ─

describe("AC2: /loom-think:review uses the 4 agents as its altitude-mode panel", () => {
  const cmd = read(REVIEW_PATH);

  it("spawns all four M-04 agents", () => {
    expect(cmd).toMatch(/plan-eng-review-agent/);
    expect(cmd).toMatch(/plan-devex-review-agent/);
    expect(cmd).toMatch(/plan-ceo-review-agent/);
    expect(cmd).toMatch(/plan-design-review-agent/);
  });

  it("switches them to framing altitude via scope: think", () => {
    expect(cmd).toMatch(/scope:\s*think/);
    expect(cmd).toMatch(/altitude/i);
  });

  it("does not fork the agents — states they are the same files (C-04)", () => {
    expect(cmd).toMatch(/NOT forked|same four agent files|not forked/i);
  });

  it("counts well-formed lens envelopes into reportingLenses", () => {
    expect(cmd).toMatch(/reportingLenses/);
    expect(cmd).toMatch(/well-formed/i);
    // A crashed/malformed lens does NOT count.
    expect(cmd).toMatch(/crashed|malformed|timed out/i);
  });

  it("passes reportingLenses to the router (required; omission fails closed)", () => {
    expect(cmd).toMatch(/routeThinkReview/);
    expect(cmd).toMatch(/opts\.reportingLenses|reportingLenses.*REQUIRED|REQUIRED.*reportingLenses/i);
    expect(cmd).toMatch(/fail closed|fail-closed/i);
  });

  it("consumes the archetype→lens selection rule to pick which lenses fire", () => {
    expect(cmd).toMatch(/think-review\.schema\.md/);
    expect(cmd).toMatch(/lensSelectionRule|Archetype.?→?.?Lens/i);
  });
});

// ── AC3: the benchmark-presence check lives in the panel ─────────────────────

describe("AC3: benchmark-presence check is in the panel (no new agent files)", () => {
  const cmd = read(REVIEW_PATH);

  it("reads the BenchmarkScorecard from the think doc", () => {
    expect(cmd).toMatch(/BenchmarkScorecard/);
    expect(cmd).toMatch(/benchmark-presence/i);
  });

  it("flags a missing OR thin scorecard as a finding", () => {
    expect(cmd).toMatch(/missing/i);
    expect(cmd).toMatch(/thin/i);
  });

  it("defines thin as dimensions < 3 OR any refScore unsourced", () => {
    expect(cmd).toMatch(/dimensions(\.length)?\s*<\s*3/i);
    expect(cmd).toMatch(/unsourced|empty sourceRefs/i);
  });

  it("routes the benchmark finding as rewrite-think (fixable), never kill", () => {
    expect(cmd).toMatch(/rewrite-think/);
    expect(cmd).toMatch(/never `?kill`?|not kill/i);
  });

  it("does not introduce a new agent file for the check", () => {
    expect(cmd).toMatch(/lives in the panel|not (in )?a new agent|no new agent/i);
    expect(existsSync(join(REPO_ROOT, "agents/benchmark-presence-agent.md"))).toBe(
      false,
    );
  });
});
