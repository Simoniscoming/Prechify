# Third-party notices

prechify bundles or depends on the following third-party software:

## archify (vendored)

- **What**: a vendored snapshot of the archify diagram renderers, used to
  render every deck layer at deliver time. Lives in `vendor/archify/`.
- **Version**: 2.17.0-dev.1 (local snapshot; provenance and per-file hashes in
  `vendor/archify.lock.json`). Upstream: https://github.com/tt-a1i/archify
- **License**: MIT — see `vendor/archify/LICENSE`. Its own notices are
  preserved in `vendor/archify/THIRD_PARTY_NOTICES.md`.
- The vendored tree is a rendering closure only (bin/renderers/scripts/assets/
  schemas/brand-marks/delta/migrations); upstream examples and skill docs are
  intentionally not redistributed.

## node-html-parser (npm dependency)

- **What**: HTML parsing for fragment extraction and id namespacing.
- **License**: MIT — https://github.com/taoqf/node-html-parser

## ajv (npm dependency)

- **What**: JSON Schema (draft 2020-12) validation for deck manifests.
- **License**: MIT — https://github.com/ajv-validator/ajv

## Fonts

- JetBrains Mono (OFL 1.1), embedded by archify inside rendered layers;
  license text preserved at `vendor/archify/assets/JetBrainsMono-OFL.txt`.
- CJK text relies on operating-system font fallback and ships no font files;
  glyph appearance can differ across platforms.
