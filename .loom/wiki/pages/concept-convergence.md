```toon
pageId: concept-convergence
title: Convergence
category: concept
subtype: ""
domain: code
summary: Iterating code until runtime output exactly matches deterministic SOURCE/TARGET pairs; the driver loops capture→delta→fix→verify until delta is zero or the budget is exhausted.
estimatedTokens: 1294
bodySections[7]: Summary, The SOURCE / TARGET Contract, Comparison Methods, The Convergence Pipeline, Convergence Plan Format, Budget and Circuit Breakers, Artifacts on Disk
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-07-06T00:00:00Z
createdBy: human
updatedBy: wiki-ingest-agent
sourceRefs[2]: agents/convergence-planner-agent.md, protocols/convergence-plan.schema.md
crossRefs[4]{pageId,relationship}:
  concept-execution-pipeline,relates-to
  component-orchestration-patterns,relates-to
  structure-agent-taxonomy,relates-to
  concept-roadmap-convergence,relates-to
tags[5]: convergence, targets, delta, iteration, criteria
staleness: fresh
confidence: high
```

# Convergence

## Summary

Convergence iterates on code until its runtime outputs **exactly match** one or more deterministic targets. Rather than asserting "the code looks correct," it asserts "the code produces the correct output." A `convergence-planner-agent` discovers targets into `convergence-plan.toon`; the `convergence-driver` then loops capture → compare → fix → verify until the delta is zero or the iteration/agent budget is exhausted.

## The SOURCE / TARGET Contract

Every target defines both sides explicitly:

- **SOURCE** — how to capture the current code's output ("what does it actually produce?")
- **TARGET** — the expected/golden output ("what should it produce?")

The loop repeats until `SOURCE == TARGET` within tolerance, or the budget runs out. A target missing either side is incomplete; `convergence-planner-agent` validates both at plan load.

## Comparison Methods

| Method | Category | Tolerance | Use Case |
|--------|----------|-----------|----------|
| `json-deep-equal` | API | 1.0 (exact) | REST response bodies, ignoring timestamps/request IDs |
| `pixel-diff` | UI | 0.90–0.99 | Screenshot visual regression (anti-aliasing variance) |
| `structural` | Schema | configurable | JSON structure matches without value equality |
| `semantic` | Text | configurable | Meaning-equivalent text comparison |
| `tolerance-based` | Numeric | float | Numeric output within acceptable delta |
| `cli-exit-code` | CLI | exact | Exit code and stdout/stderr matching |

Methods are assigned per-target; the planner rejects mismatches (e.g. `pixel-diff` on an `api` target).

## The Convergence Pipeline

```
convergence-planner-agent → convergence-plan.toon
target-parser             → validated targets
harness-builder           → capture harness (test scripts)
convergence-driver        → loop: capture SOURCE → delta-analyzer → if delta==0 done
                                  else fixer-agent → verification-agent → repeat
```

- **`convergence-planner-agent`** (sonnet) — discovers targets from PLAN.md/codebase in `interactive`, `light`, or `auto` mode; emits the plan.
- **`target-parser`** (haiku) — validates both sides, method/category fit, tolerances.
- **`harness-builder`** (sonnet) — builds SOURCE capture (HTTP clients, Playwright scripts, shell captures).
- **`delta-analyzer`** (sonnet) — structured delta of SOURCE vs TARGET; zero == converged.
- **`convergence-driver`** (sonnet) — runs the loop, writes per-iteration summaries.

In **criteria mode** (acceptance-criteria TDD), `criteria-harness-builder` replaces `harness-builder` and the TARGET is derived from criteria rather than a recorded golden file.

## Convergence Plan Format

```toon
schemaVersion: 1
mode: interactive
intent: Verify API response parity after team-management feature.
targets[2]{id,name,category,comparisonMethod,tolerance,captureMethod,goldenSource}:
  T-01,GET /api/users response,api,json-deep-equal,1.0,http-get,reference-run
  T-02,Login page screenshot,ui,pixel-diff,0.95,playwright-screenshot,reference-run
budget:
  maxIterations: 10
  agentBudget: 30
nonTargets[2]:
  WebSocket connections -- non-deterministic
  Log output -- timing-dependent
```

`nonTargets` documents intentional exclusions so future agents do not re-add them.

## Budget and Circuit Breakers

- `maxIterations` caps fix-and-recheck cycles; `agentBudget` caps total spawns.
- Exhausting `maxIterations` without convergence surfaces a BLOCKED state with the final delta for human review.
- The pipeline `failureLog` tracks identical-failure patterns — a recurring error trips an identical-failure breaker immediately rather than burning remaining budget.

## Artifacts on Disk

| Path | Contents |
|------|----------|
| `.plan-execution/convergence/iterations/iter-N.toon` | Per-iteration summary |
| `.plan-execution/convergence/e2e/stories/{storyId}.toon` | E2E story definitions |
| `.plan-execution/convergence/e2e/tests/{storyId}.test.ts` | Generated test scripts |
| `.plan-execution/convergence/e2e/screenshots/{storyId}-{ts}.png` | Visual captures |
| `.plan-execution/convergence/golden/` | Golden reference files (SOURCE from reference run) |
