/**
 * tests/backfill/agent-result-validator.test.ts
 *
 * Behavioral backfill for hooks/agent-result-validator.ts (PLAN-exceed-gstack
 * Phase 14b BATCH B2, F-11, defect 6). The validator (fixed + registered in
 * Wave 2) enforces the AgentResult findings[] contract: required fields id,
 * category, severity, confidence — with confidence constrained to an integer
 * 1..10. It runs through the runHook harness, so a violating envelope prints
 * `{decision:"block"}` and exits 2 while a clean one exits 0.
 *
 * We drive the REAL hook over its PostToolUse stdin protocol (a Write payload
 * carrying inline `.toon` content) and assert exit code + stdout/stderr via the
 * template's assertOutcome. We also call the exported `validateAgentResultToon`
 * directly to pin its input → violations behavior (notably blocking on an
 * out-of-range confidence). No source-grep.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as path from "node:path";

import { assertOutcome, type RunOutcome } from "../helpers/backfill-template.js";
import { validateAgentResultToon } from "../../hooks/agent-result-validator.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const HOOK = path.join(REPO_ROOT, "hooks", "agent-result-validator.ts");

function toOutcome(res: ReturnType<typeof spawnSync>): RunOutcome<never> {
  return {
    returned: undefined,
    threw: res.error ?? null,
    exitCode: res.status,
    stdout: res.stdout == null ? "" : String(res.stdout),
    stderr: res.stderr == null ? "" : String(res.stderr),
  };
}

/** Feed a PostToolUse Write payload with inline `.toon` content. */
function runValidator(content: string): RunOutcome<never> {
  const payload = {
    hook_event_name: "PostToolUse",
    tool_name: "Write",
    tool_input: { file_path: ".plan-execution/ephemeral/result.toon", content },
  };
  return toOutcome(
    spawnSync("bun", [HOOK], {
      input: JSON.stringify(payload),
      encoding: "utf8",
      timeout: 20_000,
      env: { ...process.env },
    }),
  );
}

const VALID_ENVELOPE = [
  "agent: implementer-agent",
  "status: success",
  "findings[1]{id,category,severity,confidence,message}:",
  "  F-1,correctness,high,8,Off-by-one in loop bound",
  "",
].join("\n");

const BAD_CONFIDENCE = [
  "agent: implementer-agent",
  "status: success",
  "findings[1]{id,category,severity,confidence,message}:",
  "  F-1,correctness,high,99,Confidence out of range",
  "",
].join("\n");

describe("agent-result-validator hook (backfill, stdin/stdout protocol)", () => {
  it("blocks an envelope whose confidence is out of the 1..10 range", () => {
    const outcome = runValidator(BAD_CONFIDENCE);
    assertOutcome(outcome, {
      exitCode: 2,
      stdoutIncludes: '"decision":"block"',
      stderrIncludes: "FINDING_MISSING_CONFIDENCE",
    });
  });

  it("allows a well-formed findings envelope (exit 0)", () => {
    const outcome = runValidator(VALID_ENVELOPE);
    assertOutcome(outcome, { exitCode: 0 });
    expect(outcome.stdout).toBe("");
  });

  it("validateAgentResultToon returns violations for bad confidence, none for valid (real logic)", () => {
    const bad = validateAgentResultToon(BAD_CONFIDENCE);
    expect(bad.length).toBeGreaterThan(0);
    expect(bad.join("\n")).toContain("FINDING_MISSING_CONFIDENCE");

    expect(validateAgentResultToon(VALID_ENVELOPE)).toEqual([]);

    // A header missing the required `confidence` column is also blocking.
    const missingColumn = [
      "findings[1]{id,category,severity,message}:",
      "  F-2,correctness,low,No confidence column",
    ].join("\n");
    expect(validateAgentResultToon(missingColumn).length).toBeGreaterThan(0);

    // Non-envelope content is not a findings block — allowed (no violations).
    expect(validateAgentResultToon("just: some\nkey: value\n")).toEqual([]);
  });
});
