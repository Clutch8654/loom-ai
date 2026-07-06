# BenchmarkScorecard Schema

Defines the `BenchmarkScorecard` TOON artifact the `benchmark-agent` (P5) writes into a converged `.loom/thinks/` doc. It scores a bare idea against N competitor/prior-art references on ≥3 dimensions so the pre-plan panel (P4) can gate on benchmark presence: a **missing OR thin** scorecard is a finding.

Types are declared in `lib/types.ts` (`BenchmarkScorecard`, `BenchmarkDimension`, `BenchmarkReference`). Schema version: **1**.

**Atomic writes required:** write to `{path}.tmp` then rename. See `protocols/execution-conventions.md`.

---

## Score ranges + derived fields

All scores are on a **0..10** scale (0 = absent, 10 = best-in-class). Three fields are DERIVED (computed, never hand-authored):

```toon
derivations[3]{field,formula,range}:
  gap,selfScore − refScore,−10..10
  overall,mean(dimensions[].selfScore),0..10
  refOverall,mean(dimensions[].refScore),0..10
```

- Per-dimension `gap = selfScore − refScore` (positive ⇒ Loom leads on that dimension).
- `overall = mean(dimensions[].selfScore)`.
- `refOverall = mean(dimensions[].refScore)`.

---

## "Thin" definition (gate condition)

A scorecard is **thin** — too weak to be trusted, and a finding at the P4 panel — when EITHER:

```toon
thinRule[2]{condition,reason}:
  dimensions.length < 3,"Too few dimensions to be a meaningful comparison"
  "any dimension has empty sourceRefs (refScore unsourced)","A refScore with no backing reference is a guess, not a benchmark"
```

`thin` is a DERIVED boolean: `thin = (dimensions.length < 3) OR dimensions.some(d => d.sourceRefs.length === 0)`. The P4 panel treats `thin == true` (or an absent scorecard entirely) as a benchmark-presence finding.

---

## Reference row

```toon
references[N]{id,name,url,note}:
  R-01,gstack,https://github.com/garrytan/gstack,"Closest prior art — planning + review pipeline"
  R-02,"OpenHands",https://github.com/All-Hands-AI/OpenHands,"Autonomous agent baseline"
```

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | string | `R-\d{2,}`, unique within the scorecard. |
| `name` | string | Competitor / prior-art name. Non-empty. |
| `url` | string \| null | Provenance URL, or null for non-web references (e.g. a repo path). |
| `note` | string | Optional — why the reference is comparable. |

---

## Dimension row

```toon
dimensions[N]{dimension,selfScore,refScore,gap,sourceRefs}:
  planning-rigor,9,8,1,"R-01"
  extensibility,8,6,2,"R-01,R-02"
  ops-polish,7,8,-1,"R-02"
```

| Column | Type | Constraints |
|--------|------|-------------|
| `dimension` | string | Dimension name. Non-empty. |
| `selfScore` | number | 0..10. |
| `refScore` | number | 0..10. |
| `gap` | number | Derived: `selfScore − refScore`. |
| `sourceRefs` | string[] | Reference ids (R-NN) backing `refScore`. **Empty ⇒ unsourced ⇒ thin.** |

---

## Scorecard envelope

```toon
runAt: 2026-07-05T10:00:00.000Z
subject: .loom/thinks/foo-2026-07-05T09-00-00.md
overall: 8.0
refOverall: 7.33
thin: false
references[2]{id,name,url,note}:
  R-01,gstack,https://github.com/garrytan/gstack,"Closest prior art"
  R-02,OpenHands,https://github.com/All-Hands-AI/OpenHands,"Autonomous agent baseline"
dimensions[3]{dimension,selfScore,refScore,gap,sourceRefs}:
  planning-rigor,9,8,1,"R-01"
  extensibility,8,6,2,"R-01,R-02"
  ops-polish,7,8,-1,"R-02"
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `runAt` | ISO 8601 | yes | Millisecond precision. |
| `subject` | string (path) | yes | The think doc / idea benchmarked. |
| `references[]` | typed array | yes | N entries; ≥1 on a non-thin card. |
| `dimensions[]` | typed array | yes | ≥3 on a non-thin card. |
| `overall` | number | yes | Derived: `mean(dimensions[].selfScore)`. |
| `refOverall` | number | yes | Derived: `mean(dimensions[].refScore)`. |
| `thin` | boolean | yes | Derived per the thin rule above. |

---

## Rules

1. Scores are 0..10. `gap`, `overall`, `refOverall`, and `thin` are DERIVED — recomputed from the dimensions/refs, never hand-edited.
2. Every `refScore` MUST be backed by ≥1 `sourceRef`; an unsourced refScore makes the card `thin`.
3. `benchmark-agent` (P5) runs pre-roadmap on a bare idea (unlike the plan-scoped `feature-coverage-agent`) and writes this scorecard INTO the think doc. Name collision with the `loom-benchmark` perf skill is avoided (that skill is untouched).
4. The P4 panel reads this scorecard from the think doc; missing or `thin` ⇒ a benchmark-presence finding routed by the C-02 table.
