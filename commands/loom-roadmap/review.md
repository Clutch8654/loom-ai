---
description: "Launch 4 core roadmap agents in parallel — plus, on the human path only, up to 4 archetype-selected strategic lenses (eng/devex/ceo/design) when think-review was skipped."
---

## Command: `review`

Launches the 4 core roadmap agents in parallel (scope-feasibility, feature-coverage, strategy, UX) to review the ROADMAP.md, and — **on the human path only** — up to 4 additional archetype-selected strategic lenses (the M-04 `plan-{eng,devex,ceo,design}-review-agent`s). This is the roadmap-level equivalent of `/loom-plan review` (which reviews PLAN.md with 6 core agents plus the same 4 M-04 lenses).

**Agent count is 4 core + up to 4 conditional lenses, not a flat 4.** The 4 core roadmap agents always run. The 4 M-04 strategic lenses fire **only when think-review was skipped** (C-09) — i.e., a human ran `/loom-roadmap review` directly without a prior `/loom-think:review`. When think-review already ran (the `/loom-auto` path, or a human who ran `/loom-think:review` first), those lenses were already applied in altitude mode at the think seam, so re-running them here would double-run them; skip them with a one-line note instead. Do NOT silently treat the command as a flat "4 agents" — that either omits the strategic lenses on the human path or double-runs them on the auto path. When they fire, the exact set is archetype-selected (see Step R1c), so the strategic-lens count is 0, 2, 3, or 4 — never assume a fixed number.

If no arguments are provided, look for a ROADMAP.md in the current working directory. If the user provides a file path, use that instead.

### Review Protocols

Before starting, read:
- `~/.claude/protocols/roadmap.schema.md` — the canonical ROADMAP.md format spec
- `~/.claude/protocols/validation-rules.md` — Section 7: Roadmap Validation Rules

### Status Line Updates

Write `.plan-execution/ephemeral/status.toon` per `execution-conventions.md` SS "Orchestration Status".

### Step R0: Read protocols

Read `~/.claude/protocols/validation-rules.md` for roadmap validation rules and blocker gate enforcement.

### Step R1: Find the roadmap

Resolve the roadmap document per `protocols/planning-paths.md`: check `planning/ROADMAP.md` first, then `ROADMAP.md` at root (legacy), then the user-specified path. Treat a short root stub that references `planning/ROADMAP.md` as a pointer. Read the resolved file to confirm content.

### Step R1a: Structural pre-check

Before spawning agents, run roadmap validation stages 1-4 from `validation-rules.md` Section 7:
- Stage 1 (Structure): frontmatter, required sections, title match
- Stage 2 (Features): milestone assignments, entity references, key behaviors
- Stage 3 (Milestones): cycle detection, self-deps, undefined references, forward references
- Stage 4 (Data Model): entity-feature coverage, relationship endpoint validation

If structural errors are found, include them as a **"Structural Issues"** section at the top of the final report, before agent results. The 4 core agents (and any conditional lenses) still run — they catch strategic issues (scope overreach, feature conflicts, UX gaps) that structural validation doesn't cover. But surfacing structural errors first gives the most actionable feedback.

### Step R1b: Check for project-specific agents

Look for `.claude/orchestration.toml` in the project root. If it exists, read it and extract any agents registered under the `planning:` section with `phase: "roadmap"`. These will be spawned alongside the 4 built-in core agents (and any conditional strategic lenses from Step R1c).

### Step R1c: Resolve the think-review gate and archetype-selected lenses (C-09)

The 4 M-04 strategic lenses (`plan-eng-review-agent`, `plan-devex-review-agent`, `plan-ceo-review-agent`, `plan-design-review-agent`) fire **only on the human path** — when think-review was skipped. This keeps `/loom-auto` (which runs its own `/loom-think:review` gate before roadmap-init) from double-running them.

**1. Detect whether think-review already ran.** Consider think-review to have already run — and therefore **SKIP** the strategic lenses — if ANY of the following hold:
- A `ThinkReviewVerdict` artifact exists at `.plan-execution/ephemeral/think-review/verdict.toon` (written by the `/loom-auto` bounded gate / `/loom-think:review`), OR any file matching `.loom/thinks/**/*.verdict.toon` exists for the active think doc.
- The caller passed `--think-reviewed` (the flag `/loom-auto` sets when it invokes `/loom-roadmap review` after its own gate).

If think-review already ran, do NOT spawn the strategic lenses. Emit a one-line note in the report: `Strategic lenses skipped — think-review already ran (verdict: <path>).` Then proceed with only the 4 core agents (plus any project-specific agents).

**2. Human path — select the lenses by archetype.** If think-review was skipped (no verdict artifact and no `--think-reviewed`), resolve the project archetype (via the `roadmap-archetype-detector`, or an explicit `--archetype <name>` override) and select the active lenses using the **normative selection rule in `protocols/think-review.schema.md` § Archetype→Lens Selection Rule** (`lensSelectionRule`). That table maps the archetype to which of `{eng,devex,ceo,design}` fire; `eng` fires for EVERY archetype. The selected set is the strategic-lens panel (size 2–4, never a fixed count) spawned in Step R2. Record the resolved archetype and active lenses so the synthesis and saved findings reflect exactly which lenses ran.

### Step R2: Launch all agents in parallel

Each agent must receive the full text of the roadmap in its prompt (agents cannot read files from your context). Send ALL Agent tool calls in a SINGLE message so they run concurrently. Spawn the 4 core agents always; spawn the archetype-selected strategic lenses **only if Step R1c resolved the human path** (think-review skipped):

Core agents (always run):
- **scope-feasibility-agent** — Review scope realism, feature conflicts, milestone sizing, constraint compliance, data model soundness
- **feature-coverage-agent** — Audit features against competitors and best practices, identify gaps and over-engineering
- **strategy-agent** — Evaluate vision, positioning, differentiation, feature prioritization (planning mode)
- **ux-agent** — Evaluate user flows, state coverage, interaction patterns, UX coherence (planning mode)

Strategic lenses (M-04) — spawn **only on the human path**, and only the subset selected by archetype in Step R1c (skip entirely when think-review already ran):
- **plan-eng-review-agent** — Engineering-lens review of approach soundness, architecture, and dependency risk (fires for every archetype)
- **plan-devex-review-agent** — DevEx-lens review of integrator/operator experience (fires unless the archetype excludes it)
- **plan-ceo-review-agent** — CEO-lens review of vision fit, positioning, and strategic value
- **plan-design-review-agent** — Design-lens review of user-facing surface, IA, and state coverage (fires only for archetypes with a visual surface, e.g. `web-app` / `default`)

For each built-in core agent, use `subagent_type` matching the agent name. For each selected strategic lens, use `subagent_type` matching the agent name and instruct it to review the roadmap at strategic altitude. For project-specific agents from `orchestration.toml`, use `subagent_type: "general-purpose"` and instruct the agent to read its own `.md` file from the path declared in `orchestration.toml`. Include the full roadmap content in each prompt along with the instruction: "Review this roadmap from your specialized perspective and produce your structured report."

Project-specific agents with `outputRole: blocker` must pass (no blocking findings) before proceeding to synthesis.

### Step R3: Synthesize results

After all agents return (the 4 core agents, plus any strategic lenses that fired), produce a unified summary:

```
## Roadmap Review Summary

The 4 core roadmap agents reviewed the roadmap in parallel{, plus the archetype-selected strategic lenses on the human path / — strategic lenses skipped because think-review already ran}. Here's what each found:

Agent: Scope Feasibility Agent
Focus: scope realism, feature conflicts, milestone sizing, constraints
Key Findings: [2-3 most important findings]
────────────────────────────────────────
Agent: Feature Coverage Agent
Focus: competitive analysis, feature gaps, over-engineering
Key Findings: [2-3 most important findings]
────────────────────────────────────────
Agent: Strategy Agent
Focus: vision clarity, positioning, differentiation, feature prioritization
Key Findings: [2-3 most important findings]
────────────────────────────────────────
Agent: UX Agent
Focus: user flows, state coverage, interaction patterns, a11y targets
Key Findings: [2-3 most important findings]
────────────────────────────────────────
[The following strategic-lens blocks appear ONLY on the human path — omit them entirely when think-review already ran, and instead print the one-line skip note from Step R1c. Include only the lenses archetype-selected in Step R1c.]
Agent: Engineering Review Agent (M-04 lens — strategic altitude)
Focus: approach soundness, architecture, dependency risk
Key Findings: [2-3 most important findings; note any BLOCKING findings]
────────────────────────────────────────
Agent: DevEx Review Agent (M-04 lens — strategic altitude; note if archetype excluded it)
Focus: integrator / operator experience
Key Findings: [2-3 most important findings]
────────────────────────────────────────
Agent: CEO Review Agent (M-04 lens — strategic altitude)
Focus: vision fit, positioning, strategic value
Key Findings: [2-3 most important findings]
────────────────────────────────────────
Agent: Design Review Agent (M-04 lens — strategic altitude; fires only for archetypes with a visual surface)
Focus: IA, state coverage, user-facing surface
Key Findings: [2-3 most important findings, or "skipped — archetype has no visual surface"]
```

### Step R4: Identify cross-cutting themes

After the per-agent summaries, add a section highlighting findings that multiple agents flagged independently — these are the highest-confidence issues.

### Step R5: Update roadmap status

If the roadmap's frontmatter has `status: draft`, update it to `status: reviewed` and set `lastReviewed` to today's date. Do NOT change status if it's already `approved`.

### Step R6: Offer next steps

Ask the user if they want to:
- Apply the recommendations to the roadmap automatically (via `/loom-roadmap review-integrate`)
- Deep-dive into any specific agent's full report
- Approve the roadmap as-is (via `/loom-roadmap approve`)
- Discuss specific features interactively before proceeding

### Step R7: Save Findings

1. Create `planning/history/reviews/` if it doesn't exist
2. Save the synthesized report to `planning/history/reviews/YYYY-MM-DD-roadmap-review.toon` using TOON format:

The `agents[N]` table MUST list exactly the agents that actually ran — the 4 core agents, plus each strategic lens that fired (human path only), plus any project-specific agents — and `agentCount` MUST equal that same number of rows (`N`). Do NOT hardcode `4`: on the auto path `agentCount` is `4 + project-specific count`; on the human path it is `4 + selected-lens count + project-specific count`. `thinkReviewRan` records which path was taken and `strategicLenses` lists the lenses that fired (empty when think-review already ran):

```toon
type: roadmap-review
roadmapFile: ROADMAP.md
reviewedAt: {ISO 8601}
thinkReviewRan: {true|false}
resolvedArchetype: {archetype | "n/a — think-review already ran"}
strategicLenses[K]: {selected lens names, or empty when think-review already ran}
agentCount: {N — MUST equal the number of rows in agents[] below}
structuralErrors: {count}
structuralWarnings: {count}

agents[N]{name,findingCount,blockingCount,warningCount,infoCount}:
  scope-feasibility-agent,{N},{N},{N},{N}
  feature-coverage-agent,{N},{N},{N},{N}
  strategy-agent,{N},{N},{N},{N}
  ux-agent,{N},{N},{N},{N}
  {one additional row per strategic lens that fired — omit all when think-review already ran}

findings[N]{id,agent,severity,dimension,title,description,recommendation}:
  {all findings from all agents, merged and deduped}

crossCuttingThemes[N]{theme,findingIds,confidence}:
  {themes flagged by multiple agents}
```

3. This enables `/loom-roadmap review-integrate` to read findings from disk in autonomous pipelines.

### Review Output Format

Use the structured summary format from Step R3, followed by cross-cutting themes and next steps. Keep each agent's summary concise (3-5 lines) — the full reports are available on request.

---

## Command: `review-integrate`

1. Read the most recent roadmap review file in `planning/history/reviews/` (files matching `*-roadmap-review.toon`)
2. Parse findings by severity (blocking → warning → info)
3. Filter to actionable findings
4. Spawn `roadmap-builder-agent` (general-purpose) with:
   - Instruction: "Read your instructions from `~/.claude/agents/roadmap-builder-agent.md` first."
   - Current roadmap
   - Filtered review findings
   - Instruction: "Apply these review recommendations. Use refinement mode. Annotate each change."
5. Run roadmap validation on the result
6. Show proposed changes for user approval (or auto-apply if `--auto`)
7. On approval: write roadmap, snapshot old version, update changelog

---

