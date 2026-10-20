# Network play expansion

The published `main` baseline remains the original local one/two-player game. This development branch adds experimental two-player room signaling, WebRTC transport, a streaming HTTP relay fallback, and browser integration. It has not yet been verified across two real internet connections. This branch also includes the experimental squad extension described below.

## Implemented

- `frame-sync.mjs` schedules controller masks four frames ahead in room mode (about 67 ms at 60 FPS), waits for all inputs, accepts reordered/duplicate input packets, bounds the queue, and rejects slot spoofing and conflicting input.
- `game-session.mjs` owns simulation time, starts an actual two-player game deterministically, coordinates host-authorized pause/resume/reset at future frame boundaries, and compares full-state SHA-256 checksums every 120 frames. New-epoch messages arriving during a reset are buffered. Rendering/audio do not advance game time themselves.
- `relay.mjs` adapts the same protocol to authenticated same-origin HTTP/1.1: bounded POST batches send input, while a chunked receive stream delivers ordered messages from the assigned partner. It works through ordinary HTTPS, so TURN is optional. Direct-mode ICE failure before gameplay requests a coordinated switch to this relay; switching transports during an active mission ends the room and requires a fresh session.
- `room.mjs` exchanges WebRTC offers/answers through same-origin HTTP signaling and establishes a reliable ordered encrypted data channel. The handshake checks game fingerprint, protocol/emulator identity, assigned role, and buffer delay. Both users click Ready before starting. It includes latency pings, bounded messages, congestion checks, and disconnect handling.
- `scripts/rooms.py` and `serve.py` provide bounded, expiring, in-memory room metadata with independent per-player credentials and bounded invitation claims. The API limits body/SDP sizes and room creation, checks Host/Origin, and omits request/credential details from logs. The app never uploads ROMs or full game states. Relay queues are bounded, messages are delivered only to the other authenticated room slots, and each player can open one receive stream. It is a reference/development server, not a production deployment platform.
- The browser keeps local mode available. In network mode, each player's primary keyboard/gamepad controls only their assigned slot; the selected game mode supplies two, three or four independent characters. The standalone HTML remains local-only and hides room controls.

## Tests

`npm run test:netplay` tests masks, duplication/reordering, stalls, sender binding, and invalid packets without a ROM. Passing a local ROM additionally checks actual emulator state equality. `npm run test:rooms` exercises room access, expiration, claim limits, HTTP validation/rate limits, client readiness, handshake mismatches, invalid controls, and message limits without sockets or game content.

`npm run test:session -- /path/to/Contra-US.nes` runs the actual two-player game with delayed packet delivery and unequal peer cadence, then verifies coordinated pause, guest-requested resume, a reset while peers are at different frames, matching post-reset checksums, and identical final emulator state. The original gameplay test remains available. No copyrighted content is included in any fixture.

Browser-to-browser tests and cross-network connectivity are tracked separately from these simulations. Successful deterministic simulation alone does not establish that a user's routers will support a direct WebRTC connection.

## Live browser verification

On 2026-10-19, two Chrome tabs on the same computer established a server-relay room, started two-player gameplay, and reported matching game-state checksums through at least frame 3,360 after reset. Host pause, guest pause/resume, reset during play, and reset while paused were exercised. Steady playback was about 60 FPS. A second pair successfully used direct WebRTC and matched checksums through frame 1,200; leaving restored local play on both sides. Initial direct ICE attempts had failed, which motivated the relay fallback. The adapter test also exercises automatic migration after a simulated ICE failure.

This verifies the two transport paths locally, not across two separate internet connections. Screenshots and ROM-containing outputs remain local and ignored by Git.

## Remaining work and limits

- Test two actual internet connections with both direct and same-server relayed transport; optional TURN can be tested separately.
- There is no public hosted signaling/relay service. Internet operators must provide a reachable HTTPS origin, appropriate production request/concurrency controls, streaming support, and sufficient relay bandwidth. TURN credentials are optional. No deployment has been made.
- This is buffered lockstep; there is no rollback. Slow or background-throttled peers can stall both players. There is no seamless reconnect; create a new room after a disconnect or state mismatch.
- Checksums detect state divergence and terminate the room. Automatic host-snapshot recovery is not implemented. The measured JSON state is about 1.37 MB, so recovery would require a bounded/chunked transfer while paused, not a per-frame full-state broadcast.
- The original two-port engine rejects extra slots; the explicitly selected squad extension accepts three or four independent characters.

## Implemented squad extension (experimental)

`web/gameplay/four-player.mjs` adds one or two independent player contexts to the verified US cartridge. It hooks known routine boundaries in JSNES, executes extra cartridge subroutines with video/audio time held constant, and restores the interrupted CPU registers, stack, scratch memory, and ROM bank. World RAM and enemy state remain shared. Extra bullet ownership tracks weapon-dependent updates. Extra sprites are decoded by the cartridge and composited using its tiles, skin colors, flips, and background priority; clothing is green/gold. The extension contains original integration code and address facts, not copied instructions or sprite data. Its instruction and stack budgets stop runaway subroutine calls.

The complete extra-player state participates in checksums. Squad fingerprints include an extension version and player count. `GameSession` waits for every input and verifies a checksum from every other player. Reset rebuilds all contexts and advances the epoch. The existing two-player WebRTC path is retained; three-/four-player rooms broadcast authenticated relay messages with bounded per-player queues and wait for every player’s handshake/readiness.

`--lan-address` binds one RFC 1918 IPv4 interface and explicitly allows its Host header. Browser-side SHA-256/SHA-512 fallback retains ROM and state verification on ordinary LAN HTTP; ScriptProcessor supplies audio when AudioWorklet is unavailable. HTTP remains unencrypted and is intended for trusted subnet tests. Internet deployments still need HTTPS.

Validation: actual ROM tests cover separate movement, jumping, firing, weapon state, death/life decrement, disposal back to the original engine, and four clients with delayed/reordered input through coordinated pause/resume/reset and matching checksums. The stream-client test covers all-ready startup and authenticated sender delivery to three other clients. Store tests cover room capacity, no-echo broadcast, invalid player counts and atomic queue backpressure. Local Chrome squad rendering was observed near 60 FPS. Cross-device subnet play and a full eight-stage squad run remain manual tests.

Known limits: original bullet capacity is shared. Some score attribution, enemy targeting, life-transfer, stage transitions and continues still assume two cartridge slots. Extra characters are experimental; they are not a claim of a completely rewritten four-player cartridge. The browser status strip supplies their independent lives/weapon information. Four network clients are required for four network characters.
