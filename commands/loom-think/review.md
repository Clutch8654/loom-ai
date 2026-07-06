---
description: "Review a converged /loom-think doc through the M-04 altitude lens panel and route it through the fail-closed C-02 gate (proceed | rewrite-think | kill) at the divergent→formality seam."
---

## Subcommand: review

You are an orchestrator for `/loom-think:review` — the pre-plan thinking-review gate. It sits at the **divergent→formality seam**: it reads a converged think doc, runs an archetype-selected panel of M-04 altitude lenses over it, and routes the result through the **deterministic, fail-closed C-02 router** into exactly one of three decisions — `proceed`, `rewrite-think`, or `kill`.

This subcommand auto-resolves as `/loom-think:review` (it mirrors `commands/loom-plan/review.md`, which resolves as `/loom-plan:review`). It does NOT modify `/loom-think` itself — it is a separate review pass over a doc that `/loom-think` already wrote.

### Opt-in, not a wall

**For humans, `/loom-think:review` is OPT-IN — it is NOT required before `/loom-roadmap init`.** A human may take a think doc straight to `/loom-roadmap init`. The gate is **default-on only for `/loom-auto`** (the bounded rewrite loop is wired by P6a, not here). Running this command by hand is always allowed and always advisory unless a caller chooses to enforce its verdict.

### Arguments

Parse remaining arguments:

- **No args** — resolve the **newest `.loom/thinks/` doc on the current branch**:
  1. Determine the current git branch (`git rev-parse --abbrev-ref HEAD`).
  2. Scan `.loom/thinks/*.md`, read each doc's frontmatter `branch:` field, and keep those whose `branch:` matches the current branch.
  3. Pick the **newest by frontmatter `datetime:`** (NOT by filename — per `.loom/thinks/README.md`).
- **`<doc>`** — an explicit path to a think doc. Use it verbatim (skip branch resolution).

#### Empty state (no doc) — MUST fail non-zero

If no think doc resolves (no `.loom/thinks/` doc matches the current branch, and no explicit path was given), print exactly:

```
no think doc on branch <X> — run /loom-think first
```

…where `<X>` is the current branch name, and **exit NON-ZERO (exit code 1)**. Do NOT print a stack trace. Do NOT spawn any lenses. This is a clean, actionable empty-state message, not a crash.

### Instructions

#### Step 1: Resolve the doc

Resolve per the Arguments rules above. On empty state, emit the message and exit non-zero (see above). Otherwise read the resolved doc — you will pass its full text to each lens.

#### Step 2: Resolve the archetype → select the lens panel

Read the **Archetype→Lens Selection Rule** in `protocols/think-review.schema.md` (the normative table, also typed as `PrePlanLensPanel` in `lib/types.ts`). Resolve the project archetype via the `roadmap-archetype-detector` agent (or an explicit override), select the matching row into `activeLenses`, and set `panelSize = activeLenses.length`. `eng` fires for **every** archetype (approach-soundness is never optional).

```toon
lensSelectionRule[6]{archetype,lenses,rationale}:
  cli,"eng,devex,ceo","Dev-facing tool: no visual surface"
  web-app,"eng,devex,ceo,design","Full user-facing product: all four fire"
  library,"eng,devex,ceo","API soundness + integrator DX + positioning"
  data-pipeline,"eng,devex,ceo","Correctness + operator DX + business value"
  research,"eng,ceo","Approach soundness + strategic worth"
  default,"eng,devex,ceo,design","Unknown archetype: fire all four (widest net)"
```

#### Step 3: Spawn the altitude-mode lens panel (M-15)

> **Wired at the P4 extension point (Wave 2):** this step swaps the earlier M-14 "agents AS-IS" placeholder for the altitude-mode panel, and Step 3b folds in the benchmark-presence check. The router (Step 4) and canonical verdict write (Step 5) are untouched.

Spawn the M-04 review agents in **think-altitude mode**, one per active lens, in a SINGLE message so they run concurrently. This is the same four agent files used by `/loom-plan review` — NOT forked `-think` variants (C-04). Each is switched to framing altitude by a `scope` parameter; each carries `model: opus`, so resolve and pass `model: "opus"` on every spawn:

- `eng`    → `plan-eng-review-agent`
- `devex`  → `plan-devex-review-agent`
- `ceo`    → `plan-ceo-review-agent`
- `design` → `plan-design-review-agent`

Each spawn prompt MUST set **`scope: think`** (a.k.a. `altitude: framing`) and pass the full think-doc text. In this mode the agent reviews the doc's **framing** — problem clarity, approach soundness, gap-closure, benchmark presence — NOT phases or waves (a think doc has none). See each agent's **Think-Altitude Mode (framing review — C-04)** section. Each returns `ThinkReviewFinding` rows scoped to its own lens: `{id, lens, severity(blocking|warning|info), confidence(1..10), fixable, remediation, message}`. `fixable` is load-bearing only for `blocking` findings — it splits `kill` (fixable=false, fatal approach error, no fix within this framing) from `rewrite-think` (fixable=true).

Collect the `ThinkReviewFinding[]` from every reporting lens into one flat array (`findings`) for the router.

**Count `reportingLenses`** = the number of lenses that returned a **well-formed** `ThinkReviewFinding` envelope (a valid, parseable result — even an empty findings list from a lens that passed COUNTS as reporting). A lens that crashed, timed out, or returned a malformed envelope does **NOT** count toward `reportingLenses`. This count is REQUIRED by the router (`opts.reportingLenses`) and is what makes the gate fail closed — omitting it collapses to 0 and forces a fail-closed `rewrite-think` (see Step 4).

#### Step 3b: Benchmark-presence check (folded in from P5)

Before routing, run the **benchmark-presence check** over the think doc — this check lives in the panel, not in a new agent. Read the typed `BenchmarkScorecard` (see `lib/types.ts` / `protocols/benchmark-scorecard.schema.md`) that the `benchmark-agent` writes into the converged doc. Emit a `ThinkReviewFinding` (lens `ceo`, the positioning lens) when the scorecard is missing or **thin**:

```toon
benchmarkPresenceRule[3]{condition,severity,fixable,rationale}:
  "no BenchmarkScorecard present in the think doc",warning,true,"idea is asserted in a vacuum — add a competitive benchmark before formality"
  "scorecard is thin: dimensions.length < 3",warning,true,"too few benchmarked dimensions to trust the positioning"
  "scorecard is thin: any dimension has an empty sourceRefs (refScore UNSOURCED)",warning,true,"a reference score with no BenchmarkReference backing it is unsourced"
```

The `thin` flag is a **derived** field on the scorecard (`dimensions.length < 3` OR any dimension's `sourceRefs` is empty) — trust it if present, else recompute it from the rule above. A benchmark-presence finding is `warning`/`fixable: true` (it routes `rewrite-think`, never `kill` — a missing benchmark is repairable). Append this finding to `findings` before Step 4. If the scorecard is present and NOT thin, emit no benchmark-presence finding.

#### Step 4: Route through the fail-closed C-02 router

Call the pure router `routeThinkReview(findings, panel, opts)` exported from `scripts/lib/think-review-router.ts`. Pass:

- `findings` — the collected `ThinkReviewFinding[]` across all reporting lenses,
- `panel` — the resolved `PrePlanLensPanel` (`activeLenses.length` is M),
- `opts.reportingLenses` — the count from Step 3 (REQUIRED; the router cannot infer it),
- `opts.docPath` — the resolved think-doc path (woven into the `rewrite-think` nextCommand),
- `opts.revisionCount` — prior rewrite loops for this doc (0 on first pass).

The router applies the normative **C-02 decision table** (`protocols/think-review.schema.md § Decision Table`) deterministically:

```toon
decisionTable[4]{condition,decision,rationale}:
  "quorum NOT met (crashed / empty-because-crashed panel)",rewrite-think,"FAIL-CLOSED FIRST: PANEL_INCOMPLETE synthesized as blocking; NEVER proceed, never kill on sub-quorum evidence"
  "a blocking finding with fixable=false is present",kill,"fatal approach error — no fix within this framing"
  "any blocking (fixable) OR any warning finding is present",rewrite-think,"repairable defect — re-think and re-review"
  "no blocking and no warning finding is present",proceed,"framing is sound — advance to formality"
```

Precedence: **fail-closed first** (sub-quorum → `rewrite-think`, never `proceed`, never `kill`), then **kill outranks rewrite** (any-blocking-wins), then any warning → rewrite, else proceed. Quorum = `⌈panelSize/2⌉` lenses reporting. Info findings never gate.

#### Step 5: Emit the verdict

The router returns a `ThinkReviewVerdict`. Write it atomically to the **canonical verdict path** `.plan-execution/ephemeral/think-review/verdict.toon` (write `{path}.tmp` → rename), then present it. This is the exact artifact `/loom-roadmap review` reads to skip its strategic lenses on the human path (avoiding a double-run), and the artifact `/loom-auto`'s bounded gate (P6a) persists per attempt. Every verdict carries `nextCommand`:

```toon
nextCommandMap[3]{decision,nextCommand}:
  proceed,/loom-roadmap init
  rewrite-think,/loom-think --from <doc>
  kill,"archive the think doc (.loom/thinks/archive/) — do NOT proceed to roadmap"
```

Present the decision, the `nextCommand`, the panel size / reporting lenses / `quorumMet`, and the findings table. On `kill`, name the concrete non-fixable defect and point at the archive path. On `rewrite-think`, surface the fixable defects the rewrite must address. On `proceed`, state that the framing is sound and the operator may run `/loom-roadmap init`.

### Output Format

A short verdict header (`decision`, `nextCommand`, `quorumMet`, `panelSize`/`reportingLenses`) followed by the `findings[]` table and, for `rewrite-think`/`kill`, the named defects the operator must act on.

---
