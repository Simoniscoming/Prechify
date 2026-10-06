// CLI end-to-end: build a v2 deck from the demo specs in a temp dir, deliver
// it through the real composer + vendored renderer, and pin the negative
// behaviours round 10 found missing (schema_version 999, escaping paths,
// missing drill host, unescaped title).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../src/cli.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function makeDeckDir() {
  const dir = mkdtempSync(join(tmpdir(), 'prechify-cli-'));
  cpSync(join(ROOT, 'layers'), join(dir, 'layers'), { recursive: true });
  const v1 = JSON.parse(readFileSync(join(ROOT, 'deck.json'), 'utf8'));
  const deck = {
    schema_version: 2,
    title: v1.title + '<em>注</em>',
    locale: 'zh-CN',
    root: v1.root,
    layers: v1.layers.map((l) => ({
      id: l.id, title: l.title, type: l.type,
      spec: 'layers/' + l.spec.split('/').pop(),
      drills: (l.drills ?? []).map(({ node, layer, label }) => ({ node, layer, label })),
    })),
  };
  writeFileSync(join(dir, 'deck.json'), JSON.stringify(deck, null, 2) + '\n');
  return { dir, deck };
}

test('validate: v2 deck passes schema + lint', async () => {
  const { dir } = makeDeckDir();
  try {
    const r = await run(['validate', join(dir, 'deck.json'), '--json']);
    assert.equal(r.exit, 0, JSON.stringify(r.payload.errors));
    assert.equal(r.payload.ok, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('validate: schema_version 999 and missing layers are rejected, not TypeError', async () => {
  const { dir } = makeDeckDir();
  try {
    const bad = JSON.parse(readFileSync(join(dir, 'deck.json'), 'utf8'));
    bad.schema_version = 999;
    writeFileSync(join(dir, 'deck999.json'), JSON.stringify(bad));
    let r = await run(['validate', join(dir, 'deck999.json'), '--json']);
    assert.equal(r.exit, 1);
    assert.ok(r.payload.errors.some((e) => e.code === 'deck/schema'), '999 must fail schema');

    delete bad.schema_version; delete bad.layers;
    writeFileSync(join(dir, 'deckbroken.json'), JSON.stringify(bad));
    r = await run(['validate', join(dir, 'deckbroken.json'), '--json']);
    assert.equal(r.exit, 1);
    assert.ok(r.payload.errors.length > 0, 'missing required fields -> errors, not a crash');

    bad.schema_version = 2; bad.layers = []; bad.root = 'x';
    writeFileSync(join(dir, 'deckempty.json'), JSON.stringify(bad));
    r = await run(['validate', join(dir, 'deckempty.json'), '--json']);
    assert.equal(r.exit, 1);

    const esc = JSON.parse(readFileSync(join(dir, 'deck.json'), 'utf8'));
    esc.layers[0].spec = '../outside.json';
    writeFileSync(join(dir, 'deckesc.json'), JSON.stringify(esc));
    r = await run(['validate', join(dir, 'deckesc.json'), '--json']);
    assert.equal(r.exit, 1);
    assert.ok(r.payload.errors.some((e) => e.code === 'deck/schema'), 'escaping spec path must fail schema');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('deliver: composes the demo deck offline and escapes the title', async () => {
  const { dir } = makeDeckDir();
  try {
    const outHtml = join(dir, 'index.html');
    const r = await run(['deliver', join(dir, 'deck.json'), '--out', outHtml, '--json']);
    assert.equal(r.exit, 0, JSON.stringify(r.payload));
    assert.ok(existsSync(outHtml));
    const html = readFileSync(outHtml, 'utf8');
    assert.equal((html.match(/class="pch-wrap"/g) ?? []).length, 6, 'six layer wraps');
    assert.ok(html.includes('"root":"overview"'), 'deck data embedded');
    assert.ok(!html.includes('<em>注</em>'), 'raw title markup must not survive');
    assert.ok(html.includes('&lt;em&gt;注&lt;/em&gt;'), 'title must be escaped');
    assert.equal(r.payload.layers.length, 6);
    assert.ok(r.payload.checks.every((c) => c.ok));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('deliver: missing drill host fails with compose/drill-host and writes nothing', async () => {
  const { dir } = makeDeckDir();
  try {
    const deck = JSON.parse(readFileSync(join(dir, 'deck.json'), 'utf8'));
    deck.layers[0].drills[0].node = 'no-such-node';
    writeFileSync(join(dir, 'deck.json'), JSON.stringify(deck));
    const outHtml = join(dir, 'index.html');
    const r = await run(['deliver', join(dir, 'deck.json'), '--out', outHtml, '--json']);
    assert.equal(r.exit, 1);
    assert.equal(r.payload.code, 'compose/drill-host');
    assert.ok(!existsSync(outHtml), 'no output on failure');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('doctor: vendored closure verifies', async () => {
  const r = await run(['doctor', '--json']);
  assert.equal(r.exit, 0, JSON.stringify(r.payload));
  assert.ok(r.payload.checks.every((c) => c.ok));
});
