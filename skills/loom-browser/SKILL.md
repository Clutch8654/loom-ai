---
name: loom-browser
description: Persistent Chromium daemon at .loom/browser/ with tiered READ/WRITE/META command semantics, accessibility-tree refs, anti-bot stealth stubs, and prompt-injection defense hooks.
---

# /loom-browser — Persistent Chromium Daemon (M-11)

<!-- @loom-include: protocols/skill-preamble.md -->

`/loom-browser` gives Loom a long-lived headless (or headed) Chromium session
that downstream commands share instead of each cold-starting their own browser.
It is the substrate that `/loom-qa` (M-07), `/loom-design (consultation|html|shotgun)` (M-13), and
`/loom-benchmark` (M-08 F-27) build on.

## Subcommands

| Subcommand | Tier | Effect |
|------------|------|--------|
| `/loom-browser start` | META | Boot Chromium, write `.loom/browser/state.toon`, attach injection defense hooks, load per-domain cookies from `.loom/browser/cookies/*.toon` if present. |
| `/loom-browser stop`  | META | Terminate the daemon, mark `state.toon` `stopped`. |
| `/loom-browser status`| META | Print current daemon state — `stopped`, `starting`, `running`, `stopping`, `crashed`. |
| `/loom-browser exec <cmd>` | READ or WRITE | Run one command against the running daemon. See tier table below. |

## State — `.loom/browser/state.toon`

Written on `start`, updated on tab changes, deleted (or marked `stopped`) on
`stop`. Schema — `protocols/browser-state.schema.toon` (Phase 0):

```
schemaVersion: 1
daemonPid: 47213
daemonPort: 9222
startedAt: 2026-06-30T14:22:05Z
chromiumBinaryPath: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
cdpEndpoint: ws://127.0.0.1:9222/devtools/browser/abc123
activeTabs[1]{tabId,url,title}:
  T-01,https://example.com,Example Domain
cookiesLoaded: true
injectionDefenseEnabled: true
```

If `daemonPid` is present but the OS process is gone, the daemon is `crashed`
and a subsequent `start` will clean up before booting.

## Tier semantics

Loom commands classify every browser operation into one of three tiers. This
tiering is what lets us cache aggressively, replay safely, and reason about
side effects.

### READ (idempotent)

Safe to retry, safe to parallelize, cacheable.

- Screenshot (`page.screenshot`)
- DOM query (`page.$eval`, `page.evaluate`)
- Accessibility-tree fetch (`page.accessibility.snapshot()`)
- Network request log dump
- Console log dump
- URL / title read

### WRITE (side-effecting)

Mutates page state or navigates. Must be sequenced, not parallelized.

- Click, type, hover, drag
- Navigate (`page.goto`)
- Form submit
- File upload / download

### META (daemon-lifecycle)

Affects the daemon itself, not any page. Must not run while READ/WRITE
operations are in flight.

- start / stop / restart
- Config change (viewport, user-agent)
- Cookie import (see `/loom-setup browser-cookies`)
- Extension load

## Accessibility-tree refs

Downstream agents reference DOM elements by a **role+name+index tuple** from
the accessibility tree, **not** raw CSS selectors:

```
{role: "button", name: "Sign in", index: 0}
```

This keeps refs stable across style refactors and legible to reviewers. When
an element has no accessible name, the daemon synthesizes one from the nearest
label or heading; the synthesis rule is recorded in the WRITE trace so a
future retro can catch cases where the synthesized name drifted.

## Anti-bot stealth stubs

M-11 ships **stub** stealth hooks — enough to unbreak most `navigator.webdriver`
sniff tests and consistent user-agent handling, but not a full evasion suite.
The stubs are:

- `navigator.webdriver` set to `undefined`
- Realistic `navigator.plugins` / `navigator.languages`
- WebGL vendor / renderer overrides seeded from the wrapped user install

Full evasion (canvas fingerprinting randomization, TLS fingerprint tuning) is
explicit **Out of Scope** for M-11 and left to future milestones.

## Prompt-injection defense hooks

The daemon fires a hook on every page load with the extracted page text. It is
wired to a **standalone signature detector** (`scanForInjection` in
`scripts/lib/browser-client.ts`, F-39 / gstack-adoption M-05): the WRITE
`navigate` path pipes `document.body.innerText` through `onPageText`, which
returns `ok:false` with `findings[]` on a prompt-injection signature —
instruction-override, role-hijack/jailbreak, system-prompt exfiltration,
data-exfiltration, destructive directives, and chat-template delimiter
injection. On `ok:false` the gate surfaces `BROWSER_INJECTION_BLOCKED` (exit 8)
and fails closed. Rules are high-precision (multi-word directives), so ordinary
page copy does not trip them.

**Relationship to F-15 (`code-llm-trust-review-agent`):** complementary, not a
dependency. F-15 audits *source diffs* at code-review time (an LLM subagent);
this hook scans *runtime page text* per navigation (a synchronous function).
They share a theme (trust boundaries) but neither calls the other — a
diff-review subagent cannot run on every page load.

Hook shape (stable contract — do not rename):

```
onPageText(pageText: string, url: string) => { ok: boolean, findings: Finding[] }
```

## Chromium binary policy

M-11 **wraps the existing user Chromium/Chrome install** — it does not bundle
a binary. Detection order — macOS: `/Applications/Google Chrome.app`,
`/Applications/Chromium.app`, `$CHROME_PATH`. Linux: `google-chrome`,
`chromium`, `chromium-browser`. Windows: `%PROGRAMFILES%\Google\Chrome`.

If no binary is found, `/loom-browser start` emits `BROWSER_ALREADY_RUNNING`
or a related `BROWSER_NO_BINARY` diagnostic and falls back to **stub mode**
(queue-only — commands are written to `.loom/browser/queue.toon` for the
operator to run manually). This keeps M-11 best-effort so downstream milestones
can still emit useful plans in CI environments without a browser.

## Beyond upstream

gstack's browser support cold-starts a fresh headless Chrome per invocation.
`/loom-browser` goes **beyond parity** with a *persistent daemon* that survives
across commands (`.loom/browser/state.toon`) and degrades to a queue-only
**stub mode** (`.loom/browser/queue.toon`) when no Chromium binary is present —
so downstream commands still emit useful plans in a browserless CI box instead
of hard-failing. That daemon + queue-fallback behavior is what
`tests/backfill/loom-browser-daemon.test.ts` exercises as a live subprocess.

## Downstream consumers

- **M-07 `/loom-qa`** — live-site iterative test/fix loop
- **M-07 `/loom-devex review`** — live DX audit with real TTHW measurement
- **M-07 `/loom-cso`** — two-tier live security review
- **M-13 `/loom-design (consultation|html|shotgun)`** — HTML → design consultation → shotgun screenshot compare
- **M-08 F-27 `/loom-benchmark`** — comparative live-site benchmark harness
- **`e2e-runner-agent` (daemon session mode)** — the convergence e2e-tier runner. When `/loom-converge --e2e --daemon` is invoked, `e2e-runner-agent` drives this daemon through the structured-action executor (`scripts/e2e-daemon-runner.ts`) instead of Playwright or Chrome MCP. See `agents/e2e-runner-agent.md` § Daemon Mode.

Each of these commands may only issue tier-appropriate operations and MUST
respect the READ/WRITE serialization contract above.

## Daemon preflight (mandatory for every consumer)

Before any consumer issues a `BrowserCommand` — READ, WRITE, or the first step
of a daemon-mode e2e story — it MUST run the daemon preflight defined in
`protocols/daemon-preflight.schema.md`. This is the single sanctioned
daemon-down behavior, identical across every consumer above:

- If the daemon is **running**, preflight returns `action: proceed`, `exitCode: 0`.
- If the daemon is **not running**, the consumer MUST **fail hard with a
  non-zero exit code** (`exitCode: 2`, `errorCode: DAEMON_NOT_RUNNING`) and print
  `run 'loom-browser start' first` on stderr. It does nothing else — no queued
  state, no partial work.

The following daemon-down behaviors are **forbidden** and MUST NOT be
reintroduced: silent-skip (treat down as "nothing to do"), queue-return-0
(enqueue and return exit 0), implicit auto-start, or downgrade-to-warning +
exit 0. Any exit-0 path on daemon-down defeats CI/loop gating — daemon-down is
an error, not a warning. (`CHROMIUM_ABSENT` — daemon up but no browser binary —
is a separate hard-fail at runtime; only P2/P8a/P9a *tests* SKIP cleanly on
absent Chromium so CI stays green.)
