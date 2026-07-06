---
name: loom-health
description: "Composite 0-10 quality score with trend history — runs scripts/loom-health.ts across five weighted signals (typecheck, tests, lint, dead-code, shellcheck), prints TOON, and appends a HealthScoreHistory row to .loom/health-history.toon. --quick skips tests + dead-code for in-loop use."
---

<!-- @loom-include: protocols/skill-preamble.md -->

# /loom-health — Composite Quality Score with Trend History (M-02 F-05)

`/loom-health` runs `scripts/loom-health.ts`, which computes a single composite
**0-10 quality score** from five weighted signals and appends a trend row to
`.loom/health-history.toon`. It is the scoring primitive `/loom-qa` calls for
its before/after ship-readiness delta and the precedent the CSO history schema
mirrors.

## Weighted signals

| Signal | Weight | Source |
|--------|--------|--------|
| typecheck  | 30% | `tsc --noEmit` (or project tsconfig) |
| tests      | 30% | the project test runner (vitest) |
| lint       | 20% | the project linter |
| dead-code  | 10% | unused-export / dead-file scan |
| shellcheck | 10% | `shellcheck` over tracked shell scripts |

The composite is the weighted sum, rounded to an integer 0-10 (10 = clean).

## Missing-tool re-normalization

When a signal's tool is unavailable, the script emits `HEALTH_TOOL_MISSING`
for that signal, **drops** it from the composite, and **re-normalizes** the
remaining weights so the score is not silently penalized for a tool the
project never installed. This graceful degradation is the concrete
beyond-upstream capability over gstack's flat pass/fail health check.

## Modes

- **Default:** run all five signals, print the TOON envelope, and append a
  `HealthScoreHistory` row to `.loom/health-history.toon` (atomic
  `.tmp` + rename).
- **`--quick`:** skip `tests` + `dead-code` (the slow signals) and do **not**
  append history. This is the in-loop mode `/loom-qa` invokes between fix
  attempts so a patch can be checked for regression cheaply.

## Output envelope

```toon
score: 9
mode: full
signals[5]{name,weight,raw,contribution,status}:
  typecheck,30,10,3.0,ok
  tests,30,9,2.7,ok
  lint,20,10,2.0,ok
  deadCode,10,8,0.8,ok
  shellcheck,10,0,0,HEALTH_TOOL_MISSING
gitSha: abc1234
```

## Backing & enforcement

- **Backing script:** `scripts/loom-health.ts` — owns the deterministic scoring,
  re-normalization, and atomic history append.
- **Behavioral tests (referenced, not duplicated):** `tests/backfill/loom-health.test.ts`
  covers the composite math, `HEALTH_TOOL_MISSING` re-normalization, and the
  `--quick` no-append path; `tests/scripts/loom-health-exec.test.ts` covers the
  end-to-end CLI execution. This phase references that coverage rather than
  adding a second copy.
- **Enforcement:** the composite score, missing-tool re-normalization, and the
  atomic `.loom/health-history.toon` append are wired in the backing script and
  demonstrated by the tests above.

## Loom conventions

Loom platform conventions (TOON on disk, atomic writes, AgentResult envelope,
confidence scoring, model resolution, init guard) apply to this skill **by
reference** via the `<!-- @loom-include: protocols/skill-preamble.md -->`
directive at the top of this file — see `protocols/skill-preamble.md`. They are
not re-inlined here.

## Non-goals

- No autofix — `/loom-health` scores and records; remediation is up to the
  developer or a downstream `/loom-qa` / `/loom-code fix` run.
- Not a security gate — that is `/loom-cso`.

## See also

- `scripts/loom-health.ts`
- `commands/loom-health.md`
- `skills/loom-qa/SKILL.md` (consumes the before/after score)
- `skills/loom-cso/SKILL.md` (mirrors the history-file schema)
