---
roadmapVersion: 1
name: "Thinking Gate — divergent/formality separation"
status: draft
created: 2026-07-04
lastReviewed: null
seededFrom: .loom/thinks/thinking-formality-separation-2026-07-04T21-12-44.md
targetDate: null
totalFeatures: 7
totalMilestones: 4
---

# Roadmap: Thinking Gate

## Vision

Loom has **formality-first gravity** — thinking tools exist but are scattered and ungated, so the first real critique lands only at `/loom-plan review`, after a formal roadmap + a multi-phase plan exist. The cost is measured: the 2026-07-04 browser-e2e plan review returned two BLOCKING framing/approach defects that a cheaper pre-formality review would have caught before the drafting investment (`planning/history/reviews/2026-07-04-review.toon`). This initiative closes that gap by adding a **thinking-review gate** at the seam between the divergent thinking phase and the convergent formality pipeline — reviewing the *converged* think doc (not the brainstorm, so divergence stays free), routing rather than walling, opt-in for operators and default-on for `/loom-auto`. It also moves competitive benchmarking earlier (today it only lives in `feature-coverage-agent`, which needs a plan as input). Design brief + full debate/storm/deep-think rationale: the seed think doc. Builds the previously-designed but unbuilt M-14/M-15 from `.loom/thinks/ceo-review-placement-2026-07-01`.

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Pre-plan gate exists | `/loom-think:review <doc>` returns proceed/rewrite/kill | command runs a lens panel over a think doc and emits a ThinkReviewVerdict |
| Gate catches framing defects | on a seeded-bad think doc, verdict = rewrite/kill naming the defect | fixture test: a doc with a launch()-vs-connectOverCDP-class approach error yields rewrite/kill |
| Divergence not chilled | operator path is opt-in; only `/loom-auto` defaults it on | the command is not required before `/loom-roadmap init` for humans |
| Strategic lenses earlier | eng/devex/ceo/design lenses run at think-review AND roadmap review | `/loom-roadmap review` spawns the 4 M-04 lenses (archetype-selected) |
| Benchmark before roadmap | `--benchmark` writes a scorecard into the think doc | a bare idea can be benchmarked pre-roadmap; verdict checks the scorecard |
| PENDING marker wired | `/loom-think` Phase 3.5 marker is consumed, not inert | the cross-model/second-opinion marker triggers or is resolved by think-review |

## Constraints & Decisions

### C-01: Review the converged doc, not the brainstorm
**Decision:** `/loom-think:review` operates on the finished `.loom/thinks/{slug}.md` doc — the converged output — never on the live divergent session.
**Rationale:** Grading a brainstorm chills it (anticipatory convergence). Reviewing the conclusion does not.
**Impact:** high

### C-02: Router by agent-judgment rubric, not numeric threshold
**Decision:** Lens agents return severity-tagged findings; the router maps them to `{proceed | rewrite-think | kill}` — fundamental problem/approach flaw → kill, fixable framing gaps → rewrite, none → proceed. No configurable numeric score.
**Rationale:** Numeric thresholds invite false precision and gaming; severity mapping mirrors the proven `/loom-plan review` finding model.
**Impact:** high

### C-03: Opt-in for operators, default-on for /loom-auto
**Decision:** Humans invoke `/loom-think:review` explicitly (breathing room); `/loom-auto` runs it by default before roadmap init (automation needs the gate).
**Rationale:** Preserves the divergent phase's freedom for humans while giving unattended pipelines the guardrail.
**Impact:** high

### C-04: Reuse the existing crossing artifact and the M-04 lenses
**Decision:** The crossing artifact is the existing `.loom/thinks/` doc (+ a benchmark section) — no new "design brief" schema. The lens panel reuses the M-04 `plan-{eng,devex,ceo,design}-review` agents (think-scoped variants), archetype-selected.
**Rationale:** Minimal new surface; the artifact and lenses already exist.
**Impact:** medium

### C-05: Benchmark rides the pattern-flag rail (flag-first)
**Decision:** Competitive benchmark is a `--benchmark` flag on the existing `--debate/--vote/--chain` rail, writing a scorecard section into the think doc; a standalone `/loom-compete` is deferred. Avoids the `loom-benchmark` (perf/CWV skill) name collision.
**Rationale:** Lowest friction, consistent with existing patterns; promote to a command only if it earns standalone use.
**Impact:** medium

## Conceptual Data Model

```toon
entities[3]{entity,description,keyFields}:
  ThinkReviewVerdict,"Outcome of /loom-think:review over a think doc","docRef, verdict(proceed|rewrite-think|kill), findings[]{lens,severity,message}, decidedAt"
  BenchmarkScorecard,"Competitive comparison written into a think doc","reference, dimensions[]{name,selfScore,refScore,gap}, overall"
  PrePlanLensPanel,"The archetype-selected set of lenses run at think-review + roadmap review","planArchetype, lenses[]{name,applies}"
```

## Features

```toon
features[7]{id,title,milestone,summary}:
  TG-01,ThinkReviewVerdict + panel contracts,M-14,"Schemas for the verdict, the benchmark scorecard, and the archetype lens-panel selection"
  TG-02,/loom-think:review command,M-14,"New subcommand: run the lens panel over a think doc, map findings -> proceed/rewrite/kill, write the verdict"
  TG-03,Wire the PENDING cross-model marker,M-14,"Consume the inert Phase 3.5 marker in loom-think so a second-opinion pass actually fires"
  TG-04,Think-scoped M-04 lenses,M-15,"Adapt plan-{eng,devex,ceo,design}-review as think-scoped lenses (archetype-selected) for the review panel"
  TG-05,Strategic lenses at roadmap review,M-15,"Add the 4 M-04 lenses to /loom-roadmap review (today 4 non-strategic agents); bump the synthesis + agent table"
  TG-06,--benchmark pattern flag,M-16,"Competitive-benchmark pattern on the --debate/--vote/--chain rail; writes a BenchmarkScorecard into the think doc"
  TG-07,/loom-auto default-on wiring + docs,M-17,"Default the gate on inside /loom-auto; router integration; update docs/router; end-to-end + fixture tests"
```

## Milestones

```toon
milestones[4]{id,title,features,dependsOn,gate}:
  M-14,Pre-plan judgment gate,"TG-01, TG-02, TG-03",,"/loom-think:review returns proceed/rewrite/kill; seeded-bad doc yields rewrite/kill naming the defect"
  M-15,Pre-plan + roadmap lenses,"TG-04, TG-05",M-14,"eng/devex/ceo/design lenses run at think-review AND roadmap review (archetype-selected)"
  M-16,Earlier benchmark,"TG-06",M-14,"--benchmark writes a scorecard into a think doc pre-roadmap; think-review checks it"
  M-17,Integration + auto default,"TG-07",M-15 M-16,"/loom-auto defaults the gate on; docs + tests green"
```

## Already shipped (this branch)
- **A (commit 62a106b):** `/loom-plan review` doc-consistency 6→10 + archetype guidance + "don't silently run only 6" warning — the drift that caused an orchestrator to run only the 6 core agents and drop the eng/devex lenses.

## Non-Goals
- A new "design brief" schema (reuse `.loom/thinks/`). A namespace split (`/loom-explore*` vs `/loom-build*`). Typed handoffs for explore/debate/prototype (manual for v1). A standalone `/loom-compete` command (flag-first). Numeric readiness scoring (agent-judgment rubric instead).
