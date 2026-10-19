# Contra browser player

A local browser player and reproducible rebuild workflow for a **user-supplied Contra (US) NES ROM**. Includes keyboard, touch, and two local gamepad controller ports, audio, pause/resume, reset, and fullscreen. Internet multiplayer is not implemented in this initial version.

**No ROM, game disassembly, graphics, audio, or ROM-containing HTML is distributed in this repository.** Our tooling/UI is MIT-licensed; the bundled [JSNES emulator](https://github.com/bfirsh/jsnes) retains its Apache 2.0 license. See [third-party notices](THIRD_PARTY_NOTICES.md).

## Play locally

Requires Python 3.9+; npm scripts additionally require Node.js/npm. No dependency installation is necessary.

```sh
git clone https://github.com/rgerkin/contra-browser.git
cd contra-browser
npm start
```

Open **http://127.0.0.1:8787**, choose **Load original US ROM**, select a game image you are authorized to use, then click Play. The player checks the original 131,088-byte US iNES image against its expected SHA-512. The file stays in browser memory and is not uploaded.

Arrow keys move/aim, **Z** fires, **X** jumps, **Enter** starts or pauses in-game, **Shift** selects 1/2 players. Press Enter again if the first press skips the opening animation. **P** pauses the browser player. Player 2 keyboard: WASD, G fire, H jump, T start, R select. Touch controls appear on small screens. Standard USB/Bluetooth gamepads are supported; physical controllers have not been tested.

The server binds only to loopback and serves `web/`. Stop with Ctrl+C. Alternatively run `python3 scripts/serve.py` directly.

## Optional: reassemble from separately obtained source

The [annotated reconstruction](https://github.com/vermiceli/nes-contra-us) has no license file at the pinned revision. It is intentionally excluded from this repository. If you are authorized to obtain and use it, place a checkout at `vendor/nes-contra-us` at commit `687d651c021fd7020f10d05b970ccb62663c94bd`.

Obtain [cc65](https://github.com/cc65/cc65) separately at `vendor/cc65`, commit `555282497c3ecf8b313d87d5973093af19c35bd5` (V2.19), then build its assembler/linker:

```sh
make -C vendor/cc65 -j4 ca65 ld65
npm run build -- /path/to/Contra-US.nes
```

The build verifies the pinned upstream source file hashes, extracts fresh assets into a temporary directory, and invokes ca65/ld65 directly. It publishes local output only if the rebuilt ROM is byte-for-byte identical to the original. It also generates `Contra.html`, a self-contained offline player with embedded game content. **That file is private build output and is ignored by Git.** Direct file opening was not tested by browser automation; the served player was tested in Chrome.

Builds are ignored under `web/game/`, `build/`, `output/`, and `vendor/`. The original input ROM is never required inside the repository.

## Verify

```sh
npm run verify              # Bundled emulator source/bundle hashes; no game needed
python3 scripts/verify.py --build  # Also verify optional external build sources
npm test                    # Gameplay regression; requires a locally rebuilt ROM
```

The headless check exercised 1,069 frames of actual player mode, movement, shooting, jumping, video, and audio. Chrome gameplay ran at approximately 60 FPS; pause/resume, reset, and mute were checked. All eight stages, mobile hardware, and physical gamepads have not been exhaustively tested. See [SECURITY.md](SECURITY.md) for review scope and limitations.

The game runs as emulated 6502 instructions using its original two-player engine. Browser optimizations include reused pixel memory, native-resolution rendering, transferable audio batches, a bounded AudioWorklet buffer, limited frame catch-up, and pause on focus loss.
