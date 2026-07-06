/**
 * extract-product-listing — pure parser for a captured product-listing page.
 *
 * PURITY CONTRACT (protocols/browser-skill.schema.md):
 *   - This module is a PURE function of a captured-HTML string.
 *   - It opens NO socket, spawns NO daemon, reads NO live page, touches NO fs.
 *   - The only input is the `html` argument; the only output is the return value
 *     (or a thrown ProductParseError).
 *
 * THROWS-ON-MISSING CONTRACT:
 *   - When the target selector (`ul.product-list`) is absent from the HTML, the
 *     parser THROWS ProductParseError — it does NOT return an empty array. A
 *     silently-empty result would let a page redesign pass unnoticed; a throw
 *     turns that into a loud, testable failure.
 */

export interface ProductRow {
  /** Stock-keeping unit from the item's `data-sku` attribute. */
  sku: string;
  /** Display name from `.product-name`. */
  name: string;
  /** Price in integer cents (avoids float drift). */
  priceCents: number;
  /** ISO-ish currency code inferred from the price glyph (`$` → USD). */
  currency: string;
}

/** Thrown when the captured HTML does not match the expected page shape. */
export class ProductParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductParseError";
  }
}

/** The container selector this parser is pinned to. */
export const PRODUCT_LIST_SELECTOR = "ul.product-list";

function findProductListInner(html: string): string {
  const match = html.match(
    /<ul\b[^>]*\bclass="[^"]*\bproduct-list\b[^"]*"[^>]*>([\s\S]*?)<\/ul>/i,
  );
  if (!match) {
    throw new ProductParseError(
      `target selector "${PRODUCT_LIST_SELECTOR}" not found in captured HTML — ` +
        `the page shape changed or the wrong page was captured`,
    );
  }
  return match[1];
}

function extractItems(inner: string): string[] {
  const items: string[] = [];
  const re = /<li\b[^>]*\bclass="[^"]*\bproduct\b[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(inner)) !== null) {
    items.push(match[0]);
  }
  return items;
}

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`, "i"));
  return match ? match[1] : null;
}

function textByClass(fragment: string, className: string): string | null {
  const re = new RegExp(
    `<[a-z0-9]+\\b[^>]*\\bclass="[^"]*\\b${className}\\b[^"]*"[^>]*>([\\s\\S]*?)</[a-z0-9]+>`,
    "i",
  );
  const match = fragment.match(re);
  if (!match) return null;
  return match[1].replace(/<[^>]+>/g, "").trim();
}

function parsePrice(raw: string): { priceCents: number; currency: string } {
  const glyph = raw.trim().charAt(0);
  const numeric = raw.replace(/[^0-9.]/g, "");
  const value = Number.parseFloat(numeric);
  if (!Number.isFinite(value)) {
    throw new ProductParseError(`unparseable price: ${JSON.stringify(raw)}`);
  }
  return {
    priceCents: Math.round(value * 100),
    currency: glyph === "$" ? "USD" : glyph,
  };
}

/**
 * Parse a captured product-listing page into typed rows.
 *
 * @param html - captured HTML string (from a loom-browser READ, saved to a fixture)
 * @returns one ProductRow per `<li class="product">` inside `ul.product-list`
 * @throws ProductParseError when the container selector is absent, when the
 *         list has zero items, or when an item is missing a required field.
 */
export function parseProductListing(html: string): ProductRow[] {
  if (typeof html !== "string" || html.length === 0) {
    throw new ProductParseError("empty HTML input");
  }

  const inner = findProductListInner(html);
  const items = extractItems(inner);
  if (items.length === 0) {
    throw new ProductParseError(
      `zero <li class="product"> items inside ${PRODUCT_LIST_SELECTOR}`,
    );
  }

  return items.map((item, index) => {
    const sku = attr(item, "data-sku");
    const name = textByClass(item, "product-name");
    const priceRaw = textByClass(item, "price");
    if (!sku) throw new ProductParseError(`item ${index} missing data-sku`);
    if (!name) throw new ProductParseError(`item ${index} missing .product-name`);
    if (!priceRaw) throw new ProductParseError(`item ${index} missing .price`);
    const { priceCents, currency } = parsePrice(priceRaw);
    return { sku, name, priceCents, currency };
  });
}

export default parseProductListing;
