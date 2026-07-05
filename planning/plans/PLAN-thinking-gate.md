---
planVersion: 2
name: "Thinking Gate"
status: draft
created: 2026-07-04
lastReviewed: 2026-07-05
reviewRef: planning/history/reviews/2026-07-05-thinking-gate-review.toon
roadmapRef: planning/ROADMAP-thinking-gate.md
seededFrom: .loom/thinks/thinking-formality-separation-2026-07-04T21-12-44.md
totalPhases: 8
totalWaves: 4
---

# Plan: Thinking Gate

> Revised 2026-07-05 per the 8-agent review (HOLD, 5 blocking). All 10 revisions applied: fail-closed router + closed enums + synthesis rule (blocking); file-based subcommand dissolves the loom-think.md collision (blocking); bounded loop + kill-halts (blocking); repo-tracked 3-file benchmark registration (blocking); repo-source not HOME artifact (blocking); nextCommand verdicts; mandatory named cross-model (not fable); mode-param not forked agents; conditional roadmap lenses; P0 archetype-selection rule; P6 split; changelog/audit step; structural+mocked test strategy.

## Overview

Builds M-14/M-15/B: a pre-plan thinking-review gate at the divergent→formality seam. Reviews the *converged* `.loom/thinks/` doc (C-01), routes deterministically and **fail-closed** (C-02), opt-in for humans and default-on for `/loom-auto` with a bounded loop + kill-halt + override (C-03). Reuses the crossing artifact and the M-04 lenses via an altitude mode (C-04) — minimal new surface. Foundation-first: contracts + the archetype-selection rule + closed enums in Wave 0. A (the `/loom-plan review` 6→10 fix) shipped on this branch (62a106b) and was validated 2026-07-05 when eng+devex ran by default in this plan's own review.

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Commands | Markdown under `commands/` | file-based subcommand: `commands/loom-think/review.md` → `/loom-think:review` for free (no dispatch edit) |
| Agents | `agents/plan-{eng,devex,ceo,design}-review-agent.md` (altitude mode) + new `agents/benchmark-agent.md` | reuse via a scope param; register new agent + `model:` frontmatter |
| Patterns | pattern rail — REPO source | `protocols/pattern-executor.md` + `protocols/orchestration-patterns.md` + `.claude/orchestration.toml` `[patterns.benchmark]` (all three) |
| Router | pure testable unit | closed-enum findings → decision table → verdict+nextCommand; fail-closed on no-quorum |
| Data format | TOON v1 | ThinkReviewVerdict, BenchmarkScorecard, LoopBack |
| Testing | Vitest | structural (parse .md) + mocked-router unit (fixture findings) + one kill-specific fixture; e2e smoke only for the auto loop |

## Shared surfaces (single-owner, verified)
`commands/loom-think/review.md` (P1; P4 swaps panel — cross-wave), `skills/loom-think/SKILL.md` (P2 only — the marker; **no phase edits `commands/loom-think.md`**), `commands/loom-roadmap/review.md` (P3), `protocols/pattern-executor.md`+`protocols/orchestration-patterns.md`+`.claude/orchestration.toml` (P5), `agents/plan-*-review-agent.md` (P4), `commands/loom-auto.md` (P6a), `commands/loom-do.md`+`loom-which.md`+README (P6b), `protocols/*`+`lib/types.ts`+`skills/library.yaml` (P0).

---

### Phase 0 — Wave 0: Contracts, closed enums, archetype rule, benchmark math

**Agent:** contracts-agent
**Objective:** All contracts with **closed** enums + the archetype→lens **selection rule** (not just the type) + typed benchmark math. Pre-register the new benchmark resources so later waves never touch `library.yaml`.
**Dependencies:** none
**File Ownership:** `protocols/think-review.schema.md`, `protocols/benchmark-scorecard.schema.md`, `lib/types.ts` (append `ThinkReviewVerdict`, `BenchmarkScorecard`, `PrePlanLensPanel`, `LoopBack`), `skills/library.yaml` (register the 2 protocols + pre-register `benchmark-agent`), `planning/history/changelog.md` (append)

#### Acceptance Criteria
- [ ] `ThinkReviewVerdict.findings[].severity` is a **closed enum** `blocking|warning|info` (aligned to AgentResult); `lens` is closed `eng|devex|ceo|design`; each finding has `fixable:boolean` + `remediation`. Verdict has required `nextCommand`, `decidedBy`, `revisionCount`. `tsc` = 0.
- [ ] The **decision table** (C-02) is specified: (non-fixable blocking → kill), (fixable blocking | any warning → rewrite-think), (none → proceed), (no-quorum → `PANEL_INCOMPLETE` blocking → rewrite-think). No "MAY".
- [ ] The **archetype→lens selection rule** is authored in `PrePlanLensPanel` (a table P1/P3/P4 all consume), not just the type shell.
- [ ] `BenchmarkScorecard` is typed: `selfScore/refScore 0..10`, `gap = selfScore − refScore`, `overall = mean(dimensions)`, `references[]` (N), per-dimension `sourceRefs[]`. "Thin" is defined (e.g. `dimensions.length < 3` or any `refScore` unsourced).
- [ ] Changelog entry appended (R-001 audit).

---

### Phase 1 — Wave 1: /loom-think:review command + fail-closed router

**Agent:** implementer-agent
**Objective:** The file-based subcommand + a pure, deterministic, fail-closed router. **Create `commands/loom-think/review.md`** — it auto-resolves as `/loom-think:review` (mirroring `commands/loom-plan/review.md`); **do NOT edit `commands/loom-think.md`** (avoids the ownership collision AND preserves the existing `/loom-think` interview entry's `agent:` frontmatter). For M-14 the panel spawns the M-04 agents as-is (Wave 2 adds the altitude mode).
**Dependencies:** Phase 0
**File Ownership:** `commands/loom-think/review.md` (new), `scripts/lib/think-review-router.ts` (pure mapping unit), `tests/scripts/think-review-router.test.ts`, `tests/commands/loom-think-review.test.ts`

#### Acceptance Criteria
- [ ] `/loom-think:review [<doc>]` resolves the newest doc on a branch (or explicit path); **empty state** (no doc) prints `no think doc on branch X — run /loom-think first`, exit non-zero (not a stack trace).
- [ ] The router is a **pure function** (`scripts/lib/think-review-router.ts`) over `findings[]`: implements the C-02 decision table, **any-blocking-wins**, **quorum** (≥⌈M/2⌉ lenses), and **fails closed** (no-quorum/empty-because-crashed → `rewrite-think`, never `proceed`). Unit-tested over fixtures incl. a crashed-panel case.
- [ ] A seeded-bad think doc (approach-error class) routes to rewrite/kill **naming the defect**; a **separate fixture MUST route specifically to `kill`** (not "rewrite or kill").
- [ ] Every verdict carries `nextCommand` (proceed→`/loom-roadmap init`; rewrite-think→`/loom-think --from <doc>`; kill→archive guidance).
- [ ] Opt-in: NOT required before `/loom-roadmap init` for humans.

---

### Phase 2 — Wave 1: Mandatory named cross-model second opinion

**Agent:** implementer-agent
**Objective:** Consume the inert `Cross-model review: PENDING` marker in `skills/loom-think/SKILL.md` (~line 97) via a real second-opinion pass from a **named** second model (non-Claude family or a distinct tier — **never `fable`**), surfacing divergence as a finding. Skill-only — does NOT touch `commands/loom-think.md`.
**Dependencies:** Phase 0
**File Ownership:** `skills/loom-think/SKILL.md`, `tests/skills/loom-think-marker.test.ts`

#### Acceptance Criteria
- [ ] The marker is no longer inert: a structural test asserts the "Do NOT auto-invoke…" instruction (SKILL.md ~:97) is replaced with an active consumption step naming the second model and that the marker string only co-occurs with a handler reference.
- [ ] The second model is named and is not `fable` (per memory `feedback_fable_for_planning`); divergence between opinions is emitted as a finding consumed by the router.

---

### Phase 3 — Wave 1: Conditional strategic lenses at /loom-roadmap review

**Agent:** implementer-agent
**Objective:** Add the 4 M-04 lenses to `/loom-roadmap review` (today 4 non-strategic agents), fired **only when think-review was skipped** (human path, C-09) so `/loom-auto` never double-runs them. Copies the A-fix pattern; fixes the existing "4"-vs-actual drift.
**Dependencies:** Phase 0
**File Ownership:** `commands/loom-roadmap/review.md`, `tests/commands/loom-roadmap-review-lenses.test.ts`

#### Acceptance Criteria
- [ ] The 4 lenses are added (archetype-selected via the P0 rule) and gated on a "think-review not run" condition; the description/prose/synthesis/`agents[N]` table are updated (no bare "4" drift — the same class A fixed at `commands/loom-plan/review.md:9`; drift sites here: lines 2, 7, 63, 107-115).
- [ ] A structural test asserts the agent count and table match, and that the lenses are conditional.

---

### Phase 4 — Wave 2: Think-altitude mode on the M-04 lenses + panel wiring

**Agent:** implementer-agent
**Objective:** Add a scope/altitude parameter to the 4 existing `plan-{eng,devex,ceo,design}-review-agent.md` so they review a think doc's *framing* (problem clarity, approach soundness, gap-closure, benchmark presence) rather than phases/waves — **no forked agent files** (C-04). Wire them as `/loom-think:review`'s panel and fold in the benchmark-presence check (moved here from P5).
**Dependencies:** Phase 1, Phase 5
**File Ownership:** `agents/plan-eng-review-agent.md`, `agents/plan-devex-review-agent.md`, `agents/plan-ceo-review-agent.md`, `agents/plan-design-review-agent.md`, `commands/loom-think/review.md` (panel swap + benchmark-presence check), `tests/agents/think-altitude.test.ts`

#### Acceptance Criteria
- [ ] Each M-04 agent accepts a `think`/framing altitude and reviews framing at that altitude; `/loom-think:review` uses them; the seeded-bad + kill-specific fixtures still route correctly.
- [ ] The benchmark-presence check lives in this panel (reads the `BenchmarkScorecard` from the think doc; a missing/thin one is a finding). No new agent files created.

---

### Phase 5 — Wave 1: --benchmark pattern (repo-registered, 3 files) + benchmark-agent

**Agent:** implementer-agent
**Objective:** Register the `--benchmark` pattern in the **repo source** (not the empty `~/.claude/protocols/`), across all three required files, and ship a new `benchmark-agent` that runs on a bare idea (unlike plan-scoped `feature-coverage-agent`) and writes a typed `BenchmarkScorecard` into the think doc.
**Dependencies:** Phase 0
**File Ownership:** `protocols/pattern-executor.md` (add `### Benchmark` execution section), `protocols/orchestration-patterns.md` (pattern definition), `.claude/orchestration.toml` (`[patterns.benchmark]` + `trigger`), `agents/benchmark-agent.md` (new — `model:` frontmatter), `tests/patterns/benchmark.test.ts`

#### Acceptance Criteria
- [ ] All three registration files are edited; a test asserts `[patterns.benchmark]` with a `trigger` exists and the pattern-executor has a matching section — so `--benchmark` is NOT inert (no fallback to default single-agent spawn).
- [ ] `benchmark-agent` (registered in `library.yaml` at P0, `model:` frontmatter resolved) writes a typed `BenchmarkScorecard` (0..10, sourceRefs, N references) into the think doc; runs pre-roadmap on a bare idea.
- [ ] Name collision avoided (`loom-benchmark` perf skill untouched).

---

### Phase 6a — Wave 3: /loom-auto bounded gate + kill-halt + override

**Agent:** implementer-agent
**Objective:** Insert `/loom-think:review` before roadmap-init in the `/loom-auto` pipeline (the step list in `commands/loom-auto.md` ~L113, before "1. Roadmap Creation"), with a **bounded** rewrite loop, `kill`→**HALT**, `--no-think-review`/`--force`, and a persisted `LoopBack` audit trail.
**Dependencies:** Phase 4, Phase 5
**File Ownership:** `commands/loom-auto.md`, `tests/e2e/thinking-gate-auto.test.ts`

#### Acceptance Criteria
- [ ] The gate runs before roadmap init by default; `--no-think-review` skips it; `--force` proceeds past a verdict.
- [ ] `rewrite-think` re-thinks up to N (config default 2) then escalates; `kill` HALTS with an operator handoff (does NOT loop — distinct from rewrite). A `LoopBack{attempt,verdict,reason,decidedAt}` artifact is written per attempt.
- [ ] The e2e test asserts an observable signal: on kill/rewrite, `/loom-roadmap init` is NOT spawned and the `LoopBack`/halt state is written; the loop is bounded (no infinite spin). Prefer a decision-unit test on the branch logic + a thin e2e smoke.

---

### Phase 6b — Wave 3: Router surface + docs

**Agent:** implementer-agent
**Objective:** Make the gate discoverable and documented.
**Dependencies:** Phase 4
**File Ownership:** `commands/loom-do.md`, `commands/loom-which.md`, `README` (thinking-gate section)

#### Acceptance Criteria
- [ ] `/loom-do` + `/loom-which` route to `/loom-think:review`; `/loom-think` surfaces "suggested next: `/loom-think:review` (optional pre-plan gate)".
- [ ] README documents the divergent→gate→formality flow with a **runnable** worked example (a real `.loom/thinks/` doc → the exact verdict output), per the docs-must-keep-pace standard; a CHANGELOG note flags the new `/loom-auto` default.

## Wave map (re-leveled)
```
Wave 0: P0 (contracts + archetype rule + closed enums + benchmark math + pre-register benchmark-agent)
Wave 1: P1 ∥ P2 ∥ P3 ∥ P5   (all dep P0; disjoint: loom-think/review.md · loom-think SKILL · loom-roadmap/review.md · pattern-executor+orchestration+benchmark-agent)
Wave 2: P4                   (dep P1 + P5; owns the M-04 agents + the review.md panel swap)
Wave 3: P6a ∥ P6b            (dep P4[+P5]; disjoint: loom-auto.md · loom-do/which+README)
```
Critical path: `P0 → P1 → P4 → P6a`. No phase edits `commands/loom-think.md` (the collision is dissolved by the file-based subcommand). Every same-wave phase owns disjoint files (verified).

## Validation Spikes (front-loaded)
- **In P1:** the pure router unit + the seeded-bad + kill-specific fixtures FIRST — the whole thesis rides on the router naming a defect and failing closed.
- **In P5:** confirm `orchestration.toml` `[patterns.*]` + `pattern-executor.md` actually wire a new trigger before building `benchmark-agent` (else the flag is inert).

## Verification Commands
```bash
bunx tsc --noEmit -p hooks/tsconfig.json
bunx vitest run tests/scripts tests/commands tests/agents tests/patterns tests/skills tests/e2e
grep -rn "commands/loom-think.md" planning/plans/PLAN-thinking-gate.md   # expect: no phase owns it
# router fails closed: a crashed-panel fixture must yield rewrite-think, never proceed
```

## Non-Goals
New design-brief schema; namespace split; typed explore/debate/prototype handoffs; standalone `/loom-compete`; numeric readiness scoring; a fully sequenced CEO→Design→Eng cascade (parallel panel + any-blocking-wins for v1).
