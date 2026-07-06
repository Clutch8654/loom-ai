/**
 * tests/meta/planted-defect.test.ts — M-07 F-13 (planted-defect meta-test).
 *
 * A meta-test verifies that a GUARD actually fires. We plant a catastrophic
 * regression into a FIXTURE — a hand-rolled `parseToon` reimplementation
 * outside lib/, the exact class of divergence the C-02 shared-core ban exists
 * to stop (protocols/shared-core.schema.md, eslint.config.js) — and prove the
 * guard's discriminating power in BOTH directions:
 *
 *   guard ENABLED  (repo eslint.config.js)            => defect is CAUGHT  (fail)
 *   guard DISABLED (no-restricted-syntax turned off)  => defect is MISSED  (pass)
 *
 * The guard-disabled direction is what makes this a real meta-test and not a
 * tautology: it proves the C-02 rule — not some unrelated lint error — is what
 * catches the plant. The fixture lives under tests/backfill/ only for the
 * duration of the test (written in beforeEach, removed in afterEach) so the
 * repo-wide `eslint .` gate never sees it.
 *
 * Run: bunx vitest run tests/meta/planted-defect.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

// Repo-relative so eslint resolves it against eslint.config.js (tests/backfill
// is NOT in the config's ignore list -> the error-tier C-02 ban applies).
const FIXTURE_REL = path.join("tests", "backfill", "__planted_defect__.ts");
const FIXTURE_ABS = path.join(REPO_ROOT, FIXTURE_REL);

/** The catastrophic regression: a divergent TOON parser reintroduced outside lib/. */
const PLANTED_DEFECT = `// PLANTED DEFECT (test fixture): a hand-rolled TOON parser outside lib/.
// The C-02 shared-core ban must reject this reimplementation.
export function parseToon(text: string): unknown {
  return JSON.parse(text);
}
`;

interface EslintRun {
  status: number | null;
  output: string;
}

function runEslint(extraArgs: string[]): EslintRun {
  const r = spawnSync(
    "bunx",
    ["eslint", ...extraArgs, FIXTURE_REL],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 60_000 },
  );
  return { status: r.status, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("planted-defect meta-test — C-02 shared-core ban", () => {
  beforeEach(() => {
    fs.mkdirSync(path.dirname(FIXTURE_ABS), { recursive: true });
    fs.writeFileSync(FIXTURE_ABS, PLANTED_DEFECT, "utf8");
  });

  afterEach(() => {
    fs.rmSync(FIXTURE_ABS, { force: true });
  });

  it("guard ENABLED catches the planted TOON-parser regression", () => {
    const { status, output } = runEslint([]);
    // eslint exits non-zero on error, and names the C-02 no-restricted-syntax rule.
    expect(status, `eslint output:\n${output}`).not.toBe(0);
    expect(output).toContain("no-restricted-syntax");
    expect(output).toContain("C-02");
    expect(output).toContain("TOON");
  });

  it("guard DISABLED misses the same regression (proves the guard is decisive)", () => {
    const { status, output } = runEslint(["--rule", "no-restricted-syntax: off"]);
    // With only the C-02 syntax ban off, the fixture is otherwise clean.
    expect(status, `eslint output:\n${output}`).toBe(0);
    expect(output).not.toContain("C-02");
  });
});
