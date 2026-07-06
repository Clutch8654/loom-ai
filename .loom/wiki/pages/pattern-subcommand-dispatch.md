```toon
pageId: pattern-subcommand-dispatch
title: Subcommand Dispatch Pattern
category: pattern
subtype: ""
domain: code
summary: Multi-action Loom commands parse the first token as a subcommand and Read-dispatch to a matching commands/{parent}/{subcommand}.md file, passing remaining args and inheriting cross-cutting flags.
estimatedTokens: 1029
bodySections[6]: Summary, How Parent Commands Parse and Dispatch, Read-Based Dispatch, Cross-Cutting Pattern Flags, Subcommand Directory Convention, Examples
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-07-06T00:00:00Z
createdBy: human
updatedBy: wiki-ingest-agent
sourceRefs[3]: commands/loom-plan.md, commands/loom-roadmap.md, commands/loom.md
crossRefs[4]{pageId,relationship}:
  component-command-dispatch,exemplifies
  structure-command-layout,relates-to
  convention-command-creation,relates-to
  component-library-catalog,relates-to
tags[4]: subcommand, dispatch, pattern, routing
staleness: fresh
confidence: high
```

# Subcommand Dispatch Pattern

## Summary

The subcommand dispatch pattern is how multi-action Loom commands route to specialized per-subcommand handlers. A parent command parses the first positional token as the subcommand, collects the rest as a forwarded argument string, and Read-dispatches to a matching `commands/{parent}/{subcommand}.md` child file. `loom-plan.md` and `loom-roadmap.md` use it against subdirectory files; `loom.md` uses the same structure at the top level against flat files.

## How Parent Commands Parse and Dispatch

A parent command file:

1. Receives `$ARGUMENTS` — everything typed after the command name.
2. Parses the first positional token as the subcommand.
3. Collects remaining tokens as the arguments string to pass forward.
4. Dispatches based on a known subcommand list.

If no subcommand is given (or it is unrecognized), it displays the available subcommands. The parent also handles concerns common to all subcommands: reading shared protocol files, resolving model tiers, and cross-cutting flags.

## Read-Based Dispatch

Each subcommand has a dedicated file in a matching subdirectory (`commands/loom-plan/{subcommand}.md`, `commands/loom-roadmap/{subcommand}.md`). The parent dispatches by reading the child file with the Read tool and following its instructions with the remaining args as context:

```
1. Parse subcommand from $ARGUMENTS
2. Collect remaining args
3. Read: ~/.claude/commands/loom-plan/{subcommand}.md
4. Follow that file's instructions with remaining args as context
```

`loom.md` uses the same mechanism but can alternatively invoke the Skill tool (`skill: "loom-{subcommand}"`) instead of Read; `loom-plan.md`/`loom-roadmap.md` use only Read dispatch.

## Cross-Cutting Pattern Flags

`loom-plan.md` supports pattern flags injected before/during any subcommand — parsed by the parent, so every subcommand inherits them:

| Flag | Effect |
|------|--------|
| `--debate "question"` | Run adversarial debate; inject result as locked decision |
| `--chain "task"` | Run progressive refinement chain on a produced artifact |
| `--vote "problem"` | Run parallel independent agents on a decision point |
| `--triage "task"` | Route a subtask through the triage classifier first |

## Subcommand Directory Convention

```
commands/{parent-command-name}/{subcommand}.md
```

The parent name (minus `commands/` and `.md`) is the directory; the first arg maps directly to the filename — e.g. `commands/loom-plan/create.md`, `commands/loom-roadmap/init.md`.

## Examples

`loom-plan` subcommands: `create`, `review`, `execute`, `test`, `status`.
`loom-roadmap` subcommands: `(none)/status`, `init`, `review`, `approve`, `refine`, `validate`, `add/insert/remove`, `explore`.

Argument pass-through for a real invocation:

```
/loom-plan execute --wave 2 --skip-review
        ↓
  subcommand = "execute"
  remaining  = "--wave 2 --skip-review"
        ↓
  Read: commands/loom-plan/execute.md
  Context: remaining args = "--wave 2 --skip-review"
```

The child receives the remaining arguments as its `$ARGUMENTS` equivalent and documents the flags it accepts independently.
