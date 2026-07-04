---
description: "Launch up to 10 parallel planning-review agents (6 core + 4 specialized lenses) and synthesize a unified plan-quality report."
---

## Subcommand: review

You are an orchestrator that launches up to 10 specialized planning agents in parallel — the 6 core planning agents plus the 4 M-04 review lenses (CEO, Engineering, Design, DevEx) — to review, improve, or create a project plan.

**Agent count is 10, not 6.** The 6 core agents (feature-coverage, strategy, ux, phasing, parallelization, agentic-workflow) always run. The 4 M-04 lenses run by default too, but are archetype-relevant: `plan-eng-review-agent` and `plan-devex-review-agent` apply to essentially every plan; `plan-ceo-review-agent` and `plan-design-review-agent` add the most value on product/UI-facing plans and may be skipped (with a one-line note) on pure-infrastructure plans. Do not silently run only the 6 core agents — that omits the engineering and DevEx lenses that catch the highest-severity findings.

### Context

This subcommand reviews a PLAN.md (or equivalent planning document) by spawning up to 10 specialized agents simultaneously (6 core + 4 M-04 lenses). Each agent focuses on a different dimension of plan quality. After all agents complete, synthesize their findings into a unified summary.

### Arguments

Parse remaining arguments:
- No args: resolve plan per `protocols/planning-paths.md` (planning/plans/PLAN.md → planning/archive/PLAN.md → PLAN.md at root)
- `<path>`: use that file instead
- `--full`: run all agents with extended analysis (default behavior)

### Instructions

#### Status Line Updates

Write `.plan-execution/ephemeral/status.toon` per `execution-conventions.md` section "Orchestration Status".

#### Step 0: Read Protocols

Read `~/.claude/protocols/validation-rules.md` for AgentResult validation and blocker gate enforcement rules.

#### Step 1: Find the Plan

Resolve the planning document per `protocols/planning-paths.md`: check `planning/plans/PLAN.md`, then `planning/archive/PLAN.md`, then `PLAN.md` at root (legacy), then the user-specified path. Read it to confirm it exists and has content.

#### Step 1a: Structural Pre-check

Before spawning agents, run plan validation stages 1-4 from `validation-rules.md` Section 6:
- Stage 1 (Structure): frontmatter, required sections, Phase 0
- Stage 2 (Dependencies): cycle detection, self-deps, undefined references
- Stage 3 (Ownership): same-wave overlaps, deliverable boundary checks
- Stage 4 (Sizing): oversized phases, missing criteria

If structural errors are found, include them as a **"Structural Issues"** section at the top of the final report, before agent results. The 6 agents still run -- they catch different things (feature gaps, UX issues, parallelization opportunities) that structural validation doesn't cover. But surfacing structural errors first gives the user the most actionable feedback.

#### Step 1b: Check for Project-Specific Agents

Look for `.claude/orchestration.toml` in the project root. If it exists, read it and extract any agents registered under the `planning:` section. These will be spawned alongside the 6 built-in agents.

#### Step 2: Launch All Agents in Parallel

Launch all agents in parallel using the Agent tool. Each agent must receive the full text of the plan in its prompt (agents cannot read files from your context). Send ALL Agent tool calls in a SINGLE message so they run concurrently. This includes the 6 built-in agents plus any from `orchestration.toml`:

- **feature-coverage-agent** -- Audit schema, API surface, and features against competitors
- **strategy-agent** -- Evaluate positioning, differentiation, audience, feature prioritization (planning mode)
- **ux-agent** -- Evaluate user flows, state coverage, interaction patterns, a11y targets (planning mode)
- **phasing-agent** -- Review phase boundaries, dependencies, and sequencing risks
- **parallelization-agent** -- Design multi-agent execution waves and merge strategy
- **agentic-workflow-agent** -- Decompose phases into discrete context-bounded tasks for AI agents
- **plan-ceo-review-agent** -- CEO-lens 11-section review (vision, impact, positioning, scope, architecture, error/rescue map, security, data model, metrics, risks, distribution) with 4 modes and confidence-calibrated findings (M-04)
- **plan-eng-review-agent** -- Engineering-lens 7-pass review with anti-skip clauses citing named regressions from `.loom/regressions.toon` (M-04)
- **plan-design-review-agent** -- Design-lens 7 sequential passes (IA, interaction, journey, state coverage, empty/error/loading, a11y, visual hierarchy) rated 0-10 with prescribe-to-10 (M-04)
- **plan-devex-review-agent** -- DevEx 8-pass review benchmarked against a DX Hall of Fame reference; emits `predictedTTHW` for the `/loom-devex review` boomerang comparison (M-04)

For each built-in agent, use `subagent_type` matching the agent name. For project-specific agents from `orchestration.toml`, use `subagent_type: "general-purpose"` and instruct the agent to read its own `.md` file from the path declared in `orchestration.toml` -- do NOT embed the file contents. Include the full plan content in each prompt along with the instruction: "Review this plan from your specialized perspective and produce your structured report."

Project-specific agents with `outputRole: blocker` must pass (no blocking findings) before proceeding to synthesis. Agents with `outputRole: reviewer` are included in the synthesis like built-in agents.

#### Step 3: Synthesize Results

After all agents return, produce a unified summary:

```
## Plan Review Summary

The planning agents ran in parallel reviewing the plan (6 core + the M-04 lenses that applied). Here's what each one focused on:

Agent: Feature Coverage Agent
Specialization: [what it focused on]
Key Feedback: [2-3 most important findings]
────────────────────────────────────────
Agent: Strategy Agent
Specialization: [what it focused on]
Key Feedback: [2-3 most important findings]
────────────────────────────────────────
Agent: UX Agent
Specialization: [what it focused on]
Key Feedback: [2-3 most important findings]
────────────────────────────────────────
Agent: Phasing Agent
Specialization: [what it focused on]
Key Feedback: [2-3 most important findings]
────────────────────────────────────────
Agent: Parallelization Agent
Specialization: [what it focused on]
Key Feedback: [2-3 most important findings]
────────────────────────────────────────
Agent: Agentic Workflow Agent
Specialization: [what it focused on]
Key Feedback: [2-3 most important findings]
────────────────────────────────────────
Agent: Engineering Review Agent (M-04 lens)
Specialization: [architecture, dependencies, error handling, sizing, phasing, parallelization, contracts — with anti-skip clauses citing named regressions]
Key Feedback: [2-3 most important findings; note any BLOCKING findings]
────────────────────────────────────────
Agent: DevEx Review Agent (M-04 lens)
Specialization: [8-pass developer-experience review; emits predictedTTHW for the /loom-devex boomerang]
Key Feedback: [2-3 most important findings; include predictedTTHW]
────────────────────────────────────────
Agent: CEO Review Agent (M-04 lens — product/UI plans; note if skipped)
Specialization: [vision fit, business impact, positioning, scope discipline, risks, distribution]
Key Feedback: [2-3 most important findings, or "skipped — pure-infrastructure plan"]
────────────────────────────────────────
Agent: Design Review Agent (M-04 lens — product/UI plans; note if skipped)
Specialization: [IA, interaction flow, journey, state coverage, empty/error/loading, a11y, visual hierarchy]
Key Feedback: [2-3 most important findings, or "skipped — no user-facing UI"]
```

#### Step 4: Identify Cross-Cutting Themes

After the per-agent summaries, add a section highlighting findings that multiple agents flagged independently -- these are the highest-confidence issues.

#### Step 5: Offer Next Steps

Ask the user if they want to:
- Apply the recommendations to the plan automatically
- Deep-dive into any specific agent's full report
- Re-run a specific agent with additional context

#### Step 6: Save Findings

1. Create `planning/history/reviews/` if it doesn't exist
2. Save the synthesized report to `planning/history/reviews/YYYY-MM-DD-review.toon` using TOON format
3. This enables `/loom-plan create --review-integrate` to read findings from disk in autonomous pipelines

### Output Format

Use the structured summary format from Step 3, followed by cross-cutting themes and next steps. Keep each agent's summary concise (3-5 lines) -- the full reports are available on request.

---
