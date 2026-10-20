# Contra browser player

A browser player for a **user-supplied Contra (US) NES ROM**, with keyboard, touch, gamepads, sound, and experimental network co-op. This development branch includes an original three-/four-player emulator extension: extra green and gold characters have independent movement, jumping, weapons, and lives in the same level and enemy world. Original one-/two-player mode remains available.

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

## Three- and four-player squads

Choose **3-player squad** or **4-player squad** in the Players selector, then Play. Squad mode starts directly at stage 1. Blue/red are players 1/2; green/gold are players 3/4. A separate status strip shows each character’s lives and weapon. **Reset** starts a fresh squad. The original cartridge mode still uses its title menu.

| Local character | Move / aim | Fire | Jump |
| --- | --- | --- | --- |
| P1 · blue | Arrow keys | Z | X |
| P2 · red | WASD | G | H |
| P3 · green | IJKL | N | M |
| P4 · gold | Numpad 8/4/5/6 | Numpad 0 | Numpad decimal |

Up to four standard gamepads can also control a local squad. Online, each browser controls **one assigned character** with arrows/Z/X or its first gamepad. A four-player network room requires four clients; two browsers can each open two tabs for a test, though background-tab throttling may cause stalls. The room starts when every participant joins and clicks Ready. Three-/four-player rooms use the server relay.

**Experimental limits:** this is an emulator extension, not a patched four-controller NES cartridge. It invokes movement and collision routines from your verified ROM with extra player contexts, then renders their cartridge-derived sprites with green/gold clothing. The ROM remains unchanged and is never uploaded. The extra characters share the original bullet pool; heavy simultaneous fire can limit shots. Some score attribution, enemy targeting, life-transfer, and stage-transition decisions retain the cartridge’s two-player assumptions. The original HUD still has two medal/score areas; use the added status strip for extra lives. All eight stages and continues have not been validated. Use browser Reset to restart a squad after game over.

## Test on your subnet

Restart the server after updating this branch. Find the server computer’s private IPv4 address in its network settings, then run, replacing this example with that actual address:

```sh
python3 scripts/serve.py --port 8788 --lan-address 192.168.1.20
```

This binds only to that interface and allows that exact address in the room API. On **both devices**, open `http://192.168.1.20:8788` and load a ROM independently. Select **Server relay** for a two-player test; squads always use the relay. Create the room from that address so the invitation contains the LAN IP. Allow Python on your private network if the OS firewall asks. The other device needs only a browser and its own ROM, not Python or Node.js. LAN/public hosting blocks the private `web/game/` rebuild outputs; each device must choose its own ROM file, even if the server has a local rebuild. No port forwarding is needed within the subnet. HTTP LAN mode has a local hash implementation and an audio fallback, so browser security flags and certificate installation are unnecessary. Use this mode on a trusted private network; HTTP does not encrypt room traffic. Use HTTPS for internet hosting.

## Experimental online co-op

1. All players open the app at the **same server address** and load their own original US ROM.
2. Player 1 clicks **Create room**, then **Copy invitation** and sends the link to the other participants.
3. Each invited player opens that link, loads their ROM, and clicks **Join invitation**.
4. Once everyone connects, all click **Ready**. The app starts a fresh game at stage 1 with the selected player count. Everyone uses arrows/Z/X (or their first connected gamepad) for their assigned character.

The room panel shows round-trip latency and the selected transport; below it, periodic matching game-state checksums confirm synchronization. Pause/resume and reset are scheduled at matching simulation frames. Leaving/disconnecting ends the network session and returns to local play. A checksum mismatch stops the session; create a new room to restart. Seamless reconnect and rollback are not implemented.

For a same-computer check, select **Server relay** and open two browser windows at http://127.0.0.1:8787 and follow the steps above. Localhost invitation links only work on that computer. Keep the game windows visible for reliable timing; background throttling can stall buffered synchronization.

**Internet play needs a reachable HTTPS server** running this branch. Automatic mode first tries a direct WebRTC connection, then uses the same server as a relay if that fails before gameplay starts. You can select **Server relay** before creating/joining a room to skip the direct attempt; this works over ordinary HTTPS without a separate TURN service. There is no hosted service provided by this repository. The included Python server is a development/reference server; an internet operator must supply TLS, appropriate reverse-proxy request/concurrency limits, and enough bandwidth for relayed sessions. An optional TURN service can also relay the WebRTC path. Use `--public-origin https://your-host.example` to allow your exact external origin. The default remains loopback-only.

The default ICE configuration uses Google's public STUN endpoint (`stun:stun.l.google.com:19302`) when creating/joining a room. STUN exchanges connection metadata, not game content. To use your own STUN/TURN service, configure the server's `CONTRA_ICE_SERVERS` environment variable as a JSON array of WebRTC `RTCIceServer` objects. For example, replace these placeholders with your service's values:

```sh
CONTRA_ICE_SERVERS='[{"urls":"stun:relay.example:3478"},{"urls":"turns:relay.example:5349","username":"temporary-user","credential":"temporary-password"}]' \
  python3 scripts/serve.py --port 8787 --public-origin https://your-host.example
```

Relay credentials are supplied to participating browsers; use limited-lifetime credentials and do not commit secrets. The reverse proxy must forward the `Host`, `Origin`, and `Authorization` headers and must not cache `/api/` responses. Disable response buffering for `/api/rooms/*/events`, which streams relay messages. The reference server uses HTTP/1.1, persistent POST connections, and a chunked receive stream; it is intended for small trusted tests, not unrestricted public traffic. To avoid contacting a public STUN service for local testing, set `CONTRA_ICE_SERVERS='[]'` before starting the server. Connection setup times out after three minutes; invitations admit the selected number of guests and room records expire after 30 minutes without signaling activity.

Game simulation and rendering run in each browser. The server handles temporary room credentials and connection descriptions. In direct mode, controller inputs and state checksums travel over the encrypted WebRTC channel; in server-relay mode, the same small messages pass through the app server over HTTPS. The server operator can see relayed inputs/checksums, so use a server you trust. No ROM is sent to the server or the other player. Both direct WebRTC and same-server relay were verified between two local Chrome tabs at about 60 FPS, with matching state checksums and coordinated pause/reset. Two separate internet connections have not yet been tested. See [the network implementation notes](docs/NETPLAY.md) for test coverage and remaining work.

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
npm run test:netplay        # Frame coordinator tests; no ROM needed
npm run test:rooms          # Signaling API/client tests; no ROM needed
npm run test:session -- /path/to/Contra-US.nes # Actual two-player game + lag/pause/reset
npm run test:four-player -- /path/to/Contra-US.nes # Extra characters + four-peer lag/pause/reset
```

`npm run verify` and `npm test` are equivalent shortcuts when npm is installed. If you only load a ROM through the browser, you can skip the rebuild and headless test.

The headless check exercised 1,069 frames of actual player mode, movement, shooting, jumping, video, and audio. Chrome gameplay ran at approximately 60 FPS; pause/resume, reset, and mute were checked. All eight stages, mobile hardware, and physical gamepads have not been exhaustively tested. See [SECURITY.md](SECURITY.md) for review scope and limitations.

The original mode runs as emulated 6502 instructions. Squad mode adds independent player contexts around cartridge routines without distributing game instructions or assets. Browser optimizations include reused pixel memory, native-resolution rendering, transferable audio batches, a bounded AudioWorklet buffer, limited frame catch-up, and pause on focus loss.
