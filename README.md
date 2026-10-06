# prechify

**Prezi-style drill-down presentations over architecture diagrams.** Compose a
small tree of [archify](https://github.com/tt-a1i/archify) diagrams — an
architecture overview whose modules you can click to dive into workflow /
sequence sub-diagrams — into **one offline HTML file** that opens with a
double-click. No server, no network, no CDN.

```
系统总览（架构图）
├─ 订单服务 ──点击穿透──▶ 订单流程（工作流）──支付回调──▶ 支付时序
├─ 认证服务 ──点击穿透──▶ 认证时序
└─ 库存服务 ──点击穿透──▶ 库存工作流──补偿对账──▶ 补偿时序
```

Smooth camera flights, breadcrumb/history navigation, dark & light themes,
keyboard access, deep links. Author with JSON specs; ship one HTML file.

## Install & quick start (author side)

Requires Node ≥ 22. The renderer is vendored — nothing else to install.

```bash
git clone https://github.com/<you>/prechify.git
cd prechify && npm ci            # ajv + node-html-parser only
node bin/prechify.mjs doctor     # verify vendored renderer & template

# try the bundled example (fictional e-commerce demo, 6 layers)
node bin/prechify.mjs deliver examples/demo/deck.json --out demo.html
start demo.html   # or open/xdg-open — then click a dashed ring, press Esc
```

### As a ZCode/agent skill

Copy or clone this repo to `~/.agents/skills/prechify/` — `SKILL.md` is the
entrypoint. The workflow is agent-friendly: `validate --json`, `deliver --json`
(a receipt with SHA-256), deterministic exit codes.

## Authoring a deck

A deck is a tree of 2-6 layers (max depth 3), described by a manifest v2 plus
one archify JSON spec per layer:

```json
{
  "schema_version": 2, "title": "我的系统", "locale": "zh-CN", "root": "overview",
  "layers": [
    { "id": "overview", "title": "总览", "type": "architecture",
      "spec": "layers/overview.architecture.json",
      "drills": [{ "node": "order", "layer": "order", "label": "订单流程" }] },
    { "id": "order", "title": "订单流程", "type": "workflow",
      "spec": "layers/order.workflow.json", "drills": [] }
  ]
}
```

- `spec` paths are relative to the manifest's directory.
- `drills[].node` must exist as a component / workflow node / sequence
  participant id in the parent layer — anything renderable with a
  `data-node-id`.
- `validate` warns about known renderer quirks (e.g. sequence first segments
  should start at `from ≥ 172`).

See `examples/demo/` and `src/schema/deck-v2.schema.json`.

## Commands

| command | what it does |
|---|---|
| `validate <deck> [--deep]` | JSON-Schema + semantic lint; `--deep` renders every layer and checks drill hosts |
| `deliver <deck> --out <html>` | renders every layer fresh through the vendored archify, composes the offline page, prints a receipt with SHA-256 |
| `preview <html>` | serves the artifact on a random `127.0.0.1` port |
| `doctor` | verifies vendored renderer hashes, template slots, Node version |
| `visual-check <html>` | requires playwright; the automated visual suite lands in v0.2 |

## Compatibility (v0.1 — honest table)

Acceptance matrix: 24 deterministic functional scenarios per pass × 3 passes
(72 assertions) per engine, across 3 engines, plus a cold-boot pass per run —
Windows 11 / Intel Iris Xe, headed with native GPU.

| Environment | Status |
|---|---|
| Desktop Chromium (Chrome/Edge, current stable) | ✅ **full acceptance** — 72/72 functions, zero console errors, flight p50 8-13ms / p95 ≤17ms / warm max ≤60ms (2-of-3 rule passed both directions) |
| Firefox (current stable) | ✅ functional acceptance (72/72, zero errors, keyboard/focus fallbacks verified) · ⚠ deep-dive flights p95 ~31-37ms — usable but below the Chrome-class smoothness bar; optimization scheduled for v0.2 |
| WebKit (Windows, playwright build) | ✅ functional acceptance (72/72, zero errors) · ⚠ flights uniformly ~30-40ms/frame — visibly calmer than Chrome; **real-device Safari still unverified** (v0.2) |
| Touch / pinch | ❌ not supported in v0.1 (desktop mouse + keyboard) |
| CJK text | ✅ works via system font fallback — glyph appearance differs across OS; label placement re-measures on font-swap and warns when no collision-free slot exists |
| Cold first flight after page load | ⚠ single ~45-65ms frame recorded per engine (first raster of the target layer); warm flights unaffected. Cold root-exit after deep dives keeps the registered 2-4 frame spike (P1-13, see `docs` in the dev notes) |
| Author-side | Node ≥ 22 on Windows/macOS/Linux; renderer vendored, no downloads |

Reader side needs only a browser; the delivered file is fully offline
(inline SVG/CSS/JS/fonts, `file://` works).

## Relationship to archify

prechify is a sister skill to archify: it **composes** archify diagrams into a
navigable presentation. This repo vendors a pinned archify rendering snapshot
(`vendor/archify/`, version + per-file hashes in `vendor/archify.lock.json`,
MIT) so every user renders with the exact same renderer. For a single
standalone diagram, use archify itself.

## License

MIT — see `LICENSE` and `THIRD_PARTY_NOTICES.md` (vendored archify snapshot,
node-html-parser, ajv, embedded JetBrains Mono).
