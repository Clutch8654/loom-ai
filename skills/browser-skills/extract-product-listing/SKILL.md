---
name: extract-product-listing
description: Parses a captured product-listing page (ul.product-list) into typed {sku,name,priceCents,currency} rows. Reference browser-skill — a pure parser over captured HTML, zero network/daemon.
capturedFrom: Ergonomic-seating catalog category page (ul.product-list region), captured once via a loom-browser READ (dom-query).
parserEntry: script.ts
fixtureFiles:
  - fixtures/captured.html
testFile: script.test.ts
pure: true
throwsOnMissing: true
---

# extract-product-listing (reference browser-skill)

This is the **reference implementation** of the fixture-tested browser-skill
convention (C-04, `protocols/browser-skill.schema.md`). It exists to be copied:
`/loom-skillify`'s codify-scrape flow scaffolds new skills in exactly this shape.

## What it does

Given HTML captured once from a product-listing page, `parseProductListing(html)`
returns one typed row per product:

```toon
rows[4]{sku,name,priceCents,currency}:
  SKU-1001,Aeron Task Chair,139500,USD
  SKU-1002,Embody Chair,179550,USD
  SKU-1003,Sayl Chair,69500,USD
  SKU-1004,Cosm High-Back,109599,USD
```

## The two contracts that make it a browser-skill

1. **Pure over captured HTML.** `script.ts` is a pure function of its `html`
   argument. It opens no socket, spawns no daemon, reads no live page, touches no
   filesystem. This is why `script.test.ts` runs **offline** and CI-safe — no
   Chromium, no network. The only I/O anywhere is the test harness reading
   `fixtures/captured.html` and handing the parser a plain string.

2. **Throws on a missing target — never silently empty.** When `ul.product-list`
   is absent (a page redesign, or the wrong page captured), the parser throws
   `ProductParseError` instead of returning `[]`. A silently-empty result would
   let extraction rot go unnoticed; a throw turns it into a loud, testable
   failure. The mutated-fixture case in `script.test.ts` proves this.

## Layout

```
skills/browser-skills/extract-product-listing/
  SKILL.md            # this file (BrowserSkill metadata frontmatter)
  script.ts           # pure parser: (html: string) => ProductRow[]
  fixtures/
    captured.html     # HTML captured once from the target page
  script.test.ts      # vitest: runs script.ts over the fixture, offline
```

## Run it

```bash
bunx vitest run skills/browser-skills/
```

Exits 0 with no browser and no network.

## Re-capturing the fixture

When the target page changes, re-capture with the loom-browser daemon and
overwrite `fixtures/captured.html`:

```bash
loom-browser start
loom-browser exec dom-query <url> --selector "main.catalog"
# save the returned HTML to fixtures/captured.html, then re-run the test
```

The daemon is used only to **capture** the fixture; the parser and its test
never touch it.
