/**
 * tests/backfill/loom-version-slot.test.ts
 *
 * Behavioral backfill for scripts/loom-version-slot.ts (PLAN-exceed-gstack
 * Phase 14b BATCH B2, F-11, defect 6). The script exports nothing — its only
 * observable is the CLI: it reads/writes ~/.loom/version-slots.toon and prints
 * a TOON report. These tests drive it as a real subprocess (like the Phase-14a
 * isMain guard makes safe) inside a template Sandbox whose HOME is isolated, so
 * the registry lands entirely under the sandbox and never touches the real ~.
 *
 * We assert on the REAL observable output (exit code, stdout TOON, the written
 * registry file) — never by grepping source text. The template's assertOutcome
 * runs the exit-code/stdout expectations against the subprocess outcome.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  withSandbox,
  assertOutcome,
  type RunOutcome,
} from "../helpers/backfill-template.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "loom-version-slot.ts");

/** Adapt a spawnSync result into the template's RunOutcome shape. */
function toOutcome(res: ReturnType<typeof spawnSync>): RunOutcome<never> {
  return {
    returned: undefined,
    threw: res.error ?? null,
    exitCode: res.status,
    stdout: res.stdout == null ? "" : String(res.stdout),
    stderr: res.stderr == null ? "" : String(res.stderr),
  };
}

/** Run the slot CLI in `cwd` with an isolated HOME; gh is stubbed off. */
function runSlot(
  args: string[],
  cwd: string,
  home: string,
): RunOutcome<never> {
  return toOutcome(
    spawnSync("bun", [SCRIPT, ...args], {
      cwd,
      encoding: "utf8",
      timeout: 30_000,
      // Empty tokens keep `gh pr list` from reaching the network; the script
      // swallows its failure and treats PRs as absent.
      env: { ...process.env, HOME: home, GH_TOKEN: "", GITHUB_TOKEN: "" },
    }),
  );
}

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 15_000 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

/**
 * Create a git project dir with a package.json version inside the box. A real
 * branch is required: the CLI only PRESERVES a reservation row across a later
 * `refresh()` when its branch still exists (else the row is ejected as stale).
 */
function makeProject(root: string, version: string): string {
  const dir = path.join(root, "repo");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "repo", version }, null, 2),
  );
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "fixture@test.invalid");
  git(dir, "config", "user.name", "fixture");
  git(dir, "config", "commit.gpgsign", "false");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "init");
  return dir;
}

describe("loom-version-slot CLI (backfill, subprocess)", () => {
  it("reserve writes an isolated registry row and reports it as TOON", async () => {
    await withSandbox(async (box) => {
      const project = makeProject(box.root, "1.0.0");

      const outcome = runSlot(["reserve", "1.2.3"], project, box.home);
      assertOutcome(outcome, {
        exitCode: 0,
        stdoutIncludes: ["status: reserved", "version: 1.2.3"],
      });

      // The reservation landed in the SANDBOX home, not the developer's ~.
      const registry = box.homePath(".loom", "version-slots.toon");
      expect(fs.existsSync(registry)).toBe(true);
      const body = fs.readFileSync(registry, "utf8");
      expect(body).toContain("repo,1.2.3,");
      expect(body).toContain("slots[1]");
    }, { chdir: false });
  });

  it("a second reserve of the same version fails closed with a collision", async () => {
    await withSandbox(async (box) => {
      const project = makeProject(box.root, "1.0.0");

      const first = runSlot(["reserve", "2.0.0"], project, box.home);
      expect(first.exitCode).toBe(0);

      const second = runSlot(["reserve", "2.0.0"], project, box.home);
      assertOutcome(second, {
        exitCode: 1,
        stderrIncludes: /already claimed/,
      });
    }, { chdir: false });
  });

  it("next --bump minor computes the next free slot from package.json", async () => {
    await withSandbox(async (box) => {
      const project = makeProject(box.root, "1.4.2");

      const outcome = runSlot(["next", "--bump", "minor"], project, box.home);
      assertOutcome(outcome, {
        exitCode: 0,
        stdoutIncludes: ["fromVersion: 1.4.2", "bump: minor", "nextFreeSlot: 1.5.0"],
      });
    }, { chdir: false });
  });

  it("scan reprints the reserved slot in the TOON table", async () => {
    await withSandbox(async (box) => {
      const project = makeProject(box.root, "1.0.0");
      runSlot(["reserve", "3.1.4"], project, box.home);

      const outcome = runSlot(["scan"], project, box.home);
      assertOutcome(outcome, {
        exitCode: 0,
        stdoutIncludes: [
          "slots[1]{repo,version,branch,worktreePath,prNumber,prState,claimedAt,lastSeenAt}:",
          "repo,3.1.4,",
        ],
      });
    }, { chdir: false });
  });
});
