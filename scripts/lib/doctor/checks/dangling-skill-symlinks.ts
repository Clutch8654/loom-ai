/**
 * dangling-skill-symlinks — scans `~/.claude/skills/` (per-skill `SKILL.md`
 * links and the `library/library.yaml` catalog link) for symlinks whose
 * target no longer exists, or whose target lives inside a linked git
 * worktree (`/.worktrees/` or `/.claude/worktrees/`).
 *
 * Catches the exploregstack incident class: a local-dev install run from
 * inside a worktree anchored all 26 Loom skill symlinks to the worktree
 * path; removing the worktree left every symlink dangling and every skill
 * silently dark in new sessions — no error anywhere, skills just stopped
 * appearing.
 *
 * Severity: `fail` on any dangling link (skills are dark right now),
 * `warn` on live-but-worktree-anchored links (one `wt done` away from dark).
 * Category `settings`. Must not mutate anything (doctor `--fix` handles
 * remediation separately).
 *
 * Default export is a zero-arg-constructible class so the dispatcher in
 * `scripts/lib/doctor/index.ts` discovers it via dynamic import.
 */

import * as fsSync from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";

import type { Check, CheckCategory, InstallState } from "../check.interface";

type HealthCheck = {
  id: string;
  category: CheckCategory;
  status: "pass" | "warn" | "fail";
  message: string;
  fixCommand?: string | null;
  remediation?: string;
};

export interface DanglingSkillSymlinksDeps {
  /** Absolute path to the user skills dir. Defaults to `~/.claude/skills`. */
  skillsDir?: string;
  readdir?: (p: string) => string[];
  lstatSync?: (p: string) => fsSync.Stats;
  readlink?: (p: string) => string;
  existsSync?: (p: string) => boolean;
}

// Match both POSIX (/) and Windows (\) path separators.
const WORKTREE_SEGMENT = /[\\/]\.worktrees[\\/]|[\\/]\.claude[\\/]worktrees[\\/]/;

interface LinkReport {
  link: string;
  target: string;
  dangling: boolean;
}

export function scanSkillSymlinks(deps: Required<DanglingSkillSymlinksDeps>): LinkReport[] {
  const { skillsDir, readdir, lstatSync, readlink, existsSync } = deps;
  if (!existsSync(skillsDir)) return [];

  const candidates: string[] = [];
  // A readdir failure here means the dir EXISTS but is unreadable — a real
  // error. Let it propagate so run() reports `warn` ("health unknown"), rather
  // than swallowing it to [] which run() would render as a healthy PASS — the
  // exact silent-dark class this check exists to catch.
  const entries = readdir(skillsDir);
  for (const name of entries) {
    const entryPath = nodePath.join(skillsDir, name);
    // Catalog link is `library/library.yaml`; skills are `<name>/SKILL.md`.
    // Either the directory entry itself or the file inside may be the link.
    candidates.push(entryPath);
    candidates.push(nodePath.join(entryPath, name === "library" ? "library.yaml" : "SKILL.md"));
  }

  const reports: LinkReport[] = [];
  for (const p of candidates) {
    let stat: fsSync.Stats;
    try {
      stat = lstatSync(p);
    } catch {
      continue; // entry doesn't exist in this layout variant — fine
    }
    if (!stat.isSymbolicLink()) continue;
    let target: string;
    try {
      target = readlink(p);
    } catch {
      continue;
    }
    const absTarget = nodePath.isAbsolute(target)
      ? target
      : nodePath.resolve(nodePath.dirname(p), target);
    const dangling = !existsSync(absTarget);
    if (dangling || WORKTREE_SEGMENT.test(absTarget)) {
      reports.push({ link: p, target: absTarget, dangling });
    }
  }
  return reports;
}

export default class DanglingSkillSymlinksCheck implements Check {
  readonly id = "dangling-skill-symlinks";
  readonly category: CheckCategory = "settings";

  private readonly deps: Required<DanglingSkillSymlinksDeps>;

  constructor(deps: DanglingSkillSymlinksDeps = {}) {
    this.deps = {
      skillsDir: deps.skillsDir ?? nodePath.join(os.homedir(), ".claude", "skills"),
      readdir: deps.readdir ?? ((p) => fsSync.readdirSync(p)),
      lstatSync: deps.lstatSync ?? ((p) => fsSync.lstatSync(p)),
      readlink: deps.readlink ?? ((p) => fsSync.readlinkSync(p)),
      existsSync: deps.existsSync ?? ((p) => fsSync.existsSync(p)),
    };
  }

  async run(_state: InstallState): Promise<HealthCheck> {
    void _state;
    let reports: LinkReport[];
    try {
      reports = scanSkillSymlinks(this.deps);
    } catch (err) {
      return {
        id: this.id,
        category: this.category,
        status: "warn",
        message: `Could not enumerate ${this.deps.skillsDir} (${(err as Error).message}); skill-symlink health is unknown — treat as a potential silent-dark condition, not a pass.`,
        remediation: "Check permissions on the skills directory, then re-run /loom-doctor.",
      };
    }
    const dangling = reports.filter((r) => r.dangling);
    const atRisk = reports.filter((r) => !r.dangling);

    // A link is `<name>/SKILL.md` (file) or a directory-level `<name>` symlink
    // (e.g. the `loom` dir link install creates) — pick the name-bearing segment.
    const skillName = (p: string): string => {
      const base = nodePath.basename(p);
      return base === "SKILL.md" || base === "library.yaml"
        ? nodePath.basename(nodePath.dirname(p))
        : base;
    };

    if (dangling.length > 0) {
      const names = dangling.map((r) => skillName(r.link)).join(", ");
      return {
        id: this.id,
        category: this.category,
        status: "fail",
        message: `${dangling.length} skill symlink(s) under ${this.deps.skillsDir} point at paths that no longer exist (${names}). These skills are silently dark — they will not appear in any session.`,
        fixCommand: "/loom-library sync --apply",
        remediation:
          "Re-anchor the links to the main checkout: run /loom-library sync --apply from the main repo (not a worktree), or re-run bin/loom-install --link. The usual cause is an install run from inside a git worktree that was later removed.",
      };
    }
    if (atRisk.length > 0) {
      return {
        id: this.id,
        category: this.category,
        status: "warn",
        message: `${atRisk.length} skill symlink(s) resolve into a git worktree — they will go dark when that worktree is removed.`,
        fixCommand: "/loom-library sync --apply",
        remediation:
          "Re-run the local-dev install from the main checkout so symlinks anchor to a stable path.",
      };
    }
    return {
      id: this.id,
      category: this.category,
      status: "pass",
      message: "All skill symlinks resolve to existing, worktree-independent targets.",
    };
  }
}
