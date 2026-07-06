/**
 * tests/property/toon-roundtrip.property.test.ts — M-07 F-13 (property tests).
 *
 * Round-trip identity: for ANY generated `ToonValue` v,
 *   parseToon(serializeToon(v))  deep-equals  v.
 *
 * This is the total-over-ToonValue guarantee lib/toon.ts documents, exercised
 * over a wide, randomly-generated input space rather than a handful of hand-
 * picked cases. No property-testing dependency is added — the generator is a
 * small DETERMINISTIC seeded PRNG (mulberry32) plus recursive input builders,
 * so a failure is reproducible (fixed seed, logged iteration).
 *
 * Run: bunx vitest run tests/property/toon-roundtrip.property.test.ts
 */

import { describe, it, expect } from "vitest";
import { parseToon, serializeToon } from "../../lib/index.js";
import type { ToonValue } from "../../lib/index.js";

/** Deterministic 32-bit PRNG (mulberry32) — reproducible across runs. */
function makePrng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Adversarial string pool: empty, whitespace-sensitive, delimiter/quote/escape
 * chars, and bare tokens that would otherwise re-parse as null/boolean/number.
 * Each MUST survive a round-trip as the original string.
 */
const STRING_POOL: readonly string[] = [
  "",
  " ",
  "  padded  ",
  "plain",
  "hello world",
  "with,comma",
  'with"quote',
  "with\\backslash",
  "line\nbreak",
  "tab\ttab",
  "carriage\r\nreturn",
  "colon: value",
  "brackets[0]",
  "trailing-dash-",
  "-",
  "null",
  "true",
  "false",
  "NaN",
  "123",
  "-4.5",
  "1e10",
  "unicode λ ✓ 日本",
  "key: val, other[2]: x",
];

/** Keys: mix of bare-safe and quote-requiring (spaces, commas, quotes, empty). */
const KEY_POOL: readonly string[] = [
  "a",
  "b_1",
  "kebab-key",
  "dotted.key",
  "$dollar",
  "with space",
  "with,comma",
  'with"quote',
  "123numstart",
  "key:colon",
  "",
  "мир",
];

function genScalar(rng: () => number): ToonValue {
  const r = rng();
  if (r < 0.15) return null;
  if (r < 0.3) return rng() < 0.5;
  if (r < 0.55) return Math.floor((rng() - 0.5) * 20000);
  if (r < 0.7) return Math.round((rng() - 0.5) * 2000000) / 1000;
  return STRING_POOL[Math.floor(rng() * STRING_POOL.length)];
}

function genValue(rng: () => number, depth: number): ToonValue {
  if (depth <= 0) return genScalar(rng);
  const r = rng();
  if (r < 0.45) return genScalar(rng);
  if (r < 0.7) {
    const len = Math.floor(rng() * 5); // 0..4
    const arr: ToonValue[] = [];
    for (let i = 0; i < len; i++) arr.push(genValue(rng, depth - 1));
    return arr;
  }
  const count = Math.floor(rng() * 5); // 0..4
  const obj: { [k: string]: ToonValue } = {};
  const used = new Set<string>();
  for (let i = 0; i < count; i++) {
    const key = KEY_POOL[Math.floor(rng() * KEY_POOL.length)];
    if (used.has(key)) continue; // keys are unique within an object
    used.add(key);
    obj[key] = genValue(rng, depth - 1);
  }
  return obj;
}

describe("TOON round-trip identity (property)", () => {
  it("parseToon(serializeToon(v)) deep-equals v for 400 generated values", () => {
    const rng = makePrng(0x10ac1a); // fixed seed -> reproducible
    for (let i = 0; i < 400; i++) {
      const v = genValue(rng, 4);
      const text = serializeToon(v);
      let parsed: ToonValue;
      try {
        parsed = parseToon(text);
      } catch (err) {
        throw new Error(
          `iteration ${i}: parseToon threw ${(err as Error).message}\n` +
            `--- serialized ---\n${text}`,
        );
      }
      // toEqual gives structural + NaN-aware equality.
      expect(parsed, `iteration ${i}\n--- serialized ---\n${text}`).toEqual(v);
    }
  });

  it("covers top-level scalars, empty object, and empty array", () => {
    const fixed: ToonValue[] = [
      null,
      true,
      false,
      0,
      -0,
      42,
      -7.25,
      "",
      "plain",
      "true",
      "123",
      "has: colon",
      {},
      [],
      { nested: { deep: [1, "two", null, { k: "v" }] } },
      [[], [1], [[2, 3]]],
    ];
    for (const v of fixed) {
      expect(parseToon(serializeToon(v))).toEqual(v);
    }
  });

  it("preserves the special numeric tokens the grammar supports", () => {
    for (const v of [NaN, Infinity, -Infinity] as number[]) {
      expect(parseToon(serializeToon(v))).toEqual(v);
    }
  });
});
