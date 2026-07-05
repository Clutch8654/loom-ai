/**
 * loom-browser CDP client — READ half (PLAN-browser-e2e, P1a).
 *
 * Attaches to an ALREADY-RUNNING Chromium over CDP with
 * `chromium.connectOverCDP()` (NEVER `launch()` — C-02) and serves the READ
 * verb tier of the BrowserCommand grammar. This is the load-bearing tracer
 * bullet: the first real drive of Chromium. Every downstream consumer
 * (daemon executor P3, e2e-runner P4a, feedback-loop Rung-4 P5, loom-qa
 * outcome eval P8a) attaches through this module.
 *
 * Import surface (criterion 5): Phase 2/3 import `connect` and `execRead`
 * DIRECTLY and call them in-process — NO subprocess round-trip. The daemon
 * CLI `exec` path is a one-shot convenience that connect→exec→dispose.
 *
 * Structure note: this file is the READ half only. P1b APPENDS the WRITE and
 * META dispatchers (`execWrite`, `execMeta`) plus the daemon lock. The shared
 * primitives they need — `BrowserSession`, `resolveTarget`, `classifyVerb`,
 * `BrowserClientError`, `errorResult`, `EXIT_CODES` — are exported below so
 * P1b can build on them without restructuring.
 *
 * Types are imported from lib/types.ts (Wave-0 source of truth) — NOT
 * redeclared (C-02 RESTRICT cascade).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Locator,
} from "playwright-core";
import type {
  A11yRef,
  BrowserCommand,
  BrowserError,
  BrowserErrorCode,
  BrowserMetaVerb,
  BrowserReadVerb,
  BrowserResult,
  BrowserTier,
  BrowserVerb,
  BrowserWriteVerb,
} from "../../lib/types.js";
import { parseToon } from "../../lib/index.js";
import type { ToonValue } from "../../lib/index.js";

/* ────────────────────────────────────────────────────────────────────────
 * Error taxonomy — stable exitCode per code (browser-command.schema.md).
 * ──────────────────────────────────────────────────────────────────────── */

/** Closed error-code → non-zero exitCode map (browser-command.schema.md). */
export const EXIT_CODES: Record<BrowserErrorCode, number> = {
  DAEMON_NOT_RUNNING: 2,
  CHROMIUM_ABSENT: 3,
  REF_UNRESOLVED: 4,
  CDP_DISCONNECTED: 5,
  STEP_TIMEOUT: 6,
  STORY_PARSE_ERROR: 7,
  BROWSER_INJECTION_BLOCKED: 8,
};

/** Operator remediation per error code (browser-command.schema.md). */
const REMEDIATION: Record<BrowserErrorCode, string> = {
  DAEMON_NOT_RUNNING: "run 'loom-browser start' first",
  CHROMIUM_ABSENT: "Run `playwright install chromium`, then `loom-browser start`.",
  REF_UNRESOLVED:
    "Re-capture the a11y snapshot and verify role/name/index; the element may not be rendered yet.",
  CDP_DISCONNECTED:
    "The client attempts one reconnect; if it fails, run `loom-browser restart`.",
  STEP_TIMEOUT:
    "Increase timeoutMs, or assert the precondition before the step.",
  STORY_PARSE_ERROR:
    "Fix the story step against the action grammar in e2e-story.schema.md.",
  BROWSER_INJECTION_BLOCKED:
    "Review the flagged page; the navigation was refused by policy.",
};

/**
 * A typed client error carrying a closed BrowserErrorCode. Thrown by `connect`
 * and the READ dispatch; the CLI/in-process caller converts it to a
 * BrowserResult via `errorResult`.
 */
export class BrowserClientError extends Error {
  readonly code: BrowserErrorCode;
  readonly remediation: string;
  constructor(code: BrowserErrorCode, message?: string) {
    super(message ?? code);
    this.name = "BrowserClientError";
    this.code = code;
    this.remediation = REMEDIATION[code];
  }
}

/** Build a failure BrowserResult from any thrown error (mirrors error.code). */
export function errorResult(
  verb: BrowserVerb,
  tier: BrowserTier,
  err: unknown,
  startedAt?: number
): BrowserResult {
  const clientErr =
    err instanceof BrowserClientError
      ? err
      : new BrowserClientError("CDP_DISCONNECTED", (err as Error)?.message);
  const error: BrowserError = {
    code: clientErr.code,
    message: clientErr.message,
    remediation: clientErr.remediation,
  };
  return {
    ok: false,
    verb,
    tier,
    exitCode: EXIT_CODES[clientErr.code],
    data: null,
    error,
    durationMs: startedAt !== undefined ? Date.now() - startedAt : undefined,
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * Verb → tier classifier (criterion 6) — sourced from
 * skills/loom-browser/SKILL.md:46-79. The three tiers below mirror the closed
 * BrowserVerb enum in lib/types.ts, which itself mirrors that SKILL.md
 * partition. The computed-style READ verbs (css/is-visible/bounding-box) are
 * DOM-query-family reads (SKILL.md READ "DOM query") and are load-bearing for
 * the P8 visual-bug category.
 * ──────────────────────────────────────────────────────────────────────── */

const READ_VERBS: readonly BrowserVerb[] = [
  "screenshot",
  "dom-query",
  "a11y-snapshot",
  "console-log",
  "network-log",
  "get-url",
  "get-title",
  "css",
  "is-visible",
  "bounding-box",
];

const WRITE_VERBS: readonly BrowserVerb[] = [
  "click",
  "type",
  "hover",
  "navigate",
  "submit",
  "upload",
];

const META_VERBS: readonly BrowserVerb[] = [
  "start",
  "stop",
  "restart",
  "config",
  "cookie-import",
];

/**
 * Classify a verb string into its concurrency tier. Returns null when the verb
 * is not in the closed enum (caller raises STORY_PARSE_ERROR).
 */
export function classifyVerb(verb: string): BrowserTier | null {
  if ((READ_VERBS as string[]).includes(verb)) return "read";
  if ((WRITE_VERBS as string[]).includes(verb)) return "write";
  if ((META_VERBS as string[]).includes(verb)) return "meta";
  return null;
}

/* ────────────────────────────────────────────────────────────────────────
 * Session — a live attachment. connect() sets up console/network buffers so
 * that console-log / network-log READ verbs return real accumulated data for
 * long-lived in-process callers (P3 connects once, drives, then reads).
 * ──────────────────────────────────────────────────────────────────────── */

export interface ConsoleEntry {
  type: string;
  text: string;
  at: string;
}

export interface NetworkEntry {
  method: string;
  url: string;
  status: number | null;
  at: string;
}

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** Console messages captured since connect (page.on('console')). */
  console: ConsoleEntry[];
  /** Network responses captured since connect (page.on('response')). */
  network: NetworkEntry[];
  /** Close the CDP connection. Does NOT terminate Chromium (daemon owns it). */
  dispose: () => Promise<void>;
}

/**
 * Attach to an already-running Chromium over CDP. NEVER launches (C-02).
 *
 * @param cdpEndpoint the resolved webSocketDebuggerUrl (or http://host:port)
 *   — the daemon writes the real endpoint into state.toon at start time; the
 *   `.../pending` placeholder will never connect.
 * @throws BrowserClientError CDP_DISCONNECTED when the socket cannot be opened
 *   (or CHROMIUM_ABSENT when the endpoint is empty/unresolved).
 */
export async function connect(
  cdpEndpoint: string,
  connectTimeoutMs = 30000
): Promise<BrowserSession> {
  if (!cdpEndpoint || cdpEndpoint.trim() === "") {
    throw new BrowserClientError(
      "CHROMIUM_ABSENT",
      "No CDP endpoint resolved; Chromium did not expose a debugging socket."
    );
  }
  let browser: Browser;
  try {
    // Bounded connect: a stalled CDP handshake becomes a throw (→
    // CDP_DISCONNECTED), never an infinite hang.
    browser = await chromium.connectOverCDP(cdpEndpoint, {
      timeout: connectTimeoutMs,
    });
  } catch (err) {
    throw new BrowserClientError(
      "CDP_DISCONNECTED",
      `connectOverCDP failed for ${cdpEndpoint}: ${(err as Error).message}`
    );
  }

  // Reuse the existing default context/page (we ATTACHED, we did not launch).
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages()[0] ?? (await context.newPage());

  // REAL cookie injection on context creation (P1b, criterion 2): read every
  // *.toon under COOKIES_DIR and addCookies(). Best-effort — a malformed jar
  // must never abort the attach (auth is optional for anonymous drives).
  try {
    await injectCookies(context);
  } catch {
    /* cookie jar unreadable — proceed unauthenticated (best-effort). */
  }

  const consoleBuf: ConsoleEntry[] = [];
  const networkBuf: NetworkEntry[] = [];
  page.on("console", (msg) => {
    consoleBuf.push({ type: msg.type(), text: msg.text(), at: new Date().toISOString() });
  });
  page.on("response", (res) => {
    const req = res.request();
    networkBuf.push({
      method: req.method(),
      url: res.url(),
      status: res.status(),
      at: new Date().toISOString(),
    });
  });

  // Surface a mid-session CDP drop as CDP_DISCONNECTED for in-process callers.
  browser.on("disconnected", () => {
    /* buffers stop filling; the next execRead will throw on a closed page. */
  });

  return {
    browser,
    context,
    page,
    console: consoleBuf,
    network: networkBuf,
    dispose: async () => {
      try {
        await browser.close();
      } catch {
        /* connection already gone — nothing to close */
      }
    },
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * Target resolution — A11yRef (role+name+index) or raw selector → Locator.
 * On a miss: REF_UNRESOLVED (never a silent no-op) — criterion 4.
 * ──────────────────────────────────────────────────────────────────────── */

function isA11yRef(t: unknown): t is A11yRef {
  return (
    typeof t === "object" &&
    t !== null &&
    "role" in t &&
    "name" in t &&
    "index" in t
  );
}

/**
 * Resolve a command target to a single Locator, throwing REF_UNRESOLVED when
 * no matching node exists. Exported so P1b's WRITE dispatch reuses it.
 */
export async function resolveTarget(
  page: Page,
  target: A11yRef | string | null | undefined
): Promise<Locator> {
  if (target == null) {
    throw new BrowserClientError(
      "REF_UNRESOLVED",
      "Verb requires a target element but none was provided."
    );
  }
  if (typeof target === "string") {
    const loc = page.locator(target);
    if ((await loc.count()) === 0) {
      throw new BrowserClientError(
        "REF_UNRESOLVED",
        `No node matched selector ${JSON.stringify(target)} on the current page.`
      );
    }
    return loc.first();
  }
  if (isA11yRef(target)) {
    // Accessibility-tree resolution: role + accessible name, positional index.
    const base = page.getByRole(
      target.role as Parameters<Page["getByRole"]>[0],
      target.name ? { name: target.name } : undefined
    );
    const count = await base.count();
    if (target.index < 0 || target.index >= count) {
      throw new BrowserClientError(
        "REF_UNRESOLVED",
        `No accessibility node matched {role:${target.role}, name:${target.name}, index:${target.index}} on the current page.`
      );
    }
    return base.nth(target.index);
  }
  throw new BrowserClientError(
    "REF_UNRESOLVED",
    "Target was neither an A11yRef nor a selector string."
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * READ dispatch (criterion 3) — real data from a live page.
 * ──────────────────────────────────────────────────────────────────────── */

const SCREENSHOT_DIR = path.join(process.cwd(), ".loom", "browser", "screenshots");

function ok(
  verb: BrowserVerb,
  data: Record<string, unknown>,
  startedAt: number
): BrowserResult {
  return {
    ok: true,
    verb,
    tier: "read",
    exitCode: 0,
    data,
    error: null,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Execute a READ-tier command against a live session. In-process callers
 * (P2/P3) invoke this directly. Non-READ verbs are rejected here (P1b adds the
 * WRITE/META dispatchers).
 *
 * @throws never — all failures are returned as a failure BrowserResult so the
 *   caller can uniformly inspect exitCode/error.
 */
export async function execRead(
  session: BrowserSession,
  command: BrowserCommand
): Promise<BrowserResult> {
  const startedAt = Date.now();
  const { page } = session;
  const verb = command.verb;

  const tier = classifyVerb(verb);
  if (tier === null) {
    return errorResult(
      verb,
      command.tier,
      new BrowserClientError("STORY_PARSE_ERROR", `Unknown verb: ${verb}`),
      startedAt
    );
  }
  if (tier !== "read") {
    return errorResult(
      verb,
      tier,
      new BrowserClientError(
        "STORY_PARSE_ERROR",
        `Verb '${verb}' is tier '${tier}'; execRead serves READ only (WRITE/META land in P1b).`
      ),
      startedAt
    );
  }

  try {
    const timeout = command.timeoutMs ?? 30000;
    page.setDefaultTimeout(timeout);
    const readVerb = verb as BrowserReadVerb;

    switch (readVerb) {
      case "get-url":
        return ok(verb, { url: page.url() }, startedAt);

      case "get-title":
        return ok(verb, { title: await page.title() }, startedAt);

      case "a11y-snapshot": {
        // page.accessibility was removed in Playwright 1.53+; the modern
        // equivalent is Locator.ariaSnapshot() (YAML aria tree).
        const snapshot = await page.locator("body").ariaSnapshot();
        return ok(verb, { snapshot }, startedAt);
      }

      case "console-log":
        return ok(verb, { entries: session.console }, startedAt);

      case "network-log":
        return ok(verb, { entries: session.network }, startedAt);

      case "screenshot": {
        fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
        const file = path.join(SCREENSHOT_DIR, `shot-${Date.now()}.png`);
        if (command.target != null) {
          const loc = await resolveTarget(page, command.target);
          await loc.screenshot({ path: file });
        } else {
          await page.screenshot({ path: file, fullPage: true });
        }
        return ok(verb, { path: file }, startedAt);
      }

      case "dom-query": {
        const loc = await resolveTarget(page, command.target);
        const html = await loc.evaluate((el) => (el as Element).outerHTML);
        const text = await loc.textContent();
        return ok(verb, { html, text }, startedAt);
      }

      case "css": {
        const loc = await resolveTarget(page, command.target);
        const property = String(command.args?.["property"] ?? "");
        if (!property) {
          return errorResult(
            verb,
            "read",
            new BrowserClientError(
              "STORY_PARSE_ERROR",
              "css verb requires args.property (e.g. 'color')."
            ),
            startedAt
          );
        }
        const value = await loc.evaluate(
          (el, prop) =>
            window.getComputedStyle(el as Element).getPropertyValue(prop),
          property
        );
        return ok(verb, { property, value }, startedAt);
      }

      case "is-visible": {
        const loc = await resolveTarget(page, command.target);
        const visible = await loc.isVisible();
        return ok(verb, { visible }, startedAt);
      }

      case "bounding-box": {
        const loc = await resolveTarget(page, command.target);
        const box = await loc.boundingBox();
        return ok(verb, { boundingBox: box }, startedAt);
      }
    }
  } catch (err) {
    // Timeout → STEP_TIMEOUT; everything else keeps its typed code (REF_
    // UNRESOLVED from resolveTarget) or falls back to CDP_DISCONNECTED.
    if (err instanceof BrowserClientError) {
      return errorResult(verb, "read", err, startedAt);
    }
    const msg = (err as Error)?.message ?? "";
    if (/timeout/i.test(msg)) {
      return errorResult(
        verb,
        "read",
        new BrowserClientError("STEP_TIMEOUT", msg),
        startedAt
      );
    }
    return errorResult(
      verb,
      "read",
      new BrowserClientError("CDP_DISCONNECTED", msg),
      startedAt
    );
  }

  // Unreachable: readVerb switch is exhaustive over BrowserReadVerb.
  return errorResult(
    verb,
    "read",
    new BrowserClientError("STORY_PARSE_ERROR", `Unhandled READ verb: ${verb}`),
    startedAt
  );
}

/* ════════════════════════════════════════════════════════════════════════
 * WRITE / META half (PLAN-browser-e2e, P1b).
 *
 * Appended after P1a's READ half. Reuses P1a's exported primitives
 * (BrowserSession, resolveTarget, classifyVerb, BrowserClientError,
 * errorResult, EXIT_CODES) — nothing above this line is rewritten.
 *
 * Adds: `execWrite` (sequenced page mutations), `execMeta` (exclusive
 * lifecycle), the cross-process daemon lock (C-08), REAL cookie injection
 * (criterion 2), and the injection-defense stub `onPageText` (C-07 slot).
 * ════════════════════════════════════════════════════════════════════════ */

const BROWSER_DIR = path.join(process.cwd(), ".loom", "browser");
const COOKIES_DIR = path.join(BROWSER_DIR, "cookies");
/** Cross-process advisory lock guarding WRITE-sequenced / META-exclusive (C-08). */
const LOCK_FILE = path.join(BROWSER_DIR, "exec.lock");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH → dead; EPERM → alive but not ours (still alive).
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * C-08 daemon lock — a single exclusive lockfile serializes WRITE commands
 * and holds META exclusively across separate `loom-browser exec` processes.
 * READ verbs are concurrent-safe and take NO lock (browser-command.schema.md
 * tier semantics). A stale lock whose holder PID is dead is reclaimed.
 * ──────────────────────────────────────────────────────────────────────── */

/** Read the PID recorded in an existing lockfile, or null if unreadable. */
function readLockHolder(): number | null {
  try {
    const raw = fs.readFileSync(LOCK_FILE, "utf-8");
    const m = raw.match(/^pid:\s*(\d+)/m);
    return m ? parseInt(m[1], 10) : null;
  } catch {
    return null;
  }
}

/**
 * Acquire the exclusive daemon lock for a WRITE or META command. Returns a
 * release function (idempotent). Throws STEP_TIMEOUT if the lock cannot be
 * taken within `timeoutMs` (another WRITE/META holds it). READ never calls this.
 */
async function acquireLock(
  kind: Exclude<BrowserTier, "read">,
  timeoutMs = 30000
): Promise<() => void> {
  fs.mkdirSync(BROWSER_DIR, { recursive: true });
  const payload = `pid: ${process.pid}\nkind: ${kind}\nat: ${new Date().toISOString()}\n`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const fd = fs.openSync(LOCK_FILE, "wx");
      fs.writeSync(fd, payload);
      fs.closeSync(fd);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        try {
          fs.unlinkSync(LOCK_FILE);
        } catch {
          /* already released / reclaimed */
        }
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      // Lock held. Reclaim it only if the recorded holder PID is dead (stale).
      const holder = readLockHolder();
      if (holder !== null && !isPidAlive(holder)) {
        try {
          fs.unlinkSync(LOCK_FILE);
        } catch {
          /* someone else reclaimed it first — retry */
        }
        continue;
      }
      if (Date.now() >= deadline) {
        throw new BrowserClientError(
          "STEP_TIMEOUT",
          `Could not acquire the ${kind} lock within ${timeoutMs}ms; ` +
            `another WRITE/META command (pid ${holder ?? "?"}) holds it.`
        );
      }
      await sleep(40 + Math.floor(Math.random() * 40));
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * REAL cookie injection (criterion 2) — read every *.toon jar under
 * COOKIES_DIR, parse the `cookies[N]{...}` table via parseToon, unescape the
 * `%2C` comma-escape written by scripts/loom-import-cookies.ts, and
 * context.addCookies(). The daemon's `cookiesLoaded:true` was only a flag;
 * this performs the actual injection on context creation.
 * ──────────────────────────────────────────────────────────────────────── */

/** Playwright's addCookies() element type — kept in lockstep with playwright-core. */
type CookieParam = Parameters<BrowserContext["addCookies"]>[0][number];

/** Undo the naive `%2C` comma-escape from serializeCookieFile (loom-import-cookies.ts:101). */
function unescapeCookieValue(value: string): string {
  return value.replace(/%2C/g, ",");
}

/** Normalize an arbitrary cookie sameSite into Playwright's closed set. */
function normalizeSameSite(raw: ToonValue): "Strict" | "Lax" | "None" {
  const s = String(raw ?? "").toLowerCase();
  if (s === "strict") return "Strict";
  if (s === "none" || s === "no_restriction") return "None";
  return "Lax";
}

/** Convert an expiresAt (ISO string or epoch seconds/number) to Playwright epoch seconds, or undefined for a session cookie. */
function parseExpiry(raw: ToonValue): number | undefined {
  if (raw == null || raw === "" || raw === "session") return undefined;
  if (typeof raw === "number") return raw > 1e12 ? Math.floor(raw / 1000) : raw;
  const ms = Date.parse(String(raw));
  if (Number.isNaN(ms)) return undefined;
  return Math.floor(ms / 1000);
}

function isRecord(v: ToonValue): v is { [k: string]: ToonValue } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Read all cookie jars under `cookiesDir` and inject them into `context`.
 * Returns the number of cookies added. Called by connect() on context
 * creation and by execMeta's cookie-import verb.
 *
 * A jar with no top-level `domain` (needed by addCookies alongside path) or a
 * nameless row is skipped rather than throwing — one bad jar must not deny
 * every other jar's cookies.
 */
export async function injectCookies(
  context: BrowserContext,
  cookiesDir: string = COOKIES_DIR
): Promise<number> {
  if (!fs.existsSync(cookiesDir)) return 0;
  const files = fs.readdirSync(cookiesDir).filter((f) => f.endsWith(".toon"));
  const cookies: CookieParam[] = [];

  for (const file of files) {
    let parsed: ToonValue;
    try {
      parsed = parseToon(fs.readFileSync(path.join(cookiesDir, file), "utf-8"));
    } catch {
      continue; // malformed jar — skip, keep the rest
    }
    if (!isRecord(parsed)) continue;
    const domain =
      typeof parsed["domain"] === "string" ? parsed["domain"] : undefined;
    const rows = parsed["cookies"];
    if (!Array.isArray(rows) || domain === undefined) continue;

    for (const row of rows) {
      if (!isRecord(row)) continue;
      const name = String(row["name"] ?? "");
      if (!name) continue;
      const cookie: CookieParam = {
        name,
        value: unescapeCookieValue(String(row["value"] ?? "")),
        domain,
        path:
          typeof row["path"] === "string" && row["path"] ? row["path"] : "/",
        httpOnly: row["httpOnly"] === true || row["httpOnly"] === "true",
        secure: row["secure"] === true || row["secure"] === "true",
        sameSite: normalizeSameSite(row["sameSite"]),
      };
      const expires = parseExpiry(row["expiresAt"]);
      if (expires !== undefined) cookie.expires = expires;
      cookies.push(cookie);
    }
  }

  if (cookies.length === 0) return 0;
  await context.addCookies(cookies);
  return cookies.length;
}

/* ────────────────────────────────────────────────────────────────────────
 * Injection-defense STUB (C-07). The stable hook contract from
 * skills/loom-browser/SKILL.md:108-124 is `onPageText(pageText, url) =>
 * { ok, findings }`. In M-11 it is a NO-OP (ok:true). Full tainting/signature
 * detection is deferred to M-05/F-15. The contract slot exists NOW so the
 * navigate path can fail closed with BROWSER_INJECTION_BLOCKED once the real
 * hook returns ok:false.
 * ──────────────────────────────────────────────────────────────────────── */

/** One flagged span from the injection-defense hook (shape stable for M-05/F-15). */
export interface InjectionFinding {
  code: string;
  message: string;
  severity?: "critical" | "major" | "minor";
}

/** Result of the onPageText injection-defense hook. */
export interface InjectionResult {
  ok: boolean;
  findings: InjectionFinding[];
}

/** The stable injection-defense hook signature (do NOT rename — SKILL.md:119). */
export type OnPageText = (
  pageText: string,
  url: string
) => InjectionResult | Promise<InjectionResult>;

/**
 * NO-OP injection-defense hook (M-11 stub). Always passes. M-05/F-15 replaces
 * the body with the llm-trust untrusted-text tainting rules; callers inject a
 * real hook via execWrite's `hook` parameter. Do not rename (SKILL.md:119).
 */
export const onPageText: OnPageText = (_pageText: string, _url: string) => ({
  ok: true,
  findings: [],
});

/**
 * Run the injection-defense hook over freshly-navigated page text and fail
 * CLOSED. Throws BROWSER_INJECTION_BLOCKED when the hook returns ok:false.
 * Exported so the hermetic BE-10 test can drive it with a mock hook (no live
 * Chromium) and so P4/P5 can reuse the exact gate.
 */
export async function assertNoInjection(
  pageText: string,
  url: string,
  hook: OnPageText = onPageText
): Promise<void> {
  const result = await hook(pageText, url);
  if (!result.ok) {
    const detail =
      result.findings.map((f) => f.message).join("; ") || "policy violation";
    throw new BrowserClientError(
      "BROWSER_INJECTION_BLOCKED",
      `Injection defense refused navigation to ${url}: ${detail}`
    );
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * WRITE dispatch (criterion 1) — page mutations, daemon-lock sequenced.
 * ──────────────────────────────────────────────────────────────────────── */

function okWrite(
  verb: BrowserVerb,
  tier: BrowserTier,
  data: Record<string, unknown>,
  startedAt: number
): BrowserResult {
  return {
    ok: true,
    verb,
    tier,
    exitCode: 0,
    data,
    error: null,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Execute a WRITE-tier command against a live session. Acquires the C-08 lock
 * so WRITE commands are serialized across separate CLI processes, mutates the
 * page, and (on `navigate`) runs the injection-defense gate. Non-WRITE verbs
 * are rejected here. `hook` lets callers/tests inject a real injection hook.
 *
 * @throws never — all failures return a failure BrowserResult (uniform with
 *   execRead) so callers inspect exitCode/error.
 */
export async function execWrite(
  session: BrowserSession,
  command: BrowserCommand,
  hook: OnPageText = onPageText
): Promise<BrowserResult> {
  const startedAt = Date.now();
  const { page } = session;
  const verb = command.verb;

  const tier = classifyVerb(verb);
  if (tier === null) {
    return errorResult(
      verb,
      command.tier,
      new BrowserClientError("STORY_PARSE_ERROR", `Unknown verb: ${verb}`),
      startedAt
    );
  }
  if (tier !== "write") {
    return errorResult(
      verb,
      tier,
      new BrowserClientError(
        "STORY_PARSE_ERROR",
        `Verb '${verb}' is tier '${tier}'; execWrite serves WRITE only.`
      ),
      startedAt
    );
  }

  let release: (() => void) | null = null;
  try {
    const timeout = command.timeoutMs ?? 30000;
    release = await acquireLock("write", timeout);
    page.setDefaultTimeout(timeout);
    const writeVerb = verb as BrowserWriteVerb;

    switch (writeVerb) {
      case "click": {
        const loc = await resolveTarget(page, command.target);
        await loc.click();
        return okWrite(verb, "write", { clicked: true }, startedAt);
      }

      case "type": {
        const loc = await resolveTarget(page, command.target);
        const text = String(command.args?.["text"] ?? "");
        await loc.fill(text);
        return okWrite(verb, "write", { typed: text.length }, startedAt);
      }

      case "hover": {
        const loc = await resolveTarget(page, command.target);
        await loc.hover();
        return okWrite(verb, "write", { hovered: true }, startedAt);
      }

      case "navigate": {
        const url =
          typeof command.target === "string" ? command.target.trim() : "";
        if (!url) {
          return errorResult(
            verb,
            "write",
            new BrowserClientError(
              "STORY_PARSE_ERROR",
              "navigate requires a URL string target."
            ),
            startedAt
          );
        }
        await page.goto(url, { waitUntil: "load", timeout });
        // Injection-defense gate fires on EVERY navigation (criterion 4).
        const pageText = await page.evaluate(
          () => document.body?.innerText ?? ""
        );
        await assertNoInjection(pageText, page.url(), hook);
        return okWrite(verb, "write", { url: page.url() }, startedAt);
      }

      case "submit": {
        const loc = await resolveTarget(page, command.target);
        // Submit the target's owning form (requestSubmit fires validation +
        // the submit event); fall back to activating the element itself.
        await loc.evaluate((el) => {
          const node = el as HTMLElement;
          const form =
            node.closest("form") ??
            (node.tagName === "FORM" ? (node as unknown as HTMLFormElement) : null);
          if (form) form.requestSubmit();
          else node.click();
        });
        return okWrite(verb, "write", { submitted: true }, startedAt);
      }

      case "upload": {
        const loc = await resolveTarget(page, command.target);
        const filePath = command.args?.["path"];
        if (typeof filePath !== "string" || !filePath) {
          return errorResult(
            verb,
            "write",
            new BrowserClientError(
              "STORY_PARSE_ERROR",
              "upload requires args.path (a local file path)."
            ),
            startedAt
          );
        }
        await loc.setInputFiles(filePath);
        return okWrite(verb, "write", { uploaded: filePath }, startedAt);
      }
    }
  } catch (err) {
    if (err instanceof BrowserClientError) {
      return errorResult(verb, "write", err, startedAt);
    }
    const msg = (err as Error)?.message ?? "";
    if (/timeout/i.test(msg)) {
      return errorResult(
        verb,
        "write",
        new BrowserClientError("STEP_TIMEOUT", msg),
        startedAt
      );
    }
    return errorResult(
      verb,
      "write",
      new BrowserClientError("CDP_DISCONNECTED", msg),
      startedAt
    );
  } finally {
    if (release) release();
  }

  // Unreachable: writeVerb switch is exhaustive over BrowserWriteVerb.
  return errorResult(
    verb,
    "write",
    new BrowserClientError("STORY_PARSE_ERROR", `Unhandled WRITE verb: ${verb}`),
    startedAt
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * META dispatch (criterion 1) — daemon lifecycle, lock-exclusive.
 *
 * The CDP client ATTACHED to a running daemon (it never launches — C-02), so
 * the OS-process lifecycle (spawn/kill Chromium) is owned by the daemon CLI
 * subcommands (`loom-browser start|stop|restart`). execMeta covers the
 * session-scoped meta ops honestly:
 *   - cookie-import → REAL re-injection into the live context
 *   - config        → apply known session config (timeoutMs)
 *   - start         → truthful "already attached" (a live session ⇒ daemon up)
 *   - stop/restart  → detach the CDP client; direct the operator to the CLI
 *                     subcommand for the actual process lifecycle
 * Every META command holds the exclusive lock (no concurrent WRITE/META).
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Execute a META-tier command against a live session under the exclusive lock.
 * Non-META verbs are rejected. Failures return a failure BrowserResult.
 */
export async function execMeta(
  session: BrowserSession,
  command: BrowserCommand
): Promise<BrowserResult> {
  const startedAt = Date.now();
  const verb = command.verb;

  const tier = classifyVerb(verb);
  if (tier === null) {
    return errorResult(
      verb,
      command.tier,
      new BrowserClientError("STORY_PARSE_ERROR", `Unknown verb: ${verb}`),
      startedAt
    );
  }
  if (tier !== "meta") {
    return errorResult(
      verb,
      tier,
      new BrowserClientError(
        "STORY_PARSE_ERROR",
        `Verb '${verb}' is tier '${tier}'; execMeta serves META only.`
      ),
      startedAt
    );
  }

  let release: (() => void) | null = null;
  try {
    release = await acquireLock("meta", command.timeoutMs ?? 30000);
    const metaVerb = verb as BrowserMetaVerb;

    switch (metaVerb) {
      case "cookie-import": {
        const injected = await injectCookies(session.context);
        return okWrite(verb, "meta", { injected }, startedAt);
      }

      case "config": {
        const applied: Record<string, unknown> = {};
        const timeoutMs = command.args?.["timeoutMs"];
        if (typeof timeoutMs === "number") {
          session.page.setDefaultTimeout(timeoutMs);
          applied["timeoutMs"] = timeoutMs;
        }
        return okWrite(verb, "meta", { applied }, startedAt);
      }

      case "start":
        // A live session proves the daemon is already up — no work, no lie.
        return okWrite(
          verb,
          "meta",
          {
            status: "running",
            note: "daemon already attached; use 'loom-browser start' to launch a stopped daemon.",
          },
          startedAt
        );

      case "stop":
      case "restart": {
        // Detach this CDP client. The daemon PROCESS lifecycle is owned by the
        // CLI — surface that rather than silently pretending to kill Chromium.
        await session.dispose();
        return okWrite(
          verb,
          "meta",
          {
            detached: true,
            note: `CDP client detached; run 'loom-browser ${metaVerb}' to ${metaVerb} the daemon process.`,
          },
          startedAt
        );
      }
    }
  } catch (err) {
    if (err instanceof BrowserClientError) {
      return errorResult(verb, "meta", err, startedAt);
    }
    return errorResult(
      verb,
      "meta",
      new BrowserClientError("CDP_DISCONNECTED", (err as Error)?.message),
      startedAt
    );
  } finally {
    if (release) release();
  }

  // Unreachable: metaVerb switch is exhaustive over BrowserMetaVerb.
  return errorResult(
    verb,
    "meta",
    new BrowserClientError("STORY_PARSE_ERROR", `Unhandled META verb: ${verb}`),
    startedAt
  );
}
