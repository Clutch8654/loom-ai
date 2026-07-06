```toon
pageId: component-hooks-system
title: Hooks System
category: component
subtype: ""
domain: code
summary: Loom's Claude Code hook layer — bun-executed TypeScript hooks on Pre/PostToolUse and Stop events, built on the fail-open run-hook.ts harness, providing safety, budget, and context guards.
estimatedTokens: 951
bodySections[3]: Summary, Dependencies, Key Behaviors
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-07-06T00:00:00Z
createdBy: human
updatedBy: wiki-ingest-agent
sourceRefs[6]: hooks/lib/run-hook.ts, hooks/deploy-guard.ts, hooks/context-budget.ts, hooks/context-monitor.ts, hooks/budget-tracker.ts, hooks/typecheck-on-write.ts
crossRefs[4]{pageId,relationship}:
  component-deploy-guard,relates-to
  component-context-budget,relates-to
  component-context-monitor,relates-to
  convention-settings-json,relates-to
tags[4]: hooks, infrastructure, claude-code, pre-tool-use
staleness: fresh
confidence: high
```

# Hooks System

## Summary

The Loom hooks system intercepts Claude Code tool calls via the Claude Code hook protocol. Hooks are TypeScript files executed by `bun` before or after tool use, enabling safety guards, budget enforcement, and context monitoring without modifying Claude's core behavior. Every hook is built on the shared `run-hook.ts` harness and inherits its fail-open guarantee.

## Dependencies

Hooks import from `hooks/lib/`:

| Module | Purpose |
|--------|---------|
| `run-hook.ts` | Harness, `allow`/`block` helpers, stdin parsing, error isolation |
| `token-estimator.ts` | Token estimation for the budget hooks |
| `context.ts` | `findPlanExecutionDir()`, `readPipelineState()` |

All hooks are registered in `.claude/settings.json` under the `hooks` key — see [convention-settings-json](convention-settings-json.md).

## Key Behaviors

**Lifecycle events:** `PreToolUse` (before a call; exit code 2 blocks), `PostToolUse` (after; feedback only), `Stop` (Claude stops responding; feedback only). Each hook process receives a JSON payload on stdin (`{tool_name, tool_input}`) and writes a JSON response to stdout — exit 0 allows (optional message), exit 2 blocks (with `reason`). For PostToolUse/Stop only exit 0 is meaningful.

**The run-hook.ts harness** provides: stdin consumption (handles partial reads / empty pipes), JSON parsing (`{}` on empty stdin), error isolation, and response formatting (`{"decision":"block","reason":"..."}`). Its critical safety property is the **fail-open pattern** — any error, throw, or config-read failure exits 0 so a broken hook never blocks all writes/spawns/commands. Errors go to stderr with a `[loom-hook:<name>]` prefix. Helpers: `allow(message?)` and `block(reason)`.

**Individual hooks:**

- **deploy-guard.ts** — PreToolUse/`Bash`. Blocks pushes to protected branches and production deploys. See [component-deploy-guard](component-deploy-guard.md).
- **context-budget.ts** — PreToolUse/`Agent`. Estimates prompt token size before a spawn, blocks oversized spawns. See [component-context-budget](component-context-budget.md).
- **budget-tracker.ts** — PreToolUse/`Agent`. Enforces the pipeline's `maxAgents` spawn budget from `pipeline-state.toon`; increments `agentsSpawned` per spawn (counts spawns, not completions — no SubagentStop event exists), warns at 80%, blocks at `agentsSpawned >= maxAgents`; fail-open if state is missing/unreadable.
- **context-monitor.ts** — PostToolUse (all tools) + Stop. Estimates cumulative context usage and injects checkpoint warnings. See [component-context-monitor](component-context-monitor.md).
- **typecheck-on-write.ts** — PostToolUse/`Write|Edit`. Runs `tsc --noEmit` after any `.ts/.tsx/.mts/.cts` write, feeds errors back as advisory feedback (never blocks); skipped when `LOOM_SKIP_TYPECHECK` is set; output truncated to 2000 chars.
