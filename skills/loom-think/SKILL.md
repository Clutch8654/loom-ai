---
name: loom-think
description: 5-phase deep-think interview producing a structured design doc, with cross-model second opinion. Precedes /loom-roadmap init for fuzzy problems.
---

# /loom-think — Deep-Think Interview

Use this skill when a problem is fuzzy — the operator has a hunch that something matters, but has not yet nailed the problem statement, the demand evidence, the constraints, or the narrowest wedge. `/loom-think` is a slow, deliberate interview that ends in a durable design doc under `.loom/thinks/`, which then feeds `/loom-roadmap init --from <path>`.

Run it as a rigorous, structured interrogation: you ask hard, patient questions one at a time and the operator writes the answers. Do NOT paraphrase; carry the operator's language forward.

## When to use

- The operator says "I've been thinking about..." with no clear scope.
- The operator has an idea and wants a second opinion before roadmapping.
- A prior roadmap or plan attempt stalled and the underlying problem needs a re-frame.
- Before `/loom-roadmap init` on any non-trivial feature.

## When NOT to use

- The operator has a clear, small bug — use `/loom-bugfix`.
- The idea is already scoped to a single ticket — use `/loom-spec` directly.
- The roadmap already covers the area and just needs a mutation — use `/loom-roadmap mutate`.
- The problem is *specific* and the operator wants many voices weighing in (design, strategy, UX, risk) — use `/loom-roadmap:explore` for the multi-persona brainstorm. `loom-think` is for fuzzy problems held by one operator; `explore` is for a chosen topic where diverse perspectives matter more than convergence.

### Rule of thumb

<!-- Canonical copy of this triad. Mirrored in skills/loom-spec/SKILL.md
     and README.md "The full lifecycle" — edit all three together. -->

- `/loom-think` — fuzzy problem, one operator wants to converge.
- `/loom-roadmap:explore` — specific topic, wants many voices.
- `/loom-spec` — crystallize a chosen direction into a ticket.

## Inputs

- **Topic** (required, positional): the fuzzy area to think about. Free-text.
- **Branch** (optional): `--branch <name>` — the branch/topic this think doc supersedes prior thinking on. Defaults to a slug of the topic.
- **From** (optional): `--from <path>` — a prior think doc to explicitly supersede.

## 5-Phase Workflow

### Phase 1 — Problem

Ask the operator, in this order (one question at a time, wait for the answer):

1. **What's broken?** Describe the felt pain in one paragraph. Concrete moment preferred.
2. **What triggered you to think about this now?** A recent PR? A user complaint? A rabbit hole?
3. **Who is asking?** Yourself, a user, a stakeholder, a future maintainer?

Record the raw text verbatim in the artifact under `## Phase 1 — Problem`.

### Phase 2 — Demand Evidence

Ask:

1. **What signals suggest this matters?** Data, quotes, incidents, dropped work, workarounds.
2. **Past attempts to solve this?** Prior PRs, prior plans, prior tools tried and abandoned. Cite links.
3. **What happens if you do nothing for 6 months?** Force a counterfactual.

If the operator has *no* evidence — this is a signal. Note "Demand evidence: SPARSE" prominently. `/loom-roadmap init` will treat this doc as a risky input.

### Phase 3 — Status Quo

Ask:

1. **How does the current system handle this today?** Walk through the actual code path or workflow.
2. **What are the load-bearing constraints?** Data model, tool boundaries, team boundaries, licenses.
3. **What have you already ruled out and why?** Capture *why* so we don't relitigate.

### Phase 3.5 — Cross-Model Second Opinion (mandatory, active)

Before proposing approaches, briefly summarize 2–3 candidate directions in your own words, then run a **real** second-opinion pass with a **named** second model. This is no longer a placeholder — the pass runs here and its result feeds the pre-plan review router.

**Named second model:** `sonnet` — a distinct Claude tier from the opus-tier interview, so the second read is genuinely cross-model rather than a self-echo. **NEVER use `fable`** as the second model: it exhausts usage limits under multi-agent orchestration (memory `feedback_fable_for_planning`). A non-Claude-family model (GPT or Gemini, e.g. via `/loom-benchmark-models`) MAY be substituted for `sonnet`; `fable` MAY NOT.

**How the pass runs (active — never leave it PENDING):**

1. Emit the Approach Candidates block below.
2. Spawn the named second model (`sonnet`) on the *same* candidates with an adversarial prompt: which candidate does it rank first, and does it see a fatal approach risk the primary (interview) opinion missed? Pass `model: "sonnet"` on the Agent call.
3. Compare the two opinions:
   - **Converged** — both rank the same top candidate and neither flags a fatal risk → set the marker to `converged` and emit NO finding (a clean pass contributes to a `proceed` verdict downstream).
   - **Divergent** — different top candidate, OR the second model surfaces a risk the primary missed → set the marker to `DIVERGENT` and emit a divergence finding (see **§ Divergence Finding** below).

Emit:

```
## Phase 3.5 — Approach Candidates (for cross-model review)

Candidate A: <one-sentence sketch>
  Assumes: <load-bearing premise>
  Risk if wrong: <what breaks>

Candidate B: <one-sentence sketch>
  Assumes: <premise>
  Risk if wrong: <what breaks>

Candidate C (optional): <sketch>
  Assumes: <premise>
  Risk if wrong: <what breaks>

Cross-model review: sonnet — <converged | DIVERGENT>; handler: think-review-router
```

#### Divergence Finding (consumed by the router)

On a **DIVERGENT** pass, append a `ThinkReviewFinding` row (typed shape in `lib/types.ts`; schema `protocols/think-review.schema.md`) to the doc so the fail-closed pre-plan router (`scripts/lib/think-review-router.ts`, emitting `decidedBy: think-review-router`) folds the cross-model divergence into its C-02 decision table exactly like any lens finding:

```toon
findings[1]{id,lens,severity,confidence,fixable,remediation,message}:
  F-XM,eng,warning,7,true,"Reconcile the two opinions: sonnet ranked Candidate <X> first / flagged <risk> — re-think § Approaches to resolve","Cross-model divergence: primary picked <A>, sonnet picked <B> (or flagged <fatal approach risk>)"
```

- `lens` is `eng` — cross-model divergence is an approach-soundness signal, and `eng` fires for every archetype.
- `severity`/`fixable` drive the router branch: a **fatal, unrepairable** approach error the second model surfaces → `blocking` + `fixable:false` (router → `kill`); a repairable divergence → `warning` + `fixable:true` (router → `rewrite-think`). A converged pass emits no finding and does not gate.
- The router does NOT special-case this row — the cross-model finding rides the same fail-closed table as the lens panel, so divergence is surfaced, not silently dropped.

### Phase 4 — Target User / Narrowest Wedge

Ask:

1. **Who benefits from a fix first?** Name a persona, a team, or yourself. One person, not "users".
2. **What is the smallest slice that would move the needle for that person?** The wedge — days of work, not weeks.
3. **What would you deliberately NOT include in that slice?** Force scope reduction.

The wedge should be small enough that if you were wrong about everything else, this slice would still teach you something useful.

### Phase 5 — Constraints + Premises + Approaches A/B + Recommendation

Synthesize. This is the operator's opportunity to commit.

Emit:

```
## Phase 5 — Synthesis

### Constraints
- <hard constraint from Phase 3>
- <hard constraint from Phase 4 wedge>
- ...

### Load-bearing premises
- P1: <premise the whole approach rests on>
- P2: <premise>
- ...

### Approach A — <name>
- Mechanism: <how it works>
- Wedge fit: <how it delivers the Phase 4 slice>
- Cost: <effort estimate — days>
- Risk: <what breaks if premise Pn is wrong>

### Approach B — <name>
- Mechanism: <how it works>
- Wedge fit: <how it delivers the Phase 4 slice>
- Cost: <effort estimate — days>
- Risk: <what breaks if premise Pn is wrong>

### Recommendation
<Which approach and why, in 2–3 sentences. Cite premises and constraints by name.>

### Next step
<One concrete next action — usually "run /loom-roadmap init --from <this doc>" or "run /loom-spec to draft the wedge ticket".>
```

## Output

Write the artifact atomically to `.loom/thinks/{slug}-{ISO-timestamp}.md`, where:

- `{slug}` is a kebab-case slug derived from the topic (or `--branch`).
- `{ISO-timestamp}` is `YYYY-MM-DDTHH-MM-SS` (colons replaced with dashes so the filename is safe cross-platform).

Frontmatter:

```markdown
---
slug: <kebab-slug>
datetime: <ISO-8601 datetime>
branch: <branch name>
repo: <git remote origin URL or local path>
supersedes: <path to newest prior doc on the same branch, or empty>
status: DRAFT
---
```

The `supersedes:` chain rule: scan `.loom/thinks/` for prior docs with the same `branch:`. Pick the newest by `datetime:` frontmatter (not filename) and cite its path. This forms a chain — each new think doc points at the previous one. See `.loom/thinks/README.md` for the convention.

Atomic write: write to `.loom/thinks/{slug}-{ts}.md.tmp`, then rename.

## Output summary (stdout)

Print a TOON block:

```toon
think:
  slug: <slug>
  path: .loom/thinks/<slug>-<ts>.md
  supersedes: <prior path or empty>
  branch: <branch>
  status: DRAFT
  approachCandidates: <N from Phase 3.5>
  nextStep: <one line>
```

## Contracts Referenced

- Output shape: matches the `ThinkArtifact` conceptual entity in the gstack-adoption plan (slug, datetime, supersedes, body).
- Feeds: `/loom-roadmap init --from <path>` accepts this doc as a seed.
- Cross-references: `/loom-spec` may cite a think doc as its origin.
