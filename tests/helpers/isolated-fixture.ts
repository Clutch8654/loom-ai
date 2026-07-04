/**
 * tests/helpers/isolated-fixture.ts
 *
 * Per-test filesystem/HOME/cwd isolation for the root vitest suite
 * (PLAN-exceed-gstack Phase 19, F-14, defect 15). Authored so that specs which
 * previously leaned on a *shared* mutable fixture directory can instead take a
 * fresh, auto-cleaned temp tree per test — the precondition for retiring the
 * `fileParallelism: false` workaround in vitest.config.ts.
 *
 * Relationship to tests/helpers/backfill-template.ts:
 *   - `backfill-template.ts` owns the SANDBOX + captureRun/assertOutcome machinery
 *     used by the backfill behavioral suites, with MANUAL cleanup (`withSandbox`
 *     or an explicit `afterEach`).
 *   - This module is the lighter, lifecycle-integrated complement: it binds
 *     cleanup to vitest's per-test context (`onTestFinished`), so a spec gets a
 *     unique HOME + cwd + temp root for the duration of ONE test and never has to
 *     remember to tear it down — even when the test throws. Reuses the same
 *     env/cwd snapshot-restore discipline so nothing leaks across the file
 *     boundary once files run in parallel.
 *
 * Why per-test (not per-file): under `fileParallelism`, vitest still runs the
 * tests WITHIN a file back-to-back in one worker, but a shared beforeAll fixture
 * dir means test N sees test N-1's residue. Fresh-per-test removes that ordering
 * coupling, which is the class of flake that only surfaces once files no longer
 * run one-at-a-time.
 *
 * Not a test file (no `.test.` in the name) so vitest does not collect it.
 */

import { onTestFinished } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface IsolatedFixtureOptions {
  /** Temp-dir name prefix (default "loom-isolated-"). */
  prefix?: string;
  /**
   * Environment overrides applied on top of the isolated HOME. Set a key to
   * `undefined` to delete it for the fixture's lifetime. Restored on cleanup.
   */
  env?: Record<string, string | undefined>;
  /**
   * When true (default), `process.chdir` into the fixture's cwd so units that
   * read `process.cwd()` are isolated too. Restored on cleanup. Because
   * `process.chdir` mutates process-global state, only ONE chdir fixture may be
   * active per worker at a time; this is safe under vitest because tests within
   * a file run sequentially, but do NOT hold a chdir fixture across an `await`
   * that yields to a sibling test.
   */
  chdir?: boolean;
  /**
   * Register cleanup with vitest's `onTestFinished` (default true). Set false to
   * manage the lifetime yourself via the returned `cleanup()` (e.g. inside a
   * `beforeAll`/`afterAll` pair). When false you MUST call `cleanup()`.
   */
  autoCleanup?: boolean;
}

export interface IsolatedFixture {
  /** Absolute path to the fixture root temp directory. */
  readonly root: string;
  /** Isolated HOME (root/home); exported as $HOME for the fixture's lifetime. */
  readonly home: string;
  /** Isolated working directory (root/cwd); the process cwd when `chdir`. */
  readonly cwd: string;
  /** Absolute path built from fixture-root-relative segments. */
  path(...segments: string[]): string;
  /** Absolute path built from HOME-relative segments (e.g. ".loom/x.toon"). */
  homePath(...segments: string[]): string;
  /** True if the fixture-root-relative path exists. */
  exists(rel: string): boolean;
  /** Read a fixture-root-relative file as UTF-8; null when it does not exist. */
  read(rel: string): string | null;
  /** Write a fixture-root-relative file, creating parent directories. */
  write(rel: string, contents: string): void;
  /** Make a fixture-root-relative directory (recursive). Returns its abs path. */
  mkdir(rel: string): string;
  /** Restore overridden env + cwd and remove the fixture tree. Idempotent. */
  cleanup(): void;
}

/**
 * Create a fresh isolated fixture for the CURRENT test. By default cleanup runs
 * automatically when the test finishes (pass or throw) via `onTestFinished`.
 *
 * Usage:
 *   it("writes to ~/.loom", () => {
 *     const fx = createIsolatedFixture();
 *     runUnitThatWritesToHome();
 *     expect(fx.exists("home/.loom/state.toon")).toBe(true);
 *   });
 */
export function createIsolatedFixture(
  options: IsolatedFixtureOptions = {},
): IsolatedFixture {
  const {
    prefix = "loom-isolated-",
    env = {},
    chdir = true,
    autoCleanup = true,
  } = options;

  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const home = path.join(root, "home");
  const cwd = path.join(root, "cwd");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });

  // Snapshot then override env. HOME (and USERPROFILE for win32 parity) point at
  // the fixture so os.homedir()-based writes are contained.
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

  const fixture: IsolatedFixture = {
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
    mkdir: (rel) => {
      const target = resolveRoot(rel);
      fs.mkdirSync(target, { recursive: true });
      return target;
    },
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

  if (autoCleanup) {
    // onTestFinished runs after the current test regardless of pass/throw and is
    // the vitest-native equivalent of a scoped afterEach for a single test.
    onTestFinished(() => fixture.cleanup());
  }

  return fixture;
}

/**
 * Run `body` with a fresh isolated fixture and guarantee cleanup even when it
 * throws or rejects. Cleanup is manual here (autoCleanup:false) so this helper
 * is usable OUTSIDE a running test (e.g. in a beforeAll). Returns whatever
 * `body` returns.
 */
export async function withIsolatedFixture<T>(
  body: (fixture: IsolatedFixture) => T | Promise<T>,
  options?: Omit<IsolatedFixtureOptions, "autoCleanup">,
): Promise<T> {
  const fixture = createIsolatedFixture({ ...options, autoCleanup: false });
  try {
    return await body(fixture);
  } finally {
    fixture.cleanup();
  }
}
