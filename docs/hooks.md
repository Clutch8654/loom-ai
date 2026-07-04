# Hooks (Deterministic Enforcement)

Eighteen Claude Code hooks enforce Loom invariants at the tool-call level (the canonical registration manifest is `scripts/lib/loom-hooks-manifest.ts`). Fail-open on missing state, fail-closed on schema-version mismatches.

| Hook | Event | What it does |
|------|-------|-------------|
| `file-ownership` | PreToolUse (Write/Edit) | Blocks writes outside the active task's file ownership boundary |
| `contract-lock` | PreToolUse (Write/Edit) | Locks `contracts/` after Wave 0 |
| `context-budget` | PreToolUse (Agent) | Estimates spawn prompt size, blocks if > `agentBudgetCap` (default 100k) |
| `budget-tracker` | PreToolUse + SubagentStop | Tracks agent count vs budget |
| `checkpoint-trigger` | (various) | Triggers stage-summary checkpoints at thresholds |
| `context-monitor` | (various) | Streams context state into the statusline |
| `deploy-guard` | PreToolUse (Bash) | Blocks destructive bash commands without explicit confirmation |
| `loom-careful` | PreToolUse (Bash) | Session-level destructive-command guard (`rm -rf /`, `DROP TABLE`, force-push…); override with `LOOM_CAREFUL_OVERRIDE=1` |
| `preflight-worktree-scan` | PreToolUse (Bash) | Cross-worktree ownership scan on `/loom-git pr`; warns on sibling-worktree overlap |
| `quality-gate` | Stop | Prevents premature pipeline stops |
| `typecheck-on-write` | PostToolUse (Write/Edit on .ts) | Runs `tsc` after TS writes, feeds errors back |
| `agent-result-validator` | PostToolUse (Write/Edit) | Scans AgentResult envelopes for findings missing `confidence: 1-10` |
| `status-updater` | PostToolUse | Writes `status.toon` timestamps and ambient state |
| `wiki-write-guard` | PreToolUse | Enforces wiki page format + cross-ref integrity |
| `wiki-impact-warner` | PreToolUse | Warns when code edits affect contract-page-tracked domains |
| `wiki-session-status` | SessionStart | Loads wiki context summary on session start |
| `wiki-commit-ledger` | PostToolUse | Records wiki-affecting commits for drift detection |
| `loom-migration` | SessionStart | Detects old-format Loom artifacts and nudges `/loom-upgrade` |

Plus two infrastructure scripts:

- `statusline-renderer.cjs` — pipeline + test metrics + convergence segments
- `loom-update-checker.cjs` — background catalog version check (4h throttle)

Plus one test-agent budget hook: `context-budget-check.ts`.

Register wiki hooks into `~/.claude/settings.json` via `scripts/register-wiki-hooks.ts`.

For the severity convention (which event type to slot a hook into when authoring a kit), see the README's [Install → Hook enforcement](../README.md#hook-enforcement-per-project) section.
