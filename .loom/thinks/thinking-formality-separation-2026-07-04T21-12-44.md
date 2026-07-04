---
slug: thinking-formality-separation
datetime: 2026-07-04T21:12:44Z
branch: thinking-formality-separation
repo: https://github.com/launchstack-dev/loom-ai
supersedes:
status: DRAFT-READY-FOR-SIGNOFF
relatedThinks[1]: .loom/thinks/ceo-review-placement-2026-07-01T09-45-00.md
producedBy: debate + storm + deep-think exploration (4 parallel agents, 2026-07-04), synthesized
---

# Think: Separate the divergent thinking phase from the convergent formality pipeline

## Phase 0 — Situation (repo ground truth)

Loom has **formality-first gravity**: the thinking tools exist but are scattered, and the first real critique lands only at `/loom-plan review` — after a formal roadmap + plan already exist.

- Thinking tools all live LEFT of `/loom-roadmap init`: `/loom-think` (5-phase interview → `.loom/thinks/{slug}-{ts}.md`, the only one with a typed `--from`/`seededFrom:` handoff), `/loom-roadmap explore` (multi-persona brainstorm → `planning/history/explorations/`), `/loom-spec`, `/loom-debate`, `/loom-prototype`.
- Review today fires only AFTER `/loom-roadmap init`: `/loom-roadmap review` (4 agents) and `/loom-plan review` (documented as "6", actually spawns 10 incl the M-04 lenses).
- **The gap (confirmed):** nothing reviews the think doc before it crosses into formality. The `Cross-model review: PENDING` marker in `/loom-think` Phase 3.5 (`skills/loom-think/SKILL.md:95`) is inert.

**The cost is measured, not hypothetical.** An 8-agent `/loom-plan review` of a fully-drafted 14-phase browser-e2e plan (`planning/history/reviews/2026-07-04-review.toon`) returned REVISE (composite 5.4/10) with **2 BLOCKING findings** — `chromium.launch()` vs `connectOverCDP` (an approach error) and no daemon failure model (a framing gap) — plus a "this won't even close the gap it exists to close" scope finding. Every one is a *thinking* defect that survived to a post-draft review because there was no earlier gate.

**We already did the fix organically:** the exceed-gstack initiative built the loom-vs-gstack comparative scorecard FIRST, and that scorecard motivated the roadmap. And a prior think doc (`ceo-review-placement-2026-07-01`) already designed the gate — `/loom-think:review`, milestones M-14/M-15 — but it was never built.

## Phase 1 — The question

Should Loom formally separate a divergent "thinking / brainstorm" phase from the convergent "automation formality" pipeline, with a review of the thinking output before the formalities begin — and if so, how, without adding ceremony to the phase that most needs breathing room?

## Phase 2 — Exploration (debate + storm + deep-think)

**Debate — pro-separation:** the 2026-07-04 review is a receipt; the thinking tools are scattered and ungated so they get skipped under deadline; a 2-3 agent brief-level gate catches framing errors before the expensive drafting. Structure: divergent tools → a design brief → a thinking-review gate → formality.

**Debate — anti-separation:** you can't gate divergence without chilling it (operators write to the rubric); the real defects are narrow (a doc-count bug + a missing benchmark flag) and fixable in place; a new gate duplicates existing review stages and stalls at peak energy on a vague artifact → mushier findings, two reviews for one gain.

**Storm — 11 structural options.** Most useful: the design-brief-as-crossing-contract; the readiness-score-as-router (dynamic boundary, not a wall); benchmark-as-a-think-phase (matches how the gstack scorecard actually happened); feed-forward (no new stage). Naming catch: `loom-benchmark` is already the perf/CWV skill → use `/loom-compete` or a flag.

**Deep-think — ground truth (the reconciler):**
- **A is a DOC bug, not a behavior gap.** The 4 M-04 lenses already run by default in `/loom-plan review`; only the framing text said "6". (Fixed 2026-07-04, commit 62a106b.)
- **The crossing artifact already exists:** `.loom/thinks/{slug}-{ts}.md`, typed lifecycle, `--from` handoff. No new schema needed.
- **The gate was already designed:** `/loom-think:review` → `{proceed | rewrite-think | kill}`, opt-in for operators, default-on for `/loom-auto` (M-14; M-15 adds design/eng/devex pre-plan lenses).
- **B's real need is EARLIER placement:** competitive analysis today lives only in `feature-coverage-agent`, which needs a plan/roadmap as input; it can't run on a bare idea. Move it pre-roadmap via a `--benchmark` flag on the existing `--debate/--vote/--chain` rail.

## Phase 3 — Synthesis / chosen direction

The debate dissolves once grounded. Anti-separation is right that a heavy new phase + hard gate is over-engineering; pro-separation is right that the pre-formality review gap is real and costly. **Both are satisfied by an opt-in, lightweight review of the CONVERGED think doc (not the brainstorm), which routes rather than walls.**

```
DIVERGENT (breathing room)                    CONVERGENT (rigor)
 loom-think / explore / spec / debate          loom-roadmap init → review → sign-off
 / prototype  + /loom-compete (--benchmark)     loom-plan create → review(10) → execute
        │  writes into                                    ▲
        ▼                                                 │ proceed
 .loom/thinks/{slug}.md  ──►  /loom-think:review  ────────┘
   (existing artifact +        (M-14: opt-in router
    benchmark section)          {proceed|rewrite|kill};
                                default-on in /loom-auto;
                                M-15 lenses: eng/devex/ceo/design)
```

Resolves the four tensions:
- **Boundary** = think→roadmap (the `.loom/thinks/` doc is the typed seam).
- **Crossing artifact** = the existing think doc + a benchmark section (reuse, don't invent).
- **Gate vs advisory** = opt-in judgment ROUTER; default-on only in `/loom-auto` (wall for automation, breathing room for humans). Reviews the converged doc, so it doesn't chill divergence.
- **Fragmentation** = minimal: one new subcommand + one pattern flag, reusing the artifact and the `--debate` rail; no namespace split, no new phase.

## Phase 4 — Scope (what to build)

- **A (done, 62a106b):** `/loom-plan review` doc-consistency 6→10 + archetype guidance + "don't silently run only 6" warning.
- **M-14 — `/loom-think:review`:** opt-in lens pass over a think doc → `{proceed | rewrite-think | kill}`; wire the inert `Cross-model review: PENDING` marker; default-on in `/loom-auto`.
- **M-15 — pre-plan lenses:** reuse the M-04 `plan-eng/devex/ceo/design-review` agents (or think-scoped variants) as the `/loom-think:review` panel; archetype-selected.
- **B — competitive benchmark, moved earlier:** a `--benchmark` pattern flag (rail: `--debate/--vote/--chain`) and/or a `/loom-compete <reference>` command that writes a scorecard section into the think doc, checked by `/loom-think:review`. Rename around the perf `loom-benchmark` skill.

## Open questions for sign-off
1. Router thresholds — what makes `/loom-think:review` return `rewrite` vs `kill` vs `proceed`? Confidence-scored or agent-judgment?
2. Do the M-15 lenses live at `/loom-think:review` only, or also get added to `/loom-roadmap review` (which today has just 4 non-strategic agents)?
3. Is `/loom-compete` a standalone command or flag-only? (Storm flagged the `loom-benchmark` name collision.)
4. Typed handoff for explore/debate/prototype into the brief, or leave those manual for now?
