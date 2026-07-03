/**
 * tests/install/helpers.ts
 *
 * Shared fixture machinery for the P8 (F-17) install-integrity + rollback
 * suites. Not a test file (no `.test.` in the name) so vitest does not collect
 * it.
 *
 * Strategy: drive the REAL install.sh end-to-end, offline, in a throwaway HOME.
 *   - LOOM_INSTALL_SRC_DIR points install.sh at a local mirror tree instead of
 *     GitHub, so no network is touched (the installer's built-in offline hook).
 *   - The mirror is built by copying every file install.sh actually fetches
 *     (parsed out of install.sh itself, so the list never drifts) plus a
 *     generated checksums.sha256. Cases mutate/omit/corrupt that manifest to
 *     exercise the fail-closed paths.
 *   - A no-op `claude` shim is prepended to PATH so the plugin-conflict
 *     preflight (`claude plugin list | grep loom`) sees no plugins and the
 *     installer proceeds. HOME is a fresh temp dir so nothing leaks into the
 *     developer's real ~/.claude or ~/.loom.
 */

import { spawnSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const INSTALL_SH = path.join(REPO_ROOT, "install.sh");

/**
 * Parse the source paths install.sh fetches out of its own array literals so
 * the fixture list tracks the installer automatically. Entries look like
 * `  "commands/loom.md:${CLAUDE_DIR}/commands/loom.md"`; we capture the part
 * before `:${CLAUDE_DIR}`. `skills/library.yaml` is fetched by a separate
 * code path, so it is added explicitly.
 */
export function installSources(): string[] {
  const sh = fs.readFileSync(INSTALL_SH, "utf8");
  const re = /"([^":]+):\$\{CLAUDE_DIR\}/g;
  const seen = new Set<string>(["skills/library.yaml"]);
  let m: RegExpExecArray | null;
  while ((m = re.exec(sh)) !== null) {
    seen.add(m[1]);
  }
  return [...seen];
}

export function sha256(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function mkdtemp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Build the offline mirror. Copies each fetched file from the repo; for any
 * listed source missing on disk (should not happen, but keeps the integrity
 * suite hermetic and focused rather than failing on unrelated drift) a small
 * stub is synthesized so fetch + checksum still exercise the real paths.
 */
export function buildMirror(srcDir: string): string[] {
  const sources = installSources();
  for (const src of sources) {
    const from = path.join(REPO_ROOT, src);
    const to = path.join(srcDir, src);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (fs.existsSync(from) && fs.statSync(from).isFile()) {
      fs.copyFileSync(from, to);
    } else {
      fs.writeFileSync(to, `# stub for ${src}\n`);
    }
  }
  return sources;
}

export interface ChecksumOptions {
  /** Source paths to leave OUT of checksums.sha256 (unverifiable → exit 3). */
  omit?: string[];
  /** Source paths whose recorded hash is corrupted (mismatch → exit 3). */
  corrupt?: string[];
  /** If true, do not write checksums.sha256 at all (unfetchable → exit 3). */
  absent?: boolean;
}

/** Write checksums.sha256 into the mirror (sha256sum format: `<hash>  <path>`). */
export function writeChecksums(
  srcDir: string,
  sources: string[],
  opts: ChecksumOptions = {},
): void {
  const target = path.join(srcDir, "checksums.sha256");
  if (opts.absent) {
    if (fs.existsSync(target)) fs.rmSync(target);
    return;
  }
  const omit = new Set(opts.omit ?? []);
  const corrupt = new Set(opts.corrupt ?? []);
  const lines: string[] = [];
  for (const src of sources) {
    if (omit.has(src)) continue;
    let hash = sha256(path.join(srcDir, src));
    if (corrupt.has(src)) {
      // Flip to an obviously-wrong but well-formed 64-hex digest.
      hash = "0".repeat(64);
    }
    lines.push(`${hash}  ${src}`);
  }
  fs.writeFileSync(target, lines.join("\n") + "\n");
}

/** A directory containing an executable `claude` that reports no plugins. */
export function makeClaudeShim(baseDir: string): string {
  const shimDir = path.join(baseDir, "shim-bin");
  fs.mkdirSync(shimDir, { recursive: true });
  const shim = path.join(shimDir, "claude");
  fs.writeFileSync(shim, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(shim, 0o755);
  return shimDir;
}

export interface InstallRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

export function runInstall(home: string, srcDir: string): InstallRun {
  const shimDir = makeClaudeShim(home);
  const r = spawnSync("bash", [INSTALL_SH], {
    env: {
      ...process.env,
      HOME: home,
      LOOM_INSTALL_SRC_DIR: srcDir,
      PATH: `${shimDir}:${process.env.PATH ?? ""}`,
    },
    encoding: "utf8",
    timeout: 60_000,
  });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

/** Convenience path accessors for a sandbox HOME. */
export function claudeFile(home: string, rel: string): string {
  return path.join(home, ".claude", rel);
}
export function manifestPath(home: string): string {
  return path.join(home, ".loom", "install-manifest.toon");
}

/**
 * Recursively list every regular file install.sh wrote under ~/.claude,
 * relative to that root. Empty directories (install.sh mkdirs them up front)
 * are ignored — "installs nothing" means no artifacts, not no directories.
 */
export function installedArtifacts(home: string): string[] {
  const root = path.join(home, ".claude");
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile()) out.push(path.relative(root, full));
    }
  };
  walk(root);
  return out;
}
