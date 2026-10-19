# Network play expansion

The published `main` baseline remains the original local one/two-player game. This branch begins the expansion. It does not yet expose playable network rooms or four simultaneous game characters.

## First milestone: identical frame inputs

`web/netplay/frame-sync.mjs` schedules controller masks three frames ahead by default and waits until all player inputs for a frame are available. It accepts reordered/duplicate packets, rejects conflicting inputs and packets for other sessions, bounds the future-frame queue, and prevents a peer from claiming another assigned controller slot. The transport must supply that peer's trusted slot; the packet's slot is never an authority by itself. A stalled frame is held until its input arrives. The browser renderer must not advance the emulator independently of this coordinator in network mode.

The coordinator supports 2–4 input slots as protocol groundwork. The stock emulator/game supports two ports/characters; applying four slots currently fails explicitly. No extra character is claimed or simulated.

Run `npm run test:netplay` without a ROM. For the actual emulator regression, pass your own ROM: `npm run test:netplay -- /path/to/Contra-US.nes`. This compares full state after identical scheduled inputs and exercises save/restore reproducibility. No ROM enters Git or the network.

## Next: internet transport and browser integration

1. Add Create Room / Join Link with host-assigned slots and agreement on ROM fingerprint, emulator version, and session parameters.
2. Establish encrypted WebRTC input channels using a signaling service, with configurable STUN and TURN relay support. A connection across arbitrary home/mobile networks must be tested; a successful local test alone is insufficient.
3. Feed frame records into the existing game loop. Keep local mode available. Add latency/waiting indicators and coordinated start, pause, reset, and disconnect handling.
4. Compare state checksums periodically and recover through an explicit host snapshot. Snapshot transfer must be bounded/chunked and occur while paused. The initial full JSON snapshot measured about 1.37 MB; transmitting it every frame would be inappropriate.
5. Test delayed, duplicated, disconnected, and reordered inputs, then two real networks. Consider rollback only after correctness is established.

## Four-player engine milestone

The original engine has two-element player-state arrays, two score/lives entries, two-port input reads, paired-player collision and life-transfer logic, and camera/indoor progression code that explicitly swaps between player 1 and player 2. An extra input slot or a palette swap cannot create another independent character.

The extension must allocate independent state, lives, weapons, bullets, and collisions for four players; route enemy targeting across all active players; support outdoor camera scrolling, indoor stage progression, respawning, and level endings; and render four distinguishable players. Keep player 1 blue and player 2 red; use green and gold for players 3 and 4. Sprite/palette limits and HUD placement need testing. Any game reconstruction modifications remain a separately supplied local build input unless redistribution permission is established; the public project must continue excluding game code and assets.

The verified original game mode is the regression reference. Four-player mode needs its own explicitly identified game fingerprint and compatible engine; it must not pass itself off as an unchanged Contra ROM.
