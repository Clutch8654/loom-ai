```toon
pageId: component-orchestration-patterns
title: Orchestration Patterns
category: component
subtype: ""
domain: code
summary: Seven reusable multi-agent coordination patterns — debate, chain, vote, triage, converge, criteria-converge, benchmark — declared in orchestration.toml, executed by the pattern-executor, with a 4-tier convergence model.
estimatedTokens: 1200
bodySections[3]: Summary, Dependencies, Key Behaviors
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-07-06T00:00:00Z
createdBy: human
updatedBy: wiki-ingest-agent
sourceRefs[2]: protocols/orchestration-patterns.md, protocols/pattern-executor.md
crossRefs[3]{pageId,relationship}:
  pattern-model-resolution,relates-to
  concept-convergence,relates-to
  concept-execution-pipeline,relates-to
tags[6]: patterns, debate, chain, vote, triage, converge
staleness: fresh
confidence: high
```

# Orchestration Patterns

Loom provides **seven** reusable multi-agent coordination patterns, each a specific interaction topology with deterministic orchestration logic. Patterns are declared under `[patterns.*]` in `orchestration.toml` and invoked by commands or agents. Runtime mechanics (trigger matching, per-pattern spawn sequences, the `PatternResult` envelope, budget accounting) live in `protocols/pattern-executor.md`.

## Summary

The seven patterns are **Debate** (adversarial reasoning), **Chain** (sequential refinement), **Vote** (independent solutions + evaluator), **Triage** (cheap-model routing), **Converge** (match deterministic targets), **Criteria Converge** (TDD/quality gates that loop until conditions pass), and **Benchmark** (competitive scorecard of a pre-roadmap idea). Patterns 5 and 6 support a 4-tier convergence model that maps verification scope to the planning hierarchy.

## Dependencies

- **`protocols/pattern-executor.md`** — trigger matching (first-match-wins), per-pattern execution, `PatternResult`, budget accounting.
- **`orchestration.toml`** — `[patterns.*]` declarations with `type`, `trigger`, and type-specific fields.
- **`convergence-tier.schema.md`** and the convergence-driver / convergence-planner — drive the 4-tier model for Patterns 5–6.
- **`benchmark-agent`** + `BenchmarkScorecard` schema — the single agent Pattern 7 spawns.

## Key Behaviors

### The seven patterns

1. **Debate** — advocate vs critic over rounds, moderator synthesizes. Cost `(maxRounds*2)+1` (default 3, max 5).
2. **Chain** — each agent refines the prior output; `passOriginalInput` optional; N agents; on failure return prior output annotated.
3. **Vote** — N solvers in isolated worktrees + 1 evaluator; skips evaluator if <2 succeed. Most expensive.
4. **Triage** — a cheap (haiku) router classifies complexity (simple/complex/multi-domain) and routes to specialists; pays off when >50% of tasks are simple.
5. **Converge** — iterate until output matches a golden reference (see `concept-convergence`).
6. **Criteria Converge** — TDD at plan level: criteria-planner + criteria-harness-builder set up, then a bounded loop runs tests (hard criteria) + reviewers (soft criteria) → delta-analyzer → parallel fixers, with conflict-freeze and circuit breakers. Priority order: tests → security → code-review → advisory.
7. **Benchmark** — one `benchmark-agent` scores a bare idea against N references across ≥3 dimensions and writes a typed `BenchmarkScorecard` into the `.loom/thinks/` doc. Runs PRE-roadmap; trigger `competitive-benchmark` (`--benchmark`). Distinct from the `loom-benchmark` perf skill.

### 4-Tier convergence model

Patterns 5–6 map verification scope to planning levels (`convergence-tier.schema.md`):

| Tier | Level | Runner | Gating |
|------|-------|--------|--------|
| unit | wave | vitest-runner | block-wave |
| integration | feature | integration-test-agent | block-feature |
| e2e | milestone | e2e-runner-agent | block-milestone |
| qa-review | phase | qa-review-agent | advisory |

The loop also integrates flaky-test quarantine (`flaky-test.schema.md`), convergence rollback (`convergence-rollback.md`), and schema-upgrade migrations (`schema-upgrade.md`).

### Trigger matching & PatternResult

The executor reads all `[patterns.*]` entries and compares a task's semantic label against each `trigger` — **first match wins**, else fall back to a single-agent spawn. Every pattern returns a `PatternResult` with `pattern`, `type` (`debate|chain|vote|triage|converge|converge-criteria|benchmark`), `result`, and `agentsUsed`, plus type-specific fields (`transcript`/`rounds` for debate, `solutions` for vote, `routing` for triage).

### Budget accounting

Each pattern reports `agentsUsed`, accumulated toward the orchestrator's agent budget (e.g. `/loom-auto --max-agents 50`): warn at 80%, hard-block pattern invocation at 100%.
