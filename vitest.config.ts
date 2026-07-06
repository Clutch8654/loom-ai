export default {
  test: {
    exclude: [
      "**/node_modules/**",
      ".worktrees/**",
      // Git worktrees live here too; their .git is a gitdir pointer, and a
      // detached/corrupted worktree makes `git -C` calls in tests fatal. Never
      // let the root runner reach into another worktree's checkout.
      ".claude/worktrees/**",
      "test/e2e/pass2-seeded-failure/**",
      // Sub-project with its own vitest config + deps (ajv, @toon-format/toon);
      // run via `cd test/protocol && bunx vitest run`.
      "test/protocol/**",
      // Test fixtures that import `bun:test`, not meant for the root runner.
      "test/fixtures/**",
      // Uses Bun.spawnSync — only runnable under `bun test`, not `bunx vitest`.
      "test/debug-harness.test.ts",
      // Compiled build output (gitignored). `hooks/dist/**` holds transpiled
      // `.test.js` duplicates of the `hooks/__tests__/*.test.ts` sources; when
      // a stale build is present the runner collected BOTH copies and the
      // stale `.js` set failed against moved-on fixtures. Never collect built
      // artifacts — the `.ts` sources are the single source of truth.
      "**/dist/**",
    ],
    // Many hook tests spawn `npx tsx <hook>` as a subprocess (cold-start each).
    // Under parallel test workers this can exceed vitest's 5s default. The hooks
    // themselves are fast — the latency is npm/npx/node startup under load.
    testTimeout: 30_000,
  },
};
