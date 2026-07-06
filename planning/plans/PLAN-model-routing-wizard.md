---
title: Abstracted Model Routing Wizard
status: draft
version: 2
created: 2026-07-04
source: .plan-execution/notes.toon#note-001
roadmapRef: null
totalWaves: 4
---

# PLAN: Abstracted Model Routing Wizard

## Overview

Make Loom's model routing **authorable and per-agent overridable** without hand-editing
agent frontmatter or duplicating resolution prose across command files.

Today `[settings.profiles.<name>]` blocks in `.claude/orchestration.toml` map the five
tiers (`planning`, `execution`, `review`, `verification`, `utility`) to model aliases,
and resolution priority is: **profile tier mapping → agent `.md` frontmatter `model:` →
inherit parent**. Three gaps (from note-001):

1. **No authoring wizard.** `/loom-profile` only views/switches; there is no
   `/loom-profile create`. Authoring a profile means hand-editing TOML.
2. **No per-agent override.** Overriding one agent means editing its frontmatter. There
   is no way to say "execution tier is opus, but `implementer-agent` specifically is
   sonnet" without touching the agent file.
3. **Resolution logic is prose, not code.** Each spawning command re-derives resolution
   from its own "Model Resolution" section — **8 command files** carry this contract
   (`loom-plan`, `loom-code`, `loom-roadmap`, `loom-converge`, `loom-auto`, and the 3
   `loom-auto/links/*`). Extending resolution means editing every one, or factoring the
   contract into a single shared protocol they all read. This is the real cost.

**Design principle:** the lightest existing change (add a project `[settings.profiles.<name>]`
block + point `modelProfile` at it) already works with zero code. This plan does NOT
replace that path — it adds authoring ergonomics and a per-agent override layer on top,
and pays down the prose-duplication debt so future routing changes are one-file edits.

## Tech Stack / Conventions

- Config: `.claude/orchestration.toml` (`[settings]`, `[settings.profiles.*]`) — TOML per
  house convention (config files stay native format; see CLAUDE.md TOON exceptions).
- New schemas/protocols: **TOON** per CLAUDE.md.
- Tooling: bun/bunx, vitest.
- Resolution contract currently lives in command `.md` prose (8 files).

## Wave Map

W0 contracts → W1 shared resolution protocol + retrofit the 8 command files →
W2 per-agent `[settings.modelOverrides]` ∥ `/loom-profile create` wizard (no shared files)
→ W3 tests + docs.

Milestone acceptance: a project can author a named profile via wizard, pin a single agent
to a different model via `[settings.modelOverrides]`, and every spawning command resolves
identically because they all read one protocol — proven by a shared resolution test suite.

---

### Phase 0 — Wave 0: Contracts — resolution schema + shared protocol skeleton

**Agent:** contracts-agent
**Objective:** Freeze the config shapes and the single resolution contract every later
phase and command depends on, so the retrofit and override work never negotiate shape
mid-flight.
**Dependencies:** none
**File Ownership:** protocols/model-resolution.schema.md, protocols/model-resolution.md (skeleton)

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| protocols/model-resolution.schema.md | Create | contracts |
| protocols/model-resolution.md | Create (skeleton — the canonical resolution algorithm) | contracts |

Schema (TOON) must define: `ModelProfile` (name + 5 tier→alias fields), `ModelOverride`
(`agent`, `model`), `[settings.modelOverrides]` table shape, and the **frozen resolution
priority order** (highest wins): `modelOverrides[agent]` → `profiles[modelProfile].<tier>`
→ agent frontmatter `model:` → inherit parent.

#### Acceptance Criteria
- [ ] `protocols/model-resolution.schema.md` defines ModelProfile, ModelOverride, and the modelOverrides table in TOON.
- [ ] `protocols/model-resolution.md` states the canonical resolution algorithm as an ordered, testable contract (the single source of truth the 8 commands will reference).
- [ ] Resolution order places per-agent override ABOVE tier mapping.

#### Convergence Targets
- The two protocol files exist and are internally consistent (override > tier > frontmatter > parent).

---

### Phase 1 — Wave 1: Factor resolution into one protocol + retrofit the 8 commands

**Agent:** wiring-agent
**Objective:** Replace the duplicated "Model Resolution" prose in all 8 spawning command
files with a reference to `protocols/model-resolution.md`, eliminating drift risk. This is
the debt paydown for note-001 item 3.
**Dependencies:** Phase 0
**File Ownership:** commands/loom-plan.md, commands/loom-code.md, commands/loom-roadmap.md, commands/loom-converge.md, commands/loom-auto.md, commands/loom-auto/links/fix.md, commands/loom-auto/links/execute.md, commands/loom-auto/links/verify.md, protocols/model-resolution.md

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| protocols/model-resolution.md | Modify (finalize algorithm incl. override layer) | wiring |
| commands/loom-plan.md + 7 others | Modify (replace inline prose with a pointer to the protocol) | wiring |

#### Acceptance Criteria
- [ ] Each of the 8 command files references `protocols/model-resolution.md` for resolution instead of restating the algorithm inline.
- [ ] No command file contradicts the protocol's ordering (grep for divergent "Resolution priority" wording → zero conflicts).
- [ ] Behavior is unchanged for existing profiles (regression: a spawn under `quality` still resolves execution→opus).

#### Convergence Targets
- Single source of truth: changing resolution order requires editing exactly one protocol file.

#### Scenarios
```toon
id: S-01
title: One protocol governs all spawning commands
given[1]: The 8 command files now reference protocols/model-resolution.md
when: A resolution-order change is made in the protocol
then[1]: All 8 commands resolve by the new order with no per-file edits
tags[1]: regression
automatable: true
```

---

### Phase 2 — Wave 2: Per-agent overrides — [settings.modelOverrides]

**Agent:** implementer-agent
**Objective:** Add a `[settings.modelOverrides]` table keyed by agent name that beats the
tier mapping, so a single agent can be pinned to a different model without editing its
frontmatter (note-001 item 2).
**Dependencies:** Phase 1
**File Ownership:** protocols/model-resolution.md (modelOverrides section), .claude/orchestration.toml (add commented example block), tests/protocols/model-resolution.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| protocols/model-resolution.md | Modify (document override lookup + precedence) | implementer |
| .claude/orchestration.toml | Modify (add a commented `[settings.modelOverrides]` example) | implementer |
| tests/protocols/model-resolution.test.ts | Create (resolution truth table incl. override cases) | implementer |

#### Acceptance Criteria
- [ ] `[settings.modelOverrides]` with `implementer-agent = "sonnet"` under a `quality` (execution=opus) profile resolves `implementer-agent` to sonnet and all other execution agents to opus.
- [ ] An absent override falls through to the tier mapping unchanged.
- [ ] The resolution test suite encodes the full precedence truth table (override > tier > frontmatter > parent) and passes.

#### Convergence Targets
- A single agent can be re-pinned with a one-line TOML edit, no agent-file change.

#### Scenarios
```toon
id: S-01
title: Per-agent override beats tier mapping
given[1]: profile quality maps execution to opus and modelOverrides pins implementer-agent to sonnet
when: the executor resolves the model for implementer-agent
then[1]: it resolves to sonnet while other execution-tier agents resolve to opus
tags[1]: happy-path
automatable: true
```

---

### Phase 3 — Wave 2: /loom-profile create wizard

**Agent:** implementer-agent
**Objective:** Add a `create` subcommand to `/loom-profile` — a guided interview that
writes a new `[settings.profiles.<name>]` block to `.claude/orchestration.toml`, analogous
to how `/loom-agent create` scaffolds agents (note-001 item 1). Runs parallel to Phase 2
(no shared files).
**Dependencies:** Phase 1
**File Ownership:** commands/loom-profile.md, commands/loom-profile/create.md, tests/commands/loom-profile-create.test.ts

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| commands/loom-profile.md | Modify (dispatch `create` subcommand) | implementer |
| commands/loom-profile/create.md | Create (interview → writes profile block) | implementer |
| tests/commands/loom-profile-create.test.ts | Create (fixture: interview answers → correct TOML block) | implementer |

#### Acceptance Criteria
- [ ] `/loom-profile create` interviews for the 5 tier→alias mappings and writes a valid `[settings.profiles.<name>]` block via atomic write (`.tmp` then rename).
- [ ] The wizard refuses to overwrite an existing profile name without confirmation, and validates aliases against known model ids (rejects `fable` with the note-per-memory rationale surfaced, or at least warns).
- [ ] Round-trip: a generated block parses and is selectable via `/loom-profile` switch.

#### Convergence Targets
- A new profile is authorable end-to-end without hand-editing TOML.

#### Scenarios
```toon
id: S-01
title: Wizard authors a valid profile
given[1]: the user runs /loom-profile create and answers the tier prompts
when: the wizard writes the profile block
then[1]: orchestration.toml gains a valid [settings.profiles.<name>] block selectable by modelProfile
tags[1]: happy-path
automatable: true
```

---

### Phase 4 — Wave 3: Tests convergence + full docs

**Agent:** implementer-agent
**Objective:** Prove the three surfaces interoperate and document them to Loom's docs bar
(a full README section per surface — not a table row; per the "docs keep pace" convention).
**Dependencies:** Phase 2, Phase 3
**File Ownership:** tests/integration/model-routing.test.ts, README.md (Model Routing section), CLAUDE.md (Context Management → model resolution pointer)

#### Deliverables
| File | Action | Owner hint |
|------|--------|------------|
| tests/integration/model-routing.test.ts | Create (wizard-authored profile + override resolve consistently across a sample command) | implementer |
| README.md | Modify (full "Model Routing" section: profiles, overrides, wizard, resolution order) | implementer |
| CLAUDE.md | Modify (point the Agent Conventions "model resolution is mandatory" note at protocols/model-resolution.md) | implementer |

#### Acceptance Criteria
- [ ] Integration test: a profile authored by the wizard, plus a `[settings.modelOverrides]` entry, resolves identically whether invoked via the protocol directly or via a spawning command's reference.
- [ ] README gains a complete Model Routing section covering all three surfaces + the resolution order, with a worked example.
- [ ] CLAUDE.md's model-resolution mandate references the single protocol.

#### Convergence Targets
- End-to-end: author profile → pin an agent → every command resolves consistently, documented.

---

## Risks

| Risk | Phases | Detection | Mitigation |
|------|--------|-----------|------------|
| Retrofit silently changes resolution for an existing profile | 1 | Regression test: `quality` still resolves execution→opus | Phase 1 ships the resolution test (Phase 2 deliverable pulled forward if needed) before editing command prose |
| Override precedence ambiguity (override vs frontmatter vs tier) | 0, 2 | Truth-table test fails | Freeze order in Phase 0 schema; encode every cell in tests/protocols/model-resolution.test.ts |
| Wizard writes malformed TOML | 3 | Round-trip parse fails | Atomic write + parse-back validation before commit; refuse on validation failure |
| Docs drift from behavior | 4 | Integration test + README worked example | Docs phase depends on 2+3; example is executable in the integration test |
