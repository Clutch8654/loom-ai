```toon
pageId: component-context-monitor
title: Context Monitor Hook
category: component
subtype: ""
domain: code
summary: PostToolUse (all tools) + Stop hook that estimates cumulative context usage, injects debounced checkpoint warnings, and writes contextRemaining to status.toon. Advisory-only, fail-open.
estimatedTokens: 907
bodySections[3]: Summary, Dependencies, Key Behaviors
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-07-06T00:00:00Z
createdBy: human
updatedBy: wiki-ingest-agent
sourceRefs[1]: hooks/context-monitor.ts
crossRefs[4]{pageId,relationship}:
  component-hooks-system,depends-on
  component-context-budget,relates-to
  decision-hook-merges,relates-to
  convention-settings-json,relates-to
tags[5]: hooks, context, monitor, checkpoint, statusline
staleness: fresh
confidence: high
```

# Context Monitor Hook

## Summary

`hooks/context-monitor.ts` is a `PostToolUse` (all tools) and `Stop` hook. It estimates cumulative context usage, injects checkpoint warnings into Claude's output stream, and writes `contextRemaining` to `status.toon` for statusline display. It never blocks — it is advisory only. It was merged from two prior hooks (`context-monitor` + `checkpoint-trigger`) to avoid duplicate filesystem walks on every tool use — see [decision-hook-merges](decision-hook-merges.md).

## Dependencies

- **`hooks/lib/run-hook.ts`** — harness and helpers; guarantees fail-open behavior.
- **`.plan-execution/`** artifacts — `rolling-context.md`, `stage-context/*.toon`, `wave-N-summary.toon`, `state.toon`, `pipeline-state.toon` (contribute to the usage estimate).
- **`.plan-execution/context-monitor-state.json`** — debounce state across tool calls.
- **`status.toon`** — updated in place (only if it already exists).
- **`.claude/orchestration.toml` `[settings.contextBudget]`** — `contextWindow`, `checkpointWarning`, `checkpointCritical`.

## Key Behaviors

**Usage estimation** builds up consumed tokens from known signals: fixed 5000 overhead + `toolUseCount * 200` + file-stat/4 for `rolling-context.md`, each `stage-context/*.toon`, each `wave-N-summary.toon`, `state.toon`, and `pipeline-state.toon`. `remainingFraction = (contextWindow - estimated) / contextWindow`. Without a `planExecDir`, only overhead + tool-interaction count are used.

**Thresholds** (defaults): `checkpointWarning = 0.35`, `checkpointCritical = 0.25`.

**Debounce** (`context-monitor-state.json`, e.g. `{toolUseCount, lastWarnAt, lastSeverity}`): a warning fires when any of — interval `toolUseCount - lastWarnAt >= 5`; severity just escalated `warning → critical` (bypasses debounce); or a `Stop` event (always fires, no debounce). Stop is detected via `input.tool_name === undefined`.

**status.toon update:** when `planExecDir` exists and `status.toon` already exists there, atomically updates `contextRemaining` (and `contextCritical: true` below the critical threshold) via `.tmp` → `renameSync`. Never creates `status.toon` — avoids stale files in non-pipeline sessions.

**Warning messages:** a compact warning line at warning severity; a multi-line CONTEXT CHECKPOINT (CRITICAL) block at critical severity recommending `/loom-pause --compact`, `/clear`, then resume.

**Resume-command detection** inspects the plan-execution dir to suggest the right resume: `pipeline-state.toon` → `/loom-auto --resume`; `convergence-state.toon` → `/loom-converge --resume`; `state.toon` → `/loom-plan execute --resume`; none → `/loom-resume`.

**Fail-open:** all filesystem operations are wrapped in try/catch; any error silently allows the operation. PostToolUse and Stop cannot block.
