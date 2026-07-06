/**
 * tests/scripts/generate-docs.test.ts — behavioral tests for the Phase 16
 * generated-docs pipeline (F-18, C-05, defect 12):
 *
 *   scripts/generate-docs.ts        regenerates marker-bounded sections + manifest
 *   scripts/ci/check-docs-drift.ts  recomputes from source, fails on staleness
 *
 * Coverage:
 *   - marker-bounded regeneration only; narrative prose is never touched (diff)
 *   - idempotency: a second `--write` is a genuine no-op
 *   - the command table lists every shipped command once (skill/skillify distinct)
 *   - the hook count comes from ONE source and agrees at all four README sites
 *   - check-docs-drift exits 1 when a hook is added without regeneration
 *
 * Run: bunx vitest run tests/scripts/generate-docs.test.ts
 */

import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  gatherCommands,
  markerBegin,
  markerEnd,
  renderAllSections,
  uniqueHookCount,
} from "../../scripts/generate-docs.ts";

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const GENERATE = join(REPO_ROOT, "scripts/generate-docs.ts");
const DOCS_DRIFT = join(REPO_ROOT, "scripts/ci/check-docs-drift.ts");

const RUNTIME: string = (() => {
  try {
    execFileSync("bun", ["--version"], { stdio: "ignore" });
    return "bun";
  } catch {
    return process.execPath;
  }
})();

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}
function run(script: string, args: string[], cwd: string): RunResult {
  const res = spawnSync(RUNTIME, [script, ...args], { cwd, encoding: "utf8" });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/**
 * Copy the sources generate-docs reads (commands/, agents/, README.md, docs/)
 * into a throwaway repo root so tests can mutate manifests/README freely.
 */
function sandbox(): string {
  const dir = mkdtempSync(join(tmpdir(), "loom-gendocs-"));
  cpSync(join(REPO_ROOT, "commands"), join(dir, "commands"), { recursive: true });
  cpSync(join(REPO_ROOT, "agents"), join(dir, "agents"), { recursive: true });
  cpSync(join(REPO_ROOT, "docs"), join(dir, "docs"), { recursive: true });
  cpSync(join(REPO_ROOT, "README.md"), join(dir, "README.md"));
  return dir;
}

describe("generate-docs --write", () => {
  it("regenerates only marker-bounded content; narrative prose is untouched", () => {
    const dir = sandbox();
    try {
      // Perturb every generated block so a rewrite is forced, then confirm the
      // ONLY lines that change are inside markers.
      const readmePath = join(dir, "README.md");
      const before = readFileSync(readmePath, "utf8");
      const perturbed = before.replace(
        `${markerBegin("hook-count-summary")}${uniqueHookCount()}${markerEnd("hook-count-summary")}`,
        `${markerBegin("hook-count-summary")}999${markerEnd("hook-count-summary")}`,
      );
      expect(perturbed).not.toBe(before);
      writeFileSync(readmePath, perturbed);

      const res = run(GENERATE, ["--write", "--root", dir], dir);
      expect(res.status).toBe(0);

      const after = readFileSync(readmePath, "utf8");
      // Every differing line must sit inside a loom:generated marker span.
      const beforeLines = before.split("\n");
      const afterLines = after.split("\n");
      expect(afterLines.length).toBe(beforeLines.length);
      for (let i = 0; i < beforeLines.length; i++) {
        if (beforeLines[i] !== afterLines[i]) {
          expect(afterLines[i]).toContain("loom:generated:");
        }
      }
      // And the regenerated content matches the original (999 → real count).
      expect(after).toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is idempotent — a second --write changes nothing", () => {
    const dir = sandbox();
    try {
      const first = run(GENERATE, ["--write", "--root", dir], dir);
      expect(first.status).toBe(0);
      const manifestAfterFirst = readFileSync(join(dir, "docs/.generated-manifest.toon"), "utf8");

      const second = run(GENERATE, ["--write", "--root", dir], dir);
      expect(second.status).toBe(0);
      expect(second.stdout).toContain("changedFileCount: 0");
      expect(second.stdout).toContain("manifestChanged: false");
      // generatedAt is preserved across the no-op run.
      expect(readFileSync(join(dir, "docs/.generated-manifest.toon"), "utf8")).toBe(
        manifestAfterFirst,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--check exits 0 against the committed repo (docs are in sync)", () => {
    const res = run(DOCS_DRIFT, ["--check"], REPO_ROOT);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("staleCount: 0");
  });
});

describe("generated command table", () => {
  const commandsTable = () =>
    readFileSync(join(REPO_ROOT, "docs/reference/commands.md"), "utf8");

  it("lists every shipped command exactly once", () => {
    const table = commandsTable();
    const shipped = readdirSync(join(REPO_ROOT, "commands"))
      .filter((n) => n.endsWith(".md") && !n.startsWith("_"))
      .map((n) => n.slice(0, -3));
    for (const name of shipped) {
      const rowMarker = `| \`/${name}\` |`;
      const occurrences = table.split(rowMarker).length - 1;
      expect(occurrences, `command /${name} should appear exactly once`).toBe(1);
    }
    // Row count equals the number of shipped commands (no strays, no omissions).
    const rowCount = table.split("\n").filter((l) => l.startsWith("| `/")).length;
    expect(rowCount).toBe(shipped.length);
  });

  it("includes the previously-undocumented commands", () => {
    const table = commandsTable();
    for (const name of ["loom-careful", "loom-health", "loom-profile", "loom-skill"]) {
      expect(table).toContain(`| \`/${name}\` |`);
    }
  });

  it("resolves the loom-skill / loom-skillify collision with distinct rows", () => {
    const commands = gatherCommands(REPO_ROOT);
    const skill = commands.find((c) => c.name === "loom-skill");
    const skillify = commands.find((c) => c.name === "loom-skillify");
    expect(skill).toBeDefined();
    expect(skillify).toBeDefined();
    expect(skill!.description).not.toBe(skillify!.description);
    expect(skill!.description.length).toBeGreaterThan(0);
    expect(skillify!.description.length).toBeGreaterThan(0);
  });
});

describe("hook count comes from one source", () => {
  it("agrees at all four README generated sites and equals the manifest count", () => {
    const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
    const expected = String(uniqueHookCount());
    for (const section of [
      "hook-count-summary",
      "hook-count-tier",
      "hook-count-section",
      "hook-count-deepdive",
    ]) {
      const begin = markerBegin(section);
      const end = markerEnd(section);
      const beginIdx = readme.indexOf(begin);
      const endIdx = readme.indexOf(end);
      expect(beginIdx, `${section} begin marker present`).toBeGreaterThan(-1);
      const value = readme.slice(beginIdx + begin.length, endIdx);
      expect(value, `${section} shows the manifest count`).toBe(expected);
    }
  });

  it("renders the hooks table with one row per registration", () => {
    const hooksTable = renderAllSections(REPO_ROOT).find((s) => s.section === "hooks-table");
    expect(hooksTable).toBeDefined();
    const rows = hooksTable!.content.split("\n").filter((l) => l.startsWith("| `"));
    // At least one row per unique hook; context-monitor is registered twice.
    expect(rows.length).toBeGreaterThanOrEqual(uniqueHookCount());
  });
});

describe("check-docs-drift blocks source drift", () => {
  it("exits 1 when a hook is added to the manifest without regenerating", () => {
    const dir = sandbox();
    try {
      // Seed the sandbox with in-sync generated docs + manifest.
      expect(run(GENERATE, ["--write", "--root", dir], dir).status).toBe(0);
      expect(run(DOCS_DRIFT, ["--check", "--root", dir], dir).status).toBe(0);

      // Plant a new hook in the manifest copy WITHOUT regenerating the docs.
      const manifestSrc = join(dir, "scripts/lib/loom-hooks-manifest.ts");
      cpSync(
        join(REPO_ROOT, "scripts/lib/loom-hooks-manifest.ts"),
        manifestSrc,
        { recursive: true, force: true },
      );
      const original = readFileSync(manifestSrc, "utf8");
      const planted = original.replace(
        "export const LOOM_HOOKS: HookEntry[] = [",
        'export const LOOM_HOOKS: HookEntry[] = [\n  { hookName: "planted-drift-hook", event: "Stop", timeoutMs: 5000 },',
      );
      expect(planted).not.toBe(original);
      writeFileSync(manifestSrc, planted);

      // The check imports the manifest relative to generate-docs.ts, so run the
      // sandbox's own copy of both scripts to pick up the planted hook.
      cpSync(join(REPO_ROOT, "scripts/generate-docs.ts"), join(dir, "scripts/generate-docs.ts"));
      cpSync(join(REPO_ROOT, "scripts/lib/frontmatter.ts"), join(dir, "scripts/lib/frontmatter.ts"), {
        force: true,
      });
      cpSync(join(REPO_ROOT, "scripts/ci/check-docs-drift.ts"), join(dir, "scripts/ci/check-docs-drift.ts"));
      cpSync(join(REPO_ROOT, "lib"), join(dir, "lib"), { recursive: true });

      const res = run(join(dir, "scripts/ci/check-docs-drift.ts"), ["--check", "--root", dir], dir);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("DOCS_DRIFT_DETECTED");
      expect(res.stdout).toContain("hooks-table");
      expect(res.stdout).toContain("stale");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
