// MIT License — Copyright (c) 2026 Rick Gerkin.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PartyRoom} from '../web/netplay/party-room.mjs';
test('four streaming peers wait for everyone, start once, and authenticate each input source',async()=>{
  const originalFetch=globalThis.fetch,enc=new TextEncoder(),streams=new Map(),events=[[],[],[],[]],errors=[];
  globalThis.fetch=async(_url,options)=>new Response(new ReadableStream({start(c){streams.set(Number(options.headers.Authorization.slice(7)),c);c.enqueue(enc.encode('[]\n'));}}));
  const rooms=[1,2,3,4].map((player,i)=>{
    const r=new PartyRoom({players:4,fingerprint:'rom',onStatus:()=>{},onStart:()=>events[i].push('start'),
      onInput:(packet,sender)=>events[i].push({packet,sender}),onHash:()=>{},onCommand:()=>{},onClose:e=>errors.push(e),onLatency:()=>{}});
    r.credentials={room:'test',player,players:4,token:String(player)};
    r.request=async(_path,{messages})=>{for(const [target,stream]of streams)if(target!==player){const bytes=enc.encode(JSON.stringify(messages.map(data=>({from:player,data})))+'\n');stream.enqueue(bytes.slice(0,5));stream.enqueue(bytes.slice(5));}return{accepted:messages.length};};return r;
  });
  const drain=async()=>{for(let i=0;i<80;i++)await Promise.resolve();};
  try {
    for(const r of rooms)await r.open();await drain();
    assert(rooms.every(r=>r.connected));rooms.slice(0,3).forEach(r=>r.markReady());await drain();assert(rooms.every(r=>!r.started));
    rooms[3].markReady();await drain();assert(rooms.every(r=>r.started));assert(events.every(e=>e.filter(v=>v==='start').length===1));
    rooms[3].send({kind:'input',player:4,frame:5,mask:130});await drain();
    for(let i=0;i<3;i++)assert.deepEqual(events[i][1],{sender:4,packet:{kind:'input',player:4,frame:5,mask:130}});
    assert.equal(errors.length,0);
    rooms[0].receive({kind:'command',action:'pause',frame:6,epoch:0},4);
    assert.fail('Guest command must be rejected');
  } catch(error){if(error.message!=='Only host can schedule commands')throw error;}
  finally {rooms.forEach(r=>r.close());globalThis.fetch=originalFetch;}
});
