import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import NES from '../web/vendor/jsnes/src/nes.js';
import {GameSession} from '../web/netplay/game-session.mjs';
import {stateHash} from '../web/netplay/game.mjs';

const romPath=process.argv[2];
test('real game: delayed peers stay synchronized through pause, guest resume, and reset', {skip:!romPath}, async()=>{
  const rom=readFileSync(romPath).toString('latin1');
  let time=0;const delivery=[0,0],queue=[],errors=[],verified=[];
  const group=[0,1].map(i=>new GameSession({nes:new NES(),rom,room:'session-test',player:i+1,
    send(packet){
      const lag=(time*13+i*7)%9;
      const at=Math.max(time+lag,delivery[i]);delivery[i]=at;
      queue.push({to:1-i,from:i+1,at,packet:JSON.parse(JSON.stringify(packet))});
    },onFatal:error=>errors.push(error),onVerified:record=>verified.push({player:i+1,...record})}));
  function deliver(){
    for(let i=0;i<queue.length;) {
      if(queue[i].at>time){i++;continue;}
      const {to,from,packet}=queue.splice(i,1)[0];
      const session=group[to];
      if(packet.kind==='input')session.input(packet,from);
      else if(packet.kind==='hash')session.hash(packet);
      else if(packet.kind==='command')session.command(packet,false);
      else if(packet.kind==='request')session.command(packet,true);
      else assert.fail('Unexpected packet');
    }
  }
  group.forEach(g=>g.start());
  let stage=0;
  for(time=0;time<6000;time++) {
    deliver();
    for(let i=0;i<2;i++) {
      if(i===1 && time%4===0)continue; // Different render cadence / stalls.
      const mask=(i===0?128:64)|2|(group[i].frame%90<10?1:0);
      group[i].step(mask);
    }
    if(stage===0 && group[0].frame>=100){group[0].request('pause');stage=1;}
    if(stage===1 && group.every(g=>g.paused)) {
      assert.equal(group[0].frame,group[1].frame);
      group[1].request('resume');stage=2;
    }
    if(stage===2 && group[0].frame>=240){group[0].request('reset');stage=3;}
    if(stage===3 && group.every(g=>g.epoch===1 && g.frame>=480)){group[0].request('pause');stage=4;}
    if(stage===4 && group.every(g=>g.paused))break;
    if(time%30===0)await new Promise(setImmediate);
    assert.equal(errors.length,0,errors.map(e=>e.message).join('; '));
  }
  await new Promise(setImmediate);time+=30;deliver();
  assert(time<6030,'Session failed to reach coordinated pause');
  assert.equal(stage,4);assert(group.every(g=>g.paused));
  assert.equal(group[0].frame,group[1].frame);
  assert.equal(group[0].epoch,1);assert.equal(group[1].epoch,1);
  assert.equal(await stateHash(group[0].nes),await stateHash(group[1].nes));
  assert.equal(errors.length,0);
  assert(verified.some(v=>v.epoch===1 && v.frame>=120),'Post-reset checksums must match');
  group.forEach(g=>g.close());
});
