/**
 * scripts/loom-release.ts — milestone-boundary semver release cutter
 * (F-15, defect 13, contract C-04).
 *
 * Implements the draft → tagged transition of the ReleaseVersion state machine
 * in protocols/release-versioning.schema.md:
 *
 *   draft (default, or explicit --dry-run)
 *     Derive the semver bump from conventional commits since the last `v*` tag
 *     and PRINT the drafted changelog section — with the seven pre-registered
 *     metric placeholders from lib/types.ts MetricName — without touching git
 *     or the changelog.
 *   tagged (real run, no --dry-run)
 *     Refuse a dirty tree or an already-existing target tag (exit 3), prepend
 *     the changelog section (atomic write), then create the annotated
 *     `v{semver}` tag.
 *
 * Derivation (release-versioning.schema.md § Milestone semver):
 *   `!` suffix or `BREAKING CHANGE` footer ⇒ major, feat ⇒ minor, fix ⇒ patch,
 *   evaluated over `{lastSemverTag}..HEAD` (or full history when no semver tag
 *   exists yet; base version 0.0.0).
 *
 * Metric values are never authored here: the section carries `<pending>`
 * placeholders and real repo-derived values are pinned from the metrics
 * snapshot at release close (F-26).
 *
 * Security: refnames and commit messages are attacker-influenced, so every git
 * call uses execFileSync argv arrays (no shell) and range arguments are only
 * ever built from tags that passed the strict `v\d+\.\d+\.\d+` regex.
 *
 * Usage:
 *   bun scripts/loom-release.ts --milestone M-NN [--dry-run]
 *   Flags: --metrics <path> (reserved; default planning/reports/metrics-snapshot.toon),
 *          --repo <path> (default cwd), --changelog <path>
 *          (default {repo}/planning/history/changelog.md), --date <YYYY-MM-DD>
 *
 * Exit codes: 0 released (or dry-run drafted); 1 VERSION_DERIVATION_FAILED (no
 * conventional commits / no release-worthy bump); 2 version-gate violation;
 * 3 dirty tree or target tag already exists; 64 usage error.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteText, isMain } from "../lib/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Bump = "major" | "minor" | "patch";

export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

export interface ConventionalCommit {
  sha: string;
  subject: string;
  body: string;
  /** Conventional-commit type parsed from the subject, or null when none. */
  type: string | null;
  /** `!` after type(scope), or a BREAKING CHANGE / BREAKING-CHANGE footer. */
  breaking: boolean;
}

/** The seven pre-registered metric names (lib/types.ts MetricName). */
export const METRIC_NAMES = [
  "typecheck-errors",
  "test-source-ratio",
  "tautological-tests",
  "defects-closed",
  "ci-gates-green",
  "meta-tests-firing",
  "scorecard-overall",
] as const;

export const SEMVER_TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/;
const MILESTONE_RE = /^M-\d{2}$/;

// ---------------------------------------------------------------------------
// git plumbing — execFileSync argv arrays ONLY (no shell)
// ---------------------------------------------------------------------------

/** Run git with argv semantics. Throws on non-zero exit. */
export function git(repo: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

// ---------------------------------------------------------------------------
// semver
// ---------------------------------------------------------------------------

export function parseSemver(s: string): Semver | null {
  const m = SEMVER_TAG_RE.exec(s.startsWith("v") ? s : `v${s}`);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function formatSemver(v: Semver): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

export function compareSemver(a: Semver, b: Semver): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function applyBump(v: Semver, bump: Bump): Semver {
  if (bump === "major") return { major: v.major + 1, minor: 0, patch: 0 };
  if (bump === "minor") return { major: v.major, minor: v.minor + 1, patch: 0 };
  return { major: v.major, minor: v.minor, patch: v.patch + 1 };
}

// ---------------------------------------------------------------------------
// tag + commit inspection
// ---------------------------------------------------------------------------

/** Highest semver `v*` tag in the repo, or null when none exist. */
export function lastSemverTag(
  repo: string,
): { tag: string; semver: Semver } | null {
  let out = "";
  try {
    out = git(repo, ["tag", "--list", "v*"]);
  } catch {
    return null;
  }
  let best: { tag: string; semver: Semver } | null = null;
  for (const line of out.split("\n")) {
    const tag = line.trim();
    if (!tag) continue;
    const sv = parseSemver(tag);
    if (!sv) continue; // non-semver v* tags are the version-gate's concern
    if (!best || compareSemver(sv, best.semver) > 0) best = { tag, semver: sv };
  }
  return best;
}

const CONVENTIONAL_SUBJECT_RE = /^(\w+)(\([^)]*\))?(!)?:\s/;

/** Parse conventional commits in `range` (e.g. `v1.0.0..HEAD`, or "" for all). */
export function parseConventionalCommits(
  repo: string,
  range: string,
): ConventionalCommit[] {
  // NUL-delimited records; each record is `sha<LF>subject<LF>body`.
  const args = ["log", "--format=%H%n%s%n%b%x00"];
  if (range) args.push(range);
  let raw = "";
  try {
    raw = git(repo, args);
  } catch {
    return [];
  }
  const commits: ConventionalCommit[] = [];
  for (const rec of raw.split("\0")) {
    const trimmed = rec.replace(/^\n+/, "");
    if (!trimmed.trim()) continue;
    const nl1 = trimmed.indexOf("\n");
    const sha = (nl1 === -1 ? trimmed : trimmed.slice(0, nl1)).trim();
    const afterSha = nl1 === -1 ? "" : trimmed.slice(nl1 + 1);
    const nl2 = afterSha.indexOf("\n");
    const subject = nl2 === -1 ? afterSha : afterSha.slice(0, nl2);
    const body = nl2 === -1 ? "" : afterSha.slice(nl2 + 1);
    const m = CONVENTIONAL_SUBJECT_RE.exec(subject);
    const type = m ? m[1] : null;
    const bangBreaking = Boolean(m && m[3]);
    const footerBreaking = /(^|\n)BREAKING[ -]CHANGE/.test(body);
    commits.push({
      sha,
      subject,
      body,
      type,
      breaking: bangBreaking || footerBreaking,
    });
  }
  return commits;
}

/** Commits that force a release: feat, fix, or any breaking change. */
export function releaseWorthy(commits: ConventionalCommit[]): ConventionalCommit[] {
  return commits.filter(
    (c) => c.breaking || c.type === "feat" || c.type === "fix",
  );
}

/** Derive the bump precedence: breaking > feat > fix. null when none apply. */
export function deriveBump(commits: ConventionalCommit[]): Bump | null {
  if (commits.some((c) => c.breaking)) return "major";
  if (commits.some((c) => c.type === "feat")) return "minor";
  if (commits.some((c) => c.type === "fix")) return "patch";
  return null;
}

/**
 * The version-gate predicate (CG-001): the gate is SATISFIED when there is no
 * release-worthy work, or when a version bump has been recorded. Shared with
 * scripts/ci/version-gate.ts so the rule has one definition.
 */
export function isReleaseWorthyGate(
  worthyCount: number,
  bumped: boolean,
): boolean {
  return worthyCount === 0 || bumped;
}

// ---------------------------------------------------------------------------
// changelog rendering
// ---------------------------------------------------------------------------

export interface SectionInput {
  semver: string;
  milestone: string;
  commitRange: string;
  date: string;
  status?: string;
}

/** Render a semver changelog section per protocols/release-versioning.schema.md. */
export function renderChangelogSection(input: SectionInput): string {
  const status = input.status ?? "draft";
  const metricLines = METRIC_NAMES.map((m) => `- ${m}: <pending>`).join("\n");
  return [
    `## v${input.semver} — ${input.milestone} (${input.date})`,
    "",
    `<!-- loom:release:v${input.semver} -->`,
    `- Milestone: ${input.milestone}`,
    `- Commit range: \`${input.commitRange}\``,
    `- Status: ${status}`,
    "",
    "Metrics (pre-registered; repo-derived values pinned at release close per F-26):",
    metricLines,
    "",
  ].join("\n");
}

/** Highest `## vX.Y.Z` version declared in a changelog file (null when none). */
export function declaredChangelogVersion(changelogPath: string): Semver | null {
  if (!fs.existsSync(changelogPath)) return null;
  const text = fs.readFileSync(changelogPath, "utf8");
  const re = /^##\s+v(\d+)\.(\d+)\.(\d+)\b/gm;
  let best: Semver | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const sv: Semver = {
      major: Number(m[1]),
      minor: Number(m[2]),
      patch: Number(m[3]),
    };
    if (!best || compareSemver(sv, best) > 0) best = sv;
  }
  return best;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Args {
  milestone: string | null;
  dryRun: boolean;
  metrics: string;
  repo: string;
  changelog: string | null;
  date: string | null;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    milestone: null,
    dryRun: false,
    metrics: "planning/reports/metrics-snapshot.toon",
    repo: process.cwd(),
    changelog: null,
    date: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new UsageError(`${arg} requires a value`);
      return v;
    };
    switch (arg) {
      case "--milestone":
        a.milestone = next();
        break;
      case "--dry-run":
        a.dryRun = true;
        break;
      case "--metrics":
        a.metrics = next();
        break;
      case "--repo":
        a.repo = next();
        break;
      case "--changelog":
        a.changelog = next();
        break;
      case "--date":
        a.date = next();
        break;
      default:
        throw new UsageError(`unknown argument: ${arg}`);
    }
  }
  return a;
}

class UsageError extends Error {}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function main(argv: string[]): number {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`USAGE_ERROR: ${err.message}\n`);
      return 64;
    }
    throw err;
  }

  if (!args.milestone) {
    process.stderr.write("USAGE_ERROR: --milestone <M-NN> is required\n");
    return 64;
  }
  if (!MILESTONE_RE.test(args.milestone)) {
    process.stderr.write(
      `USAGE_ERROR: --milestone must match M-NN, got '${args.milestone}'\n`,
    );
    return 64;
  }

  const repo = args.repo;
  const changelogPath =
    args.changelog ?? path.join(repo, "planning", "history", "changelog.md");

  const last = lastSemverTag(repo);
  const baseVer: Semver = last?.semver ?? { major: 0, minor: 0, patch: 0 };
  const range = last ? `${last.tag}..HEAD` : "";

  const commits = parseConventionalCommits(repo, range);
  const conventional = commits.filter((c) => c.type !== null || c.breaking);
  if (conventional.length === 0) {
    process.stderr.write(
      "VERSION_DERIVATION_FAILED: no conventional commits since " +
        `${last?.tag ?? "the root commit"} — cannot derive a version.\n`,
    );
    return 1;
  }

  const bump = deriveBump(conventional);
  if (!bump) {
    process.stderr.write(
      "VERSION_DERIVATION_FAILED: conventional commits found but none are " +
        "release-worthy (no feat/fix/BREAKING) — nothing to release.\n",
    );
    return 1;
  }

  const newVer = applyBump(baseVer, bump);
  const newSemver = formatSemver(newVer);
  const newTag = `v${newSemver}`;
  const commitRange = `${last?.tag ?? "(root)"}..${newTag}`;
  const date = args.date ?? today();

  const section = renderChangelogSection({
    semver: newSemver,
    milestone: args.milestone,
    commitRange,
    date,
    status: args.dryRun ? "draft" : "tagged",
  });

  if (args.dryRun) {
    process.stdout.write(section + "\n");
    return 0;
  }

  // ── Real run (draft → tagged) ──
  // Version-gate self-check: a release must strictly increase the version.
  if (compareSemver(newVer, baseVer) <= 0) {
    process.stderr.write(
      `VERSION_GATE_FAILED: derived ${newTag} does not exceed ${last?.tag}.\n`,
    );
    return 2;
  }

  // Dirty tree → exit 3.
  let porcelain = "";
  try {
    porcelain = git(repo, ["status", "--porcelain"]);
  } catch (err) {
    process.stderr.write(`GIT_UNAVAILABLE: ${(err as Error).message}\n`);
    return 3;
  }
  if (porcelain.trim() !== "") {
    process.stderr.write(
      "DIRTY_TREE: working tree has uncommitted changes — commit or stash first.\n",
    );
    return 3;
  }

  // Tag already exists → exit 3.
  const existing = git(repo, ["tag", "--list", newTag]).trim();
  if (existing === newTag) {
    process.stderr.write(`TAG_EXISTS: ${newTag} already exists.\n`);
    return 3;
  }

  // Prepend the changelog section (atomic write).
  const existingChangelog = fs.existsSync(changelogPath)
    ? fs.readFileSync(changelogPath, "utf8")
    : "";
  atomicWriteText(changelogPath, section + "\n" + existingChangelog);

  // Create the annotated tag.
  git(repo, ["tag", "-a", newTag, "-m", `Release ${newTag} (${args.milestone})`]);

  process.stdout.write(
    `Released ${newTag} (${args.milestone}); changelog section written to ${changelogPath}.\n`,
  );
  return 0;
}

if (isMain(import.meta)) {
  process.exit(main(process.argv.slice(2)));
}
