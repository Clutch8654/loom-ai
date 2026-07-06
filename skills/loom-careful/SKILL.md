---
name: loom-careful
description: "Destructive-command PreToolUse guard — blocks rm -rf /, DROP TABLE, force-push, chmod 777, raw-device writes before Claude Code runs them. Single-command and session bypass via LOOM_CAREFUL_OVERRIDE."
---

# /loom-careful — Destructive-Command Guard

<!-- @loom-include: protocols/skill-preamble.md -->

`/loom-careful` is the deterministic safety guard that stops Claude Code from
executing catastrophic Bash commands. It is a **PreToolUse** hook, not an
advisory ceremony: the enforcement fires before the shell ever sees the
command, denying the tool call with error code `CAREFUL_BLOCKED`.

## What it blocks

The guard evaluates every `Bash` tool call against a regex blocklist. A match
denies the command; anything else passes untouched.

| Rule id | Blocks | Example |
|---|---|---|
| `rm-rf-root` | `rm -rf` against `/`, `~`, `.`, `*` | `rm -rf ~` |
| `sql-destructive` | `DROP TABLE`, `DROP DATABASE`, `TRUNCATE TABLE` | `DROP TABLE users;` |
| `git-force-push` | `git push --force`, `git push -f`, `--force-with-lease` | `git push --force origin main` |
| `git-reset-hard` | `git reset --hard` | `git reset --hard HEAD~5` |
| `chmod-777-recursive` | `chmod -R 777` | `chmod -R 777 /etc` |
| `dd-dev` | `dd` targeting `/dev/*` | `dd if=x of=/dev/sda` |
| `mkfs` | filesystem formatters | `mkfs.ext4 /dev/sdb1` |
| `redirect-dev-sda` | output redirect to `/dev/sd*` | `echo x > /dev/sda1` |

## Enforcement contract (wired + proven)

- **Source:** `hooks/loom-careful.ts` — exports `evaluate(cmd)`, `RULES`,
  `CAREFUL_BLOCKED`.
- **Wiring:** registered as a `PreToolUse` Bash hook in `hooks/hooks.json`
  (`run-hook.sh … hooks/loom-careful.ts`) and declared under
  `library.infrastructure` in `skills/library.yaml`.
- **Behavior:** on a blocked command the hook writes
  `{"decision":"deny","reason":"[CAREFUL_BLOCKED] …"}` to stdout and exits `2`.
  Safe commands and non-Bash tools exit `0` with no output. Any parse error
  fails **open** (exit `0`) so the guard can never brick a session.
- **Proof:** `tests/skills/workflow-batch.test.ts` exercises the triggering
  condition — it spawns the hook with a destructive payload and asserts the
  deny + `CAREFUL_BLOCKED` + exit-2 enforcement fires, and that a safe command
  passes. Reinforced by `tests/backfill/loom-careful.test.ts`.

## Override

Per-command bypass (deliberate, auditable):

```bash
LOOM_CAREFUL_OVERRIDE=1 git push --force
```

Session-wide bypass: `export LOOM_CAREFUL_OVERRIDE=1` in the spawning shell.

## Beyond gstack upstream

gstack ships no destructive-command PreToolUse guard at all. `/loom-careful`
adds a **regex blocklist enforced at the tool-call boundary** with a
per-command `LOOM_CAREFUL_OVERRIDE` escape hatch and a fail-open safety
posture — capability with no upstream analogue (not parity).

## Contract

- Source: `hooks/loom-careful.ts`
- Registration: `skills/library.yaml` → `library.infrastructure` +
  `library.prompts`; wiring in `hooks/hooks.json`.
- Error code: `CAREFUL_BLOCKED` (see `protocols/exit-codes.md`).
- Dispatcher: `commands/loom-careful.md`.
