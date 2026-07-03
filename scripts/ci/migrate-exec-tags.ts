/**
 * scripts/ci/migrate-exec-tags.ts — relocate legacy `plan-exec-*` execution
 * tags out of the tag namespace into `refs/exec/*` (F-16, defect 13, C-04).
 *
 * MOVE, NEVER DELETE (irreversibility mitigation): each tag is copied to
 * `refs/exec/{name}` and verified with `git rev-parse` BEFORE the source
 * `refs/tags/{tag}` is removed. A conflicting target ref aborts the whole run
 * with the source tags untouched (idempotent re-run). A pre-migration
 * `git bundle --all` backup is written before any ref is changed.
 *
 * The name after the `plan-exec-` prefix becomes the `refs/exec/` leaf, so
 * `plan-exec-wave-0-pre` → `refs/exec/wave-0-pre`.
 *
 * Security: tag names are attacker-influenceable refnames, so every git call
 * uses execFileSync argv arrays (no shell).
 *
 * Usage:
 *   bun scripts/ci/migrate-exec-tags.ts                 # dry-run (default): list moves
 *   bun scripts/ci/migrate-exec-tags.ts --execute       # perform the local move
 *   bun scripts/ci/migrate-exec-tags.ts --execute --push  # also push refs/exec/* + delete remote tags
 *   Flags: --repo <path> (default cwd), --backup <path>
 *          (default planning/reports/tag-backup.bundle), --remote <name> (default origin)
 *
 * Exit codes: 0 migrated (or dry-run clean / nothing to do); 1
 * TAG_MIGRATION_CONFLICT (target ref exists); 3 git unavailable.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { isMain } from "../../lib/index.js";

const TAG_PREFIX = "plan-exec-";
const EXEC_NS = "refs/exec/";

export interface TagMove {
  tag: string; // e.g. plan-exec-wave-0-pre
  ref: string; // refs/tags/plan-exec-wave-0-pre
  target: string; // refs/exec/wave-0-pre
  oid: string; // object the tag points at
}

/** Run git with argv semantics. Throws on non-zero exit. */
export function git(repo: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** List all `plan-exec-*` tags with their resolved object ids and targets. */
export function planExecMoves(repo: string): TagMove[] {
  const out = git(repo, ["tag", "--list", `${TAG_PREFIX}*`]);
  const moves: TagMove[] = [];
  for (const line of out.split("\n")) {
    const tag = line.trim();
    if (!tag) continue;
    const leaf = tag.slice(TAG_PREFIX.length);
    const oid = git(repo, ["rev-parse", `refs/tags/${tag}`]).trim();
    moves.push({
      tag,
      ref: `refs/tags/${tag}`,
      target: `${EXEC_NS}${leaf}`,
      oid,
    });
  }
  return moves;
}

/** True when a ref already exists (git rev-parse --verify succeeds). */
function refExists(repo: string, ref: string): boolean {
  try {
    git(repo, ["rev-parse", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

export interface MigrateOptions {
  repo: string;
  execute: boolean;
  push: boolean;
  backup: string;
  remote: string;
}

export function migrate(opts: MigrateOptions): number {
  const { repo } = opts;

  let moves: TagMove[];
  try {
    moves = planExecMoves(repo);
  } catch (err) {
    process.stderr.write(`GIT_UNAVAILABLE: ${(err as Error).message}\n`);
    return 3;
  }

  if (moves.length === 0) {
    process.stdout.write("No plan-exec-* tags found — nothing to migrate.\n");
    return 0;
  }

  // Pre-flight conflict scan: any existing target ref aborts before we touch
  // anything (leaves every source tag in place → idempotent re-run).
  const conflicts = moves.filter(
    (m) => refExists(repo, m.target) && git(repo, ["rev-parse", m.target]).trim() !== m.oid,
  );
  if (conflicts.length > 0) {
    process.stderr.write(
      "TAG_MIGRATION_CONFLICT: target ref(s) already exist with a different object:\n",
    );
    for (const c of conflicts) {
      process.stderr.write(`  ${c.tag} -> ${c.target}\n`);
    }
    process.stderr.write("Source tags left intact; resolve the conflict and re-run.\n");
    return 1;
  }

  if (!opts.execute) {
    process.stdout.write(`Dry-run: ${moves.length} plan-exec-* tag(s) would move:\n`);
    for (const m of moves) {
      process.stdout.write(`  ${m.tag} -> ${m.target}  (${m.oid.slice(0, 12)})\n`);
    }
    process.stdout.write("Re-run with --execute to perform the move.\n");
    return 0;
  }

  // ── Execute ──
  // 1. Backup ALL refs before mutating anything.
  const backupAbs = path.isAbsolute(opts.backup)
    ? opts.backup
    : path.join(repo, opts.backup);
  fs.mkdirSync(path.dirname(backupAbs), { recursive: true });
  git(repo, ["bundle", "create", backupAbs, "--all"]);
  process.stdout.write(`Backup written: ${backupAbs}\n`);

  // 2. Copy → verify → remove, per tag.
  const migrated: TagMove[] = [];
  for (const m of moves) {
    // Idempotent: skip if already migrated (target exists at same oid and
    // source already gone).
    git(repo, ["update-ref", m.target, m.oid]);
    const check = git(repo, ["rev-parse", m.target]).trim();
    if (check !== m.oid) {
      process.stderr.write(
        `TAG_MIGRATION_CONFLICT: ${m.target} did not resolve to ${m.oid} after copy (got ${check}).\n`,
      );
      return 1;
    }
    git(repo, ["tag", "-d", m.tag]);
    migrated.push(m);
    process.stdout.write(`  moved ${m.tag} -> ${m.target}\n`);
  }

  process.stdout.write(`Migrated ${migrated.length} tag(s) to ${EXEC_NS}*.\n`);

  // 3. Optional push: publish refs/exec/* and delete the remote tags.
  if (opts.push) {
    for (const m of migrated) {
      git(repo, ["push", opts.remote, `${m.target}:${m.target}`]);
      git(repo, ["push", opts.remote, `:${m.ref}`]);
    }
    process.stdout.write(`Pushed ${migrated.length} ref move(s) to ${opts.remote}.\n`);
  }

  return 0;
}

function parseArgs(argv: string[]): MigrateOptions {
  const o: MigrateOptions = {
    repo: process.cwd(),
    execute: false,
    push: false,
    backup: "planning/reports/tag-backup.bundle",
    remote: "origin",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--execute":
        o.execute = true;
        break;
      case "--push":
        o.push = true;
        break;
      case "--repo":
        o.repo = argv[++i] ?? o.repo;
        break;
      case "--backup":
        o.backup = argv[++i] ?? o.backup;
        break;
      case "--remote":
        o.remote = argv[++i] ?? o.remote;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return o;
}

if (isMain(import.meta)) {
  try {
    process.exit(migrate(parseArgs(process.argv.slice(2))));
  } catch (err) {
    process.stderr.write(`USAGE_ERROR: ${(err as Error).message}\n`);
    process.exit(64);
  }
}
