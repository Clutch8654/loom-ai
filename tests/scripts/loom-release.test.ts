/**
 * tests/scripts/loom-release.test.ts
 *
 * P7 / F-15 (defect 13, contract C-04) — the milestone semver release spine.
 *
 * Covers both deliverable scripts against real fixture git repositories spawned
 * per test (no mocks of git): scripts/loom-release.ts (draft/dry-run + tagged
 * close) and scripts/ci/version-gate.ts (bump policy + namespace policy).
 *
 * Non-tautological: each case drives the real script as a subprocess with
 * `--repo` pointed at an isolated temp repo and observes its exit code, stdout,
 * stderr, and the resulting git tags / changelog on disk.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { METRIC_NAMES } from "../../scripts/loom-release";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RELEASE = path.join(REPO_ROOT, "scripts", "loom-release.ts");
const GATE = path.join(REPO_ROOT, "scripts", "ci", "version-gate.ts");

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

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
}

let seq = 0;
function commit(dir: string, subject: string, body = ""): void {
  seq += 1;
  fs.writeFileSync(path.join(dir, `f${seq}.txt`), `${subject}\n`);
  git(dir, "add", "-A");
  const args = ["commit", "-q", "-m", subject];
  if (body) args.push("-m", body);
  git(dir, ...args);
}

function writeChangelog(dir: string, content: string): void {
  const p = path.join(dir, "planning", "history", "changelog.md");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function readChangelog(dir: string): string {
  return fs.readFileSync(
    path.join(dir, "planning", "history", "changelog.md"),
    "utf8",
  );
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runRelease(repo: string, ...args: string[]): Run {
  const r = spawnSync("bun", [RELEASE, "--repo", repo, ...args], {
    encoding: "utf8",
    timeout: 30_000,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function runGate(repo: string, ...args: string[]): Run {
  const r = spawnSync("bun", [GATE, "--repo", repo, ...args], {
    encoding: "utf8",
    timeout: 30_000,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-release-"));
});
afterEach(() => {
  if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// loom-release.ts
// ---------------------------------------------------------------------------

describe("loom-release.ts — draft / dry-run", () => {
  it("derives a minor bump from a feat commit and prints the seven metric placeholders", () => {
    initRepo(dir);
    commit(dir, "feat: add widget");

    const r = runRelease(dir, "--milestone", "M-01", "--dry-run", "--date", "2026-07-03");

    expect(r.status).toBe(0);
    // No prior tag ⇒ base 0.0.0 ⇒ feat ⇒ v0.1.0.
    expect(r.stdout).toMatch(/^## v0\.1\.0 — M-01 \(2026-07-03\)/m);
    for (const metric of METRIC_NAMES) {
      expect(r.stdout).toContain(`- ${metric}: <pending>`);
    }
    // Exactly the seven pre-registered metrics.
    expect(METRIC_NAMES.length).toBe(7);
  });

  it("promotes to a major bump on a breaking change", () => {
    initRepo(dir);
    commit(dir, "feat!: rewrite the api");

    const r = runRelease(dir, "--milestone", "M-02", "--dry-run");

    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^## v1\.0\.0 — M-02/m);
  });

  it("bumps patch from the last semver tag when only fixes land", () => {
    initRepo(dir);
    commit(dir, "chore: seed");
    git(dir, "tag", "v1.2.3");
    commit(dir, "fix: correct off-by-one");

    const r = runRelease(dir, "--milestone", "M-03", "--dry-run");

    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^## v1\.2\.4 — M-03/m);
    expect(r.stdout).toContain("`v1.2.3..v1.2.4`");
  });

  it("fails derivation (exit 1) when no release-worthy commits exist", () => {
    initRepo(dir);
    commit(dir, "chore: tidy");
    commit(dir, "docs: readme");

    const r = runRelease(dir, "--milestone", "M-01", "--dry-run");

    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/VERSION_DERIVATION_FAILED/);
  });

  it("rejects a missing --milestone as a usage error", () => {
    initRepo(dir);
    commit(dir, "feat: x");

    const r = runRelease(dir, "--dry-run");

    expect(r.status).toBe(64);
    expect(r.stderr).toMatch(/USAGE_ERROR/);
  });
});

describe("loom-release.ts — tagged close", () => {
  it("cuts a vX.Y.Z tag and prepends a matching changelog header", () => {
    initRepo(dir);
    writeChangelog(dir, "## 2026-01-01 -- prior entry\n\n- something\n");
    commit(dir, "feat: shippable feature"); // also stages the changelog
    // Tree must be clean before a real close.
    expect(git(dir, "status", "--porcelain")).toBe("");

    const r = runRelease(dir, "--milestone", "M-01", "--date", "2026-07-03");

    expect(r.status).toBe(0);
    // Tag created.
    expect(git(dir, "tag", "--list", "v0.1.0")).toBe("v0.1.0");
    // Changelog gained the semver header at the top, prior content retained.
    const cl = readChangelog(dir);
    expect(cl).toMatch(/^## v0\.1\.0 — M-01 \(2026-07-03\)/);
    expect(cl).toContain("## 2026-01-01 -- prior entry");
    expect(cl).toContain("<!-- loom:release:v0.1.0 -->");
  });

  it("refuses a dirty tree with exit 3", () => {
    initRepo(dir);
    commit(dir, "feat: shippable");
    // Uncommitted change ⇒ dirty tree.
    fs.writeFileSync(path.join(dir, "dirty.txt"), "uncommitted\n");

    const r = runRelease(dir, "--milestone", "M-01");

    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/DIRTY_TREE/);
    // No tag was cut.
    expect(git(dir, "tag", "--list", "v0.1.0")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// version-gate.ts
// ---------------------------------------------------------------------------

describe("version-gate.ts — bump policy (CG-001)", () => {
  it("exits 1 on release-worthy commits at a milestone boundary without a bump", () => {
    initRepo(dir);
    commit(dir, "chore: seed");
    git(dir, "tag", "v0.1.0");
    commit(dir, "feat: unreleased feature");
    // Changelog's highest header does not exceed the last tag ⇒ no bump.
    writeChangelog(dir, "## v0.1.0 — M-01\n\n- prior\n");

    const r = runGate(dir, "--milestone", "M-02");

    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/VERSION_GATE_FAILED/);
    expect(r.stderr).toContain("unreleased feature");
  });

  it("passes (exit 0) when the changelog records a bump beyond the last tag", () => {
    initRepo(dir);
    commit(dir, "chore: seed");
    git(dir, "tag", "v0.1.0");
    commit(dir, "feat: shipped feature");
    writeChangelog(dir, "## v0.2.0 — M-02\n\n- shipped\n");

    const r = runGate(dir, "--milestone", "M-02");

    expect(r.status).toBe(0);
  });

  it("does not enforce the bump off a milestone boundary (no --milestone)", () => {
    initRepo(dir);
    commit(dir, "chore: seed");
    git(dir, "tag", "v0.1.0");
    commit(dir, "feat: unreleased");
    writeChangelog(dir, "## v0.1.0 — M-01\n");

    const r = runGate(dir);

    expect(r.status).toBe(0);
  });
});

describe("version-gate.ts — namespace policy", () => {
  it("exits 1 on a non-semver tag in the v* namespace", () => {
    initRepo(dir);
    commit(dir, "chore: seed");
    git(dir, "tag", "vfoo");

    const r = runGate(dir);

    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/TAG_NAMESPACE_POLLUTED/);
    expect(r.stderr).toContain("vfoo");
  });
});
