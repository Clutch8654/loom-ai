/**
 * tests/backfill/loom-careful.test.ts
 *
 * Behavioral backfill for hooks/loom-careful.ts (PLAN-exceed-gstack Phase 14b
 * BATCH B2, F-11, defect 6). loom-careful is a PreToolUse Bash guard that
 * follows Claude Code's hook stdin/stdout JSON protocol: it reads a
 * `{tool_name, tool_input:{command}}` payload on stdin and, on a blocked
 * command, prints `{decision:"deny", reason}` and exits 2; otherwise exits 0.
 *
 * We test the REAL protocol behavior by spawning the hook and feeding stdin,
 * asserting on exit code + stdout (via the template's assertOutcome), and we
 * also exercise the exported `evaluate()` decision function directly on
 * representative commands — input → observable verdict, never source-grep.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as path from "node:path";

import { assertOutcome, type RunOutcome } from "../helpers/backfill-template.js";
import { evaluate } from "../../hooks/loom-careful.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const HOOK = path.join(REPO_ROOT, "hooks", "loom-careful.ts");

function toOutcome(res: ReturnType<typeof spawnSync>): RunOutcome<never> {
  return {
    returned: undefined,
    threw: res.error ?? null,
    exitCode: res.status,
    stdout: res.stdout == null ? "" : String(res.stdout),
    stderr: res.stderr == null ? "" : String(res.stderr),
  };
}

/** Feed a hook payload on stdin and capture the observable outcome. */
function runHook(
  payload: unknown,
  extraEnv: Record<string, string> = {},
): RunOutcome<never> {
  return toOutcome(
    spawnSync("bun", [HOOK], {
      input: JSON.stringify(payload),
      encoding: "utf8",
      timeout: 20_000,
      env: { ...process.env, ...extraEnv },
    }),
  );
}

describe("loom-careful hook (backfill, stdin/stdout protocol)", () => {
  it("blocks a destructive `rm -rf /` with a deny decision and exit 2", () => {
    const outcome = runHook({
      tool_name: "Bash",
      tool_input: { command: "rm -rf /" },
    });
    assertOutcome(outcome, {
      exitCode: 2,
      stdoutIncludes: ['"decision":"deny"', "CAREFUL_BLOCKED"],
    });
  });

  it("allows a harmless command with exit 0 and no deny payload", () => {
    const outcome = runHook({
      tool_name: "Bash",
      tool_input: { command: "ls -la" },
    });
    assertOutcome(outcome, { exitCode: 0 });
    expect(outcome.stdout).toBe("");
  });

  it("fails open (exit 0) when the override env var is set", () => {
    const outcome = runHook(
      { tool_name: "Bash", tool_input: { command: "git push --force" } },
      { LOOM_CAREFUL_OVERRIDE: "1" },
    );
    assertOutcome(outcome, { exitCode: 0 });
    expect(outcome.stdout).toBe("");
  });

  it("ignores non-Bash tool calls (exit 0)", () => {
    const outcome = runHook({
      tool_name: "Write",
      tool_input: { command: "rm -rf /" },
    });
    assertOutcome(outcome, { exitCode: 0 });
  });

  it("evaluate() flags dangerous commands and passes safe ones (real logic)", () => {
    expect(evaluate("git push --force origin main").blocked).toBe(true);
    expect(evaluate("DROP TABLE users;").blocked).toBe(true);
    expect(evaluate("chmod -R 777 /etc").blocked).toBe(true);
    expect(evaluate("echo hello && ls").blocked).toBe(false);
    expect(evaluate("git push origin feature").blocked).toBe(false);
  });
});
