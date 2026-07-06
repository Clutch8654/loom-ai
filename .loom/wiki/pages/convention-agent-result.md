```toon
pageId: convention-agent-result
title: AgentResult Envelope
category: convention
subtype: ""
domain: code
summary: Every execution agent returns a TOON AgentResult as its last block; the orchestrator parses it for status, file ownership, exports, issues, and cross-boundary requests to drive pipeline progression.
estimatedTokens: 1332
bodySections[7]: Summary, Required Fields, Status Meanings, Key Design Rules, Gate Extension, Relationship to Progress Reporting, Examples
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-07-06T00:00:00Z
createdBy: human
updatedBy: wiki-ingest-agent
sourceRefs[1]: protocols/agent-result.schema.md
crossRefs[3]{pageId,relationship}:
  structure-agent-taxonomy,relates-to
  concept-execution-pipeline,relates-to
  convention-toon-format,depends-on
tags[4]: agent-result, protocol, toon, envelope
staleness: fresh
confidence: high
```

# AgentResult Envelope

## Summary

Every execution agent MUST return a valid TOON block matching the AgentResult schema as the **last content block** in its response. The orchestrator parses it programmatically to determine task outcome (`status`), file ownership, added exports, downstream `integrationNotes`, and any `crossBoundaryRequests` — this envelope is the authoritative signal that drives pipeline progression. Source: `protocols/agent-result.schema.md`.

## Required Fields

All fields are required. Empty arrays must be present (e.g. `filesDeleted[0]:`).

| Field | Type | Description |
|-------|------|-------------|
| `agent` | string | Agent name from frontmatter |
| `wave` | integer | Wave number (0 for contracts, 1+ for implementation) |
| `taskId` | string | Task identifier from the plan |
| `status` | enum | `success`, `partial`, or `failure` |
| `filesCreated` / `filesModified` / `filesDeleted` | array | Files touched during the task |
| `exportsAdded` | typed array | New exports: `{file, name, kind}` |
| `dependenciesAdded` | array | npm packages added |
| `integrationNotes` | string | Critical context for downstream agents |
| `issues` | typed array | Problems found: `{severity, description, file, line}` |
| `contractAmendments` | typed array | Contract corrections: `{file, issue}` |
| `crossBoundaryRequests` | typed array | Changes needed in others' files: `{file, reason, suggestedChange}` |
| `durationMs` | integer | Elapsed milliseconds |
| `verificationStatus` | enum | `verified`, `unverified`, or `skipped` |
| `diagnoseLog` | string | Narrative diagnosis (optional; omit if none) |

## Status Meanings

- **`success`** — all acceptance criteria met, no blocking issues. Pipeline proceeds.
- **`partial`** — work done but blocking issues remain. Orchestrator evaluates whether to continue.
- **`failure`** — task could not complete. Orchestrator triggers a fix cycle or halts.

## Key Design Rules

- **`integrationNotes` is the most important field** — the primary channel for telling downstream agents about import paths, schema decisions, and non-obvious constraints. Write precisely; omit the obvious.
- **`crossBoundaryRequests` prevents ownership conflicts** — agents never modify files they do not own. A needed change in another's file goes here; the wiring-agent processes these after the wave completes.
- **`contractAmendments` escalates contract problems** — if the contracts-agent output is wrong, document it here; the orchestrator decides whether to re-run Wave 0.

## Gate Extension

Gate agents (registered under `[[kit.<name>.gates]]`) add four fields: `gate` (`pass`/`fail`/`warn`), `gateReason`, `failAction` (`halt`/`warn`/`retry`), `retryMax`. Non-gate agents omit all four.

- **`halt`** — pipeline stops; user sees gate name, insertion point, reason, and retry/skip/abort options.
- **`warn`** — pipeline continues; warning shown inline and counted at completion.
- **`retry`** — gate re-spawned up to `retryMax` times, then falls through to `halt`.

A malformed or timed-out gate response is treated as `gate: warn` — the pipeline never halts on bad data from a gate agent.

## Relationship to Progress Reporting

Agents write periodic heartbeats to `.plan-execution/progress/{taskId}.toon` (AgentProgress). These are **informational** (dashboards, stale detection). The AgentResult is **authoritative** — if progress disagrees, AgentResult wins.

## Examples

Minimal envelope from a Wave 1 implementer:

```toon
agent: implementer-agent
wave: 1
taskId: w1-auth
status: success

filesCreated[2]: src/auth/middleware.ts, src/auth/types.ts
filesModified[1]: src/routes/index.ts
filesDeleted[0]:

exportsAdded[2]{file,name,kind}:
  src/auth/middleware.ts,authMiddleware,function
  src/auth/types.ts,TokenPayload,interface

dependenciesAdded[0]:
integrationNotes: "Downstream agents import TokenPayload from src/auth/types.ts. Middleware reads JWT_SECRET from process.env."

issues[1]{severity,description,file,line}:
  warning,Hardcoded 15-minute refresh window — make configurable,src/auth/middleware.ts,42

contractAmendments[0]:
crossBoundaryRequests[0]:
durationMs: 34500
verificationStatus: verified
diagnoseLog:
```

A gate agent adds the four gate fields to the same base shape:

```toon
agent: security-gate
wave: 2
taskId: w2-review
status: success
gate: fail
gateReason: "Unparameterized SQL in src/db/query.ts:88"
failAction: halt
retryMax: 0
```
