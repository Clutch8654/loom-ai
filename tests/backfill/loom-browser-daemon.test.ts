/**
 * tests/backfill/loom-browser-daemon.test.ts
 *
 * Behavioral backfill for scripts/loom-browser-daemon.ts (F-11, defect 6 —
 * Phase 14b batch B1). The daemon exports no functions (its logic is reachable
 * only through main()), so — per the batch spec — we exercise it via a real
 * subprocess rather than an in-process import, asserting on its observable
 * output: stdout phase, exit code, and the queue file it writes.
 *
 * Isolation comes from the shared backfill template's sandbox: the daemon reads
 * and writes `.loom/browser/` relative to process.cwd(), so we point the child's
 * cwd at the sandbox and confirm every artifact lands there. P14a's isMain guard
 * means the module is import-safe, but with nothing exported the subprocess is
 * the only way to drive real behavior.
 *
 * Run: bunx vitest run tests/backfill/loom-browser-daemon.test.ts
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { createSandbox } from "../helpers/backfill-template.js";

const SCRIPT = resolve(process.cwd(), "scripts/loom-browser-daemon.ts");

/** Run the daemon as a `bun` subprocess with cwd/HOME pinned to the sandbox. */
function runDaemon(cwd: string, home: string, args: string[]) {
  return spawnSync("bun", [SCRIPT, ...args], {
    cwd,
    encoding: "utf-8",
    timeout: 30_000,
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
}

describe("loom-browser-daemon status (no state → stopped)", () => {
  it("reports the stopped phase and exits 0 when no state file exists", () => {
    const sandbox = createSandbox({ chdir: false });
    try {
      const r = runDaemon(sandbox.cwd, sandbox.home, ["status"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("phase: stopped");
    } finally {
      sandbox.cleanup();
    }
  });

  it("reports the crashed phase for a state file whose pid is not alive", () => {
    const sandbox = createSandbox({ chdir: false });
    try {
      // A pid that is essentially never alive → isPidAlive() false → crashed.
      sandbox.write(
        "cwd/.loom/browser/state.toon",
        ["schemaVersion: 1", "daemonPid: 2147483646", "daemonPort: 9222", ""].join(
          "\n",
        ),
      );
      const r = runDaemon(sandbox.cwd, sandbox.home, ["status"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("phase: crashed");
      expect(r.stdout).toContain("daemonPid: 2147483646");
    } finally {
      sandbox.cleanup();
    }
  });
});

describe("loom-browser-daemon exec (no daemon → hard fail)", () => {
  it("exits non-zero with DAEMON_NOT_RUNNING when the daemon is down (no silent queue)", () => {
    const sandbox = createSandbox({ chdir: false });
    try {
      const r = runDaemon(sandbox.cwd, sandbox.home, ["exec", "navigate", "https://x"]);
      // Daemon-down is a HARD non-zero failure — the queue-return-0 stub was
      // removed (execCmd preflight, daemon-preflight.schema.md C-07). It must
      // never silent-skip / queue-return-0.
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("DAEMON_NOT_RUNNING");
      const queue = sandbox.read("cwd/.loom/browser/queue.toon");
      expect(queue).toBeNull();
    } finally {
      sandbox.cleanup();
    }
  });
});

describe("loom-browser-daemon usage (unknown subcommand)", () => {
  it("prints usage to stderr and exits 2 on an unknown subcommand", () => {
    const sandbox = createSandbox({ chdir: false });
    try {
      const r = runDaemon(sandbox.cwd, sandbox.home, ["frobnicate"]);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("USAGE: loom-browser <start|stop|status|exec>");
    } finally {
      sandbox.cleanup();
    }
  });
});
