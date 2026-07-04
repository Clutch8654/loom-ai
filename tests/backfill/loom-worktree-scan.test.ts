/**
 * tests/backfill/loom-worktree-scan.test.ts
 *
 * Behavioral backfill for scripts/loom-worktree-scan.ts (F-11, defect 6 —
 * Phase 14b batch B1). Exercises the pure ownership/overlap engine that the
 * `scan` subcommand is built from: glob matching, overlap detection, PLAN.md
 * ownership extraction, lease-file parsing, and stale-lease expiry.
 *
 * The module is CJS-guarded (`require.main === module`), so importing it runs
 * no main() and never touches the real `~/.loom/leases`. We deliberately avoid
 * calling `scan` (which writes to the real HOME lease root) and instead drive
 * the exported building blocks. The PLAN.md test reads a real file written into
 * a template sandbox, so `readPlanOwnership` parses genuine on-disk input.
 *
 * Run: bunx vitest run tests/backfill/loom-worktree-scan.test.ts
 */

import { describe, it, expect } from "vitest";
import { withSandbox } from "../helpers/backfill-template.js";
import {
  matches,
  computeOverlap,
  parseLeasesToon,
  mergeLease,
  readPlanOwnership,
} from "../../scripts/loom-worktree-scan.js";

describe("loom-worktree-scan matches (glob → boolean)", () => {
  it("matches a single-star glob within one path segment", () => {
    expect(matches("src/*.ts", "src/a.ts")).toBe(true);
    expect(matches("src/*.ts", "src/b.tsx")).toBe(false);
  });

  it("does not let a single star cross a path separator", () => {
    expect(matches("src/*.ts", "src/sub/a.ts")).toBe(false);
  });

  it("matches a double-star glob across path separators", () => {
    expect(matches("src/**", "src/sub/deep/a.ts")).toBe(true);
    expect(matches("**/*.md", "docs/guide/intro.md")).toBe(true);
  });
});

describe("loom-worktree-scan computeOverlap (paths ∩ globs)", () => {
  it("returns only the current paths a sibling glob claims", () => {
    const current = ["src/a.ts", "src/b.ts", "docs/x.md"];
    const siblingGlobs = ["src/*.ts"];
    expect(computeOverlap(current, siblingGlobs)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("reports no overlap when globs claim nothing the current worktree owns", () => {
    expect(computeOverlap(["docs/x.md"], ["src/*.ts"])).toEqual([]);
  });

  it("treats a bare directory glob as owning everything beneath it", () => {
    // computeOverlap also tries `glob + "/**"`, so "src" claims nested files.
    expect(computeOverlap(["src/deep/a.ts"], ["src"])).toEqual(["src/deep/a.ts"]);
  });
});

describe("loom-worktree-scan readPlanOwnership (PLAN.md → globs)", () => {
  it("extracts path-like globs from a File Ownership line", async () => {
    await withSandbox(async (sandbox) => {
      sandbox.write(
        "cwd/PLAN.md",
        [
          "# Plan",
          "",
          "## Wave 1",
          "File Ownership: src/*.ts, docs/*.md; scripts/foo.ts",
          "",
        ].join("\n"),
      );
      const globs = readPlanOwnership(sandbox.cwd);
      expect(globs).toEqual(
        expect.arrayContaining(["src/*.ts", "docs/*.md", "scripts/foo.ts"]),
      );
      expect(globs).toHaveLength(3);
    });
  });

  it("filters out narrative prose that is not a plausible glob", async () => {
    await withSandbox(async (sandbox) => {
      sandbox.write(
        "cwd/PLAN.md",
        "File Ownership: the auth module and helpers, lib/util.ts\n",
      );
      // "the", "auth", "module"... contain spaces or lack a path/extension →
      // rejected; only the real path survives.
      expect(readPlanOwnership(sandbox.cwd)).toEqual(["lib/util.ts"]);
    });
  });

  it("returns an empty list when there is no PLAN.md", async () => {
    await withSandbox(async (sandbox) => {
      expect(readPlanOwnership(sandbox.cwd)).toEqual([]);
    });
  });
});

describe("loom-worktree-scan parseLeasesToon (TOON table → Lease[])", () => {
  it("parses each lease row into a structured record", () => {
    const toon = [
      "schemaVersion: 1",
      "leases[1]{id,workspacePath,branch,ownedGlobs,claimedAt,expiresAt,status}:",
      "  repo:feature,/wt/feature,feature,src/*.ts;docs/*.md,2026-01-01T00:00:00Z,2026-02-01T00:00:00Z,active",
      "",
    ].join("\n");
    const leases = parseLeasesToon(toon);
    expect(leases).toHaveLength(1);
    expect(leases[0]).toMatchObject({
      id: "repo:feature",
      workspacePath: "/wt/feature",
      branch: "feature",
      ownedGlobs: "src/*.ts;docs/*.md",
      status: "active",
    });
  });

  it("returns an empty list when there is no leases block", () => {
    expect(parseLeasesToon("schemaVersion: 1\n")).toEqual([]);
  });
});

describe("loom-worktree-scan mergeLease (refresh + auto-expire)", () => {
  it("expires a stale active lease and appends the refreshed one", () => {
    const prior = [
      {
        id: "repo:old",
        workspacePath: "/wt/old",
        branch: "old",
        ownedGlobs: "src/*.ts",
        claimedAt: "2000-01-01T00:00:00Z",
        expiresAt: "2000-01-15T00:00:00Z", // long past → should auto-expire
        status: "active" as const,
      },
    ];
    const next = {
      id: "repo:new",
      workspacePath: "/wt/new",
      branch: "new",
      ownedGlobs: "docs/*.md",
      claimedAt: "2026-07-01T00:00:00Z",
      expiresAt: "2099-01-01T00:00:00Z",
      status: "active" as const,
    };
    const merged = mergeLease(prior, next);
    const old = merged.find((l) => l.id === "repo:old");
    const fresh = merged.find((l) => l.id === "repo:new");
    expect(old?.status).toBe("expired");
    expect(fresh?.status).toBe("active");
    expect(merged).toHaveLength(2);
  });

  it("replaces a prior lease that shares the incoming id", () => {
    const prior = [
      {
        id: "repo:same",
        workspacePath: "/wt/stale",
        branch: "same",
        ownedGlobs: "old/*.ts",
        claimedAt: "2026-07-01T00:00:00Z",
        expiresAt: "2099-01-01T00:00:00Z",
        status: "active" as const,
      },
    ];
    const next = {
      ...prior[0],
      workspacePath: "/wt/current",
      ownedGlobs: "new/*.ts",
    };
    const merged = mergeLease(prior, next);
    expect(merged).toHaveLength(1);
    expect(merged[0].ownedGlobs).toBe("new/*.ts");
    expect(merged[0].workspacePath).toBe("/wt/current");
  });
});
