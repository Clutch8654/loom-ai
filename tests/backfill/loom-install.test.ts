/**
 * tests/backfill/loom-install.test.ts
 *
 * Behavioral backfill for scripts/loom-install.ts (F-11, defect 6 — Phase 14b
 * batch B1). The end-to-end install/rollback flow is covered by the offline
 * install.sh suite (tests/install/*); this file pins the pure argument-parsing,
 * manifest render/parse, and host-target-path logic that those flows depend on.
 *
 * The module is ESM-entry-guarded (compares process.argv[1] to import.meta.url),
 * so importing it runs no main(). We drive only the exported pure functions and
 * never call cmdLink/cmdCheck, so nothing is written to the real
 * `~/.loom/install-manifest.toon`. `hostTargetPath` is checked inside a template
 * sandbox whose HOME is isolated, proving the path is anchored under os.homedir().
 *
 * Run: bunx vitest run tests/backfill/loom-install.test.ts
 */

import { describe, it, expect } from "vitest";
import { runAndAssert, withSandbox } from "../helpers/backfill-template.js";
import {
  parseArgs,
  parseManifest,
  renderManifest,
  hostTargetPath,
  VALID_HOSTS,
} from "../../scripts/loom-install.js";
import type { InstallManifest } from "../../scripts/loom-install.js";

describe("loom-install parseArgs (argv → {action, host})", () => {
  it("defaults to a --check action against the claude-code host", () => {
    expect(parseArgs([])).toEqual({ action: "check", host: "claude-code" });
  });

  it("parses an action flag together with a --host override", () => {
    expect(parseArgs(["--link", "--host", "hermes"])).toEqual({
      action: "link",
      host: "hermes",
    });
    expect(parseArgs(["--unlink", "--host=openclaw"])).toEqual({
      action: "unlink",
      host: "openclaw",
    });
  });

  it("rejects an unknown host", () => {
    expect(() => parseArgs(["--host", "bogus"])).toThrow(/Invalid --host/);
  });

  it("rejects an unknown argument", () => {
    expect(() => parseArgs(["--frobnicate"])).toThrow(/Unknown argument/);
  });

  it("prints help and exits 0 on --help", async () => {
    await runAndAssert(() => parseArgs(["--help"]), {
      exitCode: 0,
      stdoutIncludes: "loom-install — direct-symlink install path for Loom",
    });
  });
});

describe("loom-install manifest render ↔ parse round-trip", () => {
  it("parses back exactly what it rendered", () => {
    const manifest: InstallManifest = {
      schemaVersion: 1,
      installMode: "direct-symlink",
      sourcePath: "/repo/loom-ai",
      targetPath: "/home/u/.claude/skills/loom",
      installedAt: "2026-07-03T12:00:00.000Z",
      loomVersion: "1.4.2",
      hostBindings: [
        { host: "claude-code", path: "/home/u/.claude/skills/loom" },
        { host: "hermes", path: "/home/u/.hermes/skills/loom" },
      ],
    };
    expect(parseManifest(renderManifest(manifest))).toEqual(manifest);
  });

  it("rejects a manifest naming a host outside the allowed set", () => {
    const text = [
      "schemaVersion: 1",
      "installMode: direct-symlink",
      "sourcePath: /repo",
      "targetPath: /t",
      "installedAt: 2026-07-03T12:00:00.000Z",
      'loomVersion: "1.0.0"',
      "hostBindings[1]{host,path}:",
      "  martian,/t",
      "",
    ].join("\n");
    expect(() => parseManifest(text)).toThrow(/INSTALL_MANIFEST_INVALID/);
  });

  it("rejects a manifest missing a required field", () => {
    // No installMode / sourcePath / etc. → fail-closed parse error.
    expect(() => parseManifest("schemaVersion: 1\n")).toThrow(
      /INSTALL_MANIFEST_INVALID/,
    );
  });
});

describe("loom-install hostTargetPath (host → skills dir under HOME)", () => {
  it("anchors every valid host under the sandbox HOME", async () => {
    await withSandbox(async (sandbox) => {
      const suffixByHost: Record<string, string> = {
        "claude-code": ".claude/skills/loom",
        hermes: ".hermes/skills/loom",
        openclaw: ".openclaw/skills/loom",
        codex: ".codex/skills/loom",
      };
      for (const host of VALID_HOSTS) {
        const target = hostTargetPath(host);
        expect(target.startsWith(sandbox.home)).toBe(true);
        expect(target.endsWith(suffixByHost[host])).toBe(true);
      }
    });
  });
});
