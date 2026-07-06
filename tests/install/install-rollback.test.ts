/**
 * tests/install/install-rollback.test.ts
 *
 * P8 / F-17 (defect 14) — trap-based rollback of partial installs.
 *
 * When integrity verification fails partway through, the EXIT trap must remove
 * every artifact already written, not just the one that failed. We corrupt the
 * checksum of a file that install.sh fetches LATE (a command file, after
 * library.yaml and all infrastructure), run the installer against a sandbox
 * HOME, and assert that the earlier, already-installed artifacts are gone —
 * proving the trap walked the recorded-path list, not just the failing file.
 *
 * Non-tautological: observes real on-disk state after a real subprocess abort.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import {
  buildMirror,
  claudeFile,
  installedArtifacts,
  manifestPath,
  mkdtemp,
  runInstall,
  writeChecksums,
} from "./helpers";

let home: string;
let srcDir: string;
let sources: string[];

beforeEach(() => {
  home = mkdtemp("loom-rollback-home-");
  srcDir = mkdtemp("loom-rollback-mirror-");
  sources = buildMirror(srcDir);
});

afterEach(() => {
  for (const d of [home, srcDir]) {
    if (d && fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("install.sh partial-install rollback (F-17)", () => {
  it("removes every earlier artifact when a late file fails verification", () => {
    // Sanity: the corruption target must be fetched after library.yaml so that
    // at least one artifact is on disk before the abort.
    expect(sources).toContain("commands/loom.md");
    expect(sources).toContain("skills/library.yaml");

    writeChecksums(srcDir, sources, { corrupt: ["commands/loom.md"] });

    const r = runInstall(home, srcDir);

    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/CHECKSUM_UNVERIFIABLE/);
    expect(r.stderr).toMatch(/ROLLBACK/);

    // The failing file and every earlier artifact must be gone.
    expect(fs.existsSync(claudeFile(home, "commands/loom.md"))).toBe(false);
    expect(fs.existsSync(claudeFile(home, "skills/library/library.yaml"))).toBe(false);

    // Post-condition: no artifacts remain on disk at all.
    expect(installedArtifacts(home)).toEqual([]);

    // No manifest is written when the install did not complete.
    expect(fs.existsSync(manifestPath(home))).toBe(false);
  });

  it("does not report ROLLBACK_FAILED on a clean rollback", () => {
    writeChecksums(srcDir, sources, { corrupt: ["commands/loom.md"] });

    const r = runInstall(home, srcDir);

    expect(r.status).toBe(3);
    expect(r.stderr).not.toMatch(/ROLLBACK_FAILED/);
  });
});
