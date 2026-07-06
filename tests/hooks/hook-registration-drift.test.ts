/**
 * tests/hooks/hook-registration-drift.test.ts — Phase 13 convergence guard
 * (F-10, scenario S-01, contract protocols/ci-gates.contract.md).
 *
 * Phase 13 reconciled the three hook-registration sources so they agree:
 *   1. .claude/settings.json              — live registrations
 *   2. hooks/hooks.json                   — plugin template
 *   3. scripts/lib/loom-hooks-manifest.ts — canonical LOOM_HOOKS manifest
 *
 * These tests spawn scripts/ci/check-hook-drift.ts against the REAL repo
 * sources (no --warn-only) and assert it exits 0 with zero drift — i.e. the
 * pr-gate hook-drift check, now blocking, stays green. The adversarial
 * fixture cases (divergent sources → exit 1, matcher normalization, unreadable
 * source → exit 3) live in tests/ci/drift-checks.test.ts.
 *
 * Run: bunx vitest run tests/hooks/hook-registration-drift.test.ts
 */

import { describe, it, expect, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const HOOK_DRIFT = join(REPO_ROOT, "scripts/ci/check-hook-drift.ts");

/** Prefer bun (repo toolchain); node ≥22.6 also runs these scripts directly. */
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

function run(args: string[]): RunResult {
  const res = spawnSync(RUNTIME, [HOOK_DRIFT, ...args], { cwd: REPO_ROOT, encoding: "utf8" });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

describe("hook-registration drift (S-01: three sources agree)", () => {
  const tempDirs: string[] = [];
  afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  });

  function reportPath(): string {
    const dir = mkdtempSync(join(tmpdir(), "loom-hook-drift-s01-"));
    tempDirs.push(dir);
    return join(dir, "hook-drift.toon");
  }

  it("exits 0 with driftCount 0 against the real repo sources (blocking)", () => {
    const out = reportPath();
    const res = run(["--report", out]);

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("driftCount: 0");
    // No HOOK_DRIFT_DETECTED anywhere — blocking check is green.
    expect(res.stderr).not.toContain("HOOK_DRIFT_DETECTED");
    expect(res.stdout).not.toContain("HOOK_DRIFT_DETECTED");
  });

  it("registers context-budget on PreToolUse/Agent in all three sources (defect 10 fix)", () => {
    const out = reportPath();
    const res = run(["--report", out]);

    expect(res.status).toBe(0);
    const report = readFileSync(out, "utf8");
    // The reconciled row: correct event (not the inert Write|Edit), present in
    // all three sources, no drift.
    expect(report).toMatch(
      /context-budget,PreToolUse,Agent,settings\+hooks\.json\+manifest,true,none/,
    );
    // Every hook row must resolve to drift=none.
    expect(report).not.toMatch(/,(missing-source|event-mismatch|dead-file)\s*$/m);
  });

  it("writes the drift report atomically (no .tmp residue)", () => {
    const out = reportPath();
    const res = run(["--report", out]);

    expect(res.status).toBe(0);
    expect(existsSync(out)).toBe(true);
    expect(existsSync(`${out}.tmp`)).toBe(false);
  });
});
