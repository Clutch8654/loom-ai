/**
 * tests/ci/browser-ci-wiring.test.ts — Phase 9a (PLAN-browser-e2e).
 *
 * Asserts the CI wiring facts by STRUCTURALLY parsing the two workflow YAMLs
 * (no `yaml` dep is present in the repo — mirrors tests/eval/t3-gating.test.ts,
 * which reads the workflow text directly). Small purpose-built helpers extract
 * top-level job names, a single job's block, the `gate-status: needs:` list, and
 * per-job flags — enough to assert the wiring without a full YAML parser.
 *
 * The load-bearing invariants (from the P9a acceptance criteria):
 *   1. The PR fixture job exists AND is ADDITIVE — it is NOT in gate-status
 *      `needs:`, so the frozen 6-check branch-protection interface
 *      (protocols/ci-gates.contract.md, checks[6]) is untouched.
 *   2. The nightly LIVE daemon-e2e job exists with `continue-on-error: true`.
 *   3. The nightly qa-outcome job exists AND runs the SCORED path (injects a
 *      reporter via an in-process runner), not the CLI's no-reporter skip.
 *
 * Run: bunx vitest run tests/ci/browser-ci-wiring.test.ts
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PR_GATE = fs.readFileSync(
  path.join(REPO_ROOT, ".github/workflows/pr-gate.yml"),
  "utf8",
);
const NIGHTLY = fs.readFileSync(
  path.join(REPO_ROOT, ".github/workflows/nightly-gate.yml"),
  "utf8",
);

/* ────────────────────────────────────────────────────────────────────────
 * Minimal structural YAML helpers (workflow-shaped: top-level `jobs:` with
 * 2-space-indented job headers; everything inside a job is >=4-space).
 * ──────────────────────────────────────────────────────────────────────── */

/** A job header line: exactly 2-space indent, `name:` with nothing after. */
const JOB_HEADER = /^ {2}(\S[^:]*):\s*$/;

/** Top-level job names declared under `jobs:`. */
function topLevelJobs(yml: string): string[] {
  const lines = yml.split("\n");
  const jobsIdx = lines.findIndex((l) => l.trimEnd() === "jobs:");
  if (jobsIdx < 0) return [];
  const jobs: string[] = [];
  for (let i = jobsIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === "") continue;
    // A new column-0 key ends the jobs block.
    if (/^\S/.test(l)) break;
    const m = JOB_HEADER.exec(l);
    if (m) jobs.push(m[1]);
  }
  return jobs;
}

/** The text block for a single job (header through the next job / EOF). */
function jobBlock(yml: string, job: string): string {
  const lines = yml.split("\n");
  const start = lines.findIndex((l) => l === `  ${job}:`);
  if (start < 0) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (JOB_HEADER.test(lines[i]) || /^\S/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** The `- name` items under the `gate-status` job's `needs:` list. */
function gateStatusNeeds(yml: string): string[] {
  const block = jobBlock(yml, "gate-status").split("\n");
  const nIdx = block.findIndex((l) => l.trim() === "needs:");
  if (nIdx < 0) return [];
  const needs: string[] = [];
  for (let i = nIdx + 1; i < block.length; i++) {
    const m = /^\s*-\s*(\S+)\s*$/.exec(block[i]);
    if (m) needs.push(m[1]);
    else if (block[i].trim() !== "") break; // end of the list
  }
  return needs;
}

/* ────────────────────────────────────────────────────────────────────────
 * Sanity: the helpers agree with the KNOWN frozen 6-check set (guards against
 * a parser that silently returns [] and makes every assertion vacuous).
 * ──────────────────────────────────────────────────────────────────────── */

const FROZEN_SIX = [
  "typecheck",
  "lint",
  "changed-file-tests",
  "hook-drift",
  "docs-drift",
  "library-catalog",
];

describe("structural helpers parse the workflows", () => {
  it("finds the frozen 6-check set in the PR gate-status needs", () => {
    const needs = gateStatusNeeds(PR_GATE);
    expect(needs).toEqual(FROZEN_SIX);
  });

  it("lists the expected core jobs in each workflow", () => {
    expect(topLevelJobs(PR_GATE)).toEqual(
      expect.arrayContaining([...FROZEN_SIX, "eval-t1", "gate-status"]),
    );
    expect(topLevelJobs(NIGHTLY)).toEqual(
      expect.arrayContaining(["full-suite", "docker-e2e", "gate-status"]),
    );
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * 1. PR fixture job is ADDITIVE — present, but NOT a frozen required check.
 * ──────────────────────────────────────────────────────────────────────── */

describe("PR tier: browser fixture-parser job is additive (never in the frozen 6-check set)", () => {
  it("declares a browser-fixture-tests job", () => {
    expect(topLevelJobs(PR_GATE)).toContain("browser-fixture-tests");
  });

  it("does NOT add the fixture job to the gate-status needs (frozen set untouched)", () => {
    const needs = gateStatusNeeds(PR_GATE);
    expect(needs).not.toContain("browser-fixture-tests");
    // The frozen set is EXACTLY the six checks — no more, no fewer.
    expect(needs).toEqual(FROZEN_SIX);
    expect(needs).toHaveLength(6);
  });

  it("runs the OFFLINE fixture-parser + browser-skill suites", () => {
    const block = jobBlock(PR_GATE, "browser-fixture-tests");
    expect(block).toContain("bunx vitest run");
    for (const p of [
      "tests/browser",
      "tests/skills",
      "tests/eval",
      "skills/browser-skills",
    ]) {
      expect(block).toContain(p);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * 2. Nightly live daemon-e2e job — present, continue-on-error, advisory.
 * ──────────────────────────────────────────────────────────────────────── */

describe("Nightly tier: live daemon-e2e job (docker-e2e pattern, never blocks)", () => {
  it("declares a daemon-e2e job", () => {
    expect(topLevelJobs(NIGHTLY)).toContain("daemon-e2e");
  });

  it("runs the live daemon-e2e suite with continue-on-error (opt-in, self-skips)", () => {
    const block = jobBlock(NIGHTLY, "daemon-e2e");
    expect(block).toContain("continue-on-error: true");
    expect(block).toContain("tests/browser/daemon-e2e.test.ts");
    expect(block).toContain("LOOM_BROWSER_E2E");
  });

  it("is not a PR-blocking check (lives only in the nightly workflow)", () => {
    expect(topLevelJobs(PR_GATE)).not.toContain("daemon-e2e");
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * 3. Nightly qa-outcome job — present, runs the SCORED (reporter-injected)
 *    path, not the CLI's no-reporter advisory skip.
 * ──────────────────────────────────────────────────────────────────────── */

describe("Nightly tier: qa-outcome scored eval job", () => {
  it("declares a qa-outcome job with continue-on-error", () => {
    expect(topLevelJobs(NIGHTLY)).toContain("qa-outcome");
    const block = jobBlock(NIGHTLY, "qa-outcome");
    expect(block).toContain("continue-on-error: true");
  });

  it("runs the SCORED path by injecting a reporter (not the CLI no-reporter skip)", () => {
    const block = jobBlock(NIGHTLY, "qa-outcome");
    // A real in-process scored runner that wires runQaOutcome with a reporter.
    expect(block).toContain("runQaOutcome");
    expect(block).toContain("reporter");
    expect(block).toContain("driveFixture");
    // The executed step must run the scored runner, not the bare CLI (which
    // advisory-skips with no reporter). Check the `run:` lines specifically so a
    // comment mentioning the CLI does not trip the assertion.
    const runLines = block
      .split("\n")
      .filter((l) => /^\s*run:/.test(l) || /^\s*- run:/.test(l));
    expect(block).toContain("bun .loom-ci/qa-outcome-scored.ts");
    for (const l of runLines) {
      expect(l).not.toContain("run-evals.ts --tier qa-outcome");
    }
  });

  it("is not a PR-blocking check", () => {
    expect(topLevelJobs(PR_GATE)).not.toContain("qa-outcome");
  });
});
