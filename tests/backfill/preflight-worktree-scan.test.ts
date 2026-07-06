/**
 * tests/backfill/preflight-worktree-scan.test.ts
 *
 * Behavioral backfill for hooks/preflight-worktree-scan.ts (PLAN-exceed-gstack
 * Phase 14b BATCH B2, F-11, defect 6). This PreToolUse Bash hook watches for
 * `/loom-git pr` invocations and runs the cross-worktree scanner, emitting
 * advisory stderr findings on overlap. It is ALWAYS non-blocking: every path
 * exits 0.
 *
 * We drive the REAL hook over its stdin protocol from an isolated sandbox cwd
 * (so no real scanner is found and no real scan runs) and assert the always-0
 * exit via the template's assertOutcome. We also exercise the exported pure
 * predicates `isLoomGitPr` / `parseOverlapCount` directly — input → observable
 * output, never source-grep.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as path from "node:path";

import {
  withSandbox,
  assertOutcome,
  type RunOutcome,
} from "../helpers/backfill-template.js";
import {
  isLoomGitPr,
  parseOverlapCount,
} from "../../hooks/preflight-worktree-scan.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const HOOK = path.join(REPO_ROOT, "hooks", "preflight-worktree-scan.ts");

function toOutcome(res: ReturnType<typeof spawnSync>): RunOutcome<never> {
  return {
    returned: undefined,
    threw: res.error ?? null,
    exitCode: res.status,
    stdout: res.stdout == null ? "" : String(res.stdout),
    stderr: res.stderr == null ? "" : String(res.stderr),
  };
}

/** Feed a Bash payload on stdin, running from an isolated cwd. */
function runHook(
  payload: unknown,
  cwd: string,
  extraEnv: Record<string, string> = {},
): RunOutcome<never> {
  return toOutcome(
    spawnSync("bun", [HOOK], {
      input: JSON.stringify(payload),
      cwd,
      encoding: "utf8",
      timeout: 20_000,
      env: { ...process.env, ...extraEnv },
    }),
  );
}

describe("preflight-worktree-scan hook (backfill, stdin/stdout protocol)", () => {
  it("passes through a non-loom-git-pr command silently (exit 0)", async () => {
    await withSandbox(async (box) => {
      const outcome = runHook(
        { tool_name: "Bash", tool_input: { command: "git status" } },
        box.cwd,
      );
      assertOutcome(outcome, { exitCode: 0 });
      expect(outcome.stdout).toBe("");
      expect(outcome.stderr).toBe("");
    });
  });

  it("stays non-blocking (exit 0) on a `/loom-git pr` command with no scanner present", async () => {
    await withSandbox(async (box) => {
      // The isolated sandbox cwd has no scripts/loom-worktree-scan.ts within
      // reach, so the hook finds no scanner and silently allows.
      const outcome = runHook(
        { tool_name: "Bash", tool_input: { command: "/loom-git pr" } },
        box.cwd,
      );
      assertOutcome(outcome, { exitCode: 0 });
    });
  });

  it("honors the disable env var (exit 0)", async () => {
    await withSandbox(async (box) => {
      const outcome = runHook(
        { tool_name: "Bash", tool_input: { command: "/loom-git pr" } },
        box.cwd,
        { LOOM_WORKTREE_PREFLIGHT_DISABLE: "1" },
      );
      assertOutcome(outcome, { exitCode: 0 });
    });
  });

  it("ignores non-Bash tool calls (exit 0)", async () => {
    await withSandbox(async (box) => {
      const outcome = runHook(
        { tool_name: "Write", tool_input: { command: "/loom-git pr" } },
        box.cwd,
      );
      assertOutcome(outcome, { exitCode: 0 });
    });
  });

  it("isLoomGitPr / parseOverlapCount decide correctly (real logic)", () => {
    expect(isLoomGitPr("/loom-git pr")).toBe(true);
    expect(isLoomGitPr("bun scripts/loom-git.ts pr --draft")).toBe(true);
    expect(isLoomGitPr("git status")).toBe(false);
    expect(isLoomGitPr("")).toBe(false);

    expect(parseOverlapCount("overlapCount: 3\nother: x")).toBe(3);
    expect(parseOverlapCount("overlapCount: 0")).toBe(0);
    expect(parseOverlapCount("no count here")).toBe(0);
  });
});
