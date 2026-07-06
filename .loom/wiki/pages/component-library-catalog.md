```toon
pageId: component-library-catalog
title: Library Catalog (library.yaml)
category: component
subtype: ""
domain: code
summary: skills/library.yaml (catalog_version 4) is the authoritative catalog of distributable Loom resources across five sections — protocols, skills, agents, prompts, infrastructure — plus kits and signed releases.
estimatedTokens: 942
bodySections[3]: Summary, Dependencies, Key Behaviors
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-07-06T00:00:00Z
createdBy: human
updatedBy: wiki-ingest-agent
sourceRefs[1]: skills/library.yaml
crossRefs[4]{pageId,relationship}:
  component-command-dispatch,depended-by
  structure-command-layout,depended-by
  convention-command-creation,relates-to
  pattern-subcommand-dispatch,relates-to
tags[5]: library, catalog, skills, agents, prompts
staleness: fresh
confidence: high
```

# Library Catalog (library.yaml)

`skills/library.yaml` is the authoritative catalog of all distributable Loom resources — what can be installed, where it goes, and what it depends on.

## Summary

Catalog `catalog_version: 4`. The header pins `repo`, `loomCoreVersion`, and `loomHooksVersion`, and declares a `releases:` block of versioned tarballs (`coreTarball`, `hooksTarball`) each carrying a `cosignSignature` and a `sha256Manifest` for verified installs. `default_dirs` maps each type to its default (project-local) and global (`~/.claude/`) install roots. The `library:` block holds five resource sections and a top-level `kits:` list bundles resources for one-shot install.

## Dependencies

- **`default_dirs`** — install-root map read by the install pipeline (`component-install-pipeline`).
- **`releases[]`** — signed release artifacts referenced by verified/tarball installs.
- **`requires:` graph** — each item may depend on other cataloged items, resolved at install time.

## Key Behaviors

### Five resource sections (v4)

v4 renamed the v3 `library.skills` (inter-agent schemas) to **`library.protocols`** and introduced a new **`library.skills`** section for native Claude Code skills. Current counts:

| Section | ~Count | Contents | Install target |
|---------|--------|----------|----------------|
| `protocols` | 61 | Schema/convention `.md` read by agents | `~/.claude/protocols/{name}.md` |
| `skills` | 27 | Native `SKILL.md` guides with `triggers:` globs | `~/.claude/skills/{name}/SKILL.md` |
| `infrastructure` | 14 | Hooks/scripts (`.ts`, `.cjs`, `.sh`) | explicit `target:` |
| `agents` | 69 | Agent instruction `.md` | `~/.claude/agents/{name}.md` |
| `prompts` | 51 | Slash-command `.md` | `~/.claude/commands/{name}.md` |

Skills declare `triggers:` (glob patterns) so Claude Code auto-loads them when matching files are open; protocols are read on demand by agents.

### Dependency resolution

`requires:` lists prerequisite items as typed refs — `protocol:<name>`, `skill:<name>`, `agent:<name>`, `prompt:<name>`. `/loom-library use {name}` resolves the full graph before installing the target so agents have their schemas at runtime.

### Kit system

Seven kits ship today: `data-engineering`, `python-conventions`, `shell-conventions`, `feedback-loop`, `code-review`, `design-build`, `plan-review`. A kit lists `version`, `minLoomVersion`, and `includes:`. Includes accept the typed form `{type: skill|agent|prompt, name: <name>}` (or a bare string resolved by priority). A kit may set `command:` to its entry-point prompt for kit dispatch (`{name}:{subcommand}`). Kits install only via `/loom-library use {kit-name}`.

### Management commands

`/loom-library` supports `list`, `use {name}`, `sync`, `update`, `search {query}`, `add {path}`, `remove {name}`. `add` classifies a source via `hooks/lib/library-add-heuristic.ts` (`skill|protocol|agent|prompt|ambiguous`).
