// MIT License — Copyright (c) 2026 Rick Gerkin.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import NES from '../web/vendor/jsnes/src/nes.js';
import {FourPlayer} from '../web/gameplay/four-player.mjs';
import {GameSession} from '../web/netplay/game-session.mjs';
import {prepareTwoPlayerGame,stateHash} from '../web/netplay/game.mjs';
import {applyInputs} from '../web/netplay/frame-sync.mjs';
import {sha2} from '../web/netplay/digest.mjs';
const path=process.argv[2],rom=path?readFileSync(path).toString('latin1'):null;
function game(count=4){const nes=new NES();prepareTwoPlayerGame(nes,rom);const engine=new FourPlayer(nes,count);return {nes,engine};}
const step=(nes,inputs,count)=>{for(let f=0;f<count;f++){applyInputs(nes,inputs);nes.frame();}};
test('LAN digest fallback matches SHA-2 padding boundaries and cartridge-size input',()=>{
  for(const length of [0,1,55,56,63,64,111,112,127,128,131088])for(const algorithm of ['SHA-256','SHA-512']){
    const bytes=Uint8Array.from({length},(_,i)=>(i*71+17)&255);
    assert.equal(sha2(algorithm,bytes),createHash(algorithm.replace('-','').toLowerCase()).update(bytes).digest('hex'));
  }
});
test('four real characters move, jump, fire, and retain independent lives/weapons',{skip:!rom},()=>{
  const {nes,engine}=game();
  step(nes,[0,0,128,64],20);
  assert(engine.status[0].x>80);assert(engine.status[1].x<104);
  step(nes,[0,0,0,0],80);const y3=engine.status[0].y,x4=engine.status[1].x;
  step(nes,[0,0,1,0],8);assert.notEqual(engine.status[0].y,y3);assert.equal(engine.status[1].x,x4);
  step(nes,[0,0,0,0],60);
  let fired3=false,fired4=false;
  for(let f=0;f<60;f++){
    applyInputs(nes,[0,0,f%12===0?2:0,f%12===6?2:0]);nes.frame();
    fired3 ||= engine.owners.some((owner,i)=>owner===3&&nes.cpu.mem[0x388+i]);
    fired4 ||= engine.owners.some((owner,i)=>owner===4&&nes.cpu.mem[0x388+i]);
  }
  assert(fired3);assert(fired4);
  engine.players[0][24]=4; // Set only P3's cartridge weapon state to laser.
  step(nes,[0,0,2,0],30);assert.equal(nes.cpu.mem[0xab],0);assert.equal(engine.status[0].weapon,4);
  const lives=engine.status.map(p=>p.lives);
  // Put an ordinary enemy bullet on P3 after clearing spawn invincibility.
  // The shared cartridge collision routine must kill only that extra character.
  const m=nes.cpu.mem;engine.players[0][26]=0;engine.players[0][27]=0;
  m[0x83]=0;m[0x528]=1;m[0x598]=0;m[0x588]=0;
  m[0x33e]=engine.status[0].x;m[0x324]=engine.status[0].y;
  engine.collide();assert.equal(engine.status[0].state,2);assert.equal(engine.status[1].state,1);
  assert.equal(m[0x90],1);assert.equal(m[0x91],1);
  step(nes,[0,0,0,0],180);
  assert.equal(engine.status[0].lives,lives[0]-1);assert.equal(engine.status[1].lives,lives[1]);assert.equal(nes.cpu.mem[0x33],2);
  assert(engine.tiles.some(tiles=>tiles.length));assert.equal(engine.traps.length,0);
  prepareTwoPlayerGame(nes,rom);assert.equal(nes.fourPlayer,undefined);nes.frame();assert.equal(nes.crashed,false);
  const squad=new FourPlayer(nes,3);nes.cpu.mem[0x38]=nes.cpu.mem[0x39]=1;
  nes.cpu.mem[0x90]=nes.cpu.mem[0x91]=3;
  step(nes,[0,0,0],90);assert.equal(nes.cpu.mem[0x2c],4,'An active P3 must keep the mission alive');
  assert.equal(squad.status.length,1);assert.equal(squad.status[0].gameOver,0);
});
test('four delayed peers agree through guest pause/resume and host reset',{skip:!rom},async()=>{
  let time=0;const queue=[],errors=[],verified=[];
  const group=[1,2,3,4].map(player=>new GameSession({nes:new NES(),rom,room:'four-test',player,players:4,
    send:packet=>{for(let target=1;target<=4;target++)if(target!==player)queue.push({at:time+(time*7+player*3+target)%7,target,player,packet:structuredClone(packet)});},
    onFatal:e=>errors.push(e),onVerified:record=>verified.push({player,...record})}));
  function deliver(){for(let i=0;i<queue.length;){if(queue[i].at>time){i++;continue;}const {target,player,packet}=queue.splice(i,1)[0],s=group[target-1];
    if(packet.kind==='input')s.input(packet,player);else if(packet.kind==='hash')s.hash(packet,player);
    else if(packet.kind==='command')s.command(packet,false);else if(packet.kind==='request' && target===1)s.command(packet,true);
  }}
  group.forEach(s=>s.start());let stage=0;
  for(time=0;time<4000;time++) {
    deliver();group.forEach((s,i)=>{if((time+i)%7!==0)s.step((i===2&&s.frame<35?128:0)|(s.frame%24===i*6?2:0));});
    if(stage===0 && group[3].frame>=100){group[3].request('pause');stage=1;}
    if(stage===1 && group.every(s=>s.paused)){group[2].request('resume');stage=2;}
    if(stage===2 && group[0].frame>=180){group[0].request('reset');stage=3;}
    if(stage===3 && group.every(s=>s.epoch===1&&s.frame>=360)){group[0].request('pause');stage=4;}
    if(stage===4 && group.every(s=>s.paused))break;
    if(time%20===0)await new Promise(setImmediate);
    assert.equal(errors.length,0,errors.map(e=>e.message).join('; '));
  }
  await new Promise(setImmediate);time+=30;deliver();assert.equal(stage,4);assert(group.every(s=>s.paused));
  const hashes=await Promise.all(group.map(s=>stateHash(s.nes)));assert.equal(new Set(hashes).size,1);
  for(let player=1;player<=4;player++)assert(verified.some(v=>v.player===player&&v.epoch===1&&v.frame>=120));
  group.forEach(s=>s.close());assert.equal(errors.length,0);
});
