```toon
pageId: pattern-model-resolution
title: Model Resolution
category: pattern
subtype:
domain: code
summary: Mandatory before every Agent spawn — resolve model from (1) active tier→model profile in orchestration.toml, (2) agent frontmatter model:, (3) inherit parent. Never fable.
estimatedTokens: 1172
bodySections[5]: Summary, Examples, Resolution Priority, Tier→Model Profiles, Common Model Assignments
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-07-06T00:00:00Z
createdBy: human
updatedBy: wiki-ingest-agent
sourceRefs[3]: CLAUDE.md, agents/implementer-agent.md, protocols/orchestration-config.schema.md
crossRefs[2]{pageId,relationship}:
  structure-agent-taxonomy,relates-to
  component-orchestration-patterns,relates-to
tags[4]: model-resolution, cost-control, opus, sonnet
staleness: fresh
confidence: high
```

# Model Resolution

## Summary

Model resolution is **mandatory** before every Agent tool call in Loom. Per CLAUDE.md: "Before every Agent tool call, read the target agent's `.md` frontmatter `model:` field and pass `model: "{value}"` on the call. Resolution priority: (1) `orchestration.toml` profile tier, (2) frontmatter, (3) inherit parent." Spawning an agent without resolving its model first is a protocol violation.

The mechanism has two moving parts: an active **tier→model profile** (`modelProfile` under `[settings]` in `.claude/orchestration.toml`) that maps each agent's *tier* to a model, and the per-agent `model:` frontmatter default. The profile wins when set.

## Resolution Priority

Higher-priority sources override lower ones:

1. **`orchestration.toml` profile tier** — `modelProfile` selects a `[settings.profiles.<name>]` block that maps the five tiers (`planning`, `execution`, `review`, `verification`, `utility`) to models. Read by the model-resolution step of pipeline commands (`/loom-plan`, `/loom-auto/links/*`); `/loom-profile` reads/writes it. Omit `modelProfile` to disable profile resolution.
2. **Agent frontmatter `model:`** — the default declared in the agent's `.md` header.
3. **Inherit parent** — fallback to the calling orchestrator's model when neither above applies. Agents should always declare a model.

## Tier→Model Profiles

`.claude/orchestration.toml` currently ships three profiles; the active one is `modelProfile = "quality"`:

| Tier | quality (active) | balanced | budget |
|------|------------------|----------|--------|
| `planning` | opus | opus | sonnet |
| `execution` | opus | sonnet | sonnet |
| `review` | opus | sonnet | haiku |
| `verification` | sonnet | sonnet | haiku |
| `utility` | sonnet | haiku | haiku |

Each value is a model id (`opus | sonnet | haiku`). **Do NOT use `fable` in these maps — it exhausts usage limits under multi-agent orchestration.** Switching profiles right-sizes the whole pipeline: `budget` downgrades planning/execution to sonnet and review/verification to haiku for cheap iteration.

## Common Model Assignments

Derived from current agent frontmatter (`model:` fields):

### opus

High-stakes generation where errors compound: `contracts-agent` (Wave 0 shared types), `implementer-agent` (core code), `plan-builder-agent`, `roadmap-builder-agent`, `questioner-agent`, `benchmark-agent`, `interpretation-reviewer-agent`, `debug-investigator-agent`, `roadmap-converge-driver`, and the plan-review lenses (`plan-eng/ceo/design/devex-review-agent`).

### sonnet

Analysis, review, and mid-complexity work — the majority tier: most review agents (`security-reviewer`, `architecture-reviewer`, `code-*-review-agent`), `convergence-driver`, `convergence-planner-agent`, `delta-analyzer` (haiku — see below), `fixer-agent`, `meta-agent`, `wiki-ingest-agent`, `wiki-maintainer-agent`, test agents (`unit-test-agent`, `e2e-test-agent`, `integration-test-agent`), and `auto-dispatcher`.

### haiku

Lightweight, low-ambiguity operations where speed and cost dominate: `verification-agent` (typecheck/test/lint tooling), `target-parser` and `delta-analyzer` (structured TOON parsing), `context-budget-reviewer`, `docs-auditor`, `plan-critic-agent`, `presubmit-sweep-agent`, `roadmap-archetype-detector`, `e2e-runner-agent`, and `wiki-lint-agent`.

## Examples

Agent `.md` files declare the default via frontmatter; the orchestrator reads it before spawning:

```markdown
---
name: implementer-agent
description: Parallel worker that builds code within strict file ownership...
model: opus
---
```

With `modelProfile = "budget"` active, `implementer-agent` (tier `execution`) resolves to `sonnet` regardless of its `opus` frontmatter — the profile tier takes priority. With no `modelProfile` set, the `opus` frontmatter value is used directly.
