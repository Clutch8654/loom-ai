# Daemon-Preflight Contract (C-07)

Defines **one** behavior, shared by every `loom-browser` daemon consumer, for the case where the daemon is not running when a command is issued. This closes the review's C-07 gap: before this contract, the stubbed daemon silently queued commands and returned 0, hiding the fact that nothing drove Chromium (blocking F-03).

This is a **contract-only** document (Wave 0). It constrains behavior downstream consumers MUST implement; it defines no implementation itself.

Schema examples use TOON per the project convention.

---

## The single required behavior

When any consumer issues a `BrowserCommand` (or otherwise needs the daemon) and the daemon is **not running**, the consumer MUST:

1. **Fail hard with a non-zero exit code.** Return `BrowserResult.ok = false`, `exitCode` non-zero, `error.code = DAEMON_NOT_RUNNING`.
2. **Print the remediation message** `run 'loom-browser start' first` on stderr (operator-facing).
3. **Do nothing else.** No side effects, no partial work, no queued state.

This is the only sanctioned daemon-down behavior. It is identical across all consumers: the CDP client (`scripts/lib/browser-client.ts`), the daemon executor (`scripts/e2e-daemon-runner.ts`), the e2e-runner daemon session mode (`agents/e2e-runner-agent.md`), the feedback-loop Rung-4 assertion (`scripts/loop-browser-rung.ts`), and the `loom-qa` outcome eval (`scripts/eval/tiers/qa-outcome.ts`).

### Preflight envelope (TOON)

```toon
preflight:
  daemonRunning: false
  action: fail
  exitCode: 2
  errorCode: DAEMON_NOT_RUNNING
  message: The loom-browser daemon is not running; no Chromium to attach to.
  remediation: run 'loom-browser start' first
```

On the happy path:

```toon
preflight:
  daemonRunning: true
  action: proceed
  exitCode: 0
```

---

## Explicitly forbidden behaviors

The following are **prohibited** for any consumer and MUST NOT be reintroduced:

| Forbidden behavior | Why it is banned |
|--------------------|------------------|
| **Silent-skip** — treat daemon-down as "nothing to do" and continue. | Hides missing verification; the exact failure mode C-07/F-03 was created to kill. |
| **Queue-return-0** — enqueue the command and return exit code 0. | The removed stub at `scripts/loom-browser-daemon.ts:268-290`; returns green while driving nothing. |
| **Auto-start the daemon implicitly.** | Preflight must be observable and explicit; the operator runs `loom-browser start`. Implicit starts mask lifecycle bugs. |
| **Downgrade to a warning + exit 0.** | Any exit-0 path on daemon-down defeats CI/loop gating. Daemon-down is an error, not a warning. |

---

## Distinction: daemon-down vs Chromium-absent

Two different failures with two different codes — do not conflate:

| Condition | Error code | Consumer behavior |
|-----------|-----------|-------------------|
| Daemon process not running | `DAEMON_NOT_RUNNING` | **Hard non-zero fail** (this contract). |
| Daemon running but Chromium binary missing / launch failed | `CHROMIUM_ABSENT` | Hard non-zero fail at the daemon; **behavioral tests (P2) SKIP rather than fail** when Chromium is absent, printing `SKIP: no Chromium — run playwright install chromium`. |

The Chromium-absent SKIP path (P2, P8a, P9a) applies only to **tests**, which skip cleanly so CI stays green without a browser. Runtime consumers (client, runner, Rung-4) still fail hard on `CHROMIUM_ABSENT`. This contract governs the **daemon-down** case for all of them.

---

## Relationship to other schemas

- **browser-command.schema.md** — defines the `DAEMON_NOT_RUNNING` and `CHROMIUM_ABSENT` codes and the `BrowserResult` envelope this contract references.
- **e2e-story.schema.md** (daemon-mode addendum) — the daemon executor performs this preflight before running any story step.
