/**
 * tests/scripts/dangling-skill-symlinks.test.ts
 *
 * Coverage for the doctor check that detects the "26 skills went silently
 * dark" incident (PR #35 review follow-up). The unit is fully
 * dependency-injected, so every branch is exercised with stub fns — no real
 * filesystem. The critical properties: detect dangling links, resolve
 * relative targets against the link dir, flag worktree-anchored links on
 * both POSIX and Windows separators, and NEVER report a healthy pass when
 * the skills dir is unreadable.
 *
 * Run: bunx vitest run tests/scripts/dangling-skill-symlinks.test.ts
 */

import { describe, it, expect } from "vitest";
import DanglingSkillSymlinksCheck, {
  scanSkillSymlinks,
  type DanglingSkillSymlinksDeps,
} from "../../scripts/lib/doctor/checks/dangling-skill-symlinks";

/** Build injected deps from a simple in-memory model. */
function deps(model: {
  skillsDir?: string;
  entries: string[]; // basenames under skillsDir
  links: Record<string, string>; // absolute link path -> target (marks it a symlink)
  exists: Set<string>; // absolute paths that "exist"
  readdirThrows?: boolean;
}): Required<DanglingSkillSymlinksDeps> {
  const skillsDir = model.skillsDir ?? "/home/u/.claude/skills";
  return {
    skillsDir,
    readdir: () => {
      if (model.readdirThrows) throw new Error("EACCES: permission denied");
      return model.entries;
    },
    lstatSync: ((p: string) =>
      ({ isSymbolicLink: () => p in model.links })) as Required<DanglingSkillSymlinksDeps>["lstatSync"],
    readlink: (p: string) => {
      if (!(p in model.links)) throw new Error("EINVAL");
      return model.links[p];
    },
    existsSync: (p: string) => p === skillsDir || model.exists.has(p),
  };
}

describe("scanSkillSymlinks", () => {
  it("returns [] when the skills dir does not exist (legitimately empty)", () => {
    const d = deps({ entries: [], links: {}, exists: new Set() });
    // existsSync returns true only for skillsDir here; override to false:
    const d2 = { ...d, existsSync: () => false };
    expect(scanSkillSymlinks(d2)).toEqual([]);
  });

  it("detects a dangling <name>/SKILL.md symlink (target missing)", () => {
    const link = "/home/u/.claude/skills/loom-think/SKILL.md";
    const d = deps({
      entries: ["loom-think"],
      links: { [link]: "/gone/.worktrees/x/skills/loom-think/SKILL.md" },
      exists: new Set(), // target does not exist
    });
    const r = scanSkillSymlinks(d);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ link, dangling: true });
  });

  it("resolves a RELATIVE target against the link's directory, not cwd", () => {
    const link = "/home/u/.claude/skills/foo/SKILL.md";
    const d = deps({
      entries: ["foo"],
      links: { [link]: "../../elsewhere/SKILL.md" },
      // resolved absolute = /home/u/.claude/elsewhere/SKILL.md — mark it existing
      exists: new Set(["/home/u/.claude/elsewhere/SKILL.md"]),
    });
    const r = scanSkillSymlinks(d);
    // target exists and is not in a worktree → no report at all
    expect(r).toEqual([]);
  });

  it("flags a live-but-worktree-anchored link — POSIX separators", () => {
    const link = "/home/u/.claude/skills/a/SKILL.md";
    const target = "/repo/.worktrees/wt/skills/a/SKILL.md";
    const d = deps({ entries: ["a"], links: { [link]: target }, exists: new Set([target]) });
    const r = scanSkillSymlinks(d);
    expect(r).toEqual([{ link, target, dangling: false }]);
  });

  it("flags a live link under .claude/worktrees (second regex alternation)", () => {
    const link = "/home/u/.claude/skills/b/SKILL.md";
    const target = "/repo/.claude/worktrees/wt/skills/b/SKILL.md";
    const d = deps({ entries: ["b"], links: { [link]: target }, exists: new Set([target]) });
    expect(scanSkillSymlinks(d)).toEqual([{ link, target, dangling: false }]);
  });

  it("does NOT report a live link outside any worktree", () => {
    const link = "/home/u/.claude/skills/c/SKILL.md";
    const target = "/repo/skills/c/SKILL.md";
    const d = deps({ entries: ["c"], links: { [link]: target }, exists: new Set([target]) });
    expect(scanSkillSymlinks(d)).toEqual([]);
  });

  it("probes library.yaml (not SKILL.md) for the `library` entry", () => {
    const link = "/home/u/.claude/skills/library/library.yaml";
    const d = deps({
      entries: ["library"],
      links: { [link]: "/gone/library.yaml" },
      exists: new Set(),
    });
    const r = scanSkillSymlinks(d);
    expect(r).toHaveLength(1);
    expect(r[0].link).toBe(link);
  });

  it("propagates a readdir failure (unreadable dir) instead of returning [] — the false-PASS guard", () => {
    const d = deps({ entries: [], links: {}, exists: new Set(), readdirThrows: true });
    expect(() => scanSkillSymlinks(d)).toThrow(/EACCES/);
  });
});

describe("DanglingSkillSymlinksCheck.run", () => {
  const runWith = (model: Parameters<typeof deps>[0]) =>
    new DanglingSkillSymlinksCheck(deps(model)).run(undefined as never);

  it("fails when a link is dangling", async () => {
    const r: any = await runWith({
      entries: ["loom-think"],
      links: { "/home/u/.claude/skills/loom-think/SKILL.md": "/gone/SKILL.md" },
      exists: new Set(),
    });
    expect(r.status).toBe("fail");
    expect(r.message).toContain("loom-think");
  });

  it("reports the correct name for a DIRECTORY-level dangling symlink (not 'skills')", async () => {
    // The `loom` dir link install creates: link is the dir itself, no SKILL.md.
    const dirLink = "/home/u/.claude/skills/loom";
    const r: any = await runWith({
      entries: ["loom"],
      links: { [dirLink]: "/gone/loom" },
      exists: new Set(),
    });
    expect(r.status).toBe("fail");
    expect(r.message).toContain("loom");
    expect(r.message).not.toContain("(skills)");
  });

  it("warns on a live-but-worktree-anchored link", async () => {
    const link = "/home/u/.claude/skills/a/SKILL.md";
    const target = "/repo/.worktrees/wt/skills/a/SKILL.md";
    const r: any = await runWith({ entries: ["a"], links: { [link]: target }, exists: new Set([target]) });
    expect(r.status).toBe("warn");
  });

  it("passes when all links are healthy and worktree-independent", async () => {
    const link = "/home/u/.claude/skills/c/SKILL.md";
    const target = "/repo/skills/c/SKILL.md";
    const r: any = await runWith({ entries: ["c"], links: { [link]: target }, exists: new Set([target]) });
    expect(r.status).toBe("pass");
  });

  it("warns (never passes) when the skills dir is unreadable", async () => {
    const r: any = await runWith({ entries: [], links: {}, exists: new Set(), readdirThrows: true });
    expect(r.status).toBe("warn");
    expect(r.message).toMatch(/could not enumerate/i);
  });
});
