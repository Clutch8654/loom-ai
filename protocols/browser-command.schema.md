# BrowserCommand Protocol Schema

Defines the closed command grammar, a11y-reference shape, result envelope, and error taxonomy for the `loom-browser` persistent-Chromium daemon (`scripts/loom-browser-daemon.ts`, `scripts/lib/browser-client.ts`). Every consumer of the daemon — the CDP client (P1a/P1b), the daemon executor (P3), the e2e-runner daemon session mode (P4a), the feedback-loop Rung-4 assertion (P5), and the `loom-qa` outcome eval (P8a) — reads this contract to construct commands and interpret results.

This is a **contract-only** document (Wave 0). No behavior or dispatch logic is defined here — see the owning phases for implementation.

All schema examples use TOON per the project TOON-everywhere convention. On-the-wire command/result payloads between the CLI and the daemon are TOON.

---

## BrowserCommand Schema

A `BrowserCommand` is one instruction sent to the daemon. Its `verb` is drawn from a **closed** enum partitioned into three tiers (READ / WRITE / META). The tier governs concurrency semantics (C-08 — enforced by the daemon lock in P1b), and is the single source of truth for the verb→tier classifier the client builds from `skills/loom-browser/SKILL.md:46-79`.

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| verb | enum | yes | One of the closed verb set below. Unknown verbs are rejected with `STORY_PARSE_ERROR`. |
| tier | enum | yes | `read`, `write`, or `meta`. Derived from `verb`; MUST match the verb's tier in the table below. |
| target | A11yRef \| string \| null | no | The element the verb acts on. For element-scoped verbs (`click`, `type`, `hover`, `css`, `is-visible`, `bounding-box`, `dom-query`) this is an `A11yRef` (see below) or a raw selector string. For `navigate` it is the URL string. Null for page-scoped/META verbs. |
| args | object | no | Verb-specific arguments (e.g. `text` for `type`, `path` for `upload`, `key`/`value` for `config`). Shape is verb-defined; consumers document their own arg keys. |
| timeoutMs | integer | no | Per-command timeout. On expiry the daemon returns `STEP_TIMEOUT`. Defaults to the daemon's step default (30000ms). |

### Closed verb enum

| Tier | Verbs |
|------|-------|
| `read` | `screenshot`, `dom-query`, `a11y-snapshot`, `console-log`, `network-log`, `get-url`, `get-title`, `css`, `is-visible`, `bounding-box` |
| `write` | `click`, `type`, `hover`, `navigate`, `submit`, `upload` |
| `meta` | `start`, `stop`, `restart`, `config`, `cookie-import` |

The enum is **closed**: any `verb` not listed above is a `STORY_PARSE_ERROR`. The three computed-style READ verbs (`css`, `is-visible`, `bounding-box`) are load-bearing — they make the P8 visual-bug category detectable (resolves review theme T1, the P1↔P8 contradiction).

### Tier semantics (concurrency — enforced in P1b, C-08)

| Tier | Concurrency rule |
|------|------------------|
| `read` | Concurrent-safe; may run in parallel with other reads. |
| `write` | **Sequenced** — the daemon lock serializes WRITE commands across separate CLI processes. |
| `meta` | **Exclusive** — lifecycle commands hold the lock exclusively (no concurrent READ/WRITE). |

### Example

```toon
command:
  verb: click
  tier: write
  target:
    role: button
    name: Submit
    index: 0
  args:
  timeoutMs: 30000
```

```toon
command:
  verb: type
  tier: write
  target:
    role: textbox
    name: Email
    index: 0
  args:
    text: user@example.com
  timeoutMs: 30000
```

---

## A11yRef Schema

Element targeting uses the accessibility tree, not brittle CSS/XPath. An `A11yRef` identifies exactly one node by its ARIA `role`, accessible `name`, and a positional `index` disambiguating duplicates (0-based, document order).

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| role | string | yes | ARIA role (e.g. `button`, `textbox`, `link`, `heading`). |
| name | string | yes | Accessible name (visible label / `aria-label` / associated text). May be empty for unnamed nodes. |
| index | integer | yes | 0-based occurrence among nodes matching `{role, name}` in document order. Disambiguates duplicates. |

### Resolution contract

The client resolves an `A11yRef` against the **live** accessibility snapshot of the current page. On a miss (no node matches `{role, name, index}`) the command fails with `REF_UNRESOLVED` and a non-zero exit — never a silent no-op (P1a).

### Example

```toon
ref:
  role: textbox
  name: Search
  index: 0
```

---

## BrowserResult Envelope

Every command returns a `BrowserResult`. Success and failure share the shape; failures carry a populated `error` block drawn from the closed error-code enum below.

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| ok | boolean | yes | `true` on success, `false` on any failure. |
| verb | enum | yes | Echo of the command verb. |
| tier | enum | yes | Echo of the command tier. |
| exitCode | integer | yes | `0` on success; **non-zero** on any failure (mirrors the error code; never 0 on error — see `daemon-preflight.schema.md`). |
| data | object \| null | no | Verb-specific payload on success (e.g. screenshot path, DOM string, a11y snapshot, computed-style value, bounding box). Null on failure. |
| error | BrowserError \| null | no | Populated iff `ok: false`. See BrowserError below. |
| durationMs | integer | no | Wall-clock duration of the command. |

### BrowserError Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| code | enum | yes | One of the closed error-code enum below. |
| message | string | yes | Operator-facing message (what happened). |
| remediation | string | yes | Actionable next step (how to fix it). |

### Success example

```toon
result:
  ok: true
  verb: get-title
  tier: read
  exitCode: 0
  data:
    title: Dashboard
  error:
  durationMs: 12
```

### Failure example

```toon
result:
  ok: false
  verb: click
  tier: write
  exitCode: 4
  data:
  error:
    code: REF_UNRESOLVED
    message: No accessibility node matched {role:button, name:Submit, index:0} on the current page.
    remediation: Re-capture the a11y snapshot (a11y-snapshot) and verify the role/name/index; the element may not be rendered yet.
  durationMs: 30
```

---

## Closed error-code enum

The error space is **closed**. Every failure maps to exactly one code. Each carries a stable operator `message` template and a `remediation`. Exit codes are non-zero and stable per code.

| Code | exitCode | Operator message (template) | Remediation |
|------|----------|-----------------------------|-------------|
| `DAEMON_NOT_RUNNING` | 2 | The loom-browser daemon is not running; no Chromium to attach to. | run 'loom-browser start' first |
| `CHROMIUM_ABSENT` | 3 | Chromium binary not found / failed to launch. | Run `playwright install chromium`, then `loom-browser start`. |
| `CDP_DISCONNECTED` | 5 | Lost the CDP connection to Chromium (`connectOverCDP` socket closed). | The client attempts one reconnect; if it fails, run `loom-browser restart`. |
| `REF_UNRESOLVED` | 4 | An a11y-ref (role+name+index) matched no node on the current page. | Re-capture the a11y snapshot and verify role/name/index; the element may not be rendered yet. |
| `STEP_TIMEOUT` | 6 | A command exceeded its `timeoutMs` budget. | Increase `timeoutMs`, or assert the precondition (element present / navigation settled) before the step. |
| `STORY_PARSE_ERROR` | 7 | A structured-action story step could not be parsed into a BrowserCommand (unknown verb or malformed a11y-ref JSON). | Fix the story step against the action grammar in `e2e-story.schema.md` (daemon-mode addendum). |
| `BROWSER_INJECTION_BLOCKED` | 8 | The prompt-injection defense hook (`onPageText`) rejected page content on navigation. | Review the flagged page; the navigation was refused by policy. Full impl deferred to M-05/F-15. |

Notes:
- `DAEMON_NOT_RUNNING` is the daemon-down code and MUST follow `daemon-preflight.schema.md` (hard non-zero fail, never silent-skip / queue-return-0). It replaces the removed queue-return-0 stub (blocking F-03).
- `BROWSER_INJECTION_BLOCKED` is the contract slot for the injection-defense stub (C-07) created in P1b; the `onPageText(pageText, url)` hook is defined by `skills/loom-browser/SKILL.md:108-124`.

---

## TypeScript contract

The `BrowserCommand`, `A11yRef`, `BrowserResult`, and `BrowserErrorCode` types are declared in `lib/types.ts` (appended in Wave 0). Downstream implementers import from there.

## Relationship to other schemas

- **daemon-preflight.schema.md** — the single daemon-down behavior all consumers share (`DAEMON_NOT_RUNNING`).
- **e2e-story.schema.md** (daemon-mode addendum) — the structured action grammar that compiles to `BrowserCommand`s.
- **outcome-eval.schema.md** — the `loom-qa` outcome eval consumes READ results (incl. computed-style verbs) to detect planted bugs.
- **browser-skill.schema.md** — fixture-tested browser-skills parse captured HTML; they are pure and do NOT emit BrowserCommands.
