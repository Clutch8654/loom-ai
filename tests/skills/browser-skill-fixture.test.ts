/**
 * Browser-skill convention test (C-04, protocols/browser-skill.schema.md).
 *
 * Validates that the reference browser-skill under
 * skills/browser-skills/extract-product-listing/ conforms to the fixture-tested
 * convention:
 *   - the required layout (SKILL.md + script.ts + fixtures/ + script.test.ts),
 *   - BrowserSkill frontmatter (pure: true, throwsOnMissing: true, ...),
 *   - a parser that is pure over captured HTML and THROWS on a missing target.
 *
 * Everything here runs OFFLINE — no Chromium, no network, no daemon.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseProductListing,
  ProductParseError,
} from "../../skills/browser-skills/extract-product-listing/script";

const SKILL_DIR = join(
  __dirname,
  "..",
  "..",
  "skills",
  "browser-skills",
  "extract-product-listing",
);

function frontmatter(md: string): Record<string, string> {
  const match = md.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error("SKILL.md has no frontmatter block");
  const out: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z]+):\s*(.+)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

describe("browser-skill convention — layout completeness", () => {
  it("has all four required layout members", () => {
    expect(existsSync(join(SKILL_DIR, "SKILL.md"))).toBe(true);
    expect(existsSync(join(SKILL_DIR, "script.ts"))).toBe(true);
    expect(existsSync(join(SKILL_DIR, "fixtures", "captured.html"))).toBe(true);
    expect(existsSync(join(SKILL_DIR, "script.test.ts"))).toBe(true);
  });
});

describe("browser-skill convention — BrowserSkill metadata", () => {
  const fm = frontmatter(readFileSync(join(SKILL_DIR, "SKILL.md"), "utf8"));

  it("declares name, description, capturedFrom, parserEntry, testFile", () => {
    expect(fm.name).toBe("extract-product-listing");
    expect(fm.description.length).toBeGreaterThan(0);
    expect(fm.capturedFrom.length).toBeGreaterThan(0);
    expect(fm.parserEntry).toBe("script.ts");
    expect(fm.testFile).toBe("script.test.ts");
  });

  it("asserts purity and throws-on-missing", () => {
    expect(fm.pure).toBe("true");
    expect(fm.throwsOnMissing).toBe("true");
  });
});

describe("browser-skill convention — parser behavior over the fixture", () => {
  const html = readFileSync(join(SKILL_DIR, "fixtures", "captured.html"), "utf8");

  it("extracts typed rows offline", () => {
    const rows = parseProductListing(html);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({
      sku: "SKU-1001",
      name: "Aeron Task Chair",
      priceCents: 139500,
      currency: "USD",
    });
  });

  it("throws (not returns empty) when the target selector is absent", () => {
    const mutated = html.replace(/class="product-list"/, 'class="catalog-grid"');
    expect(() => parseProductListing(mutated)).toThrow(ProductParseError);
  });
});
