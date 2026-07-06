```toon
pageId: component-context-budget
title: Context Budget Hook
category: component
subtype: ""
domain: code
summary: PreToolUse hook on Agent that estimates a subagent prompt's token size before spawn and blocks spawns exceeding agentBudgetCap, with tier multipliers for test agents. Fail-open.
estimatedTokens: 923
bodySections[3]: Summary, Dependencies, Key Behaviors
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-07-06T00:00:00Z
createdBy: human
updatedBy: wiki-ingest-agent
sourceRefs[2]: hooks/context-budget.ts, hooks/lib/token-estimator.ts
crossRefs[4]{pageId,relationship}:
  component-hooks-system,depends-on
  component-context-monitor,relates-to
  decision-hook-merges,relates-to
  convention-settings-json,relates-to
tags[5]: hooks, context, budget, token-estimation, agents
staleness: fresh
confidence: high
```

# Context Budget Hook

## Summary

`hooks/context-budget.ts` is a `PreToolUse` hook matched on the `Agent` tool. Before a subagent spawns, it estimates the incoming prompt's token size and blocks spawns that would exceed the configured `agentBudgetCap`. It was merged from two prior hooks (`context-budget` + `context-budget-test`) to avoid spawning two `bun` processes per Agent call — see [decision-hook-merges](decision-hook-merges.md).

## Dependencies

- **`hooks/lib/token-estimator.ts`** — `estimateTokens`, `estimateFileTokens`, and `estimateContextBudget` for the prompt breakdown.
- **`hooks/lib/run-hook.ts`** — `runHook` harness plus `allow`/`block` helpers (fail-open).
- **`hooks/lib/context.ts`** — `findPlanExecutionDir()` to locate rolling-context and stage-context files.
- **`.claude/orchestration.toml` `[settings.contextBudget]`** — supplies `contextWindow` and optional `agentBudgetCap`.

## Key Behaviors

**Entry check:** returns `allow()` immediately if `tool_name !== "Agent"` or the prompt is empty.

**Token estimation** (`token-estimator.ts`) uses the chars/4 heuristic. `estimateTokens(text)` = `Math.ceil(text.length / 4)`. `estimateFileTokens(path)` = `Math.ceil(statSync(path).size / 4)` (byte size, no read; returns 0 on missing/unreadable = fail-open). `estimateContextBudget()` sums a breakdown:

| Component | Method |
|-----------|--------|
| `taskPrompt` | chars / 4 |
| `agentInstructions` (agent `.md` path scanned from prompt) | file stat / 4 |
| `rollingContext` (`.plan-execution/rolling-context.md`) | file stat / 4 |
| `stageContext` (`stage-context/*.toon`) | file stat / 4 each |
| `overhead` | fixed 5000 |

**Config parsing:** regex-extracts only `contextWindow` and `agentBudgetCap` from the `[settings.contextBudget]` section (no full TOML parse). Defaults: `contextWindow = 200000`, `agentBudgetCap = 100000` (= `contextWindow / 2` when omitted). Missing file or section → defaults.

**Test-agent tier multipliers** reduce the effective cap for recognized test agents (`vitest-runner`→unit, `integration-test-agent`→integration, `e2e-runner-agent`/`e2e-test-writer-agent`→e2e, `qa-review-agent`→qa-review; also prompt markers `stage: e2e` / `stage: qa-review`). Effective cap = `Math.floor(baseCap * multiplier)` with multipliers unit 0.6, integration 0.8, e2e 1.0, qa-review 0.75.

**Block vs warn:** estimate > effective cap → block with a per-component breakdown; 80–100% of cap → allow with utilization warning; < 80% → allow silently.

**Agent `.md` path resolution:** scans the prompt for `~/.claude/agents/*.md`, `~/.loom-ai/agents/*.md`, `agents/*.md` (and `.claude`/`.loom-ai` variants), expands `~`, and validates the resolved path exists. Paths outside expected dirs are rejected.

**Fail-open:** any estimation error allows the spawn (via the `runHook` harness).
