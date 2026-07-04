---
description: "Shared preamble prelude cited by reference from every Loom skill SKILL.md — the single source for the conventions every skill repeats (TOON output, atomic writes, exit codes, AgentResult, confidence, model resolution, init guard)."
---

<!--
  Shared skill-preamble prelude for every Loom skill (`skills/<name>/SKILL.md`).

  A skill MUST embed this preamble BY REFERENCE — it cites the include
  directive (see "## Include directive" below) instead of pasting the
  preamble text into its own body. This is the skill-side analogue of the
  command-side `commands/_loom-init-guard.md` shared include: one
  authoritative copy, cited by path, so the ~700–800 lines of preamble
  boilerplate that would otherwise be duplicated across every skill live
  here once.

  DO NOT modify the canonical preamble text between the
  LOOM:SKILL-PREAMBLE:BEGIN / LOOM:SKILL-PREAMBLE:END markers below.
  Tests assert on it byte-for-byte:
    tests/skills/preamble-resolution.test.ts — resolves this block and
    verifies fixture skills cite it by reference with no inline copy.

  The markers are load-bearing: the resolver extracts everything strictly
  between the BEGIN and END marker lines (exclusive) as the canonical
  preamble. Keep the markers on their own lines.
-->

# Skill Preamble Prelude

Every Loom skill body cites this prelude once, by path, near the top of its
`SKILL.md` — before describing its own subcommands, inputs, or outputs. The
skill does NOT inline the text below; it cites the include directive so the
conventions stay authoritative in this one file.

## Include directive

A skill embeds the preamble by placing the canonical include directive on its
own line in the skill body:

```
<!-- @loom-include: protocols/skill-preamble.md -->
```

The directive is a cite-by-path reference (exactly like command bodies citing
`commands/_loom-init-guard.md`). At load time the resolver replaces the
directive with the canonical preamble text extracted from this file. The skill
body itself never contains a second, inlined copy of the preamble.

<!-- LOOM:SKILL-PREAMBLE:BEGIN -->
## Loom skill conventions

This skill follows the Loom platform conventions. They are authoritative in
`protocols/skill-preamble.md`; this preamble is resolved by reference, not
inlined.

1. **TOON everywhere.** Every on-disk artifact, state file, progress or
   heartbeat file, and inter-agent message this skill reads or writes uses
   TOON (Token-Oriented Object Notation). Native formats are reserved for the
   CLAUDE.md exceptions only (app data being compared, standard tooling config
   such as `package.json` / `orchestration.toml`, and Claude Code hook
   stdin/stdout). See `protocols/toon-format.md`.

2. **Atomic writes.** Never write an artifact in place. Write to
   `{path}.tmp`, then `fs.renameSync` (or the shell `mv`) to `{path}`. A
   reader must never observe a half-written file.

3. **Exit codes.** Map every exit onto the canonical convention: `0` success
   (including "completed with non-blocking warnings"), `1` gate failure /
   findings detected, `2` usage or configuration error, `3+` skill-specific
   (registered in `protocols/exit-codes.md`). Named error codes are
   `UPPER_SNAKE` and registered in that same file.

4. **AgentResult envelope.** When this skill spawns a pipeline-participant
   agent, that agent returns a standard AgentResult envelope in TOON as the
   last block of its response — status, filesCreated, filesModified, exports,
   issues, integration notes. See `protocols/agent-result.schema.md`.

5. **Confidence semantics.** Every finding this skill or its agents emit
   carries `confidence: 1-10`. Gates filter by a confidence floor; low-floor
   deep scans keep more. Absent or out-of-range confidence is a validation
   defect.

6. **Model resolution is mandatory.** Before any Agent spawn, resolve the
   target agent's model — (1) `orchestration.toml` profile tier, (2) agent
   frontmatter `model:`, (3) inherit parent — and pass `model: "{value}"` on
   the call. Never spawn without resolving the model first.

7. **Init guard.** When invoked through a `/loom-*` command, this skill runs
   behind the shared init guard (`commands/_loom-init-guard.md`): it performs
   no project-state mutation until Loom is initialized in the project.
<!-- LOOM:SKILL-PREAMBLE:END -->

## Reference implementation

- Source of truth: `protocols/skill-preamble.md` (this file).
- Canonical include directive: `<!-- @loom-include: protocols/skill-preamble.md -->`.
- Extraction markers: `LOOM:SKILL-PREAMBLE:BEGIN` / `LOOM:SKILL-PREAMBLE:END`.
- Tests: `tests/skills/preamble-resolution.test.ts`.
- Sibling pattern (command side): `commands/_loom-init-guard.md`.
- Registered under `library.protocols:` in `skills/library.yaml` as
  `skill-preamble`.

## Why by-reference

Inlining the preamble into every `SKILL.md` would duplicate ~700–800 lines of
identical boilerplate across the skill catalog and let copies drift out of
sync. Citing the include keeps one authoritative, byte-stable copy — the same
discipline `commands/_loom-init-guard.md` established for command bodies — and
is the foundation later skill-batch phases build on.
