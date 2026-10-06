// Contract tests: the vendored archify closure must render all three diagram
// types AND the rendered output must keep every shape the adapter consumes.
// A failure here means "pin a new closure / update the adapter", never "tweak
// a deck". Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runArchify, extractFragment, extractFontsAndCss, namespaceIds, VENDOR_BIN, AdapterError } from '../../src/archify-adapter.mjs';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
// fixtures live in examples/demo (ships in both dev and public trees);
// the dev root's layers/ does not exist in the public tree (round-11 finding)
const FIXTURES = [
  { type: 'architecture', spec: 'examples/demo/layers/overview.architecture.json', probeIds: ['order', 'gateway', 'db'] },
  { type: 'workflow', spec: 'examples/demo/layers/order.workflow.json', probeIds: ['pay-callback', 'cart'] },
  { type: 'sequence', spec: 'examples/demo/layers/payment.sequence.json', probeIds: ['gateway', 'buyer'] },
];

test('vendored renderer validates and renders all three diagram types', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'prechify-contract-'));
  try {
    for (const f of FIXTURES) {
      const v = await runArchify(['validate', f.type, join(ROOT, f.spec), '--quality', 'showcase', '--json']);
      assert.equal(v.status, 0, `validate ${f.spec}:\n${v.stdout}\n${v.stderr}`);
      const out = join(temp, f.type + '.html');
      const r = await runArchify(['render', f.type, join(ROOT, f.spec), out, '--quality', 'showcase']);
      assert.equal(r.status, 0, `render ${f.spec}:\n${r.stdout}\n${r.stderr}`);
      const html = readFileSync(out, 'utf8');
      const frag = extractFragment(html, f.type);
      assert.ok(frag.viewBox.w > 0 && frag.viewBox.h > 0, `viewBox for ${f.type}`);
      const { css } = extractFontsAndCss(html, f.type);
      assert.ok(!/\n[ ]{4}svg \{/.test(css), 'global svg{} rule must be removed from vendored css');
      for (const id of f.probeIds) {
        assert.ok(frag.el.querySelector(`[data-node-id="${id}"]`), `data-node-id ${id} present in ${f.type}`);
      }
      const { rewrites } = namespaceIds(frag.el, f.type);
      assert.ok(rewrites > 0, `id references rewritten in ${f.type}`);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('fragment contract: exactly one diagram svg, extra svgs fail loudly', () => {
  const base = '<html><body><style id="archify-fonts">x</style><style>.diagram-container{}</style>\n    svg {width:100%}\n</body></html>';
  const one = base.replace('</body>', '<svg data-preset="classic" viewBox="0 0 10 10"></svg></body>');
  extractFragment(one, 'x'); // no throw
  const two = one.replace('</body>', '<svg data-preset="classic" viewBox="0 0 5 5"></svg></body>');
  assert.throws(() => extractFragment(two, 'x'), (e) => e.code === 'archify-adapter/fragment-count');
});

test('css contract: missing fonts block or missing global svg rule fail loudly', () => {
  const htmlWith = '<html><head><style id="archify-fonts">x</style><style>.diagram-container{}\n    svg {width:100%}\n</style></head></html>';
  extractFontsAndCss(htmlWith, 'x');
  const noFonts = htmlWith.replace('<style id="archify-fonts">x</style>', '');
  assert.throws(() => extractFontsAndCss(noFonts, 'x'), (e) => e.code === 'archify-adapter/fonts-block');
  const noRule = htmlWith.replace('\n    svg {width:100%}\n', '\n');
  assert.throws(() => extractFontsAndCss(noRule, 'x'), (e) => e.code === 'archify-adapter/global-svg-rule');
});

test('namespacing rewrites url(#…), aria tokens and hrefs, root included', async () => {
  const { parse } = await import('node-html-parser');
  const doc = parse(
    '<svg id="root-svg" data-preset="classic" viewBox="0 0 10 10" aria-labelledby="t d">' +
    '<title id="t">T</title><desc id="d">D</desc>' +
    '<defs><marker id="arrow"></marker></defs>' +
    '<path fill="url(#arrow)"></path><a href="#arrow">x</a></svg>'
  );
  const svg = doc.querySelector('svg');
  const { rewrites } = namespaceIds(svg, 'demo');
  assert.ok(svg.getAttribute('aria-labelledby').startsWith('pch-demo-'), 'root aria rewritten');
  assert.equal(svg.querySelector('path').getAttribute('fill'), 'url(#pch-demo-arrow)');
  assert.equal(svg.querySelector('a').getAttribute('href'), '#pch-demo-arrow');
  assert.ok(rewrites >= 3);
});
