import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Room} from '../web/netplay/room.mjs';

const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function pair(fingerprints=['same-rom','same-rom']) {
  const events=[[],[]];
  const rooms=[1,2].map((player,i)=>{
    const room=new Room({fingerprint:fingerprints[i],
      onStatus:s=>events[i].push(['status',s]),onStart:()=>events[i].push(['start']),
      onInput:(p,sender)=>events[i].push(['input',p,sender]),onCommand:()=>{},onHash:()=>{},
      onClose:message=>events[i].push(['close',message]),onLatency:ms=>events[i].push(['latency',ms])});
    room.credentials={player,room:'test'};return room;
  });
  const channels=[0,1].map(i=>({readyState:'open',bufferedAmount:0,
    send(data){queueMicrotask(()=>channels[1-i].onmessage?.({data}));},
    close(){this.readyState='closed';queueMicrotask(()=>channels[1-i].onclose?.());}}));
  rooms.forEach((room,i)=>room.bind(channels[i]));channels.forEach(c=>c.onopen());
  return {rooms,channels,events,close:()=>rooms.forEach(r=>r.close())};
}

test('matching peers handshake, require both ready, and start once',async()=>{
  const p=pair();try {
    await settle();assert(p.rooms.every(r=>r.connected));
    p.rooms[0].markReady();await settle();assert(!p.rooms[0].started);
    p.rooms[1].markReady();await settle();assert(p.rooms.every(r=>r.started));
    p.rooms[1].markReady();await settle();
    assert.equal(p.events[0].filter(e=>e[0]==='start').length,1);
    assert.equal(p.events[1].filter(e=>e[0]==='start').length,1);
  }finally{p.close();}
});

test('transport assigns remote input to its peer slot rather than trusting the packet',async()=>{
  const p=pair();try {
    await settle();p.rooms.forEach(r=>r.markReady());await settle();
    p.rooms[1].send({kind:'input',player:1,mask:255});await settle();
    const input=p.events[0].find(e=>e[0]==='input');assert.equal(input[2],2);
  }finally{p.close();}
});

test('a different ROM fingerprint closes the connection before readiness',async()=>{
  const p=pair(['same-rom','different-rom']);try {
    await settle();assert(p.rooms.every(r=>r.closed));
    assert(p.events[0].some(e=>e[0]==='close' && /does not match/.test(e[1])));
  }finally{p.close();}
});

test('guest cannot send host start/control messages',async()=>{
  const p=pair();try {
    await settle();p.rooms[1].send({kind:'command',action:'reset',frame:10,epoch:0});await settle();
    assert(p.rooms[0].closed);
  }finally{p.close();}
});

test('oversized peer message and congested outbound buffers close safely',async()=>{
  for(const mode of ['oversize','congestion']) {
    const p=pair();try {
      await settle();
      if(mode==='oversize')p.channels[0].onmessage({data:'x'.repeat(4097)});
      else{p.channels[0].bufferedAmount=262145;p.rooms[0].send({kind:'ready'});}
      assert(p.rooms[0].closed);
    }finally{p.close();}
  }
});
