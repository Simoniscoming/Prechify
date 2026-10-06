// Bundle entry: cli.mjs only exports (importable for tests); this module is
// what actually executes as a program. Bundling cli.mjs directly produced a
// dist that ran as a silent no-op with exit 0 — the staged self-test
// "passed" while delivering nothing (round-11 finding, root-caused in 11b).
import { run } from './cli.mjs';
const result = await run(process.argv.slice(2));
if (result?.exit !== null && result?.exit !== undefined) process.exit(result.exit);
