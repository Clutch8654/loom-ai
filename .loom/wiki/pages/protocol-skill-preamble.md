---
pageId: protocol-skill-preamble
category: protocol
tags[5]: skill-preamble,include-directive,conventions,F-22,Wave-9
createdAt: 2026-07-04T06:00:00Z
updatedAt: 2026-07-04T06:00:00Z
updatedBy: wiki-maintainer-agent
staleness: fresh
summary: Single authoritative preamble for every Loom skill SKILL.md — seven conventions (TOON, atomic writes, exit codes, AgentResult, confidence, model resolution, init guard) cited by reference via the @loom-include directive, not inlined.
estimatedTokens: 675
bodySections[4]: Summary, Include Directive, Preamble Conventions, Reference
relatedFiles[3]:
  protocols/skill-preamble.md
  tests/skills/preamble-resolution.test.ts
  skills/library.yaml
crossRefs[0]{pageId,relationship}:
---

## Summary

Shipped in Wave 8, Phase 21 (F-22). A protocol resource that is the single authoritative source for the 7 conventions every Loom skill must follow. Skills cite this preamble **by reference** rather than inlining text, keeping one canonical copy that propagates to all skills when updated.

This is the skill-side analogue of `commands/_loom-init-guard.md` (command-side shared include). Registered as protocol `skill-preamble` under `library.protocols:` in `skills/library.yaml`. Foundation for Wave 9 skill-batch phases.

## Include Directive

A skill embeds the preamble by placing this directive on its own line near the top of its `SKILL.md`:

```
<!-- @loom-include: protocols/skill-preamble.md -->
```

At load time the resolver replaces this directive with the canonical preamble text extracted from `protocols/skill-preamble.md`. The skill body never contains a second, inlined copy.

The canonical text is bounded by byte-stable markers:

- Begin: `<!-- LOOM:SKILL-PREAMBLE:BEGIN -->`
- End: `<!-- LOOM:SKILL-PREAMBLE:END -->`

Tests in `tests/skills/preamble-resolution.test.ts` assert on the canonical block byte-for-byte (10 tests). Modifying the markers or the text between them is a breaking change to all skills that cite by reference.

## Preamble Conventions

Seven conventions in the canonical block:

| # | Convention | Summary |
|---|------------|---------|
| 1 | TOON everywhere | All on-disk artifacts, state files, inter-agent messages use TOON |
| 2 | Atomic writes | Write to `{path}.tmp`, then `fs.renameSync`; never write in-place |
| 3 | Exit codes | `0` success, `1` gate failure, `2` usage/config error, `3+` skill-specific |
| 4 | AgentResult envelope | Pipeline agents return a standard TOON AgentResult as the last block |
| 5 | Confidence semantics | Every finding carries `confidence: 1-10`; gates filter by confidence floor |
| 6 | Model resolution | Resolve model (orchestration.toml → frontmatter → inherit) before every Agent spawn |
| 7 | Init guard | Skills run behind `_loom-init-guard.md`; no project mutation before Loom is initialized |

## Reference

- Source of truth: `protocols/skill-preamble.md`
- Include directive: `<!-- @loom-include: protocols/skill-preamble.md -->`
- Extraction markers: `LOOM:SKILL-PREAMBLE:BEGIN` / `LOOM:SKILL-PREAMBLE:END`
- Tests: `tests/skills/preamble-resolution.test.ts` (10 tests, Wave 8, all pass)
- Registered: `library.protocols:` in `skills/library.yaml` as `skill-preamble`
- Sibling pattern (command side): `commands/_loom-init-guard.md`
- Consumers: Wave 9 skill-batch phases
