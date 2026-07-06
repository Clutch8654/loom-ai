```toon
pageId: structure-agent-taxonomy
title: Agent Taxonomy
category: structure
subtype: ""
domain: code
summary: ~86 flat agent .md files in agents/, grouped by conceptual pipeline role (planning, execution, test, review, convergence, wiki, utility) plus 5 stage-teammate protocols; models chosen by stakes.
estimatedTokens: 1159
bodySections[9]: Summary, Total Count, Planning Agents, Execution Agents, Test Agents, Review Agents, Convergence & Wiki Agents, Stage Teammates, How Agents Are Organized
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-07-06T00:00:00Z
createdBy: human
updatedBy: wiki-ingest-agent
sourceRefs[1]: agents/
crossRefs[3]{pageId,relationship}:
  convention-agent-result,relates-to
  pattern-model-resolution,relates-to
  component-orchestration-patterns,relates-to
tags[4]: agents, taxonomy, organization, architecture
staleness: fresh
confidence: high
```

# Agent Taxonomy

## Summary

Loom ships ~86 agents, each a flat `.md` file in `agents/` with frontmatter declaring `name`, `description`, and `model`. Every agent returns a standard AgentResult envelope in TOON. The functional categories below are conceptual — there is no on-disk subdirectory hierarchy for them (the only subdirectory is `agents/stage-teammates/`). Model tier is chosen by stakes: opus for high-stakes generation, sonnet for analysis/review, haiku for lightweight ops.

## Total Count

As of 2026-07-06: **~86 agent files** in `agents/`, plus **5 stage-teammate protocols** in `agents/stage-teammates/`. Counts drift as the catalog grows — treat this as a snapshot, not a fixed number.

## Planning Agents

Pre-execution: roadmap creation, plan building, scope analysis. Representative: `plan-builder-agent` (opus), `roadmap-builder-agent`, `questioner-agent`, `scope-feasibility-agent`, `interpretation-reviewer-agent`, `criteria-planner-agent`, `phasing-agent`, `parallelization-agent`, `strategy-agent`, `project-guidance-agent`, `prompt-refiner-agent` (all sonnet).

## Execution Agents

Code generation and integration inside a plan run. `contracts-agent` (opus, Wave 0 — shared types/schemas/contracts), `implementer-agent` (opus, Wave 1+ — code within file-ownership boundaries), `verification-agent` (haiku — post-wave typecheck/test/lint/drift gate), plus `agentic-workflow-agent`, `migration-architect`, `api-route-creator`, `api-connector`, `api-explorer`, `data-pipeline-agent` (sonnet).

## Test Agents

Tests across the pyramid: `unit-test-agent`, `integration-test-agent`, `e2e-test-agent`, `e2e-test-writer-agent` (executable Playwright/Cypress), `e2e-runner-agent` (runs + screenshots), `qa-review-agent`, `data-test-generator`, `acceptance-criteria-agent`, `feature-coverage-agent`, `tdd-coach` — all sonnet.

## Review Agents

Specialized code review by perspective (all sonnet): `security-reviewer`, `architecture-reviewer`, `plan-compliance-reviewer`, `performance-reviewer`, `api-design-reviewer`, `accessibility-reviewer`, `infra-reviewer`, `observability-reviewer`, `dependency-auditor`, `database-schema-reviewer`, `data-schema-reviewer`, `data-quality-gate`, `data-lineage-tracker`, `docs-auditor`, `context-budget-reviewer`, `tech-stack-debater`.

## Convergence & Wiki Agents

**Convergence** (iterative output-matching loop): `convergence-planner-agent` (produces `convergence-plan.toon`), `target-parser` (haiku), `harness-builder`, `criteria-harness-builder`, `delta-analyzer`, `convergence-driver` (sonnet).

**Wiki** (knowledge base in `.loom/wiki/`, all sonnet): `wiki-ingest-agent` (source → pages), `wiki-lint-agent` (quality/staleness), `wiki-query-agent` (search), `wiki-maintainer-agent` (updates + cross-refs).

**Utility**: `meta-agent`, `fixer-agent`, `bugfix-analyst-agent`, `docs-generator`, `ux-agent`, `auto-dispatcher`.

## Stage Teammates

Five pipeline stages each have a teammate protocol in `agents/stage-teammates/` defining that stage's coordination rules:

- `execute-stage.md` — Wave 1+ parallel execution
- `test-stage.md` — test stage
- `review-stage.md` — review stage
- `fix-stage.md` — fix stage
- `converge-stage.md` — convergence stage

## How Agents Are Organized

All agents live in `agents/` as flat `.md` files — the categories above are conceptual, not directory-backed. `protocols/` holds schemas and conventions agents read as reference (not agents). Model assignment follows a consistent rule:

- **opus** — high-stakes generation: plan building, contracts, implementation
- **sonnet** — analysis and review: most reviewers, test writers, convergence agents
- **haiku** — lightweight ops: verification, parsing, triage routing
