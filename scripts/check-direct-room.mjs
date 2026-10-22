// MIT License — Copyright (c) 2026 Rick Gerkin.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DirectRoom} from '../web/netplay/direct-room.mjs';
import {prepareAction} from '../cloudflare/src/room-state.mjs';
test('four direct peers share a cartridge and exchange inputs without a cloud relay',async()=>{
  const previous={fetch:globalThis.fetch,RTCPeerConnection:globalThis.RTCPeerConnection,location:globalThis.location};
  let state=null,id=0;const registry=new Map(),bodies=[],errors=[],events=[[],[],[],[]],received=[];
  class Channel {
    constructor(){this.label='contra-direct';this.readyState='connecting';this.bufferedAmount=0;}
    send(data){if(this.readyState!=='open')throw new Error('Not open');const copy=typeof data==='string'?data:data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);queueMicrotask(()=>this.peer.onmessage?.({data:copy}));}
    close(){this.readyState='closed';}
  }
  class Peer {
    constructor(config){assert.deepEqual(config.iceServers,[]);this.id=String(++id);registry.set(this.id,this);this.iceGatheringState='complete';this.remoteDescription=null;this.connectionState='new';}
    createDataChannel(){return this.channel=new Channel();}
    async createOffer(){return {type:'offer',sdp:this.id};}
    async createAnswer(){return {type:'answer',sdp:this.id};}
    async setLocalDescription(value){this.localDescription={...value,toJSON:()=>value};}
    async setRemoteDescription(value){this.remoteDescription=value;if(value.type==='answer'){
      const guest=registry.get(value.sdp),remote=new Channel();guest.ondatachannel({channel:remote});this.channel.peer=remote;remote.peer=this.channel;
      this.channel.readyState=remote.readyState='open';this.connectionState=guest.connectionState='connected';
      queueMicrotask(()=>{this.channel.onopen?.();remote.onopen?.();});
    }}
    close(){this.channel?.close();this.connectionState='closed';}
  }
  globalThis.RTCPeerConnection=Peer;globalThis.location={href:'https://game.example/'};
  globalThis.fetch=async(path,options)=>{
    const input=options.body?JSON.parse(options.body):null;if(input)bodies.push(input);
    const token=(options.headers.Authorization||'').replace(/^Bearer /,'');let method,args;
    if(path==='/api/rooms'){method='create';args=[input.players,'r'.repeat(24)];}
    else if(input?.invite){method='join';args=[input.invite];}
    else {method='access';args=[token,input];}
    try{const execute=await prepareAction(method,args),outcome=execute(state,Date.now());state=structuredClone(outcome.state);return Response.json(outcome.result);}
    catch(error){return Response.json({error:error.message},{status:error.status||500});}
  };
  const cartridge='N'.repeat(131088);
  const rooms=[1,2,3,4].map((player,i)=>new DirectRoom({players:4,fingerprint:'test-rom',getCartridge:()=>player===1?cartridge:null,
    onCartridge:async bytes=>{assert.equal(new Uint8Array(bytes).length,131088);assert(new Uint8Array(bytes).every(v=>v===78));received.push(player);},
    onStatus:()=>{},onDiagnostic:()=>{},onStart:()=>events[i].push('start'),onInput:(packet,from)=>events[i].push({packet,from}),onCommand:()=>{},onHash:()=>{},onClose:e=>errors.push(e),onLatency:()=>{}}));
  const until=async predicate=>{const end=Date.now()+7000;while(!predicate()){assert(Date.now()<end,'Direct room timed out: '+errors.join('; '));await new Promise(r=>setTimeout(r,20));}};
  try {
    await rooms[0].host();const host=rooms[0].credentials;
    for(const r of rooms.slice(1))await r.join(host.room,host.invite);
    await until(()=>rooms.every(r=>r.connected)&&received.length===3);
    rooms.forEach(r=>r.markReady());await until(()=>rooms.every(r=>r.started));
    rooms[3].send({kind:'input',player:4,frame:10,mask:130});await until(()=>events.slice(0,3).every(e=>e.length>=2));
    for(const e of events.slice(0,3))assert.deepEqual(e[1],{from:4,packet:{kind:'input',player:4,frame:10,mask:130}});
    assert.equal(errors.length,0);
    assert(bodies.every(b=>!b.messages&&!b.transport&&!b.cartridge));assert(bodies.every(b=>JSON.stringify(b).length<1000));
    assert.throws(()=>rooms[1].receiveDirect(rooms[1].links.get(1),JSON.stringify({from:9,data:'{}'})),/sender/);
    assert(rooms.every(r=>r.relay===false));
  }finally{rooms.forEach(r=>r.close());Object.assign(globalThis,previous);}
});
