/**
 * tests/scripts/generate-changelog.test.ts
 *
 * P10 / F-16 — behavioral coverage for the previously-untested
 * scripts/generate-changelog.ts (the CHANGELOG.md generator the release
 * pipeline invokes on a `v*` tag push).
 *
 * Exercises the pure API (classify / groupCommits / renderEntry / applyEntry)
 * and drives the real CLI over a fixture git repo to prove the end-to-end
 * generate + idempotent-skip + dry-run behavior.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  applyEntry,
  classify,
  groupCommits,
  renderEntry,
} from "../../scripts/generate-changelog";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "generate-changelog.ts");

describe("generate-changelog pure API", () => {
  it("classifies conventional prefixes (with scope, bang, and case-insensitivity)", () => {
    expect(classify("feat: x")).toBe("feat");
    expect(classify("fix(scope): y")).toBe("fix");
    expect(classify("refactor!: z")).toBe("refactor");
    expect(classify("FEAT(core): upper")).toBe("feat");
    expect(classify("docs: readme")).toBe("docs");
    expect(classify("merge branch main")).toBe("other");
  });

  it("groups commits and appends the short sha", () => {
    const grouped = groupCommits([
      { sha: "abcdef1234567", subject: "feat: a" },
      { sha: "1234567abcdef", subject: "fix: b" },
      { sha: "9999999aaaaaa", subject: "random thing" },
    ]);
    expect(grouped.feat).toEqual(["feat: a (abcdef1)"]);
    expect(grouped.fix).toEqual(["fix: b (1234567)"]);
    expect(grouped.other).toEqual(["random thing (9999999)"]);
  });

  it("renders a heading with per-group sections, and an empty marker when nothing changed", () => {
    const entry = renderEntry({
      tag: "v1.2.0",
      date: "2026-07-03",
      grouped: groupCommits([{ sha: "abcdef1", subject: "feat: shiny" }]),
    });
    expect(entry).toMatch(/^## v1\.2\.0 \(2026-07-03\)/);
    expect(entry).toContain("### Features");
    expect(entry).toContain("- feat: shiny (abcdef1)");

    const empty = renderEntry({
      tag: "v1.2.1",
      date: "2026-07-03",
      grouped: groupCommits([]),
    });
    expect(empty).toContain("_No commits since prior tag._");
  });

  it("applyEntry writes a fresh changelog then skips idempotently on a second call", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "genlog-apply-"));
    try {
      const changelogPath = path.join(dir, "CHANGELOG.md");
      const entry = renderEntry({
        tag: "v0.1.0",
        date: "2026-07-03",
        grouped: groupCommits([{ sha: "abcdef1", subject: "feat: first" }]),
      });

      const first = applyEntry({ changelogPath, tag: "v0.1.0", entry });
      expect(first.skipped).toBe(false);
      const written = fs.readFileSync(changelogPath, "utf8");
      expect(written).toContain("# Changelog");
      expect(written).toContain("## v0.1.0 (2026-07-03)");

      const second = applyEntry({ changelogPath, tag: "v0.1.0", entry });
      expect(second.skipped).toBe(true);
      expect(second.reason).toBe("already-present");
      // Unchanged on the idempotent second pass.
      expect(fs.readFileSync(changelogPath, "utf8")).toBe(written);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// End-to-end over a fixture repo
// ---------------------------------------------------------------------------

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 15_000 });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed (${r.status}): ${r.stderr}`);
  }
  return (r.stdout ?? "").trim();
}

function commit(dir: string, subject: string): void {
  fs.writeFileSync(path.join(dir, `${Date.now()}-${Math.round(performance.now())}.txt`), subject);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", subject);
}

function runCli(dir: string, ...args: string[]): { status: number | null; stdout: string } {
  const r = spawnSync("bun", [SCRIPT, "--cwd", dir, ...args], {
    encoding: "utf8",
    timeout: 30_000,
  });
  return { status: r.status, stdout: r.stdout ?? "" };
}

describe("generate-changelog CLI over a fixture repo", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "genlog-cli-"));
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.email", "fixture@test.invalid");
    git(dir, "config", "user.name", "fixture");
    git(dir, "config", "commit.gpgsign", "false");
    commit(dir, "chore: seed");
    git(dir, "tag", "v0.1.0");
    commit(dir, "feat: new capability");
    commit(dir, "fix: a bug");
  });
  afterEach(() => {
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("--dry-run prints the entry without writing CHANGELOG.md", () => {
    const r = runCli(dir, "--tag", "v0.2.0", "--dry-run");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("## v0.2.0");
    expect(r.stdout).toContain("feat: new capability");
    expect(fs.existsSync(path.join(dir, "CHANGELOG.md"))).toBe(false);
  });

  it("writes the entry for the range since the prior tag, then skips on re-run", () => {
    const first = runCli(dir, "--tag", "v0.2.0");
    expect(first.status).toBe(0);
    const cl = fs.readFileSync(path.join(dir, "CHANGELOG.md"), "utf8");
    expect(cl).toContain("## v0.2.0");
    expect(cl).toContain("- feat: new capability");
    expect(cl).toContain("- fix: a bug");
    // Prior-tag commit must NOT appear (range is v0.1.0..HEAD).
    expect(cl).not.toContain("chore: seed");

    const second = runCli(dir, "--tag", "v0.2.0");
    expect(second.status).toBe(0);
    expect(second.stdout).toMatch(/skipped/);
  });
});
