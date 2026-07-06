/**
 * tests/helpers/backfill-template.ts
 *
 * Shared behavioral-test scaffold for the backfill suites (PLAN-exceed-gstack
 * Phase 14b + Phase 19, F-11, defect 6). Authored ONCE here so the sandbox
 * and observable-output machinery is never re-derived per test file.
 *
 * Not a test file (no `.test.` in the name) so vitest does not collect it.
 *
 * Two capability groups:
 *
 *   1. Sandbox  — a throwaway temp tree with an isolated HOME and cwd, so a
 *      unit under test that writes to `~/.loom/...` (os.homedir → $HOME on
 *      posix) or `process.cwd()/.loom/...` lands entirely inside the sandbox
 *      and never touches the developer's real home or repo. Env and cwd are
 *      overridden on enter and restored on cleanup.
 *
 *   2. captureRun — runs a unit of logic and returns its REAL observable
 *      output: the value it returned, anything it wrote to stdout/stderr
 *      (console.log/error included — those route through the intercepted
 *      streams), the code it passed to process.exit(), and any error it
 *      threw. Tests assert on that outcome — never by grepping source text.
 *
 * Design contract for downstream phases: the exported API below is STABLE.
 * Phase 14b and Phase 19 import these helpers directly; extend, don't break.
 */

import { expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Sandbox — isolated temp tree with overridden HOME + cwd.
// ---------------------------------------------------------------------------

export interface SandboxOptions {
  /** Temp-dir name prefix (default "loom-backfill-"). */
  prefix?: string;
  /**
   * Environment overrides applied on top of the isolated HOME. Set a key to
   * `undefined` to delete it for the sandbox's lifetime. Restored on cleanup.
   */
  env?: Record<string, string | undefined>;
  /**
   * When true, `process.chdir` into the sandbox's cwd so units that read
   * `process.cwd()` are sandboxed too (default true). The original cwd is
   * restored on cleanup.
   */
  chdir?: boolean;
}

export interface Sandbox {
  /** Absolute path to the sandbox root temp directory. */
  readonly root: string;
  /** Sandbox HOME (root/home); exported as $HOME for the sandbox's lifetime. */
  readonly home: string;
  /** Sandbox working directory (root/cwd); the process cwd when `chdir`. */
  readonly cwd: string;
  /** Absolute path built from sandbox-root-relative segments. */
  path(...segments: string[]): string;
  /** Absolute path built from HOME-relative segments (e.g. ".loom/x.toon"). */
  homePath(...segments: string[]): string;
  /** True if the sandbox-root-relative path exists. */
  exists(rel: string): boolean;
  /** Read a sandbox-root-relative file as UTF-8; null when it does not exist. */
  read(rel: string): string | null;
  /** Write a sandbox-root-relative file, creating parent directories. */
  write(rel: string, contents: string): void;
  /** Every regular file under the sandbox root, as root-relative paths. */
  files(): string[];
  /** Restore overridden env + cwd and remove the sandbox tree. Idempotent. */
  cleanup(): void;
}

/**
 * Create an isolated sandbox. Remember to call `cleanup()` (an `afterEach`, or
 * prefer `withSandbox` which cleans up even when the body throws).
 */
export function createSandbox(options: SandboxOptions = {}): Sandbox {
  const { prefix = "loom-backfill-", env = {}, chdir = true } = options;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const home = path.join(root, "home");
  const cwd = path.join(root, "cwd");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });

  // Snapshot then override env. HOME (and USERPROFILE for win32 parity) point
  // at the sandbox so os.homedir()-based writes are contained.
  const envOverrides: Record<string, string | undefined> = {
    HOME: home,
    USERPROFILE: home,
    ...env,
  };
  const savedEnv = new Map<string, string | undefined>();
  for (const key of Object.keys(envOverrides)) {
    savedEnv.set(key, process.env[key]);
    const value = envOverrides[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  const savedCwd = chdir ? process.cwd() : null;
  if (chdir) process.chdir(cwd);

  let cleaned = false;
  const resolveRoot = (rel: string): string => path.resolve(root, rel);

  return {
    root,
    home,
    cwd,
    path: (...segments) => path.join(root, ...segments),
    homePath: (...segments) => path.join(home, ...segments),
    exists: (rel) => fs.existsSync(resolveRoot(rel)),
    read: (rel) => {
      const target = resolveRoot(rel);
      return fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
    },
    write: (rel, contents) => {
      const target = resolveRoot(rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, contents);
    },
    files: () => listFilesUnder(root, root),
    cleanup: () => {
      if (cleaned) return;
      cleaned = true;
      // Restore cwd BEFORE removing the tree — rm of the current dir is UB.
      if (savedCwd !== null) {
        try {
          process.chdir(savedCwd);
        } catch {
          // savedCwd itself is gone — nothing we can do; fall through to rm.
        }
      }
      for (const [key, value] of savedEnv) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * Run `body` with a fresh sandbox and guarantee cleanup, even if it throws or
 * rejects. Returns whatever `body` returns.
 */
export async function withSandbox<T>(
  body: (sandbox: Sandbox) => T | Promise<T>,
  options?: SandboxOptions,
): Promise<T> {
  const sandbox = createSandbox(options);
  try {
    return await body(sandbox);
  } finally {
    sandbox.cleanup();
  }
}

function listFilesUnder(dir: string, base: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesUnder(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full));
  }
  return out;
}

// ---------------------------------------------------------------------------
// captureRun — run a unit and capture its real observable output.
// ---------------------------------------------------------------------------

/** Sentinel thrown to unwind the stack when the unit calls process.exit(). */
class ProcessExitSignal extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
    this.name = "ProcessExitSignal";
  }
}

export interface RunOutcome<T> {
  /** The value the unit returned; undefined if it threw or called exit(). */
  returned: T | undefined;
  /** The error the unit threw (excluding an intercepted exit); else null. */
  threw: unknown;
  /** The code passed to process.exit() during the run; null if never called. */
  exitCode: number | null;
  /** Everything written to process.stdout (console.log included). */
  stdout: string;
  /** Everything written to process.stderr (console.error included). */
  stderr: string;
}

/**
 * Execute `unit`, intercepting stdout/stderr writes and process.exit, and
 * return the observable outcome. Streams and process.exit are always restored,
 * even when `unit` throws. A thrown error (other than an intercepted exit) is
 * captured in `threw` rather than propagated, so a single call surfaces every
 * observable of the run for the test to assert on.
 */
export async function captureRun<T>(
  unit: () => T | Promise<T>,
): Promise<RunOutcome<T>> {
  const chunks: { out: string[]; err: string[] } = { out: [], err: [] };
  const realStdoutWrite = process.stdout.write.bind(process.stdout);
  const realStderrWrite = process.stderr.write.bind(process.stderr);
  const realExit = process.exit;

  // Collect stream writes; swallow the terminal output but honor the callback
  // so writers relying on the write contract do not hang.
  const sink =
    (bucket: string[]) =>
    (chunk: unknown, encoding?: unknown, cb?: unknown): boolean => {
      bucket.push(typeof chunk === "string" ? chunk : String(chunk));
      const done = typeof encoding === "function" ? encoding : cb;
      if (typeof done === "function") (done as () => void)();
      return true;
    };
  (process.stdout.write as unknown) = sink(chunks.out);
  (process.stderr.write as unknown) = sink(chunks.err);

  let exitCode: number | null = null;
  (process.exit as unknown) = (code?: number): never => {
    exitCode = code ?? 0;
    throw new ProcessExitSignal(exitCode);
  };

  let returned: T | undefined;
  let threw: unknown = null;
  try {
    returned = await unit();
  } catch (err) {
    if (err instanceof ProcessExitSignal) {
      // Already recorded in exitCode — an intercepted exit, not a real throw.
    } else {
      threw = err;
    }
  } finally {
    (process.stdout.write as unknown) = realStdoutWrite;
    (process.stderr.write as unknown) = realStderrWrite;
    (process.exit as unknown) = realExit;
  }

  return {
    returned,
    threw,
    exitCode,
    stdout: chunks.out.join(""),
    stderr: chunks.err.join(""),
  };
}

// ---------------------------------------------------------------------------
// assertOutcome — the input→observable-output assertion skeleton.
// ---------------------------------------------------------------------------

/** A substring or pattern matcher applied to captured stream text. */
type TextMatcher = string | RegExp;

export interface OutcomeExpectations<T> {
  /** Deep-equal the returned value. */
  returns?: T;
  /** Exact process.exit code (use `null` to assert exit() was NOT called). */
  exitCode?: number | null;
  /** Substring(s)/pattern(s) that MUST appear in stdout. */
  stdoutIncludes?: TextMatcher | TextMatcher[];
  /** Substring(s)/pattern(s) that MUST appear in stderr. */
  stderrIncludes?: TextMatcher | TextMatcher[];
  /** When true assert the unit threw; when false assert it did not. */
  threw?: boolean;
  /**
   * Sandbox-root-relative files the unit must have written. A string/RegExp
   * asserts on the file's contents; a function receives the contents to run
   * its own assertions. Requires passing the sandbox to assertOutcome.
   */
  files?: Record<string, TextMatcher | ((contents: string) => void)>;
}

/**
 * Assert a captured `outcome` against `expected` using vitest matchers. Pass
 * the `sandbox` when asserting on `files`. Only the fields present in
 * `expected` are checked — omitted observables are ignored.
 */
export function assertOutcome<T>(
  outcome: RunOutcome<T>,
  expected: OutcomeExpectations<T>,
  sandbox?: Sandbox,
): void {
  if ("returns" in expected) {
    expect(outcome.returned).toEqual(expected.returns);
  }
  if ("exitCode" in expected) {
    expect(outcome.exitCode).toBe(expected.exitCode ?? null);
  }
  if (expected.threw !== undefined) {
    if (expected.threw) expect(outcome.threw).not.toBeNull();
    else expect(outcome.threw).toBeNull();
  }
  for (const matcher of toMatcherList(expected.stdoutIncludes)) {
    assertText(outcome.stdout, matcher);
  }
  for (const matcher of toMatcherList(expected.stderrIncludes)) {
    assertText(outcome.stderr, matcher);
  }
  if (expected.files) {
    if (!sandbox) {
      throw new Error(
        "assertOutcome: `files` expectations require a sandbox argument.",
      );
    }
    for (const [rel, check] of Object.entries(expected.files)) {
      const contents = sandbox.read(rel);
      expect(contents, `expected file ${rel} to have been written`).not.toBeNull();
      if (typeof check === "function") check(contents as string);
      else assertText(contents as string, check);
    }
  }
}

function toMatcherList(value?: TextMatcher | TextMatcher[]): TextMatcher[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function assertText(actual: string, matcher: TextMatcher): void {
  if (matcher instanceof RegExp) expect(actual).toMatch(matcher);
  else expect(actual).toContain(matcher);
}

/**
 * Convenience: `captureRun` then `assertOutcome` in one call. Returns the
 * outcome for any further assertions the test wants to layer on.
 */
export async function runAndAssert<T>(
  unit: () => T | Promise<T>,
  expected: OutcomeExpectations<T>,
  sandbox?: Sandbox,
): Promise<RunOutcome<T>> {
  const outcome = await captureRun(unit);
  assertOutcome(outcome, expected, sandbox);
  return outcome;
}
