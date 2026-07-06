```toon
pageId: structure-command-layout
title: Command File Layout
category: structure
subtype: ""
domain: code
summary: ~58 top-level command .md files under commands/ plus nine subcommand directories and a shared _loom-init-guard prelude; the library.yaml prompts section is the authoritative installable catalog.
estimatedTokens: 958
bodySections[1]: Summary
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-07-06T00:00:00Z
createdBy: human
updatedBy: wiki-ingest-agent
sourceRefs[2]: commands/, skills/library.yaml
crossRefs[4]{pageId,relationship}:
  component-command-dispatch,depends-on
  component-library-catalog,depends-on
  pattern-subcommand-dispatch,relates-to
  convention-command-creation,relates-to
tags[4]: commands, layout, structure, files
staleness: fresh
confidence: high
```

# Command File Layout

All Loom command files live under `commands/` as Markdown files with YAML frontmatter. Each is a prompt Claude follows when the command is invoked.

## Summary

`commands/` now holds ~58 top-level `.md` files plus nine subcommand directories. Every `/loom-*` command opens with the shared prelude `commands/_loom-init-guard.md` (an init-guard included by reference). Top-level files each map to one installable slash command registered under `library.yaml` `prompts:` and installed to `~/.claude/commands/{name}.md`.

### Top-level command files (selected)

`loom.md` (root dispatcher), plus lifecycle and workflow commands: `loom-plan`, `loom-roadmap`, `loom-code`, `loom-bugfix`, `loom-wiki`, `loom-agent`, `loom-skill`, `loom-auto`, `loom-init`, `loom-quick`, `loom-converge`, `loom-change`, `loom-debate`, `loom-chain`, `loom-vote`, `loom-triage`, `loom-do`, `loom-which`, `loom-next`, `loom-pause`, `loom-resume`, `loom-status`, `loom-profile`, `loom-reference`, `loom-upgrade`, `loom-update`, `loom-library`, `loom-install`, `loom-uninstall`, `loom-note`, `loom-statusline-setup`, `loom-git`, `loom-data`, `loom-doctor`. Newer surfaces include `loom-benchmark`, `loom-browser`, `loom-canary`, `loom-careful`, `loom-cso`, `loom-deepen`, `loom-design`, `loom-devex`, `loom-diagram`, `loom-docs`, `loom-health`, `loom-landing-report`, `loom-learn`, `loom-prototype`, `loom-qa`, `loom-retro`, `loom-setup`, `loom-ship`, `loom-skillify`, `loom-spec`, `loom-test`, `loom-think`, `loom-worktree`.

### Subcommand directories

Nine commands use a subdirectory of per-subcommand files, dispatched by the parent via the Read tool:

- **`commands/loom-plan/`** — create, review, execute, test, materialize, status
- **`commands/loom-roadmap/`** — init, review, analyze, explore, mutate, converge, sign-off, util, status
- **`commands/loom-auto/`** — `links/` (execute, verify, fix pipeline links)
- **`commands/loom-benchmark/`** — models, perf
- **`commands/loom-design/`** — consultation, html, shotgun
- **`commands/loom-devex/`** — review
- **`commands/loom-docs/`** — generate, release
- **`commands/loom-setup/`** — browser-cookies, deploy
- **`commands/loom-think/`** — review

### Standalone vs. subcommand-dispatched

**Standalone** commands are invoked directly (`/loom-plan`, `/loom-wiki`) and are registered in `library.yaml` `prompts:`. **Subcommand-dispatched** ones are loaded by `loom.md` via `/loom {sub}`. Many commands are both — installable standalone and reachable through `/loom`.

### Relationship to library.yaml prompts

The `prompts:` section is the authoritative catalog of installable commands. Each entry has `name` (slash command without `/`), `source` (repo-relative path), and optional typed `requires:`. Install target is `~/.claude/commands/{name}.md` per `default_dirs.prompts`. `/loom-library sync` copies each `source` to the global install location; the direct-symlink installer recursively globs subcommand trees so nested leaves are covered automatically.
