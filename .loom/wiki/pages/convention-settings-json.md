```toon
pageId: convention-settings-json
title: settings.json Hook Registration Convention
category: convention
subtype:
domain: code
summary: .claude/settings.json is Loom's hook registry. Every hook is a .ts file launched via the run-hook.sh runtime wrapper (bun → npx tsx → fail-open) across 5 event types.
estimatedTokens: 1205
bodySections[6]: Summary, Examples, Runtime Wrapper Convention, Current Hook Registrations, Timeout Guidelines, Adding a New Hook
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-07-06T00:00:00Z
createdBy: human
updatedBy: wiki-ingest-agent
sourceRefs[2]: .claude/settings.json, hooks/run-hook.sh
crossRefs[3]{pageId,relationship}:
  component-hooks-system,relates-to
  component-deploy-guard,relates-to
  component-context-budget,relates-to
tags[4]: convention, hooks, settings, configuration
staleness: fresh
confidence: high
```

# settings.json Hook Registration Convention

## Summary

`.claude/settings.json` is the Claude Code project settings file and, in Loom, the authoritative registry for every hook registration. Hooks are TypeScript files in `hooks/`. As of the current layout they are **no longer invoked with `bun` directly** — every registration launches through the `hooks/run-hook.sh` runtime wrapper, which resolves the runtime (`bun` → `npx tsx` → fail-open) so a single command works on any machine. Registrations now span five event types: `SessionStart`, `PreToolUse`, `PostToolUse`, `SubagentStop`, and `Stop`.

## Examples

Each hook is registered as a `command`-type entry whose command shells out to the wrapper:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "sh \"$CLAUDE_PROJECT_DIR/hooks/run-hook.sh\" \"$CLAUDE_PROJECT_DIR/hooks/contract-lock.ts\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

| Field | Description |
|-------|-------------|
| `EventType` | `SessionStart`, `PreToolUse`, `PostToolUse`, `SubagentStop`, or `Stop` |
| `matcher` | Pipe-separated tool names (`Write\|Edit`), `"*"` (SessionStart), or `""` for all tools |
| `type` | Always `"command"` |
| `command` | `sh "$CLAUDE_PROJECT_DIR/hooks/run-hook.sh" "$CLAUDE_PROJECT_DIR/hooks/<name>.ts"` |
| `timeout` | Seconds before Claude Code kills the hook process |

An empty `matcher: ""` matches all tool calls for that event (used by `context-monitor`, `checkpoint-trigger`, and the `SubagentStop`/`Stop` handlers).

## Runtime Wrapper Convention

`hooks/run-hook.sh` is a POSIX-sh launcher that resolves a runtime for the `.ts` hook: **`bun` → `npx tsx` → fail-open (exit 0)**, so the same `settings.json` works whether or not `bun` is installed (fresh machines, CI, node-only users). It appends Homebrew bin dirs to `PATH` (a user's pinned mise/asdf/volta/nvm runtime still wins) and honors a `LOOM_HOOK_RUNTIME` override. If no runtime is found it exits 0 with a warning — Loom hooks never block on infrastructure absence, only on real contract violations.

## Current Hook Registrations

| Event | Matcher | Hooks (in order) |
|-------|---------|------------------|
| `SessionStart` | `*` | `wiki-session-status`, `loom-migration` |
| `PreToolUse` | `Write\|Edit` | `contract-lock`, `file-ownership`, `wiki-write-guard`, `wiki-impact-warner` |
| `PreToolUse` | `Bash` | `deploy-guard`, `loom-careful`, `preflight-worktree-scan` |
| `PreToolUse` | `Agent` | `context-budget`, `budget-tracker` |
| `PostToolUse` | `Write\|Edit` | `typecheck-on-write`, `shellcheck-on-write`, `bash-portability-on-write`, `pylint-on-write` |
| `PostToolUse` | `Bash` | `wiki-commit-ledger` |
| `PostToolUse` | `""` (all) | `context-monitor`, `checkpoint-trigger` |
| `SubagentStop` | `""` | `agent-result-validator`, `status-updater` |
| `Stop` | `""` | `quality-gate`, `context-monitor` |

## Timeout Guidelines

| Hook Type | Timeout |
|-----------|---------|
| Session status / notices (`wiki-session-status`) | 5s |
| Simple pattern matching, file stats (`deploy-guard`, `context-budget`, `context-monitor`) | 10s |
| Compiler / linter invocation (`typecheck-on-write`, `pylint-on-write`) | 30s |

Hooks that exceed their timeout are killed by Claude Code. All Loom hooks are fail-open, so a timeout (or a missing runtime) yields an allowed operation.

## Adding a New Hook

1. Create `hooks/<hook-name>.ts` using the `runHook` harness from `hooks/lib/run-hook.ts`.
2. Add a registration under the appropriate event/matcher, invoking it via `sh "$CLAUDE_PROJECT_DIR/hooks/run-hook.sh" "$CLAUDE_PROJECT_DIR/hooks/<hook-name>.ts"` — never call `bun`/`node` directly.
3. Set a conservative timeout (err high — hooks that time out fall through safely).
4. Ensure the hook exits 0 on errors (the harness handles this automatically).
