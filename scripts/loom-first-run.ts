#!/usr/bin/env -S bunx tsx
import {
  defaultPluginJsonPath,
  detectRuntimeVersion,
  runFirstRun,
} from './lib/first-run.js';

async function main(): Promise<void> {
  // The outcome is intentionally unused: first-run is a side-effecting call
  // (it writes ~/.loom/install.toon). The former `outcome.action` read was
  // dead — FirstRunOutcome is a `kind`-tagged union with no `action` field, so
  // the report never fired. Removed (defect 4); behavior is unchanged (no-op).
  await runFirstRun({
    env: process.env,
    now: () => new Date(),
    pluginJsonPath: defaultPluginJsonPath(),
    runtimeVersion: detectRuntimeVersion(),
  });
}

main().catch((err) => {
  process.stderr.write(`loom-first-run failed: ${err?.message ?? err}\n`);
  process.exit(1);
});
