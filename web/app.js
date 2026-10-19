import NES from './vendor/jsnes/src/nes.js';

const EXPECTED = '1c747c78c678f14a68d4e5fcae065298a103f833638775860f0e5c5ffaa061f62d45fd8942148b1507c1fd57fde950a5d83f9f84a9782ec048a56067740c48e9';
const $ = (id) => document.getElementById(id);
const canvas = $('canvas');
const ctx = canvas.getContext('2d', {alpha:false});
const image = ctx.createImageData(256, 240);
const pixels = new Uint32Array(image.data.buffer);
const keys = new Map([
  ['KeyX',[1,0]],['KeyZ',[1,1]],['ShiftRight',[1,2]],['ShiftLeft',[1,2]],['Enter',[1,3]],
  ['ArrowUp',[1,4]],['ArrowDown',[1,5]],['ArrowLeft',[1,6]],['ArrowRight',[1,7]],
  ['KeyH',[2,0]],['KeyG',[2,1]],['KeyR',[2,2]],['KeyT',[2,3]],
  ['KeyW',[2,4]],['KeyS',[2,5]],['KeyA',[2,6]],['KeyD',[2,7]],
]);
let rom = null, running = false, starting = false, muted = false;
let audio = null, node = null, gain = null, raf = 0, previous = 0, accumulator = 0;
let sampleCount = 0, frames = 0, fpsTime = 0;
const sampleL = new Float32Array(2048), sampleR = new Float32Array(2048);
const inputs = new Map();
const taps = new Set();
const nes = new NES({
  sampleRate:48000,
  onFrame(buffer) { for (let i=0;i<pixels.length;i++) pixels[i] = 0xff000000 | buffer[i]; },
  onAudioSample(left, right) {
    if (node && running && !muted && sampleCount < sampleL.length) {
      sampleL[sampleCount] = left; sampleR[sampleCount++] = right;
    }
  },
});
function input(source, player, button, down) {
  const id = `${player}:${button}`;
  if (!inputs.has(id)) inputs.set(id, new Set());
  const held = inputs.get(id);
  down ? held.add(source) : held.delete(source);
  if (down && running) taps.add(id);
  if (rom) nes[(held.size || taps.has(id)) && running ? 'buttonDown' : 'buttonUp'](player,button);
}
function release() {
  inputs.clear(); taps.clear();
  for(let p=1;p<=2;p++) for(let b=0;b<8;b++) nes.buttonUp(p,b);
}
function clearAudio() { sampleCount = 0; node?.port.postMessage('clear'); }
function showState(text) { $('state').textContent=text; $('led').classList.toggle('live',running); }
function pause() {
  running=false; cancelAnimationFrame(raf); release(); clearAudio();
  if (audio?.state==='running') audio.suspend().catch(console.warn);
  $('pause').textContent='Resume'; $('play').textContent='RESUME MISSION ↗';
  $('overlay-title').textContent='Mission paused.'; $('message').textContent='Take a breath. Resume when you’re ready.';
  $('overlay').hidden=false; showState('PAUSED');
}
async function ensureAudio() {
  if (!audio) {
    audio = new AudioContext({sampleRate:48000,latencyHint:'interactive'});
    const embedded = $('audio-source');
    const url = embedded ? URL.createObjectURL(new Blob([embedded.textContent], {type:'application/javascript'})) : './audio-worklet.js';
    try { await audio.audioWorklet.addModule(url); } finally { if (embedded) URL.revokeObjectURL(url); }
    node = new AudioWorkletNode(audio,'contra-audio',{outputChannelCount:[2]});
    gain = audio.createGain(); gain.gain.value=muted?0:0.65;
    node.connect(gain).connect(audio.destination);
  }
  await audio.resume();
}
async function play() {
  if (!rom || running || starting) return;
  starting=true;
  try { await ensureAudio(); } catch(err) {
    console.warn('Audio unavailable; playing silently.',err);
    if(audio) await audio.close().catch(()=>{});
    audio=null; node=null; gain=null;
  }
  starting=false;
  if (document.hidden) return;
  running=true; previous=0; accumulator=0; frames=0; fpsTime=0;
  $('overlay').hidden=true; $('pause').textContent='Pause'; showState('MISSION ACTIVE');
  $('screen').focus({preventScroll:true}); raf=requestAnimationFrame(tick);
}
function gamepads() {
  const pads = navigator.getGamepads?.() || [];
  const connected = Array.from(pads).filter(p=>p?.mapping==='standard').slice(0,2);
  for(let p=1;p<=2;p++) {
    const pad=connected[p-1];
    const pressed = i=>!!pad?.buttons[i]?.pressed;
    const state=[pressed(0),pressed(1)||pressed(2),pressed(8),pressed(9),
      pressed(12)||(pad?.axes[1]<-0.4),pressed(13)||(pad?.axes[1]>0.4),
      pressed(14)||(pad?.axes[0]<-0.4),pressed(15)||(pad?.axes[0]>0.4)];
    for(let b=0;b<8;b++) input('gamepad',p,b,!!state[b]);
  }
}
function tick(now) {
  if(!running) return;
  const interval=1000/60.0988;
  if(!previous) { previous=now; fpsTime=now; }
  accumulator += Math.min(now-previous,interval*3); previous=now;
  gamepads();
  try {
    while(accumulator>=interval) {
      nes.frame(); frames++; accumulator-=interval;
      taps.clear();
      for (const [id, held] of inputs) {
        const [p,b]=id.split(':').map(Number);
        nes[held.size ? 'buttonDown' : 'buttonUp'](p,b);
      }
      if(sampleCount) {
        const l=sampleL.slice(0,sampleCount),r=sampleR.slice(0,sampleCount);
        node.port.postMessage([l,r],[l.buffer,r.buffer]); sampleCount=0;
      }
    }
    ctx.putImageData(image,0,0);
  } catch(err) { pause(); $('message').textContent=`Emulation stopped: ${err.message}`; return; }
  if(now-fpsTime>=1000) {
    $('fps').textContent=`${Math.round(frames*1000/(now-fpsTime))} FPS / NTSC`;
    frames=0;fpsTime=now;
  }
  raf=requestAnimationFrame(tick);
}
async function load(buffer, rebuilt=false) {
  const bytes=new Uint8Array(buffer);
  if(bytes.length!==131088 || ![0x4e,0x45,0x53,0x1a,8,0,0x21,0,0,0,0,0,0,0,0,0].every((v,i)=>bytes[i]===v))
    throw new Error('Choose the original 131,088-byte Contra (US) iNES ROM.');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-512',buffer)),b=>b.toString(16).padStart(2,'0')).join('');
  if(hash!==EXPECTED) throw new Error('ROM hash mismatch. This cartridge is not the expected original Contra (US).');
  if(running) pause();
  rom=Array.from(bytes,b=>String.fromCharCode(b)).join('');
  nes.loadROM(rom); release(); clearAudio();
  $('play').disabled=false; $('pause').disabled=false; $('reset').disabled=false;
  $('play').textContent='PLAY CONTRA ↗'; $('overlay-title').innerText='Your next mission\nstarts here.';
  $('message').textContent=rebuilt?'Reassembled from source. Byte-for-byte verified. Press Play, then Enter to start.':'Original US cartridge verified. Press Play, then Enter to start.';
  $('provenance').textContent=rebuilt?'Rebuilt cartridge · SHA-512 verified':'Original cartridge · SHA-512 verified';
  $('overlay').hidden=false; showState('CARTRIDGE VERIFIED');
}
$('play').addEventListener('click',play);
$('pause').addEventListener('click',()=>running?pause():play());
$('reset').addEventListener('click',()=>{
  if(!rom) return;
  const wasRunning=running;
  if(wasRunning) pause();
  nes.loadROM(rom); release(); clearAudio();
  if(wasRunning) play();
  else { $('overlay-title').textContent='Fresh start.'; $('message').textContent='Cartridge reset. Resume to begin again.'; }
});
$('mute').addEventListener('click',()=>{
  muted=!muted; clearAudio(); if(gain) gain.gain.value=muted?0:0.65;
  $('mute').textContent=muted?'Sound off':'Sound on'; $('mute').setAttribute('aria-pressed',String(muted));
});
$('fullscreen').addEventListener('click',async()=>{
  try { document.fullscreenElement?await document.exitFullscreen():await $('screen').requestFullscreen(); }
  catch(err) { $('provenance').textContent='Fullscreen unavailable in this browser'; }
});
for(const type of ['keydown','keyup']) document.addEventListener(type,e=>{
  if(e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement || e.ctrlKey || e.metaKey || e.altKey) return;
  if(e.code==='KeyP' && type==='keydown' && !e.repeat && rom) { running?pause():play(); return; }
  const key=keys.get(e.code); if(!key || !running) return;
  e.preventDefault(); input(e.code,...key,type==='keydown');
});
for(const button of document.querySelectorAll('[data-key]')) {
  button.addEventListener('pointerdown',e=>{
    e.preventDefault(); button.setPointerCapture(e.pointerId);
    if(running) input(`touch:${e.pointerId}`,...keys.get(button.dataset.key),true);
  });
  for(const type of ['pointerup','pointercancel','lostpointercapture']) button.addEventListener(type,e=>{
    input(`touch:${e.pointerId}`,...keys.get(button.dataset.key),false);
  });
}
window.addEventListener('blur',()=>{release();if(running)pause();});
document.addEventListener('visibilitychange',()=>{if(document.hidden && running)pause();});
$('rom').addEventListener('change',async e=>{
  const file=e.target.files[0]; if(!file) return;
  try { if(file.size!==131088) throw new Error('Incorrect ROM size. Choose the original Contra (US) .nes file.'); await load(await file.arrayBuffer()); }
  catch(err) { $('provenance').textContent=err.message; }
  e.target.value='';
});
try {
  const embedded=$('cartridge');
  if(embedded) {
    const bytes=Uint8Array.from(atob(embedded.textContent.trim()),c=>c.charCodeAt(0));
    await load(bytes.buffer,true);
  } else {
  const response=await fetch('./game/manifest.json');
  if(!response.ok) throw new Error('No rebuilt cartridge yet. Load your original US ROM below, or run the local build first.');
  const manifest=await response.json();
  if(manifest.sha512!==EXPECTED || manifest.byteIdentical!==true) throw new Error('Build manifest verification failed. Rebuild the cartridge.');
  const cartridge=await fetch('./game/contra.nes');
  if(!cartridge.ok) throw new Error('Rebuilt cartridge missing. Run the local build.');
  await load(await cartridge.arrayBuffer(),true);
  }
} catch(err) { $('message').textContent=err.message; $('provenance').textContent='Awaiting cartridge'; showState('AWAITING CARTRIDGE'); }
