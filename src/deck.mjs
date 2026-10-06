// deck v2 loading + semantic lint. Schema shape errors and semantic errors
// are collected together; `--json` callers get one report. Rendering-dependent
// checks (drill hosts exist in the rendered svg) live in compose/deliver.
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import schema from './schema/deck-v2.schema.json' with { type: 'json' };
import { manifestPath } from './paths.mjs';

const ajv = new Ajv({ allErrors: true, strict: false });
const validateSchema = ajv.compile(schema);

export function lintTitle(title) {
  // Heuristic warnings only — browser geometry decides whether it fits.
  const warnings = [];
  if ([...title].length > 24) warnings.push(`标题较长（${[...title].length} 字符），标题栏可能换行/截断`);
  return warnings;
}

/**
 * Load and lint a deck manifest. Returns
 * { ok, errors: [{code, message}], warnings: [{code, message}], deck, layerById, manifestDir }
 */
export function loadDeck(deckPath) {
  const errors = [];
  const warnings = [];
  let raw;
  try {
    raw = readFileSync(deckPath, 'utf8');
  } catch (e) {
    return { ok: false, errors: [{ code: 'deck/read', message: `无法读取 ${deckPath}: ${e.message}` }], warnings };
  }
  let deck;
  try {
    deck = JSON.parse(raw);
  } catch (e) {
    return { ok: false, errors: [{ code: 'deck/parse', message: `JSON 解析失败: ${e.message}` }], warnings };
  }
  if (!validateSchema(deck)) {
    for (const err of validateSchema.errors ?? []) {
      errors.push({ code: 'deck/schema', message: `${err.instancePath || '(root)'} ${err.message}` });
    }
    return { ok: false, errors, warnings, deck };
  }
  const manifestDir = dirname(deckPath);
  const layerById = new Map();
  for (const l of deck.layers) {
    if (layerById.has(l.id)) errors.push({ code: 'deck/duplicate', message: `重复层 id "${l.id}"` });
    layerById.set(l.id, l);
  }
  if (!layerById.has(deck.root)) errors.push({ code: 'deck/root', message: `root 层 "${deck.root}" 未定义` });
  if (layerById.has(deck.root) && layerById.get(deck.root).drills.length === 0 && deck.layers.length > 1) {
    warnings.push({ code: 'deck/root-no-drill', message: 'root 层没有任何穿透入口，产物将是单层静态图（也许该用 archify 直接出图）' });
  }

  const parentOf = new Map();
  for (const l of deck.layers) {
    const seenNodes = new Set();
    const seenTargets = new Set();
    for (const d of l.drills) {
      if (!layerById.has(d.layer)) errors.push({ code: 'deck/drill-target', message: `层 "${l.id}" 穿透到未定义层 "${d.layer}"` });
      if (d.layer === l.id) errors.push({ code: 'deck/drill-self', message: `层 "${l.id}" 穿透到自己` });
      if (parentOf.has(d.layer)) errors.push({ code: 'deck/drill-conflict', message: `层 "${d.layer}" 有多个穿透入口（树形要求单父）` });
      if (seenNodes.has(d.node)) errors.push({ code: 'deck/drill-node', message: `层 "${l.id}" 对节点 "${d.node}" 绑定两次穿透` });
      if (seenTargets.has(d.layer)) errors.push({ code: 'deck/drill-target', message: `层 "${l.id}" 两次穿透到 "${d.layer}"` });
      if ([...d.label].length > 12) warnings.push({ code: 'deck/label-length', message: `穿透标签 "${d.label}" 较长，可能触发自动避让换位` });
      seenNodes.add(d.node);
      seenTargets.add(d.layer);
      if (!parentOf.has(d.layer)) parentOf.set(d.layer, { parent: l.id, node: d.node, label: d.label });
    }
  }
  if (parentOf.has(deck.root)) {
    errors.push({ code: 'deck/root-cycle', message: `root 层 "${deck.root}" 被回钻（环）` });
  }
  // reachability + depth from root, downward
  const depth = new Map([[deck.root, 1]]);
  const queue = [deck.root];
  while (queue.length) {
    const id = queue.shift();
    const d0 = depth.get(id);
    for (const d of layerById.get(id)?.drills ?? []) {
      if (!depth.has(d.layer)) {
        if (d0 >= 3) errors.push({ code: 'deck/depth', message: `层 "${d.layer}" 超过深度上限 3` });
        else { depth.set(d.layer, d0 + 1); queue.push(d.layer); }
      }
    }
  }
  for (const l of deck.layers) {
    if (!depth.has(l.id)) errors.push({ code: 'deck/unreachable', message: `层 "${l.id}" 从 root 不可达` });
  }
  if (deck.layers.length > 6) warnings.push({ code: 'deck/size', message: `${deck.layers.length} 层超过建议值 6（仅性能/可读性建议）` });
  warnings.push(...lintTitle(deck.title));

  // spec-level hints (cheap, no rendering): sequence first segment label offset
  for (const l of deck.layers) {
    if (l.type !== 'sequence') continue;
    try {
      const spec = JSON.parse(readFileSync(manifestPath(manifestDir, l.spec), 'utf8'));
      const first = (spec.segments ?? [])[0];
      if (first && typeof first.from === 'number' && first.from < 172) {
        warnings.push({ code: 'deck/sequence-first-segment', message: `层 "${l.id}" 首分段 from=${first.from}：分段标题会被参与者头块遮挡（archify 渲染器怪癖），建议 from ≥ 172` });
      }
    } catch { /* unreadable spec is caught at deliver with a rendering error */ }
  }

  return { ok: errors.length === 0, errors, warnings, deck, layerById, manifestDir, parentOf };
}
