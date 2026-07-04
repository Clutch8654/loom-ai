/**
 * tests/skills/workflow-batch.test.ts
 *
 * F-24 part 1 (C-13) — WORKFLOW skill batch upgrade proof.
 *
 * Covers the five workflow-batch skills: loom-careful, loom-ship, loom-retro,
 * loom-canary, loom-worktree. Proves the four C-13 requirements:
 *
 *   1. Preamble-by-reference — every batch SKILL.md cites the shared preamble
 *      via the `<!-- @loom-include: protocols/skill-preamble.md -->` directive
 *      and inlines NO copy of it (no >50-line inline preamble).
 *   2. Behavioral tests — backing scripts/hooks are exercised here.
 *   3. Enforcement wired + PROVEN — loom-careful's guard and loom-ship's
 *      version-slot enforcement each fire on their triggering condition, and
 *      the enforcement the other three skills claim (worktree overlap, canary
 *      rollback, retro append-only) is likewise proven.
 *   4. upgrade-matrix shards are complete with a named beyond-upstream
 *      capability.
 *
 * Assertions are on REAL observables — spawned subprocess exit codes / stdout,
 * and the exported decision functions — never by grepping implementation text.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { evaluate } from "../../hooks/loom-careful.js";
import { computeOverlap } from "../../scripts/loom-worktree-scan.js";
import { evaluateHealthGate } from "../../skills/loom-canary/rollback-gate.js";
import {
  assertAppendOnly,
  nextSequentialId,
} from "../../skills/loom-retro/append-guard.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PROTOCOL_PATH = path.join(REPO_ROOT, "protocols", "skill-preamble.md");
const CAREFUL_HOOK = path.join(REPO_ROOT, "hooks", "loom-careful.ts");
const VERSION_SLOT = path.join(REPO_ROOT, "scripts", "loom-version-slot.ts");

const INCLUDE_DIRECTIVE = "<!-- @loom-include: protocols/skill-preamble.md -->";
const BEGIN_MARKER = "<!-- LOOM:SKILL-PREAMBLE:BEGIN -->";
const END_MARKER = "<!-- LOOM:SKILL-PREAMBLE:END -->";

const BATCH_SKILLS = [
  "loom-careful",
  "loom-ship",
  "loom-retro",
  "loom-canary",
  "loom-worktree",
] as const;

const SHARD_NAMES: Record<(typeof BATCH_SKILLS)[number], string> = {
  "loom-careful": "careful",
  "loom-ship": "ship",
  "loom-retro": "retro",
  "loom-canary": "canary",
  "loom-worktree": "worktree",
};

function readSkill(name: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, "skills", name, "SKILL.md"), "utf8");
}

/** Canonical preamble text between the markers in the protocol file. */
function canonicalPreamble(): string {
  const src = fs.readFileSync(PROTOCOL_PATH, "utf8");
  const b = src.indexOf(BEGIN_MARKER);
  const e = src.indexOf(END_MARKER);
  return src.slice(b + BEGIN_MARKER.length, e).trim();
}

// ---------------------------------------------------------------------------
// 1. Preamble-by-reference — every batch skill cites, none inlines.
// ---------------------------------------------------------------------------

describe("C-13 req 1: preamble by reference (no >50-line inline copy)", () => {
  const preamble = canonicalPreamble();

  it.each(BATCH_SKILLS)("%s cites the include directive exactly once", (name) => {
    const body = readSkill(name);
    const count = body.split(INCLUDE_DIRECTIVE).length - 1;
    expect(count).toBe(1);
  });

  it.each(BATCH_SKILLS)("%s inlines NO copy of the canonical preamble", (name) => {
    const body = readSkill(name);
    // No extraction markers and no inlined preamble body → no >50-line copy.
    expect(body).not.toContain(BEGIN_MARKER);
    expect(body).not.toContain(END_MARKER);
    expect(body).not.toContain(preamble);
    expect(body).not.toContain("## Loom skill conventions");
  });
});

// ---------------------------------------------------------------------------
// 2 + 3a. loom-careful guard PROVEN — triggering condition fires the deny.
// ---------------------------------------------------------------------------

describe("C-13 req 3: loom-careful guard is wired and fires", () => {
  function runHook(command: string, extraEnv: Record<string, string> = {}) {
    return spawnSync("bun", [CAREFUL_HOOK], {
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
      encoding: "utf8",
      timeout: 20_000,
      env: { ...process.env, ...extraEnv },
    });
  }

  it("blocks `rm -rf /` with a deny decision and exit 2 (enforcement fires)", () => {
    const res = runHook("rm -rf /");
    expect(res.status).toBe(2);
    expect(res.stdout).toContain('"decision":"deny"');
    expect(res.stdout).toContain("CAREFUL_BLOCKED");
  });

  it("allows a harmless command (exit 0, no deny payload)", () => {
    const res = runHook("ls -la");
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
  });

  it("honors the LOOM_CAREFUL_OVERRIDE bypass (exit 0)", () => {
    const res = runHook("git push --force", { LOOM_CAREFUL_OVERRIDE: "1" });
    expect(res.status).toBe(0);
  });

  it("evaluate() flags dangerous commands and passes safe ones", () => {
    expect(evaluate("DROP TABLE users;").blocked).toBe(true);
    expect(evaluate("git reset --hard HEAD~5").blocked).toBe(true);
    expect(evaluate("echo hi && ls").blocked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3b. loom-ship version-slot enforcement PROVEN — double-claim is refused.
// ---------------------------------------------------------------------------

describe("C-13 req 3: loom-ship version-slot enforcement fires on collision", () => {
  function git(cwd: string, ...args: string[]): void {
    const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 15_000 });
    if (r.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
    }
  }

  function runSlot(args: string[], cwd: string, home: string) {
    return spawnSync("bun", [VERSION_SLOT, ...args], {
      cwd,
      encoding: "utf8",
      timeout: 30_000,
      // Empty gh tokens keep `gh pr list` off the network; isolated HOME keeps
      // the slot registry entirely inside the sandbox.
      env: { ...process.env, HOME: home, GH_TOKEN: "", GITHUB_TOKEN: "" },
    });
  }

  it("refuses to double-reserve the same semver (2nd reserve exits 1)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "loom-ship-slot-"));
    try {
      const home = path.join(root, "home");
      const repo = path.join(root, "repo");
      fs.mkdirSync(home, { recursive: true });
      fs.mkdirSync(repo, { recursive: true });

      git(repo, "init", "-q");
      git(repo, "config", "user.email", "t@example.com");
      git(repo, "config", "user.name", "Test");
      git(repo, "checkout", "-q", "-b", "feature-ship-slot");
      fs.writeFileSync(
        path.join(repo, "package.json"),
        JSON.stringify({ name: "slot-fixture", version: "1.2.2" }, null, 2),
      );
      git(repo, "add", "-A");
      git(repo, "commit", "-q", "-m", "init");

      // First reservation succeeds and writes the registry.
      const first = runSlot(["reserve", "1.2.3"], repo, home);
      expect(first.status).toBe(0);
      expect(first.stdout).toContain("reserved");
      expect(fs.existsSync(path.join(home, ".loom", "version-slots.toon"))).toBe(
        true,
      );

      // Second reservation of the SAME slot triggers the collision guard.
      const second = runSlot(["reserve", "1.2.3"], repo, home);
      expect(second.status).toBe(1);
      expect(second.stderr).toContain("already claimed");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 3c. loom-worktree overlap enforcement PROVEN — the preflight-gate engine.
// ---------------------------------------------------------------------------

describe("C-13 req 3: loom-worktree overlap detection fires on collision", () => {
  it("computeOverlap reports the paths a sibling glob collides with", () => {
    const overlap = computeOverlap(
      ["src/a.ts", "src/b.ts", "docs/x.md"],
      ["src/*.ts"],
    );
    expect(overlap).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("computeOverlap reports no overlap when nothing is shared", () => {
    expect(computeOverlap(["docs/x.md"], ["src/*.ts"])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3d. loom-canary rollback enforcement PROVEN — one failed probe → rollback.
// ---------------------------------------------------------------------------

describe("C-13 req 3: loom-canary rollback gate fires on a failed probe", () => {
  it("rolls back on the first non-2xx probe (no partial-health promotion)", () => {
    const result = evaluateHealthGate(
      [{ status: 200 }, { status: 503 }, { status: 200 }],
      0.01,
    );
    expect(result.decision).toBe("rollback");
    expect(result.reason).toContain("CANARY_ROLLED_BACK");
    expect(result.failedProbeIndex).toBe(1);
  });

  it("rolls back when the error-rate delta crosses the threshold", () => {
    const result = evaluateHealthGate([{ status: 200, errorRateDelta: 0.05 }], 0.01);
    expect(result.decision).toBe("rollback");
  });

  it("promotes only when every probe is healthy", () => {
    const result = evaluateHealthGate([{ status: 200 }, { status: 204 }], 0.01);
    expect(result.decision).toBe("promote");
  });
});

// ---------------------------------------------------------------------------
// 3e. loom-retro append-only enforcement PROVEN.
// ---------------------------------------------------------------------------

describe("C-13 req 3: loom-retro append-guard fires on a mutated row", () => {
  it("flags a mutated historic row as RETRO_APPEND_VIOLATION", () => {
    const prior = ["L-001,a", "L-002,b"];
    const mutated = ["L-001,a-EDITED", "L-002,b", "L-003,c"];
    const check = assertAppendOnly(prior, mutated);
    expect(check.ok).toBe(false);
    expect(check.code).toBe("RETRO_APPEND_VIOLATION");
  });

  it("flags a dropped historic row", () => {
    expect(assertAppendOnly(["L-001,a", "L-002,b"], ["L-001,a"]).ok).toBe(false);
  });

  it("accepts a pure append", () => {
    const check = assertAppendOnly(["L-001,a"], ["L-001,a", "L-002,b"]);
    expect(check.ok).toBe(true);
  });

  it("nextSequentialId increments the highest existing id", () => {
    expect(nextSequentialId("L", ["L-001", "L-007", "L-003"])).toBe("L-008");
    expect(nextSequentialId("R", [])).toBe("R-001");
  });
});

// ---------------------------------------------------------------------------
// 4. upgrade-matrix shards — complete, workflow batch, named beyond-upstream.
// ---------------------------------------------------------------------------

describe("C-13 req 4: upgrade-matrix shards are complete", () => {
  const REQUIRED = [
    "skill",
    "batch",
    "preambleRef",
    "testsPresent",
    "enforcementWired",
    "beyondUpstream",
  ] as const;

  /** Minimal flat-TOON scalar reader: `key: value`, quotes stripped. */
  function parseShard(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim();
      if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
    return out;
  }

  it.each(BATCH_SKILLS)("%s shard has every required column, none empty", (name) => {
    const shardPath = path.join(
      REPO_ROOT,
      "skills",
      "upgrade-matrix",
      `${SHARD_NAMES[name]}.toon`,
    );
    expect(fs.existsSync(shardPath)).toBe(true);
    const shard = parseShard(fs.readFileSync(shardPath, "utf8"));

    for (const col of REQUIRED) {
      expect(shard[col], `${name}.${col} present`).toBeDefined();
      expect(shard[col].length, `${name}.${col} non-empty`).toBeGreaterThan(0);
    }
    expect(shard.skill).toBe(name);
    expect(shard.batch).toBe("workflow");
    expect(shard.preambleRef).toBe("protocols/skill-preamble.md");
    expect(shard.testsPresent).toBe("true");
    expect(shard.enforcementWired).toBe("true");
    // beyondUpstream must be a substantive, concrete capability line.
    expect(shard.beyondUpstream.length).toBeGreaterThan(20);
  });
});
