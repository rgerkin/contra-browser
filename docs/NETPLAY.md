# Network play expansion

The published `main` baseline remains the original local one/two-player game. This development branch adds experimental two-player room signaling, WebRTC transport, a streaming HTTP relay fallback, and browser integration. It has not yet been verified across two real internet connections. Four simultaneous game characters remain a separate engine milestone.

## Implemented

- `frame-sync.mjs` schedules controller masks four frames ahead in room mode (about 67 ms at 60 FPS), waits for all inputs, accepts reordered/duplicate input packets, bounds the queue, and rejects slot spoofing and conflicting input.
- `game-session.mjs` owns simulation time, starts an actual two-player game deterministically, coordinates host-authorized pause/resume/reset at future frame boundaries, and compares full-state SHA-256 checksums every 120 frames. New-epoch messages arriving during a reset are buffered. Rendering/audio do not advance game time themselves.
- `relay.mjs` adapts the same protocol to authenticated same-origin HTTP/1.1: bounded POST batches send input, while a chunked receive stream delivers ordered messages from the assigned partner. It works through ordinary HTTPS, so TURN is optional. Direct-mode ICE failure before gameplay requests a coordinated switch to this relay; switching transports during an active mission ends the room and requires a fresh session.
- `room.mjs` exchanges WebRTC offers/answers through same-origin HTTP signaling and establishes a reliable ordered encrypted data channel. The handshake checks game fingerprint, protocol/emulator identity, assigned role, and buffer delay. Both users click Ready before starting. It includes latency pings, bounded messages, congestion checks, and disconnect handling.
- `scripts/rooms.py` and `serve.py` provide bounded, expiring, in-memory room metadata with independent host/guest credentials and single-claim invitations. The API limits body/SDP sizes and room creation, checks Host/Origin, and omits request/credential details from logs. The app never uploads ROMs or full game states. Relay queues are bounded, messages are delivered only to the other authenticated slot, and each player can open one receive stream. It is a reference/development server, not a production deployment platform.
- The browser keeps local mode available. In network mode, each player's primary keyboard/gamepad controls only their assigned slot; the stock engine provides two independent characters. The standalone HTML remains local-only and hides room controls.

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
- The coordinator can represent four input slots as groundwork. Applying four slots to the stock two-port engine fails explicitly; this is not four-player gameplay.

## Four-player engine milestone

The original engine has two-element player-state arrays, two score/lives entries, two-port input reads, paired-player collision and life-transfer logic, and camera/indoor progression code that explicitly swaps between player 1 and player 2. An extra input slot or a palette swap cannot create another independent character.

The extension must allocate independent state, lives, weapons, bullets, and collisions for four players; route enemy targeting across all active players; support outdoor camera scrolling, indoor stage progression, respawning, and level endings; and render four distinguishable players. Keep player 1 blue and player 2 red; use green and gold for players 3 and 4. Sprite/palette limits and HUD placement need testing. Any game reconstruction modifications remain a separately supplied local build input unless redistribution permission is established; the public project must continue excluding game code and assets.

The verified original game mode is the regression reference. Four-player mode needs its own explicitly identified game fingerprint and compatible engine; it must not pass itself off as an unchanged Contra ROM.
