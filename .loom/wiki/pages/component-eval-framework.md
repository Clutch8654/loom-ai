```toon
pageId: component-eval-framework
title: Eval Framework (Three-Tier Ladder)
category: component
domain: code
createdAt: 2026-07-04T06:00:00Z
updatedAt: 2026-07-04T06:00:00Z
createdBy: wiki-maintainer-agent
updatedBy: wiki-maintainer-agent
summary: Three-tier eval ladder — T1 static/in-process (PR gate, blocking), T2 hermetic replay (nightly, advisory), T3 LLM-judge (opt-in, never merge-blocking). Free-by-default invariant: T1 and T2 make zero LLM calls.
estimatedTokens: 1000
bodySections[6]: Summary, Tiers, CI Wiring, Artifacts, Error Codes, Testability
subtype:
sourceRefs[8]: scripts/eval/run-evals.ts, scripts/eval/tiers/t1-static.ts, scripts/eval/tiers/t2-hermetic.ts, scripts/eval/tiers/t3-judge.ts, protocols/eval-tier.schema.md, evals/fixtures/, .github/workflows/pr-gate.yml, .github/workflows/nightly-gate.yml
crossRefs[0]{pageId,relationship}:
tags[6]: eval, tiers, CI, LLM-judge, F-20, F-21
staleness: fresh
confidence: high
```

# Eval Framework (Three-Tier Ladder)

## Summary

Shipped in Wave 8, Phase 20 (F-20 + F-21). A three-tier quality evaluation ladder for Loom's meta-orchestration logic. The core invariant is **free-by-default**: T1 and T2 make zero network/LLM calls (`llmCalls` MUST be 0). Only T3 may call an LLM judge, and only when `LOOM_EVAL_LLM` is set. T3 is advisory-only and never merge-blocking (constraint C-03).

Runner: `bun scripts/eval/run-evals.ts --tier <t1|t2|t3>`. Schema: `protocols/eval-tier.schema.md`. Artifact: `evals/results/{runId}.toon` (atomic write).

## Tiers

| Tier | When | Gating | LLM calls | Fixtures |
|------|------|--------|-----------|----------|
| T1 — static / in-process | PR gate | Blocking (exit 1 on failure) | 0 | None (deterministic) |
| T2 — hermetic replay | Nightly | Advisory | 0 | `evals/fixtures/*.toon` |
| T3 — LLM judge | Opt-in | Never merge-blocking | LLM (behind `LOOM_EVAL_LLM`) | Live prompts |

### T1 — Static / In-Process

Deterministic assertions — grammar round-trip and CSV-escape-parity fixtures. Runs entirely in-process; no subprocess or network call. `llmCalls` MUST be 0; any violation is `EVAL_TIER_CONTRACT_VIOLATION` (exit 1).

### T2 — Hermetic Replay

Replays committed TOON fixtures from `evals/fixtures/`. Any attempted live LLM call trips a fetch-trap and emits `EVAL_TIER_CONTRACT_VIOLATION` (exit 1). A missing fixture emits `EVAL_FIXTURE_MISSING` (exit 1) — fix by recording or restoring the fixture.

### T3 — LLM Judge (Opt-In)

Dispatched only when `LOOM_EVAL_LLM` is set. Compares a judged score (0–10) against the `main`-branch floor (`floorRef`). Floor regression emits `EVAL_FLOOR_REGRESSION` (advisory warning, exit 0); missing floor emits `EVAL_FLOOR_MISSING` (advisory, exit 0). T3 always exits 0 on judged-score grounds.

## CI Wiring

The pr-gate workflow gained a standalone `eval-t1` job that runs T1 on every PR. The nightly-gate runs T2 and also builds a `main`-branch floor in a detached worktree for T3 floor comparison. T3 is never triggered by CI — developer opt-in only.

Advisory note (contractAmendments[1], Wave 8): `protocols/ci-gates.contract.md` does not yet list `eval-t1` in the frozen required-checks set. Adding it is a follow-up that owns the CI gates contract.

## Artifacts

Each run writes an `EvalTierResult` artifact atomically to `evals/results/{runId}.toon`. The `runId` format is `{date}-{tier}-{shortsha}` (e.g. `2026-07-04-t1-ceefeb9`). Results are append-only — terminal states (passed, failed, error, skipped) are immutable; a new run always produces a new `runId`.

Artifact fields (from `protocols/eval-tier.schema.md`):

| Field | Type | Notes |
|-------|------|-------|
| `runId` | string | PK — `{date}-{tier}-{shortsha}` |
| `tier` | enum | t1 \| t2 \| t3 |
| `gitRef` | string | Full commit SHA |
| `status` | enum | pending → running → passed / failed / error / skipped |
| `llmCalls` | integer | MUST be 0 for t1 and t2 |
| `floorRef` | string \| null | Main-branch baseline runId (t3 only) |
| `results[]` | EvalResultRow[] | Per-eval: evalId, outcome, score, judgedScore |

## Error Codes

| Code | Exit | Tier | Description |
|------|------|------|-------------|
| `EVAL_FIXTURE_MISSING` | 1 | T2 | Missing fixture — restore or re-record |
| `EVAL_TIER_CONTRACT_VIOLATION` | 1 | Any | LLM call under T1/T2, or illegal state transition |
| `EVAL_FLOOR_REGRESSION` | 0 | T3 | Advisory — judged score below main-floor baseline |
| `EVAL_FLOOR_MISSING` | 0 | T3 | Advisory — no main-floor baseline found |

## Testability

The runner's `main()` is exported for in-process testing. Key seams injected via `RunOptions`:

- `judge` — inject a mock LLM judge (tests MUST inject; no live calls in tests)
- `repoRoot`, `resultsDir`, `fixturesDir` — override default directories
- `date`, `shortSha`, `gitRef` — produce deterministic `runId` values

Tests: `tests/eval/run-evals.test.ts`, `tests/eval/t3-gating.test.ts`. 22/22 pass (Wave 8 verification).
