#!/usr/bin/env bunx tsx
/**
 * loom-browser daemon (M-11 F-33)
 *
 * Persistent Chromium daemon at .loom/browser/. Best-effort: if puppeteer-core
 * or playwright is not installed, falls back to STUB mode that logs commands
 * to .loom/browser/queue.toon for the operator to run manually.
 *
 * Subcommands: start | stop | status | exec <cmd>
 *
 * State: .loom/browser/state.toon per protocols/browser-state.schema.toon
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawn } from "node:child_process";
import { atomicWrite, isMain } from "../lib/index.js";

const BROWSER_DIR = path.join(process.cwd(), ".loom", "browser");
const STATE_FILE = path.join(BROWSER_DIR, "state.toon");
const PID_FILE = path.join(BROWSER_DIR, "daemon.pid");
const QUEUE_FILE = path.join(BROWSER_DIR, "queue.toon");
const COOKIES_DIR = path.join(BROWSER_DIR, "cookies");
const DEFAULT_CDP_PORT = 9222;

// ---------- utils ----------

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function nowISO(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve the REAL CDP WebSocket endpoint of the freshly-spawned Chromium by
 * polling its DevTools HTTP endpoint (`/json/version` → webSocketDebuggerUrl).
 *
 * The `ws://.../devtools/browser/pending` placeholder written at spawn time
 * never connects; this resolves the concrete `.../devtools/browser/<id>` URL
 * that `chromium.connectOverCDP()` needs. Returns null if Chromium never
 * exposes the socket within the deadline (treated as a Chromium-absent path).
 */
async function resolveCdpEndpoint(
  port: number,
  timeoutMs = 8000,
  intervalMs = 150
): Promise<string | null> {
  const url = `http://127.0.0.1:${port}/json/version`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const body = (await res.json()) as { webSocketDebuggerUrl?: string };
        if (body.webSocketDebuggerUrl) return body.webSocketDebuggerUrl;
      }
    } catch {
      // Chromium not listening yet — keep polling until the deadline.
    }
    await sleep(intervalMs);
  }
  return null;
}

function detectChromiumBinary(): string | null {
  const candidates: string[] = [];
  const platform = os.platform();
  if (platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    );
  } else if (platform === "linux") {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/brave-browser"
    );
  } else if (platform === "win32") {
    const pf = process.env["PROGRAMFILES"] ?? "C:\\Program Files";
    const pfx86 = process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)";
    candidates.push(
      path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(pfx86, "Google", "Chrome", "Application", "chrome.exe")
    );
  }
  if (process.env["CHROME_PATH"]) candidates.unshift(process.env["CHROME_PATH"]);
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {
      // ignore
    }
  }
  return null;
}

function readStateFile(): Record<string, string | number | boolean> | null {
  if (!fs.existsSync(STATE_FILE)) return null;
  const raw = fs.readFileSync(STATE_FILE, "utf-8");
  const out: Record<string, string | number | boolean> = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([a-zA-Z][a-zA-Z0-9]*):\s*(.*)$/);
    if (!m) continue;
    const [, key, val] = m;
    if (val === "true") out[key] = true;
    else if (val === "false") out[key] = false;
    else if (/^-?\d+$/.test(val)) out[key] = parseInt(val, 10);
    else out[key] = val;
  }
  return out;
}

function writeState(state: {
  daemonPid: number;
  daemonPort: number;
  startedAt: string;
  chromiumBinaryPath: string;
  cdpEndpoint: string;
  cookiesLoaded: boolean;
  injectionDefenseEnabled: boolean;
}) {
  const toon = [
    "schemaVersion: 1",
    `daemonPid: ${state.daemonPid}`,
    `daemonPort: ${state.daemonPort}`,
    `startedAt: ${state.startedAt}`,
    `chromiumBinaryPath: ${state.chromiumBinaryPath}`,
    `cdpEndpoint: ${state.cdpEndpoint}`,
    "activeTabs[0]{tabId,url,title}:",
    `cookiesLoaded: ${state.cookiesLoaded}`,
    `injectionDefenseEnabled: ${state.injectionDefenseEnabled}`,
    "",
  ].join("\n");
  atomicWrite(STATE_FILE, toon);
}

function isPidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function appendQueue(cmd: string) {
  ensureDir(BROWSER_DIR);
  const line = `- ${nowISO()} ${cmd}\n`;
  fs.appendFileSync(QUEUE_FILE, line);
}

function countCookieFiles(): number {
  if (!fs.existsSync(COOKIES_DIR)) return 0;
  return fs
    .readdirSync(COOKIES_DIR)
    .filter((f) => f.endsWith(".toon")).length;
}

// ---------- subcommands ----------

function statusCmd(): number {
  const state = readStateFile();
  if (!state) {
    console.log("phase: stopped");
    return 0;
  }
  const pid = typeof state["daemonPid"] === "number" ? state["daemonPid"] : 0;
  if (pid > 0 && !isPidAlive(pid)) {
    console.log("phase: crashed");
    console.log(`daemonPid: ${pid}`);
    return 0;
  }
  console.log(`phase: ${pid > 0 ? "running" : "stopped"}`);
  for (const [k, v] of Object.entries(state)) {
    console.log(`${k}: ${v}`);
  }
  return 0;
}

async function startCmd(): Promise<number> {
  const existing = readStateFile();
  if (existing && typeof existing["daemonPid"] === "number") {
    const pid = existing["daemonPid"];
    if (pid > 0 && isPidAlive(pid)) {
      console.error("BROWSER_ALREADY_RUNNING");
      console.error(`daemonPid: ${pid}`);
      return 1;
    }
  }

  ensureDir(BROWSER_DIR);
  const binary = detectChromiumBinary();
  const cookiesLoaded = countCookieFiles() > 0;

  if (!binary) {
    console.error("BROWSER_NO_BINARY — falling back to stub mode");
    writeState({
      daemonPid: 0,
      daemonPort: 0,
      startedAt: nowISO(),
      chromiumBinaryPath: "",
      cdpEndpoint: "",
      cookiesLoaded,
      injectionDefenseEnabled: true,
    });
    appendQueue("start (stub mode — no Chromium binary)");
    console.log("phase: stub");
    return 0;
  }

  // Try to spawn Chromium in headless mode with CDP enabled.
  // Best-effort: if spawn fails (missing perms, sandbox issue), degrade to stub.
  const port = DEFAULT_CDP_PORT;
  const userDataDir = path.join(BROWSER_DIR, "profile");
  ensureDir(userDataDir);
  try {
    const child = spawn(
      binary,
      [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${userDataDir}`,
        "--headless=new",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-features=Translate",
      ],
      { detached: true, stdio: "ignore" }
    );
    child.unref();
    const pid = child.pid ?? 0;
    if (pid > 0) {
      fs.writeFileSync(PID_FILE, String(pid));
    }
    // Resolve the REAL cdpEndpoint BEFORE any exec proceeds: poll DevTools
    // /json/version for webSocketDebuggerUrl and persist it over the
    // ws://.../pending placeholder (which never connects).
    const resolved = await resolveCdpEndpoint(port);
    writeState({
      daemonPid: pid,
      daemonPort: port,
      startedAt: nowISO(),
      chromiumBinaryPath: binary,
      cdpEndpoint: resolved ?? "",
      cookiesLoaded,
      injectionDefenseEnabled: true,
    });
    console.log(`phase: running`);
    console.log(`daemonPid: ${pid}`);
    console.log(`daemonPort: ${port}`);
    if (resolved) {
      console.log(`cdpEndpoint: ${resolved}`);
    } else {
      console.error(
        "CHROMIUM_ABSENT — Chromium did not expose a CDP socket on " +
          `127.0.0.1:${port}. Run 'playwright install chromium', then restart.`
      );
    }
    return 0;
  } catch (err) {
    console.error(`BROWSER_SPAWN_FAILED: ${(err as Error).message}`);
    writeState({
      daemonPid: 0,
      daemonPort: 0,
      startedAt: nowISO(),
      chromiumBinaryPath: binary,
      cdpEndpoint: "",
      cookiesLoaded,
      injectionDefenseEnabled: true,
    });
    appendQueue("start (stub mode — spawn failed)");
    return 0;
  }
}

function stopCmd(): number {
  const state = readStateFile();
  if (!state) {
    console.log("phase: stopped (no state file)");
    return 0;
  }
  const pid = typeof state["daemonPid"] === "number" ? state["daemonPid"] : 0;
  if (pid > 0 && isPidAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // ignore
    }
  }
  writeState({
    daemonPid: 0,
    daemonPort: 0,
    startedAt: (state["startedAt"] as string) ?? "",
    chromiumBinaryPath: (state["chromiumBinaryPath"] as string) ?? "",
    cdpEndpoint: "",
    cookiesLoaded: false,
    injectionDefenseEnabled: true,
  });
  if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
  console.log("phase: stopped");
  return 0;
}

/**
 * Parse `exec` CLI argv into a BrowserCommand. `target` is JSON-parsed as an
 * A11yRef when it is a JSON object, else treated as a raw selector string.
 * Throws STORY_PARSE_ERROR for unknown verbs / malformed a11y-ref JSON.
 */
async function parseExecArgs(args: string[]): Promise<import("../lib/index.js").BrowserCommand> {
  const { classifyVerb, BrowserClientError } = await import("./lib/browser-client.js");
  const verb = args[0];
  const tier = classifyVerb(verb);
  if (tier === null) {
    throw new BrowserClientError("STORY_PARSE_ERROR", `Unknown verb: ${verb}`);
  }

  // Verb-specific positional parsing (READ tier — P1a).
  let target: import("../lib/index.js").A11yRef | string | null = null;
  const cmdArgs: Record<string, unknown> = {};
  const rawTarget = args[1];
  if (rawTarget !== undefined) {
    const trimmed = rawTarget.trim();
    if (trimmed.startsWith("{")) {
      try {
        target = JSON.parse(trimmed) as import("../lib/index.js").A11yRef;
      } catch {
        throw new BrowserClientError(
          "STORY_PARSE_ERROR",
          `Malformed a11y-ref JSON: ${rawTarget}`
        );
      }
    } else {
      target = rawTarget;
    }
  }
  if (verb === "css" && args[2] !== undefined) {
    cmdArgs["property"] = args[2];
  }

  return {
    verb: verb as import("../lib/index.js").BrowserVerb,
    tier: tier as import("../lib/index.js").BrowserTier,
    target,
    args: cmdArgs,
  };
}

/** Print a BrowserResult as an operator-facing TOON block. */
function printResult(result: import("../lib/index.js").BrowserResult): void {
  console.log("result:");
  console.log(`  ok: ${result.ok}`);
  console.log(`  verb: ${result.verb}`);
  console.log(`  tier: ${result.tier}`);
  console.log(`  exitCode: ${result.exitCode}`);
  if (result.ok && result.data) {
    console.log(`  data: ${JSON.stringify(result.data)}`);
  }
  if (!result.ok && result.error) {
    console.log("  error:");
    console.log(`    code: ${result.error.code}`);
    console.log(`    message: ${result.error.message}`);
    console.log(`    remediation: ${result.error.remediation}`);
    console.error(result.error.remediation);
  }
  if (result.durationMs !== undefined) {
    console.log(`  durationMs: ${result.durationMs}`);
  }
}

async function execCmd(args: string[]): Promise<number> {
  if (args.length === 0) {
    console.error("USAGE: loom-browser exec <verb> [target] [args...]");
    return 2;
  }

  // --- Daemon preflight (daemon-preflight.schema.md, C-07) --------------
  // Daemon-down is a HARD non-zero failure — NEVER silent-skip / queue-return-0.
  const state = readStateFile();
  const running =
    state !== null &&
    typeof state["daemonPid"] === "number" &&
    state["daemonPid"] > 0 &&
    isPidAlive(state["daemonPid"]);
  if (!running) {
    console.error(
      "DAEMON_NOT_RUNNING: The loom-browser daemon is not running; no Chromium to attach to."
    );
    console.error("run 'loom-browser start' first");
    return 2; // DAEMON_NOT_RUNNING exitCode
  }

  const { connect, execRead, errorResult, EXIT_CODES } = await import(
    "./lib/browser-client.js"
  );

  // --- Parse the command ------------------------------------------------
  let command: import("../lib/index.js").BrowserCommand;
  try {
    command = await parseExecArgs(args);
  } catch (err) {
    const result = errorResult(
      (args[0] ?? "unknown") as import("../lib/index.js").BrowserVerb,
      "read",
      err
    );
    printResult(result);
    return result.exitCode;
  }

  // P1a serves the READ tier only; WRITE/META dispatch lands in P1b.
  if (command.tier !== "read") {
    console.error(
      `NOT_IMPLEMENTED: verb '${command.verb}' is tier '${command.tier}'; ` +
        "only the READ tier is wired in P1a (WRITE/META land in P1b)."
    );
    return 1;
  }

  const cdpEndpoint =
    typeof state["cdpEndpoint"] === "string" ? state["cdpEndpoint"] : "";

  // --- Attach + dispatch ------------------------------------------------
  let session: Awaited<ReturnType<typeof connect>> | null = null;
  try {
    session = await connect(cdpEndpoint);
    const result = await execRead(session, command);
    printResult(result);
    return result.exitCode;
  } catch (err) {
    const result = errorResult(command.verb, command.tier, err);
    printResult(result);
    return result.exitCode || EXIT_CODES.CDP_DISCONNECTED;
  } finally {
    if (session) await session.dispose();
  }
}

// ---------- entry ----------

async function main(argv: string[]): Promise<number> {
  const sub = argv[2];
  const rest = argv.slice(3);
  switch (sub) {
    case "start":
      return startCmd();
    case "stop":
      return stopCmd();
    case "status":
      return statusCmd();
    case "exec":
      return execCmd(rest);
    default:
      console.error("USAGE: loom-browser <start|stop|status|exec>");
      return 2;
  }
}

// Guard the entry call so importing this module (e.g. from a backfill test)
// runs no side effects — only invoke main() when this file is the process
// entry point. isMain works under bun, plain node, and node+tsx.
if (isMain(import.meta)) {
  main(process.argv).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    }
  );
}
