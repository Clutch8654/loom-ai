```toon
pageId: component-deploy-guard
title: Deploy Guard Hook
category: component
subtype: ""
domain: code
summary: PreToolUse hook on Bash that blocks pushes to protected branches (main/master) and production cloud deploys (Convex/Wrangler/Vercel/Fly), enforcing a PR/review workflow. Fail-open.
estimatedTokens: 763
bodySections[3]: Summary, Dependencies, Key Behaviors
createdAt: 2026-04-25T22:00:00Z
updatedAt: 2026-07-06T00:00:00Z
createdBy: human
updatedBy: wiki-ingest-agent
sourceRefs[1]: hooks/deploy-guard.ts
crossRefs[2]{pageId,relationship}:
  component-hooks-system,depends-on
  convention-settings-json,relates-to
tags[4]: hooks, deploy, git, safety
staleness: fresh
confidence: high
```

# Deploy Guard Hook

## Summary

`hooks/deploy-guard.ts` is a `PreToolUse` hook matched on the `Bash` tool. It intercepts Bash commands and blocks dangerous deployment operations — direct pushes to protected branches and production deploys to cloud services — enforcing a PR/review workflow for all production changes.

## Dependencies

- **`hooks/lib/run-hook.ts`** — `runHook` harness plus `allow`/`block` helpers; provides the fail-open guarantee.
- **`.claude/settings.json`** — registers this hook under `PreToolUse` with a `Bash` matcher (see [convention-settings-json](convention-settings-json.md)).

## Key Behaviors

**Entry check:** returns `allow()` immediately if `tool_name !== "Bash"` or the command string is empty.

**Protected branches:** `PROTECTED_BRANCHES = ["main", "master"]`. Any `git push` targeting these is blocked; force pushes (`--force`, `-f`, `--force-with-lease`) to a protected branch get a more strongly worded block message. Branch detection: strip flags → collect positionals after `push` → if ≥2 positionals, the second is the refspec and the branch is the part after `:` (or the whole refspec) → strip a `refs/heads/` prefix. When no explicit target is detected (e.g. `git push origin`), the push is allowed — the hook only blocks when it can confidently identify a protected target. Force pushes to non-protected branches → `allow()` with an info message.

**Production deploy rules:** an extensible `DEPLOY_RULES` array; each rule has `service`, `pattern` (regex over the full command), and `reason`. The loop returns on first match, so order does not matter.

| Service | Blocked | Allowed |
|---------|---------|---------|
| Convex | `convex deploy` | `convex dev/codegen/import/export` |
| Cloudflare Workers | `wrangler deploy`, `wrangler publish` | `wrangler dev/tail/secret` |
| Vercel | `vercel --prod`, `vercel deploy --prod` | `vercel dev` |
| Fly.io | `fly deploy` | — |

All rules match `npx <tool> <subcommand>` as well as the bare form.

**Extending:** add an entry to `DEPLOY_RULES` in `hooks/deploy-guard.ts` (e.g. a Railway `railway up` rule) — order-independent.

**Fail-open:** any parsing error, regex error, or unexpected exception exits 0 (via the `runHook` harness), allowing the operation. The hook never accidentally blocks legitimate commands due to a bug.
