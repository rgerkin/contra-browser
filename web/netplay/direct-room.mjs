// MIT License — Copyright (c) 2026 Rick Gerkin.
import {PartyRoom} from './party-room.mjs';
// Star topology: every guest has one authenticated direct link to player 1.
// Player 1 forwards peer messages over those links, never through the server.
class DirectChannel {
  constructor(room){this.room=room;this.readyState='connecting';}
  get bufferedAmount(){return Math.max(0,...[...this.room.links.values()].map(l=>l.channel?.bufferedAmount||0));}
  send(data){
    if(typeof data!=='string'||data.length>4096||this.bufferedAmount>262144)throw new Error('Direct channel is congested');
    if(this.room.player===1)for(const link of this.room.links.values())link.channel.send(JSON.stringify({from:1,data}));
    else this.room.links.get(1).channel.send(data);
  }
  close(){this.readyState='closed';}
}
export class DirectRoom extends PartyRoom {
  constructor(options){super(options);this.players=options.players;this.links=new Map();this.relay=false;this.receiving=null;}
  async open(){
    if(!globalThis.RTCPeerConnection)throw new Error('This browser does not support WebRTC');
    this.channel=new DirectChannel(this);this.opened=performance.now();
    this.poll().catch(error=>this.fail(error));
  }
  async poll(){
    while(!this.closed && !this.started){
      const status=await this.request(`/api/rooms/${this.id}`);
      if(this.player===1){
        for(const player of status.roster.filter(p=>p!==1)){
          let link=this.links.get(player);
          if(!link){link=this.link(player);this.bind(link,link.pc.createDataChannel('contra-direct',{ordered:true}));
            await link.pc.setLocalDescription(await link.pc.createOffer());await this.gather(link.pc);
            await this.request(`/api/rooms/${this.id}`,{to:player,description:link.pc.localDescription.toJSON()});}
          if(status.answers[player]&&!link.pc.remoteDescription)await link.pc.setRemoteDescription(status.answers[player]);
        }
      } else if(status.offers[this.player]&&!this.links.has(1)){
        const link=this.link(1);link.pc.ondatachannel=event=>{if(event.channel.label!=='contra-direct'||link.channel){event.channel.close();return;}this.bind(link,event.channel);};
        await link.pc.setRemoteDescription(status.offers[this.player]);await link.pc.setLocalDescription(await link.pc.createAnswer());await this.gather(link.pc);
        await this.request(`/api/rooms/${this.id}`,{to:1,description:link.pc.localDescription.toJSON()});
      }
      if(!this.started&&performance.now()-this.opened>180000)throw new Error('Direct connection timed out. Check LAN firewall or Wi-Fi client isolation.');
      await new Promise(resolve=>setTimeout(resolve,500));
    }
  }
  link(player){
    const pc=new RTCPeerConnection({iceServers:[],iceTransportPolicy:'all'}),link={player,pc,channel:null};this.links.set(player,link);
    pc.onconnectionstatechange=()=>{this.onDiagnostic?.(`Player ${player}: ${pc.connectionState}`);if(['failed','closed'].includes(pc.connectionState))this.fail(new Error('Direct connection failed. Cloud relay is disabled.'));};
    return link;
  }
  async gather(pc){
    if(pc.iceGatheringState==='complete')return;
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pc.removeEventListener('icegatheringstatechange',check);reject(new Error('Local ICE gathering timed out'));},10000);
      const check=()=>{if(pc.iceGatheringState==='complete'){clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',check);resolve();}};pc.addEventListener('icegatheringstatechange',check);check();});
  }
  bind(link,channel){
    link.channel=channel;channel.binaryType='arraybuffer';
    channel.onopen=()=>{
      if(this.closed)return;
      if(this.player===1){const rom=this.getCartridge?.();if(rom){channel.send(JSON.stringify({cartridge:131088}));for(let offset=0;offset<rom.length;offset+=16384)channel.send(Uint8Array.from(rom.slice(offset,offset+16384),c=>c.charCodeAt(0)));}}
      this.openIfReady();
      if(this.player===1)this.hello();
    };
    channel.onclose=()=>{if(!this.closed)this.fail(new Error('A player disconnected. Create a new room.'));};
    channel.onerror=()=>this.fail(new Error('Direct data channel error'));
    channel.onmessage=event=>{try{this.receiveDirect(link,event.data);}catch(error){this.fail(error);}};
  }
  openIfReady(){
    const count=this.player===1?this.players-1:1;
    if(this.channel.readyState==='open'||this.links.size!==count||[...this.links.values()].some(l=>l.channel?.readyState!=='open'))return;
    this.channel.readyState='open';this.lastSeen=new Map();this.hello();
    this.timer=setInterval(()=>{
      if(this.started&&[...this.lastSeen.values()].some(t=>performance.now()-t>15000))return this.fail(new Error('A player stopped responding'));
      this.hello();if(this.ready)this.send({kind:'ready'});this.lastPing=performance.now();this.send({kind:'ping',time:this.lastPing});
    },1000);
    this.onStatus(`Direct links established. Waiting for ${this.players} players to verify the cartridge.`);
  }
  hello(){if(this.channel.readyState==='open')this.send({kind:'hello',protocol:'contra-four-player-1',rom:this.fingerprint,players:this.players});}
  receiveDirect(link,data){
    if(data instanceof ArrayBuffer){
      if(this.player===1||!this.receiving||data.byteLength>16384||this.receiving.offset+data.byteLength>131088)throw new Error('Unexpected cartridge chunk');
      this.receiving.bytes.set(new Uint8Array(data),this.receiving.offset);this.receiving.offset+=data.byteLength;
      if(this.receiving.offset===131088){const bytes=this.receiving.bytes;this.receiving=null;Promise.resolve(this.onCartridge?.(bytes.buffer)).catch(error=>this.fail(error));}
      return;
    }
    if(typeof data!=='string'||data.length>8192)throw new Error('Invalid direct message');
    const value=JSON.parse(data);
    if(this.player!==1&&value.cartridge===131088){if(this.receiving||this.started)throw new Error('Unexpected cartridge transfer');this.receiving={bytes:new Uint8Array(131088),offset:0};return;}
    let from,packet;
    if(this.player===1){from=link.player;packet=value;
      for(const other of this.links.values())if(other.player!==from&&other.channel?.readyState==='open')other.channel.send(JSON.stringify({from,data}));
    } else {
      if(!Number.isInteger(value.from)||value.from<1||value.from>this.players||value.from===this.player||typeof value.data!=='string'||value.data.length>4096)throw new Error('Invalid forwarded sender');
      from=value.from;packet=JSON.parse(value.data);
    }
    if(packet.kind==='hello')this.openIfReady();
    this.receive(packet,from);
  }
  close(){if(this.closed)return;super.close();for(const {pc,channel}of this.links.values()){pc.onconnectionstatechange=null;if(channel){channel.onclose=null;channel.onerror=null;channel.onmessage=null;}pc.close();}}
}
