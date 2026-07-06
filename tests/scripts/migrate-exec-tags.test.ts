/**
 * tests/scripts/migrate-exec-tags.test.ts
 *
 * P10 / F-16 (defect 13) — relocate `plan-exec-*` tags to `refs/exec/*`,
 * move-never-delete, with a pre-migration bundle backup.
 *
 * Drives the real script against fixture git repos (no mocks) and asserts the
 * move semantics, the semver-only v* namespace outcome, conflict abort, and
 * that a backup bundle is written before any ref changes.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "ci", "migrate-exec-tags.ts");

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 15_000 });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${r.status}): ${r.stderr}`);
  }
  return (r.stdout ?? "").trim();
}

function initRepo(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "fixture@test.invalid");
  git(dir, "config", "user.name", "fixture");
  git(dir, "config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "chore: seed");
}

function tagList(dir: string, pattern: string): string[] {
  const out = git(dir, "tag", "--list", pattern);
  return out ? out.split("\n") : [];
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}
function run(repo: string, ...args: string[]): Run {
  const r = spawnSync("bun", [SCRIPT, "--repo", repo, ...args], {
    encoding: "utf8",
    timeout: 30_000,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-tags-"));
  initRepo(dir);
});
afterEach(() => {
  if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("migrate-exec-tags.ts", () => {
  it("dry-run lists moves without changing any ref", () => {
    git(dir, "tag", "plan-exec-wave-0-pre");
    git(dir, "tag", "plan-exec-wave-1-pre");

    const r = run(dir);

    expect(r.status).toBe(0);
    expect(r.stdout).toContain("plan-exec-wave-0-pre -> refs/exec/wave-0-pre");
    expect(r.stdout).toContain("plan-exec-wave-1-pre -> refs/exec/wave-1-pre");
    // Nothing moved.
    expect(tagList(dir, "plan-exec-*").sort()).toEqual([
      "plan-exec-wave-0-pre",
      "plan-exec-wave-1-pre",
    ]);
    expect(git(dir, "for-each-ref", "refs/exec/")).toBe("");
  });

  it("--execute moves every tag to refs/exec/*, preserving object ids, and writes a backup", () => {
    git(dir, "tag", "v0.0.1");
    git(dir, "tag", "plan-exec-wave-0-pre");
    git(dir, "tag", "plan-exec-eg-start");
    const oid0 = git(dir, "rev-parse", "refs/tags/plan-exec-wave-0-pre");

    const r = run(dir, "--execute");

    expect(r.status).toBe(0);
    // plan-exec-* namespace is empty; refs/exec/* holds the relocated refs.
    expect(tagList(dir, "plan-exec-*")).toEqual([]);
    expect(git(dir, "rev-parse", "refs/exec/wave-0-pre")).toBe(oid0);
    expect(git(dir, "for-each-ref", "--format=%(refname)", "refs/exec/").split("\n").sort()).toEqual([
      "refs/exec/eg-start",
      "refs/exec/wave-0-pre",
    ]);
    // v* namespace now contains only the semver tag.
    expect(tagList(dir, "v*")).toEqual(["v0.0.1"]);
    // Backup bundle written before mutation.
    expect(fs.existsSync(path.join(dir, "planning", "reports", "tag-backup.bundle"))).toBe(true);
  });

  it("aborts with TAG_MIGRATION_CONFLICT when a target ref already exists at a different object", () => {
    git(dir, "tag", "plan-exec-wave-0-pre");
    // Second commit so the conflicting target points somewhere else.
    fs.writeFileSync(path.join(dir, "b.txt"), "b\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "chore: second");
    const otherOid = git(dir, "rev-parse", "HEAD");
    git(dir, "update-ref", "refs/exec/wave-0-pre", otherOid);

    const r = run(dir, "--execute");

    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/TAG_MIGRATION_CONFLICT/);
    // Source tag left intact (move-never-delete under conflict).
    expect(tagList(dir, "plan-exec-*")).toEqual(["plan-exec-wave-0-pre"]);
  });

  it("is a clean no-op when there are no plan-exec-* tags", () => {
    const r = run(dir, "--execute");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/nothing to migrate/i);
  });
});
