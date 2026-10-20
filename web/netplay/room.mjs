import {RelayChannel} from './relay.mjs';
// MIT License — Copyright (c) 2026 Rick Gerkin.
const PROTOCOL = 'contra-jsnes-2.1.0-netplay-1';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export class Room {
  constructor({fingerprint, onStatus, onStart, onInput, onCommand, onHash, onClose, onLatency, onDiagnostic=()=>{}, preferRelay=false}) {
    Object.assign(this,{fingerprint,onStatus,onStart,onInput,onCommand,onHash,onClose,onLatency,onDiagnostic,preferRelay});
    this.closed=false; this.ready=false; this.remoteReady=false; this.started=false;
    this.credentials=null;this.pc=null;this.channel=null;this.pingTimer=null;this.timeout=null;
    this.abort=new AbortController();
  }
  async request(path, body) {
    const response=await fetch(path,{method:body?'POST':'GET',
      headers:{...(body?{'Content-Type':'application/json'}:{}),...(this.credentials?{Authorization:`Bearer ${this.credentials.token}`}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),signal:this.abort.signal});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error || 'Room service unavailable');
    return result;
  }
  trace(message){this.onDiagnostic(message);}
  get player() { return this.credentials?.player; }
  get id() { return this.credentials?.room; }
  get connected() { return !this.closed && this.channel?.readyState==='open' && this.verified; }
  async host() {
    this.credentials=await this.request('/api/rooms',{});
    const link=new URL(location.href);link.hash=new URLSearchParams({room:this.id,invite:this.credentials.invite}).toString();
    this.onStatus('Room created. Send the invitation link to your partner.',link.href);
    await this.setup(true);
    if(!this.relay){
      await this.pc.setLocalDescription(await this.pc.createOffer());
      await this.gather();
      if(!this.relay){this.trace('Host offer ready');await this.request(`/api/rooms/${this.id}`,{description:this.pc.localDescription.toJSON()});}
    }
    this.poll(true).catch(error=>this.fail(error));
  }
  async join(room,invite) {
    this.credentials=await this.request(`/api/rooms/${encodeURIComponent(room)}`,{invite});
    this.onStatus('Joined as player 2. Connecting to host…');
    await this.setup(false);
    this.poll(false).catch(error=>this.fail(error));
  }
  async setup(host) {
    const {iceServers}=await this.request('/api/config');
    if(this.closed)return;
    if(this.preferRelay || !globalThis.RTCPeerConnection){await this.startRelay();return;}
    this.pc=new RTCPeerConnection({iceServers});
    this.pc.onsignalingstatechange=()=>this.trace(`Signaling: ${this.pc.signalingState}`);
    this.pc.onicegatheringstatechange=()=>this.trace(`ICE gathering: ${this.pc.iceGatheringState}`);
    this.pc.oniceconnectionstatechange=()=>this.trace(`ICE connection: ${this.pc.iceConnectionState}`);
    this.pc.onicecandidate=event=>{if(event.candidate)this.trace(`Local candidate: ${event.candidate.type || 'unknown'}`);};
    this.pc.onicecandidateerror=event=>this.trace(`ICE server error: ${event.errorCode}`);
    this.pc.onconnectionstatechange=()=>{
      this.trace(`Peer connection: ${this.pc.connectionState}`);
      if(this.pc.connectionState==='failed')this.fallback();
      else if(this.pc.connectionState==='closed')this.fail(new Error('Peer connection closed. Create a new room to reconnect.'));
      if(this.pc.connectionState==='disconnected')this.onStatus('Connection interrupted; waiting for your partner…');
    };
    this.timeout=setTimeout(()=>this.fail(new Error('Connection timed out. Check the shared HTTPS address and STUN/TURN configuration.')),180000);
    if(host)this.bind(this.pc.createDataChannel('contra-input',{ordered:true}));
    else this.pc.ondatachannel=event=>{
      if(this.channel || event.channel.label!=='contra-input'){event.channel.close();return;}
      this.bind(event.channel);
    };
  }
  async gather() {
    if(this.relay || this.pc.iceGatheringState==='complete')return;
    await new Promise(resolve=>{
      const done=()=>{clearTimeout(timer);this.pc.removeEventListener('icegatheringstatechange',check);resolve();};
      const check=()=>{if(this.pc.iceGatheringState==='complete')done();};
      const timer=setTimeout(done,10000);
      this.pc.addEventListener('icegatheringstatechange',check);check();
    });
    if(this.closed)throw new Error('Room closed');
  }
  async poll(host) {
    while(!this.closed) {
      const status=await this.request(`/api/rooms/${this.id}`);
      if(status.relay && !this.relay)await this.startRelay();
      if(!this.relay && !this.pc.remoteDescription) {
        const description=host?status.answer:status.offer;
        if(description) {
          this.trace(`Received ${description.type}`);
          await this.pc.setRemoteDescription(description);
          if(!host) {
            await this.pc.setLocalDescription(await this.pc.createAnswer());await this.gather();
            if(!this.relay)await this.request(`/api/rooms/${this.id}`,{description:this.pc.localDescription.toJSON()});
          }
        }
      }
      await sleep(750);
    }
  }
  fallback() {
    if(this.closed || this.relay)return;
    if(this.started){this.fail(new Error('Direct connection interrupted. Create a new room using Server relay.'));return;}
    this.startRelay().catch(error=>this.fail(error));
  }
  async startRelay() {
    if(this.closed || this.relay)return;
    if(this.started)throw new Error('Partner requested a different transport during gameplay; create a new room.');
    this.relay=true;this.verified=false;this.ready=false;this.remoteReady=false;
    clearInterval(this.pingTimer);clearTimeout(this.timeout);
    if(this.channel){this.channel.onclose=null;this.channel.onerror=null;this.channel.onmessage=null;this.channel.onopen=null;this.channel.close();this.channel=null;}
    if(this.pc){this.pc.onconnectionstatechange=null;this.pc.oniceconnectionstatechange=null;this.pc.close();}
    this.trace('Using same-server HTTP relay');this.onStatus('Connecting through the server relay…');
    await this.request(`/api/rooms/${this.id}`,{transport:'relay'});
    if(this.closed)return;
    const channel=new RelayChannel({room:this.id,player:this.player,token:this.credentials.token,
      request:(...args)=>this.request(...args),signal:this.abort.signal,onError:error=>this.fail(error)});
    this.bind(channel);await channel.open();
  }
  bind(channel) {
    this.channel=channel;
    channel.onopen=()=>{
      this.trace(this.relay?'Server relay open':'Data channel open');
      this.lastSeen=performance.now();
      clearTimeout(this.timeout);this.timeout=setTimeout(()=>this.fail(new Error('Partner did not connect in time. Create a new room.')),180000);
      this.send({kind:'hello',protocol:PROTOCOL,rom:this.fingerprint,player:this.player,delay:4});
      this.pingTimer=setInterval(()=>{
        if(this.verified && performance.now()-this.lastSeen>15000)return this.fail(new Error('Partner stopped responding. Create a new room to reconnect.'));
        this.lastPing=performance.now();this.send({kind:'ping',time:this.lastPing});
      },1000);
    };
    channel.onclose=()=>{if(!this.started&&!this.relay)this.fallback();else this.fail(new Error('Partner left the room.'));};
    channel.onerror=()=>{if(!this.started&&!this.relay)this.fallback();else this.fail(new Error('Data channel error.'));};
    channel.onmessage=event=>{
      try {
        if(typeof event.data!=='string' || event.data.length>4096)throw new Error('Invalid peer message');
        const packet=JSON.parse(event.data);this.lastSeen=performance.now();
        if(!packet || typeof packet!=='object')throw new Error('Invalid peer message');
        if(packet.kind==='hello') {
          if(this.verified || packet.protocol!==PROTOCOL || packet.rom!==this.fingerprint || packet.player!==3-this.player || packet.delay!==4)
            throw new Error('Game version or room protocol does not match your partner.');
          this.trace('Game handshake verified');
          this.verified=true;clearTimeout(this.timeout);this.onStatus(`Connected as player ${this.player} via ${this.relay?'server relay':'WebRTC'}. Click Ready when both players have loaded their ROM.`);
          return;
        }
        if(!this.verified)throw new Error('Peer handshake required');
        switch(packet.kind) {
          case 'ready':
            this.remoteReady=true;this.onStatus('Partner is ready.');this.maybeStart();break;
          case 'start':
            if(this.player!==2 || this.started || !this.ready || !this.remoteReady)throw new Error('Unexpected start');
            this.started=true;this.onStart();break;
          case 'input':
            if(!this.started)throw new Error('Input before start');
            this.onInput(packet,3-this.player);break;
          case 'request':
            if(this.player!==1 || !['pause','resume','reset'].includes(packet.action))throw new Error('Invalid room request');
            this.onCommand(packet,true);break;
          case 'command':
            if(this.player!==2 || !['pause','resume','reset'].includes(packet.action) || !Number.isSafeInteger(packet.frame) || !Number.isSafeInteger(packet.epoch))throw new Error('Invalid host command');
            this.onCommand(packet,false);break;
          case 'hash':
            if(!Number.isSafeInteger(packet.frame) || packet.frame<0 || !Number.isSafeInteger(packet.epoch) || packet.epoch<0 || !/^[a-f0-9]{64}$/.test(packet.hash))throw new Error('Invalid state checksum');
            this.onHash(packet);break;
          case 'ping':
            if(!Number.isFinite(packet.time))throw new Error('Invalid ping');
            this.send({kind:'pong',time:packet.time});break;
          case 'pong':
            if(packet.time===this.lastPing)this.onLatency(Math.round(performance.now()-packet.time));break;
          default:throw new Error('Unknown peer message');
        }
      } catch(error) { this.fail(error); }
    };
  }
  send(packet) {
    if(this.closed || this.channel?.readyState!=='open')return false;
    if(this.channel.bufferedAmount>262144){this.fail(new Error('Peer connection is congested.'));return false;}
    try{this.channel.send(JSON.stringify(packet));return true;}catch(error){this.fail(error);return false;}
  }
  markReady() {
    if(!this.connected || this.ready)return;
    this.ready=true;this.send({kind:'ready'});this.maybeStart();
  }
  maybeStart() {
    if(this.player===1 && this.ready && this.remoteReady && !this.started) {
      this.started=true;this.send({kind:'start'});this.onStart();
    }
  }
  fail(error) {
    if(this.closed)return;
    this.trace(`Stopped: ${error.message}`);this.close();this.onClose(error.message);
  }
  close() {
    if(this.closed)return;
    this.closed=true;this.abort.abort();clearTimeout(this.timeout);clearInterval(this.pingTimer);
    if(this.channel){this.channel.onclose=null;this.channel.onerror=null;this.channel.onmessage=null;this.channel.onopen=null;this.channel.close();}
    if(this.pc){this.pc.onconnectionstatechange=null;this.pc.close();}
  }
}
