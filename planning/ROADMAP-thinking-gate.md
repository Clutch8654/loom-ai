---
roadmapVersion: 1
name: "Thinking Gate — divergent/formality separation"
status: completed
created: 2026-07-04
lastReviewed: 2026-07-05
completedAt: 2026-07-05T22:30:00Z
planRef: planning/plans/PLAN-thinking-gate.md
acceptanceNote: "All 4 milestones delivered (M-14 pre-plan judgment gate, M-15 pre-plan + conditional roadmap lenses, M-16 earlier benchmark wired, M-17 integration + bounded auto default). Executed by PLAN-thinking-gate across 4 waves / 5 commits, tsc=0, 865 pass/2 skip. Fail-closed router, altitude panel, --benchmark pattern, and bounded /loom-auto gate (kill-halt + override + LoopBack audit) all live and tested."
reviewRef: planning/history/reviews/2026-07-05-thinking-gate-review.toon
seededFrom: .loom/thinks/thinking-formality-separation-2026-07-04T21-12-44.md
targetDate: null
totalFeatures: 7
totalMilestones: 4
---

# Roadmap: Thinking Gate

> Revised 2026-07-05 after an 8-agent plan review (HOLD, 5 blocking). Applied all 10 revisions: router fail-closed + deterministic synthesis + closed enums (C-02); file-based subcommand dissolves the loom-think.md collision (C-06); bounded loop-back with kill-halts + opt-out/override (C-03); repo-tracked benchmark plumbing (C-05); nextCommand verdicts (C-07); mandatory named cross-model second opinion (C-08); parallel-panel-with-any-blocking-wins vs sequenced-cascade decision (C-02); triple-lens redundancy conditioned to the human path (C-09).

## Vision

Loom has **formality-first gravity** — thinking tools exist but are scattered and ungated, so the first real critique lands only at `/loom-plan review`, after a formal roadmap + a multi-phase plan exist. The cost is measured: the browser-e2e plan review returned two BLOCKING framing/approach defects that a cheaper pre-formality review would have caught before the drafting investment. **This initiative's own review demonstrated the thesis a second time**: an 8-agent review caught 5 blocking defects in the draft *before any code* — while a hand-run thinking-review returned "proceed" and missed them, proving both that the gate must be built with a real fail-closed router AND that multi-altitude review (framing + plan) genuinely catches different defect classes.

The initiative adds a **thinking-review gate** at the seam between divergent thinking and convergent formality — reviewing the *converged* think doc (not the brainstorm, so divergence stays free), routing deterministically rather than walling, opt-in for operators and default-on for `/loom-auto`. It also moves competitive benchmarking earlier. Design brief + full debate/storm/deep-think rationale + resolved framing: the seed think doc. Builds the previously-designed-but-unbuilt M-14/M-15.

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Pre-plan gate exists + fails CLOSED | `/loom-think:review <doc>` returns proceed/rewrite-think/kill; a crashed/no-quorum panel yields rewrite-think, never proceed | pure-unit router test over fixture `findings[]` incl. an empty/failed-panel case |
| Gate catches framing defects | on a seeded-bad think doc, verdict routes correctly and NAMES the defect | fixture test: an approach-error doc → rewrite/kill; a separate fixture MUST route specifically to `kill` |
| Verdict is actionable | each verdict carries a `nextCommand` | schema + test assert nextCommand present per outcome |
| Divergence not chilled | opt-in for humans; `/loom-auto` default-on WITH `--no-think-review` opt-out + `--force` override | not required before `/loom-roadmap init` for humans; auto has a documented skip |
| Bounded auto loop | rewrite-think loops ≤ N then escalates; `kill` HALTS (never loops) | e2e asserts a bounded loop + kill-halt + persisted per-attempt audit state |
| Strategic lenses earlier | eng/devex/ceo/design lenses at think-review; and at roadmap-review ONLY on the human (think-review-skipped) path | roadmap-review spawns the lenses conditionally; no double-run on the /loom-auto path |
| Benchmark before roadmap, wired | `--benchmark` writes a typed BenchmarkScorecard into the think doc and is actually registered (not inert) | `[patterns.benchmark]` trigger matches; scorecard typed 0..10 with sourceRefs |
| Cross-model opinion real | a named non-Claude/distinct-tier (never fable) second opinion fires, with divergence handling | the PENDING marker is consumed by a real second-model pass, not stubbed |

## Constraints & Decisions

### C-01: Review the converged doc, not the brainstorm
**Decision:** `/loom-think:review` operates on the finished `.loom/thinks/{slug}.md` doc, never the live divergent session.
**Rationale:** Grading a brainstorm chills it; reviewing the conclusion does not.
**Impact:** high

### C-02: Deterministic, fail-CLOSED router with closed enums (parallel panel, any-blocking-wins)
**Decision:** The router is a total function of the lens findings. `severity` is a **closed enum** `blocking|warning|info` (aligned to AgentResult). Synthesis is **any-blocking-wins** — a single `blocking` finding cannot be out-voted (this gives the short-circuit benefit of a sequenced cascade at the synthesis layer while keeping a cheap parallel panel). A decision table over (severity × fixability) maps to `{proceed | rewrite-think | kill}`: any non-fixable/approach blocking → `kill`; any fixable blocking or warning → `rewrite-think`; none → `proceed`. **Fail closed:** if the panel does not reach quorum (≥⌈M/2⌉ lenses return) the router emits a `PANEL_INCOMPLETE` blocking finding → `rewrite-think`, NEVER `proceed`. No numeric threshold.
**Rationale:** Review T1 (blocking): an open `severity` and a "MAY kill" clause made the verdict a non-function of its inputs, and an empty/crashed panel fell through to `proceed`, silently bypassing the default-on gate. Any-blocking-wins captures the gstack cascade's short-circuit value without cross-lens sequencing (tradeoff accepted for v1: no cross-lens information flow — documented, not silently dropped).
**Impact:** high (blocking)

### C-03: Opt-in for humans; default-on for /loom-auto with a bounded loop, kill-halts, and an override
**Decision:** Humans invoke `/loom-think:review` explicitly. `/loom-auto` runs it by default before roadmap init, with `--no-think-review` opt-out and `--force` override. On `rewrite-think` the auto loop re-thinks up to **N iterations** (config default 2) then escalates to the operator; on `kill` it **HALTS** with an operator handoff — it never loops a killed idea. Each attempt's verdict+reason is persisted to a `LoopBack` audit artifact.
**Rationale:** Review T3 (6 agents): the loop-back was unbounded and wrongly looped `kill`, and the default-on path had no override — a wrongly-killing gate could trap an unattended pipeline.
**Impact:** high

### C-04: Reuse the existing crossing artifact and the M-04 lenses (mode-param, not forked agents)
**Decision:** Crossing artifact = the existing `.loom/thinks/` doc (+ a benchmark section). The lens panel reuses the M-04 `plan-{eng,devex,ceo,design}-review` agents via an **altitude/scope parameter** (they accept "think" altitude to review framing) — NOT four new forked agent files.
**Rationale:** Review (strategy): forking 4 agents doubles maintenance and breaks the C-04 minimal-surface promise; a mode parameter preserves reuse.
**Impact:** medium

### C-05: Benchmark rides the pattern rail, registered in the REPO source (flag-first)
**Decision:** `--benchmark` is a pattern on the `--debate/--vote/--chain` rail. Registration edits the **repo-tracked** `protocols/pattern-executor.md` + `protocols/orchestration-patterns.md` (definition) + `.claude/orchestration.toml` `[patterns.benchmark]` (trigger) — all three, or the flag is inert. A **new** `agents/benchmark-agent.md` (registered + `model:` frontmatter) runs it — `feature-coverage-agent` is plan-scoped and cannot benchmark a bare idea. Avoids the `loom-benchmark` (perf) name collision.
**Rationale:** Review T5 (4 agents, blocking): the `~/.claude/protocols/` path is empty/untracked (lost on reinstall, R-001), single-file registration leaves the flag inert, and the agent fork was unresolved.
**Impact:** high

### C-07: Verdicts are directives, not labels
**Decision:** `ThinkReviewVerdict` carries a required `nextCommand` and per-finding `remediation`: `proceed` → `/loom-roadmap init`; `rewrite-think` → `/loom-think --from <doc>`; `kill` → archive/abandon guidance.
**Rationale:** Review T4 (ux + devex blocking): a verdict with no next action balloons effective TTHW as the operator guesses.
**Impact:** medium

### C-08: Cross-model second opinion is mandatory and named
**Decision:** The inert `/loom-think` Phase 3.5 marker is consumed by a real second-opinion pass from a **named second model** — a non-Claude family or an explicitly distinct tier, **never `fable`** (exhausts limits under multi-agent orchestration). Divergence between the two opinions is surfaced as a finding.
**Rationale:** Review T6 + memory `feedback_fable_for_planning`: the single-model-blindspot defense was optional/stubbable and the second model unnamed.
**Impact:** medium

### C-09: No triple-lens redundancy — condition roadmap-review lenses to the human path
**Decision:** The eng/devex/ceo/design lenses run at `/loom-think:review` always, and at `/loom-roadmap review` **only when think-review was skipped** (the human opt-in path) — so the `/loom-auto` path never re-runs the same 4 lenses at both altitudes.
**Rationale:** Review T7 (strategy): the lenses would otherwise run at three altitudes (think + roadmap + plan) with no justification.
**Impact:** medium

## Conceptual Data Model

```toon
entities[4]{entity,description,keyFields}:
  ThinkReviewVerdict,"Outcome of /loom-think:review","docRef, verdict(proceed|rewrite-think|kill), nextCommand, findings[]{lens(eng|devex|ceo|design),severity(blocking|warning|info),fixable,message,remediation}, decidedBy, decidedAt, revisionCount"
  BenchmarkScorecard,"Competitive comparison written into a think doc","references[], dimensions[]{name,selfScore(0..10),refScore(0..10),gap,sourceRefs[]}, overall(mean)"
  PrePlanLensPanel,"Archetype→lens selection RULE + resolved set","planArchetype, selectionRule, lenses[]{name,applies}"
  LoopBack,"Per-attempt /loom-auto gate audit trail","attempt, verdict, reason, decidedAt"
```

## Features

```toon
features[7]{id,title,milestone,summary}:
  TG-01,Verdict/panel/benchmark contracts + archetype rule,M-14,"Closed-enum ThinkReviewVerdict (+ nextCommand/remediation/revisionCount), typed BenchmarkScorecard, and the archetype->lens SELECTION RULE (not just the type)"
  TG-02,/loom-think:review command + fail-closed router,M-14,"File-based commands/loom-think/review.md (→ /loom-think:review for free); pure-unit router (any-blocking-wins, quorum, fail-closed) mapping findings→verdict+nextCommand"
  TG-03,Mandatory named cross-model second opinion,M-14,"Consume the inert Phase 3.5 marker via a named non-Claude/distinct-tier (never fable) pass with divergence handling"
  TG-04,Think-altitude mode on the M-04 lenses,M-15,"Add a scope/altitude param to plan-{eng,devex,ceo,design}-review so they review framing; wire them as the review panel (no forked agents)"
  TG-05,Conditional strategic lenses at roadmap-review,M-15,"Add the 4 lenses to /loom-roadmap review, fired ONLY on the human (think-review-skipped) path (C-09); fix the '4'-vs-actual drift"
  TG-06,--benchmark pattern (repo-registered),M-16,"3-file pattern registration + new benchmark-agent.md; writes a typed BenchmarkScorecard into the think doc; think-review checks presence+quality"
  TG-07,/loom-auto bounded gate + opt-out + docs,M-17,"Default-on before roadmap init with bounded rewrite loop, kill-halts, --no-think-review/--force, LoopBack audit; router surface + README"
```

## Milestones

```toon
milestones[4]{id,title,features,dependsOn,gate}:
  M-14,Pre-plan judgment gate,"TG-01, TG-02, TG-03",,"/loom-think:review returns a deterministic verdict+nextCommand; fails closed on a crashed panel; seeded-bad doc routes to rewrite/kill (a kill-specific fixture passes); cross-model pass fires"
  M-15,Pre-plan + conditional roadmap lenses,"TG-04, TG-05",M-14,"M-04 lenses review a think doc via altitude mode; roadmap-review runs them only on the human path"
  M-16,Earlier benchmark (wired),"TG-06",M-14,"--benchmark trigger matches (not inert); typed scorecard in the think doc; think-review checks it"
  M-17,Integration + bounded auto default,"TG-07",M-15 M-16,"/loom-auto defaults the gate on with a bounded loop + kill-halt + opt-out; docs + tests green; changelog entry"
```

## Already shipped (this branch)
- **A (commit 62a106b):** `/loom-plan review` 6→10 doc-consistency + archetype guidance + "don't silently run only 6" warning. **Validated 2026-07-05**: the 8-agent review of this very plan ran eng+devex by default (they returned the most severe findings).

## Non-Goals
New design-brief schema (reuse `.loom/thinks/`); namespace split; typed explore/debate/prototype handoffs (manual v1); standalone `/loom-compete` (flag-first); numeric readiness scoring (closed-enum decision table instead); a fully sequenced CEO→Design→Eng cascade (parallel panel + any-blocking-wins gives the short-circuit benefit for v1; cross-lens sequencing deferred).
