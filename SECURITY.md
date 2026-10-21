# Security review — 2026-10-19

**Result:** no malware indicators were found in the inspected build path and emulator runtime. This is a scoped source and behavior review, not an antivirus certification or a proof that every line is safe. No antivirus engine was available or run. Hashes establish identity/integrity, not the absence of malicious behavior.

## Provenance

| Component | Pinned identity |
| --- | --- |
| Annotated Contra disassembly | https://github.com/vermiceli/nes-contra-us — `687d651c021fd7020f10d05b970ccb62663c94bd` |
| cc65 | https://github.com/cc65/cc65 — V2.19, `555282497c3ecf8b313d87d5973093af19c35bd5` |
| Browser emulator | https://github.com/bfirsh/jsnes — npm `jsnes@2.1.0` |

The JSNES archive was downloaded from the official npm registry; its SHA-512 matched the registry integrity value `sha512-LUa++E5Dfs1A6ZYB5HiSOR4JrUzrZEXGLZ5Imczhu9lkg7f+94SqnLZ/MXwGa7oc02+j/xYyHR0azGQ6LCU68g==`. Archive paths and link types were checked before extraction. No npm lifecycle scripts or dependency installers were run. JSNES has no runtime npm dependencies. Its source, distributed bundle, and license are retained locally. The compiler was built from the pinned source, without installing a downloaded native binary.

The user supplied a local original Contra (US) ROM. Its original iNES header, 131,088-byte length, and SHA-512 all matched the reference in the pinned disassembly:

```
1c747c78c678f14a68d4e5fcae065298a103f833638775860f0e5c5ffaa061f62d45fd8942148b1507c1fd57fde950a5d83f9f84a9782ec048a56067740c48e9
```

The rebuilt output is byte-identical to that input. Its SHA-256 is `26541a5550ee22deeb3d5484e4a96130219b58cff74d068fb1eb6567fa5e5519`. This verifies the intended game image relative to the disassembly reference; it is not an independent authenticity certificate from Konami.

## Inspection and mitigations

Inspected the game's shell/PowerShell/VBScript build behavior, linker configuration, asset map, and assembly includes; inspected cc65's build makefiles; searched the browser sources/bundle for networking, dynamic code execution, and process execution and reviewed the runtime integration, frame timing, rendering, input, and audio modules. This was not an exhaustive manual audit of the compiler and emulator CPU instruction implementations.

The upstream game build script warns but continues after a bad ROM hash, may reuse existing assets based only on size, and has weak failure handling. We do not execute it. `scripts/build.py` checks input identity first, uses fresh temporary assets, validates extraction paths/ranges, invokes only the pinned assembler/linker with argument arrays and timeouts, and refuses to publish a mismatched output. `python3 scripts/verify.py --build` validates the pinned Git revisions and SHA-256 hashes of the selected compiler sources, game source/config/data map (with `--build`), and bundled emulator files, and rejects additional game/runtime source files. The lock is a local review snapshot, not a signed upstream attestation. The default verifier checks only the redistributable bundled runtime and does not require a game or external build checkouts. Native compiler binaries are local build outputs and are not shipped or covered by the public source-hash lock.

The NES program runs as emulated 6502 instructions; it is never executed as a native host executable. Only ca65/ld65 are native build tools. The UI uses a local core and our own local audio worklet, not the upstream browser wrapper's URL loader or blob-based worklet implementation. No telemetry, ads, remote ROM services, CDN assets, credential access, or remote scripts were added. The served player fetches only its local manifest/ROM/modules. Its HTTP headers restrict scripts, connections, and workers to the same origin, disallow framing and embedding, disable sensitive browser permissions, and prevent MIME sniffing. The server binds to `127.0.0.1`, serves the `web/` distribution, and rejects directory listing and GET paths escaping that directory.

The standalone HTML embeds everything and applies a hash-based script/style content security policy with `connect-src 'none'`. `blob:` scripts/workers are permitted for the embedded, locally defined AudioWorklet. Embedded ROM bytes are hash-checked again before loading. Direct file opening was not tested because the browser tool blocks file URLs; no browser security setting was changed.

## Verification

- Reassembly completed and exactly matched all input bytes and the reference SHA-512.
- Invalid, truncated, and same-length modified ROM inputs were rejected.
- Headless gameplay check ran 1,069 frames with valid video and finite audio samples. The game was in actual player mode (`DEMO_MODE=0`), moved player X from 48 to 72, created a bullet, and entered jump state. No emulator crash occurred. Throughput was over 1,000 emulated FPS on this machine; this is a core benchmark, not a browser rendering measurement.
- Chrome displayed roughly 60 FPS, reached the first jungle stage, and accepted keyboard controls. Pause/resume, reset, and mute/unmute were exercised. A gameplay screenshot was retained locally and is excluded from the public repository.
- Initial browser console inspection showed no application errors or CSP violations. Later logs included `MessageNotSentError` and a localization error from an installed Chrome extension; no emulator crash or page CSP failure was observed.
- Physical gamepads, mobile hardware, other browsers, and all eight levels have not been exhaustively tested.

The public source release excludes ROMs, game disassembly, extracted assets, generated ROM-containing HTML, screenshots, and the local compiler checkout. The game assets and rebuilt ROM remain local and have not been uploaded or publicly hosted. The assembly project does not include a license granting rights to Konami's game content; retaining public source availability does not establish a right to redistribute the bundled game.

## Experimental network branch

The original offline review above describes the local-play baseline. This branch deliberately adds network activity when a user creates or joins a room: same-origin room APIs, WebRTC connection metadata (including the default public STUN endpoint), and encrypted peer controller/checksum traffic. Browser ROM loading remains local. The signaling service rejects non-JSON and oversized bodies, checks known Host/Origin values, bounds room count and lifetime, limits creation, and separates host/guest capabilities. Invitations are secrets in the link fragment; request logging omits URLs and payloads. Room state exists only in process memory.

The peer protocol checks ROM/protocol identity, binds each connection to its assigned controller slot, bounds message and send-buffer sizes, and compares game-state hashes. A state mismatch or disconnect ends the session. TURN credentials configured by an operator are necessarily delivered to clients and should be short-lived. No network service or game image has been publicly deployed. The included Python HTTP server needs an operator-provided HTTPS reverse proxy and appropriate production resource limits before internet use; it is not presented as a hardened public hosting service. Cross-network browser and relay verification remains outstanding.

### Same-server relay fallback

Initial direct ICE attempts failed during the local browser-pair test despite successful offer/answer exchange. A later retry succeeded directly; the branch also adds an optional/automatic same-origin HTTP relay before gameplay begins. The relay reuses the authenticated room roles and sends only the bounded input/handshake/control/checksum protocol. It uses one streaming receive connection per player and bounded POST batches; messages are attributed by the server's credential check and queued only for the other slot. Per-peer queues are capped at 256 messages, messages at 4,096 characters, and receive batches at 32. A stalled consumer is rejected rather than silently dropping input. An HTTPS deployment encrypts this path in transit, but the operator can inspect relayed messages; it is not peer-to-peer end-to-end encryption. Multiplayer protocol messages contain neither ROMs nor full snapshots. The optional LAN ROM sharing described below is a separate HTTP download. There is no public deployment.

Local browser verification now covers both direct WebRTC and server-relay gameplay, matching checksums, shared pause/reset, and disconnect return to local mode. This does not establish cross-internet or production-server security.


The experimental squad extension contains original emulator integration and address metadata. Cartridge routines and sprites are obtained only from a locally verified ROM. Calls have bounded instruction/stack budgets and preserve the interrupted CPU context. It is experimental gameplay code, not a security boundary for arbitrary ROMs. The app still accepts only the pinned cartridge. LAN HTTP is opt-in through `--lan-address`, restricted to an exact RFC 1918 interface/Host; room credentials and inputs are unencrypted on HTTP. Use a trusted subnet or HTTPS. The pure JavaScript SHA-2 fallback is checked against Node’s implementation across padding boundaries and full cartridge-size input.

LAN/public server configurations block private `web/game/` outputs by default (including encoded-path variants). Loopback development mode can serve the locally rebuilt cartridge automatically. Explicit `--share-rom [PATH]` requires `--lan-address` and rejects `--public-origin`: it validates the exact pinned ROM before startup and exposes only `/game/contra.nes` and `/game/manifest.json`. Every reachable LAN visitor can download the shared ROM without a room invitation. No input file is copied or committed; public Git content still excludes ROMs and ROM-containing HTML.
