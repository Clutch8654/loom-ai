---
planVersion: 2
name: "Leverageable Browser-E2E"
status: completed
created: 2026-07-04
lastReviewed: 2026-07-04
completedAt: 2026-07-05T21:55:00Z
acceptanceStatus: calibrated-equivalence-at-8
acceptanceSignedOff: true
acceptanceNote: "All 14 phases executed + committed across 7 waves (8 commits, tsc=0, 442 pass/2 skip). tests re-scored honestly to 8 (calibrated-equivalence): eval-harness plank closed + browser subsystem now real+tested (connectOverCDP drive, daemon convergence e2e, Rung-4 red→green, fixture-tested browser-skill, per-category outcome eval in nightly, BE-10 injection test). Below 9 only on the two pre-declared Non-Goals (raw test-file-count parity, Windows/cross-platform CI). User signed off at 8 on 2026-07-05."
reviewRef: planning/history/reviews/2026-07-04-review.toon
roadmapRef: planning/ROADMAP-browser-e2e.md
totalPhases: 14
totalWaves: 6
---

# Plan: Leverageable Browser-E2E

> Revised 2026-07-04 per the 8-agent review (`planning/history/reviews/2026-07-04-review.toon`). Applied all 12 prioritized revisions: C-02 `connectOverCDP`/`playwright-core` (blocking F-01); P1 error taxonomy (blocking F-03); P8/P5 → P1 dependency fix; waves re-leveled by depth; P1/P4/P8/P9 split; metric↔gate reconciliation; P1↔P8 visual fix; unowned wiring seams assigned; daemon-preflight (C-07); structured action grammar (C-08/C-03); spec misstatements corrected with file:line anchors.

## Overview

Closes the one trailing dimension from the exceed-gstack M-09 acceptance (`tests`, Loom 8 vs gstack 9) by shipping browser-e2e as a *leverageable capability* inside Loom's TDD and convergence harnesses — not by padding test count. Spine: unblock the stubbed `loom-browser` daemon (`scripts/loom-browser-daemon.ts:268-290`) via `connectOverCDP` (C-02), collapse Loom's three fragmented browser paths onto it (C-01), wire it into the convergence e2e tier and feedback-loop Rung 4, and adopt gstack's portable ideas (fixture-tested browser-skills, per-category ground-truth outcome eval, one adversarial-injection test). Foundation-first: the daemon client (Waves 1–2) precedes every consumer. Acceptance reconciles with the frozen F-25 rubric — PASS at `tests ≥ 9`, or a signed-off calibrated-equivalence at 8 with the residual (raw count + Windows CI) pre-declared as Non-Goals.

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Language | TypeScript 5.x | daemon client, executor, tests |
| Runtime | Bun (preferred), Node 20+ | repo convention |
| Browser driver | **`playwright-core`** (`chromium.connectOverCDP`) | C-02; attaches to the daemon's existing Chromium at port 9222 — NEVER `launch()`, NEVER the heavier `playwright` package |
| Testing | Vitest | fixture-server behavioral tests, pure-parser fixture tests |
| Fixture server | `Bun.serve` (tiny, random port) | mirrors gstack `browse/test/test-server.ts` |
| Data format | TOON v1 | DeltaReport, loop.toon, browser-skill metadata, outcome-eval results |
| IR | `protocols/e2e-story.schema.md` + structured action grammar (C-03) | daemon mode uses the structured verb subset, not prose |
| CI | GitHub Actions | fixture parser tests → PR tier (additive, per `ci-gates.contract.md`); live + outcome-eval → nightly (C-06) |

## Shared surfaces (single-owner, verified clean)

Each is owned by exactly one phase: `scripts/loom-browser-daemon.ts` (P1a/P1b), `scripts/lib/browser-client.ts` (P1a then P1b — sequential, same file), `agents/e2e-runner-agent.md` (P4a), `protocols/convergence-tier.schema.md` (P4b), `protocols/e2e-story.schema.md` (P0 addendum + P4a enum), `skills/loom-browser/SKILL.md` (P4a), `skills/loom-skillify/SKILL.md` (P7), `skills/loom-qa/SKILL.md` (P8a), `skills/feedback-loop/SKILL.md` (P5), `scripts/eval/run-evals.ts` + `lib/types.ts` EvalTier union (P8b), `skills/library.yaml` (P0 protocols + P7 skill registration), `.github/workflows/*` (P9a).

---

### Phase 0 — Wave 0: Contracts, preflight, error taxonomy, action grammar

**Agent:** contracts-agent
**Objective:** Lay every shared contract downstream consumers read: the `BrowserCommand` protocol (closed READ/WRITE/META verb enum incl computed-style verbs, a11y-ref shape, result envelope, **named error codes**), `BrowserSkill` + `OutcomeEval` schemas, a **daemon-preflight contract** (C-07), a **structured action-grammar addendum** to the e2e-story schema (C-03), and a reference to the existing DeltaReport schema. No behavior.
**Dependencies:** none
**File Ownership:** `protocols/browser-command.schema.md`, `protocols/browser-skill.schema.md`, `protocols/outcome-eval.schema.md`, `protocols/daemon-preflight.schema.md`, `protocols/e2e-story.schema.md` (append daemon-mode action-grammar addendum only), `lib/types.ts` (append BrowserCommand/BrowserSkill/OutcomeEval/EvalTier-extension interfaces), `skills/library.yaml` (register the 4 new protocols under `library.protocols:`)

#### Acceptance Criteria
- [ ] `BrowserCommand` specifies a **closed** verb enum — READ: `screenshot, dom-query, a11y-snapshot, console-log, network-log, get-url, get-title, css, is-visible, bounding-box`; WRITE: `click, type, hover, navigate, submit, upload`; META: `start, stop, restart, config, cookie-import` — and a **closed error-code enum**: `DAEMON_NOT_RUNNING, CHROMIUM_ABSENT, CDP_DISCONNECTED, REF_UNRESOLVED, STEP_TIMEOUT, STORY_PARSE_ERROR, BROWSER_INJECTION_BLOCKED`, each with an operator message + remediation.
- [ ] `daemon-preflight.schema.md` defines one behavior for daemon-down across all consumers: **hard non-zero fail** + `run 'loom-browser start' first` (never silent-skip / queue-return-0).
- [ ] `OutcomeEval` carries `perCategory[]{category,severity,detected}` (not just two scalars) and states where `floor`/`max` live (in the ground-truth fixture).
- [ ] The e2e-story addendum defines the daemon-executor structured action grammar (`navigate <url>`, `click <a11y-ref-json>`, `type <a11y-ref-json> <text>`, `assert-text`, `assert-visible`, `screenshot`) — distinct from the default free-form prose.
- [ ] P3's DeltaReport target is named: reuse the existing shape at `agents/convergence-driver.md:1106-1124` / `agents/e2e-runner-agent.md:159-183` (no new writer path).
- [ ] The 4 new protocols are registered under `library.protocols:` in `skills/library.yaml`; `bunx tsc --noEmit -p hooks/tsconfig.json` = 0.

---

### Phase 1a — Wave 1: CDP connect + cdpEndpoint resolution + READ tier

**Agent:** implementer-agent
**Objective:** Replace the queue-only `execCmd()` stub with a `playwright-core` client that **attaches** to the running Chromium via `connectOverCDP` and serves the READ tier. This is the load-bearing tracer bullet: first real drive of Chromium.
**Dependencies:** Phase 0
**File Ownership:** `scripts/loom-browser-daemon.ts` (exec dispatch), `scripts/lib/browser-client.ts` (new — READ half), `package.json` (add `playwright-core`)

#### Acceptance Criteria
- [ ] Client uses `chromium.connectOverCDP(cdpEndpoint)` — **not** `launch()` (C-02).
- [ ] **Resolves the real cdpEndpoint:** after Chromium spawns, poll `http://127.0.0.1:9222/json/version` (timeout/retry) to get the WebSocket URL and `atomicWrite` it over the placeholder at `scripts/loom-browser-daemon.ts:216` before any exec proceeds. (The placeholder `ws://…/devtools/browser/pending` will not connect.)
- [ ] READ verbs return real data incl `css`/`is-visible`/`bounding-box` (so the P8 visual-bug category is detectable — fixes review theme T1 P1↔P8 contradiction).
- [ ] a11y-ref (role+name+index) resolves against a live page; on miss → `REF_UNRESOLVED` non-zero.
- [ ] `scripts/lib/browser-client.ts` **exports** `connect` + `execRead` so Phase 2 imports them directly (no subprocess).
- [ ] Builds the verb→tier classifier from `skills/loom-browser/SKILL.md:46-79`. `tsc` = 0.

---

### Phase 1b — Wave 2: WRITE + META + cookie injection + tier-lock + injection stub

**Agent:** implementer-agent
**Objective:** Complete the client: WRITE (sequenced), META (lifecycle), **real cookie injection**, the **tier-concurrency lock** (C-08), and the injection-defense **stub** (C-07) with its hermetic test (BE-10). Replace the silent queue-return-0 with named errors (blocking F-03).
**Dependencies:** Phase 1a
**File Ownership:** `scripts/lib/browser-client.ts` (WRITE/META half — sequential after P1a), `tests/browser/injection-defense.test.ts`

#### Acceptance Criteria
- [ ] WRITE verbs mutate the page; META manages lifecycle; a daemon-side **lock** enforces WRITE-sequenced / META-exclusive across separate CLI processes (C-08).
- [ ] **Cookie injection is real:** on `BrowserContext` creation, read every `*.toon` under `COOKIES_DIR` (`loom-browser-daemon.ts:24`), parse the `cookies[N]{...}` table via `parseToon`, unescape `%2C` (schema at `scripts/loom-import-cookies.ts:91-108`), call `context.addCookies(...)`. (The existing `cookiesLoaded:true` is a flag, not injection.)
- [ ] `execCmd` against a stopped daemon exits **non-zero** with `DAEMON_NOT_RUNNING` + remediation — the queue-return-0 stub is removed (blocking F-03). CDP disconnect → `CDP_DISCONNECTED` (reconnect-or-fail); launch failure → `CHROMIUM_ABSENT`.
- [ ] Stub `onPageText(pageText,url)` per `skills/loom-browser/SKILL.md:108-124` (this hook does NOT currently exist — create the contract slot; full impl deferred to M-05/F-15), called on every navigation; on `ok:false` exit non-zero with `BROWSER_INJECTION_BLOCKED`.
- [ ] BE-10: `tests/browser/injection-defense.test.ts` loads an injection fixture page and asserts the hook fires. `tsc` = 0.

---

### Phase 2 — Wave 3: Daemon behavioral test + fixture server

**Agent:** implementer-agent
**Objective:** A `Bun.serve` fixture server + a behavioral test that boots the real daemon, navigates to fixtures, and asserts READ (incl computed-style) + a WRITE round-trip against actual Chromium. Graceful skip when Chromium absent.
**Dependencies:** Phase 1b
**File Ownership:** `tests/browser/fixture-server.ts`, `tests/browser/fixtures/**`, `tests/browser/daemon-e2e.test.ts`

#### Acceptance Criteria
- [ ] Boots the daemon, navigates to a local fixture, asserts text/DOM/computed-style/a11y and a form-fill WRITE round-trip.
- [ ] **Skips (not fails)** without Chromium, mirroring `test/helpers/docker-e2e-guard.ts` (singular `test/` — note the cross-directory import from `tests/browser/`); the skip prints an actionable reason (`SKIP: no Chromium — run playwright install chromium`, C-07).
- [ ] Self-isolates for parallel execution via `tests/helpers/isolated-fixture.ts` (plural `tests/`).

---

### Phase 3 — Wave 3: Daemon executor over the structured-action e2e-story IR

**Agent:** implementer-agent
**Objective:** A runner consuming e2e-story YAML steps in the **structured action grammar** (C-03) and driving the daemon, producing the e2e DeltaReport. Reuses the existing DeltaReport shape.
**Dependencies:** Phase 1b
**File Ownership:** `scripts/e2e-daemon-runner.ts`, `tests/browser/e2e-daemon-runner.test.ts`

#### Acceptance Criteria
- [ ] Parses structured `action` strings (grammar from the P0 addendum) → daemon commands; maps `expected` → READ assertions. It is NOT a prose NLP parser.
- [ ] Emits the existing DeltaReport shape (keys ≥ `timestamp, tier: e2e, passing, failing, criteria[N]{...}`), asserted via `parseToon`. In tests it writes to a **tempdir**, never to `.plan-execution/` (it is an internal library for P4a's session mode, not a standalone writer — resolves the sole-writer conflict with `e2e-runner-agent.md:155`).
- [ ] A story with a failing `expected` yields a red DeltaReport; a passing one yields green.

---

### Phase 4a — Wave 4: e2e-runner daemon session mode + sessionMode enum

**Agent:** implementer-agent
**Objective:** Add `sessionMode: daemon` to `e2e-runner-agent` (invoking the P3 runner), extend the e2e-story `sessionMode` enum, and identify + wire the `--e2e` session-mode routing site. Declare `e2e-runner-agent` as a `loom-browser` consumer.
**Dependencies:** Phase 3
**File Ownership:** `agents/e2e-runner-agent.md`, `protocols/e2e-story.schema.md` (sessionMode enum at `:94,:147` — add `daemon`), `skills/loom-browser/SKILL.md` (consumer list + daemon preflight), `tests/agents/e2e-runner-daemon-mode.test.ts`

#### Acceptance Criteria
- [ ] The integration test invokes e2e-runner with `sessionMode: daemon`, runs a structured-action story through `e2e-daemon-runner.ts` against the fixture server, and asserts the tempdir DeltaReport has `tier: e2e, passing: 1, failing: 0` (concrete, not "can route").
- [ ] `e2e-test-writer-agent` emits the structured action form when targeting `daemon` mode; `skills/loom-browser/SKILL.md` lists `e2e-runner-agent` and enforces the daemon preflight.

---

### Phase 4b — Wave 5: convergence-tier runner registration

**Agent:** implementer-agent
**Objective:** Migrate the e2e-tier `runner:` from a scalar to a typed array so `/loom-converge` can route to the daemon runner variant.
**Dependencies:** Phase 4a
**File Ownership:** `protocols/convergence-tier.schema.md`

#### Acceptance Criteria
- [ ] `runner: e2e-runner-agent` (scalar, `:63-73`) becomes `runners[N]{name,sessionMode}:` with rows `e2e-runner-agent,headless` / `e2e-runner-agent,chrome-mcp` / `e2e-runner-agent,daemon`; the schema version is bumped.

---

### Phase 5 — Wave 4: Feedback-loop Rung 4 daemon-backed

**Agent:** implementer-agent
**Objective:** Make Rung 4 a real daemon-backed `loop.toon.command` (a single shell-executable daemon assertion) that passes the TRDA gate and is verified-red-capable. No schema field change (`command` already generalizes, `feedback-loop.schema.md:50`).
**Dependencies:** Phase 1b
**File Ownership:** `skills/feedback-loop/SKILL.md` (Rung 4 section, `:94-103`), `scripts/loop-browser-rung.ts`, `tests/skills/feedback-loop-browser-rung.test.ts`

#### Acceptance Criteria
- [ ] `scripts/loop-browser-rung.ts` exits non-zero on a failed daemon assertion / zero on pass, proven by two fixture invocations (using the Phase-2 fixture server, no live network); the constructed Rung-4 `loop.toon` passes all four TRDA booleans and reaches `verified-red`, then green after a fix.

---

### Phase 6 — Wave 5: tdd-coach browser tracer mode (DEFERRABLE)

**Agent:** implementer-agent
**Objective:** Add a browser-e2e tracer-bullet mode to `tdd-coach`'s RED step so a daemon assertion can be the failing test. **Deferrable** (strategy: untraced to a success metric — ship as fast-follow if scope tightens).
**Dependencies:** Phase 5
**File Ownership:** `agents/tdd-coach.md`, `tests/agents/tdd-coach-browser-tracer.test.ts`

#### Acceptance Criteria
- [ ] The spec documents the RED step as `loom-browser exec <daemon-assertion>` before any impl step; the test asserts (a) that ordering in the doc and (b) a daemon assertion against a fixture lacking the expected element exits non-zero.

---

### Phase 7 — Wave 2: Browser-skill codify pattern

**Agent:** implementer-agent
**Objective:** Establish the fixture-tested browser-skill convention (C-04) on `loom-skillify` and ship one reference skill whose parser is a pure function over captured HTML (zero network/daemon). Register it in the catalog.
**Dependencies:** Phase 1a
**File Ownership:** `skills/loom-skillify/SKILL.md` (codify-scrape section), `skills/browser-skills/**` (reference skill: `script.ts` + `fixtures/captured.html` + `script.test.ts`), `skills/library.yaml` (register the new skill under `library.skills:`), `tests/skills/browser-skill-fixture.test.ts`

#### Acceptance Criteria
- [ ] The reference skill's `script.test.ts` runs the pure parser over captured HTML and passes **offline**; a mutated-fixture case (target selector absent) makes it throw/error — NOT silently empty.
- [ ] `loom-skillify` documents the `SKILL.md + script.ts + fixtures/ + script.test.ts` layout as a **new** convention, explicitly distinct from its existing `scripts/skillified/` output path.
- [ ] `bunx vitest run skills/browser-skills/` is discovered and exits 0 (add a vitest include if needed).

---

### Phase 8a — Wave 3: Ground-truth outcome eval (scoring + fixtures)

**Agent:** implementer-agent
**Objective:** Port gstack's planted-bug outcome eval onto `loom-qa`: drive ≥2 fixture pages (static + SPA/flow) through the daemon, score the report against a ground-truth fixture with per-category/severity detection. Judge behind `LOOM_EVAL_LLM` (T3), mocked in tests.
**Dependencies:** Phase 1b
**File Ownership:** `skills/loom-qa/SKILL.md` (outcome-eval section), `evals/fixtures/qa-ground-truth.toon`, `evals/fixtures/planted-bugs.html`, `evals/fixtures/planted-bugs-spa.html`, `scripts/eval/tiers/qa-outcome.ts`, `tests/eval/qa-outcome.test.ts`

#### Acceptance Criteria
- [ ] `LOOM_EVAL_LLM` unset → status `skipped`, exit 0 (mirrors `scripts/eval/tiers/t3-judge.ts:132-146`), with an actionable skip reason.
- [ ] With a `fixedJudge` stub (pattern from `tests/eval/t3-gating.test.ts:39-42`, no live network), scores `detection_rate`/`false_positives` **per category/severity** against the ground truth; asserts `detection_rate ≥ floor`, `false_positives ≤ max`. The visual category is detectable because P1a added `css`/`is-visible`/`bounding-box` READs.
- [ ] ≥2 fixtures covering distinct bug categories (functional + visual/overflow + console).

---

### Phase 8b — Wave 4: Eval-ladder tier registration

**Agent:** implementer-agent
**Objective:** Register the new tier into the F-20 eval ladder so it is actually invokable (unowned-seam fix).
**Dependencies:** Phase 8a
**File Ownership:** `scripts/eval/run-evals.ts` (import + `VALID_TIERS` + dispatch switch), `lib/types.ts` (extend the `EvalTier` union with the new tier id)

#### Acceptance Criteria
- [ ] The tier id (name it explicitly, e.g. `qa-outcome`) is added to the `EvalTier` union, `VALID_TIERS`, the import block, and the dispatch switch in `scripts/eval/run-evals.ts`.
- [ ] `bun scripts/eval/run-evals.ts --tier qa-outcome` is discoverable and runs (skips cleanly with `LOOM_EVAL_LLM` unset); `tsc` = 0.
- [ ] **External-infra spike first:** confirm `run-evals.ts` still accepts a new tier module at the current signature before building against it.

---

### Phase 9a — Wave 5: CI wiring (fixture → PR additive, live → nightly)

**Agent:** implementer-agent
**Objective:** Wire fixture parser tests into the PR tier as an **additive** job (never in the frozen 6-check set) and the live daemon-e2e + nightly outcome-eval jobs into nightly/advisory.
**Dependencies:** Phase 2, Phase 7
**File Ownership:** `.github/workflows/pr-gate.yml` (additive fixture-test job), `.github/workflows/nightly-gate.yml` (live daemon-e2e + `qa-outcome` eval jobs), `tests/ci/browser-ci-wiring.test.ts`

#### Acceptance Criteria
- [ ] Reads `protocols/ci-gates.contract.md` first; the PR job follows the `eval-t1` additive pattern (`pr-gate.yml:186-208`), NOT added to `gate-status: needs:`. The nightly live job follows the `docker-e2e` pattern (`nightly-gate.yml:218-241`, `continue-on-error: true`).
- [ ] `bunx vitest run tests/browser tests/skills tests/eval` exits 0 **without** Chromium present (all live-browser tests skip, not fail).
- [ ] The nightly `qa-outcome` eval job actually runs the scored eval (so it is exercised, not merely buildable).

---

### Phase 9b — Wave 6: Honest `tests` re-score (acceptance)

**Agent:** implementer-agent
**Objective:** Run an honest single-dimension re-score of `tests` vs the **frozen** gstack rubric, anchored to demonstrated capability, and record PASS (≥9) or a calibrated-equivalence-at-8 with the pre-declared residual — no massaging.
**Dependencies:** Phase 2, Phase 4a, Phase 4b, Phase 5, Phase 6, Phase 7, Phase 8a, Phase 8b, Phase 9a
**File Ownership:** `planning/reports/tests-rescore.toon`

#### Acceptance Criteria
- [ ] Records the re-score anchored to concrete evidence (daemon drives Chromium via connectOverCDP; convergence e2e uses it; Rung-4 loop red→green; fixture-tested browser-skill; per-category outcome eval running in nightly; injection test).
- [ ] If `tests` reaches ≥9 → PASS. If it lands at 8 → status `calibrated-equivalence`, names the residual (raw count + Windows CI, per Non-Goals), and flags that acceptance requires explicit user sign-off. No self-declared pass.

## Wave map (re-leveled by dependency depth — review theme T3)

```
Wave 0: P0
Wave 1: P1a
Wave 2: P1b ∥ P7                    (dep P1a; disjoint: browser-client WRITE half / loom-skillify+browser-skills)
Wave 3: P2 ∥ P3 ∥ P8a              (dep P1b; disjoint: tests/browser / e2e-daemon-runner / loom-qa+evals)
Wave 4: P4a ∥ P5 ∥ P8b            (P4a dep P3; P5 dep P1b; P8b dep P8a; disjoint)
Wave 5: P4b ∥ P6 ∥ P9a            (P4b dep P4a; P6 dep P5; P9a dep P2+P7; disjoint)
Wave 6: P9b                        (dep all)
```
Critical path: `P0 → P1a → P1b → P3 → P4a → P9a → P9b` (and the parallel `P1b → P5 → P6` branch). Every wave gate now fires on a real seam; no wave spawns a phase whose input doesn't exist yet. P1a→P1b is inherently sequential (same file `browser-client.ts`).

## Validation Spikes (front-loaded — review: phasing)
- **In P1a:** prove `connectOverCDP` attaches to the *already-running* daemon Chromium (via the resolved `/json/version` endpoint) before building READ on top. If attach-to-existing fails, every consumer is affected.
- **In P8b:** confirm `run-evals.ts` accepts a new tier module at the current signature before building `qa-outcome.ts`.

## Verification Commands

```bash
bunx tsc --noEmit -p hooks/tsconfig.json          # 0 (zero-tolerance ratchet)
bunx eslint .
bunx vitest run tests/browser tests/skills tests/eval skills/browser-skills
bun scripts/loom-browser-daemon.ts status         # daemon health (defined output envelope)
bun scripts/eval/run-evals.ts --tier qa-outcome   # skips clean without LOOM_EVAL_LLM
grep -r 'delta-report.toon' scripts/ agents/       # only e2e-runner-agent + e2e-daemon-runner (no rogue writer)
```

## Non-Goals

Raw test-file-count parity (434 vs ~192); cross-platform/Windows CI; gstack's full ~15-file adversarial cluster (BE-10 ships one test); gbrain semantic recall; multi-host install breadth; merge-blocking on live Chromium (C-06). The count + Windows-CI residuals are pre-declared so a calibrated-equivalence re-score is honest, not a discovered miss.
