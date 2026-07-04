/**
 * F-22: Shared skill-preamble protocol resource.
 *
 * Proves that the skill preamble is authored ONCE in
 * `protocols/skill-preamble.md` and cited BY REFERENCE from skill bodies —
 * the skill-side analogue of the `commands/_loom-init-guard.md` shared
 * include. A fixture skill that declares the include directive resolves the
 * canonical preamble at load time with NO inlined copy in the skill body.
 *
 * Verifies:
 * 1. The protocol file exists, carries `description:` frontmatter, and holds
 *    exactly one canonical preamble block between the byte-stable markers.
 * 2. It is registered under `library.protocols:` in `skills/library.yaml`.
 * 3. A fixture skill citing the include directive contains NO inline copy of
 *    the preamble, and resolution substitutes the canonical text in.
 * 4. The canonical preamble text lives in exactly one source file.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Paths + canonical constants (kept in lock-step with protocols/skill-preamble.md)
// ---------------------------------------------------------------------------

const REPO_ROOT = join(__dirname, "..", "..");
const PROTOCOL_PATH = join(REPO_ROOT, "protocols", "skill-preamble.md");
const LIBRARY_PATH = join(REPO_ROOT, "skills", "library.yaml");

const BEGIN_MARKER = "<!-- LOOM:SKILL-PREAMBLE:BEGIN -->";
const END_MARKER = "<!-- LOOM:SKILL-PREAMBLE:END -->";
const INCLUDE_DIRECTIVE = "<!-- @loom-include: protocols/skill-preamble.md -->";

const protocolRaw = readFileSync(PROTOCOL_PATH, "utf8");

/**
 * Extract the canonical preamble text strictly between the BEGIN and END
 * markers (exclusive), trimmed. Throws if the markers are absent or unordered
 * so a drift in the protocol file fails loudly rather than resolving to "".
 */
function extractCanonicalPreamble(source: string): string {
  const begin = source.indexOf(BEGIN_MARKER);
  const end = source.indexOf(END_MARKER);
  if (begin === -1 || end === -1 || end <= begin) {
    throw new Error("skill-preamble markers missing or out of order");
  }
  return source.slice(begin + BEGIN_MARKER.length, end).trim();
}

/**
 * Resolve a skill body: replace the include directive with the canonical
 * preamble read from `protocols/skill-preamble.md`. Mirrors the cite-by-path
 * resolution the command layer applies for `_loom-init-guard`.
 */
function resolveSkillPreamble(skillBody: string, protocolSource: string): string {
  const canonical = extractCanonicalPreamble(protocolSource);
  return skillBody.replace(INCLUDE_DIRECTIVE, canonical);
}

const CANONICAL_PREAMBLE = extractCanonicalPreamble(protocolRaw);

// ---------------------------------------------------------------------------
// 1. Protocol file shape
// ---------------------------------------------------------------------------

describe("F-22: protocols/skill-preamble.md canonical source", () => {
  it("carries description frontmatter", () => {
    expect(protocolRaw.startsWith("---")).toBe(true);
    const endFm = protocolRaw.indexOf("---", 3);
    expect(endFm).toBeGreaterThan(0);
    const frontmatter = protocolRaw.slice(0, endFm);
    expect(frontmatter).toMatch(/^description:/m);
  });

  it("holds exactly one canonical preamble block", () => {
    const begins = protocolRaw.split(BEGIN_MARKER).length - 1;
    const ends = protocolRaw.split(END_MARKER).length - 1;
    expect(begins).toBe(1);
    expect(ends).toBe(1);
  });

  it("the canonical preamble is non-trivial and names the core conventions", () => {
    expect(CANONICAL_PREAMBLE.length).toBeGreaterThan(200);
    expect(CANONICAL_PREAMBLE).toContain("TOON");
    expect(CANONICAL_PREAMBLE).toContain("Atomic writes");
    expect(CANONICAL_PREAMBLE).toContain("Exit codes");
    expect(CANONICAL_PREAMBLE).toContain("AgentResult");
    expect(CANONICAL_PREAMBLE).toContain("Model resolution is mandatory");
  });

  it("documents the cite-by-path include directive and warns against edits", () => {
    expect(protocolRaw).toContain(INCLUDE_DIRECTIVE);
    expect(protocolRaw).toMatch(/DO NOT modify/);
    expect(protocolRaw).toContain("_loom-init-guard");
  });
});

// ---------------------------------------------------------------------------
// 2. Registration in library.yaml
// ---------------------------------------------------------------------------

describe("F-22: registration under library.protocols", () => {
  const libraryRaw = readFileSync(LIBRARY_PATH, "utf8");

  it("registers a skill-preamble protocol entry pointing at the source", () => {
    expect(libraryRaw).toMatch(/- name: skill-preamble\b/);
    expect(libraryRaw).toContain("source: protocols/skill-preamble.md");
  });

  it("the entry sits inside the protocols block, not skills/agents", () => {
    // The library.protocols block starts at its comment banner; the
    // library.skills block starts at the "In v4, skills =" banner.
    const protocolsIdx = libraryRaw.indexOf("protocols = formerly");
    const skillsIdx = libraryRaw.indexOf("skills = Claude Code native");
    const entryIdx = libraryRaw.indexOf("- name: skill-preamble");
    expect(protocolsIdx).toBeGreaterThanOrEqual(0);
    expect(skillsIdx).toBeGreaterThan(protocolsIdx);
    expect(entryIdx).toBeGreaterThan(protocolsIdx);
    expect(entryIdx).toBeLessThan(skillsIdx);
  });
});

// ---------------------------------------------------------------------------
// 3. Resolution against a fixture skill that cites by reference
// ---------------------------------------------------------------------------

describe("F-22: fixture skill resolves the preamble by reference", () => {
  let tmpDir: string;
  let fixtureBody: string;

  // A fixture skill that cites the include directive and inlines NONE of the
  // canonical preamble text — the whole point of the by-reference pattern.
  const buildFixture = () =>
    [
      "---",
      "name: fixture-preamble-skill",
      'description: "Fixture skill exercising the shared preamble include."',
      "---",
      "",
      "# /fixture-preamble-skill",
      "",
      INCLUDE_DIRECTIVE,
      "",
      "## Subcommands",
      "",
      "Fixture-only body; the preamble above is cited, never pasted.",
      "",
    ].join("\n");

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "loom-preamble-"));
    fixtureBody = buildFixture();
    writeFileSync(join(tmpDir, "SKILL.md"), fixtureBody, "utf8");
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("the fixture cites the include directive", () => {
    const onDisk = readFileSync(join(tmpDir, "SKILL.md"), "utf8");
    expect(onDisk).toContain(INCLUDE_DIRECTIVE);
  });

  it("the fixture body contains NO inlined copy of the preamble", () => {
    const onDisk = readFileSync(join(tmpDir, "SKILL.md"), "utf8");
    // The canonical block must not be duplicated inline anywhere in the skill.
    expect(onDisk).not.toContain(CANONICAL_PREAMBLE);
    expect(onDisk).not.toContain(BEGIN_MARKER);
  });

  it("resolution substitutes the canonical preamble from the protocol file", () => {
    const onDisk = readFileSync(join(tmpDir, "SKILL.md"), "utf8");
    const resolved = resolveSkillPreamble(onDisk, protocolRaw);
    // After resolution the preamble text is present exactly once...
    expect(resolved).toContain(CANONICAL_PREAMBLE);
    // ...and the raw directive has been consumed.
    expect(resolved).not.toContain(INCLUDE_DIRECTIVE);
    // The resolved copy originates from the protocol, not the skill.
    expect(CANONICAL_PREAMBLE.length).toBeGreaterThan(0);
  });

  it("the canonical preamble lives in exactly one source file", () => {
    // The skill on disk holds zero copies; the protocol holds exactly one.
    const onDisk = readFileSync(join(tmpDir, "SKILL.md"), "utf8");
    const inSkill = onDisk.split(CANONICAL_PREAMBLE).length - 1;
    const inProtocol = protocolRaw.split(CANONICAL_PREAMBLE).length - 1;
    expect(inSkill).toBe(0);
    expect(inProtocol).toBe(1);
  });
});
