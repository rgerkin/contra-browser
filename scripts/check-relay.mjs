import assert from 'node:assert/strict';
import {test} from 'node:test';
import {RelayChannel} from '../web/netplay/relay.mjs';
import {Room} from '../web/netplay/room.mjs';

test('streaming relay carries the same handshake, readiness, and input protocol',async()=>{
  const originalFetch=globalThis.fetch;
  const enc=new TextEncoder(),controllers=new Map(),pending=new Map([[1,[]],[2,[]]]),events=[[],[]];
  const enqueue=(player,batch)=>{
    if(controllers.has(player)) {
      const bytes=enc.encode(JSON.stringify(batch)+'\n');
      // Intentionally split NDJSON across stream chunks.
      controllers.get(player).enqueue(bytes.slice(0,7));controllers.get(player).enqueue(bytes.slice(7));
    } else pending.get(player).push(...batch);
  };
  globalThis.fetch=async(_url,options)=>{
    const player=Number(options.headers.Authorization.slice(7));
    return new Response(new ReadableStream({start(controller){controllers.set(player,controller);controller.enqueue(enc.encode('[]\n'));enqueue(player,pending.get(player).splice(0));}}));
  };
  const rooms=[1,2].map((player,i)=>{
    const room=new Room({fingerprint:'same-rom',onStatus:()=>{},onStart:()=>events[i].push('start'),
      onInput:(packet,sender)=>events[i].push({packet,sender}),onCommand:()=>{},onHash:()=>{},onClose:()=>{},onLatency:()=>{}});
    room.credentials={room:'test',player,token:String(player)};room.relay=true;return room;
  });
  try {
    for(const room of rooms) {
      const channel=new RelayChannel({room:'test',player:room.player,token:room.credentials.token,
        signal:room.abort.signal,onError:error=>assert.fail(error.message),
        request:async(_path,{messages})=>{enqueue(3-room.player,messages.map(data=>({from:room.player,data})));return {accepted:messages.length};}});
      room.bind(channel);await channel.open();
    }
    for(let i=0;i<20;i++)await Promise.resolve();
    assert(rooms.every(r=>r.connected));rooms.forEach(r=>r.markReady());
    for(let i=0;i<20;i++)await Promise.resolve();
    assert(rooms.every(r=>r.started));assert.equal(events[0][0],'start');assert.equal(events[1][0],'start');
    rooms[1].send({kind:'input',frame:1,player:2,mask:130});
    for(let i=0;i<20;i++)await Promise.resolve();
    assert.deepEqual(events[0][1],{sender:2,packet:{kind:'input',frame:1,player:2,mask:130}});
  } finally {rooms.forEach(r=>r.close());globalThis.fetch=originalFetch;}
});

test('ICE failure before play automatically replaces the direct channel with the relay',async()=>{
  const originalFetch=globalThis.fetch,originalRTC=globalThis.RTCPeerConnection;
  const requests=[],events=[];let directClosed=false;
  globalThis.RTCPeerConnection=class {
    constructor(){this.connectionState='new';}
    createDataChannel(){return {readyState:'connecting',bufferedAmount:0,close(){directClosed=true;}};}
    close(){this.connectionState='closed';}
  };
  globalThis.fetch=async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('[]\n'));}}));
  const room=new Room({fingerprint:'test-rom',onStatus:s=>events.push(s),onStart:()=>{},onInput:()=>{},onCommand:()=>{},onHash:()=>{},onClose:()=>{},onLatency:()=>{}});
  room.credentials={room:'test',token:'host-token',player:1};
  room.request=async(path,body)=>{
    requests.push({path,body});
    return path==='/api/config'?{iceServers:[]}:{};
  };
  try {
    await room.setup(true);
    room.pc.connectionState='failed';room.pc.onconnectionstatechange();
    for(let i=0;i<20;i++)await Promise.resolve();
    assert(directClosed);assert(room.relay);assert.equal(room.channel.readyState,'open');
    assert(requests.some(r=>r.body?.transport==='relay'));
    assert(requests.some(r=>r.body?.messages?.some(s=>JSON.parse(s).kind==='hello')));
    assert(events.some(s=>s.includes('server relay')));
  } finally {room.close();globalThis.fetch=originalFetch;globalThis.RTCPeerConnection=originalRTC;}
});
