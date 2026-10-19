// Exercise the rebuilt game using the exact packaged emulator implementation.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
// UMD is CommonJS syntax but its package is ESM: load it from a .cjs copy.
fs.mkdirSync(new URL('../build/',import.meta.url),{recursive:true});
fs.copyFileSync(new URL('../web/vendor/jsnes/dist/jsnes.min.js',import.meta.url),new URL('../build/jsnes.cjs',import.meta.url));
const {NES}=require('../build/jsnes.cjs');
let samples=0,lastFrame;
const nes=new NES({sampleRate:48000,onFrame:f=>lastFrame=f,onAudioSample:(l,r)=>{assert(Number.isFinite(l)&&Number.isFinite(r));samples++;}});
const rom=fs.readFileSync(new URL('../web/game/contra.nes',import.meta.url)).toString('latin1');
nes.loadROM(rom);
let totalFrames=0;
function step(n){for(let i=0;i<n;i++){nes.frame();totalFrames++;}}
const start=performance.now();
step(600);
const title=nes.cpu.mem[0x18];
nes.buttonDown(1,3);step(2);nes.buttonUp(1,3);step(240);
const active=nes.cpu.mem[0x18];
for(let i=0;i<600 && (nes.cpu.mem[0x2c]!==4 || nes.cpu.mem[0x90]!==1);i++) step(1);
console.log('control state',{routine:nes.cpu.mem[0x18],level:nes.cpu.mem[0x2c],player:nes.cpu.mem[0x90],demo:nes.cpu.mem[0x1c]});
const before=nes.cpu.mem[0x334];
nes.buttonDown(1,7);nes.buttonDown(1,1);step(24);
const moved=nes.cpu.mem[0x334];
const bullets=nes.cpu.mem.slice(0x438,0x448).filter(Boolean).length;
assert.notEqual(moved,before,'Right must move player');
assert(bullets>0,'Fire must create bullets');
step(66);nes.buttonUp(1,7);nes.buttonUp(1,1);
nes.buttonDown(1,0);step(10);
const jump=nes.cpu.mem[0xa0];
assert.notEqual(jump,0,'Jump must set jump state');
nes.buttonUp(1,0);step(50);
const elapsed=performance.now()-start;
assert(!nes.crashed);assert(lastFrame?.length===256*240);assert(new Set(lastFrame).size>8);assert(samples>100000);assert.equal(active,5,'Start must enter gameplay');
const report={frames:totalFrames,elapsedMs:Math.round(elapsed),throughputFps:Math.round(totalFrames*1000/elapsed),titleRoutine:title,gameplayRoutine:active,movement:{before,after:moved},bullets,jump,audioSamples:samples,colors:new Set(lastFrame).size,crashed:nes.crashed};
fs.mkdirSync(new URL('../output/',import.meta.url),{recursive:true});
fs.writeFileSync(new URL('../output/core-test.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(report);
