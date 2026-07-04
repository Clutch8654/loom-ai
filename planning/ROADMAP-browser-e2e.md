---
roadmapVersion: 1
name: "Leverageable Browser-E2E"
status: draft
created: 2026-07-04
lastReviewed: 2026-07-04
reviewRef: planning/history/reviews/2026-07-04-review.toon
targetDate: null
totalFeatures: 10
totalMilestones: 5
---

# Roadmap: Leverageable Browser-E2E

> Revised 2026-07-04 after an 8-agent plan review (`planning/history/reviews/2026-07-04-review.toon`). Changes: C-02 pinned to `connectOverCDP` + `playwright-core`; success metric reconciled with the frozen F-25 gate; tests sub-gaps decomposed (closed vs declined); daemon-preflight/error-taxonomy (C-07) and structured action grammar (C-08) added; adversarial-injection fixture test added (BE-10); residual pre-declared in Non-Goals.

## Vision

The exceed-gstack M-09 acceptance gate closed **below-target** with exactly one trailing dimension: `tests` (Loom 8 vs gstack 9). The gap is not test *count* — it is a missing *capability*. gstack ships a mature browser-e2e substrate (the Playwright-backed `browse` daemon + a **browser-skills runtime** that codifies a live scrape into a deterministic, fixture-tested script) and a ground-truth outcome-eval loop; Loom has three disconnected browser paths and, critically, a **stubbed `loom-browser` daemon** whose `execCmd()` queues commands but never drives Chromium (`scripts/loom-browser-daemon.ts:268-290`).

This initiative closes the `tests` gap **the Loom way**: not by bulk-adding test files to chase a ratio, but by making browser-e2e a first-class, *leverageable* capability inside Loom's existing TDD (`tdd-coach`) and convergence (`/loom-converge`, `converge-stage-teammate`, `e2e-runner-agent`) harnesses. We unblock the daemon, collapse the three fragmented browser paths onto it as the single substrate, wire it into the convergence e2e tier and the feedback-loop Rung 4, and adopt gstack's two portable ideas — the fixture-tested browser-skill pattern and ground-truth outcome eval.

### Which `tests` sub-gaps this closes vs declines (review theme T1)

The baseline `tests` gap is composite. This initiative is explicit about what it closes and what it does not, so the re-score is calibrated and the residual is pre-declared, not discovered:

```toon
subGaps[6]{subGap,disposition,rationale}:
  browser-e2e-substrate,closes,"unblock daemon + connectOverCDP; the core missing capability"
  fixture-tested-determinism,closes,"C-04 pure-parser-over-captured-HTML; CI-safe browser tests"
  ground-truth-outcome-eval,closes,"BE-08 planted-bug scoring incl per-category/severity; wired into a nightly job"
  adversarial-injection-tests,closes-partially,"BE-10 adds one hermetic injection fixture test; NOT gstack's full ~15-file security cluster"
  raw-test-file-count (434 vs ~192),declines,"count padding strengthens nothing; capability parity is the goal (see Non-Goals)"
  cross-platform-windows-CI,declines,"mechanical breadth, separate from the capability gap (see Non-Goals)"
```

## Success Metrics

Acceptance is defined against the **frozen F-25 rubric** (`research/loom-vs-gstack-scorecard.toon`) to avoid a second below-target close (review theme T1 / strategy issue F-01). Two explicit modes:

- **PASS mode (target):** an honest single-dimension re-run scores `tests` **≥ 9** on the identical rubric — i.e. the shipped browser-e2e capability plus the ground-truth eval running in CI genuinely reaches gstack's rigor.
- **CALIBRATED-EQUIVALENCE mode (fallback, requires explicit user sign-off before it counts as acceptance):** if `tests` lands at 8, the initiative is **not** self-declared complete; the residual (raw count + Windows CI, pre-declared as Non-Goals) is reported and the user decides whether capability-parity is an accepted outcome. No massaging.

| Metric | Target | Measurement |
|--------|--------|-------------|
| Daemon drives Chromium | `loom-browser exec` performs real READ/WRITE against a page via `connectOverCDP` | behavioral test boots daemon, navigates a fixture, asserts DOM/text/computed-style |
| Convergence uses the daemon | `/loom-converge --e2e` runs a story through the daemon substrate | integration test: story → daemon runner → DeltaReport with real page assertions |
| Feedback-loop Rung 4 daemon-backed | a Rung-4 `loop.toon.command` is a real daemon assertion, verified-red-capable | construction test builds a daemon-backed Rung-4 loop that goes red then green |
| Fixture-tested browser-skill | a codified scrape reruns as a pure parser over captured HTML, zero network | `script.test.ts` passes offline; fails when fixture HTML rotates |
| Ground-truth outcome eval runs in CI | `loom-qa` scores a planted-bug page (per-category/severity) in a nightly job | eval asserts detection_rate ≥ floor, false_positives ≤ max; executes in nightly, not just buildable |
| Adversarial injection defense tested | a hermetic injection-fixture test proves the defense hook fires | fixture page attempts prompt-injection; test asserts `BROWSER_INJECTION_BLOCKED` |
| `tests` dimension re-score | ≥ 9 (PASS) or a signed-off calibrated equivalence at 8 | honest single-dimension re-run vs the frozen gstack rubric |

## Constraints & Decisions

### C-01: The `loom-browser` daemon is the single browser substrate
**Decision:** Collapse Loom's three independent browser paths (convergence e2e tier's Playwright/Chrome-MCP modes, the `loom-browser` daemon, and feedback-loop Rung 4) onto the persistent `loom-browser` daemon. No second browser stack. The Playwright/Chrome-MCP e2e modes remain supported for one release with a deprecation note; `daemon` becomes the recommended mode (review devex F-07).
**Rationale:** The three paths duplicate browser-launch logic and none is fixture-deterministic together; one persistent daemon (READ/WRITE/META tiers, a11y-ref selection) is the reusable primitive every consumer attaches to.
**Impact:** high

### C-02: Attach over CDP with `playwright-core` — never `launch()`
**Decision:** The daemon client attaches to the **already-running** daemon-managed Chromium via `chromium.connectOverCDP(cdpEndpoint)` using the **`playwright-core`** package (no bundled ~300MB browser). It MUST NOT call `chromium.launch()` (which would spawn a *second* browser and defeat C-01). The real CDP WebSocket URL is resolved by polling `http://127.0.0.1:9222/json/version` after Chromium spawns and overwriting the placeholder `cdpEndpoint` in `state.toon` (`loom-browser-daemon.ts:216`).
**Rationale:** Review blocking finding F-01: `launch()` and "attach to the existing endpoint" are contradictory primitives; only `connectOverCDP` preserves the single-persistent-session architecture. `playwright-core` avoids a heavy Chromium download the daemon doesn't need.
**Alternatives considered:** `playwright` + `launch()` — rejected: spawns a second browser, ~300MB dep, breaks C-01.
**Impact:** high (blocking)

### C-03: The e2e-story YAML is the runner-agnostic IR; the daemon mode uses a structured action grammar
**Decision:** Keep `protocols/e2e-story.schema.md` as the neutral IR. Because its `action` field is **free-form prose** by default, the daemon executor recognizes a **structured action grammar** subset (a normative addendum authored in Wave 0) — it is NOT a prose NLP parser. `e2e-test-writer-agent` emits the structured form when targeting `sessionMode: daemon`.
**Rationale:** Review (agentic-workflow): prose `action` strings give P3 no stable translation contract; an LLM call per step is prohibitively expensive in a tight loop. A structured grammar is deterministic and cheap.
**Impact:** high

### C-04: Fixture-tested determinism (the browser-skill convention)
**Decision:** Any codified browser flow ships a **pure parser function tested against captured HTML fixtures with zero network/daemon**. Live browser runs are the authoring step; the committed gate is the offline fixture test. This is a **new** convention this initiative establishes (no existing Loom skill uses the `SKILL.md + script.ts + fixtures/ + script.test.ts` layout); it is distinct from `loom-skillify`'s existing `scripts/skillified/` output path.
**Rationale:** Replaces flaky live network with a captured fixture that fails loudly when the page shape rotates — the most portable idea from gstack's harness.
**Impact:** high

### C-05: Free-by-default, consistent with the eval tier ladder
**Decision:** Browser-e2e integrates with the existing three-tier eval ladder (F-20): fixture-backed daemon assertions are free (T1/T2, hermetic); the LLM-judged outcome eval is opt-in behind `LOOM_EVAL_LLM` (reusing `scripts/eval/tiers/t3-judge.ts`) and runs in a **nightly** job so the capability is actually exercised, never merge-blocking.
**Impact:** medium

### C-06: No merge-blocking on live Chromium; cross-platform is nightly/advisory
**Decision:** Real-Chromium and any cross-platform browser jobs run nightly/advisory, never PR-blocking. PR tier gets only the fixture-deterministic parser tests. New PR-tier jobs are **additive** and MUST NOT be added to the frozen 6-check set in `protocols/ci-gates.contract.md` (follow the `eval-t1` additive pattern).
**Impact:** medium

### C-07: Canonical daemon-preflight + named error taxonomy (no false-green skips)
**Decision:** A single daemon-preflight contract (authored in Wave 0) governs all five consumers. Daemon-down is a **hard, non-zero fail** with a `run 'loom-browser start' first` remediation — never a silent queue-and-return-0. Every skip (Chromium-absent, `LOOM_EVAL_LLM` unset) prints a one-line actionable reason. Named error codes: `DAEMON_NOT_RUNNING`, `CHROMIUM_ABSENT`, `CDP_DISCONNECTED`, `REF_UNRESOLVED`, `STEP_TIMEOUT`, `STORY_PARSE_ERROR`, `BROWSER_INJECTION_BLOCKED`, each mapped to an operator-facing message + remediation.
**Rationale:** Review themes T5 (UX/devex/eng): a skipped e2e tier that reads as green is a false-green that erodes trust; the current stub silently returns 0.
**Impact:** high

### C-08: Tier concurrency is enforced by a daemon-side lock
**Decision:** READ (idempotent/parallel) / WRITE (sequenced) / META (exclusive) semantics are enforced by a daemon-side lock (lockfile or named mutex), since each `loom-browser exec` is a separate CLI process and cannot self-sequence.
**Rationale:** Review (eng F-02): tier semantics are unenforceable across per-invocation processes without an explicit primitive.
**Impact:** medium

## Conceptual Data Model

```toon
entities[5]{entity,description,keyFields}:
  BrowserCommand,"A daemon exec instruction with READ/WRITE/META tier + closed verb enum + error code","id, tier, verb, ref, args, result, errorCode"
  E2EStory,"Runner-agnostic YAML scenario (existing IR); daemon mode uses the structured action grammar (C-03)","id, derivedFrom[], sessionMode, steps[]{action,expected}"
  BrowserSkill,"A codified scrape: SKILL.md + script.ts + fixtures/ + script.test.ts (C-04, new convention)","name, host, triggers[], trusted, fixtureHtml"
  OutcomeEval,"Ground-truth scored run over a planted-bug fixture, per-category/severity","evalId, groundTruthRef, detectionRate, falsePositives, perCategory[]{category,severity,detected}"
  DaemonSession,"Persistent Chromium session state (exists; extend with real cdpEndpoint + lock)","daemonPid, cdpEndpoint, port, tierLock, chromiumAttached"
```

## Features

```toon
features[10]{id,title,milestone,summary}:
  BE-01,Real daemon CDP client,M-01,"Implement loom-browser-daemon execCmd() as a playwright-core connectOverCDP client that drives Chromium (READ incl css/is-visible/bbox, WRITE, META) with real cdpEndpoint resolution, cookie injection, tier-lock, and an injection-defense stub"
  BE-02,Daemon behavioral test + fixture server,M-01,"Bun.serve fixture server + behavioral test that boots the daemon, navigates, asserts real DOM/text/computed-style/a11y + a WRITE round-trip; skips gracefully without Chromium"
  BE-03,Daemon executor over e2e-story IR,M-02,"Runner consuming the structured-action-grammar e2e-story steps, driving the daemon, writing the e2e DeltaReport"
  BE-04,e2e-runner daemon session mode,M-02,"Add sessionMode 'daemon' to e2e-runner-agent + the e2e-story sessionMode enum + convergence-tier runner array so /loom-converge --e2e routes to it"
  BE-05,Feedback-loop Rung 4 daemon-backed,M-03,"Make the headless-browser rung a real daemon-backed loop.toon.command (tight, verified-red-capable)"
  BE-06,tdd-coach browser tracer mode,M-03,"Add a browser-e2e tracer-bullet mode to tdd-coach's RED step (DEFERRABLE — not on the acceptance-critical path; ship as fast-follow if scope tightens)"
  BE-07,Browser-skill codify pattern,M-04,"Establish the fixture-tested browser-skill convention on loom-skillify; ship one reference skill with a pure-parser fixture test"
  BE-08,Ground-truth outcome eval,M-04,"Planted-bug outcome eval on loom-qa: >=2 fixtures (static + SPA/flow), per-category/severity scoring, registered into the F-20 eval ladder, run in a nightly job"
  BE-09,CI wiring + tests re-score,M-05,"Fixture parser tests -> PR tier (additive); live/nightly browser + outcome-eval jobs -> nightly; honest tests re-score vs the frozen rubric"
  BE-10,Adversarial injection fixture test,M-04,"One hermetic injection-fixture test proving the daemon's onPageText defense hook fires (BROWSER_INJECTION_BLOCKED) — maps a slice of gstack's security cluster into Loom"
```

## Milestones

```toon
milestones[5]{id,title,features,dependsOn,gate}:
  M-01,Daemon substrate,"BE-01, BE-02",,"execCmd drives real Chromium via connectOverCDP; behavioral test green (not queue-only)"
  M-02,Convergence integration,"BE-03, BE-04",M-01,"/loom-converge --e2e runs a structured-action story through the daemon and writes a real DeltaReport"
  M-03,TDD + feedback-loop integration,"BE-05, BE-06",M-02,"Rung-4 daemon loop red->green; tdd-coach browser tracer authored (or explicitly deferred)"
  M-04,Portable gstack patterns,"BE-07, BE-08, BE-10",M-01,"A fixture-tested browser-skill + a per-category outcome eval (>=2 fixtures) + an injection-defense test all pass offline"
  M-05,CI + acceptance,"BE-09",M-02 M-03 M-04,"Fixture tests on PR tier (additive), live+outcome-eval nightly; tests honestly re-scored >= 9 OR signed-off calibrated equivalence at 8"
```

## Non-Goals (residual pre-declared honestly — review theme T1)

- **Matching gstack's raw test-file count (434 vs ~192).** Count padding strengthens nothing; this is capability parity. If the re-score credits count over capability, `tests` may land at 8 — declared here, not discovered at re-score.
- **Cross-platform / Windows CI.** Named in the baseline tests evidence but out of scope — mechanical breadth, separate initiative. Pre-declared residual.
- **gstack's full adversarial/security cluster** (~15 files). BE-10 ships ONE injection-defense test, not parity; the rest is future work.
- **Closing the gbrain semantic-recall gap** (user-acknowledged out of scope).
- **Multi-host install breadth** (separate, mechanical; confirm with user before treating as scoped).
- **Merge-blocking on live Chromium** (C-06) — PR tier stays fixture-deterministic.
