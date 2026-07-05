---
planVersion: 2
name: "Thinking Gate"
status: draft
created: 2026-07-04
lastReviewed: null
roadmapRef: planning/ROADMAP-thinking-gate.md
seededFrom: .loom/thinks/thinking-formality-separation-2026-07-04T21-12-44.md
totalPhases: 7
totalWaves: 4
---

# Plan: Thinking Gate

## Overview

Builds the previously-designed-but-unbuilt M-14/M-15 (plus B): a pre-plan **thinking-review gate** at the divergent→formality seam, strategic lenses at both early stages, and competitive benchmarking moved before the roadmap. Reviews the *converged* think doc (not the brainstorm), routes via agent-judgment (`proceed | rewrite-think | kill`), opt-in for operators and default-on for `/loom-auto`. Reuses the existing `.loom/thinks/` crossing artifact and the M-04 lens agents — minimal new surface. Foundation-first: contracts in Wave 0; the `/loom-think:review` command in Wave 1 runs the existing M-04 agents as-is, and Wave 2 refines them into think-scoped variants. A (the `/loom-plan review` 6→10 doc fix) already shipped on this branch (commit 62a106b).

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Commands | Markdown prompt files under `commands/` | new `commands/loom-think/review.md` |
| Agents | Markdown agent files under `agents/` | reuse `plan-{eng,devex,ceo,design}-review-agent.md`, add think-scoped variants |
| Patterns | pattern-executor rail (`--debate/--vote/--chain`) | new `--benchmark` pattern |
| Data format | TOON v1 | ThinkReviewVerdict, BenchmarkScorecard, lens-panel |
| Testing | Vitest | fixture think docs (good + seeded-bad), command-behavior tests |

## Shared surfaces (single-owner)
`commands/loom-think.md` + `skills/loom-think/SKILL.md` (P2), `commands/loom-think/review.md` (P1, new), `commands/loom-roadmap/review.md` (P3), the pattern-flag rail + `~/.claude/protocols/pattern-executor.md` (P5), `commands/loom-auto*` + docs (P6). Contracts in `protocols/` + `lib/types.ts` (P0).

---

### Phase 0 — Wave 0: Contracts

**Agent:** contracts-agent
**Objective:** Schemas + types for the verdict, the benchmark scorecard, and the archetype lens-panel selection.
**Dependencies:** none
**File Ownership:** `protocols/think-review.schema.md`, `protocols/benchmark-scorecard.schema.md`, `lib/types.ts` (append `ThinkReviewVerdict`, `BenchmarkScorecard`, `PrePlanLensPanel`), `skills/library.yaml` (register the 2 protocols)

#### Acceptance Criteria
- [ ] `ThinkReviewVerdict{docRef, verdict(proceed|rewrite-think|kill), findings[]{lens,severity,message}, decidedAt}` and `BenchmarkScorecard{reference, dimensions[]{name,selfScore,refScore,gap}, overall}` exist and typecheck (`tsc` = 0).
- [ ] The verdict→severity mapping rule (C-02) is documented: any `blocking` finding → the router MAY return `kill`; `warning`-only fixable → `rewrite-think`; none → `proceed`.
- [ ] Protocols registered under `library.protocols:`.

---

### Phase 1 — Wave 1: /loom-think:review command + router

**Agent:** implementer-agent
**Objective:** New subcommand that runs a lens panel over a `.loom/thinks/` doc and maps findings to `{proceed | rewrite-think | kill}` (agent-judgment rubric, C-02), writing a `ThinkReviewVerdict`. For M-14 it spawns the existing M-04 `plan-{eng,devex,ceo,design}-review-agent`s (archetype-selected), pointed at the think doc; Wave 2 adds think-scoped variants.
**Dependencies:** Phase 0
**File Ownership:** `commands/loom-think/review.md` (new), `commands/loom-think.md` (add the `review` subcommand to dispatch), `tests/commands/loom-think-review.test.ts`

#### Acceptance Criteria
- [ ] `/loom-think:review <doc>` resolves the newest doc on a branch (or an explicit path), spawns the archetype-selected lenses in parallel, synthesizes findings, and writes a `ThinkReviewVerdict`.
- [ ] Router mapping proven by fixtures: a seeded-bad think doc (an approach flaw of the `launch()`-vs-`connectOverCDP` class) yields `rewrite-think` or `kill` **naming the defect**; a sound doc yields `proceed`.
- [ ] Opt-in: it is NOT required before `/loom-roadmap init` for human operators (C-03).

---

### Phase 2 — Wave 1: Wire the PENDING cross-model marker

**Agent:** implementer-agent
**Objective:** Consume the inert `Cross-model review: PENDING` marker in `/loom-think` Phase 3.5 (`skills/loom-think/SKILL.md:95`) so a second-opinion pass actually fires (or is resolved by `/loom-think:review`).
**Dependencies:** Phase 0
**File Ownership:** `skills/loom-think/SKILL.md` (Phase 3.5), `commands/loom-think.md` (marker handling), `tests/skills/loom-think-marker.test.ts`

#### Acceptance Criteria
- [ ] The Phase 3.5 marker is no longer inert: it either triggers a cross-model second opinion or is explicitly resolved/consumed by the think-review flow; a test asserts the marker does not silently persist unhandled.

---

### Phase 3 — Wave 1: Strategic lenses at /loom-roadmap review

**Agent:** implementer-agent
**Objective:** Add the 4 M-04 lenses (eng/devex/ceo/design, archetype-selected) to `/loom-roadmap review` — today only 4 non-strategic agents (scope-feasibility, feature-coverage, strategy, ux). Independent of M-14.
**Dependencies:** none (parallel-safe; disjoint file)
**File Ownership:** `commands/loom-roadmap/review.md`, `tests/commands/loom-roadmap-review-lenses.test.ts`

#### Acceptance Criteria
- [ ] `/loom-roadmap review` spawns the 4 M-04 lenses alongside its existing agents (archetype-selected; eng/devex broadly, ceo/design for product/UI); the agent count, synthesis template, and the `agents[N]` TOON table are updated to match (no "4"-vs-actual drift — the same class of bug A just fixed in `/loom-plan review`).

---

### Phase 4 — Wave 2: Think-scoped M-04 lens variants

**Agent:** implementer-agent
**Objective:** Adapt the plan-scoped M-04 review agents into think-scoped lenses (they critique a design brief / framing, not a phased plan) so `/loom-think:review`'s panel evaluates the right altitude.
**Dependencies:** Phase 1
**File Ownership:** `agents/think-eng-review-agent.md`, `agents/think-devex-review-agent.md`, `agents/think-ceo-review-agent.md`, `agents/think-design-review-agent.md`, `commands/loom-think/review.md` (swap the panel to the think-scoped agents), `tests/agents/think-lenses.test.ts`

#### Acceptance Criteria
- [ ] Each think-scoped lens reviews framing (problem clarity, approach soundness, gap-closure, benchmark presence) rather than phases/waves; `/loom-think:review` uses them; the seeded-bad fixture still routes to rewrite/kill.

---

### Phase 5 — Wave 2: --benchmark pattern flag

**Agent:** implementer-agent
**Objective:** A `--benchmark` pattern on the existing `--debate/--vote/--chain` rail that runs a competitive comparison against a named reference and writes a `BenchmarkScorecard` section into the think doc; `/loom-think:review` checks its presence/quality.
**Dependencies:** Phase 1
**File Ownership:** `~/.claude/protocols/pattern-executor.md` (register the benchmark pattern — or the repo copy if present), `commands/loom-think.md` + `commands/loom-roadmap.md` (document the flag), `agents/benchmark-agent.md` (new — or reuse feature-coverage-agent in benchmark mode), `tests/patterns/benchmark.test.ts`

#### Acceptance Criteria
- [ ] `/loom-think --benchmark <reference>` (or on the rail) produces a `BenchmarkScorecard` written into the think doc; it runs on a bare idea pre-roadmap (not requiring a plan, unlike `feature-coverage-agent`).
- [ ] `/loom-think:review` surfaces a missing/thin benchmark as a finding. Name collision avoided (`loom-benchmark` perf skill untouched).

---

### Phase 6 — Wave 3: /loom-auto default-on + docs + tests

**Agent:** implementer-agent
**Objective:** Default the gate on inside `/loom-auto` (run `/loom-think:review` before roadmap init; on `kill`/`rewrite`, loop back), keep it opt-in for humans, and update the router/docs.
**Dependencies:** Phase 4, Phase 5
**File Ownership:** `commands/loom-auto*` (or `skills/loom-auto/**`), `commands/loom-do.md` + `commands/loom-which.md` (routing surface), README (thinking-gate section), `tests/e2e/thinking-gate-auto.test.ts`

#### Acceptance Criteria
- [ ] `/loom-auto` runs `/loom-think:review` before `/loom-roadmap init` by default; a `kill`/`rewrite` verdict loops back to thinking rather than proceeding; human paths remain opt-in.
- [ ] README documents the divergent→gate→formality flow; `bunx tsc --noEmit -p hooks/tsconfig.json` = 0; `bunx vitest run tests/commands tests/agents tests/patterns tests/skills` green.

## Wave map
Wave 0: P0 contracts → Wave 1: P1 (command) ∥ P2 (marker) ∥ P3 (roadmap lenses — independent) → Wave 2: P4 (think-scoped lenses) ∥ P5 (--benchmark) → Wave 3: P6 (auto default + docs). Critical path: P0 → P1 → P4 → P6. P3 is parallelizable from Wave 1 (disjoint file). All same-wave phases own disjoint files.

## Verification Commands
```bash
bunx tsc --noEmit -p hooks/tsconfig.json
bunx vitest run tests/commands tests/agents tests/patterns tests/skills
# behavioral: seeded-bad think doc must route to rewrite/kill
```

## Non-Goals
New design-brief schema; namespace split; typed explore/debate/prototype handoffs; standalone `/loom-compete`; numeric readiness scoring. (Per the seed think doc's resolved framing decisions.)
