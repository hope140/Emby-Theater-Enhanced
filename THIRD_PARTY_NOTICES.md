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

## CloudDrive2 resolver runtime dependencies

- `@grpc/grpc-js` 1.14.4 and `@grpc/proto-loader` 0.8.1 are exact runtime
  dependencies, locked with their pure-JavaScript dependency closure in
  `package-lock.json`. Both packages are Apache-2.0 licensed; their installed
  package notices and license files are copied unchanged into a local runtime.
- `src/electronapp/enhanced/proto/clouddrive-v1.proto` is a minimal
  wire-compatible subset of CloudDrive2 API schema 1.0.13. Its field numbers
  were taken from the Apache-2.0 `hope140/embyToLocalPlayer` beta snapshot
  `54b2abae0537f1b4c65752edaac059d3cda4790e`; the official CloudDrive2 1.0.14
  download was checked and the V1 fields were unchanged.

## Excluded runtime and assets

Electron/Chromium runtime files, mpv/libmpv bridge files, native binaries,
fonts, shaders, Carnival inputs, patch inputs, and the offline Web snapshot are
excluded unless their individual provenance and redistribution terms have been
verified. The classification and known hashes are documented in
`docs/CARNIVAL_BASELINE.md` and `vendor/runtime-manifest.json`.
