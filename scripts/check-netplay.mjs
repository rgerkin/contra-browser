// Tests need no ROM, sockets, or dependencies. Optional ROM path also checks
// that the actual emulator stays identical through reordering and duplication.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FrameSync, applyInputs} from '../web/netplay/frame-sync.mjs';

function peers(players = 2, delay = 3) {
  return Array.from({length: players}, (_, i) => new FrameSync({session: 'test-room', players, localPlayer: i + 1, delay}));
}
function broadcast(peers, packet) { for (const peer of peers) peer.receive(packet, packet.player); }

test('all peers agree on ordered inputs, including four independent slots', () => {
  for (const players of [2, 3, 4]) {
    const group = peers(players);
    for (let frame = 0; frame < 1000; frame++) {
      const packets = group.map((peer, i) => peer.schedule((frame * 17 + i * 31) & 255));
      // Reverse delivery, duplicate packets, and verify retransmits are stable.
      for (const packet of packets.reverse()) { broadcast(group, packet); broadcast(group, packet); }
      const records = group.map(peer => peer.takeFrame());
      records.forEach(record => assert.deepEqual(record, records[0]));
      assert.equal(records[0].frame, frame);
      assert.deepEqual(records[0].inputs, frame < 3 ? Array(players).fill(0)
        : Array.from({length: players}, (_, i) => ((frame - 3) * 17 + i * 31) & 255));
      assert(group.every(peer => peer.pending.size <= 3));
    }
  }
});

test('lag stalls simulation and held input retransmits without changing history', () => {
  const [a, b] = peers(2, 0);
  const first = a.schedule(1);
  assert.equal(a.takeFrame(), null);
  assert.deepEqual(a.missingPlayers, [2]);
  assert.deepEqual(a.schedule(2), first);
  const remote = b.schedule(2);
  a.receive(remote, 2); b.receive(first, 1);
  assert.deepEqual(a.takeFrame(), b.takeFrame());
  assert.equal(a.receive(remote, 2), false);
});

test('wrong sessions, spoofed slots, invalid masks, and conflicting input are rejected', () => {
  const [a, b] = peers();
  const packet = b.schedule(10);
  assert.throws(() => a.receive(packet, 1), /another player/);
  assert.throws(() => a.receive({...packet, session: 'another-room'}, 2), /session/);
  assert.throws(() => a.receive({...packet, mask: 256}, 2), /mask/);
  assert.throws(() => a.receive({...packet, mask: -1}, 2), /mask/);
  assert.throws(() => a.receive({...packet, frame: 0.5}, 2), /frame/);
  assert.throws(() => a.receive({...packet, frame: 121}, 2), /ahead/);
  assert(a.receive(packet, 2));
  assert.throws(() => a.receive({...packet, mask: 11}, 2), /Conflicting/);
});

test('pause preserves the frame queue and resume consumes it exactly once', () => {
  const [a, b] = peers(2, 0);
  broadcast([a,b], a.schedule(3)); broadcast([a,b], b.schedule(4));
  a.paused = true;
  assert.equal(a.takeFrame(), null); assert.equal(a.frame, 0);
  a.paused = false;
  assert.deepEqual(a.takeFrame(), {frame:0,inputs:[3,4]});
  assert.equal(a.takeFrame(), null); assert.equal(a.frame,1);
});

test('stock two-port engine explicitly rejects extra slots before applying input', () => {
  const calls=[];
  const nes={controllers:{1:{},2:{}},buttonDown:(...args)=>calls.push(args),buttonUp:(...args)=>calls.push(args)};
  assert.throws(() => applyInputs(nes, [0,0,1,2]), /no controller port/);
  assert.equal(calls.length,0);
  applyInputs(nes, [1,128]);
  assert.equal(calls.length,16);
});

if (process.argv[2]) {
  test('real ROM: independently scheduled peers remain byte-identical', async () => {
    const {readFileSync} = await import('node:fs');
    const {createHash} = await import('node:crypto');
    const {default:NES} = await import('../web/vendor/jsnes/src/nes.js');
    const rom=readFileSync(process.argv[2]).toString('latin1');
    const engines=[new NES(),new NES()]; engines.forEach(nes=>nes.loadROM(rom));
    const group=peers();
    for(let frame=0;frame<1800;frame++) {
      const masks=[frame===600?8:frame>1000?130:0,frame>1000?2:0];
      const packets=group.map((peer,i)=>peer.schedule(masks[i]));
      packets.reverse().forEach(packet=>broadcast(group,packet));
      group.forEach((peer,i)=>{const next=peer.takeFrame(); assert(next);applyInputs(engines[i],next.inputs);engines[i].frame();});
      if(frame%120===0) assert.deepEqual(engines[0].toJSON(),engines[1].toJSON());
    }
    const hash=nes=>createHash('sha256').update(JSON.stringify(nes.toJSON())).digest('hex');
    assert.equal(hash(engines[0]),hash(engines[1]));
    const snapshot=JSON.parse(JSON.stringify(engines[0].toJSON()));
    for(let i=0;i<120;i++) engines[0].frame();
    const expected=hash(engines[0]); engines[0].fromJSON(snapshot);
    for(let i=0;i<120;i++) engines[0].frame();
    assert.equal(hash(engines[0]),expected);
  });
}
