/**
 * tests/e2e/thinking-gate-auto.test.ts
 *
 * P6a — the /loom-auto pre-plan thinking gate (Step 0.75 of commands/loom-auto.md).
 *
 * Two layers, per the plan's "structural + mocked" strategy:
 *
 *   1. DECISION-UNIT tests on the bounded-loop branch logic. A test-local pure
 *      driver (`driveThinkGate`) models Step 0.75b/c/d/e exactly. Its verdicts
 *      are produced by the REAL router (scripts/lib/think-review-router.ts) over
 *      finding fixtures, so the kill-vs-rewrite split is honest — not a mock of
 *      the router's output. This proves:
 *        - kill = TERMINAL HALT (does NOT loop; roadmap init NOT spawned).
 *        - rewrite-think = BOUNDED re-enter, at most `maxThinkRewrites` gate runs
 *          (no infinite spin), then a bound escalation (roadmap init NOT spawned).
 *        - proceed / --force / --no-think-review / no-doc → roadmap init spawned.
 *        - a LoopBack row is written per attempt (audit trail).
 *
 *   2. A THIN, HERMETIC e2e SMOKE. The driver is wrapped with real fs writes to a
 *      temp `.plan-execution/ephemeral/think-review/` dir and a "roadmap init"
 *      sentinel. It asserts the OBSERVABLE signals on disk: on kill/rewrite the
 *      roadmap-init sentinel is ABSENT while the LoopBack/halt state IS written;
 *      the loopback file count is bounded. It does NOT spawn the real pipeline.
 *
 *   3. SPEC assertions binding the acceptance criteria to commands/loom-auto.md.
 *
 * Run: bunx vitest run tests/e2e/thinking-gate-auto.test.ts
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  routeThinkReview,
  type RouteThinkReviewOptions,
} from "../../scripts/lib/think-review-router.js";
import { atomicWriteText } from "../../lib/index.js";
import type {
  LoopBack,
  PrePlanLensPanel,
  ThinkReviewFinding,
  ThinkReviewVerdict,
} from "../../lib/types.js";

const REPO_ROOT = resolve(__dirname, "../..");
const AUTO_PATH = join(REPO_ROOT, "commands/loom-auto.md");

// ── Router-backed verdict fixtures ───────────────────────────────────────────
// A web-app panel (4 lenses), all reporting → quorum met. The verdicts below are
// produced by the REAL router so the branch logic is tested against real output.

const PANEL: PrePlanLensPanel = {
  selections: [
    {
      archetype: "web-app",
      lenses: ["eng", "devex", "ceo", "design"],
      rationale: "web-app",
    },
  ],
  resolvedArchetype: "web-app",
  activeLenses: ["eng", "devex", "ceo", "design"],
};

const FIXED_NOW = () => new Date("2026-07-05T10:00:00.000Z");

function routerOpts(over: Partial<RouteThinkReviewOptions> = {}): RouteThinkReviewOptions {
  return {
    reportingLenses: 4,
    revisionCount: 0,
    docPath: ".loom/thinks/idea-2026-07-05T10-00-00.md",
    now: FIXED_NOW,
    ...over,
  };
}

/** Non-fixable blocking finding → the router returns `kill`. */
const KILL_FINDINGS: ThinkReviewFinding[] = [
  {
    id: "F-01",
    lens: "eng",
    severity: "blocking",
    confidence: 9,
    fixable: false,
    remediation: "Archive and re-scope — no fix within this framing.",
    message: "The event-sourced design contradicts the single-writer requirement.",
  },
];

/** Fixable blocking finding → the router returns `rewrite-think`. */
const REWRITE_FINDINGS: ThinkReviewFinding[] = [
  {
    id: "F-02",
    lens: "ceo",
    severity: "warning",
    confidence: 7,
    fixable: true,
    remediation: "Add a positioning paragraph naming the 2 closest competitors.",
    message: "Think doc asserts differentiation but names no reference product.",
  },
];

/** No findings, quorum met → the router returns `proceed`. */
const PROCEED_FINDINGS: ThinkReviewFinding[] = [];

function killVerdict(attempt: number): ThinkReviewVerdict {
  return routeThinkReview(KILL_FINDINGS, PANEL, routerOpts({ revisionCount: attempt - 1 }));
}
function rewriteVerdict(attempt: number): ThinkReviewVerdict {
  return routeThinkReview(REWRITE_FINDINGS, PANEL, routerOpts({ revisionCount: attempt - 1 }));
}
function proceedVerdict(attempt: number): ThinkReviewVerdict {
  return routeThinkReview(PROCEED_FINDINGS, PANEL, routerOpts({ revisionCount: attempt - 1 }));
}

// Sanity: the fixtures actually produce the decisions the branch logic keys on.
describe("router-backed verdict fixtures produce the expected decisions", () => {
  it("KILL_FINDINGS → kill", () => {
    expect(killVerdict(1).decision).toBe("kill");
  });
  it("REWRITE_FINDINGS → rewrite-think", () => {
    expect(rewriteVerdict(1).decision).toBe("rewrite-think");
  });
  it("PROCEED_FINDINGS → proceed", () => {
    expect(proceedVerdict(1).decision).toBe("proceed");
  });
});

// ── The decision unit: a pure model of Step 0.75b/c/d/e ───────────────────────
// This mirrors the loom-auto.md gate loop 1:1. It is intentionally a pure
// function (no I/O) so the branch logic can be asserted directly; the e2e smoke
// below wraps it with real fs writes for the on-disk observable signals.

type GateAction = "skipped" | "proceed" | "kill-halt" | "rewrite-bound-escalation";

interface DriveResult {
  action: GateAction;
  /** One LoopBack row per gate run (the audit trail). */
  attempts: LoopBack[];
  /** OBSERVABLE signal: would /loom-roadmap init be spawned after the gate? */
  roadmapInitSpawned: boolean;
  /** Signals /loom-roadmap review to skip its strategic lenses (C-09). */
  thinkReviewed: boolean;
  /** Number of `/loom-think --from` re-think spawns (bounded by maxThinkRewrites-1). */
  rewriteSpawns: number;
  /** True when --force overrode enforcement. */
  forced: boolean;
}

interface DriveOptions {
  noThinkReview?: boolean;
  /** Whether a .loom/thinks/ doc resolved on the branch. */
  thinkDocResolved?: boolean;
  force?: boolean;
  maxThinkRewrites?: number;
  /** Produces the verdict for a given attempt (the real gate run). */
  runGate: (attempt: number) => ThinkReviewVerdict;
  now?: () => Date;
  /** Optional per-attempt side-effect (used by the e2e smoke to write files). */
  onAttempt?: (row: LoopBack, verdict: ThinkReviewVerdict) => void;
}

/**
 * Pure model of the /loom-auto pre-plan thinking gate (commands/loom-auto.md
 * Step 0.75). Bounded by construction: it runs the gate at most
 * `maxThinkRewrites` times before it MUST resolve to proceed, kill, or a bound
 * escalation. `kill` is terminal (breaks on attempt 1, never loops).
 */
function driveThinkGate(opts: DriveOptions): DriveResult {
  const maxThinkRewrites = opts.maxThinkRewrites ?? 2;
  const now = opts.now ?? FIXED_NOW;
  const attempts: LoopBack[] = [];
  let rewriteSpawns = 0;

  const record = (attempt: number, verdict: ThinkReviewVerdict, reason: string): LoopBack => {
    const row: LoopBack = {
      attempt,
      verdict: verdict.decision,
      reason,
      decidedAt: now().toISOString(),
    };
    attempts.push(row);
    opts.onAttempt?.(row, verdict);
    return row;
  };

  // 0.75a — skip conditions (no gate; proceed straight to roadmap).
  if (opts.noThinkReview) {
    return {
      action: "skipped",
      attempts,
      roadmapInitSpawned: true,
      thinkReviewed: false,
      rewriteSpawns: 0,
      forced: false,
    };
  }
  if (opts.thinkDocResolved === false) {
    return {
      action: "skipped",
      attempts,
      roadmapInitSpawned: true,
      thinkReviewed: false,
      rewriteSpawns: 0,
      forced: false,
    };
  }

  // 0.75b — bounded rewrite loop.
  // Hard structural bound: the `attempt <= maxThinkRewrites` guard guarantees the
  // loop cannot spin. A defensive cap throws if the invariant is ever broken.
  for (let attempt = 1; attempt <= maxThinkRewrites; attempt++) {
    const verdict = opts.runGate(attempt);

    // 0.75.4 — --force override: run once for the audit trail, do NOT enforce.
    if (opts.force) {
      record(attempt, verdict, "--force override (gate not enforced)");
      return {
        action: "proceed",
        attempts,
        roadmapInitSpawned: true,
        thinkReviewed: true,
        rewriteSpawns,
        forced: true,
      };
    }

    if (verdict.decision === "proceed") {
      record(attempt, verdict, "framing sound");
      return {
        action: "proceed",
        attempts,
        roadmapInitSpawned: true,
        thinkReviewed: true,
        rewriteSpawns,
        forced: false,
      };
    }

    if (verdict.decision === "kill") {
      // 0.75c — TERMINAL HALT. Distinct from rewrite: does NOT loop.
      record(attempt, verdict, "non-fixable approach error — halt");
      return {
        action: "kill-halt",
        attempts,
        roadmapInitSpawned: false,
        thinkReviewed: false,
        rewriteSpawns,
        forced: false,
      };
    }

    // rewrite-think
    if (attempt >= maxThinkRewrites) {
      // 0.75d — bound escalation (does not loop past the cap).
      record(attempt, verdict, `rewrite bound reached (${maxThinkRewrites} attempts) — escalating`);
      return {
        action: "rewrite-bound-escalation",
        attempts,
        roadmapInitSpawned: false,
        thinkReviewed: false,
        rewriteSpawns,
        forced: false,
      };
    }
    // bound not reached — re-think and loop.
    record(attempt, verdict, "fixable defect, re-thinking");
    rewriteSpawns++;
  }

  // Unreachable: the loop always returns within the bound.
  throw new Error("driveThinkGate exceeded the rewrite bound — loop is not bounded");
}

// ── 1. Decision-unit tests on the branch logic ───────────────────────────────

describe("AC2 — bounded loop + kill-vs-rewrite decision", () => {
  it("proceed → roadmap init IS spawned, thinkReviewed set, 1 LoopBack row", () => {
    const r = driveThinkGate({ runGate: proceedVerdict, thinkDocResolved: true });
    expect(r.action).toBe("proceed");
    expect(r.roadmapInitSpawned).toBe(true);
    expect(r.thinkReviewed).toBe(true);
    expect(r.attempts).toHaveLength(1);
    expect(r.attempts[0].verdict).toBe("proceed");
  });

  it("kill → TERMINAL HALT: roadmap init NOT spawned, exactly 1 attempt (does not loop)", () => {
    const r = driveThinkGate({ runGate: killVerdict, thinkDocResolved: true, maxThinkRewrites: 2 });
    expect(r.action).toBe("kill-halt");
    expect(r.roadmapInitSpawned).toBe(false);
    // kill is distinct from rewrite — it must NOT consume the rewrite budget.
    expect(r.attempts).toHaveLength(1);
    expect(r.attempts[0].verdict).toBe("kill");
    expect(r.rewriteSpawns).toBe(0);
  });

  it("persistent rewrite-think → BOUNDED: exactly maxThinkRewrites runs, then escalation, no roadmap init", () => {
    const r = driveThinkGate({ runGate: rewriteVerdict, thinkDocResolved: true, maxThinkRewrites: 2 });
    expect(r.action).toBe("rewrite-bound-escalation");
    expect(r.roadmapInitSpawned).toBe(false);
    // Bounded: at most maxThinkRewrites gate runs (no infinite spin).
    expect(r.attempts).toHaveLength(2);
    expect(r.attempts.every((a) => a.verdict === "rewrite-think")).toBe(true);
    // One re-think spawn between the two gate runs (attempt 1 → 2), none after the cap.
    expect(r.rewriteSpawns).toBe(1);
  });

  it("bound scales with config N (default 2, honors a larger maxThinkRewrites)", () => {
    const r = driveThinkGate({ runGate: rewriteVerdict, thinkDocResolved: true, maxThinkRewrites: 4 });
    expect(r.attempts).toHaveLength(4);
    expect(r.action).toBe("rewrite-bound-escalation");
  });

  it("rewrite-think then proceed within the bound → loops once, then proceeds", () => {
    const runGate = (attempt: number) => (attempt === 1 ? rewriteVerdict(attempt) : proceedVerdict(attempt));
    const r = driveThinkGate({ runGate, thinkDocResolved: true, maxThinkRewrites: 3 });
    expect(r.action).toBe("proceed");
    expect(r.roadmapInitSpawned).toBe(true);
    expect(r.attempts.map((a) => a.verdict)).toEqual(["rewrite-think", "proceed"]);
    expect(r.rewriteSpawns).toBe(1);
  });

  it("kill is reached before the bound and halts even if budget remained", () => {
    // attempt 1 rewrite, attempt 2 kill, with budget 3 — kill still terminal at attempt 2.
    const runGate = (attempt: number) => (attempt === 1 ? rewriteVerdict(attempt) : killVerdict(attempt));
    const r = driveThinkGate({ runGate, thinkDocResolved: true, maxThinkRewrites: 3 });
    expect(r.action).toBe("kill-halt");
    expect(r.roadmapInitSpawned).toBe(false);
    expect(r.attempts).toHaveLength(2);
    expect(r.attempts[1].verdict).toBe("kill");
  });
});

describe("AC1 — override + skip flags", () => {
  it("--force proceeds past a kill verdict (does not enforce), still records a LoopBack row", () => {
    const r = driveThinkGate({ runGate: killVerdict, thinkDocResolved: true, force: true });
    expect(r.action).toBe("proceed");
    expect(r.forced).toBe(true);
    expect(r.roadmapInitSpawned).toBe(true);
    // Audit trail is still written under --force (one attempt, no loop).
    expect(r.attempts).toHaveLength(1);
  });

  it("--force proceeds past a rewrite-think verdict without looping", () => {
    const r = driveThinkGate({ runGate: rewriteVerdict, thinkDocResolved: true, force: true, maxThinkRewrites: 2 });
    expect(r.action).toBe("proceed");
    expect(r.roadmapInitSpawned).toBe(true);
    expect(r.attempts).toHaveLength(1);
  });

  it("--no-think-review skips the gate entirely → roadmap init spawned, no attempts", () => {
    const r = driveThinkGate({ runGate: killVerdict, thinkDocResolved: true, noThinkReview: true });
    expect(r.action).toBe("skipped");
    expect(r.roadmapInitSpawned).toBe(true);
    expect(r.thinkReviewed).toBe(false);
    expect(r.attempts).toHaveLength(0);
  });

  it("no think doc on branch → clean no-op skip (proceed), never an error", () => {
    const r = driveThinkGate({ runGate: killVerdict, thinkDocResolved: false });
    expect(r.action).toBe("skipped");
    expect(r.roadmapInitSpawned).toBe(true);
    expect(r.attempts).toHaveLength(0);
  });
});

// ── 2. Thin, hermetic e2e smoke — observable on-disk signals ──────────────────

/** Minimal LoopBack TOON serializer (matches the block in loom-auto.md Step 0.75.3). */
function serializeLoopBack(row: LoopBack): string {
  return [
    `attempt: ${row.attempt}`,
    `verdict: ${row.verdict}`,
    `reason: ${JSON.stringify(row.reason)}`,
    `decidedAt: ${row.decidedAt}`,
    "",
  ].join("\n");
}

describe("e2e smoke — the gate writes bounded audit state and gates roadmap init on disk", () => {
  let workDir = "";
  let reviewDir = "";
  const roadmapInitSentinel = () => join(workDir, ".plan-execution", "roadmap-init-spawned");

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "loom-think-gate-"));
    reviewDir = join(workDir, ".plan-execution", "ephemeral", "think-review");
    mkdirSync(reviewDir, { recursive: true });
  });

  /** Runs the gate with real fs side-effects and simulates the roadmap-init spawn. */
  function runGateToDisk(opts: DriveOptions): DriveResult {
    const dir = join(workDir, ".plan-execution", "ephemeral", "think-review");
    // clean slate per run
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    if (existsSync(roadmapInitSentinel())) rmSync(roadmapInitSentinel());

    const r = driveThinkGate({
      ...opts,
      onAttempt: (row) => {
        atomicWriteText(join(dir, `loopback-${row.attempt}.toon`), serializeLoopBack(row));
      },
    });

    if (r.action === "kill-halt" || r.action === "rewrite-bound-escalation") {
      // Halt state (0.75c / 0.75d) — no roadmap init.
      atomicWriteText(
        join(workDir, ".plan-execution", "escalation-report.md"),
        `## Escalation Report\n\nStage: think-gate\nOutcome: ${r.action}\nAttempts: ${r.attempts.length}\n`,
      );
    } else {
      // proceed/skipped — roadmap init is spawned next.
      writeFileSync(roadmapInitSentinel(), "spawned");
    }
    return r;
  }

  it("kill: roadmap-init sentinel ABSENT, exactly one loopback file + escalation report on disk", () => {
    const r = runGateToDisk({ runGate: killVerdict, thinkDocResolved: true, maxThinkRewrites: 2 });
    expect(r.action).toBe("kill-halt");
    expect(existsSync(roadmapInitSentinel())).toBe(false);
    const loopbacks = readdirSync(reviewDir).filter((f) => f.startsWith("loopback-"));
    expect(loopbacks).toHaveLength(1); // kill does not loop
    expect(readFileSync(join(reviewDir, "loopback-1.toon"), "utf8")).toMatch(/verdict: kill/);
    expect(existsSync(join(workDir, ".plan-execution", "escalation-report.md"))).toBe(true);
  });

  it("persistent rewrite: roadmap-init sentinel ABSENT, loopback file count == N (bounded)", () => {
    const N = 2;
    const r = runGateToDisk({ runGate: rewriteVerdict, thinkDocResolved: true, maxThinkRewrites: N });
    expect(r.action).toBe("rewrite-bound-escalation");
    expect(existsSync(roadmapInitSentinel())).toBe(false);
    const loopbacks = readdirSync(reviewDir).filter((f) => f.startsWith("loopback-"));
    expect(loopbacks).toHaveLength(N); // bounded — no infinite spin on disk
  });

  it("proceed: roadmap-init sentinel PRESENT and a loopback row was written", () => {
    const r = runGateToDisk({ runGate: proceedVerdict, thinkDocResolved: true });
    expect(r.action).toBe("proceed");
    expect(existsSync(roadmapInitSentinel())).toBe(true);
    const loopbacks = readdirSync(reviewDir).filter((f) => f.startsWith("loopback-"));
    expect(loopbacks).toHaveLength(1);
  });
});

// ── 3. Spec assertions — bind the ACs to commands/loom-auto.md ────────────────

describe("commands/loom-auto.md spec wiring", () => {
  let content = "";
  beforeAll(() => {
    content = readFileSync(AUTO_PATH, "utf8");
  });

  it("the gate is inserted BEFORE roadmap creation (Step 0.75 precedes Step 1)", () => {
    const gateIdx = content.indexOf("Step 0.75");
    const roadmapIdx = content.indexOf("#### Step 1: Roadmap Creation");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(roadmapIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(roadmapIdx);
  });

  it("invokes /loom-think:review on the newest .loom/thinks/ doc", () => {
    expect(content).toMatch(/loom-think\/review\.md|\/loom-think:review/);
    expect(content).toMatch(/\.loom\/thinks/);
  });

  it("AC1: --no-think-review skips the gate; --force proceeds past a verdict (not enforced)", () => {
    expect(content).toMatch(/--no-think-review/);
    expect(content).toMatch(/--force/);
    expect(content).toMatch(/not enforced|do NOT enforce|does NOT enforce|gate not enforced/i);
  });

  it("AC1: sets --think-reviewed / relies on the canonical verdict artifact to avoid double-run", () => {
    expect(content).toMatch(/--think-reviewed/);
    expect(content).toMatch(/\.plan-execution\/ephemeral\/think-review\/verdict\.toon/);
  });

  it("AC2: bounded loop with a config default of 2 (maxThinkRewrites)", () => {
    expect(content).toMatch(/maxThinkRewrites/);
    expect(content).toMatch(/default:? 2|default 2/);
    expect(content).toMatch(/orchestration\.toml/);
    expect(content).toMatch(/thinkReview/);
  });

  it("AC2: kill HALTS with an operator handoff and does NOT loop (distinct from rewrite)", () => {
    expect(content).toMatch(/kill/i);
    expect(content).toMatch(/HALT|halt/);
    expect(content).toMatch(/does NOT loop|terminal|not loop/i);
    expect(content).toMatch(/operator handoff|handoff/i);
  });

  it("AC2: writes a LoopBack{attempt,verdict,reason,decidedAt} per attempt", () => {
    expect(content).toMatch(/LoopBack/);
    expect(content).toMatch(/attempt/);
    expect(content).toMatch(/verdict/);
    expect(content).toMatch(/reason/);
    expect(content).toMatch(/decidedAt/);
  });

  it("AC3: rewrite bound is escalated (not spun) after maxThinkRewrites", () => {
    expect(content).toMatch(/bound/i);
    expect(content).toMatch(/escalat/i);
  });
});
