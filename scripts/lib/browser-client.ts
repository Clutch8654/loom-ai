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
  BrowserReadVerb,
  BrowserResult,
  BrowserTier,
  BrowserVerb,
} from "../../lib/types.js";

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
