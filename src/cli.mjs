// prechify CLI: validate / deliver / preview / visual-check / doctor.
// Exit codes: 0 ok · 1 check/compose failure · 2 usage · 3 environment.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDeck } from './deck.mjs';
import { compose } from './compose.mjs';
import { runArchify, VENDOR_BIN } from './archify-adapter.mjs';
import { TEMPLATE_PATH, VENDOR_LOCK_PATH, PKG_ROOT, userPath } from './paths.mjs';

const USAGE = `prechify — Prezi 式可穿透架构演示（archify 组合）

用法:
  prechify validate  <deck.json> [--json] [--deep]   校验 manifest（--deep 含逐层渲染与宿主检查）
  prechify deliver   <deck.json> --out <html> [--json]  渲染+组合为单文件离线 HTML
  prechify preview   <html> [--port 0] [--no-open]   本机预览服务器（默认随机端口，不自动开浏览器）
  prechify visual-check <html>                       视觉自动化检查（需要 playwright，见 doctor）
  prechify doctor    [--json]                        环境与依赖诊断

deck manifest v2：spec 路径相对 manifest 所在目录；无 rendered 字段（deliver 全量新渲染）。`;

function out(json, payload, text) {
  if (json) console.log(JSON.stringify(payload, null, 2));
  else if (text) console.log(text);
}

async function cmdValidate(args) {
  const deckPath = userPath(args._[0]);
  const json = args.json;
  const loaded = loadDeck(deckPath);
  let deep = null;
  if (args.deep && loaded.ok) {
    try {
      const { mkdtempSync, rmSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const tmp = mkdtempSync(join(tmpdir(), 'prechify-deep-'));
      try { await compose(deckPath, join(tmp, 'deep.html')); deep = { ok: true }; }
      finally { rmSync(tmp, { recursive: true, force: true }); }
    } catch (e) {
      deep = { ok: false, error: `${e.code ?? ''} ${e.message}`.trim() };
    }
  }
  const ok = loaded.ok && (!deep || deep.ok);
  const payload = { ok, errors: loaded.errors, warnings: loaded.warnings, deep };
  out(json, payload, loaded.ok ? '✔ manifest 校验通过' : '✘ manifest 校验未通过');
  if (!json && loaded.warnings.length) for (const w of loaded.warnings) console.warn(`⚠ ${w.code}: ${w.message}`);
  if (!json && deep && !deep.ok) console.error(`✘ --deep: ${deep.error}`);
  return { exit: ok ? 0 : 1, payload };
}

async function cmdDeliver(args) {
  const deckPath = userPath(args._[0]);
  const outPath = args.out ? userPath(args.out) : userPath('prechify-deck.html');
  const json = args.json;
  if (!args.out && !json) console.warn('⚠ 未指定 --out，默认输出到 ./prechify-deck.html');
  try {
    const receipt = await compose(deckPath, outPath);
    out(json, receipt, `✔ ${receipt.out} (${receipt.bytes} bytes, sha256 ${receipt.sha256.slice(0, 12)}…)`);
    if (!json && receipt.warnings.length) for (const w of receipt.warnings) console.warn(`⚠ ${w.code}: ${w.message}`);
    return { exit: 0, payload: receipt };
  } catch (e) {
    out(json, { ok: false, code: e.code, error: e.message, extra: e.extra }, `✘ ${e.code ?? 'error'}: ${e.message}`);
    return { exit: 1, payload: { ok: false, code: e.code, error: e.message, extra: e.extra } };
  }
}

async function cmdPreview(args) {
  const file = userPath(args._[0]);
  if (!existsSync(file)) { console.error(`✘ 文件不存在: ${file}`); return { exit: 1 }; }
  const html = readFileSync(file);
  const server = createServer((req, res) => {
    // serves exactly one artifact; no directory listing, no traversal
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/' && url.pathname !== '/index.html') {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  server.on('error', (e) => { console.error(`✘ preview: ${e.message}`); process.exit(1); });
  const port = Number(args.port ?? 0) || 0;
  server.listen(port, '127.0.0.1', () => {
    const addr = server.address();
    const url = `http://127.0.0.1:${addr.port}/`;
    console.log(`preview: ${url} (Ctrl-C 退出)`);
    if (args.open) {
      const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
        : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
      spawn(cmd[0], cmd[1], { shell: false, detached: true, stdio: 'ignore' }).unref();
    }
  });
  return { exit: null }; // server keeps the process alive
}

async function cmdVisualCheck(args) {
  const file = userPath(args._[0]);
  if (!existsSync(file)) { console.error(`✘ 文件不存在: ${file}`); return { exit: 1 }; }
  let pw = null;
  try { pw = await import('playwright'); } catch { /* not installed */ }
  if (!pw) {
    console.error('✘ 未检测到 playwright。视觉自动化套件需要它：\n' +
      '  1) npm install playwright && npx playwright install chromium\n' +
      '  2) 或先按 SKILL.md 手动验收（穿透/Esc/面包屑/明暗主题/键盘焦点）\n' +
      '静态校验通过不代表视觉验收通过。');
    return { exit: 3 };
  }
  console.error('⚠ playwright 已安装，但自动化视觉套件将在 v0.2 提供；请按 SKILL.md 手动验收。');
  return { exit: 3 };
}

async function cmdDoctor(args) {
  const json = args.json;
  const checks = [];
  const nodeOk = Number(process.versions.node.split('.')[0]) >= 22;
  checks.push({ name: 'node', ok: nodeOk, detail: `${process.versions.node}（要求 >=22）` });
  let lock = null;
  try { lock = JSON.parse(readFileSync(VENDOR_LOCK_PATH, 'utf8')); } catch { /* handled below */ }
  if (!lock) checks.push({ name: 'vendor-lock', ok: false, detail: 'archify.lock.json 缺失' });
  else {
    const { createHash } = await import('node:crypto');
    const { readdirSync, statSync } = await import('node:fs');
    const bad = [];
    const onDisk = new Set();
    (function walk(dir, rel) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name), r = rel ? rel + '/' + e.name : e.name;
        if (e.isDirectory()) walk(p, r);
        else {
          onDisk.add(r);
          const entry = lock.files.find((f) => f.path === r);
          const digest = createHash('sha256').update(readFileSync(p)).digest('hex');
          if (!entry || entry.sha256 !== digest) bad.push(r);
        }
      }
    })(join(PKG_ROOT, 'vendor', 'archify'), '');
    const missing = lock.files.filter((f) => !onDisk.has(f.path)).map((f) => f.path);
    checks.push({
      name: 'vendor-integrity',
      ok: bad.length === 0 && missing.length === 0,
      detail: `archify ${lock.archifyVersion} · ${lock.fileCount} 文件` + (bad.length || missing.length ? ` · 损坏:${bad.length} 缺失:${missing.length}` : ' · 校验和一致'),
    });
  }
  const template = existsSync(TEMPLATE_PATH) ? readFileSync(TEMPLATE_PATH, 'utf8') : '';
  const slots = ['<!-- PRECHIFY:FONTS_STYLE -->', '<!-- PRECHIFY:DIAGRAM_STYLE -->', '<!-- PRECHIFY:WORLD_SVG -->', '<!-- PRECHIFY:DECK_DATA -->', '__DECK_TITLE__'];
  checks.push({ name: 'runtime-template', ok: slots.every((s) => template.includes(s)), detail: slots.every((s) => template.includes(s)) ? '5 个槽位齐全' : '槽位缺失' });
  const help = await runArchify(['--help']);
  checks.push({ name: 'vendored-renderer', ok: help.status === 0, detail: help.status === 0 ? `${relative(PKG_ROOT, VENDOR_BIN)} 可执行` : '启动失败' });
  const ok = checks.every((c) => c.ok);
  out(json, { ok, checks }, checks.map((c) => `${c.ok ? '✔' : '✘'} ${c.name}: ${c.detail}`).join('\n'));
  return { exit: ok ? 0 : 3, payload: { ok, checks } };
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json' || a === '--deep' || a === '--no-open' || a === '--open') args[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = true;
    else if (a === '--out' || a === '--port') { args[a.slice(2)] = argv[++i]; }
    else args._.push(a);
  }
  return args;
}

export async function run(argv) {
  const [cmd, ...rest] = argv;
  const args = parseArgs(rest);
  switch (cmd) {
    case 'validate': return cmdValidate(args);
    case 'deliver': return cmdDeliver(args);
    case 'preview': return cmdPreview(args);
    case 'visual-check': return cmdVisualCheck(args);
    case 'doctor': return cmdDoctor(args);
    default: console.error(USAGE); return { exit: 2 };
  }
}
