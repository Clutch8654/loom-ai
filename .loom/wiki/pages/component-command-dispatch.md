```toon
pageId: component-command-dispatch
title: Command Dispatch System
category: component
subtype: ""
domain: code
summary: Entry point for all /loom invocations; routes the first subcommand token to a registered Skill or a standalone command file, plus kit:subcommand dispatch.
estimatedTokens: 912
bodySections[3]: Summary, Dependencies, Key Behaviors
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-07-06T00:00:00Z
createdBy: human
updatedBy: wiki-ingest-agent
sourceRefs[1]: commands/loom.md
crossRefs[4]{pageId,relationship}:
  structure-command-layout,relates-to
  component-library-catalog,depends-on
  pattern-subcommand-dispatch,relates-to
  convention-command-creation,relates-to
tags[4]: dispatch, commands, routing, loom
staleness: fresh
confidence: high
```

# Command Dispatch System

## Summary

The command dispatch system defined in `commands/loom.md` is the entry point for all `/loom` invocations. It parses the first positional argument (the subcommand) and routes it through one of two mechanisms, or falls through to kit dispatch when the argument matches a `<word>:<word>` pattern.

## Dependencies

- **`skills/library.yaml` `prompts:` / `kits:` sections** — declares which subcommands are registered skills and which kits exist.
- **`~/.claude/commands/`** — install location for standalone command files loaded via the Read mechanism.
- **Skill tool** — invokes registered skills by name with the remaining args.
- **Read tool** — loads standalone command `.md` files and follows their instructions.
- **`install-state.toon`** — consulted during kit dispatch to confirm a kit's command is installed.

## Key Behaviors

**Two dispatch mechanisms:**

1. **Skill Tool dispatch** — for commands registered in `library.yaml` `prompts:` and installed as skills. Calls the Skill tool with `skill: "{name}"`, `args: "{remaining args}"`. Currently only `bugfix` dispatches this way.
2. **Read dispatch** — for standalone command files in `~/.claude/commands/`. Reads the `.md` file and follows its instructions with remaining args as context.

**Dispatch table** (`commands/loom.md`):

| Subcommand | Mechanism | Target |
|------------|-----------|--------|
| (none) / `help` / `reference` | Read | `loom-reference.md` (display verbatim) |
| `init`, `auto`, `converge`, `quick`, `pause`, `resume`, `do`, `next`, `profile`, `status`, `debate`, `chain`, `vote`, `triage`, `upgrade` | Read | `~/.claude/commands/loom-{name}.md` |
| `bugfix` | Skill | `loom-bugfix` |
| `<word>:<word>` | Kit dispatch | see below |

**Dispatch procedure:** extract subcommand token → collect remaining tokens as args → route via Skill or Read → for no-args/`help`/`reference` display `loom-reference.md` verbatim → unrecognized non-kit input prints `Unknown subcommand: {x}. Run /loom for available commands.`

**Kit dispatch** (`<word>:<word>`, exactly one colon, non-empty both sides): split into `kitPrefix`/`subcommand` → read `library.yaml` `kits:` → match a kit by `name` or `command` basename → error if kit not found or not installed (`install-state.toon`) → empty subcommand lists the kit's subcommands → otherwise invoke Skill tool with `skill: "{kit command}"`, `args: "{subcommand} {rest}"`. Unknown kit subcommands are handled by the kit's own command file (with did-you-mean for edit distance ≤ 2). This enables `/loom data:profile`, `/loom data:validate`, etc.

**Install location:** Read-dispatched command files must be installed to `~/.claude/commands/` (the Claude Code user commands dir). `library.yaml` `prompts:` declares source paths; `/loom-library use` or `sync` performs installation.
