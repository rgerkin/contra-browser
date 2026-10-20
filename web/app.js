import NES from './vendor/jsnes/src/nes.js';
import {Room} from './netplay/room.mjs';
import {GameSession} from './netplay/game-session.mjs';

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
let room=null, netgame=null;
let networkTimer=null;
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
  if(room)player=room.player || 1;
  const id = `${player}:${button}`;
  if (!inputs.has(id)) inputs.set(id, new Set());
  const held = inputs.get(id);
  down ? held.add(source) : held.delete(source);
  if (down && running) taps.add(id);
  if (rom && !room) nes[(held.size || taps.has(id)) && running ? 'buttonDown' : 'buttonUp'](player,button);
}
function release() {
  inputs.clear(); taps.clear();
  if(!room)for(let p=1;p<=2;p++) for(let b=0;b<8;b++) nes.buttonUp(p,b);
}
function clearAudio() { sampleCount = 0; node?.port.postMessage('clear'); }
function showState(text) { $('state').textContent=text; $('led').classList.toggle('live',running); }
function pause() {
  if(room?.started){requestCommand("pause");return;}
  stopLocal();
}
function stopLocal() {
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
  if(room){if(room.started)requestCommand("resume");return;}
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
  for(let p=1;p<=(room?1:2);p++) {
    const pad=connected[p-1];
    const pressed = i=>!!pad?.buttons[i]?.pressed;
    const state=[pressed(0),pressed(1)||pressed(2),pressed(8),pressed(9),
      pressed(12)||(pad?.axes[1]<-0.4),pressed(13)||(pad?.axes[1]>0.4),
      pressed(14)||(pad?.axes[0]<-0.4),pressed(15)||(pad?.axes[0]>0.4)];
    for(let b=0;b<8;b++) input('gamepad',p,b,!!state[b]);
  }
}
function tick(now, fromTimer=false) {
  if(!running) return;
  const interval=1000/60.0988;
  if(!previous) { previous=now; fpsTime=now; }
  accumulator += Math.min(now-previous,interval*3); previous=now;
  gamepads();
  try {
    while(accumulator>=interval) {
      if(room?.started) {
        if(!room.connected){room.fail(new Error('Peer disconnected'));return;}
        let mask=0;
        for(let b=0;b<8;b++){const id=`${room.player}:${b}`;if(inputs.get(id)?.size||taps.has(id))mask|=1<<b;}
        const result=netgame.step(mask);
        if(result.scheduled)taps.clear();
        if(!result.advanced){accumulator=Math.min(accumulator,interval);if(result.state==='waiting')showState('WAITING FOR PARTNER');clearAudio();break;}
        showState(`CO-OP / PLAYER ${room.player}`);
      } else nes.frame();
      frames++;accumulator-=interval;
      if(!room)taps.clear();
      if(!room)for (const [id, held] of inputs) {
        const [p,b]=id.split(':').map(Number);
        nes[held.size ? 'buttonDown' : 'buttonUp'](p,b);
      }
      if(sampleCount) {
        const l=sampleL.slice(0,sampleCount),r=sampleR.slice(0,sampleCount);
        node.port.postMessage([l,r],[l.buffer,r.buffer]); sampleCount=0;
      }
    }
    ctx.putImageData(image,0,0);
  } catch(err) { if(room){room.fail(err);return;}pause(); $('message').textContent=`Emulation stopped: ${err.message}`; return; }
  if(now-fpsTime>=1000) {
    $('fps').textContent=`${Math.round(frames*1000/(now-fpsTime))} FPS / NTSC`;
    frames=0;fpsTime=now;
  }
  if(!fromTimer)raf=requestAnimationFrame(tick);
}
async function load(buffer, rebuilt=false) {
  const bytes=new Uint8Array(buffer);
  if(bytes.length!==131088 || ![0x4e,0x45,0x53,0x1a,8,0,0x21,0,0,0,0,0,0,0,0,0].every((v,i)=>bytes[i]===v))
    throw new Error('Choose the original 131,088-byte Contra (US) iNES ROM.');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-512',buffer)),b=>b.toString(16).padStart(2,'0')).join('');
  if(hash!==EXPECTED) throw new Error('ROM hash mismatch. This cartridge is not the expected original Contra (US).');
  if(running) pause();
  if(room)throw new Error('Leave the room before changing cartridges.');
  rom=Array.from(bytes,b=>String.fromCharCode(b)).join('');
  nes.loadROM(rom); release(); clearAudio();
  $('play').disabled=false; $('pause').disabled=false; $('reset').disabled=false;
  $('play').textContent='PLAY CONTRA ↗'; $('overlay-title').innerText='Your next mission\nstarts here.';
  $('message').textContent=rebuilt?'Reassembled from source. Byte-for-byte verified. Press Play, then Enter to start.':'Original US cartridge verified. Press Play, then Enter to start.';
  $('provenance').textContent=rebuilt?'Rebuilt cartridge · SHA-512 verified':'Original cartridge · SHA-512 verified';
  $('overlay').hidden=false; showState('CARTRIDGE VERIFIED'); updateRoomButtons();
}
$('play').addEventListener('click',play);
$('pause').addEventListener('click',()=>room?.started?requestCommand(netgame.paused?'resume':'pause'):running?pause():play());
$('reset').addEventListener('click',()=>{
  if(room){if(room.started)requestCommand('reset');return;}
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
  if(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLButtonElement || e.ctrlKey || e.metaKey || e.altKey) return;
  if(e.code==='KeyP' && type==='keydown' && !e.repeat && rom) {room?.started?requestCommand(netgame.paused?'resume':'pause'):running?pause():play();return;}
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
window.addEventListener('blur',()=>{release();if(running&&!room)pause();});
document.addEventListener('visibilitychange',()=>{release();if(document.hidden&&running&&!room)pause();});
$('rom').addEventListener('change',async e=>{
  const file=e.target.files[0]; if(!file) return;
  try { if(file.size!==131088) throw new Error('Incorrect ROM size. Choose the original Contra (US) .nes file.'); await load(await file.arrayBuffer()); }
  catch(err) { $('provenance').textContent=err.message; }
  e.target.value='';
});

function updateRoomButtons() {
  $('host-room').disabled=!rom || !!room;
  $('join-room').disabled=!rom || !!room;
  $('leave-room').disabled=!room;
  $('ready-room').disabled=!room?.connected || room.ready;
  $('rom').disabled=!!room;$('net-transport').disabled=!!room;
  if(room && !room.started){$('play').disabled=true;$('pause').disabled=true;$('reset').disabled=true;}
}
function initializeNetwork() {
  running=false;release();clearAudio();
  const session=room;
  netgame=new GameSession({nes,rom,room:room.id,player:room.player,send:packet=>session.send(packet),
    onState:state=>{
      clearAudio();release();const paused=state==='paused';
      $('pause').textContent=paused?'Resume':'Pause';$('overlay').hidden=!paused;
      if(paused){$('overlay-title').textContent='Co-op paused.';$('message').textContent='Both players pause at the same frame.';$('play').textContent='RESUME CO-OP ↗';showState('CO-OP PAUSED');}
    },
    onVerified:({frame,hash})=>{
      $('net-detail').textContent=`Frame ${frame} synchronized • checksums match`;
      $('screen').dataset.netFrame=String(frame);$('screen').dataset.netHash=hash;
    },
    onFatal:error=>session.fail(error),
  });
  netgame.start();
  running=true;previous=0;accumulator=0;frames=0;fpsTime=0;
  $('overlay').hidden=true;$('pause').disabled=false;$('reset').disabled=false;$('play').disabled=false;
  $('pause').textContent='Pause';$('net-status').textContent=`Two-player mission active. You are player ${room.player}.`;
  $('screen').focus({preventScroll:true});
}
function requestCommand(action){try{netgame?.request(action);}catch(error){room?.fail(error);}}
function endRoom(message='Left room. Local play is available.') {
  const previousRoom=room;room=null;previousRoom?.close();netgame?.close();netgame=null;
  clearInterval(networkTimer);networkTimer=null;
  running=false;cancelAnimationFrame(raf);release();clearAudio();
  if(rom)nes.loadROM(rom);
  $('overlay').hidden=false;$('overlay-title').textContent='Ready for your next mission.';
  $('message').textContent=message;$('net-status').textContent=message;$('play').textContent='PLAY CONTRA ↗';
  $('play').disabled=!rom;$('pause').disabled=!rom;$('reset').disabled=!rom;
  $('pause').textContent='Pause';$('copy-invite').disabled=true;$('net-detail').textContent='Each player supplies their own ROM.';
  delete $('screen').dataset.netFrame;delete $('screen').dataset.netHash;showState('LOCAL PLAY');updateRoomButtons();
}
async function connectRoom(host) {
  if(!rom || room)return;
  if(!window.isSecureContext){$('net-status').textContent='Online co-op needs HTTPS or localhost.';return;}
  if(running)stopLocal();
  let session;
  session=new Room({fingerprint:EXPECTED,preferRelay:$('net-transport').value==='relay',
    onDiagnostic:message=>{if(room===session){const lines=$('net-diagnostics').textContent.split('\n');lines.push(message);$('net-diagnostics').textContent=lines.slice(-40).join('\n');}},
    onStatus:(message,link)=>{if(room!==session)return;$('net-status').textContent=message;if(link){$('invite').value=link;$('copy-invite').disabled=false;}updateRoomButtons();},
    onStart:()=>{if(room!==session)return;try{initializeNetwork();raf=requestAnimationFrame(tick);networkTimer=setInterval(()=>{if(document.hidden&&running&&room?.started)tick(performance.now(),true);},16);}catch(error){session.fail(error);}},
    onInput:(packet,player)=>{if(room===session)netgame?.input(packet,player);},
    onCommand:(packet,request)=>{if(room===session)netgame?.command(packet,request);},
    onHash:packet=>{if(room===session)netgame?.hash(packet);},
    onClose:message=>{if(room===session)endRoom(message);},
    onLatency:ms=>{if(room===session)$('net-status').textContent=`Player ${session.player} • ${session.relay?'server relay':'WebRTC'} • ${ms} ms round-trip`},
  });
  room=session;$('net-diagnostics').textContent='';updateRoomButtons();$('net-status').textContent='Connecting…';
  try {
    if(host)await session.host();
    else {
      const invitation=new URL($('invite').value.trim());
      if(invitation.origin!==location.origin || invitation.pathname!==location.pathname)throw new Error('Open the invitation at its original address, then load your ROM and join there.');
      const params=new URLSearchParams(invitation.hash.slice(1));
      if(!/^[A-Za-z0-9_-]{24}$/.test(params.get('room')||'') || !/^[A-Za-z0-9_-]{32}$/.test(params.get('invite')||''))throw new Error('Invalid invitation link');
      await session.join(params.get('room'),params.get('invite'));
    }
  } catch(error){if(room===session)session.fail(error);}
}
$('host-room').addEventListener('click',()=>connectRoom(true));
$('join-room').addEventListener('click',()=>connectRoom(false));
$('leave-room').addEventListener('click',()=>endRoom());
$('ready-room').addEventListener('click',async()=>{
  const session=room;
  if(!session?.connected)return;
  try{await ensureAudio();if(room===session){session.markReady();updateRoomButtons();if(!session.started)$('net-status').textContent='Ready. Waiting for your partner…';}}
  catch(error){$('net-status').textContent=`Audio could not start: ${error.message}`;}
});
$('copy-invite').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText($('invite').value);$('net-status').textContent='Invitation copied.';}
  catch{$('net-status').textContent='Select and copy the invitation link above.';}
});
if(location.hash.includes('room=')){$('invite').value=location.href;$('net-status').textContent='Invitation received. Load your ROM, then click Join invitation.';}

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
