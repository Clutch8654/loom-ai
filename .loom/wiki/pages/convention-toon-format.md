```toon
pageId: convention-toon-format
title: TOON Format
category: convention
subtype: ""
domain: code
summary: TOON (Token-Oriented Object Notation) is Loom's default serialization for all on-disk artifacts and agent-to-agent messages — a compact, lossless, token-efficient alternative to JSON.
estimatedTokens: 989
bodySections[6]: Summary, Syntax, Examples, Where TOON Is Used, Exceptions, Atomic Writes
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-07-06T00:00:00Z
createdBy: human
updatedBy: wiki-ingest-agent
sourceRefs[1]: protocols/toon-format.md
crossRefs[2]{pageId,relationship}:
  convention-agent-result,depended-by
  concept-execution-pipeline,relates-to
tags[4]: toon, format, serialization, artifacts
staleness: fresh
confidence: high
```

# TOON Format

## Summary

TOON (Token-Oriented Object Notation) is the default serialization format for all Loom on-disk artifacts and agent-to-agent communication — a compact, human-readable, token-efficient alternative to JSON. It is a **lossless** encoding of the JSON data model: `decode(encode(json)) === json` always holds and types (numbers, booleans) are preserved through the roundtrip, so TOON can be used anywhere JSON would. Source: `protocols/toon-format.md`.

## Syntax

TOON has four constructs:

- **Flat scalars** — unquoted `key: value` pairs; types preserved.
- **Inline arrays** — `name[N]: a, b, c` with the count `[N]` declared in the header; empty arrays must still appear as `name[0]:`.
- **Typed arrays (tables)** — `name[N]{col1,col2}:` header, then one comma-separated row per line at 2-space indent. The most common structured-data pattern in agent results.
- **Nested blocks** — child keys indented 2 spaces under a parent key.

## Examples

```toon
agent: contracts-agent          # flat scalars
wave: 0
status: success

filesCreated[3]: src/auth/middleware.ts, src/auth/token.ts, src/auth/types.ts   # inline array
filesDeleted[0]:                # empty array — still present

exportsAdded[2]{name,file,kind}:   # typed array / table
  authMiddleware,src/auth/middleware.ts,function
  TokenPayload,src/auth/types.ts,interface

context:                        # nested block
  task: Build auth module
  location: src/auth
  deadline: 2026-04-10
```

Agent outputs are returned as fenced ` ```toon ` blocks; the orchestrator accepts both TOON and JSON and normalizes internally.

## Where TOON Is Used

TOON is mandatory for all Loom runtime artifacts — the `CLAUDE.md` mandate: "All Loom on-disk artifacts, agent output formats, protocol schemas, state files, and inter-agent communication MUST use TOON."

| File | Purpose |
|------|---------|
| `state.toon` | Execution state (resumable) |
| `pipeline-state.toon` | `/loom-auto` pipeline state |
| `contracts/manifest.toon` | Contract file registry |
| `progress/{taskId}.toon` | Agent heartbeat/progress |
| `wave-N-summary.toon` | Per-wave results |
| `scope-coverage.toon` | Acceptance-criteria coverage matrix |
| `stage-context/{stage}.toon` | Stage summaries |
| `convergence-plan.toon` | Convergence target definitions |
| Wiki frontmatter blocks | Wiki page metadata |

## Exceptions

These use their **native format** rather than TOON:

| Format | Files |
|--------|-------|
| JSON | `package.json`, `tsconfig.json`, AJV schema files (`*.schema.json`), third-party API payloads |
| TOML | `orchestration.toml`, `library.yaml` |
| Hook I/O | Claude Code's JSON hook protocol |

App-specific data being compared or generated (JSON API responses, SQL result sets, HTML) also stays native — TOON is for Loom metadata, not application data. If you find JSON where TOON belongs, `/loom-upgrade` scans for and migrates old-format artifacts.

## Atomic Writes

All TOON state files must be written atomically to prevent partial reads by concurrent agents or the orchestrator:

1. Write content to `{path}.tmp`
2. `fs.renameSync('{path}.tmp', '{path}')`

Never write directly to the target path.
