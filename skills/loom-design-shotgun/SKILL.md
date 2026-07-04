---
name: loom-design-shotgun
description: "Parallel UI variants — generate N design candidates, render side-by-side, capture preference, decay old preferences so system doesn't ossify."
---

# /loom-design shotgun — Parallel UI Variant Board (M-13 F-24)

`/loom-design shotgun` fires off N distinct visual approaches to the
same UI target in parallel, renders them side-by-side, captures the
user's preference, and folds that preference back into a
time-decaying **taste memory** so future sessions bias toward what the
user likes without ever fully locking in.

## Input

Prose description of the target UI (a component, a page, or a full
screen). Optionally: `--n <count>` (default 4) and `--slug <identifier>`.

## Variant generation

Generate **N variants** (default 4). Each variant MUST represent a
distinct visual approach, not a color swap on a single layout. Suggested
starting axes:

- Minimalist (heavy whitespace, single typeface, no chrome)
- Dense (information-forward, tight rhythm, functional)
- Brutalist (raw, high-contrast, unapologetic system fonts)
- Editorial (magazine-style hierarchy, serif display, generous measure)

The generator MAY introduce other axes if the target UI calls for them
(e.g. "playful illustrated" for a marketing hero). Never ship two
variants on the same axis.

Each variant is a self-contained HTML file with inline or co-located
CSS, emitted via the F-23 pipeline so it inherits the reflow-native
rules and anti-slop guards.

## Rendering side-by-side

Preferred: hand off to the `/loom-browser` daemon (M-11) which opens
each variant in a tab and arranges them side-by-side for comparison.

Fallback (if the daemon is stopped, crashed, or absent): write each
variant to `.loom/design/shotgun/{slug}/variant-{n}.html` and print the
list of file paths so the user can open them manually. Do NOT fail the
command — the fallback is a first-class code path.

## Preference capture

When the user selects a preferred variant, append a record to
`.loom/design/preferences.toon`. The write is atomic (`.tmp` + rename).

Schema: `protocols/design-preferences.schema.toon` (includes the
normative time-decay math below).

Every preference record includes a `capturedAt` ISO-8601 timestamp —
this is a hard acceptance criterion for F-24. The record also carries
the slug, the winning variant number, the axis label of the winner, and
the axes of every rejected variant (so the decay layer can learn what
the user consistently avoids).

## Time decay

Preferences do not accumulate forever. On every read:

- Preferences **older than 90 days** are weight-reduced (multiply the
  contribution by `0.5 ^ ((ageDays - 90) / 30)`).
- Preferences **older than 180 days** drop out of active influence and
  are archived (retained on disk for provenance; excluded from the
  generation prompt).

Decay guarantees the taste memory adapts as the user's own taste
evolves; the system must not ossify.

## Session bias

At the start of a new `/loom-design shotgun` invocation, read
`.loom/design/preferences.toon`, apply the decay, and use the
surviving weighted preferences to bias variant generation. The bias is
a **soft** input to the axis-selection step — the generator still MUST
produce distinct axes, so a strong past preference for "minimalist"
does not force all four variants to be minimalist.

## Anti-slop guards

- No variant may be a trivial recolor of another.
- No variant may violate the reflow-native rules (F-23).
- If fewer than N distinct axes are available for the target UI,
  reduce N rather than duplicating.

## See also

- `commands/loom-design/shotgun.md`
- `skills/loom-design-html/SKILL.md`
- `skills/loom-browser/SKILL.md`
- `.loom/design/preferences.toon`

## Loom conventions

<!-- @loom-include: protocols/skill-preamble.md -->

Loom platform conventions (TOON on disk, atomic writes, AgentResult envelope,
confidence scoring, model resolution, init guard) apply to this skill **by
reference** via the directive above — see `protocols/skill-preamble.md`. They
are not re-inlined here.

## Beyond upstream (vs gstack)

Time-decaying taste memory: captured preferences are weight-reduced past 90 days
(`0.5 ^ ((ageDays - 90) / 30)`) and archived out of active influence at 180 days
per `protocols/design-preferences.schema.toon`, so the variant board biases
toward the user's evolving taste without ever locking in. gstack's shotgun
captures a preferred variant but never decays it.

## Backing & enforcement

- **Backing:** `protocols/design-preferences.schema.toon` — the normative decay
  math and the `capturedAt`-required record schema.
- **Behavioral tests:** `tests/skills/review-batch.test.ts` asserts the schema
  defines the decay rule and that this skill cites the shared preamble.
- **Enforcement:** preference records are appended atomically with a required
  `capturedAt` timestamp, and the decay is applied on every read before biasing
  generation.
