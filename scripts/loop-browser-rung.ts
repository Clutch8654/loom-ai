#!/usr/bin/env -S bun run
/**
 * loop-browser-rung — the feedback-loop Rung-4 (headless browser) daemon
 * assertion (PLAN-browser-e2e, P5). This is the shell-executable command a
 * Rung-4 `loop.toon` puts in its `command` field: a SINGLE process that drives
 * a browser assertion and exits with a genuine red/green code.
 *
 *   green  → exit 0   (assertion held: page text contains the expected marker)
 *   red    → exit 1   (assertion failed: structured RUNG4-RED signal on stderr)
 *   usage  → exit 2   (missing/blank --url or --expect)
 *   harness→ exit 9   (could not obtain page text — HARNESS_OUTPUT_INCOMPATIBLE)
 *
 * The exit-code contract is what makes this loop TRDA-compliant (schema at
 * protocols/feedback-loop.schema.md, gate at skills/feedback-loop/SKILL.md):
 *   - tight        : it asserts ONE thing — "does the page text contain <expect>".
 *   - redCapable   : a failed assertion prints structured stderr + exits 1.
 *   - deterministic: pure function of (page text, expect); two runs agree.
 *   - agentRunnable: no HITL — a fixer runs `bun scripts/loop-browser-rung.ts …`.
 *
 * TWO drive modes obtain the page text; the ASSERTION over that text is shared,
 * so the exit-code contract is identical either way:
 *
 *   --mode daemon  (DEFAULT) — the real Rung-4 signal. Reads the resolved CDP
 *     endpoint from `.loom/browser/state.toon`, attaches with the P1a
 *     `connect()` (NEVER launches), `navigate`s (execWrite) to --url, and reads
 *     the DOM text of --selector (execRead dom-query, default `body`). This is
 *     the path a live fixer uses once Chromium drives.
 *
 *   --mode fetch — a page-drive-FREE hermetic path. HTTP-GETs --url and treats
 *     the response body as the page text. Requires NO CDP handshake, so it runs
 *     everywhere (including this env's known-runtime-gap where the live
 *     headless-Chrome ↔ pw-core handshake stalls). The P5 test drives THIS mode
 *     against the P2 fixture server, flipping the served content between two
 *     real invocations to prove red→green without touching Chromium.
 *
 * The two modes are a deliberate substitution at the TEXT-SOURCE boundary only:
 * everything downstream (the assertion, the structured red output, the exit
 * code) is one code path. That is why a fetch-mode green is genuine evidence
 * the daemon-mode contract holds.
 *
 * Reuse (P6 tdd-coach): the Rung-4 `loop.toon.command` is just
 *   bun scripts/loop-browser-rung.ts --url <URL> --expect <MARKER> [--selector <SEL>]
 * The `command` field in feedback-loop.schema.md:50 already accepts any single
 * shell string, so wiring a browser rung needs NO schema change — a tdd-coach
 * or converger emits this exact line as the loop's command.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { connect, type BrowserSession } from "./lib/browser-client.js";
import { parseToon } from "../lib/index.js";
import type { BrowserCommand } from "../lib/types.js";

/* ── Exit codes (mirror the feedback-loop red/green contract) ─────────────── */

export const RUNG4_EXIT = {
  GREEN: 0,
  RED: 1,
  USAGE: 2,
  HARNESS_INCOMPATIBLE: 9,
} as const;

export type RungDriveMode = "daemon" | "fetch";

export interface RungConfig {
  url: string;
  expect: string;
  selector: string;
  mode: RungDriveMode;
  timeoutMs: number;
}

export interface RungOutcome {
  /** true → green (assertion held), false → red (assertion failed). */
  pass: boolean;
  /** The page text the assertion ran against (truncated for the red dump). */
  actual: string;
  /** The exact substring the assertion required. */
  expect: string;
  url: string;
  mode: RungDriveMode;
}

/** Raised when the harness cannot obtain page text at all (→ exit 9). */
export class RungHarnessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RungHarnessError";
  }
}

/* ── Shared assertion — the ONE thing this rung checks ────────────────────── */

/**
 * Evaluate the Rung-4 assertion over already-obtained page text. Pure and
 * deterministic: green iff `pageText` contains `expect` verbatim. Shared by
 * both drive modes so the red/green contract can never diverge between them.
 */
export function evaluateAssertion(
  pageText: string,
  expect: string
): boolean {
  return pageText.includes(expect);
}

/* ── argv / env parsing ───────────────────────────────────────────────────── */

const BROWSER_STATE = path.join(
  process.cwd(),
  ".loom",
  "browser",
  "state.toon"
);

function isDriveMode(v: string): v is RungDriveMode {
  return v === "daemon" || v === "fetch";
}

/**
 * Parse argv (`--flag value` / `--flag=value`) with env-var fallbacks
 * (LOOM_BROWSER_*). Returns a config or a usage error string.
 */
export function parseArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): RungConfig | { error: string } {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith("--")) continue;
    const eq = tok.indexOf("=");
    if (eq !== -1) {
      flags[tok.slice(2, eq)] = tok.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[tok.slice(2)] = next;
        i++;
      } else {
        flags[tok.slice(2)] = "true";
      }
    }
  }

  const url = (flags["url"] ?? env["LOOM_BROWSER_URL"] ?? "").trim();
  const expect = flags["expect"] ?? env["LOOM_BROWSER_EXPECT"] ?? "";
  const selector = (
    flags["selector"] ??
    env["LOOM_BROWSER_SELECTOR"] ??
    "body"
  ).trim();
  const rawMode = (flags["mode"] ?? env["LOOM_BROWSER_MODE"] ?? "daemon").trim();
  const rawTimeout = flags["timeout"] ?? env["LOOM_BROWSER_TIMEOUT"] ?? "30000";

  if (!url) return { error: "missing --url (or LOOM_BROWSER_URL)" };
  if (expect === "") return { error: "missing --expect (or LOOM_BROWSER_EXPECT)" };
  if (!isDriveMode(rawMode)) {
    return { error: `invalid --mode '${rawMode}' (expected 'daemon' | 'fetch')` };
  }
  const timeoutMs = Number.parseInt(rawTimeout, 10);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { error: `invalid --timeout '${rawTimeout}'` };
  }

  return { url, expect, selector, mode: rawMode, timeoutMs };
}

/* ── Drive mode: fetch (page-drive-free, hermetic) ────────────────────────── */

/**
 * Obtain page text by HTTP-GETting the URL. No CDP handshake — runs everywhere.
 * A non-2xx status or a transport failure is a HARNESS error (not a red): the
 * assertion never ran, so we must not report a green-or-red verdict.
 */
export async function driveFetch(
  url: string,
  timeoutMs: number
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new RungHarnessError(
        `fetch ${url} returned HTTP ${res.status}; assertion did not run`
      );
    }
    return await res.text();
  } catch (err) {
    if (err instanceof RungHarnessError) throw err;
    throw new RungHarnessError(
      `fetch ${url} failed: ${(err as Error).message}`
    );
  } finally {
    clearTimeout(timer);
  }
}

/* ── Drive mode: daemon (real Rung-4 — attaches to running Chromium) ──────── */

/** Read the resolved cdpEndpoint the daemon persisted into state.toon. */
export function readCdpEndpoint(statePath: string = BROWSER_STATE): string {
  if (!fs.existsSync(statePath)) return "";
  let parsed: unknown;
  try {
    parsed = parseToon(fs.readFileSync(statePath, "utf-8"));
  } catch {
    return "";
  }
  if (typeof parsed === "object" && parsed !== null) {
    const ep = (parsed as Record<string, unknown>)["cdpEndpoint"];
    if (typeof ep === "string") return ep;
  }
  return "";
}

/**
 * Obtain page text by driving the live daemon: attach over CDP, navigate to the
 * URL, and read the DOM text of the selector. A missing/unresolved endpoint or
 * any CDP/exec failure is a HARNESS error (exit 9) — never a false red. This is
 * the path a fixer uses once Chromium drives; in the known-runtime-gap env it
 * raises HARNESS and the caller uses --mode fetch instead.
 */
export async function driveDaemon(cfg: RungConfig): Promise<string> {
  const endpoint = readCdpEndpoint();
  if (!endpoint) {
    throw new RungHarnessError(
      "no resolved cdpEndpoint in .loom/browser/state.toon; " +
        "start the daemon (`loom-browser start`) or use --mode fetch"
    );
  }

  let session: BrowserSession;
  try {
    session = await connect(endpoint, cfg.timeoutMs);
  } catch (err) {
    throw new RungHarnessError(
      `CDP attach failed (${(err as Error).message}); use --mode fetch in a ` +
        "no-Chromium env"
    );
  }

  try {
    const { execWrite, execRead } = await import("./lib/browser-client.js");
    const navCmd: BrowserCommand = {
      verb: "navigate",
      tier: "write",
      target: cfg.url,
      timeoutMs: cfg.timeoutMs,
    };
    const nav = await execWrite(session, navCmd);
    if (!nav.ok) {
      throw new RungHarnessError(
        `navigate ${cfg.url} failed: ${nav.error?.code ?? "unknown"}`
      );
    }
    const readCmd: BrowserCommand = {
      verb: "dom-query",
      tier: "read",
      target: cfg.selector,
      timeoutMs: cfg.timeoutMs,
    };
    const read = await execRead(session, readCmd);
    if (!read.ok) {
      throw new RungHarnessError(
        `dom-query ${cfg.selector} failed: ${read.error?.code ?? "unknown"}`
      );
    }
    const data = read.data as { text?: string | null; html?: string } | null;
    return String(data?.text ?? data?.html ?? "");
  } finally {
    await session.dispose();
  }
}

/* ── Orchestration ────────────────────────────────────────────────────────── */

/**
 * Obtain page text via the configured mode, then run the shared assertion.
 * Throws RungHarnessError when text could not be obtained (→ exit 9).
 */
export async function runRung(cfg: RungConfig): Promise<RungOutcome> {
  const pageText =
    cfg.mode === "fetch"
      ? await driveFetch(cfg.url, cfg.timeoutMs)
      : await driveDaemon(cfg);
  return {
    pass: evaluateAssertion(pageText, cfg.expect),
    actual: pageText,
    expect: cfg.expect,
    url: cfg.url,
    mode: cfg.mode,
  };
}

/** Truncate the observed page text for the structured red dump. */
function truncate(text: string, max = 500): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)} …[truncated]` : flat;
}

/**
 * Structured red signal on stderr (redCapable): a fixer / converger parses
 * these `key: value` lines verbatim into `loop.toon.redOutput`.
 */
export function formatRed(outcome: RungOutcome): string {
  return [
    "RUNG4-RED",
    `mode: ${outcome.mode}`,
    `url: ${outcome.url}`,
    `assertion: page text must contain the expected marker`,
    `expected: ${outcome.expect}`,
    `actual: ${truncate(outcome.actual)}`,
  ].join("\n");
}

/** Structured green signal on stdout. */
export function formatGreen(outcome: RungOutcome): string {
  return `RUNG4-GREEN mode=${outcome.mode} url=${outcome.url} expected=${outcome.expect}`;
}

/**
 * CLI entry. Resolves argv → config → outcome → exit code. Returns the code
 * (does not call process.exit) so it stays unit-testable; the module-tail
 * runner applies process.exit.
 */
export async function main(
  argv: readonly string[],
  streams: { out: (s: string) => void; err: (s: string) => void } = {
    out: (s) => process.stdout.write(`${s}\n`),
    err: (s) => process.stderr.write(`${s}\n`),
  }
): Promise<number> {
  const parsed = parseArgs(argv);
  if ("error" in parsed) {
    streams.err(`RUNG4-USAGE ${parsed.error}`);
    return RUNG4_EXIT.USAGE;
  }

  let outcome: RungOutcome;
  try {
    outcome = await runRung(parsed);
  } catch (err) {
    if (err instanceof RungHarnessError) {
      streams.err(`RUNG4-HARNESS ${err.message}`);
      return RUNG4_EXIT.HARNESS_INCOMPATIBLE;
    }
    streams.err(`RUNG4-HARNESS unexpected: ${(err as Error).message}`);
    return RUNG4_EXIT.HARNESS_INCOMPATIBLE;
  }

  if (outcome.pass) {
    streams.out(formatGreen(outcome));
    return RUNG4_EXIT.GREEN;
  }
  streams.err(formatRed(outcome));
  return RUNG4_EXIT.RED;
}

/* ── Module-tail runner: execute only when run directly (not on import) ────── */

const isDirectRun =
  typeof process.argv[1] === "string" &&
  /loop-browser-rung\.ts$/.test(process.argv[1]);

if (isDirectRun) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`RUNG4-HARNESS fatal: ${(err as Error).message}\n`);
      process.exit(RUNG4_EXIT.HARNESS_INCOMPATIBLE);
    });
}
