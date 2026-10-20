// MIT License — Copyright (c) 2026 Rick Gerkin.
// Transport-independent lockstep for the original engine and squad extension.
const VERSION = 1;

function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`Invalid ${label}`);
  }
  return value;
}

export class FrameSync {
  constructor({session, players = 2, localPlayer, delay = 3, maxFutureFrames = 120}) {
    if (typeof session !== 'string' || !session.length || session.length > 128) {
      throw new TypeError('A session identifier is required');
    }
    this.players = integer(players, 2, 4, 'player count');
    this.localPlayer = integer(localPlayer, 1, players, 'local player');
    this.delay = integer(delay, 0, 12, 'input delay');
    this.maxFutureFrames = integer(maxFutureFrames, Math.max(delay, 1), 600, 'input horizon');
    this.session = session;
    this.frame = 0;
    this.paused = false;
    this.pending = new Map();
    // Both sides begin from the same emulator reset. The delay's initial frames
    // are neutral, so startup doesn't require sending fabricated remote input.
    for (let frame = 0; frame < delay; frame++) {
      this.pending.set(frame, new Map(Array.from({length: players}, (_, i) => [i + 1, 0])));
    }
  }

  // Schedule once per simulation frame, before trying to consume it. Repeating
  // this while waiting retransmits exactly the original input for that frame.
  schedule(mask) {
    integer(mask, 0, 255, 'controller mask');
    const frame = this.frame + this.delay;
    const saved = this.pending.get(frame)?.get(this.localPlayer);
    const packet = {version: VERSION, kind: 'input', session: this.session,
      frame, player: this.localPlayer, mask: saved ?? mask};
    this.receive(packet, this.localPlayer);
    return packet;
  }

  // The transport must bind senderPlayer to the authenticated peer connection;
  // it must never take senderPlayer from the incoming packet itself.
  receive(packet, senderPlayer) {
    integer(senderPlayer, 1, this.players, 'sender');
    if (!packet || packet.version !== VERSION || packet.kind !== 'input' || packet.session !== this.session) {
      throw new TypeError('Invalid input packet or session');
    }
    integer(packet.player, 1, this.players, 'packet player');
    integer(packet.frame, 0, Number.MAX_SAFE_INTEGER, 'frame');
    integer(packet.mask, 0, 255, 'controller mask');
    if (packet.player !== senderPlayer) throw new Error('Peer cannot control another player');
    if (packet.frame < this.frame) return false; // Old retransmission; never rewind.
    if (packet.frame - this.frame > this.maxFutureFrames) throw new RangeError('Input too far ahead');
    const inputs = this.pending.get(packet.frame) ?? new Map();
    const previous = inputs.get(packet.player);
    if (previous !== undefined && previous !== packet.mask) throw new Error('Conflicting input for a committed frame');
    inputs.set(packet.player, packet.mask);
    this.pending.set(packet.frame, inputs);
    return previous === undefined;
  }

  get missingPlayers() {
    const inputs = this.pending.get(this.frame);
    return Array.from({length: this.players}, (_, i) => i + 1).filter(player => !inputs?.has(player));
  }

  // The caller runs exactly one nes.frame() per returned record. A missing
  // record means wait for the peer: never guess inputs or advance on wall time.
  takeFrame() {
    if (this.paused || this.missingPlayers.length) return null;
    const inputs = this.pending.get(this.frame);
    const record = Object.freeze({frame: this.frame,
      inputs: Object.freeze(Array.from({length: this.players}, (_, i) => inputs.get(i + 1)))});
    this.pending.delete(this.frame);
    this.frame++;
    return record;
  }
}

export function applyInputs(nes, inputs) {
  if(nes.fourPlayer)nes.fourPlayer.setInputs(inputs);
  const ports=nes.fourPlayer?2:inputs.length;
  for (let player = 1; player <= ports; player++) {
    if (!nes.controllers[player]) throw new Error(`Game engine has no controller port for player ${player}`);
    integer(inputs[player - 1], 0, 255, 'controller mask');
  }
  for (let player = 1; player <= ports; player++) {
    for (let button = 0; button < 8; button++) {
      nes[inputs[player - 1] & (1 << button) ? 'buttonDown' : 'buttonUp'](player, button);
    }
  }
}
