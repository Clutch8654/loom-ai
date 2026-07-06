/**
 * test/helpers/docker-e2e-guard.ts
 *
 * Shared gate for the clean-machine Docker E2E specs (PLAN-exceed-gstack
 * Phase 19, F-14, defect 15). Centralizes the one policy question every
 * container-harness spec asks: "should the heavy `docker build` + `docker run`
 * matrix actually execute in THIS environment, or degrade to a clean skip?"
 *
 * Why a reachable daemon is not enough:
 *   The specs previously gated only on `docker info` succeeding. But a reachable
 *   daemon is necessary, not sufficient — the clean-machine harness also needs a
 *   FRESHLY-BUILT release tarball and unrestricted network to reproduce a real
 *   install. A dev host commonly has a running daemon alongside a stale tarball
 *   or a network-restricted build sandbox, so the harness fails on env-specific
 *   packaging state (e.g. "hook not found" inside the container) that has nothing
 *   to do with the code under test. Those failures are deterministic, not flaky,
 *   and pollute the fast parallel suite.
 *
 * Policy: run the heavy matrix only when explicitly provisioned —
 *   - under CI (GitHub Actions always sets CI=true), where a fresh tarball is
 *     built as part of the job, or
 *   - when a developer opts in locally with LOOM_DOCKER_E2E=1.
 * Every other run degrades to a clean, documented skip (exit 0). Set
 * LOOM_DOCKER_E2E=0 to force-disable even under CI (useful for a fast lane).
 *
 * The bare-fact assertions in each spec (harness present, fixture present, spec
 * wiring) stay UNGATED so scaffolding regressions still surface everywhere.
 */

import { spawnSync } from "node:child_process";

/** True when the docker daemon is reachable (`docker info` exits 0). */
export function dockerDaemonReachable(): boolean {
  const r = spawnSync("docker", ["info"], { stdio: "ignore" });
  return r.status === 0;
}

/**
 * Whether the heavy clean-machine container harness is opted in for this run.
 * Explicit LOOM_DOCKER_E2E wins over CI detection in both directions.
 */
export function dockerE2eOptIn(): boolean {
  const flag = process.env.LOOM_DOCKER_E2E;
  if (flag === "1") return true;
  if (flag === "0") return false;
  return process.env.CI === "true" || process.env.CI === "1";
}

/**
 * Human-readable reason the harness will NOT run, given whether its concrete
 * dependencies (docker/tarball/harness/curl) are present. Rendered by each spec
 * as the explanatory message on a clean skip.
 */
export function dockerE2eSkipReason(depsAvailable: boolean): string {
  if (!depsAvailable) {
    return "docker/tarball/harness not available on this host";
  }
  return "clean-machine Docker E2E is opt-in — set LOOM_DOCKER_E2E=1 or run under CI";
}
