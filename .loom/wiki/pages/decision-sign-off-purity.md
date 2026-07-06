<!-- loom:adr-stub -->
```toon
pageId: decision-sign-off-purity
category: decision
summary: A roadmap reaches converged only via explicit /loom-roadmap sign-off; automation can at most set eligible, enforced by a vitest grep guard. See ADR-0002.
estimatedTokens: 324
bodySections[1]: Summary
staleness: migrated
updatedAt: 2026-07-06T00:00:00Z
updatedBy: wiki-ingest-agent
```

# Sign-Off as Sole Path to Converged

> **Migrated to ADR.** This wiki page has been promoted to a formal Architecture Decision Record.
>
> See: [ADR-0002: Sign-Off as Sole Path to Converged](../../../docs/adr/0002-sign-off-as-sole-path-to-converged.md)

## Summary

The terminal `converged` state is reachable only through an explicit user invocation of `/loom-roadmap sign-off` — no reviewer, integrator, driver, or hook may auto-fire it, even when every dimension is green and every question is resolved. The guarantee is structural: only `sign-off.ts` may write `sign_off_state = "signed-off"`, and a vitest grep test fails the suite if any other file under `scripts/roadmap-converge/` contains that literal. Rationale and alternatives live in [ADR-0002](../../../docs/adr/0002-sign-off-as-sole-path-to-converged.md).

This stub exists to preserve cross-references. Manage the decision at the ADR path above.
