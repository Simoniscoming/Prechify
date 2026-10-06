---
name: prechify
description: >-
  Create or edit a Prezi-style zoomable architecture presentation with drill-down
  between architecture, workflow, and sequence diagrams, delivered as one offline
  HTML file. Use for a zoomable deck, layered architecture walkthrough, 可穿透的架构演示,
  下潜演示, or 架构图逐层展开. Use archify for a single independent diagram; use a
  presentation skill for ordinary slide decks.
license: MIT
metadata:
  version: "0.1.0"
---

# Prechify

Create a small, navigable tree of diagrams as a single offline HTML file. The
bundled vendored renderer is used by default — prechify is a sister skill to
archify and includes a pinned archify rendering subset; a separate archify
installation is optional.

## When to use

Use for linked, zoomable layers rather than a sequence of slides. For a
repository walkthrough, inspect source evidence before describing actual
behavior; for a fictional example, say that it is fictional. A single
standalone diagram belongs to archify.

## Workflow

1. Run `node <skill-dir>/bin/prechify.mjs doctor --json`. Resolve required
   failures from its diagnostics. The default authoring workflow needs Node
   (≥22) and the bundled files only; it does not download a renderer, fonts,
   or a browser.
2. Choose a root, short layer titles, and explicit drill hosts. Start with at
   most six layers, a tree (one parent per child), max depth three including
   the root. Read `src/schema/deck-v2.schema.json` and the bundled example
   under `examples/demo/`.
3. Write `deck.json` (manifest v2) and layer specs into the user's chosen
   workspace. Spec paths are relative to the manifest directory; IDs are
   stable (`^[A-Za-z][A-Za-z0-9_-]{0,63}$`); sequence first segments should
   start at `from ≥ 172` (renderer quirk: lower values hide the first segment
   label behind participant headers — `validate` warns).
4. Run `node <skill-dir>/bin/prechify.mjs validate <deck> --json` and fix
   errors; assess warnings. Deliver with
   `node <skill-dir>/bin/prechify.mjs deliver <deck> --out <html> --json`.
   Deliver re-renders every layer from specs — there is no stale-output mode.
   After any spec edit, deliver again; never hand-edit generated HTML.
5. Inspect the delivered HTML by opening it, or
   `node <skill-dir>/bin/prechify.mjs preview <html>` (random localhost port).
   Exercise each drill, sibling branches, Esc, breadcrumbs, hash links, both
   themes, and keyboard focus. If a browser-based `visual-check` is
   unavailable, record that limitation — static validation alone is not
   visual acceptance.
6. Hand over the HTML path, its SHA-256 (in the deliver receipt), and any
   unresolved warnings or acceptance limitations. State the browser/OS scope
   actually verified; do not claim tests that were not run.

## Authoring contract

- Three diagram types: `architecture`, `workflow`, `sequence`. Default preset:
  classic. Every layer spec must pass the vendored renderer's showcase
  validation (deliver fails otherwise).
- No cycles, shared children, or dangling drill targets. Every layer is
  reachable from the root; the root may have any valid layer ID.
- Drill `node` values must exist as `data-node-id` in the rendered parent
  layer (components / workflow nodes / sequence participants all qualify).
- Titles and labels are text; preserve user wording. Over-length labels are
  warnings; browser geometry decides placement (labels auto-avoid text
  collisions at build time).
- Write artifacts in the user's workspace, never inside the installed skill.
  Preserve existing output unless overwrite is explicit.
- For v1 manifests (legacy `rendered` fields), migrate with
  `scripts/migrate-v1-deck.mjs <deck> --base-dir <old-root>`.

## Limits (v0.1)

- Desktop mouse + keyboard. Touch/pinch is not supported in v0.1.
- Browser acceptance (Windows / Intel Iris Xe; 24 scenarios × 3 passes =
  72 assertions per engine, 3 engines): **Chrome stable passed everything**
  including smoothness
  (flight p95 ≤17ms). **Firefox and WebKit passed every functional scenario
  with zero console errors** (keyboard, focus and theme fallbacks verified),
  but flights run below Chrome's smoothness bar — Firefox deep dives p95
  ~31-37ms, WebKit ~30-40ms/frame. Real-device Safari is not yet verified.
  State these numbers when users ask about non-Chromium browsers; do not
  promise "equally smooth everywhere".
- System CJK font fallback: glyph appearance and measured label positions can
  differ across Windows/macOS/Linux. Labels re-measure on font-swap; when no
  collision-free slot exists the page exposes
  `data-pch-label-warnings` and logs a console warning — report it rather
  than hiding it.
- Cold first flight after page load can drop a single ~45-65ms frame; cold
  root-exit after deep dives keeps the registered 2-4 frame spike (P1-13).
  Frame rates vary by hardware/GPU.
- Use `--archify <bin/archify.mjs>` only for deliberate compatibility
  investigations; the override must pass the adapter contract probe recorded
  in the receipt. Do not silently fall back after an explicit override.
