#!/usr/bin/env node
// Canonical entry, two contracts (round-11b R11B-P01):
// - dist/prechify.mjs (installed skill) is a SELF-EXECUTING bundle built from
//   src/cli-main.mjs — importing it already runs the CLI with this process's
//   argv (validate/deliver exit inside; preview keeps the server alive).
//   Do NOT call run() on it: it exports nothing.
// - src/cli.mjs (in-repo development) only exports run(); execute it here.
let bundled = null;
let bundleErr = null;
try {
  bundled = await import('../dist/prechify.mjs');
} catch (e) {
  bundleErr = e;
}
if (bundled) {
  // the bundle ran itself; nothing left to do
} else {
  try {
    const { run } = await import('../src/cli.mjs');
    const result = await run(process.argv.slice(2));
    if (result?.exit !== null && result?.exit !== undefined) process.exit(result.exit);
  } catch {
    // surface the ORIGINAL bundle failure, not the absent source fallback
    throw bundleErr ?? new Error('prechify entry failed: no dist bundle and no src/cli.mjs');
  }
}
