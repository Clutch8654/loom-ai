import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseProductListing,
  ProductParseError,
  type ProductRow,
} from "./script";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "fixtures", "captured.html");

function loadFixture(): string {
  // Reading the fixture file is the ONLY I/O in the test harness. The parser
  // under test receives a plain string — zero network, zero daemon, zero fs.
  return readFileSync(FIXTURE, "utf8");
}

describe("extract-product-listing (pure parser over captured HTML)", () => {
  it("parses the captured listing into typed rows OFFLINE", () => {
    const rows: ProductRow[] = parseProductListing(loadFixture());
    expect(rows).toEqual([
      { sku: "SKU-1001", name: "Aeron Task Chair", priceCents: 139500, currency: "USD" },
      { sku: "SKU-1002", name: "Embody Chair", priceCents: 179550, currency: "USD" },
      { sku: "SKU-1003", name: "Sayl Chair", priceCents: 69500, currency: "USD" },
      { sku: "SKU-1004", name: "Cosm High-Back", priceCents: 109599, currency: "USD" },
    ]);
  });

  it("THROWS (not returns empty) when the target selector is absent", () => {
    // Mutated fixture: rename the container class so `ul.product-list` is gone.
    // A correct parser must error loudly, never silently return [].
    const mutated = loadFixture().replace(
      /class="product-list"/,
      'class="catalog-grid"',
    );
    expect(() => parseProductListing(mutated)).toThrow(ProductParseError);
    expect(() => parseProductListing(mutated)).toThrow(/not found/i);
  });

  it("THROWS when the container is present but has zero product items", () => {
    const emptied = loadFixture().replace(
      /<ul class="product-list"[^>]*>[\s\S]*?<\/ul>/,
      '<ul class="product-list"></ul>',
    );
    expect(() => parseProductListing(emptied)).toThrow(ProductParseError);
    expect(() => parseProductListing(emptied)).toThrow(/zero/i);
  });

  it("THROWS on empty input", () => {
    expect(() => parseProductListing("")).toThrow(ProductParseError);
  });
});
