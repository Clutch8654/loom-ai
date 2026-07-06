/**
 * scripts/generate-docs.ts — regenerates the marker-bounded documentation
 * sections whose content is derived from a single source of truth, so the
 * command table, hook count/table, and agent model-tier table can never drift
 * from `commands/`, `scripts/lib/loom-hooks-manifest.ts`, and `agents/`
 * (F-18, C-05, defect 12).
 *
 * Every generated block lives between HTML-comment markers:
 *   <!-- loom:generated:{section} -->  …  <!-- /loom:generated:{section} -->
 * Only the content BETWEEN the markers is ever rewritten — narrative prose
 * outside the markers is never touched (proven by tests/scripts/generate-docs.test.ts).
 *
 * Usage:
 *   bun scripts/generate-docs.ts --write     regenerate blocks + manifest in place
 *   bun scripts/generate-docs.ts --check      report would-change sections; exit 1 on drift
 *   bun scripts/generate-docs.ts --root <dir>  repo root (default cwd)
 *
 * The per-section sha256 recorded in `docs/.generated-manifest.toon`
 * (DocsGenerationManifest) is consumed by scripts/ci/check-docs-drift.ts, which
 * recomputes the expected content from the same sources — so adding a hook,
 * command, or agent without regenerating fails CI.
 *
 * Node-runnable (erasable TS only); also runs under bun. Exports pure render
 * helpers so check-docs-drift.ts and the test suite import without side effects.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWrite } from "../lib/atomic-fs.js";
import { LOOM_HOOKS } from "./lib/loom-hooks-manifest.js";
import { parseFrontmatter } from "./lib/frontmatter.js";
import type { DocsSection } from "../lib/types.js";

/* ── Markers + hashing (shared with check-docs-drift.ts) ─────────────────── */

export function markerBegin(section: string): string {
  return `<!-- loom:generated:${section} -->`;
}
export function markerEnd(section: string): string {
  return `<!-- /loom:generated:${section} -->`;
}

/** Extract the content between a section's markers, or null if either is absent. */
export function extractBlock(fileText: string, section: string): string | null {
  const begin = markerBegin(section);
  const end = markerEnd(section);
  const beginIdx = fileText.indexOf(begin);
  const endIdx = fileText.indexOf(end);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) return null;
  return fileText.slice(beginIdx + begin.length, endIdx);
}

/** Replace the content between a section's markers; throws if markers absent. */
function replaceBlock(fileText: string, section: string, inner: string): string {
  const begin = markerBegin(section);
  const end = markerEnd(section);
  const beginIdx = fileText.indexOf(begin);
  const endIdx = fileText.indexOf(end);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    throw new Error(`markers for section '${section}' missing or malformed`);
  }
  return fileText.slice(0, beginIdx + begin.length) + inner + fileText.slice(endIdx);
}

export function sha256(text: string): string {
  // Normalize CRLF→LF so a Windows checkout (core.autocrlf) hashes identically
  // to the LF content the generator builds in-memory — avoids false drift.
  return createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
}

/* ── Source gathering ────────────────────────────────────────────────────── */

interface CommandEntry {
  name: string;
  description: string;
}
interface AgentEntry {
  name: string;
  model: string;
  description: string;
}

/** Recursively list every `*.md` under `dir` (relative to nothing — absolute). */
function walkMarkdown(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(full));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

/**
 * User-invocable slash commands = top-level `commands/*.md`, excluding
 * underscore-prefixed partials (e.g. `_loom-init-guard.md`) which are includes,
 * not commands. Subcommand files live in `commands/<name>/` and are not listed.
 */
export function gatherCommands(root: string): CommandEntry[] {
  const dir = join(root, "commands");
  if (!existsSync(dir)) return [];
  const entries: CommandEntry[] = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (!d.isFile() || !d.name.endsWith(".md") || d.name.startsWith("_")) continue;
    const fm = parseFrontmatter(readFileSync(join(dir, d.name), "utf8"));
    entries.push({ name: d.name.slice(0, -3), description: fm.description ?? "" });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Spawnable agents = any `agents/**` markdown file whose frontmatter declares a
 * `name:` (reference cards like plan-critic-checklist carry only a description
 * and are excluded from the model-tier table).
 */
export function gatherAgents(root: string): AgentEntry[] {
  const entries: AgentEntry[] = [];
  for (const file of walkMarkdown(join(root, "agents"))) {
    const fm = parseFrontmatter(readFileSync(file, "utf8"));
    if (!fm.name) continue;
    entries.push({
      name: fm.name,
      model: fm.model && fm.model.length > 0 ? fm.model : "(inherit)",
      description: fm.description ?? "",
    });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/** Count of distinct hook names in the canonical manifest (registrations ≥ this). */
export function uniqueHookCount(): number {
  return new Set(LOOM_HOOKS.map((h) => h.hookName)).size;
}

/* ── Rendering ───────────────────────────────────────────────────────────── */

/** Escape a value for a single Markdown table cell. */
function cell(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

/** First sentence (or `max` chars), for the compact agent description column. */
function summarize(text: string, max = 100): string {
  const flat = text.replace(/\r?\n/g, " ").trim();
  const sentenceEnd = flat.indexOf(". ");
  let out = sentenceEnd !== -1 && sentenceEnd <= max ? flat.slice(0, sentenceEnd + 1) : flat;
  if (out.length > max) out = out.slice(0, max - 1).trimEnd() + "…";
  return out;
}

function renderCommandsTable(commands: CommandEntry[]): string {
  const rows = commands.map((c) => `| \`/${c.name}\` | ${cell(c.description)} |`);
  return ["| Command | Description |", "|---|---|", ...rows].join("\n");
}

function renderHooksTable(): string {
  const rows = LOOM_HOOKS.map((h) => {
    const matcher = h.matcher && h.matcher.length > 0 ? `\`${h.matcher}\`` : "—";
    return `| \`${h.hookName}\` | ${h.event} | ${matcher} | ${h.timeoutMs}ms |`;
  });
  return ["| Hook | Event | Matcher | Timeout |", "|---|---|---|---|", ...rows].join("\n");
}

function renderAgentsTable(agents: AgentEntry[]): string {
  const rows = agents.map(
    (a) => `| \`${a.name}\` | ${cell(a.model)} | ${cell(summarize(a.description))} |`,
  );
  return ["| Agent | Model | Description |", "|---|---|---|", ...rows].join("\n");
}

/* ── Section registry ────────────────────────────────────────────────────── */

type SectionKind = "inline" | "block";

interface SectionDef {
  section: string;
  targetFile: string;
  source: string;
  kind: SectionKind;
  render: (ctx: RenderContext) => string;
}

interface RenderContext {
  commands: CommandEntry[];
  agents: AgentEntry[];
  hookCount: number;
}

const HOOK_MANIFEST_SOURCE = "scripts/lib/loom-hooks-manifest.ts";

const SECTION_DEFS: SectionDef[] = [
  // README count sites — all resolve to the same manifest-derived number, so the
  // four former "eighteen vs 17 vs 13" drift points can never diverge again.
  { section: "hook-count-summary", targetFile: "README.md", source: HOOK_MANIFEST_SOURCE, kind: "inline", render: (c) => String(c.hookCount) },
  { section: "hook-count-tier", targetFile: "README.md", source: HOOK_MANIFEST_SOURCE, kind: "inline", render: (c) => String(c.hookCount) },
  { section: "hook-count-section", targetFile: "README.md", source: HOOK_MANIFEST_SOURCE, kind: "inline", render: (c) => String(c.hookCount) },
  { section: "hook-count-deepdive", targetFile: "README.md", source: HOOK_MANIFEST_SOURCE, kind: "inline", render: (c) => String(c.hookCount) },
  // Reference tables.
  { section: "commands-table", targetFile: "docs/reference/commands.md", source: "commands/*.md frontmatter", kind: "block", render: (c) => renderCommandsTable(c.commands) },
  { section: "hooks-table", targetFile: "docs/reference/hooks.md", source: HOOK_MANIFEST_SOURCE, kind: "block", render: () => renderHooksTable() },
  { section: "agents-table", targetFile: "docs/reference/agents.md", source: "agents/**/*.md frontmatter", kind: "block", render: (c) => renderAgentsTable(c.agents) },
];

/** Skeletons for reference files created on first `--write` (markers are then filled). */
const FILE_TEMPLATES: Record<string, string> = {
  "docs/reference/commands.md": `# Command Reference

Every user-invocable Loom slash command, generated from the \`description:\`
frontmatter of each top-level \`commands/*.md\` file. This table is regenerated by
\`bun scripts/generate-docs.ts --write\` — do not edit the rows between the
\`loom:generated\` markers by hand.

<!-- loom:generated:commands-table -->
<!-- /loom:generated:commands-table -->
`,
  "docs/reference/hooks.md": `# Hook Reference

Every Loom hook registration, generated from the canonical manifest
\`scripts/lib/loom-hooks-manifest.ts\`. Hooks fail-open on missing state and
fail-closed on schema-version mismatches. This table is regenerated by
\`bun scripts/generate-docs.ts --write\` — do not edit the rows between the
\`loom:generated\` markers by hand. (\`context-monitor\` is registered twice by
design: once on PostToolUse for ambient telemetry, once on Stop for the
end-of-session snapshot.)

<!-- loom:generated:hooks-table -->
<!-- /loom:generated:hooks-table -->
`,
  "docs/reference/agents.md": `# Agent Reference

Every spawnable Loom agent and its resolved model tier, generated from the
\`name:\` / \`model:\` frontmatter of each \`agents/**/*.md\` file. Agents without a
\`model:\` inherit the parent tier. This table is regenerated by
\`bun scripts/generate-docs.ts --write\` — do not edit the rows between the
\`loom:generated\` markers by hand.

<!-- loom:generated:agents-table -->
<!-- /loom:generated:agents-table -->
`,
};

/* ── Public API ──────────────────────────────────────────────────────────── */

export interface RenderedSection {
  section: string;
  targetFile: string;
  source: string;
  /** Inner content between the markers (inline: bare value; block: newline-wrapped). */
  content: string;
  checksum: string;
}

/**
 * Render every generated section from the live sources. This is the single
 * source of truth for both writing (this script) and drift detection
 * (check-docs-drift.ts) — they can never disagree because they call this.
 */
export function renderAllSections(root: string): RenderedSection[] {
  const ctx: RenderContext = {
    commands: gatherCommands(root),
    agents: gatherAgents(root),
    hookCount: uniqueHookCount(),
  };
  return SECTION_DEFS.map((def) => {
    const rendered = def.render(ctx);
    const content = def.kind === "block" ? `\n${rendered}\n` : rendered;
    return { section: def.section, targetFile: def.targetFile, source: def.source, content, checksum: sha256(content) };
  });
}

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function renderManifestSectionsBlock(sections: RenderedSection[]): string {
  const lines = [`sections[${sections.length}]{section,targetFile,source,checksum,drift}:`];
  for (const s of sections) {
    lines.push("  " + [s.section, s.targetFile, s.source, s.checksum, "none"].map(csvField).join(","));
  }
  return lines.join("\n");
}

export interface GenerateResult {
  changedFiles: string[];
  manifestChanged: boolean;
  sections: RenderedSection[];
}

/**
 * Fill every marker block and (if `write`) rewrite changed files + the manifest.
 * Reference files are created from FILE_TEMPLATES on first run. When nothing
 * changes, no file is touched — so a second `--write` is a genuine no-op.
 */
export function generate(root: string, write: boolean): GenerateResult {
  const sections = renderAllSections(root);
  const byFile = new Map<string, RenderedSection[]>();
  for (const s of sections) {
    const list = byFile.get(s.targetFile) ?? [];
    list.push(s);
    byFile.set(s.targetFile, list);
  }

  const changedFiles: string[] = [];
  for (const [targetFile, fileSections] of byFile) {
    const path = resolve(root, targetFile);
    let text: string;
    if (existsSync(path)) {
      text = readFileSync(path, "utf8");
    } else if (FILE_TEMPLATES[targetFile]) {
      text = FILE_TEMPLATES[targetFile];
    } else {
      throw new Error(`target ${targetFile} does not exist and has no template`);
    }
    const original = existsSync(path) ? text : null;
    for (const s of fileSections) text = replaceBlock(text, s.section, s.content);
    if (text !== original) {
      changedFiles.push(targetFile);
      if (write) atomicWrite(path, text);
    }
  }

  // Manifest — preserve generatedAt when the section checksums are unchanged so
  // repeated writes are idempotent.
  const manifestPath = resolve(root, "docs/.generated-manifest.toon");
  const sectionsBlock = renderManifestSectionsBlock(sections);
  let generatedAt = new Date().toISOString();
  let manifestChanged = true;
  if (existsSync(manifestPath)) {
    const existing = readFileSync(manifestPath, "utf8");
    const nl = existing.indexOf("\n");
    const existingRest = nl >= 0 ? existing.slice(nl + 1) : "";
    if (existingRest.trimEnd() === sectionsBlock.trimEnd()) {
      const m = /generatedAt:\s*(.+)/.exec(nl >= 0 ? existing.slice(0, nl) : existing);
      if (m) generatedAt = m[1].trim();
      manifestChanged = false;
    }
  }
  if (write && manifestChanged) {
    atomicWrite(manifestPath, `generatedAt: ${generatedAt}\n${sectionsBlock}\n`);
  }

  return { changedFiles, manifestChanged, sections };
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */

function main(argv: string[]): void {
  let write = false;
  let root = process.cwd();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--write") write = true;
    else if (a === "--check") write = false;
    else if (a === "--root") root = argv[++i] ?? root;
    else {
      process.stderr.write(`error: GENERATE_DOCS_USAGE\nmessage: unknown flag ${a}\n`);
      process.exit(1);
    }
  }

  const result = generate(root, write);
  const lines = [
    "generateDocsReport:",
    `  mode: ${write ? "write" : "check"}`,
    `  sectionCount: ${result.sections.length}`,
    `  changedFileCount: ${result.changedFiles.length}`,
    `  manifestChanged: ${result.manifestChanged}`,
    `changedFiles[${result.changedFiles.length}]: ${result.changedFiles.join(", ")}`,
  ];
  process.stdout.write(lines.join("\n") + "\n");

  if (!write && (result.changedFiles.length > 0 || result.manifestChanged)) {
    process.stderr.write(
      `error: DOCS_REGEN_REQUIRED\nmessage: run 'bun scripts/generate-docs.ts --write' to update generated docs\n`,
    );
    process.exit(1);
  }
  process.exit(0);
}

// Run only when invoked directly (never on import by check-docs-drift / tests).
// import.meta.main is set by bun; the argv fallback covers node/tsx.
const invokedDirectly =
  (import.meta as { main?: boolean }).main ??
  (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main(process.argv.slice(2));
}

export type { DocsSection };
