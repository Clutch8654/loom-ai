#!/usr/bin/env -S bunx tsx
/**
 * scripts/loom-cso.ts
 *
 * Deterministic runtime for /loom-cso (M-07 F-19): fast-gate math, history
 * append, and the four scriptable lenses. The three model-driven lenses
 * (auth boundaries, input validation, LLM trust) are run by the skill and
 * injected via flags — the script defaults them to 0 when run standalone.
 *
 * Usage:
 *   bunx tsx scripts/loom-cso.ts daily   [--auth-gaps N] [--input-validation-gaps N] [--llm-trust-issues N]
 *   bunx tsx scripts/loom-cso.ts monthly [same flags]
 *
 * Scriptable lenses:
 *   1. secrets        — regex sweep (diff vs merge-base for daily; full tree monthly)
 *   2. dep vulns      — bun audit, fallback npm audit --json (graceful skip)
 *   6. file perms     — world-writable tracked files; un-ignored .env files
 *   7. CI/CD          — unpinned actions, missing permissions:, npm install in CI
 *
 * Gate semantics (contract: skills/loom-cso/SKILL.md § Fast-gate):
 *   exit 1 (block) when new score < most-recent daily entry, or score < 8
 *   exit 0 otherwise; entry appended either way
 *   exit 2 on usage error
 *
 * Conventions: TOON stdout, atomic history writes (.tmp + rename).
 */

import { execFileSync, execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = process.cwd();
const HISTORY_PATH = path.join(REPO_ROOT, ".loom", "security-history.toon");

type Mode = "daily" | "monthly";

interface LensCounts {
  secretsCount: number;
  depVulnCount: number;
  authGaps: number;
  inputValidationGaps: number;
  llmTrustIssues: number;
  filePermIssues: number;
  cicdIssues: number;
}

interface Finding {
  lens: string;
  severity: "high" | "medium" | "low";
  confidence: number;
  file: string;
  line: number | "";
  description: string;
  suggestedFix: string;
}

interface Note {
  lens: string;
  note: string;
}

// Static, non-interpolated commands only (bun/npm audit). stderr is piped
// (not inherited), so no shell redirect is needed.
function tryRun(cmd: string): { code: number; stdout: string } {
  try {
    const stdout = execSync(cmd, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      cwd: REPO_ROOT,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { code: 0, stdout };
  } catch (err: any) {
    return { code: err?.status ?? 1, stdout: String(err?.stdout ?? "") };
  }
}

// git invocations go through execFileSync (argv array, no shell) so no
// repo-derived value (branch names, refs) is ever shell-parsed.
function tryGit(args: string[]): { code: number; stdout: string } {
  try {
    const stdout = execFileSync("git", args, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      cwd: REPO_ROOT,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { code: 0, stdout };
  } catch (err: any) {
    return { code: err?.status ?? 1, stdout: String(err?.stdout ?? "") };
  }
}

// ---------------------------------------------------------------- lens 1
const SECRET_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /AKIA[0-9A-Z]{16}/, label: "AWS access key id" },
  { re: /ASIA[0-9A-Z]{16}/, label: "AWS temporary access key id" },
  { re: /aws.{0,20}(secret|SECRET).{0,20}['"= ][A-Za-z0-9/+]{40}/, label: "AWS secret access key" },
  { re: /ghp_[A-Za-z0-9]{36,}/, label: "GitHub personal access token" },
  { re: /gho_[A-Za-z0-9]{36,}/, label: "GitHub OAuth token" },
  { re: /sk_live_[A-Za-z0-9]{20,}/, label: "Stripe live secret key" },
  { re: /sk-proj-[A-Za-z0-9_-]{20,}/, label: "OpenAI project key" },
  { re: /sk-svcacct-[A-Za-z0-9_-]{20,}/, label: "OpenAI service-account key" },
  { re: /sk-[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,}/, label: "OpenAI API key (legacy)" },
  { re: /sk-ant-[A-Za-z0-9-]{20,}/, label: "Anthropic API key" },
  { re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, label: "private key PEM block" },
  { re: /AIza[0-9A-Za-z_-]{35}/, label: "Google API key" },
];

const SECRET_SCAN_EXCLUDE = /(^|\/)(node_modules|dist|\.git|fixtures|test-fixtures)\//;
const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|ya?ml|toml|toon|md|sh|env|txt|py|rb|go|rs)$/i;

function changedFiles(): string[] {
  // Resolve a base ref without a shell fallback chain.
  let ref = "HEAD~1";
  for (const cand of [
    ["merge-base", "HEAD", "origin/main"],
    ["merge-base", "HEAD", "main"],
  ]) {
    const r = tryGit(cand);
    const sha = r.code === 0 ? r.stdout.trim() : "";
    if (sha) {
      ref = sha;
      break;
    }
  }
  const out = tryGit(["diff", "--name-only", "--diff-filter=ACMR", ref, "--", "."]);
  return out.stdout.split("\n").filter(Boolean);
}

function trackedFiles(): string[] {
  return tryGit(["ls-files"]).stdout.split("\n").filter(Boolean);
}

function scanSecrets(mode: Mode, findings: Finding[]): number {
  const files = (mode === "daily" ? changedFiles() : trackedFiles()).filter(
    (f) => TEXT_EXT.test(f) && !SECRET_SCAN_EXCLUDE.test(f),
  );
  let count = 0;
  for (const f of files) {
    const abs = path.join(REPO_ROOT, f);
    let content: string;
    try {
      if (fs.statSync(abs).size > 2 * 1024 * 1024) continue;
      content = fs.readFileSync(abs, "utf-8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const { re, label } of SECRET_PATTERNS) {
        if (re.test(lines[i])) {
          count++;
          findings.push({
            lens: "secrets",
            severity: "high",
            confidence: 9,
            file: f,
            line: i + 1,
            description: `${label} literal`,
            suggestedFix: "Move to env + rotate the credential",
          });
        }
      }
    }
  }
  return count;
}

// ---------------------------------------------------------------- lens 2
function scanDeps(findings: Finding[], notes: Note[], skippedLenses: string[]): number {
  // bun audit exists from bun 1.2.15; fall back to npm audit --json.
  const bun = tryRun("bun audit --json");
  let vulnCount = -1;
  if (bun.stdout.trim()) {
    try {
      const parsed = JSON.parse(bun.stdout);
      // Only trust a recognized shape; an unknown format must NOT read as
      // "0 vulnerabilities" (that would mask real vulns as clean).
      const advisories = parsed?.advisories ?? parsed?.vulnerabilities;
      if (advisories !== undefined) {
        vulnCount = Array.isArray(advisories) ? advisories.length : Object.keys(advisories).length;
      } else {
        notes.push({ lens: "dep-vulns", note: "bun audit output shape unrecognized — ignoring" });
      }
    } catch {
      /* fall through */
    }
  }
  if (vulnCount < 0) {
    const npm = tryRun("npm audit --json --audit-level=moderate");
    if (npm.stdout.trim()) {
      try {
        const parsed = JSON.parse(npm.stdout);
        const meta = parsed?.metadata?.vulnerabilities;
        if (meta) {
          vulnCount = (meta.moderate ?? 0) + (meta.high ?? 0) + (meta.critical ?? 0);
        }
      } catch {
        /* fall through */
      }
    }
  }
  if (vulnCount < 0) {
    // Not checked ≠ clean — but only degrade the gate when there are deps
    // that SHOULD have been audited. A repo with no package.json has nothing
    // to audit, so the lens is legitimately N/A, not a coverage gap.
    if (fs.existsSync(path.join(REPO_ROOT, "package.json"))) {
      notes.push({ lens: "dep-vulns", note: "audit tool unavailable — lens skipped (gate degraded to warn)" });
      skippedLenses.push("dep-vulns");
    } else {
      notes.push({ lens: "dep-vulns", note: "no package.json — dependency audit not applicable" });
    }
    return 0;
  }
  if (vulnCount > 0) {
    findings.push({
      lens: "dep-vulns",
      severity: "high",
      confidence: 8,
      file: "package.json",
      line: "",
      description: `${vulnCount} moderate+ dependency vulnerabilities`,
      suggestedFix: "Run the audit tool locally and upgrade the flagged packages",
    });
  }
  return vulnCount;
}

// ---------------------------------------------------------------- lens 6
function scanFilePerms(findings: Finding[]): number {
  let count = 0;
  for (const f of trackedFiles()) {
    const abs = path.join(REPO_ROOT, f);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (stat.isFile() && (stat.mode & 0o002) !== 0) {
      count++;
      findings.push({
        lens: "file-perms",
        severity: "medium",
        confidence: 9,
        file: f,
        line: "",
        description: "world-writable tracked file",
        suggestedFix: `chmod o-w ${f}`,
      });
    }
  }
  // .env-family files that git does NOT ignore (i.e. would be committed).
  // Filter in JS rather than piping to grep (portable; no shell).
  const envCandidates = tryGit(["ls-files", "--cached", "--others", "--exclude-standard"])
    .stdout.split("\n")
    .filter(Boolean)
    .filter((f) => /(^|\/)\.env(\.|$)/.test(f))
    .filter((f) => !/\.env\.(example|sample|template)$/.test(f));
  for (const f of envCandidates) {
    count++;
    findings.push({
      lens: "file-perms",
      severity: "high",
      confidence: 9,
      file: f,
      line: "",
      description: ".env-family file not covered by .gitignore",
      suggestedFix: `Add ${f} to .gitignore and purge it from history if committed`,
    });
  }
  return count;
}

// ---------------------------------------------------------------- lens 7
function scanCicd(findings: Finding[]): number {
  const wfDir = path.join(REPO_ROOT, ".github", "workflows");
  if (!fs.existsSync(wfDir)) return 0;
  let count = 0;
  let names: string[];
  try {
    names = fs.readdirSync(wfDir);
  } catch {
    return count;
  }
  for (const name of names) {
    if (!/\.ya?ml$/.test(name)) continue;
    const rel = path.join(".github", "workflows", name);
    let content: string;
    try {
      content = fs.readFileSync(path.join(wfDir, name), "utf-8");
    } catch {
      continue; // unreadable file — skip, don't crash the scan
    }
    const lines = content.split("\n");
    // Match permissions: at any indentation (top-level OR job-level).
    const hasPermissions = /^\s*permissions:/m.test(content);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const uses = /^\s*(?:-\s+)?uses:\s*([^\s#]+)/.exec(line);
      if (uses) {
        const ref = uses[1];
        // local actions (./) and docker:// refs are out of scope
        if (!ref.startsWith("./") && !ref.startsWith("docker://")) {
          const pinned = /@[0-9a-f]{40}$/.test(ref.trim());
          if (!pinned) {
            count++;
            findings.push({
              lens: "cicd",
              severity: "medium",
              confidence: 9,
              file: rel,
              line: i + 1,
              description: `third-party action not pinned by full SHA: ${ref}`,
              suggestedFix: "Pin to the 40-char commit SHA with a version comment",
            });
          }
        }
      }
      // `npm install` on any script line — covers multi-line `run: |` blocks
      // where the command lands on a later line. Exclude comments and the
      // name/description keys (which may quote the phrase).
      if (
        /\bnpm install\b(?!-)/.test(line) &&
        !/^\s*#/.test(line) &&
        !/^\s*(?:name|desc|description):/.test(line)
      ) {
        count++;
        findings.push({
          lens: "cicd",
          severity: "medium",
          confidence: 8,
          file: rel,
          line: i + 1,
          description: "npm install in CI (non-reproducible)",
          suggestedFix: "Use npm ci or bun install --frozen-lockfile",
        });
      }
    }
    if (!hasPermissions) {
      count++;
      findings.push({
        lens: "cicd",
        severity: "low",
        confidence: 8,
        file: rel,
        line: "",
        description: "workflow has no permissions: block (defaults to broad token scope)",
        suggestedFix: "Add a least-privilege permissions: block",
      });
    }
  }
  return count;
}

// ---------------------------------------------------------------- scoring + history
/** Weighted deduction per lens count; score floors at 0, ceilings at 10. */
export function computeScore(c: LensCounts): number {
  const deduction =
    3 * c.secretsCount +
    1 * c.depVulnCount +
    2 * c.authGaps +
    1 * c.inputValidationGaps +
    2 * c.llmTrustIssues +
    1 * c.filePermIssues +
    1 * c.cicdIssues;
  return Math.max(0, Math.min(10, 10 - deduction));
}

const HISTORY_HEADER =
  "entries[0]{timestamp,mode,score,confidenceFloor,secretsCount,depVulnCount,authGaps,inputValidationGaps,llmTrustIssues,filePermIssues,cicdIssues,gitSha}:";

/**
 * Pure gate decision. `block` = regression vs the last daily entry; `warn` =
 * below the 8/10 floor OR a scriptable lens was skipped ("not checked" ≠
 * "clean"). Monthly never gates. Exported for unit testing.
 */
export function decideGate(
  mode: Mode,
  score: number,
  previous: number | null,
  degraded: boolean,
): "pass" | "block" | "warn" {
  if (mode !== "daily") return "pass";
  if (previous !== null && score < previous) return "block";
  if (score < 8 || degraded) return "warn";
  return "pass";
}

export function lastDailyScore(historyContent: string): number | null {
  const rows = historyContent.split("\n").filter((l) => /^ {2}\S/.test(l));
  for (let i = rows.length - 1; i >= 0; i--) {
    const cols = rows[i].trim().split(",");
    if (cols[1] === "daily") {
      const s = parseInt(cols[2], 10);
      return Number.isFinite(s) ? s : null;
    }
  }
  return null;
}

function atomicAppendHistory(row: string): void {
  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
  let existing = fs.existsSync(HISTORY_PATH)
    ? fs.readFileSync(HISTORY_PATH, "utf-8")
    : `schemaVersion: 1\n${HISTORY_HEADER}\n`;
  const headerRe = /^entries\[(\d+)\]\{([^}]+)\}:\s*$/m;
  const m = headerRe.exec(existing);
  if (m) {
    existing = existing.replace(headerRe, `entries[${parseInt(m[1], 10) + 1}]{${m[2]}}:`);
  }
  const updated = existing.endsWith("\n") ? existing + row : existing + "\n" + row;
  const tmp = `${HISTORY_PATH}.tmp`;
  fs.writeFileSync(tmp, updated);
  fs.renameSync(tmp, HISTORY_PATH);
}

// ---------------------------------------------------------------- main
function intFlag(argv: string[], name: string): number {
  const i = argv.indexOf(name);
  if (i === -1 || i + 1 >= argv.length) return 0;
  const v = parseInt(argv[i + 1], 10);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const mode = argv[0] as Mode;
  if (mode !== "daily" && mode !== "monthly") {
    process.stderr.write(
      "usage: loom-cso.ts <daily|monthly> [--auth-gaps N] [--input-validation-gaps N] [--llm-trust-issues N]\n",
    );
    return 2;
  }

  const findings: Finding[] = [];
  const notes: Note[] = [];
  const skippedLenses: string[] = [];
  const counts: LensCounts = {
    secretsCount: scanSecrets(mode, findings),
    depVulnCount: scanDeps(findings, notes, skippedLenses),
    authGaps: intFlag(argv, "--auth-gaps"),
    inputValidationGaps: intFlag(argv, "--input-validation-gaps"),
    llmTrustIssues: intFlag(argv, "--llm-trust-issues"),
    filePermIssues: scanFilePerms(findings),
    cicdIssues: scanCicd(findings),
  };

  const score = computeScore(counts);
  const confidenceFloor = mode === "daily" ? 8 : 2;
  const visibleFindings = findings.filter((f) => f.confidence >= confidenceFloor);

  let history = "";
  try {
    if (fs.existsSync(HISTORY_PATH)) history = fs.readFileSync(HISTORY_PATH, "utf-8");
  } catch {
    // Unreadable history degrades to "no prior score", never aborts the gate.
    history = "";
  }
  const previous = lastDailyScore(history);

  const gateResult = decideGate(mode, score, previous, skippedLenses.length > 0);

  const gitSha = tryGit(["rev-parse", "--short", "HEAD"]).stdout.trim() || "unknown";
  const timestamp = new Date().toISOString();
  const row = `  ${timestamp},${mode},${score},${confidenceFloor},${counts.secretsCount},${counts.depVulnCount},${counts.authGaps},${counts.inputValidationGaps},${counts.llmTrustIssues},${counts.filePermIssues},${counts.cicdIssues},${gitSha}\n`;
  try {
    atomicAppendHistory(row);
  } catch (e) {
    process.stderr.write(`# security-history write failed (non-fatal): ${(e as Error).message}\n`);
  }

  // Every TOON cell must escape the column separator, not just prose fields.
  const esc = (s: string): string => s.replaceAll(",", ";");
  const findingRows = visibleFindings
    .map(
      (f) =>
        `  ${esc(f.lens)},${esc(f.severity)},${f.confidence},${esc(String(f.file))},${f.line},${esc(f.description)},${esc(f.suggestedFix)}`,
    )
    .join("\n");
  process.stdout.write(
    `mode: ${mode}\n` +
      `score: ${score}\n` +
      `previousScore: ${previous ?? "none"}\n` +
      `delta: ${previous === null ? "n/a" : score - previous}\n` +
      `gateResult: ${gateResult}\n` +
      `findings[${visibleFindings.length}]{lens,severity,confidence,file,line,description,suggestedFix}:\n` +
      (findingRows ? findingRows + "\n" : "") +
      (notes.length
        ? `notes[${notes.length}]{lens,note}:\n${notes.map((n) => `  ${esc(n.lens)},${esc(n.note)}`).join("\n")}\n`
        : ""),
  );

  return mode === "daily" && gateResult !== "pass" ? 1 : 0;
}

if (require.main === module) {
  process.exit(main());
}
