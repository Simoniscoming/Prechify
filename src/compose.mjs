// v2 composer: render every layer through the vendored adapter (freshness is
// structural — there is no "rendered" field to go stale), consume the
// fragments via the adapter contract, fill the runtime template, write one
// offline HTML file. Errors use stable codes and a JSON receipt.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { runArchify, extractFragment, extractFontsAndCss, namespaceIds, AdapterError } from './archify-adapter.mjs';
import { loadDeck } from './deck.mjs';
import { TEMPLATE_PATH, manifestPath } from './paths.mjs';

function fail(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, { extra });
  throw err;
}

const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const escapeJson = (v) =>
  JSON.stringify(v).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');

/** Render one layer spec into cacheDir and extract the fragment + host ids. */
async function renderLayer(l, specAbs, cacheDir) {
  const outHtml = join(cacheDir, `${l.id}.html`);
  const r = await runArchify(['render', l.type, specAbs, outHtml, '--quality', 'showcase']);
  if (r.status !== 0) fail(`render/${l.type}`, `层 "${l.id}" 渲染失败：\n${r.stdout}\n${r.stderr}`, { layer: l.id });
  const html = readFileSync(outHtml, 'utf8');
  const frag = extractFragment(html, l.id);
  const hostIds = new Set([...frag.el.querySelectorAll('[data-node-id]')].map((e) => e.getAttribute('data-node-id')));
  return { frag, hostIds, html };
}

/**
 * deliver(deckPath, outPath) -> receipt object. Throws Error-with-code on any
 * failure (schema/lint errors, renderer failure, contract drift).
 */
export async function compose(deckPath, outPath) {
  const loaded = loadDeck(deckPath);
  if (!loaded.ok) fail('deck/invalid', 'manifest 校验未通过', { errors: loaded.errors });
  const { deck, layerById, manifestDir, warnings } = loaded;

  const cacheDir = mkdtempSync(join(tmpdir(), 'prechify-deliver-'));
  const fragments = new Map();
  try {
    // drill hosts must exist in the *rendered* parent layer
    for (const l of deck.layers) {
      const { frag, hostIds, html } = await renderLayer(l, manifestPath(manifestDir, l.spec), cacheDir);
      for (const d of l.drills) {
        if (!hostIds.has(d.node)) {
          fail('compose/drill-host', `层 "${l.id}" 的穿透宿主 "${d.node}" 不在渲染产物中（可用节点：${[...hostIds].join(', ') || '无'}）`, { layer: l.id });
        }
      }
      fragments.set(l.id, { frag, html });
    }
    // fonts: all layers must embed the identical fonts block (dedup contract)
    const rootFonts = extractFontsAndCss(fragments.get(deck.root).html, deck.root).fontsStyle;
    for (const l of deck.layers) {
      if (l.id === deck.root) continue;
      if (extractFontsAndCss(fragments.get(l.id).html, l.id).fontsStyle !== rootFonts) {
        fail('adapter/fonts-mismatch', `层 "${l.id}" 的内嵌字体块与 root 层不一致（混合 archify 版本？）`, { layer: l.id });
      }
    }

    // assemble the flat world: one wrap per layer, ids namespaced per layer
    const idRewrites = new Map();
    const buildLayerSvg = (layerId) => {
      const frag = fragments.get(layerId).frag;
      const el = frag.el;
      const isRoot = layerId === deck.root;
      const { rewrites } = namespaceIds(el, layerId);
      idRewrites.set(layerId, rewrites);
      el.setAttribute('class', 'pch-layer');
      el.setAttribute('data-layer', layerId);
      el.setAttribute('data-lod', isRoot ? 'live' : 'off');
      el.setAttribute('data-type', layerById.get(layerId).type);
      el.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      const inner = el.innerHTML
        // tag the full-viewport grid rect so the runtime can hide the decoration
        .replace(/<rect width="100%" height="100%" fill="url\(#/, '<rect class="pch-grid-bg" width="100%" height="100%" fill="url(#');
      el.innerHTML = [
        `        <g class="pch-own">${inner}</g>`,
        '        <g class="pch-overlay"></g>',
      ].join('\n');
      return `      <div class="pch-wrap" data-layer="${layerId}" data-lod="${isRoot ? 'live' : 'off'}">\n${el.outerHTML}\n      </div>`;
    };
    const order = [deck.root];
    for (let i = 0; i < order.length; i++) {
      for (const d of layerById.get(order[i]).drills) order.push(d.layer);
    }
    if (new Set(order).size !== order.length) fail('compose/cycle', 'manifest 穿透关系成环');
    const worldSvg = [
      `<svg id="pch-root" xmlns="http://www.w3.org/2000/svg" viewBox="${fragments.get(deck.root).frag.viewBox.x} ${fragments.get(deck.root).frag.viewBox.y} ${fragments.get(deck.root).frag.viewBox.w} ${fragments.get(deck.root).frag.viewBox.h}" preserveAspectRatio="xMidYMid meet" aria-label="${escapeHtml(deck.title)}">`,
      order.map((id) => buildLayerSvg(id)).join('\n'),
      '</svg>',
    ].join('\n');

    const { fontsStyle, css } = extractFontsAndCss(fragments.get(deck.root).html, deck.root);
    const runtimeLayers = deck.layers.map((l) => ({
      id: l.id,
      title: l.title,
      type: l.type,
      viewBox: fragments.get(l.id).frag.viewBox,
      drills: l.drills,
      parent: loaded.parentOf.get(l.id) ?? null,
    }));

    const template = readFileSync(TEMPLATE_PATH, 'utf8');
    const deckDataScript = `  <script type="application/json" id="pch-deck-data">${escapeJson({
      title: deck.title,
      locale: deck.locale ?? 'zh-CN',
      root: deck.root,
      layers: runtimeLayers,
    })}</script>`;
    const replacements = [
      ['<!-- PRECHIFY:FONTS_STYLE -->', fontsStyle],
      ['<!-- PRECHIFY:DIAGRAM_STYLE -->', `  <style id="pch-diagram-css">\n${css}\n  </style>`],
      ['<!-- PRECHIFY:WORLD_SVG -->', worldSvg],
      ['<!-- PRECHIFY:DECK_DATA -->', deckDataScript],
      ['__DECK_TITLE__', escapeHtml(deck.title)],
    ];
    let out = template;
    for (const [slot, value] of replacements) {
      if (!out.includes(slot)) fail('compose/template', `模板缺少槽位 ${slot}（模板漂移？）`);
      out = out.split(slot).join(value);
    }
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, out);
    return {
      ok: true,
      out: outPath,
      bytes: Buffer.byteLength(out),
      sha256: createHash('sha256').update(out).digest('hex'),
      warnings,
      layers: runtimeLayers.map((l) => ({
        id: l.id,
        type: l.type,
        viewBox: `${l.viewBox.w}x${l.viewBox.h}`,
        idsRenamed: idRewrites.get(l.id) ?? 0,
        drills: l.drills.map((d) => `${d.node} -> ${d.layer}`),
      })),
      checks: [
        { name: 'schema_and_lint', ok: true },
        { name: 'rendered_fresh', ok: true },
        { name: 'drill_hosts_present', ok: true },
        { name: 'fonts_identical', ok: true },
        { name: 'ids_namespaced', ok: true },
        { name: 'template_slots_filled', ok: true },
      ],
    };
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
}

export { AdapterError };
