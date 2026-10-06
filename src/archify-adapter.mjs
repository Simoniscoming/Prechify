// archify-adapter: the ONLY module that knows how to invoke the vendored
// archify renderer and how to consume its rendered HTML. Every upstream
// coupling point (selector shapes, style-block ids, the global svg{} rule,
// id namespacing) lives here and is guarded by tests/contract/. If archify
// changes shape, these fail loudly instead of silently mis-composing.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'node-html-parser';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const VENDOR_BIN = join(ROOT, 'vendor', 'archify', 'bin', 'archify.mjs');

export class AdapterError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = `archify-adapter/${code}`;
    this.extra = extra;
  }
}

/* ---- invoking the vendored renderer ------------------------------------- */
/**
 * Run the vendored archify CLI. Nonzero exit resolves as a value (status),
 * only spawn failure rejects. The child always gets a private TEMP dir:
 * restricted user temp dirs broke validate during acceptance (round 8).
 */
export function runArchify(args, { cwd = process.cwd() } = {}) {
  return new Promise((resolve, reject) => {
    const temp = mkdtempSync(join(tmpdir(), 'prechify-archify-'));
    const child = spawn(process.execPath, [VENDOR_BIN, ...args], {
      cwd,
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        ARCHIFY_UPDATE_CHECK_DISABLED: '1',
        TEMP: temp,
        TMP: temp,
        TMPDIR: temp,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => {
      rmSync(temp, { recursive: true, force: true });
      reject(new AdapterError('spawn', `vendored archify failed to start: ${err.message}`));
    });
    child.on('close', (status) => {
      rmSync(temp, { recursive: true, force: true });
      resolve({ status, stdout, stderr });
    });
  });
}

/* ---- consuming rendered HTML -------------------------------------------- */
const URL_REF_RE = /url\(#([^)\s]+)\)/g;

/**
 * Extract the one diagram fragment from a rendered archify HTML document.
 * Exactly one `svg[data-preset][viewBox]` must exist — extra overview or
 * minimap svgs from future upstream versions must fail, not silently pick.
 */
export function extractFragment(renderedHtml, layerId) {
  const doc = parse(renderedHtml);
  const candidates = doc.querySelectorAll('svg[data-preset][viewBox]');
  if (candidates.length !== 1) {
    throw new AdapterError('fragment-count', `layer ${layerId}: expected exactly 1 diagram svg[data-preset][viewBox], found ${candidates.length}`);
  }
  const svg = candidates[0];
  const vb = String(svg.getAttribute('viewBox')).trim().split(/\s+/).map(Number);
  if (vb.length !== 4 || vb.some((v) => !Number.isFinite(v)) || vb[2] <= 0 || vb[3] <= 0) {
    throw new AdapterError('viewBox', `layer ${layerId}: unusable viewBox "${svg.getAttribute('viewBox')}"`);
  }
  return { el: svg, viewBox: { x: vb[0], y: vb[1], w: vb[2], h: vb[3] } };
}

/**
 * Extract the fonts style block and the main diagram CSS with the global
 * `svg { width:100%… }` rule removed (it would hijack the per-layer svgs).
 * A missing fonts block or a missing global rule means upstream CSS
 * organization changed — contract drift, fail loudly.
 */
export function extractFontsAndCss(renderedHtml, layerId) {
  const doc = parse(renderedHtml);
  const fontsEl = doc.querySelector('style#archify-fonts');
  if (!fontsEl) throw new AdapterError('fonts-block', `layer ${layerId}: style#archify-fonts not found (upstream drift?)`);
  let mainCss = null;
  for (const s of doc.querySelectorAll('style')) {
    if (s.getAttribute('id')) continue;
    if ((s.textContent ?? '').includes('.diagram-container')) { mainCss = s.textContent; break; }
  }
  if (!mainCss) throw new AdapterError('main-css', `layer ${layerId}: main diagram style block (.diagram-container) not found`);
  const globalSvgRule = mainCss.match(/\n[ ]{4}svg \{[^{}]*\}\n/);
  if (!globalSvgRule) throw new AdapterError('global-svg-rule', `layer ${layerId}: global svg{} rule not found for removal (upstream CSS reorganized?)`);
  return { fontsStyle: fontsEl.outerHTML, css: mainCss.replace(globalSvgRule[0], '\n') };
}

/**
 * Namespace every id in a fragment and rewrite all reference syntaxes we
 * know about: url(#…) attributes, aria-labelledby/describedby token lists
 * (including on the svg root itself), and #fragment hrefs. Returns the
 * rewrite count so callers can assert references actually exist.
 */
export function namespaceIds(svgEl, layerId) {
  const prefix = `pch-${layerId}-`;
  const idMap = new Map();
  for (const el of svgEl.querySelectorAll('[id]')) {
    const id = el.getAttribute('id');
    idMap.set(id, prefix + id);
    el.setAttribute('id', prefix + id);
  }
  let rewrites = 0;
  const rewriteAttrValue = (el) => {
    const attrs = el.attributes ?? {};
    for (const [name, value] of Object.entries(attrs)) {
      if (typeof value !== 'string') continue;
      if (name === 'aria-labelledby' || name === 'aria-describedby') {
        const mapped = value.split(/\s+/).map((t) => (idMap.has(t) ? (rewrites++, idMap.get(t)) : t)).join(' ');
        if (mapped !== value) el.setAttribute(name, mapped);
      } else if ((name === 'href' || name === 'xlink:href') && value.startsWith('#')) {
        const key = value.slice(1);
        if (idMap.has(key)) { el.setAttribute(name, '#' + idMap.get(key)); rewrites++; }
      } else if (value.includes('url(#')) {
        const mapped = value.replace(URL_REF_RE, (m, id) => (idMap.has(id) ? (rewrites++, `url(#${idMap.get(id)})`) : m));
        if (mapped !== value) el.setAttribute(name, mapped);
      }
    }
  };
  rewriteAttrValue(svgEl); // the svg root carries aria-labelledby too
  for (const el of svgEl.querySelectorAll('*')) rewriteAttrValue(el);
  return { idMap, rewrites };
}
