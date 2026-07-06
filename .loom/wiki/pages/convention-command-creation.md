```toon
pageId: convention-command-creation
title: Command Creation Conventions
category: convention
subtype: ""
domain: code
summary: Adding a Loom command means three-way parity — commands/{name}.md source, a library.yaml prompts entry with typed requires, and the ~/.claude/commands install — plus optional subdir and kit wiring.
estimatedTokens: 1000
bodySections[2]: Summary, Examples
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-07-06T00:00:00Z
createdBy: human
updatedBy: wiki-ingest-agent
sourceRefs[2]: commands/, skills/library.yaml
crossRefs[4]{pageId,relationship}:
  component-command-dispatch,relates-to
  structure-command-layout,relates-to
  component-library-catalog,relates-to
  pattern-subcommand-dispatch,relates-to
tags[5]: convention, commands, creation, library, parity
staleness: fresh
confidence: high
```

# Command Creation Conventions

Every new command must exist in three places at once — the **three-way parity rule**:

| Location | Purpose | Path |
|----------|---------|------|
| Repo source | Version-controlled truth | `commands/{name}.md` |
| Library catalog | Makes it installable | `skills/library.yaml` `prompts:` entry |
| Installed | Makes it usable | `~/.claude/commands/{name}.md` |

A command in the repo but not in the catalog can't be installed; one cataloged but not installed won't appear as a `/slash-command`.

## Summary

Create `commands/{name}.md` with YAML frontmatter (`description:` drives the slash-command tooltip) and `$ARGUMENTS` handling, register it under `library.yaml` `prompts:` with a typed `requires:` list, install it (via `/loom-library sync` or the direct-symlink `loom-install`), and — if it should be reachable via `/loom <sub>` — add a dispatch row to `commands/loom.md`. Substantial multi-subcommand commands use a `commands/{name}/` subdirectory; simple ones dispatch inline. Every `/loom-*` command also includes the shared `commands/_loom-init-guard.md` prelude.

## Examples

### 1. Command file

```markdown
---
description: "Short description of what this command does"
---
# Command Name

$ARGUMENTS

Parse the first positional argument as the subcommand...
```

### 2. library.yaml prompts entry

```yaml
- name: loom-mycommand
  description: "Human-readable description"
  source: commands/loom-mycommand.md
  requires: [agent:some-agent, protocol:some-schema, skill:some-skill]
```

`name` becomes the slash command (`/loom-mycommand`); `source` is repo-root-relative. `requires:` uses typed refs (`agent:`, `protocol:`, `skill:`, `prompt:`) so dependencies install automatically. Note v4 uses `protocol:` for schema files (formerly `skill:` under the v3 `library.skills` section).

### 3. loom.md dispatch (if applicable)

```markdown
| `mysub` | Read `~/.claude/commands/loom-mycommand.md` and follow |
```

Or via Skill dispatch: `| `mysub` | Skill tool: `loom-mycommand` |`. Standalone noun-commands (`/loom-plan`, `/loom-code`, `/loom-wiki`) are invoked directly and need no dispatch row.

### 4. Subcommand directory

For a command with several heavy subcommands: create the parent `commands/{name}.md` with dispatch logic, a `commands/{name}/` dir, one child `.md` per subcommand, and install parent + children. Nine commands now use this pattern — `loom-auto`, `loom-benchmark`, `loom-design`, `loom-devex`, `loom-docs`, `loom-plan`, `loom-roadmap`, `loom-setup`, `loom-think`.

### 5. Kit command

Add `kit: {kit-name}` to the prompts entry, list the command in the kit's typed `includes:` (`{type: prompt, name: ...}`), and set the kit's `command:` if it is the entry point. Kit commands install only via `/loom-library use {kit-name}`.

### Verification checklist

- [ ] `commands/{name}.md` with frontmatter + `$ARGUMENTS`
- [ ] `library.yaml` `prompts:` entry with correct `source:` and typed `requires:`
- [ ] `~/.claude/commands/{name}.md` installed
- [ ] `loom.md` dispatch row (if dispatched)
- [ ] parent dispatches to children (if a subcommand dir)
- [ ] all `requires:` deps resolve
