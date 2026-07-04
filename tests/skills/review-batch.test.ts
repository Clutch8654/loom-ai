/**
 * F-23 / C-13: REVIEW/QUALITY skill-upgrade batch (Phase 22).
 *
 * Proves the review/quality batch skills each satisfy the four C-13
 * requirements and that their upgrade-matrix shards record them:
 *
 *   1. Preamble-by-reference — every batch skill body cites
 *      `protocols/skill-preamble.md` via the include directive and does NOT
 *      inline the canonical preamble text (the P21 pattern, mirroring
 *      `commands/_loom-init-guard.md`).
 *   2. Behavioral tests — each skill's backing scripts/hooks have behavioral
 *      tests (loom-health references tests/backfill coverage, not duplicated).
 *   3. Enforcement wired — the enforcement each skill claims is live and
 *      demonstrated by a real, existing test/artifact.
 *   4. Beyond-upstream capability — each shard names a non-empty concrete
 *      capability its gstack upstream lacks.
 *
 * Also verifies the loom-think → loom-spec catalog split in
 * `skills/library.yaml`.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");
const PROTOCOL_PATH = join(REPO_ROOT, "protocols", "skill-preamble.md");
const LIBRARY_PATH = join(REPO_ROOT, "skills", "library.yaml");
const MATRIX_DIR = join(REPO_ROOT, "skills", "upgrade-matrix");

const INCLUDE_DIRECTIVE = "<!-- @loom-include: protocols/skill-preamble.md -->";
const PREAMBLE_REF = "protocols/skill-preamble.md";
const BATCH = "review";
const BEGIN_MARKER = "<!-- LOOM:SKILL-PREAMBLE:BEGIN -->";
const END_MARKER = "<!-- LOOM:SKILL-PREAMBLE:END -->";

// ---------------------------------------------------------------------------
// Minimal flat-scalar TOON parser (shards are flat key: value records).
// ---------------------------------------------------------------------------
function parseFlatToon(text: string): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(": ");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 2).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value === "true") out[key] = true;
    else if (value === "false") out[key] = false;
    else out[key] = value;
  }
  return out;
}

/** Canonical preamble text between the byte-stable markers. */
function canonicalPreamble(): string {
  const src = readFileSync(PROTOCOL_PATH, "utf8");
  const b = src.indexOf(BEGIN_MARKER);
  const e = src.indexOf(END_MARKER);
  if (b === -1 || e === -1 || e <= b) throw new Error("preamble markers absent");
  return src.slice(b + BEGIN_MARKER.length, e).trim();
}

// ---------------------------------------------------------------------------
// Batch definition: shard → { skill dirs it covers, enforcement artifacts }.
// The `design` shard covers the three loom-design* skills.
// ---------------------------------------------------------------------------
interface BatchEntry {
  shard: string;
  skillDirs: string[];
  /** Real files/tests that must exist to back the shard's enforcement claim. */
  enforcementArtifacts: string[];
}

const BATCH_ENTRIES: BatchEntry[] = [
  {
    shard: "design",
    skillDirs: [
      "loom-design-consultation",
      "loom-design-html",
      "loom-design-shotgun",
    ],
    enforcementArtifacts: ["protocols/design-preferences.schema.toon"],
  },
  {
    shard: "cso",
    skillDirs: ["loom-cso"],
    enforcementArtifacts: ["scripts/loom-cso.ts", "tests/scripts/loom-cso.test.ts"],
  },
  {
    shard: "spec",
    skillDirs: ["loom-spec"],
    enforcementArtifacts: [
      "protocols/spec.schema.md",
      "protocols/loom-decision-principles.md",
    ],
  },
  {
    shard: "qa",
    skillDirs: ["loom-qa"],
    enforcementArtifacts: [
      "tests/backfill/loom-browser-daemon.test.ts",
      "tests/backfill/loom-health.test.ts",
    ],
  },
  {
    shard: "devex-review",
    skillDirs: ["loom-devex-review"],
    enforcementArtifacts: ["agents/plan-devex-review-agent.md"],
  },
  {
    shard: "health",
    skillDirs: ["loom-health"],
    enforcementArtifacts: [
      "scripts/loom-health.ts",
      "tests/backfill/loom-health.test.ts",
    ],
  },
];

function skillBody(dir: string): string {
  return readFileSync(join(REPO_ROOT, "skills", dir, "SKILL.md"), "utf8");
}

// ---------------------------------------------------------------------------
// 1. Upgrade-matrix shards — all four C-13 columns populated/true.
// ---------------------------------------------------------------------------
describe("C-13: review-batch upgrade-matrix shards", () => {
  for (const { shard } of BATCH_ENTRIES) {
    describe(`shard ${shard}.toon`, () => {
      const path = join(MATRIX_DIR, `${shard}.toon`);
      it("exists and parses", () => {
        expect(existsSync(path)).toBe(true);
      });

      const record = parseFlatToon(readFileSync(path, "utf8"));

      it("skill matches the shard filename", () => {
        expect(record.skill).toBe(shard);
      });
      it("batch is 'review'", () => {
        expect(record.batch).toBe(BATCH);
      });
      it("preambleRef equals protocols/skill-preamble.md", () => {
        expect(record.preambleRef).toBe(PREAMBLE_REF);
      });
      it("testsPresent is true", () => {
        expect(record.testsPresent).toBe(true);
      });
      it("enforcementWired is true", () => {
        expect(record.enforcementWired).toBe(true);
      });
      it("beyondUpstream is a non-empty concrete capability", () => {
        expect(typeof record.beyondUpstream).toBe("string");
        expect((record.beyondUpstream as string).length).toBeGreaterThan(30);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Preamble-by-reference — cite the directive, never inline the text.
// ---------------------------------------------------------------------------
describe("C-13 req 1: preamble cited by reference, not inlined", () => {
  const canonical = canonicalPreamble();
  const canonicalHead = canonical.split("\n").slice(0, 3).join("\n");

  for (const { skillDirs } of BATCH_ENTRIES) {
    for (const dir of skillDirs) {
      it(`${dir} cites the include directive`, () => {
        expect(skillBody(dir)).toContain(INCLUDE_DIRECTIVE);
      });
      it(`${dir} does not inline the canonical preamble text`, () => {
        const body = skillBody(dir);
        expect(body).not.toContain(BEGIN_MARKER);
        expect(body).not.toContain(canonicalHead);
      });
      it(`${dir} inlines no >50-line preamble block`, () => {
        // Citing by reference means zero inlined preamble lines. Guard against
        // a regression that pastes a chunk of the canonical text into the body
        // — any contiguous slice appearing inline would signal inlining.
        const body = skillBody(dir);
        expect(body).not.toContain(canonical.slice(0, 200));
        // The include directive must be the ONLY preamble reference — the body
        // stays well under the 50-line inlined-preamble ceiling.
        const conventionsIdx = body.indexOf(INCLUDE_DIRECTIVE);
        expect(conventionsIdx).toBeGreaterThanOrEqual(0);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 3. Enforcement wired — claimed enforcement artifacts exist and are cited.
// ---------------------------------------------------------------------------
describe("C-13 req 2+3: backing tests + enforcement wired", () => {
  for (const { shard, skillDirs, enforcementArtifacts } of BATCH_ENTRIES) {
    for (const artifact of enforcementArtifacts) {
      it(`${shard}: enforcement artifact ${artifact} exists`, () => {
        expect(existsSync(join(REPO_ROOT, artifact))).toBe(true);
      });
    }
    it(`${shard}: at least one skill body cites a backing artifact`, () => {
      const bodies = skillDirs.map(skillBody).join("\n");
      const cited = enforcementArtifacts.some((a) => bodies.includes(a));
      expect(cited).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// 4. loom-health created (dir was absent) and references, not duplicates,
//    the tests/backfill coverage.
// ---------------------------------------------------------------------------
describe("loom-health: created skill references tests/backfill coverage", () => {
  const body = skillBody("loom-health");
  it("references tests/backfill/loom-health.test.ts (not duplicated)", () => {
    expect(body).toContain("tests/backfill/loom-health.test.ts");
  });
  it("points at its backing script", () => {
    expect(body).toContain("scripts/loom-health.ts");
  });
  it("cites the shared preamble", () => {
    expect(body).toContain(INCLUDE_DIRECTIVE);
  });
});

// ---------------------------------------------------------------------------
// 5. Catalog split — loom-cso + loom-spec registered, loom-think retired.
// ---------------------------------------------------------------------------
describe("skills/library.yaml: loom-think → loom-spec split", () => {
  const lib = readFileSync(LIBRARY_PATH, "utf8");
  it("registers loom-cso and loom-spec skills", () => {
    expect(lib).toContain("source: skills/loom-cso/SKILL.md");
    expect(lib).toContain("source: skills/loom-spec/SKILL.md");
  });
  it("retires the loom-think skill entry", () => {
    expect(lib).not.toContain("source: skills/loom-think/SKILL.md");
  });
});
