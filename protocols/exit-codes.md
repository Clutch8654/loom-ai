# Exit Codes & Error Code Registry

Canonical cross-skill catalog of process exit codes and named
(`UPPER_SNAKE`) error codes across Loom skills, commands, scripts, and
hooks. This protocol supersedes the error-catalog table embedded in
`planning/plans/PLAN-gstack-adoption.md` § Error Handling Specification —
that table is a plan artifact frozen at authoring time; **this file is the
living registry**.

Errors surface via AgentResult `blockingIssues[]` (see
`protocols/agent-result.schema.md`), hook stderr + non-zero exit, or a
script's own stderr, as appropriate to the resource type.

## Reserved common exit codes

Every new skill, command, or script MUST map its exits onto this
convention:

| Exit | Meaning | Notes |
|------|---------|-------|
| `0` | Success | Includes "completed with non-blocking warnings" (warnings go to stderr / findings). |
| `1` | Gate failure / findings detected | The tool ran correctly and found a problem: failed gate, overlap, regression, unresolved debt. |
| `2` | Usage or configuration error | Unknown subcommand, missing required argument, unreadable config. The tool never got far enough to judge anything. |
| `3+` | Skill-specific | Reserved for finer-grained states a surface needs to distinguish. Register each numbered code in the table below. The CI scripts use `3` = "environment/source unavailable" (git diff, manifest); `skills/feedback-loop` claims `4`–`10`. |

Hooks are the exception: they follow Claude Code's hook protocol, where
exit `2` means "block the tool call" (e.g. `hooks/loom-careful.ts`). Hook
exit codes are host semantics, not Loom semantics.

## Error code registry

Severity: **blocking** halts the flow (non-zero exit or blocker finding);
**warning** is surfaced but never halts on its own; **info** is
diagnostic only.

| Code | Owning surface | Exit | Severity | When |
|------|---------------|------|----------|------|
| `FINDING_MISSING_CONFIDENCE` | `hooks/agent-result-validator.ts`, `protocols/agent-result.schema.md` | — | blocking | AgentResult finding lacks `confidence`. |
| `DECISION_UNCLASSIFIED` | `protocols/loom-decision-principles.md`, `agents/decision-principles-consumer.md` | — | warning | Auto-flow agent emits a decision without `decisionClass`. |
| `LEARNINGS_SCHEMA_INVALID` | planned (PLAN F-05); no emitter shipped yet | — | blocking | `.loom/learnings.toon` fails parse against `protocols/learnings.schema.toon`. |
| `REGRESSIONS_SCHEMA_INVALID` | `agents/plan-eng-review-agent.md` | — | blocking | `.loom/regressions.toon` fails parse against `protocols/regressions.schema.toon`. |
| `CAREFUL_BLOCKED` | `hooks/loom-careful.ts` | 2 (hook deny) | blocking | Destructive command blocked by `/loom-careful`; bypass with `LOOM_CAREFUL_OVERRIDE=1`. |
| `HEALTH_TOOL_MISSING` | `scripts/loom-health.ts`, `commands/loom-health.md` | 0 | warning | Health composite skips a dimension whose tool is not installed. |
| `SPEC_ALREADY_MERGED` | planned (PLAN F-09); no emitter shipped yet | — | blocking | Invalid SpecRecord transition on a merged spec. |
| `SPEC_CLOSED` | planned (PLAN F-09); no emitter shipped yet | — | blocking | Invalid SpecRecord transition on a closed spec. |
| `BROWSER_ALREADY_RUNNING` | `scripts/loom-browser-daemon.ts`, `skills/loom-browser` | non-zero | blocking | Daemon start attempted while pid exists. |
| `BROWSER_NO_BINARY` | `scripts/loom-browser-daemon.ts`, `skills/loom-browser` | 0 | warning | No Chrome/Chromium/Brave/Edge binary found; falls back to stub mode. |
| `BROWSER_SPAWN_FAILED` | `scripts/loom-browser-daemon.ts` | non-zero | blocking | Daemon process failed to spawn. |
| `BROWSER_NOT_RUNNING` | `scripts/loom-browser-daemon.ts` | 0 | warning | `exec` issued with no running daemon; command queued. |
| `BROWSER_INJECTION_BLOCKED` | `skills/loom-browser`, `commands/loom-browser.md` | non-zero | blocking | Prompt-injection defense fired on tainted page content. |
| `COOKIE_STORE_NOT_FOUND` | `scripts/loom-import-cookies.ts` | non-zero | blocking | No Chrome/Chromium/Brave/Edge profile detected on this platform. |
| `SHIP_REBASE_CONFLICT` | `skills/loom-ship` | non-zero | blocking | Pre-flight rebase-from-base hit a conflict. |
| `SHIP_DRIFT_UNRESOLVED` | `skills/loom-ship` | — | warning | Drift detected against base and not resolved (confidence 8). |
| `SHIP_GH_MISSING` | `skills/loom-ship` | non-zero | blocking | `gh` CLI missing or unauthenticated at PR-creation time. |
| `DOC_DEBT` | `skills/loom-docs-release` (consumed by `skills/loom-ship`) | 0 (dry-run) | warning | Doc-debt finding embedded in the PR body by `/loom-ship`. |
| `DOC_DEBT_UNRESOLVED` | `skills/loom-docs-release` | non-zero | blocking | `missingReadme` non-empty and no `--plan` flag supplied. |
| `DIAGRAM_DRIFT_DETECTED` | `skills/loom-docs-release` (reads `.loom/diagrams/index.toon`, see `protocols/diagram-index.schema.toon`) | — | warning (blocking on breaking changes) | A diagram references a changed code path, or rendered files predate the `.md` source edit. |
| `CANARY_NO_CONFIG` | `skills/loom-canary`, `commands/loom-canary.md` | non-zero | blocking | CLAUDE.md missing the `## Deploy Configuration` block; run `/loom-setup deploy`. |
| `CANARY_NO_HEALTHCHECK` | `skills/loom-canary` | non-zero | blocking | Deploy config has an empty `healthCheckUrl`. |
| `CANARY_NO_SPLIT` | `skills/loom-canary` | 0 | warning | Target lacks native traffic-splitting; single-phase fallback (confidence 8). |
| `CANARY_ROLLED_BACK` | `skills/loom-canary` | non-zero | blocking | Health gate failed; rollback executed and recorded in `.loom/canary-history.toon`. |
| `CANARY_TARGET_UNCONFIGURED` | `skills/loom-canary` | non-zero | blocking | Deploy target not bootstrapped (no fly.toml, no vercel link, ...). |
| `DEPLOY_TARGET_UNKNOWN` | `skills/loom-setup-deploy` | non-zero | blocking | No deploy-target signal detected in the repo (see Legacy divergences — the PLAN listed this as warning). |
| `DEPLOY_READONLY_VIOLATION` | `skills/loom-setup-deploy` | non-zero | blocking | A Loom flow attempted to modify native deploy config files (C-06). |
| `INSTALL_MANIFEST_INVALID` | `scripts/loom-install.ts`, `skills/loom-install` | non-zero | blocking | Install manifest corrupt/missing on `--unlink`, or unknown host binding. |
| `INSTALL_INTERRUPTED` | `protocols/doctor-report.schema.md` (`/loom-doctor`) | — | blocking (doctor `error`) | `install.toon.installError` non-null — installer terminated mid-step. |
| `INSTALL_CONFLICT_PLUGIN_AND_CURL` | `install.sh` (verified by `scripts/test-install-sandbox.sh`) | 9 | blocking | Plugin install and curl install both present on the same host. |
| `EXPLORE_AGENT_FAILED` | `commands/loom-deepen.md` | 2 | blocking | Explore fan-out failed and zero candidate rows were collected (partial results still emit with `partial: true`). |
| `HTML_OPEN_FAILED` | `commands/loom-deepen.md` | 0 | info | `--html` render written but `open`/`xdg-open`/`start` all failed; path printed instead. |
| `LOOP_NOT_VERIFIED_RED` | `skills/feedback-loop` | 4 | blocking | Iteration attempted before TRDA pass. |
| `STUCK_AT_LOOP_CONSTRUCTION` | `skills/feedback-loop` | 5 | blocking | Rung 10 exhausted, `verifiedRed` still false. |
| `LOOPID_NOT_FOUND` | `skills/feedback-loop` | 6 | blocking | Read/write to a loopId that does not exist. |
| `RETIRE_NOT_GREEN` | `skills/feedback-loop` | 7 | blocking | Retirement attempted before the loop command exits 0. |
| `LOOP_IMMUTABLE` | `skills/feedback-loop` | 8 | blocking | Any write (including re-retire) to a retired loop. |
| `HARNESS_OUTPUT_INCOMPATIBLE` | `skills/feedback-loop` | 9 | blocking | Harness output not parseable into a verified-red signal. |
| `CRITERION_UNVERIFIABLE` | `skills/feedback-loop` | 10 | blocking | No rung of the ladder produces a deterministic red. |
| `HARNESS_MISSING` | `agents/convergence-driver.md`, `commands/loom-code.md` | — | blocking | `/loom-converge` preflight halt-reason: no harness available; surfaces in `convergence-summary.toon`. |
| `STUCK_AT_GRILL_CAP` | `protocols/grilling.md`, `commands/loom-which.md` | — | blocking | Grilling session hit the 12-question cap; no further questions permitted. |
| `SKILLIFY_TEST_FAIL` | `skills/loom-skillify` | non-zero | blocking | Generated `test.ts` exited non-zero; script not registered. |
| `WORKTREE_PREFLIGHT_OVERLAP` | `hooks/preflight-worktree-scan.ts` | 0 (hook warn) | warning | Sibling-worktree file-ownership overlap detected before `/loom-git pr`. |
| `WORKTREE_LEASE_HELD` | planned (`skills/loom-worktree` roadmap — enforced leases) | — | blocking | Write blocked because target path is under an active sibling lease. |
| `DOCS_DRIFT_DETECTED` | `scripts/ci/check-docs-drift.ts` | 1 | blocking (warn-only until Phase 16) | Generated-doc section stale relative to source. |
| `HOOK_DRIFT_DETECTED` | `scripts/ci/check-hook-drift.ts` | 1 | blocking (warn-only until Phase 13) | Hook registration sources diverge. |
| `CATALOG_INVALID` | `scripts/ci/check-library-catalog.ts`, `scripts/validate-library-catalog.js` | 1 | blocking | `skills/library.yaml` fails catalog validation. |
| `VALIDATION_ERROR` | `protocols/ci-gates.contract.md` | — | blocking | CiGateConfig field fails a validation rule (unknown tier, bad schedule, ...). |

## Per-surface exit-code maps

Numeric exits as each surface defines them today:

| Surface | 0 | 1 | 2 | 3+ |
|---------|---|---|---|-----|
| `skills/feedback-loop` | success | — | — | 4–10 per registry above |
| `commands/loom-deepen.md` | success (incl. `HTML_OPEN_FAILED`) | — | `EXPLORE_AGENT_FAILED` | — |
| `skills/loom-worktree` (`loom-worktree-scan.ts`) | clean scan / release | preflight overlap | unknown subcommand / usage | — |
| `skills/loom-learn` | success | learnings file missing/unreadable | unrecognized subcommand / missing arg | — |
| `skills/loom-diagram` | triplet written + registered | neither `--prose` nor `--mermaid` given | output dir not writable | — |
| `skills/loom-benchmark` (perf) | no regression | daemon unavailable / measurement failed | regression detected | — |
| `skills/loom-benchmark-models` | run completed (skips allowed) | no vendors available | `--suite` file unreadable | — |
| `scripts/loom-cso.ts` | gate pass (entry appended) | gate block (regression or score < 8) | usage error | — |
| CI gate scripts (`scripts/ci/*`, per `protocols/ci-gates.contract.md`) | pass / warn-only | check failure | — | 3 = source/manifest unavailable |

## Legacy divergences

Existing surfaces predate this convention. Their behavior is **not**
changed by this document — the divergences are recorded so readers are not
misled:

| Surface | Divergence from reserved meanings |
|---------|-----------------------------------|
| `commands/loom-deepen.md` | Exit `2` = `EXPLORE_AGENT_FAILED` (an agent/runtime failure, not a usage error). Exit `1` is unused. |
| `skills/loom-benchmark` | Exit `2` = regression detected — a gate failure that the convention reserves for `1`; exit `1` is used for environment failure (daemon down). |
| `skills/loom-diagram` | Exit `1` = missing required argument (a usage error per the convention); exit `2` = output dir not writable (an environment error). |
| `skills/loom-learn` | Exit `1` = missing/unreadable input file (environment, not "findings detected"). |
| `hooks/*` (e.g. `loom-careful.ts`) | Exit `2` = block the tool call, per Claude Code's hook protocol. Host semantics override this registry for hooks. |
| `install.sh` | Exit `9` = `INSTALL_CONFLICT_PLUGIN_AND_CURL`; the numbered range 3–8 is unclaimed there. |
| PLAN-gstack-adoption error table | Names `SHIP_DRIFT_DETECTED` and `CANARY_HEALTH_GATE_FAIL`; the shipped skills emit `SHIP_DRIFT_UNRESOLVED` and `CANARY_ROLLED_BACK` respectively. The PLAN lists `DEPLOY_TARGET_UNKNOWN` as warning; the shipped skill halts (blocking). The shipped names/semantics are canonical. |

## Registration rule

**New skills, commands, scripts, and hooks MUST register their exit codes
and named error codes in this file** in the same PR that introduces them:

1. Map numeric exits onto the reserved table (`0`/`1`/`2`), claiming `3+`
   only for states the common codes cannot express.
2. Add every named `UPPER_SNAKE` error code to the registry table with
   owning surface, numeric exit (or `—`), severity, and trigger.
3. Never reuse a name already in the registry with different semantics.
4. Do not renumber or rename an existing code without updating every
   emitter and consumer in the same PR (treat codes as an API, like the
   frozen check names in `protocols/ci-gates.contract.md`).

Divergences must not be added for new code — the Legacy divergences table
is closed to new entries.
