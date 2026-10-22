// MIT License — Copyright (c) 2026 Rick Gerkin.
import {sha,equal} from './auth.mjs';
export class RoomError extends Error{constructor(status,message){super(message);this.status=status;}}
export function randomToken(bytes=24){const data=crypto.getRandomValues(new Uint8Array(bytes));return btoa(String.fromCharCode(...data)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
export class RoomState {
  constructor(state,now,hash,token){this.state=state;this.now=now;this.hash=hash;this.token=token;}
  create(players,room){
    if(this.state)throw new RoomError(409,'Room already exists');
    if(![2,3,4].includes(players))throw new RoomError(400,'Expected 2, 3 or 4 players');
    const token=this.token(),invite=this.token();
    this.state={room,players,invite:this.hash(invite),tokens:{1:this.hash(token)},offers:{},answers:{},expires:this.now+30*60*1000};
    return{room,players,player:1,token,invite};
  }
  live(){if(!this.state||this.state.expires<=this.now)throw new RoomError(404,'Room expired or not found');return this.state;}
  join(invite){
    const s=this.live();if(typeof invite!=='string'||invite.length!==32||!equal(this.hash(invite),s.invite))throw new RoomError(404,'Invitation not found');
    const player=Object.keys(s.tokens).length+1;if(player>s.players)throw new RoomError(409,'Room is full');
    const token=this.token();s.tokens[player]=this.hash(token);s.expires=this.now+30*60*1000;
    return{room:s.room,players:s.players,player,token};
  }
  authorize(token){
    const s=this.live();if(typeof token!=='string'||token.length!==32)throw new RoomError(403,'Invalid room credentials');
    const hashed=this.hash(token),player=Number(Object.keys(s.tokens).find(p=>equal(s.tokens[p],hashed))||0);
    if(!player)throw new RoomError(403,'Invalid room credentials');
    return player;
  }
  access(token,body){
    const player=this.authorize(token),s=this.live();
    if(body){
      const {to,description}=body;
      if(!Number.isInteger(to)||to<1||to>s.players||to===player||(player!==1&&to!==1)||!s.tokens[to])throw new RoomError(400,'Invalid signaling recipient');
      const type=player===1?'offer':'answer';
      if(!description||description.type!==type||typeof description.sdp!=='string'||!description.sdp.length||description.sdp.length>60000)throw new RoomError(400,'Invalid session description');
      const table=player===1?s.offers:s.answers,key=player===1?to:player;
      if(table[key]&&JSON.stringify(table[key])!==JSON.stringify(description))throw new RoomError(409,'Description already set; create a new room');
      table[key]={type,sdp:description.sdp};
    }
    s.expires=this.now+30*60*1000;
    return{player,players:s.players,roster:Object.keys(s.tokens).map(Number),offers:player===1?s.offers:{[player]:s.offers[player]},answers:player===1?s.answers:{},directOnly:true};
  }
}

export async function prepareAction(method,args) {
  if(!['create','join','access'].includes(method))throw new RoomError(400,'Unknown action');
  const tokens=[randomToken(),randomToken()],values=[...tokens];
  if(['join','access'].includes(method)&&typeof args[0]==='string'&&args[0].length===32)values.push(args[0]);
  const hashes=new Map();
  await Promise.all(values.map(async value=>{hashes.set(value,await sha(value));}));
  return(state,now)=>{const generated=[...tokens],model=new RoomState(state,now,value=>hashes.get(value),()=>generated.shift());const result=model[method](...args);return {result,state:model.state};};
}
