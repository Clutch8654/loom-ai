/**
 * tests/install/install-integrity.test.ts
 *
 * P8 / F-17 (defect 14) — install.sh integrity is fail-CLOSED.
 *
 * The old installer warned-and-continued when checksums.sha256 was missing or a
 * per-file hash was absent, so a tampered or unverifiable download installed
 * silently. These tests drive the real install.sh offline (see helpers.ts) and
 * assert:
 *   - unfetchable checksums.sha256   → exit 3, nothing installed
 *   - missing per-file checksum entry → exit 3 (unverifiable is not skippable)
 *   - checksum mismatch               → exit 3, the bad artifact is rolled back
 *   - valid checksums (happy path)    → exit 0, manifest written verified: true
 *
 * Non-tautological: each case observes install.sh's real exit code and the real
 * on-disk result in a sandbox HOME, not a mocked return value.
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
  home = mkdtemp("loom-install-home-");
  srcDir = mkdtemp("loom-install-mirror-");
  sources = buildMirror(srcDir);
});

afterEach(() => {
  for (const d of [home, srcDir]) {
    if (d && fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("install.sh fail-closed integrity (F-17)", () => {
  it("aborts with exit 3 and installs nothing when checksums.sha256 is unfetchable", () => {
    writeChecksums(srcDir, sources, { absent: true });

    const r = runInstall(home, srcDir);

    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/CHECKSUM_UNVERIFIABLE/);
    // Nothing verifiable ⇒ nothing installed. Empty dirs may exist; artifacts must not.
    expect(installedArtifacts(home)).toEqual([]);
    expect(fs.existsSync(manifestPath(home))).toBe(false);
  });

  it("aborts with exit 3 when a fetched file has no checksum entry (unverifiable, not skipped)", () => {
    // library.yaml is the first file verified; omit its entry so the very first
    // verify is unverifiable. Old code warn-skipped this; new code aborts.
    writeChecksums(srcDir, sources, { omit: ["skills/library.yaml"] });

    const r = runInstall(home, srcDir);

    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/CHECKSUM_UNVERIFIABLE/);
    expect(fs.existsSync(manifestPath(home))).toBe(false);
  });

  it("aborts with exit 3 and rolls back the artifact on a checksum mismatch", () => {
    writeChecksums(srcDir, sources, { corrupt: ["skills/library.yaml"] });

    const r = runInstall(home, srcDir);

    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/CHECKSUM_UNVERIFIABLE/);
    // The fetched-then-rejected file must not survive.
    expect(fs.existsSync(claudeFile(home, "skills/library/library.yaml"))).toBe(false);
    expect(fs.existsSync(manifestPath(home))).toBe(false);
  });

  it("installs cleanly and writes a verified manifest on the happy path", () => {
    writeChecksums(srcDir, sources);

    const r = runInstall(home, srcDir);

    expect(r.status).toBe(0);
    // Artifacts present.
    expect(fs.existsSync(claudeFile(home, "skills/library/library.yaml"))).toBe(true);
    expect(installedArtifacts(home).length).toBeGreaterThan(0);

    // Manifest written verified: true, matching the InstallManifest contract.
    const mp = manifestPath(home);
    expect(fs.existsSync(mp)).toBe(true);
    const manifest = fs.readFileSync(mp, "utf8");
    expect(manifest).toMatch(/^verified: true$/m);
    expect(manifest).toMatch(/^release: v/m);
    expect(manifest).toMatch(/^installedAt: /m);
    expect(manifest).toMatch(/^artifacts\[\d+\]\{artifact,checksum,installedPath\}:/m);

    // Atomic write leaves no staging tmpfile behind.
    const loomDir = fs.readdirSync(mp.replace(/\/install-manifest\.toon$/, ""));
    expect(loomDir.some((f) => f.startsWith("install-manifest.toon."))).toBe(false);
  });
});
