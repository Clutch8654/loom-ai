/**
 * scripts/ci/check-docs-drift.ts — CI check `docs-drift` (frozen name, see
 * protocols/ci-gates.contract.md).
 *
 * Detects stale generated documentation by RECOMPUTING every marker-bounded
 * section from its live source (commands/, agents/, scripts/lib/loom-hooks-manifest.ts)
 * via scripts/generate-docs.ts, then comparing the recomputed content against
 *   1. the content currently in the target file (between the section markers), and
 *   2. the per-section sha256 recorded in `docs/.generated-manifest.toon`.
 *
 * A section is stale when the file's block or the manifest checksum disagrees
 * with the freshly recomputed content — so adding a hook, command, or agent
 * without running `bun scripts/generate-docs.ts --write` fails CI, as does a
 * manual edit inside a generated block.
 *
 * Flags:
 *   --check            compare only, never write (default; accepted as no-op)
 *   --warn-only        report drift without failing (pre-Phase-16 compatibility)
 *   --manifest <path>  manifest override (default docs/.generated-manifest.toon)
 *   --root <dir>       repo root for resolving sources + targetFile paths (default cwd)
 *
 * Exit codes: 0 no drift (or --warn-only); 1 DOCS_DRIFT_DETECTED naming each
 * stale section; 3 manifest missing/unparseable.
 *
 * Node-runnable (erasable TS only); also runs under bun.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DocsSection } from "../../lib/types.ts";
import { extractBlock, renderAllSections, sha256 } from "../generate-docs.ts";

interface CliOptions {
  warnOnly: boolean;
  manifest: string;
  root: string;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    warnOnly: false,
    manifest: "docs/.generated-manifest.toon",
    root: process.cwd(),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") continue; // compare-only is the only mode
    else if (a === "--warn-only") opts.warnOnly = true;
    else if (a === "--manifest") opts.manifest = argv[++i] ?? opts.manifest;
    else if (a === "--root") opts.root = argv[++i] ?? opts.root;
    else {
      process.stderr.write(`error: DOCS_DRIFT_USAGE\nmessage: unknown flag ${a}\n`);
      process.exit(1);
    }
  }
  return opts;
}

/** Split one TOON table row on commas, honoring double-quoted fields. */
function splitRow(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"' && current === "") {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/** Minimal reader for the manifest's `sections[N]{...}:` typed-array table. */
function parseManifestSections(text: string): DocsSection[] {
  const lines = text.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => /^\s*sections\[\d+\]\{[^}]*\}:\s*$/.test(l));
  if (headerIdx === -1) {
    throw new Error("no sections[N]{...}: table found in manifest");
  }
  const columns = lines[headerIdx]
    .replace(/^\s*sections\[\d+\]\{/, "")
    .replace(/\}:\s*$/, "")
    .split(",")
    .map((c) => c.trim());
  const required = ["section", "targetFile", "checksum"];
  for (const col of required) {
    if (!columns.includes(col)) throw new Error(`manifest table missing column '${col}'`);
  }
  const headerIndent = lines[headerIdx].length - lines[headerIdx].trimStart().length;
  const rows: DocsSection[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) break;
    const indent = line.length - line.trimStart().length;
    if (indent <= headerIndent) break;
    const fields = splitRow(line.trim());
    const record: Record<string, string> = {};
    columns.forEach((col, idx) => {
      record[col] = fields[idx] ?? "";
    });
    rows.push({
      section: record.section,
      targetFile: record.targetFile,
      source: record.source ?? "",
      checksum: record.checksum,
      drift: record.drift === "stale" ? "stale" : "none",
    });
  }
  if (rows.length === 0) throw new Error("manifest sections table has no rows");
  return rows;
}

type SectionStatus =
  | "clean"
  | "stale"
  | "manifest-stale"
  | "target-missing"
  | "marker-missing";

interface SectionReport {
  section: string;
  targetFile: string;
  status: SectionStatus;
}

function checkSections(root: string, manifest: DocsSection[]): SectionReport[] {
  // Recompute every generator-owned section from its live source. Sections the
  // generator does not own (e.g. hand-registered manifest entries) fall back to
  // the manifest-recorded checksum, preserving the original comparison.
  const recomputedByName = new Map(renderAllSections(root).map((s) => [s.section, s]));
  const reports: SectionReport[] = [];

  for (const m of manifest) {
    const targetPath = resolve(root, m.targetFile);
    let status: SectionStatus;
    if (!existsSync(targetPath)) {
      status = "target-missing";
    } else {
      const block = extractBlock(readFileSync(targetPath, "utf8"), m.section);
      if (block === null) {
        status = "marker-missing";
      } else {
        const fileChecksum = sha256(block);
        const recomputed = recomputedByName.get(m.section);
        if (recomputed) {
          if (fileChecksum !== recomputed.checksum) {
            status = "stale"; // file block is out of date w.r.t. its source
          } else if (m.checksum !== recomputed.checksum) {
            status = "manifest-stale"; // docs regenerated but manifest not, or hand-edited
          } else {
            status = "clean";
          }
        } else {
          status = fileChecksum === m.checksum ? "clean" : "stale";
        }
      }
    }
    reports.push({ section: m.section, targetFile: m.targetFile, status });
  }
  return reports;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));

  if (!existsSync(opts.manifest)) {
    if (opts.warnOnly) {
      process.stdout.write(
        `docsDriftReport:\n  manifest: ${opts.manifest}\n  status: manifest-missing\n  warnOnly: true\nwarning: DOCS_MANIFEST_MISSING\nnote: scripts/generate-docs.ts writes the manifest via --write\n`,
      );
      process.exit(0);
    }
    process.stderr.write(
      `error: DOCS_MANIFEST_MISSING\nmessage: ${opts.manifest} not found\n`,
    );
    process.exit(3);
  }

  let manifest: DocsSection[];
  try {
    manifest = parseManifestSections(readFileSync(opts.manifest, "utf8"));
  } catch (err) {
    process.stderr.write(
      `error: DOCS_MANIFEST_UNPARSEABLE\nmessage: ${(err as Error).message}\n`,
    );
    process.exit(3);
  }

  const results = checkSections(opts.root, manifest!);
  const stale = results.filter((r) => r.status !== "clean");

  const lines: string[] = [
    "docsDriftReport:",
    `  manifest: ${opts.manifest}`,
    `  warnOnly: ${opts.warnOnly}`,
    `  sectionCount: ${results.length}`,
    `  staleCount: ${stale.length}`,
    `sections[${results.length}]{section,targetFile,status}:`,
    ...results.map((r) => `  ${r.section},${r.targetFile},${r.status}`),
  ];
  process.stdout.write(lines.join("\n") + "\n");

  if (stale.length > 0) {
    const names = stale.map((r) => r.section).join(", ");
    if (opts.warnOnly) {
      process.stdout.write(
        `warning: DOCS_DRIFT_DETECTED\nstaleSections[${stale.length}]: ${names}\nnote: run 'bun scripts/generate-docs.ts --write' to regenerate\n`,
      );
      process.exit(0);
    }
    process.stderr.write(
      `error: DOCS_DRIFT_DETECTED\nstaleSections[${stale.length}]: ${names}\nnote: run 'bun scripts/generate-docs.ts --write' to regenerate\n`,
    );
    process.exit(1);
  }
  process.exit(0);
}

main();
