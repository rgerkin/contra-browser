// MIT License — Copyright (c) 2026 Rick Gerkin.
import {FourPlayer} from '../gameplay/four-player.mjs';
import {FrameSync, applyInputs} from './frame-sync.mjs';
import {prepareTwoPlayerGame, stateHash} from './game.mjs';

// Owns simulation time; rendering, audio output, and transport live outside it.
export class GameSession {
  constructor({nes,rom,room,player,players=2,send,onState=()=>{},onVerified=()=>{},onFatal=()=>{}}) {
    Object.assign(this,{nes,rom,room,player,players,send,onState,onVerified,onFatal});
    this.epoch=0;this.generation=0;this.closed=false;this.deferred=[];
  }
  start() {this.initialize();}
  get frame(){return this.sync.frame;}
  initialize() {
    const deferred=this.deferred;this.deferred=[];
    this.generation++;this.paused=false;this.commands=[];this.lastScheduled=-1;
    this.localHashes=new Map();this.remoteHashes=new Map();
    prepareTwoPlayerGame(this.nes,this.rom);
    if(this.players>2)new FourPlayer(this.nes,this.players);
    this.sync=new FrameSync({session:`${this.room}:${this.epoch}`,localPlayer:this.player,players:this.players,delay:4});
    for(const entry of deferred){if(entry.type==='input')this.input(entry.packet,entry.player);else this.hash(entry.packet,entry.player);}
    this.onState('running');this.capture();
  }
  close(){this.closed=true;this.generation++;}
  fail(message){if(!this.closed){this.close();this.onFatal(new Error(message));}}
  defer(entry) {
    if(this.deferred.length>=128)throw new Error('Too many future-epoch messages');
    this.deferred.push(entry);
  }
  input(packet,player) {
    if(this.closed)return;
    if(packet.session===`${this.room}:${this.epoch}`)this.sync.receive(packet,player);
    else if(packet.session===`${this.room}:${this.epoch+1}` && this.commands.some(c=>c.action==='reset'))this.defer({type:'input',packet,player});
  }
  hash(packet,player=3-this.player) {
    if(this.closed)return;
    if(packet.epoch!==this.epoch) {
      if(packet.epoch===this.epoch+1 && this.commands.some(c=>c.action==='reset'))this.defer({type:'hash',packet,player});
      return;
    }
    if(this.remoteHashes.size>=16)throw new Error('Too many unverified state checksums');
    if(!Number.isInteger(player)||player<1||player>this.players||player===this.player)throw new Error('Invalid checksum sender');
    const hashes=this.remoteHashes.get(packet.frame) ?? new Map();
    hashes.set(player,packet.hash);this.remoteHashes.set(packet.frame,hashes);this.compare(packet.frame);
  }
  compare(frame) {
    const ours=this.localHashes.get(frame),theirs=this.remoteHashes.get(frame);
    if(ours && theirs) {
      if([...theirs.values()].some(hash=>hash!==ours)){this.fail('Game states diverged. Create a new room to restart in sync.');return;}
      if(theirs.size!==this.players-1)return;
      this.onVerified({frame,hash:ours,epoch:this.epoch});
      this.localHashes.delete(frame);this.remoteHashes.delete(frame);
    }
  }
  async capture() {
    const {generation,epoch}=this,frame=this.frame;
    try {
      const hash=await stateHash(this.nes);
      if(this.closed || this.generation!==generation)return;
      this.localHashes.set(frame,hash);this.send({kind:'hash',frame,epoch,hash});this.compare(frame);
      if(this.localHashes.size>16 || this.remoteHashes.size>16)this.fail('Peer checksum verification timed out.');
    }catch(error){if(this.generation===generation)this.fail(error.message);}
  }
  request(action) {
    if(!['pause','resume','reset'].includes(action))throw new Error('Unknown room action');
    if(this.closed)return;
    if(this.player!==1){this.send({kind:'request',action});return;}
    if(this.commands.length>=32)throw new Error('Too many pending room controls');
    let frame=this.paused?this.frame:this.frame+this.sync.delay+2;
    if(action==='resume')frame=this.commands.find(c=>c.action==='pause')?.frame ?? this.frame;
    const packet={kind:'command',action,frame,epoch:this.epoch};
    this.send(packet);this.command(packet,false);
  }
  command(packet,isRequest) {
    if(this.closed)return;
    if(isRequest){if(this.player!==1)throw new Error('Only host accepts control requests');this.request(packet.action);return;}
    if(packet.epoch!==this.epoch || !['pause','resume','reset'].includes(packet.action) || !Number.isSafeInteger(packet.frame) || packet.frame<this.frame || packet.frame>this.frame+120)throw new Error('Invalid control frame');
    if(this.commands.length>=32)throw new Error('Too many pending room controls');
    this.commands.push(packet);this.commands.sort((a,b)=>a.frame-b.frame);
  }
  step(mask) {
    if(this.closed)return {state:'closed',advanced:false,scheduled:false};
    while(this.commands.length && this.commands[0].frame===this.frame) {
      const command=this.commands.shift();
      if(command.action==='reset') {
        this.epoch++;this.initialize();
        return {state:'reset',advanced:false,scheduled:false};
      }
      this.paused=command.action==='pause';this.onState(this.paused?'paused':'running');
    }
    if(this.commands.length && this.commands[0].frame<this.frame)throw new Error('Room control arrived too late. Reconnect to resynchronize.');
    if(this.paused)return {state:'paused',advanced:false,scheduled:false};
    let scheduled=false;
    if(this.lastScheduled!==this.frame+this.sync.delay) {
      const packet=this.sync.schedule(mask);this.send(packet);this.lastScheduled=packet.frame;scheduled=true;
    }
    const record=this.sync.takeFrame();
    if(!record)return {state:'waiting',advanced:false,scheduled};
    applyInputs(this.nes,record.inputs);this.nes.frame();
    if(this.frame%120===0)this.capture();
    return {state:'running',advanced:true,scheduled};
  }
}
