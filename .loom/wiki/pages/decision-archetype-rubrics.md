<!-- loom:adr-stub -->
```toon
pageId: decision-archetype-rubrics
category: decision
summary: Roadmap dimensions are graded against archetype-selected pedagogical green/yellow/red rubric files rather than numeric scores; decision recorded in ADR-0003.
estimatedTokens: 320
bodySections[1]: Summary
staleness: migrated
updatedAt: 2026-07-06T00:00:00Z
updatedBy: wiki-ingest-agent
```

# Archetype-Selected Pedagogical Rubrics

> **Migrated to ADR.** This wiki page has been promoted to a formal Architecture Decision Record.
>
> See: [ADR-0003: Archetype-Selected Pedagogical Rubrics](../../../docs/adr/0003-archetype-selected-pedagogical-rubrics.md)

## Summary

Each roadmap dimension is graded by a reviewer agent against a pedagogical rubric file that ships verbatim `## Green` / `## Yellow` / `## Red` exemplars — not numeric scores — with the rubric set chosen per project archetype (`cli`, `web-app`, `library`, `data-pipeline`, `research`, or `default`). Status-conditional rendering keeps green passes token-free and surfaces exemplars only on yellow/red. Full rationale and alternatives live in [ADR-0003](../../../docs/adr/0003-archetype-selected-pedagogical-rubrics.md).

This stub exists to preserve cross-references. Manage the decision at the ADR path above.
