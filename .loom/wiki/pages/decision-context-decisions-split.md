---
pageId: decision-context-decisions-split
category: decision
tags[4]: CONTEXT.md,DECISIONS.md,glossary,split,F-18-Phase-A
lastUpdated: 2026-06-26T00:00:00Z
updatedAt: 2026-07-06T00:00:00Z
updatedBy: wiki-ingest-agent
staleness: fresh
summary: F-18 Phase 1 split CONTEXT.md into an always-loaded 34-term domain glossary and DECISIONS.md holding locked decisions — keeping session context lean while making decisions durable and independently updateable.
estimatedTokens: 1365
bodySections[6]: Summary,What Each File Holds,Why We Split,Rationale,Alternatives Considered,Maintenance
relatedFiles[3]:
  CONTEXT.md
  DECISIONS.md
  scripts/migrate-context-split.ts
crossRefs[2]{pageId,relationship}:
  feature-f18-mattpocock-skills-adoption,implemented-by
  convergence-target-ct-06-vocab-diff,relates-to
---

## Summary

In F-18 Phase 1 (wave 1), `CONTEXT.md` was split into two files with distinct responsibilities. The split resolves the tension between "always-loaded vocabulary" (should be short) and "locked decisions" (should be durable and auditable). Source files: `CONTEXT.md`, `DECISIONS.md`, `scripts/migrate-context-split.ts`.

The split is versioned via the sentinel `<!-- loom:context-split:v2 -->` at the top of `CONTEXT.md`.

## What Each File Holds

### CONTEXT.md — 34-term domain glossary

`CONTEXT.md` is the **always-loaded** vocabulary reference. It is included in every new agent session automatically. Key properties:
- Maximum 50 terms (currently 34 as of F-18 completion).
- Each entry is a heading (`## {term}`) followed by a one-paragraph definition.
- Terms are Loom domain-specific — not generic English words.
- **No decisions** — decisions go to `DECISIONS.md`.

The vocabulary-diff harness (`scripts/context-vocab-diff.ts`) verifies that a fresh agent reading `CONTEXT.md` at session start uses ≥3 domain terms in its first response (CT-06 convergence target).

### DECISIONS.md — Locked decisions

`DECISIONS.md` holds decisions made during the discussion/roadmap phase that plan generation and execution must honour. Key properties:
- Each entry is a `## D-NN: {title}` section with `Decision:`, `Rationale:`, `Alternatives considered:`, and `Impact:` fields.
- Decisions are locked — changing one requires re-running `/loom-roadmap --discuss`.
- F-18 shipped with D-01 (reviewer agent registration), D-02 (convergence pattern scope), D-03 (agent model selection).

## Why We Split

Before the split, `CONTEXT.md` was a monolithic file that combined vocabulary, decisions, and miscellaneous project context. This caused two problems:

1. **Context bloat:** Decisions accumulated in the always-loaded file, increasing session cost even when decisions were irrelevant to the current task.
2. **No audit trail:** Decisions mixed with vocabulary made it hard to identify what had been locked vs what was just definitional background.

The split gives vocabulary a fast, lightweight home and decisions a durable, independently updateable record.

## Rationale

The two files have opposite optimization targets. Vocabulary is paid for on every session start, so it must stay short — hence the 50-term ceiling and the CT-06 vocab-diff harness that keeps it earning its place. Locked decisions must persist verbatim and remain auditable across roadmap phases, so they must survive independently of vocabulary churn. Combining them forces one concern to compromise the other: every locked decision permanently inflates per-session context, and touching the glossary risks disturbing decision history. Splitting lets each file be tuned on its own axis — `CONTEXT.md` optimizes for load-cost, `DECISIONS.md` optimizes for durability and an append-only `D-NN` audit trail that plan generation and execution are contractually required to honour. The `<!-- loom:context-split:v2 -->` sentinel makes the migration idempotent and mechanically detectable.

## Alternatives Considered

- **Keep a single monolithic `CONTEXT.md`.** Rejected: decisions accumulated in the always-loaded file, inflating every session's cost even when irrelevant, and mixing vocabulary with locked history left neither independently auditable.
- **Store decisions only in `decision-*` wiki pages.** Rejected: wiki pages are pulled on demand, not always-loaded, so plan and execution agents could proceed without ever seeing — let alone honouring — a locked decision.
- **Cap context by trimming old decisions.** Rejected: destroys the audit trail, which is the entire point of locking a decision so it survives later phases.
- **Inline decisions into ROADMAP.md.** Rejected: couples decision durability to the roadmap's lifecycle and re-runs; decisions must outlive any single roadmap pass.

## Maintenance

### On `/loom-init` (first run)

`loom-init` emits **both** `CONTEXT.md` and `DECISIONS.md` on first run. If either file is missing, it emits the empty-state advisory verbatim to stderr:

```
DECISIONS.md not found — locked decisions cannot be honored without it.
```

### On `/loom-wiki ingest` (Step 5b)

After each ingest run, `loom-wiki` maintains both files atomically — updating glossary terms that have drifted and writing new locked decisions discovered during ingest. Writes use the `.tmp` then rename pattern.

### Migration from pre-F-18

`scripts/migrate-context-split.ts` exports `detectContextSplitVersion` and `migrateContextSplit` (pure, idempotent). Detection uses the `<!-- loom:context-split:v2 -->` sentinel.
