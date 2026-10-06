#!/usr/bin/env node
// Canonical entry: prefers the self-contained bundle (installed skill, zero
// npm deps), falls back to source (in-repo development with npm ci).
let mod;
try {
  mod = await import('../dist/prechify.mjs');
} catch {
  mod = await import('../src/cli.mjs');
}
const result = await mod.run(process.argv.slice(2));
if (result?.exit !== null && result?.exit !== undefined) process.exit(result.exit);
