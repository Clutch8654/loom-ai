# BrowserSkill Schema (C-04)

Defines the metadata and directory convention for a **fixture-tested browser-skill** — the codify pattern established on `loom-skillify` (P7) and adopted from gstack. A browser-skill's parser is a **pure function over captured HTML**: zero network, zero daemon, deterministic. This makes browser-derived extraction logic unit-testable offline and CI-safe.

This is a **contract-only** document (Wave 0). The reference skill and the `loom-skillify` codify-scrape section ship in P7.

Schema examples use TOON per the project convention.

---

## Directory layout convention

A browser-skill lives under `skills/browser-skills/{skill-name}/` with exactly this layout:

```
skills/browser-skills/{skill-name}/
  SKILL.md            # skill definition + frontmatter (the BrowserSkill metadata below)
  script.ts           # the pure parser: (html: string) => Result — NO network, NO daemon
  fixtures/
    captured.html     # real HTML captured once from the target page
  script.test.ts      # vitest: runs script.ts over fixtures/, asserts extraction; offline
```

This layout is a **new convention**, explicitly distinct from `loom-skillify`'s existing `scripts/skillified/` output path (P7 documents the distinction).

### Parser purity contract

- `script.ts` exports a pure function of captured HTML. It MUST NOT open a socket, spawn the daemon, or read live pages.
- On a missing target (e.g. the selector is absent in the HTML) the parser MUST **throw / error**, NOT return silently empty. A mutated-fixture test case asserts this (P7 AC).
- `script.test.ts` runs the parser over `fixtures/captured.html` and passes **offline** (`bunx vitest run skills/browser-skills/` exits 0 with no browser).

---

## BrowserSkill metadata schema

The `SKILL.md` frontmatter (and the `BrowserSkill` type in `lib/types.ts`) carries:

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | yes | kebab-case skill id; unique in the catalog. Matches the directory name. |
| description | string | yes | What the skill extracts and from which kind of page. |
| capturedFrom | string | yes | Source URL or page description the `fixtures/captured.html` was captured from (provenance). |
| parserEntry | string | yes | Path to the pure parser, relative to the skill dir. Conventionally `script.ts`. |
| fixtureFiles | string[] | yes | Captured HTML fixtures under `fixtures/` (≥1). |
| testFile | string | yes | Path to the vitest file. Conventionally `script.test.ts`. |
| pure | boolean | yes | MUST be `true` — asserts zero network/daemon. A `false` value is not a browser-skill. |
| throwsOnMissing | boolean | yes | MUST be `true` — the parser errors (not returns empty) when the target is absent. |

### Example

```toon
browserSkill:
  name: extract-pricing-table
  description: Parses a captured pricing page into {tier,priceMonthly,features[]} rows.
  capturedFrom: https://example.com/pricing
  parserEntry: script.ts
  fixtureFiles[1]: fixtures/captured.html
  testFile: script.test.ts
  pure: true
  throwsOnMissing: true
```

---

## Validation rules

1. **Layout complete.** `SKILL.md`, `script.ts`, `fixtures/` (≥1 file), and `script.test.ts` all present.
2. **Purity.** `pure` MUST be `true`; the parser performs no I/O beyond its input string.
3. **Throws on missing.** `throwsOnMissing` MUST be `true`; a mutated-fixture case proves the parser errors rather than returning silently empty.
4. **Offline test.** `script.test.ts` runs and passes without Chromium or network.
5. **Catalog registration.** The skill is registered under `library.skills:` in `skills/library.yaml` (done in P7, not Wave 0).

---

## Relationship to other schemas

- **browser-command.schema.md** — browser-skills consume HTML that may have been *captured* via a `screenshot`/`dom-query` READ, but the parser itself is pure and issues no BrowserCommands.
- **lib/types.ts** — `BrowserSkill` is declared there (Wave 0).
- **skills/loom-skillify/SKILL.md** — P7 documents the codify-scrape flow that produces browser-skills in this layout.
