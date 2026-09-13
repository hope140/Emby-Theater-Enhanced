# Third-party notices

This file records the known third-party boundary for the first public-source
baseline. It is not a claim that every excluded artifact is licensed for
redistribution.

## Upstream Emby Theater code

Maintained Electron and Windows-host material is derived from the public
MediaBrowser Emby Theater repositories. The maintained project is licensed as
GPL-2.0-only; see `LICENSE` and `docs/LICENSING.md`. Preserve upstream notices
when importing or changing identifiable upstream files.

## Development tooling

- `node-unrar-js` 2.0.2 is a development dependency, locked in
  `package-lock.json`; its own license remains with the dependency when
  installed.
- Inno Setup and InnoUnp are local build/test tools. Their version, source, and
  hash records are in `vendor/toolchain-manifest.json`; neither tool nor its
  output is part of this public baseline.

## Excluded runtime and assets

Electron/Chromium runtime files, mpv/libmpv bridge files, native binaries,
fonts, shaders, Carnival inputs, patch inputs, and the offline Web snapshot are
excluded unless their individual provenance and redistribution terms have been
verified. The classification and known hashes are documented in
`docs/CARNIVAL_BASELINE.md` and `vendor/runtime-manifest.json`.
