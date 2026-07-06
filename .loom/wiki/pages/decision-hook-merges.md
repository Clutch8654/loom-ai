<!-- loom:adr-stub -->
```toon
pageId: decision-hook-merges
category: decision
summary: Two hook pairs merged 2026-04-25 (context-budget-test→context-budget, checkpoint-trigger→context-monitor) to halve bun processes per tool call with no behavior change; see ADR-0001.
estimatedTokens: 326
bodySections[1]: Summary
staleness: migrated
updatedAt: 2026-07-06T00:00:00Z
updatedBy: wiki-ingest-agent
```

# Hook Merge Decision (2026-04-25)

> **Migrated to ADR.** This wiki page has been promoted to a formal Architecture Decision Record.
>
> See: [ADR-0001: Hook Merge Decision (2026-04-25)](../../../docs/adr/0001-hook-merge-decision-2026-04-25.md)

## Summary

On 2026-04-25 two pairs of hooks were merged to cut the number of `bun` processes spawned per tool call: `context-budget-test.ts` folded into `context-budget.ts`, and `checkpoint-trigger.ts` into `context-monitor.ts`. The change was a pure performance optimization with no observable behavior change. The investigation also confirmed Claude Code has no `SubagentStop` event, so `budget-tracker.ts` counts spawns (not completions) by incrementing on `PreToolUse`. Full detail in [ADR-0001](../../../docs/adr/0001-hook-merge-decision-2026-04-25.md).

This stub exists to preserve cross-references. Manage the decision at the ADR path above.
