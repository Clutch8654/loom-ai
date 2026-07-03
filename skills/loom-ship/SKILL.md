---
name: loom-ship
description: "Pre-flight rebase-from-base + drift detection + VERSION-slot reservation + plan-completion audit inline in PR body. Chief ship-engineer skill."
---

# /loom-ship — Chief Ship Engineer (M-10 F-30)

`/loom-ship` is the single, opinionated pre-PR command. It rebases onto base,
picks a free VERSION slot, audits the plan's deliverables against the diff,
and opens the PR with all of that inline in the body — no manual pre-flight,
no forgotten audit sections, no VERSION collisions across sibling worktrees.

## Six steps

Each step MUST run in order. Later steps depend on earlier ones. Halt on any
hard failure (see per-step semantics).

### Step 1 — Rebase current branch onto base branch

- Read the base branch from `.claude/orchestration.toml` under
  `[worktree] baseBranch`, falling back to `main`.
- Fetch: `git fetch origin ${baseBranch}`.
- Rebase: `git rebase origin/${baseBranch}`.
- On conflict: halt with a `SHIP_REBASE_CONFLICT` finding
  (confidence: 10, severity: blocker), listing the conflicted paths.
  The user resolves; `/loom-ship` is re-run.

### Step 2 — VERSION-slot detection and reservation

- Invoke `bunx tsx scripts/loom-version-slot.ts next --bump patch` (default)
  to compute the next free semver slot given the current
  `package.json.version` / `pyproject.toml [project] version` / `VERSION`.
- Update the appropriate manifest with the chosen slot (single-source-of-truth
  is whichever file already carried the version — never introduce a new one).
- Invoke `bunx tsx scripts/loom-version-slot.ts reserve <version>` to record
  the claim in `~/.loom/version-slots.toon` per
  `protocols/version-slot.schema.toon`.
- Emit a `SlotReserved` finding for the PR body (confidence: 9).

### Step 3 — Drift detection against base

- Read the merge-base commit that this branch was created from
  (`git merge-base HEAD origin/${baseBranch}`).
- Compute `git rev-list --count <merge-base>..origin/${baseBranch}` — the
  count of base commits since divergence.
- If the count is 0, no drift; continue.
- If > 0 and Step 1's rebase already brought them in, note it as
  informational.
- If > 0 AND the rebase failed to bring them in (e.g., shallow clone), emit
  a `SHIP_DRIFT_UNRESOLVED` finding (confidence: 8, severity: warn) and
  halt.

### Step 4 — Plan-completion audit

- Locate the active plan via `.plan-execution/state.toon → planFile`. Fall
  back to `planning/plans/PLAN-*.md` if state is absent.
- Extract every checkbox deliverable from the plan's "Deliverables" and
  "Acceptance Criteria" blocks. Cap at 50 items — the ledger is a spot-check,
  not a full audit.
- Classify each item:
  | Class | Meaning | Verification signal |
  |---|---|---|
  | `DIFF-VERIFIABLE` | Change is visible in `git diff <base>...HEAD` | file+symbol grep against the diff |
  | `CROSS-REPO` | Landing requires a change in another repo/worktree | note the target, skip |
  | `EXTERNAL-STATE` | Depends on a service (DNS, KV, secret) | note the state, skip |
  | `CONTENT-SHAPE` | Textual/structural (README section exists, TOON row shape) | grep against the diff |
- Reconcile each classified item against the diff:
  - `DIFF-VERIFIABLE` / `CONTENT-SHAPE`: mark `verified: true` when a
    grep hit exists; otherwise `verified: false` with a suggested owner note.
  - `CROSS-REPO` / `EXTERNAL-STATE`: mark `verified: n/a` with a manual
    checklist entry for the reviewer.
- Emit the ledger as a `plan-completion` table in the PR body.

### Step 5 — Generate PR body markdown

- Assemble:
  1. **Summary** — 1-3 sentences derived from the plan objective and the
     top-level diff shape.
  2. **Plan Completion Ledger** — the Step 4 audit rendered as a markdown
     table (`item | class | verified | note`).
  3. **Test Plan** — checkbox list read from PLAN.md → "Verification" section
     (or generated from acceptance criteria when absent).
  4. **Doc Debt** — invoke `/loom-docs release --dry-run` if it is
     registered in this project (`--dry-run` runs every phase, writes
     nothing, always exits 0 — this step consumes findings, it is not gated
     by them). If it emits `DOC_DEBT` findings, embed them. If /loom-docs
     release is not registered, omit the section (no fake "None" line —
     silence is meaningful).
  5. **Version** — the reserved semver + a link to
     `~/.loom/version-slots.toon`.

### Step 6 — Open the PR

- `gh pr create --base ${baseBranch} --head <currentBranch> --title "<title>"
  --body-file <(...)`. Title comes from the top plan objective, prefixed with
  the milestone id when available (e.g., `feat(M-10): ship engineer`).
- On `gh` auth failure or missing `gh`: halt with `SHIP_GH_MISSING`
  (confidence: 10, severity: blocker) and print the assembled body so the
  user can paste it manually.

### Step 7 — Suggest the retro

After the PR is created, count merges since the newest entry in
`.loom/learnings.toon` (a missing file counts as "never retro'd"). If ≥ 5
merges or ≥ 1 completed milestone have landed since then, append to the
final envelope:

```
Next: /loom-retro
```

A suggestion line, not an auto-invocation — the retro interview needs the
operator present. It exists because ship→retro is the link that closes the
build→learn loop; without the nudge, retros only happen when someone
remembers.

## Non-goals

- `/loom-ship` does **NOT** run tests, lint, or security scans. Those are
  `/loom-test`, project lint runners, and `/loom-cso daily`. Bake them into
  `/loom-git pr` or the PR pipeline if you want them enforced pre-ship.
- `/loom-ship` does **NOT** deploy. Deploy is `/loom-canary` (M-10 F-31).
- `/loom-ship` does **NOT** mutate native deploy configs (fly.toml,
  vercel.json, etc.) per C-06.

## Outputs

- Updated version manifest (`package.json` / `pyproject.toml` / `VERSION`).
- Refreshed `~/.loom/version-slots.toon` with the new reservation.
- A GitHub PR whose body carries the ledger + test plan + doc debt.
- An `AgentResult` TOON envelope with per-step findings each carrying
  `confidence: 1-10`.

## Contracts

- `protocols/version-slot.schema.toon` — slot-registry format.
- `protocols/loom-ship-config.schema.toon` — deploy target hint (read by
  Step 6 when a deploy footer is desired).
- `protocols/agent-result.schema.md` — return envelope.

## See also

- `commands/loom-ship.md` — dispatcher.
- `scripts/loom-version-slot.ts` — slot-registry runtime.
- `skills/loom-canary/SKILL.md` — post-merge phased deploy.
- `skills/loom-landing-report/SKILL.md` — cross-workspace slot dashboard.
