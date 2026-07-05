# OutcomeEval Schema

Defines the ground-truth outcome-eval result shape used by the `loom-qa` planted-bug eval (P8a) and registered into the F-20 eval ladder as the `qa-outcome` tier (P8b). Ported from gstack's planted-bug outcome eval: drive fixture pages through the daemon, then score the produced QA report against a ground-truth fixture with **per-category, per-severity** detection — not a single global pass/fail.

This is a **contract-only** document (Wave 0). Scoring behavior lives in `scripts/eval/tiers/qa-outcome.ts` (P8a).

Schema examples use TOON per the project convention.

---

## Design intent (why per-category, not two scalars)

An outcome eval that reports only `detection_rate` and `false_positives` as two global scalars hides which **kind** of bug the QA agent missed. `OutcomeEval` therefore carries a `perCategory[]` table so the eval can assert per-category floors (e.g. "visual bugs must be ≥ 0.5 detected") independently. The two roll-up scalars remain, derived from the per-category rows.

The visual category is detectable **because** P1a added the computed-style READ verbs (`css`, `is-visible`, `bounding-box`) to `BrowserCommand` — closing review theme T1.

---

## Where thresholds live (not in this result)

`OutcomeEval` records what was **detected**. The pass/fail **thresholds** — `floor` (minimum `detectionRate` per category) and `max` (maximum `falsePositives` per category) — live in the **ground-truth fixture** (`evals/fixtures/qa-ground-truth.toon`, owned by P8a), NOT in this result envelope. The eval reads the fixture, computes detection, and asserts `detectionRate ≥ floor` and `falsePositives ≤ max` per category. Keeping thresholds in the fixture keeps them versioned alongside the planted bugs they gate.

---

## OutcomeEval Schema

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| evalId | string | yes | Stable id for this eval run (e.g. `qa-outcome-{date}-{shortsha}`). |
| tier | string | yes | Eval-ladder tier id. Fixed to `qa-outcome`. |
| status | enum | yes | `passed`, `failed`, `skipped`, `error`. `skipped` when `LOOM_EVAL_LLM` is unset (exit 0, mirrors `scripts/eval/tiers/t3-judge.ts:132-146`). |
| groundTruthRef | string | yes | Path to the ground-truth fixture holding the planted bugs and per-category `floor`/`max` thresholds. |
| fixturesRun | string[] | yes | Fixture pages driven through the daemon (≥2; static + SPA/flow). |
| perCategory | OutcomeCategoryRow[] | yes | Per-category, per-severity detection rows (the core of this schema). |
| detectionRate | number | yes | Roll-up: fraction of planted bugs detected across all categories (0.0–1.0). Derived from `perCategory`. |
| falsePositives | integer | yes | Roll-up: total reported issues with no matching planted bug. Derived from `perCategory`. |
| skipReason | string | no | Actionable reason when `status: skipped`. |

### OutcomeCategoryRow Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| category | string | yes | Bug category (e.g. `functional`, `visual`, `console`, `overflow`). |
| severity | enum | yes | `critical`, `major`, `minor`. |
| detected | boolean | yes | Whether the QA report detected the planted bug(s) of this category+severity. |

Note: `floor` and `max` are intentionally **absent** from `OutcomeCategoryRow` — they are supplied by the ground-truth fixture and joined at scoring time, per "Where thresholds live" above.

### Example

```toon
outcomeEval:
  evalId: qa-outcome-20260705-a1b2c3d
  tier: qa-outcome
  status: passed
  groundTruthRef: evals/fixtures/qa-ground-truth.toon
  fixturesRun[2]: evals/fixtures/planted-bugs.html, evals/fixtures/planted-bugs-spa.html
  perCategory[4]{category,severity,detected}:
    functional,critical,true
    visual,major,true
    overflow,minor,false
    console,major,true
  detectionRate: 0.75
  falsePositives: 1
  skipReason:
```

### Skipped example

```toon
outcomeEval:
  evalId: qa-outcome-20260705-a1b2c3d
  tier: qa-outcome
  status: skipped
  groundTruthRef: evals/fixtures/qa-ground-truth.toon
  fixturesRun[0]:
  perCategory[0]{category,severity,detected}:
  detectionRate: 0
  falsePositives: 0
  skipReason: LOOM_EVAL_LLM unset — set it to run the scored outcome eval (T3 judge gate).
```

---

## Ground-truth fixture shape (owned by P8a, documented here for consumers)

The ground-truth fixture (`evals/fixtures/qa-ground-truth.toon`) carries the planted bugs plus the per-category thresholds this result is scored against:

```toon
plantedBugs[N]{category,severity,selector,expectedDetection}:
  functional,critical,#submit-btn,button does nothing on click
  visual,major,.hero,contrast below 4.5:1
thresholds[N]{category,floor,max}:
  functional,1.0,0
  visual,0.5,1
```

---

## Relationship to other schemas

- **browser-command.schema.md** — the eval drives fixtures via READ verbs (incl. `css`/`is-visible`/`bounding-box` for the visual category).
- **lib/types.ts** — `OutcomeEval` and `OutcomeCategoryRow` are declared there (Wave 0). The `EvalTier` union gains `qa-outcome` in P8b (not in Wave 0).
- **daemon-preflight.schema.md** — the eval fails hard on daemon-down before scoring.
