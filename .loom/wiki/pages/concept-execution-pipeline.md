```toon
pageId: concept-execution-pipeline
title: Execution Pipeline
category: concept
subtype:
domain: code
summary: Staged, wave-based pipeline for parallel agent work. schemaVersion-2 pipeline-state adds a chained-link trampoline (nextLink cursor + linkHistory) driving verify↔fix loops.
estimatedTokens: 1154
bodySections[6]: Summary, Pipeline Stages, Wave-Based Execution, File Ownership, Pipeline State Tracking, Stage Context and Resumability
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-07-06T00:00:00Z
createdBy: human
updatedBy: wiki-ingest-agent
sourceRefs[2]: protocols/execution-conventions.md, protocols/pipeline-state.schema.md
crossRefs[3]{pageId,relationship}:
  concept-convergence,relates-to
  convention-agent-result,relates-to
  component-orchestration-patterns,relates-to
tags[5]: pipeline, waves, execution, state, contracts
staleness: fresh
confidence: high
```

# Execution Pipeline

## Summary

The Loom execution pipeline is a staged, wave-based system for coordinating parallel agent work with file-ownership enforcement, resumable state, and structured handoffs. Its state model is now **schemaVersion 2**: the linear stage list gained a **chained-link trampoline** — a `nextLink` cursor plus `linkHistory[]` — that drives bounded `verify`↔`fix` loops without re-entering the whole pipeline. Source: `protocols/execution-conventions.md`, `protocols/pipeline-state.schema.md`.

## Pipeline Stages

`/loom-auto` runs roadmap stages → `plan-create` → `execute` → `converge` (optional) → then the **link trampoline**: `verify` → `fix` (if findings) → `verify` … → `done`. Legacy `test` + `review-code` collapsed into a single `verify` link; `currentStage` values include `link-complete-verify`. Each transition is recorded; on `--resume` the orchestrator reads `currentStage`/`nextLink` and re-enters at the correct point.

## Wave-Based Execution

The `execute` stage uses a wave model:

- **Wave 0 — Contracts.** `contracts-agent` (opus) runs alone first, producing shared TypeScript types, DB schemas, API contracts, and a `manifest.toon`. It must complete before any Wave 1 agent spawns — the critical serialization point all downstream agents depend on.
- **Wave 1+ — Parallel Implementers.** Multiple `implementer-agent` (opus) instances run in parallel. Each receives the Wave-0 contracts, its PLAN.md task, and a file-ownership list. **No two agents may write the same file.** If an implementer needs a file owned by another agent, it emits a `crossBoundaryRequest` in its AgentResult; the orchestrator's wiring step processes these after the wave.

## File Ownership

File ownership prevents merge conflicts in parallel execution: the orchestrator assigns each task a create/modify file list; agents must not write outside it; `verification-agent` runs after each wave and detects drift; cross-boundary needs go through `crossBoundaryRequests`. The `contract-lock` PreToolUse hook blocks writes to `contracts/` after Wave 0.

## Pipeline State Tracking

State is written atomically (`.tmp` then rename) to `.plan-execution/pipeline-state.toon` at every transition. Key v2 fields:

```toon
schemaVersion: 2
runId: uuid
currentStage: link-complete-verify
outerIteration: 2
maxIterations: 3
agentsSpawned: 34
maxAgents: 50
nextLink: fix                     # trampoline cursor (v2)
trampolineIteration: 6
maxTrampolineIterations: 20
stageHistory[N]{stage,status,iteration,startedAt,completedAt,agentsUsed,gateResult}:
linkHistory[N]{link,status,trampolineIteration,outerIteration,startedAt,completedAt,agentsUsed,nextLink,nextLinkReason}:
failureLog[N]{iteration,stage,error,resolution}:
```

`outerIteration` counts plan-revision loops (cap `maxIterations`, default 3); `trampolineIteration` counts link hops (cap `maxTrampolineIterations`, default 20). `failureLog` tracks identical-failure patterns — a recurring error trips a circuit breaker and escalates rather than running another fix cycle. `agentsSpawned` is tracked against `maxAgents` (warn at 80%, hard-block at 100%).

## Stage Context and Resumability

Every stage writes a structured `StageContext` summary to `.plan-execution/stage-context/{stage}.toon` (atomic write) — the source of truth. `.plan-execution/rolling-context.md` is a compressed, human-readable derivative; if they disagree, the stage summary wins. The pipeline is fully resumable at any stage/link boundary: roadmap stages re-enter at the matching step, `execute` delegates to `loom-execute-plan --resume` for wave-level resume, `converge` to `loom-converge --resume`, and the trampoline resumes from `nextLink`.
