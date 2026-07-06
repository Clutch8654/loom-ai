# ThinkReviewVerdict Schema

Defines the `ThinkReviewVerdict` TOON artifact and the **deterministic, fail-closed** decision table (C-02) that the pre-plan thinking-review router emits at the divergent→formality seam. The router is a pure function over a lens panel's `findings[]`; this schema is the contract every consumer (`/loom-think:review`, `/loom-roadmap review`, the P4 altitude panel, and the `/loom-auto` bounded gate) reads.

Types are declared in `lib/types.ts` (`ThinkReviewVerdict`, `ThinkReviewFinding`, `ThinkReviewLens`, `ThinkReviewSeverity`, `ThinkReviewDecision`, `PrePlanLensPanel`). Schema version: **1**.

**Atomic writes required:** write to `{path}.tmp` then rename. See `protocols/execution-conventions.md`.

---

## Closed enums

| Enum | Values | Notes |
|------|--------|-------|
| `lens` | `eng` \| `devex` \| `ceo` \| `design` | Closed. Unknown lenses are rejected, never widened to `string`. |
| `severity` | `blocking` \| `warning` \| `info` | Closed. **ALIGNED** to AgentResult's `FindingSeverity` (`protocols/agent-result.schema.md` § Findings Row Schema) — same three values, reused verbatim. |
| `decision` | `proceed` \| `rewrite-think` \| `kill` | Closed. The router's only three outputs. |
| `errorCode` | `PANEL_INCOMPLETE` \| null | Fail-closed no-quorum sentinel (see below). UPPER_SNAKE per `protocols/exit-codes.md`. |

`confidence` is an integer **1..10** — the canonical AgentResult confidence scale (suppressed 1..4, caveated 5..6, promoted 7..10). It is NOT re-based onto another scale.

---

## Finding row

```toon
findings[N]{id,lens,severity,confidence,fixable,remediation,message}:
  F-01,eng,blocking,9,false,"Approach cannot satisfy the stated constraint — no fix within this framing; archive and re-scope","The event-sourced design contradicts the single-writer requirement in §2"
  F-02,ceo,warning,7,true,"Add a positioning paragraph naming the 2 closest competitors","Think doc asserts differentiation but names no reference product"
```

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | string | `F-\d{2,}`, unique within the verdict. |
| `lens` | enum | Closed: `eng` \| `devex` \| `ceo` \| `design`. |
| `severity` | enum | Closed: `blocking` \| `warning` \| `info` (AgentResult-aligned). |
| `confidence` | integer | 1..10. |
| `fixable` | boolean | Load-bearing only for `blocking` — splits kill vs rewrite. |
| `remediation` | string | Non-empty — the actionable next step. |
| `message` | string | Non-empty prose. |

---

## Decision Table (C-02) — deterministic, NO "MAY"

The router evaluates the panel's findings and returns exactly one decision. Rules are applied **top to bottom; the first matching row wins** (any-blocking-wins, kill outranks rewrite):

```toon
decisionTable[4]{condition,decision,rationale}:
  "a blocking finding with fixable=false is present",kill,"fatal approach error — no fix within this framing"
  "a blocking finding (all fixable=true) OR any warning finding is present",rewrite-think,"repairable defect — re-think and re-review"
  "no blocking and no warning finding is present",proceed,"framing is sound — advance to formality"
  "quorum NOT met (no-quorum / empty-because-crashed panel)",rewrite-think,"fail-closed: PANEL_INCOMPLETE synthesized as blocking; NEVER proceed"
```

Precedence, stated explicitly so there is no ambiguity:

1. **Fail-closed first.** If `quorumMet == false`, set `errorCode: PANEL_INCOMPLETE`, treat it as a synthetic blocking finding, and route to `rewrite-think`. An empty-because-crashed panel (zero findings because lenses crashed, not because they passed) MUST route here — it MUST NOT be read as "no findings ⇒ proceed".
2. **Kill outranks rewrite.** With quorum met, if any `severity: blocking` finding has `fixable == false` → `kill`.
3. **Any-blocking / any-warning wins.** Otherwise, if any `blocking` (all fixable) OR any `warning` finding exists → `rewrite-think`.
4. **Proceed.** Only when quorum is met AND there are zero blocking and zero warning findings (info findings do not gate).

### Quorum

- Panel size **M** = the number of lenses fired for the resolved archetype (see the selection rule below).
- Quorum = **⌈M/2⌉** lenses reporting. A lens that crashed / timed out / returned a malformed envelope does NOT count toward `reportingLenses`.
- `quorumMet = reportingLenses ≥ ⌈M/2⌉`.
- When `quorumMet == false` the router fails closed (rule 1). It NEVER emits `proceed` on a sub-quorum panel.

Worked quorum examples: M=4 ⇒ need ≥2; M=3 ⇒ need ≥2; M=2 ⇒ need ≥1.

---

## Verdict envelope

```toon
decision: rewrite-think
nextCommand: /loom-think --from .loom/thinks/foo-2026-07-05T10-00-00.md
decidedBy: think-review-router
revisionCount: 1
panelSize: 4
reportingLenses: 4
quorumMet: true
decidedAt: 2026-07-05T10:05:00.000Z
errorCode:
findings[2]{id,lens,severity,confidence,fixable,remediation,message}:
  F-01,eng,warning,8,true,"Name the single-writer owner in §2","Concurrency model is unspecified"
  F-02,ceo,blocking,9,true,"Add a competitive benchmark before formality","No BenchmarkScorecard present in the think doc"
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `decision` | enum | yes | `proceed` \| `rewrite-think` \| `kill`. |
| `nextCommand` | string | yes | proceed → `/loom-roadmap init`; rewrite-think → `/loom-think --from <doc>`; kill → archive guidance. |
| `decidedBy` | string | yes | Router id or agent name. |
| `revisionCount` | integer | yes | 0-indexed prior rewrite loops for this doc. |
| `panelSize` | integer | yes | M. |
| `reportingLenses` | integer | yes | Lenses that actually reported. |
| `quorumMet` | boolean | yes | `reportingLenses ≥ ⌈M/2⌉`. |
| `findings[]` | typed array | yes | May be empty (`[0]:`) ⇒ proceed (only if quorum met). |
| `decidedAt` | ISO 8601 | no | Millisecond precision. |
| `errorCode` | enum | no | `PANEL_INCOMPLETE` on no-quorum, else null/omitted. |

### nextCommand mapping (deterministic)

```toon
nextCommandMap[3]{decision,nextCommand}:
  proceed,/loom-roadmap init
  rewrite-think,/loom-think --from <doc>
  kill,"archive the think doc (.loom/thinks/archive/) — do NOT proceed to roadmap"
```

---

## Archetype→Lens Selection Rule

The concrete, normative table below is the rule authored inside `PrePlanLensPanel` (typed shape in `lib/types.ts`). P1 (`/loom-think:review` panel), P3 (`/loom-roadmap review` conditional lenses), and P4 (the altitude panel) **all consume this same table** — it maps the project archetype to which of `{eng,devex,ceo,design}` lenses fire, and the count of fired lenses is the panel size **M** used by the quorum math. Archetypes match the roadmap-archetype-detector's closed set. `eng` fires for EVERY archetype (approach-soundness is never optional).

```toon
lensSelectionRule[6]{archetype,lenses,rationale}:
  cli,"eng,devex,ceo","Dev-facing tool: correctness + ergonomics + strategic value; no visual surface"
  web-app,"eng,devex,ceo,design","Full user-facing product: all four lenses fire"
  library,"eng,devex,ceo","API soundness + integrator DX + positioning; no visual surface"
  data-pipeline,"eng,devex,ceo","Correctness + operator DX + business value; no visual surface"
  research,"eng,ceo","Approach soundness + strategic worth; no dev/visual surface"
  default,"eng,devex,ceo,design","Unknown archetype: fire all four (widest safety net)"
```

Resolution: the caller resolves `resolvedArchetype` (via the roadmap-archetype-detector or an explicit override), selects the matching row into `activeLenses`, and sets `panelSize = activeLenses.length`. Quorum is then `⌈panelSize/2⌉` as above.

---

## Rules

1. The router is a **pure function** — deterministic over `findings[]` + `PrePlanLensPanel`, no I/O, no clock beyond an injected `now()`.
2. **Fail closed.** No-quorum, crashed panel, or malformed input → `rewrite-think` with `errorCode: PANEL_INCOMPLETE`. Never `proceed`.
3. **Kill halts; rewrite loops.** `kill` is a terminal decision (P6a HALTs the pipeline); `rewrite-think` re-enters the think loop up to the P6a bound.
4. Every verdict MUST carry `nextCommand`, `decidedBy`, and `revisionCount`.
5. Opt-in for humans (NOT required before `/loom-roadmap init`); default-on for `/loom-auto` (P6a).
