# Third-party notices and excluded game content

The MIT license in this repository applies to the original browser UI, integration, scripts, and documentation authored for this project. It does not relicense third-party software or grant rights to Contra.

## Included: JSNES 2.1.0

JSNES is an NES emulator by Ben Firshman and contributors, distributed under Apache License 2.0. Its unmodified source and compiled bundle are included at `web/vendor/jsnes/`. The full upstream license is retained at `web/vendor/jsnes/LICENSE`; version metadata is in `web/vendor/jsnes/package.json`. Upstream: https://github.com/bfirsh/jsnes. Registry archive integrity is recorded in `sources.lock.json`. The npm archive contains no separate NOTICE file. We have not modified the included JSNES files.

## Excluded: Contra and its annotated disassembly

Contra game code, ROM images, extracted graphics/audio, screenshots, sprites, the generated standalone HTML containing a ROM, and save states are not included in the Git repository. Contra names and marks identify the game and do not imply affiliation or endorsement by Konami.

The annotated reconstruction is available separately at https://github.com/vermiceli/nes-contra-us. No license file was present at the pinned revision. This repository therefore links to that upstream project without redistributing its contents or claiming a license to them. File hashes, revision identifiers, ROM fingerprints, and interoperability references are metadata, not a bundled copy of the game.

## Optional local toolchain: cc65

The build instructions reference cc65 V2.19 at https://github.com/cc65/cc65, under its upstream zlib-style license. Neither its source nor native binaries are redistributed here. Obtain and retain upstream licensing when using it separately.

Users must supply a game image and separately obtain any reconstruction sources they are authorized to use. The browser file chooser reads the selected ROM locally; it does not upload it. Generated ROMs, extracted assets, and ROM-containing standalone packages must remain outside this public repository. A local rebuild does not grant redistribution rights.
