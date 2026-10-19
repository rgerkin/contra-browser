# Contra browser player

A local browser player and reproducible rebuild workflow for a **user-supplied Contra (US) NES ROM**. Includes keyboard, touch, and two local gamepad controller ports, audio, pause/resume, reset, and fullscreen. Internet multiplayer is not implemented in this initial version.

**No ROM, game disassembly, graphics, audio, or ROM-containing HTML is distributed in this repository.** Our tooling/UI is MIT-licensed; the bundled [JSNES emulator](https://github.com/bfirsh/jsnes) retains its Apache 2.0 license. See [third-party notices](THIRD_PARTY_NOTICES.md).

## What to download and install

To play an existing ROM, you need:

| Item | Where to get it / what it is for |
| --- | --- |
| A current browser | Chrome, Edge, or Firefox. Chrome was used for testing. No browser extension or separate NES emulator is required. |
| Python | Install a supported Python 3 release from [python.org](https://www.python.org/downloads/); Python 3.11+ is recommended. The server uses only Python's standard library (technical minimum: 3.9). On Windows, enable the installer option to add Python to PATH if offered, or use the `py` launcher. |
| This repository | Clone it with [Git](https://git-scm.com/downloads/), or use GitHub's **Code → Download ZIP** and extract it. Git is optional when using the ZIP. |
| Your own Contra (US) ROM | An original **131,088-byte `.nes` file**, including its original iNES header, that you are authorized to use. Other regions, ROM hacks, ZIP archives, or files with altered headers will fail verification. No ROM or ROM-download service is provided here. |

[Node.js/npm](https://nodejs.org/en/download) is **optional for normal play**. Install a current LTS release if you want the `npm` shortcuts or the headless gameplay test; Node.js 22+ is recommended. The Node.js installer includes npm. JSNES is already bundled, so **do not run `npm install` or `pip install` for this version**: there are no package dependencies to install.

Check your installation in a terminal:

```sh
python3 --version   # macOS / Linux; Python 3.9 or newer
# Windows: py -3 --version
git --version       # Only if cloning
node --version      # Only if using npm shortcuts or tests
npm --version       # Only if using npm shortcuts
```

## Play locally

With Git installed:

```sh
git clone https://github.com/rgerkin/contra-browser.git
cd contra-browser
python3 scripts/serve.py
```

If you downloaded the ZIP, open a terminal in its extracted folder and run the last command. On Windows, use `py -3 scripts/serve.py` instead. If you installed Node.js/npm and `python3` is available, `npm start` runs the same server.

Open **http://127.0.0.1:8787**, choose **Load original US ROM**, select a game image you are authorized to use, then click Play. The player checks the original 131,088-byte US iNES image against its expected SHA-512. The file stays in browser memory and is not uploaded.

Arrow keys move/aim, **Z** fires, **X** jumps, **Enter** starts or pauses in-game, **Shift** selects 1/2 players. Press Enter again if the first press skips the opening animation. **P** pauses the browser player. Player 2 keyboard: WASD, G fire, H jump, T start, R select. Touch controls appear on small screens. Standard USB/Bluetooth gamepads are supported; physical controllers have not been tested.

The server binds only to loopback and serves `web/`. Stop with Ctrl+C. Keep that terminal running while playing. If port 8787 is busy, run `python3 scripts/serve.py --port 8788` and open http://127.0.0.1:8788 instead (use `py -3` on Windows).

## Optional: reassemble from separately obtained source

Rebuilding is optional: **loading your own ROM in the player does not need any of the tools below**. The rebuild workflow additionally needs Git, a C compiler, GNU Make, and the two external source checkouts. On macOS, Apple's Command Line Tools provide a compiler and Make (`xcode-select --install`). On Debian/Ubuntu, the `build-essential` package provides the compiler and Make. For the documented rebuild commands on Windows, use WSL with Git, Python 3, and a C/Make toolchain; Windows-only builds have not been tested. See the [cc65 project's build information](https://github.com/cc65/cc65).

The [annotated reconstruction](https://github.com/vermiceli/nes-contra-us) has no license file at the pinned revision. It is intentionally excluded from this repository. If you are authorized to obtain and use it, place a checkout at `vendor/nes-contra-us` at commit `687d651c021fd7020f10d05b970ccb62663c94bd`.

Obtain [cc65](https://github.com/cc65/cc65) separately at `vendor/cc65`, commit `555282497c3ecf8b313d87d5973093af19c35bd5` (V2.19), then build its assembler/linker. From this repository's root, a reproducible setup is:

```sh
mkdir -p vendor
# Only obtain the unlicensed reconstruction if you are authorized to use it.
git clone https://github.com/vermiceli/nes-contra-us.git vendor/nes-contra-us
git -C vendor/nes-contra-us checkout 687d651c021fd7020f10d05b970ccb62663c94bd
git clone https://github.com/cc65/cc65.git vendor/cc65
git -C vendor/cc65 checkout 555282497c3ecf8b313d87d5973093af19c35bd5
make -C vendor/cc65 -j4 ca65 ld65
python3 scripts/build.py /path/to/Contra-US.nes
```

Replace `/path/to/Contra-US.nes` with your actual ROM path; put paths containing spaces in quotes. With Node.js/npm installed, `npm run build -- /path/to/Contra-US.nes` is an equivalent shortcut. The build invokes `python3`, so ensure that command is available in your shell.

The build verifies the pinned upstream source file hashes, extracts fresh assets into a temporary directory, and invokes ca65/ld65 directly. It publishes local output only if the rebuilt ROM is byte-for-byte identical to the original. It also generates `Contra.html`, a self-contained offline player with embedded game content. **That file is private build output and is ignored by Git.** Direct file opening was not tested by browser automation; the served player was tested in Chrome.

Builds are ignored under `web/game/`, `build/`, `output/`, and `vendor/`. The original input ROM is never required inside the repository.

## Verify

```sh
python3 scripts/verify.py    # Bundled emulator source/bundle hashes; no game needed
python3 scripts/verify.py --build  # Also verify optional external build sources
node scripts/check-game.mjs # Requires Node.js and a locally rebuilt ROM
```

`npm run verify` and `npm test` are equivalent shortcuts when npm is installed. If you only load a ROM through the browser, you can skip the rebuild and headless test.

The headless check exercised 1,069 frames of actual player mode, movement, shooting, jumping, video, and audio. Chrome gameplay ran at approximately 60 FPS; pause/resume, reset, and mute were checked. All eight stages, mobile hardware, and physical gamepads have not been exhaustively tested. See [SECURITY.md](SECURITY.md) for review scope and limitations.

The game runs as emulated 6502 instructions using its original two-player engine. Browser optimizations include reused pixel memory, native-resolution rendering, transferable audio batches, a bounded AudioWorklet buffer, limited frame catch-up, and pause on focus loss.
