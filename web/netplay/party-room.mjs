// MIT License — Copyright (c) 2026 Rick Gerkin.
import {RelayChannel} from './relay.mjs';
const PARTY_PROTOCOL='contra-four-player-1';
export class PartyRoom {
  constructor(options) {
    Object.assign(this,options);this.players=options.players || 4;
    this.abort=new AbortController();this.peers=new Set();this.readyPeers=new Set();
    this.lastSeen=new Map();this.closed=false;this.ready=false;this.started=false;this.relay=true;
  }
  get player(){return this.credentials?.player;}
  get id(){return this.credentials?.room;}
  get connected(){return !this.closed && this.channel?.readyState==='open' && this.peers.size===this.players-1;}
  async request(path,body) {
    const response=await fetch(path,{method:body?'POST':'GET',signal:this.abort.signal,
      headers:{...(body?{'Content-Type':'application/json'}:{}),...(this.credentials?{Authorization:`Bearer ${this.credentials.token}`}:{})},
      ...(body?{body:JSON.stringify(body)}:{})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Room service unavailable');return result;
  }
  async host() {
    this.credentials=await this.request('/api/rooms',{players:this.players});
    if(this.credentials.players!==this.players)throw new Error('Restart the server to enable the new squad room API.');
    const link=new URL(location.href);link.hash=new URLSearchParams({room:this.id,invite:this.credentials.invite,players:this.players}).toString();
    this.onStatus(`Room created for ${this.players} players. Share the invitation with everyone.`,link.href);
    await this.open();
  }
  async join(room,invite) {
    this.credentials=await this.request(`/api/rooms/${encodeURIComponent(room)}`,{invite});
    if(this.credentials.players!==this.players)throw new Error('Invitation player count does not match room');
    await this.open();
  }
  async open() {
    this.channel=new RelayChannel({room:this.id,player:this.player,players:this.players,token:this.credentials.token,
      request:(...args)=>this.request(...args),signal:this.abort.signal,onError:error=>this.fail(error)});
    this.channel.onmessage=event=>{try{this.receive(JSON.parse(event.data),event.from);}catch(error){this.fail(error);}};
    await this.channel.open();
    this.opened=performance.now();
    const heartbeat=()=>{
      if(this.closed)return;
      const now=performance.now();
      if(!this.connected && now-this.opened>180000)return this.fail(new Error('Room did not fill within three minutes.'));
      if(this.started && [...this.lastSeen.values()].some(t=>now-t>15000))return this.fail(new Error('A player stopped responding. Create a new room.'));
      this.send({kind:'hello',protocol:PARTY_PROTOCOL,rom:this.fingerprint,players:this.players});
      if(this.ready)this.send({kind:'ready'});
      this.lastPing=now;this.send({kind:'ping',time:now});
    };
    heartbeat();this.timer=setInterval(heartbeat,1000);
    this.onDiagnostic?.(`Server relay open; waiting for ${this.players-1} peers`);
  }
  receive(packet,from) {
    if(!Number.isInteger(from)||from<1||from>this.players||from===this.player||!packet||typeof packet!=='object')throw new Error('Invalid party sender/message');
    this.lastSeen.set(from,performance.now());
    if(packet.kind==='hello') {
      if(packet.protocol!==PARTY_PROTOCOL||packet.rom!==this.fingerprint||packet.players!==this.players)throw new Error('Cartridge or multiplayer version mismatch');
      const added=!this.peers.has(from);this.peers.add(from);
      if(added){this.send({kind:'hello',protocol:PARTY_PROTOCOL,rom:this.fingerprint,players:this.players});this.onStatus(`${this.peers.size+1}/${this.players} players connected. You are player ${this.player}.${this.connected?' Click Ready.':''}`);}
      return;
    }
    if(!this.peers.has(from))return; // Hello heartbeat establishes each authenticated stream.
    switch(packet.kind) {
      case 'ready':this.readyPeers.add(from);this.maybeStart();break;
      case 'start':
        if(from!==1||this.player===1||!this.connected||!this.ready)throw new Error('Invalid party start');
        if(!this.started){this.started=true;this.onStart();}break;
      case 'input':if(!this.started)throw new Error('Input before start');this.onInput(packet,from);break;
      case 'hash':
        if(!Number.isSafeInteger(packet.frame)||packet.frame<0||!Number.isSafeInteger(packet.epoch)||packet.epoch<0||!/^[a-f0-9]{64}$/.test(packet.hash))throw new Error('Invalid party checksum');
        this.onHash(packet,from);break;
      case 'request':if(this.player===1)this.onCommand(packet,true);break;
      case 'command':if(from!==1||this.player===1)throw new Error('Only host can schedule commands');this.onCommand(packet,false);break;
      case 'ping':if(!Number.isFinite(packet.time))throw new Error('Invalid ping');this.send({kind:'pong',to:from,time:packet.time});break;
      case 'pong':if(packet.to===this.player && packet.time===this.lastPing)this.onLatency(Math.round(performance.now()-packet.time));break;
      default:throw new Error('Unknown party message');
    }
  }
  send(packet) {
    if(this.closed || this.channel?.readyState!=='open')return false;
    try{this.channel.send(JSON.stringify(packet));return true;}catch(error){this.fail(error);return false;}
  }
  markReady(){if(!this.connected||this.ready)return;this.ready=true;this.send({kind:'ready'});this.maybeStart();}
  maybeStart(){if(this.player===1 && this.ready && this.readyPeers.size===this.players-1 && !this.started){this.send({kind:'start'});this.started=true;this.onStart();}}
  fail(error){if(!this.closed){this.close();this.onClose(error.message);}}
  close(){if(this.closed)return;this.closed=true;clearInterval(this.timer);this.channel?.close();this.abort.abort();}
}
