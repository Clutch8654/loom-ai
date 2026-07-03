/**
 * scripts/ci/version-gate.ts — CI check `version-gate` (F-15, contract C-04,
 * CG-001).
 *
 * Fails when a release-worthy change (feat/fix/BREAKING conventional commits
 * since the last `v*` tag) reaches a milestone boundary without a version bump,
 * and enforces the semver-only `v*` tag namespace.
 *
 * Two responsibilities:
 *   1. Namespace policy (always): any `v`-prefixed tag that is not a valid
 *      `v\d+\.\d+\.\d+` semver is TAG_NAMESPACE_POLLUTED (exit 1). The legacy
 *      `plan-exec-*` tags do not match `v*` and are migrated separately in
 *      Phase 10.
 *   2. Bump policy (milestone boundary only — `--milestone` supplied, as the
 *      workflow does on a release PR): if there are release-worthy commits
 *      since the last tag but the changelog's highest `## vX.Y.Z` header does
 *      not exceed that tag, the release is unversioned → VERSION_GATE_FAILED
 *      (exit 1), naming the offending commits.
 *
 * Off a milestone boundary (no `--milestone`) only the namespace check runs, so
 * ordinary feature PRs are not blocked for lacking a bump.
 *
 * Usage:
 *   bun scripts/ci/version-gate.ts [--milestone M-NN] [--repo <path>]
 *                                  [--changelog <path>]
 *
 * Exit codes: 0 gate satisfied; 1 VERSION_GATE_FAILED / TAG_NAMESPACE_POLLUTED;
 * 3 git unavailable; 64 usage error.
 */

import * as path from "node:path";
import {
  compareSemver,
  declaredChangelogVersion,
  git,
  isReleaseWorthyGate,
  lastSemverTag,
  parseConventionalCommits,
  releaseWorthy,
  SEMVER_TAG_RE,
} from "../loom-release.js";
import { isMain } from "../../lib/index.js";

const MILESTONE_RE = /^M-\d{2}$/;

interface Args {
  milestone: string | null;
  repo: string;
  changelog: string | null;
}

function parseArgs(argv: string[]): Args | { usage: string } {
  const a: Args = { milestone: null, repo: process.cwd(), changelog: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string | null => argv[++i] ?? null;
    switch (arg) {
      case "--milestone": {
        const v = next();
        if (v === null) return { usage: "--milestone requires a value" };
        a.milestone = v;
        break;
      }
      case "--repo": {
        const v = next();
        if (v === null) return { usage: "--repo requires a value" };
        a.repo = v;
        break;
      }
      case "--changelog": {
        const v = next();
        if (v === null) return { usage: "--changelog requires a value" };
        a.changelog = v;
        break;
      }
      default:
        return { usage: `unknown argument: ${arg}` };
    }
  }
  return a;
}

/** Tags that start with `v` but are not valid semver pollute the namespace. */
export function pollutedTags(repo: string): string[] {
  let out = "";
  out = git(repo, ["tag", "--list", "v*"]);
  const polluted: string[] = [];
  for (const line of out.split("\n")) {
    const tag = line.trim();
    if (!tag) continue;
    if (!SEMVER_TAG_RE.test(tag)) polluted.push(tag);
  }
  return polluted;
}

export function main(argv: string[]): number {
  const parsed = parseArgs(argv);
  if ("usage" in parsed) {
    process.stderr.write(`USAGE_ERROR: ${parsed.usage}\n`);
    return 64;
  }
  const args = parsed;

  if (args.milestone !== null && !MILESTONE_RE.test(args.milestone)) {
    process.stderr.write(
      `USAGE_ERROR: --milestone must match M-NN, got '${args.milestone}'\n`,
    );
    return 64;
  }

  const repo = args.repo;

  // (1) Namespace policy — always enforced.
  let polluted: string[];
  try {
    polluted = pollutedTags(repo);
  } catch (err) {
    process.stderr.write(`GIT_UNAVAILABLE: ${(err as Error).message}\n`);
    return 3;
  }
  if (polluted.length > 0) {
    process.stderr.write(
      `TAG_NAMESPACE_POLLUTED: non-semver tag(s) in the v* namespace: ${polluted.join(", ")}\n`,
    );
    return 1;
  }

  // (2) Bump policy — only at a milestone boundary.
  if (args.milestone === null) {
    return 0;
  }

  const last = lastSemverTag(repo);
  const baseVer = last?.semver ?? { major: 0, minor: 0, patch: 0 };
  const range = last ? `${last.tag}..HEAD` : "";
  const commits = parseConventionalCommits(repo, range);
  const worthy = releaseWorthy(commits);

  if (worthy.length === 0) {
    // Nothing release-worthy since the last tag — a milestone with no shippable
    // change is not a gate violation.
    return 0;
  }

  const changelogPath =
    args.changelog ?? path.join(repo, "planning", "history", "changelog.md");
  const declared = declaredChangelogVersion(changelogPath);
  const bumped = declared !== null && compareSemver(declared, baseVer) > 0;

  if (!isReleaseWorthyGate(worthy.length, bumped)) {
    process.stderr.write(
      `VERSION_GATE_FAILED: ${worthy.length} release-worthy commit(s) since ` +
        `${last?.tag ?? "the root commit"} at milestone ${args.milestone} ` +
        "without a version bump. Unversioned commits:\n",
    );
    for (const c of worthy) {
      process.stderr.write(`  ${c.sha.slice(0, 12)} ${c.subject}\n`);
    }
    process.stderr.write(
      "Run `bun scripts/loom-release.ts --milestone " +
        `${args.milestone}` +
        "` (or bump the changelog) before merging.\n",
    );
    return 1;
  }

  return 0;
}

if (isMain(import.meta)) {
  process.exit(main(process.argv.slice(2)));
}
