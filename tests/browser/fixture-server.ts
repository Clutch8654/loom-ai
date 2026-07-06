/**
 * tests/browser/fixture-server.ts
 *
 * A tiny, self-contained local HTTP fixture server for the browser-e2e suite
 * (PLAN-browser-e2e, P2). Mirrors the gstack `browse/test/test-server.ts` style:
 * boots on a RANDOM port, serves a couple of local HTML fixtures, and hands back
 * a `stop()` for deterministic teardown.
 *
 * Runtime portability (load-bearing): the plan calls for `Bun.serve`, but the
 * root vitest suite runs under a NODE worker (`bunx vitest` → node child
 * processes), where the `Bun` global is undefined. So this prefers `Bun.serve`
 * when the runtime actually exposes it and otherwise falls back to node's
 * `http.createServer` — identical routes either way. That keeps the module
 * usable both under `bun test` and under `bunx vitest`, which matters because
 * P5 (feedback-loop Rung-4) and P9a (loom-qa outcome eval) REUSE this exact
 * server via `startFixtureServer()`.
 *
 * Import surface for reuse:
 *   import { startFixtureServer, type FixtureServer } from "../browser/fixture-server.js";
 *   const server = await startFixtureServer();
 *   // ... drive server.url ("http://127.0.0.1:<port>") ...
 *   await server.stop();
 *
 * Routes:
 *   GET /            → fixtures/index.html (h1#hero, a search form)
 *   GET /index.html  → same
 *   GET /echo?q=...  → fixtures/echo.html with {{q}} substituted (HTML-escaped)
 *   GET /<file>      → static passthrough for any other fixtures/*.html
 *   *                → 404
 */

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

/** A booted fixture server with its resolved URL and a teardown hook. */
export interface FixtureServer {
  /** Base URL, e.g. `http://127.0.0.1:54923` (no trailing slash). */
  readonly url: string;
  /** The OS-assigned random port. */
  readonly port: number;
  /** Stop the server and release the port. Idempotent, always resolves. */
  stop(): Promise<void>;
}

function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), "utf-8");
}

/** Minimal HTML-escape so a reflected query param can never inject markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface Rendered {
  status: number;
  body: string;
  type: string;
}

const HTML = "text/html; charset=utf-8";

/**
 * Pure request router — maps (pathname, query) to a response. Shared verbatim by
 * both the Bun and node servers so their behavior can never drift.
 */
function render(pathname: string, query: URLSearchParams): Rendered {
  if (pathname === "/" || pathname === "/index.html") {
    return { status: 200, body: readFixture("index.html"), type: HTML };
  }
  if (pathname === "/echo") {
    const q = query.get("q") ?? "";
    const body = readFixture("echo.html").replace(/\{\{q\}\}/g, escapeHtml(q));
    return { status: 200, body, type: HTML };
  }
  // Static passthrough for any other fixture file (defends against traversal).
  const rel = pathname.replace(/^\/+/, "");
  if (rel && !rel.includes("..")) {
    const file = path.join(FIXTURES_DIR, rel);
    if (
      file.startsWith(FIXTURES_DIR) &&
      fs.existsSync(file) &&
      fs.statSync(file).isFile()
    ) {
      return { status: 200, body: fs.readFileSync(file, "utf-8"), type: HTML };
    }
  }
  return {
    status: 404,
    body: "<!doctype html><title>Not found</title>not found",
    type: HTML,
  };
}

/** Bun runtime shim — undefined under a node vitest worker. */
interface BunLike {
  serve(options: {
    port: number;
    hostname?: string;
    fetch(req: Request): Response | Promise<Response>;
  }): { port: number; stop(closeActive?: boolean): void };
}

/**
 * Boot the fixture server on a random port. Prefers `Bun.serve`, falls back to
 * node `http`. Returns once the socket is actually listening.
 */
export async function startFixtureServer(): Promise<FixtureServer> {
  const bun = (globalThis as { Bun?: BunLike }).Bun;

  if (bun && typeof bun.serve === "function") {
    const server = bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req: Request): Response {
        const u = new URL(req.url);
        const r = render(u.pathname, u.searchParams);
        return new Response(r.body, {
          status: r.status,
          headers: { "content-type": r.type },
        });
      },
    });
    const port = server.port;
    let stopped = false;
    return {
      url: `http://127.0.0.1:${port}`,
      port,
      stop: async () => {
        if (stopped) return;
        stopped = true;
        server.stop(true);
      },
    };
  }

  // Node fallback.
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://127.0.0.1");
    const r = render(u.pathname, u.searchParams);
    res.writeHead(r.status, { "content-type": r.type });
    res.end(r.body);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  let stopped = false;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    stop: () =>
      new Promise<void>((resolve) => {
        if (stopped) return resolve();
        stopped = true;
        server.close(() => resolve());
      }),
  };
}
