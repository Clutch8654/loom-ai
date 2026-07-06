```toon
pageId: component-eval-framework
title: Eval Framework (Tiered Ladder)
category: component
subtype:
domain: code
summary: Tiered eval ladder — T1 static (PR gate, blocking), T2 hermetic replay (nightly), T3 LLM-judge (opt-in), plus qa-outcome ground-truth tier. Free-by-default: T1/T2 make zero LLM calls.
estimatedTokens: 1197
bodySections[6]: Summary, Dependencies, Key Behaviors, Tiers, CI Wiring, Error Codes
createdAt: 2026-07-04T06:00:00Z
updatedAt: 2026-07-06T00:00:00Z
createdBy: wiki-maintainer-agent
updatedBy: wiki-ingest-agent
sourceRefs[8]: scripts/eval/run-evals.ts, scripts/eval/tiers/t1-static.ts, scripts/eval/tiers/t2-hermetic.ts, scripts/eval/tiers/t3-judge.ts, scripts/eval/tiers/qa-outcome.ts, protocols/eval-tier.schema.md, .github/workflows/pr-gate.yml, .github/workflows/nightly-gate.yml
crossRefs[0]{pageId,relationship}:
tags[6]: eval, tiers, CI, LLM-judge, qa-outcome, browser-e2e
staleness: fresh
confidence: high
```

# Eval Framework (Tiered Ladder)

## Summary

A tiered quality-evaluation ladder for Loom's meta-orchestration logic. Originally three tiers (F-20/F-21, Wave 8); Phase 9a (PLAN-browser-e2e) added a fourth runner tier, **`qa-outcome`**, a ground-truth outcome eval that drives planted-bug fixtures over the live browser daemon. The core invariant is **free-by-default**: T1 and T2 make zero network/LLM calls (`llmCalls` MUST be 0). Only T3 and `qa-outcome` may call an LLM, and only when `LOOM_EVAL_LLM` is set — both are advisory and never merge-blocking (constraint C-03).

Runner: `bun scripts/eval/run-evals.ts --tier <t1|t2|t3|qa-outcome>`. Schema: `protocols/eval-tier.schema.md`. Artifact: `evals/results/{runId}.toon` (atomic write, `runId = {date}-{tier}-{shortsha}`).

## Dependencies

- **`lib/` core** — TOON I/O goes only through `serializeToon` / `atomicWriteText` / `isMain` (constraint C-02, no hand-rolled serializer); types `EvalTier`, `EvalTierResult`, `EvalResultRow` live in `lib/types.ts`.
- **Tier modules** — `scripts/eval/tiers/{t1-static,t2-hermetic,t3-judge,qa-outcome}.ts`, each returning a uniform `TierRunOutput` the runner stamps into an artifact.
- **Fixtures** — `evals/fixtures/` (`csv-row-extraction.toon`, `toon-summary-parity.toon`, `qa-ground-truth.toon`, `planted-bugs.html`, `planted-bugs-spa.html`).
- **CI** — `.github/workflows/pr-gate.yml`, `.github/workflows/nightly-gate.yml`.

## Key Behaviors

- **Free-by-default (C-03).** T1/T2 `llmCalls` MUST be 0; a violation is `EVAL_TIER_CONTRACT_VIOLATION` (exit 1). T3 and `qa-outcome` gate on `LOOM_EVAL_LLM` — unset ⇒ `skipped`, exit 0.
- **Immutable results.** Terminal states are append-only; a re-run always mints a new `runId`, never mutates one.
- **Advisory judge.** T3 compares a judged score (0–10) against the `main`-branch floor (`floorRef`); regression/missing-floor are advisory (exit 0). T3 never exits non-zero on judged-score grounds.
- **`qa-outcome` split.** `run-evals.ts --tier qa-outcome` advisory-skips (the CLI wires no reporter); the nightly job injects a real `QaReporter` into `runQaOutcome` to run the SCORED path against the live daemon.
- **Testability.** `main()`/`writeResult()` are exported; `RunOptions` seams inject `judge`, override dirs, and pin `date`/`shortSha`/`gitRef` for deterministic `runId`s.

## Tiers

| Tier | When | Gating | LLM calls | Fixtures |
|------|------|--------|-----------|----------|
| T1 — static / in-process | PR gate | Blocking (exit 1) | 0 | none (deterministic) |
| T2 — hermetic replay | Nightly | Advisory | 0 | `evals/fixtures/*.toon` |
| T3 — LLM judge | Opt-in (`LOOM_EVAL_LLM`) | Never merge-blocking | LLM | live prompts |
| qa-outcome — ground-truth | Opt-in (`LOOM_EVAL_LLM`) | Advisory, never blocks | LLM | planted-bug HTML + `qa-ground-truth.toon` |

## CI Wiring

- **pr-gate** — standalone `eval-t1` job (additive; not in the frozen 6-check required set) plus `browser-fixture-tests` running hermetic `tests/browser tests/skills tests/eval skills/browser-skills` (live-Chromium cases self-skip).
- **nightly-gate** — `eval-t1`, `eval-t2` (builds a `main`-branch floor in a detached worktree; regression is advisory), `docker-e2e`, `daemon-e2e` (live loom-browser daemon, opt-in `LOOM_BROWSER_E2E=1`), and `qa-outcome` — all `continue-on-error` so advisory jobs never block the nightly gate.

## Error Codes

| Code | Exit | Tier | Description |
|------|------|------|-------------|
| `EVAL_FIXTURE_MISSING` | 1 | T2 | Missing fixture — restore or re-record |
| `EVAL_TIER_CONTRACT_VIOLATION` | 1 | Any | LLM call under T1/T2, or illegal state transition |
| `EVAL_FLOOR_REGRESSION` | 0 | T3 | Advisory — judged score below main-floor baseline |
| `EVAL_FLOOR_MISSING` | 0 | T3 | Advisory — no main-floor baseline found |
