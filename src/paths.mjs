// Three path bases, never mixed (round-10 finding: join(ROOT, arg) silently
// mangles absolute inputs):
//   package assets (template, vendor, schema) -> import.meta.url relative
//   user input/output                              -> process.cwd()
//   manifest spec paths                           -> manifest's own directory
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const TEMPLATE_PATH = join(PKG_ROOT, 'assets', 'prototype-template.html');
export const VENDOR_LOCK_PATH = join(PKG_ROOT, 'vendor', 'archify.lock.json');

/** Resolve a user-supplied CLI path against the current working directory. */
export function userPath(p) {
  return resolve(process.cwd(), p);
}

/** Resolve a manifest-relative spec path (v2: never absolute, never escaping). */
export function manifestPath(manifestDir, rel) {
  return resolve(manifestDir, rel);
}
