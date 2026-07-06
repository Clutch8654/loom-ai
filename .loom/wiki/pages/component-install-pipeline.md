```toon
pageId: component-install-pipeline
title: Library Install Pipeline
category: component
subtype: ""
domain: code
summary: Pull-on-demand + direct-symlink install of Loom protocols, skills, agents, prompts, and infrastructure from library.yaml (catalog v4) into ~/.claude/, tracked in install-state.toon.
estimatedTokens: 997
bodySections[3]: Summary, Dependencies, Key Behaviors
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-07-06T00:00:00Z
createdBy: human
updatedBy: wiki-ingest-agent
sourceRefs[2]: skills/library.yaml, commands/loom-library.md
crossRefs[1]{pageId,relationship}:
  convention-settings-json,relates-to
tags[4]: library, install, catalog, infrastructure
staleness: fresh
confidence: high
```

# Library Install Pipeline

Loom installs its distributable resources into `~/.claude/` from the catalog in `skills/library.yaml` (`catalog_version: 4`). Two install paths exist:

- **Library catalog (pull-on-demand):** `/loom-library use <name>` and `/loom-library sync` fetch individual catalog items from the GitHub repo and copy them to `~/.claude/`.
- **Direct-symlink:** the `loom-install` skill/script (`scripts/loom-install.ts`) symlinks the whole repo tree into `~/.claude/`, cross-host (claude-code, hermes, openclaw, codex). Its `sync` recursively globs subcommand dirs so new leaves (e.g. `commands/loom-auto/links/*`) are covered without a spec update.

Installed state is tracked in `~/.claude/skills/library/install-state.toon`.

## Summary

The catalog is the single source of what can be installed, where it goes, and what it depends on. `library.yaml` v4 declares five resource sections — `protocols`, `skills`, `agents`, `prompts`, `infrastructure` — plus a top-level `kits:` list and a `releases:` block (versioned tarballs with a cosign signature and a SHA256 manifest for verified installs). Header fields `loomCoreVersion` / `loomHooksVersion` pin the release the catalog targets.

## Dependencies

- **`skills/library.yaml`** — the catalog itself (see `component-library-catalog`). Every installable item is an entry here.
- **`commands/loom-library.md`** — the `/loom-library` command implementing list/use/sync/update/search/add/remove.
- **`~/.claude/`** — the runtime read location Claude Code loads agents, commands, protocols, and skills from.
- **`~/.claude/skills/library/install-state.toon`** — install ledger consulted for dependency resolution and reconciliation.

## Key Behaviors

### Three-way parity

Three things must stay in sync: **repo source files** (`agents/*.md`, `commands/*.md`, `skills/*/SKILL.md`, `protocols/*.md`, `hooks/`), the **`library.yaml` catalog** listing each with `source`/`description`/`requires`, and the **`~/.claude/` installation**. An item in the repo but absent from the catalog cannot be installed; an item cataloged but not installed fails at runtime (missing `model:` frontmatter, unresolved `requires:` dependency). Rule: any new distributable file gets a catalog entry in the same commit.

### Target path conventions

| Type | Install location |
|------|-----------------|
| `agents` | `~/.claude/agents/<name>.md` |
| `prompts` | `~/.claude/commands/<name>.md` |
| `protocols` | `~/.claude/protocols/<name>.md` |
| `skills` | `~/.claude/skills/<name>/SKILL.md` |
| `infrastructure` | explicit `target:` path from the catalog entry |

### Dependency resolution

`requires:` uses typed refs — `agent:<name>`, `protocol:<name>`, `skill:<name>`, `prompt:<name>`. `/loom-library use` resolves the graph, installing each dependency first (recursive), with cycle detection via a "currently installing" set.

### Source resolution & install-state

Catalog `source` paths are repo-relative; the `repo` field gives the GitHub URL. Files are fetched via `gh api repos/{owner}/{repo}/contents/{source}` (base64-decoded), falling back to `curl`. `install-state.toon` records `{name,type,source,targetPath,installedAt}` rows; older schema versions are read and rewritten forward automatically.
