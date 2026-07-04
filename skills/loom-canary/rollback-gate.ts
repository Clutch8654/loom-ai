/**
 * skills/loom-canary/rollback-gate.ts
 *
 * Deterministic health-gate → rollback decision for /loom-canary (M-10 F-31).
 *
 * The SKILL body states the primary correctness property as: "one gate failure
 * ⇒ rollback executed ⇒ history row records `rolledBack: true`". That property
 * is orchestrated by the skill, but the *decision* — whether a given batch of
 * health-probe results promotes the phase or triggers rollback — is a pure
 * function, wired here and proven behaviorally in
 * tests/skills/workflow-batch.test.ts.
 *
 * A single non-2xx probe, a timeout, or an error-rate delta above the phase
 * threshold forces rollback. There is no "mostly healthy" promotion.
 */

/** One health-probe observation taken during a canary phase. */
export interface HealthProbe {
  /** HTTP status code returned by the probe, or null on timeout / no response. */
  status: number | null;
  /**
   * Optional error-rate delta the target exposed for this probe, as a
   * fraction (0.01 = 1%). Absent when the target does not expose it.
   */
  errorRateDelta?: number;
}

/** The gate's verdict for a canary phase. */
export type GateDecision = "promote" | "rollback";

export interface GateResult {
  decision: GateDecision;
  /** Machine reason; `CANARY_ROLLED_BACK` on any rollback. */
  reason: string;
  /** Index of the first failing probe, or -1 when all passed. */
  failedProbeIndex: number;
}

const ROLLBACK_CODE = "CANARY_ROLLED_BACK";

function is2xx(status: number | null): boolean {
  return status !== null && status >= 200 && status < 300;
}

/**
 * Evaluate a phase's probe batch against its error-rate threshold.
 *
 * Rollback fires on the FIRST failure — a non-2xx / timeout status, or an
 * error-rate delta at-or-above `errorRateThreshold`. Only when every probe is
 * healthy does the phase promote.
 */
export function evaluateHealthGate(
  probes: HealthProbe[],
  errorRateThreshold: number,
): GateResult {
  if (probes.length === 0) {
    // No evidence of health is not evidence of health — refuse to promote.
    return {
      decision: "rollback",
      reason: `[${ROLLBACK_CODE}] no health probes taken`,
      failedProbeIndex: -1,
    };
  }
  for (let i = 0; i < probes.length; i++) {
    const p = probes[i];
    if (!is2xx(p.status)) {
      return {
        decision: "rollback",
        reason: `[${ROLLBACK_CODE}] probe ${i} returned ${p.status ?? "timeout"}`,
        failedProbeIndex: i,
      };
    }
    if (p.errorRateDelta !== undefined && p.errorRateDelta >= errorRateThreshold) {
      return {
        decision: "rollback",
        reason: `[${ROLLBACK_CODE}] probe ${i} error-rate delta ${p.errorRateDelta} ≥ ${errorRateThreshold}`,
        failedProbeIndex: i,
      };
    }
  }
  return { decision: "promote", reason: "healthy", failedProbeIndex: -1 };
}

export { ROLLBACK_CODE };
