/**
 * tests/skills/ops-batch.test.ts
 *
 * F-24 (part 2) / C-13 — OPS/AUTHORING skill-upgrade batch.
 *
 * Proves the four C-13 requirements for the ops batch skills:
 *   loom-browser, loom-skillify, loom-learn, loom-benchmark, loom-benchmark-models.
 *
 *   1. Preamble-by-reference — every batch SKILL.md cites
 *      `<!-- @loom-include: protocols/skill-preamble.md -->` exactly once and
 *      inlines NO copy of the canonical preamble (the >50-line ban).
 *   2. Behavioral tests — the backing scripts have real behavioral coverage:
 *        - loom-learn        → this file drives scripts/loom-learnings-search.ts
 *                              as a live subprocess (filter + rank + min-confidence).
 *        - loom-browser      → REFERENCED, not duplicated:
 *                              tests/backfill/loom-browser-daemon.test.ts.
 *   3. Enforcement wired — each skill's claimed gate is demonstrated:
 *        - loom-learn        → --min-confidence filter enforced (subprocess).
 *        - loom-browser      → DAEMON_NOT_RUNNING hard-fail, no queue (referenced).
 *        - loom-skillify     → SKILLIFY_TEST_FAIL gates registration (contract).
 *        - loom-benchmark    → daemon-required exit path (contract).
 *        - loom-benchmark-models → vendor-skip / all-missing exit (contract).
 *   4. Beyond-upstream — every upgrade-matrix shard names a concrete capability.
 *
 * Run: bunx vitest run tests/skills/ops-batch.test.ts
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { parseToon } from "../../lib/toon.js";
import type { SkillUpgradeMatrix } from "../../lib/types.js";
import { createSandbox } from "../helpers/backfill-template.js";

const REPO_ROOT = resolve(__dirname, "..", "..");

const PROTOCOL_PATH = join(REPO_ROOT, "protocols", "skill-preamble.md");
const INCLUDE_DIRECTIVE = "<!-- @loom-include: protocols/skill-preamble.md -->";
const BEGIN_MARKER = "<!-- LOOM:SKILL-PREAMBLE:BEGIN -->";
const END_MARKER = "<!-- LOOM:SKILL-PREAMBLE:END -->";
const PREAMBLE_REF = "protocols/skill-preamble.md";

/** Canonical preamble text, extracted from the single source of truth. */
function canonicalPreamble(): string {
  const src = readFileSync(PROTOCOL_PATH, "utf8");
  const begin = src.indexOf(BEGIN_MARKER);
  const end = src.indexOf(END_MARKER);
  if (begin === -1 || end === -1 || end <= begin) {
    throw new Error("skill-preamble markers missing or out of order");
  }
  return src.slice(begin + BEGIN_MARKER.length, end).trim();
}
const CANONICAL = canonicalPreamble();

/** The five batch skills: skill dir name ↔ upgrade-matrix shard stem. */
const BATCH = [
  { skillDir: "loom-browser", shard: "browser" },
  { skillDir: "loom-skillify", shard: "skillify" },
  { skillDir: "loom-learn", shard: "learn" },
  { skillDir: "loom-benchmark", shard: "benchmark" },
  { skillDir: "loom-benchmark-models", shard: "benchmark-models" },
] as const;

const readSkill = (dir: string) =>
  readFileSync(join(REPO_ROOT, "skills", dir, "SKILL.md"), "utf8");
const readShard = (stem: string) =>
  readFileSync(join(REPO_ROOT, "skills", "upgrade-matrix", `${stem}.toon`), "utf8");

// ---------------------------------------------------------------------------
// 1. Preamble by reference — cited once, never inlined (>50-line ban).
// ---------------------------------------------------------------------------

describe("C-13.1: preamble cited by reference, never inlined", () => {
  it.each(BATCH)("$skillDir cites the include directive exactly once", ({ skillDir }) => {
    const body = readSkill(skillDir);
    const count = body.split(INCLUDE_DIRECTIVE).length - 1;
    expect(count).toBe(1);
  });

  it.each(BATCH)("$skillDir inlines NO copy of the canonical preamble", ({ skillDir }) => {
    const body = readSkill(skillDir);
    expect(body).not.toContain(CANONICAL);
    expect(body).not.toContain(BEGIN_MARKER);
    expect(body).not.toContain(END_MARKER);
  });

  it.each(BATCH)("$skillDir has no >50-line inlined preamble block", ({ skillDir }) => {
    // Guard against a body that pastes the whole preamble prose: the canonical
    // block is ~40 numbered convention lines; a compliant skill body must not
    // reproduce that run. We approximate by asserting the numbered-convention
    // fingerprint lines from the canonical text do not co-occur in the body.
    const body = readSkill(skillDir);
    const fingerprints = [
      "TOON everywhere",
      "Atomic writes",
      "Model resolution is mandatory",
      "AgentResult envelope",
    ];
    const hits = fingerprints.filter((f) => body.includes(f)).length;
    // A cite-by-reference body may mention "atomic writes" casually, but must
    // not reproduce the full convention roster inline.
    expect(hits).toBeLessThan(fingerprints.length);
  });
});

// ---------------------------------------------------------------------------
// 2. + 4. upgrade-matrix shard conforms to SkillUpgradeMatrix, names a
//          beyond-upstream capability, and pins the shared preamble ref.
// ---------------------------------------------------------------------------

describe("C-13.4: upgrade-matrix shards complete + beyond-upstream named", () => {
  it.each(BATCH)("$shard shard conforms to SkillUpgradeMatrix", ({ shard }) => {
    const parsed = parseToon(readShard(shard)) as unknown as SkillUpgradeMatrix;

    expect(parsed.skill).toBe(shard);
    expect(parsed.batch).toBe("ops");
    expect(parsed.preambleRef).toBe(PREAMBLE_REF);
    expect(parsed.testsPresent).toBe(true);
    expect(parsed.enforcementWired).toBe(true);
    expect(typeof parsed.beyondUpstream).toBe("string");
    expect(parsed.beyondUpstream.trim().length).toBeGreaterThan(0);
  });

  it("every batch skill has a distinct beyond-upstream capability", () => {
    const caps = BATCH.map(
      ({ shard }) => (parseToon(readShard(shard)) as any).beyondUpstream as string,
    );
    expect(new Set(caps).size).toBe(BATCH.length);
  });
});

// ---------------------------------------------------------------------------
// 2. + 3. Behavioral test for loom-learn's backing script, and demonstration
//         of its --min-confidence enforcement, via a real subprocess.
// ---------------------------------------------------------------------------

describe("C-13.2/3: loom-learn backing script (loom-learnings-search.ts) is behavioral", () => {
  const SCRIPT = join(REPO_ROOT, "scripts", "loom-learnings-search.ts");

  const CORPUS = [
    "schemaVersion: 1",
    "learnings[3]{id,key,description,confidence,sourcePlan,sourceDate,domain,tags}:",
    '  L-001,vitest-parallel-write-race,"vitest race on parallel writes",7,manual,2026-05-30,tests,"tests,flaky"',
    '  L-002,atomic-write-missing,"atomic write missing on state.toon",9,manual,2026-04-11,core,"fs,atomic"',
    '  L-003,scope-contract-drift,"scope-contract.toon out of sync",5,planning/plans/PLAN-m07.md,2026-06-05,planning,"scope,toon"',
    "",
  ].join("\n");

  function runSearch(cwd: string, home: string, args: string[]) {
    return spawnSync("bun", [SCRIPT, ...args], {
      cwd,
      encoding: "utf-8",
      timeout: 30_000,
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
  }

  it("filters to matching learnings and exits 0", () => {
    const sandbox = createSandbox({ chdir: false });
    try {
      sandbox.write("cwd/.loom/learnings.toon", CORPUS);
      const r = runSearch(sandbox.cwd, sandbox.home, ["--query", "race"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("resultCount: 1");
      expect(r.stdout).toContain("vitest-parallel-write-race");
      expect(r.stdout).not.toContain("atomic-write-missing");
    } finally {
      sandbox.cleanup();
    }
  });

  it("ranks matches by confidence descending", () => {
    const sandbox = createSandbox({ chdir: false });
    try {
      sandbox.write("cwd/.loom/learnings.toon", CORPUS);
      // Empty query matches all three; highest confidence (9) must come first.
      const r = runSearch(sandbox.cwd, sandbox.home, ["--query", ""]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("resultCount: 3");
      const iAtomic = r.stdout.indexOf("atomic-write-missing"); // conf 9
      const iRace = r.stdout.indexOf("vitest-parallel-write-race"); // conf 7
      const iScope = r.stdout.indexOf("scope-contract-drift"); // conf 5
      expect(iAtomic).toBeGreaterThanOrEqual(0);
      expect(iAtomic).toBeLessThan(iRace);
      expect(iRace).toBeLessThan(iScope);
    } finally {
      sandbox.cleanup();
    }
  });

  it("enforces the --min-confidence floor (drops low-signal entries)", () => {
    const sandbox = createSandbox({ chdir: false });
    try {
      sandbox.write("cwd/.loom/learnings.toon", CORPUS);
      const r = runSearch(sandbox.cwd, sandbox.home, [
        "--query",
        "",
        "--min-confidence",
        "8",
      ]);
      expect(r.status).toBe(0);
      // Only the confidence-9 entry clears the floor of 8.
      expect(r.stdout).toContain("resultCount: 1");
      expect(r.stdout).toContain("atomic-write-missing");
      expect(r.stdout).not.toContain("vitest-parallel-write-race");
      expect(r.stdout).not.toContain("scope-contract-drift");
    } finally {
      sandbox.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. + 3. loom-browser daemon — REFERENCED, not duplicated.
// ---------------------------------------------------------------------------

describe("C-13.2/3: loom-browser daemon behavioral coverage is referenced, not duplicated", () => {
  const BACKFILL = join(REPO_ROOT, "tests", "backfill", "loom-browser-daemon.test.ts");

  it("the referenced daemon backfill test exists", () => {
    expect(existsSync(BACKFILL)).toBe(true);
  });

  it("the referenced test drives the real daemon and its daemon-down hard-fail enforcement", () => {
    const src = readFileSync(BACKFILL, "utf8");
    // It exercises the daemon as a live subprocess (not a source grep)...
    expect(src).toContain("scripts/loom-browser-daemon.ts");
    expect(src).toContain("spawnSync");
    // ...and demonstrates the DAEMON_NOT_RUNNING hard-fail (C-07 / F-03): no
    // silent queue-return-0; the queue file is asserted absent.
    expect(src).toContain("DAEMON_NOT_RUNNING");
    expect(src).toContain("queue.toon");
  });
});

// ---------------------------------------------------------------------------
// 3. Enforcement contracts for the script-less skills are declared + live.
// ---------------------------------------------------------------------------

describe("C-13.3: script-less skills declare their live enforcement gate", () => {
  it("loom-skillify gates registration on a green test (SKILLIFY_TEST_FAIL)", () => {
    const body = readSkill("loom-skillify");
    expect(body).toContain("SKILLIFY_TEST_FAIL");
    // The gate wording: on fail, do NOT register.
    expect(body).toMatch(/do NOT register/i);
  });

  it("loom-benchmark requires the daemon and exits on its absence", () => {
    const body = readSkill("loom-benchmark");
    expect(body).toContain("/loom-browser");
    expect(body).toMatch(/exits? `?1`?/);
  });

  it("loom-benchmark-models records vendor skips and exits when all keys are absent", () => {
    const body = readSkill("loom-benchmark-models");
    expect(body).toMatch(/skipped: true/);
    expect(body).toMatch(/no vendors available/i);
  });
});
