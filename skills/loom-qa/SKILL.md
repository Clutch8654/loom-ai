---
name: loom-qa
description: "Live-site iterative test-fix loop. Browser-drives site via /loom-browser daemon, finds bugs, fixes iteratively, atomic commits, re-verify. Three tiers: Quick/Standard/Exhaustive."
---

# /loom-qa — Live-Site Iterative Test-Fix Loop (M-07 F-20)

`/loom-qa` drives the running app through the persistent Chromium daemon
(`/loom-browser`, M-11 F-33), finds bugs, attempts iterative fixes, commits
each successful fix atomically, and re-verifies until the app is stable or
the tier budget is exhausted.

## Dependency: `/loom-browser` daemon

`/loom-qa` refuses to run without a live daemon. Before starting the loop it
reads `.loom/browser/state.toon`:

- If the file does not exist, or `daemonPid` is missing, or the OS process
  under `daemonPid` is not alive → emit an instructive stderr message:

  ```
  /loom-qa requires the /loom-browser daemon.
  Run: /loom-browser start
  Then re-run: /loom-qa --tier standard <url>
  ```

  Exit non-zero. Do **not** cold-start a browser inline — that would defeat
  M-11's shared-session guarantee.

- If `state.toon` reports `crashed`, instruct the user to `/loom-browser stop
  && /loom-browser start` before retrying.

## Tiers

`--tier` selects the depth of the sweep.

| Tier         | Budget  | Scope |
|--------------|---------|-------|
| `quick`      | ~5 min  | Happy-path only. One traversal per top-level nav item. Screenshot each landing state. |
| `standard`   | ~15 min | Happy-path + top 5 non-happy states: empty state, error state, loading state, unauthenticated state, 404. |
| `exhaustive` | ~45 min | Full a11y sweep (axe-core via the daemon), edge cases (long strings, unicode, RTL, keyboard-only nav), screenshot regression vs `.loom/qa/baselines/`. |

Default tier when `--tier` is omitted is `standard`.

## Health scores — before & after

`/loom-qa` calls `/loom-health` (Phase 2 F-05) twice:

1. **Before** — record `beforeScore` (0-10) in the output envelope.
2. **After** — after the loop exits (stable or budget-exhausted), record
   `afterScore`.

The delta feeds `shipReadiness`:

- `ready` — `afterScore >= 8` and zero unresolved high-severity findings.
- `not-ready` — otherwise. The envelope lists the blocking findings.

## The loop

```
loop:
  1. Identify next bug — traverse the site under the tier's scope; the
     traversal script emits BugCandidate{page, ref, symptom, confidence}.
  2. If no bug found → exit loop with status stable.
  3. Attempt fix — spawn a fixer subagent with the BugCandidate as input.
     The fixer either produces a patch or reports NO_FIX_FOUND.
  4. Apply patch → run `/loom-health --quick` → if score does not regress,
     git-commit the patch atomically with message
     `qa: fix {symptom} on {page} (confidence {n})`.
  5. Re-verify the bug on the live site via the daemon.
  6. If bug persists after 2 fix attempts → mark as `unresolved` and move on.
  7. Budget check — if elapsed >= tier budget, exit loop with status
     budget-exhausted.
```

Fixer-agent selection: the loop spawns `agents/fixer-agent.md` (the same
fixer `/loom-code fix` and `/loom-converge` use). Before every spawn,
resolve the model per the standard mandate (CLAUDE.md § Agent Conventions):
(1) `orchestration.toml` `modelProfile` **utility** tier, (2) the fixer's
frontmatter `model:`, (3) inherit — and pass `model: "{resolved}"` on the
Agent call. The fixer receives the BugCandidate as input and MUST return a
standard AgentResult envelope (`protocols/agent-result.schema.md`) whose
findings carry `confidence: 1-10`. If `agents/fixer-agent.md` is not
registered in this project, fall back to a manual instruction stub in the
output envelope so the developer can pick up where the loop stopped.

Wiki context: if `.loom/wiki/index.toon` exists, match the bug's page/flow
against wiki pages before spawning the fixer and inject the matched page
content into the fixer prompt — the same discipline `/loom-bugfix` applies.
Fixes made with flow context regress less.

## Output envelope

```
tier: standard
url: https://example.com
beforeScore: 7
afterScore: 9
shipReadiness: ready
loopIterations: 4
bugsFound: 4
bugsFixed: 3
bugsUnresolved: 1
budgetUsedMs: 812340
budgetLimitMs: 900000
findings[N]{page,ref,symptom,severity,confidence,status,commitSha}:
  /pricing,{role:button,name:Subscribe,index:0},click yields 500,high,9,fixed,abc1234
```

Every finding carries `confidence: 1-10`.

## Atomic commits

Each successful fix is a single commit. Commit messages follow the template
above so `/loom-git cleanup` can group them. Failed patches are reverted
before the next iteration.

## Fix archiving

Every fixed finding is archived to `.loom/fix-archive/{date}-{slug}.toon`
(schema: `protocols/fix-archive.schema.md`) — the same archive `/loom-bugfix`
writes, so `/loom-learn` queries and future bugfix runs see qa-loop fixes
too. Archive after the commit succeeds; include page, ref, symptom,
confidence, and commitSha.

## Non-goals

- No load / performance testing (that's `/loom-benchmark`, M-08 F-27).
- No security scanning (that's `/loom-cso`, F-19).
- No visual design review (that's `/loom-design (consultation|html|shotgun)`, M-13).

## Loom conventions

<!-- @loom-include: protocols/skill-preamble.md -->

Loom platform conventions (TOON on disk, atomic writes, AgentResult envelope,
confidence scoring, model resolution, init guard) apply to this skill **by
reference** via the directive above — see `protocols/skill-preamble.md`. They
are not re-inlined here.

## Beyond upstream (vs gstack)

Health-gated fix loop: every patch must pass `/loom-health --quick` without
regression before its atomic commit, the run emits a `shipReadiness` verdict
from the before/after health delta, and fixes are archived to
`.loom/fix-archive/` for `/loom-learn`. gstack's live-QA loop has no health
gate, ship-readiness signal, or fix archive.

## Backing & enforcement

- **Backing:** the `/loom-browser` daemon (`skills/loom-browser`),
  `scripts/loom-health.ts` (the health gate), and `agents/fixer-agent.md`.
- **Behavioral tests:** `tests/backfill/loom-browser-daemon.test.ts` covers the
  daemon dependency; `tests/backfill/loom-health.test.ts` covers the health gate.
- **Enforcement:** `/loom-qa` refuses to run without a live `/loom-browser`
  daemon (exit non-zero), demonstrated by `tests/backfill/loom-browser-daemon.test.ts`.
