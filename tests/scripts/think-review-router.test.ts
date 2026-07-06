/**
 * tests/scripts/think-review-router.test.ts
 *
 * Unit tests for the pure, fail-closed pre-plan thinking-review router
 * (scripts/lib/think-review-router.ts) against the normative C-02 decision
 * table in protocols/think-review.schema.md.
 *
 * Coverage:
 *   - proceed / rewrite-think / kill happy paths
 *   - any-blocking-wins + kill-outranks-rewrite precedence
 *   - quorum math (⌈M/2⌉) at M = 4, 3, 2
 *   - CRASHED-PANEL fixture: fewer than quorum lenses → rewrite-think (NOT
 *     proceed), errorCode PANEL_INCOMPLETE
 *   - a seeded-bad think doc (approach-error class) routes to rewrite/kill
 *     NAMING the defect
 *   - a SEPARATE fixture that routes specifically to `kill` (non-fixable
 *     blocking — concretely kill, not "rewrite or kill")
 *   - nextCommand mapping for all three decisions
 *   - purity (injected clock, no ambient time)
 *
 * Run: bunx vitest run tests/scripts/think-review-router.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  routeThinkReview,
  NEXT_COMMAND,
  THINK_REVIEW_ROUTER_ID,
  type RouteThinkReviewOptions,
} from "../../scripts/lib/think-review-router.js";
import type {
  PrePlanLensPanel,
  PrePlanLensSelection,
  ThinkReviewFinding,
  ThinkReviewLens,
} from "../../lib/types.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SELECTION_TABLE: PrePlanLensSelection[] = [
  { archetype: "cli", lenses: ["eng", "devex", "ceo"], rationale: "cli" },
  {
    archetype: "web-app",
    lenses: ["eng", "devex", "ceo", "design"],
    rationale: "web-app",
  },
  { archetype: "library", lenses: ["eng", "devex", "ceo"], rationale: "library" },
  {
    archetype: "data-pipeline",
    lenses: ["eng", "devex", "ceo"],
    rationale: "data-pipeline",
  },
  { archetype: "research", lenses: ["eng", "ceo"], rationale: "research" },
  {
    archetype: "default",
    lenses: ["eng", "devex", "ceo", "design"],
    rationale: "default",
  },
];

/** Build a resolved panel with `activeLenses` of the given lenses. */
function panel(lenses: ThinkReviewLens[]): PrePlanLensPanel {
  return {
    selections: SELECTION_TABLE,
    resolvedArchetype: "default",
    activeLenses: lenses,
  };
}

/** A frozen clock so `decidedAt` is deterministic. */
const FIXED_NOW = () => new Date("2026-07-05T10:00:00.000Z");

function opts(over: Partial<RouteThinkReviewOptions> = {}): RouteThinkReviewOptions {
  return {
    reportingLenses: 4,
    revisionCount: 0,
    docPath: ".loom/thinks/foo-2026-07-05T10-00-00.md",
    now: FIXED_NOW,
    ...over,
  };
}

let fid = 0;
function finding(
  over: Partial<ThinkReviewFinding> = {},
): ThinkReviewFinding {
  fid += 1;
  return {
    id: `F-${String(fid).padStart(2, "0")}`,
    lens: "eng",
    severity: "info",
    confidence: 7,
    fixable: true,
    remediation: "do the thing",
    message: "a finding",
    ...over,
  };
}

const FOUR_LENS = panel(["eng", "devex", "ceo", "design"]);

// ── proceed ──────────────────────────────────────────────────────────────────

describe("routeThinkReview — proceed", () => {
  it("quorum met, zero blocking/warning → proceed", () => {
    const v = routeThinkReview([], FOUR_LENS, opts({ reportingLenses: 4 }));
    expect(v.decision).toBe("proceed");
    expect(v.quorumMet).toBe(true);
    expect(v.errorCode).toBeNull();
    expect(v.nextCommand).toBe(NEXT_COMMAND.proceed);
    expect(v.nextCommand).toBe("/loom-roadmap init");
  });

  it("info-only findings do NOT gate → proceed", () => {
    const findings = [
      finding({ severity: "info" }),
      finding({ severity: "info" }),
    ];
    const v = routeThinkReview(findings, FOUR_LENS, opts({ reportingLenses: 4 }));
    expect(v.decision).toBe("proceed");
  });

  it("proceed only at full evidence — never on sub-quorum", () => {
    // Same zero-blocking findings but only 1 of 4 lenses reported.
    const v = routeThinkReview([], FOUR_LENS, opts({ reportingLenses: 1 }));
    expect(v.decision).not.toBe("proceed");
  });
});

// ── rewrite-think ────────────────────────────────────────────────────────────

describe("routeThinkReview — rewrite-think", () => {
  it("a single warning → rewrite-think", () => {
    const v = routeThinkReview(
      [finding({ severity: "warning" })],
      FOUR_LENS,
      opts({ reportingLenses: 4 }),
    );
    expect(v.decision).toBe("rewrite-think");
    expect(v.errorCode).toBeNull();
    expect(v.nextCommand).toBe(
      "/loom-think --from .loom/thinks/foo-2026-07-05T10-00-00.md",
    );
  });

  it("a fixable blocking (no non-fixable) → rewrite-think, not kill", () => {
    const v = routeThinkReview(
      [finding({ severity: "blocking", fixable: true })],
      FOUR_LENS,
      opts({ reportingLenses: 4 }),
    );
    expect(v.decision).toBe("rewrite-think");
  });

  it("nextCommand falls back to <doc> when no docPath supplied", () => {
    const v = routeThinkReview(
      [finding({ severity: "warning" })],
      FOUR_LENS,
      opts({ reportingLenses: 4, docPath: undefined }),
    );
    expect(v.nextCommand).toBe("/loom-think --from <doc>");
  });
});

// ── kill (dedicated non-fixable-blocking fixture) ────────────────────────────

describe("routeThinkReview — kill (non-fixable blocking, concretely kill)", () => {
  // A seeded think doc whose approach is fatally flawed: the design contradicts
  // a hard stated constraint, so there is NO fix within this framing. This must
  // route specifically to `kill` — not "rewrite or kill".
  const APPROACH_FATAL: ThinkReviewFinding = {
    id: "F-01",
    lens: "eng",
    severity: "blocking",
    confidence: 9,
    fixable: false,
    remediation:
      "Approach cannot satisfy the single-writer constraint — no fix within this framing; archive and re-scope",
    message:
      "The event-sourced design contradicts the single-writer requirement in §2",
  };

  it("routes specifically to kill (terminal)", () => {
    const v = routeThinkReview([APPROACH_FATAL], FOUR_LENS, opts({ reportingLenses: 4 }));
    expect(v.decision).toBe("kill");
    expect(v.errorCode).toBeNull();
    expect(v.nextCommand).toBe(NEXT_COMMAND.kill);
    expect(v.nextCommand).toMatch(/archive/i);
  });

  it("the verdict names the concrete defect (constraint contradiction)", () => {
    const v = routeThinkReview([APPROACH_FATAL], FOUR_LENS, opts({ reportingLenses: 4 }));
    const killer = v.findings.find((f) => f.severity === "blocking" && !f.fixable);
    expect(killer).toBeDefined();
    expect(killer?.message).toMatch(/single-writer/i);
    expect(killer?.remediation).toMatch(/re-scope|archive/i);
  });

  it("kill OUTRANKS rewrite: non-fixable blocking beside warnings still kills", () => {
    const v = routeThinkReview(
      [APPROACH_FATAL, finding({ severity: "warning" }), finding({ severity: "info" })],
      FOUR_LENS,
      opts({ reportingLenses: 4 }),
    );
    expect(v.decision).toBe("kill");
  });
});

// ── seeded-bad approach-error routes to rewrite/kill NAMING the defect ───────

describe("routeThinkReview — seeded approach-error names the defect", () => {
  it("a repairable approach error routes to rewrite-think and names the defect", () => {
    const seededBad: ThinkReviewFinding = {
      id: "F-01",
      lens: "eng",
      severity: "blocking",
      fixable: true,
      confidence: 8,
      remediation: "Name the single-writer owner in §2 and re-review",
      message: "Concurrency model is unspecified — approach under-constrained",
    };
    const v = routeThinkReview([seededBad], FOUR_LENS, opts({ reportingLenses: 4 }));
    expect(["rewrite-think", "kill"]).toContain(v.decision);
    expect(v.decision).toBe("rewrite-think");
    // The defect is named in the surfaced finding.
    const named = v.findings[0];
    expect(named.message).toMatch(/concurrency|under-constrained/i);
    expect(named.remediation.length).toBeGreaterThan(0);
  });
});

// ── CRASHED PANEL — the fail-closed cornerstone ──────────────────────────────

describe("routeThinkReview — crashed / empty-because-crashed panel (fail closed)", () => {
  it("zero findings because lenses CRASHED (sub-quorum) → rewrite-think, NOT proceed", () => {
    // 4-lens panel, but only 1 lens reported (3 crashed) → quorum ⌈4/2⌉=2 not met.
    const v = routeThinkReview([], FOUR_LENS, opts({ reportingLenses: 1 }));
    expect(v.decision).toBe("rewrite-think");
    expect(v.decision).not.toBe("proceed");
    expect(v.quorumMet).toBe(false);
    expect(v.errorCode).toBe("PANEL_INCOMPLETE");
    expect(v.nextCommand).toMatch(/^\/loom-think --from /);
  });

  it("zero lenses reported (total crash) → rewrite-think, PANEL_INCOMPLETE", () => {
    const v = routeThinkReview([], FOUR_LENS, opts({ reportingLenses: 0 }));
    expect(v.decision).toBe("rewrite-think");
    expect(v.errorCode).toBe("PANEL_INCOMPLETE");
  });

  it("sub-quorum panel NEVER kills even with a non-fixable blocking (untrusted evidence loops)", () => {
    const fatal = finding({ severity: "blocking", fixable: false });
    const v = routeThinkReview([fatal], FOUR_LENS, opts({ reportingLenses: 1 }));
    // Fail-closed rule 1 outranks kill: loop, don't terminate on sub-quorum.
    expect(v.decision).toBe("rewrite-think");
    expect(v.errorCode).toBe("PANEL_INCOMPLETE");
  });

  it("malformed panel (no activeLenses) → fail closed", () => {
    const bad = { selections: SELECTION_TABLE } as unknown as PrePlanLensPanel;
    const v = routeThinkReview([], bad, opts({ reportingLenses: 3 }));
    expect(v.decision).toBe("rewrite-think");
    expect(v.errorCode).toBe("PANEL_INCOMPLETE");
    expect(v.panelSize).toBe(0);
  });
});

// ── quorum math (⌈M/2⌉) ──────────────────────────────────────────────────────

describe("routeThinkReview — quorum threshold ⌈M/2⌉", () => {
  it("M=4 ⇒ need ≥2: 2 reporting meets quorum", () => {
    const v = routeThinkReview([], FOUR_LENS, opts({ reportingLenses: 2 }));
    expect(v.quorumMet).toBe(true);
    expect(v.decision).toBe("proceed");
  });

  it("M=4 ⇒ need ≥2: 1 reporting fails quorum", () => {
    const v = routeThinkReview([], FOUR_LENS, opts({ reportingLenses: 1 }));
    expect(v.quorumMet).toBe(false);
  });

  it("M=3 ⇒ need ≥2: 2 reporting meets quorum", () => {
    const cli = panel(["eng", "devex", "ceo"]);
    const v = routeThinkReview([], cli, opts({ reportingLenses: 2 }));
    expect(v.quorumMet).toBe(true);
    expect(v.panelSize).toBe(3);
  });

  it("M=3 ⇒ need ≥2: 1 reporting fails quorum", () => {
    const cli = panel(["eng", "devex", "ceo"]);
    const v = routeThinkReview([], cli, opts({ reportingLenses: 1 }));
    expect(v.quorumMet).toBe(false);
    expect(v.decision).toBe("rewrite-think");
  });

  it("M=2 ⇒ need ≥1: 1 reporting meets quorum", () => {
    const research = panel(["eng", "ceo"]);
    const v = routeThinkReview([], research, opts({ reportingLenses: 1 }));
    expect(v.quorumMet).toBe(true);
    expect(v.panelSize).toBe(2);
    expect(v.decision).toBe("proceed");
  });

  it("reportingLenses above panelSize is clamped to panelSize", () => {
    const research = panel(["eng", "ceo"]);
    const v = routeThinkReview([], research, opts({ reportingLenses: 99 }));
    expect(v.reportingLenses).toBe(2);
    expect(v.quorumMet).toBe(true);
  });
});

// ── envelope required fields + purity ────────────────────────────────────────

describe("routeThinkReview — verdict envelope + purity", () => {
  it("every verdict carries nextCommand, decidedBy, revisionCount", () => {
    const v = routeThinkReview([], FOUR_LENS, opts({ reportingLenses: 4, revisionCount: 2 }));
    expect(v.nextCommand).toBeTruthy();
    expect(v.decidedBy).toBe(THINK_REVIEW_ROUTER_ID);
    expect(v.revisionCount).toBe(2);
    expect(v.panelSize).toBe(4);
    expect(v.reportingLenses).toBe(4);
  });

  it("decidedBy is overridable", () => {
    const v = routeThinkReview([], FOUR_LENS, opts({ reportingLenses: 4, decidedBy: "p4-altitude-panel" }));
    expect(v.decidedBy).toBe("p4-altitude-panel");
  });

  it("uses the injected clock (pure, no ambient time)", () => {
    const v = routeThinkReview([], FOUR_LENS, opts({ reportingLenses: 4 }));
    expect(v.decidedAt).toBe("2026-07-05T10:00:00.000Z");
  });

  it("defaults revisionCount to 0 when omitted/invalid", () => {
    const v = routeThinkReview([], FOUR_LENS, {
      reportingLenses: 4,
      now: FIXED_NOW,
    });
    expect(v.revisionCount).toBe(0);
  });

  it("is deterministic — same inputs, same verdict", () => {
    const f = [finding({ severity: "warning" })];
    const a = routeThinkReview(f, FOUR_LENS, opts({ reportingLenses: 4 }));
    const b = routeThinkReview(f, FOUR_LENS, opts({ reportingLenses: 4 }));
    expect(a).toEqual(b);
  });
});
