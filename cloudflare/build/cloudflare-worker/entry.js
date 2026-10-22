var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/entry.mjs
import { DurableObject } from "cloudflare:workers";

// src/auth.mjs
var encoder = new TextEncoder();
var COOKIE = "contra_session";
var hours = 8 * 60 * 60;
var equal = /* @__PURE__ */ __name((a, b) => {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}, "equal");
var hex = /* @__PURE__ */ __name((bytes) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join(""), "hex");
var sha = /* @__PURE__ */ __name(async (value) => hex(await crypto.subtle.digest("SHA-256", encoder.encode(value))), "sha");
async function signature(payload, secret) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}
__name(signature, "signature");
async function sessionCookie(secret, now = Date.now()) {
  const payload = `${Math.floor(now / 1e3) + hours}.${crypto.randomUUID()}`;
  return `${COOKIE}=${payload}.${await signature(payload, secret)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${hours}`;
}
__name(sessionCookie, "sessionCookie");
async function authenticated(request, secret, now = Date.now()) {
  const value = (request.headers.get("Cookie") || "").split(";").map((v) => v.trim()).find((v) => v.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1);
  if (!value || value.length > 200) return false;
  const [expiry, nonce, mac, ...extra] = value.split(".");
  if (extra.length || !/^\d{10}$/.test(expiry || "") || !/^[-a-f0-9]{36}$/.test(nonce || "") || !Number.isSafeInteger(Number(expiry)) || Number(expiry) <= Math.floor(now / 1e3) || Number(expiry) > Math.floor(now / 1e3) + hours || !/^[a-f0-9]{64}$/.test(mac || "")) return false;
  return equal(mac, await signature(`${expiry}.${nonce}`, secret));
}
__name(authenticated, "authenticated");
function loginPage(error = false) {
  return `<!doctype html><html lang="en"><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><title>Contra \xB7 Private game</title><style>body{background:#111511;color:#eee;font:18px system-ui;max-width:420px;margin:15vh auto;padding:24px}input,button{font:inherit;padding:12px;box-sizing:border-box;width:100%;margin:12px 0}button{cursor:pointer}p{color:#b9c5b5}</style><h1>Contra</h1><p>Enter the shared game password.</p>${error ? '<p role="alert">Password not accepted. Try again.</p>' : ""}<form method="post" action="/login"><label>Password<input name="password" type="password" autocomplete="current-password" maxlength="256" required autofocus></label><button>Open game</button></form></html>`;
}
__name(loginPage, "loginPage");
async function boundedText(request, max) {
  if (Number(request.headers.get("Content-Length")) > max) throw new Error("Request too large");
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  try {
    for (; ; ) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        throw new Error("Request too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
__name(boundedText, "boundedText");

// src/room-state.mjs
var RoomError = class extends Error {
  static {
    __name(this, "RoomError");
  }
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
function randomToken(bytes = 24) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
__name(randomToken, "randomToken");
var RoomState = class {
  static {
    __name(this, "RoomState");
  }
  constructor(state, now, hash, token) {
    Object.assign(this, { state, now, hash, token });
  }
  create(players, room) {
    if (this.state) throw new RoomError(409, "Room already exists");
    if (![2, 3, 4].includes(players)) throw new RoomError(400, "Expected 2, 3 or 4 players");
    const token = this.token(), invite = this.token();
    this.state = { room, players, invite: this.hash(invite), tokens: { 1: this.hash(token) }, offers: {}, answers: {}, expires: this.now + 30 * 60 * 1e3 };
    return { room, players, player: 1, token, invite };
  }
  live() {
    if (!this.state || this.state.expires <= this.now) throw new RoomError(404, "Room expired or not found");
    return this.state;
  }
  join(invite) {
    const s = this.live();
    if (typeof invite !== "string" || invite.length !== 32 || !equal(this.hash(invite), s.invite)) throw new RoomError(404, "Invitation not found");
    const player = Object.keys(s.tokens).length + 1;
    if (player > s.players) throw new RoomError(409, "Room is full");
    const token = this.token();
    s.tokens[player] = this.hash(token);
    s.expires = this.now + 30 * 60 * 1e3;
    return { room: s.room, players: s.players, player, token };
  }
  authorize(token) {
    const s = this.live();
    if (typeof token !== "string" || token.length !== 32) throw new RoomError(403, "Invalid room credentials");
    const hashed = this.hash(token), player = Number(Object.keys(s.tokens).find((p) => equal(s.tokens[p], hashed)) || 0);
    if (!player) throw new RoomError(403, "Invalid room credentials");
    return player;
  }
  access(token, body2) {
    const player = this.authorize(token), s = this.live();
    if (body2) {
      const { to, description } = body2;
      if (!Number.isInteger(to) || to < 1 || to > s.players || to === player || player !== 1 && to !== 1 || !s.tokens[to]) throw new RoomError(400, "Invalid signaling recipient");
      const type = player === 1 ? "offer" : "answer";
      if (!description || description.type !== type || typeof description.sdp !== "string" || !description.sdp.length || description.sdp.length > 6e4) throw new RoomError(400, "Invalid session description");
      const table = player === 1 ? s.offers : s.answers, key = player === 1 ? to : player;
      if (table[key] && JSON.stringify(table[key]) !== JSON.stringify(description)) throw new RoomError(409, "Description already set; create a new room");
      table[key] = { type, sdp: description.sdp };
    }
    s.expires = this.now + 30 * 60 * 1e3;
    return { player, players: s.players, roster: Object.keys(s.tokens).map(Number), offers: player === 1 ? s.offers : { [player]: s.offers[player] }, answers: player === 1 ? s.answers : {}, directOnly: true };
  }
};
async function prepareAction(method, args) {
  if (!["create", "join", "access"].includes(method)) throw new RoomError(400, "Unknown action");
  const tokens = [randomToken(), randomToken()], values = [...tokens];
  if (["join", "access"].includes(method) && typeof args[0] === "string" && args[0].length === 32) values.push(args[0]);
  const hashes = new Map(await Promise.all(values.map(async (value) => [value, await sha(value)])));
  return (state, now) => {
    const generated = [...tokens], model = new RoomState(state, now, (value) => hashes.get(value), () => generated.shift());
    const result = model[method](...args);
    return { result, state: model.state };
  };
}
__name(prepareAction, "prepareAction");

// ../build/cloudflare-assets.inline.json
var cloudflare_assets_inline_default = { "/index.html": { text: '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n  <meta name="theme-color" content="#111311">\n  <title>Contra \xB7 Field console</title>\n  <link rel="icon" href="data:,">\n  <link rel="stylesheet" href="style.css">\n  <script type="module" src="app.js"><\/script>\n</head>\n<body>\n  <main>\n    <header><a class="wordmark" href="/">C<span>\u2197</span> FIELD CONSOLE</a><span class="edition">NES / 1988 <i>\u2022</i> US EDITION</span></header>\n    <section class="intro"><div><p class="eyebrow">OPERATION 01 / REASSEMBLED</p><h1>CONTRA<span>\xAE</span></h1><p class="subtitle">Up to four commandos. One shared mission.</p></div><div class="stamp">LOCAL PLAY<br><strong>NO QUARTERS<br>REQUIRED.</strong></div></section>\n    <label class="invite-label mode-select">Players (local or online)<select id="player-count"><option value="2">Original / 1\u20132 players</option><option value="3">3-player squad (experimental)</option><option value="4">4-player squad (experimental)</option></select></label>\n    <section class="net-panel" aria-label="Online co-op">\n      <div><p class="eyebrow">ONLINE CO-OP / UP TO FOUR PLAYERS</p><p id="net-status" role="status">Load your ROM, then create a room or open an invitation.</p></div>\n      <label class="invite-label">Connection<select id="net-transport"><option value="auto">Automatic (direct, then server relay)</option><option value="relay">Server relay (works through firewalls)</option></select></label>\n      <div class="net-buttons"><button id="host-room" disabled>Create room</button><button id="ready-room" disabled>Ready</button><button id="leave-room" disabled>Leave room</button></div>\n      <label class="invite-label">Invitation link<input id="invite" type="text" placeholder="Paste your partner\u2019s invitation link" autocomplete="off" spellcheck="false"></label>\n      <div class="net-buttons"><button id="join-room" disabled>Join invitation</button><button id="copy-invite" disabled>Copy invitation</button><span id="net-detail">Every browser verifies the same US cartridge.</span></div>\n      <p class="net-help">The room link must use the same reachable server. For internet play, host this app at an HTTPS address and automatic server relay is available when direct connections fail. For subnet testing, start with --lan-address and share that IP address. Localhost links work only on this computer. Three- and four-player squads use the server relay.</p>\n      <details><summary>Connection details</summary><pre id="net-diagnostics">No connection yet.</pre></details>\n    </section>\n    <section class="console" aria-label="Game console">\n      <div class="console-bar"><span><b class="led" id="led"></b><span id="state">STANDBY</span></span><span id="fps">256 \xD7 240 / NTSC</span></div>\n      <div id="screen" tabindex="0" aria-label="Contra game screen. Arrow keys move, Z fires, X jumps, Enter starts.">\n        <canvas id="canvas" width="256" height="240" aria-label="NES video output"></canvas>\n        <div id="overlay"><p class="eyebrow">READY WHEN YOU ARE</p><h2 id="overlay-title">Your next mission<br>starts here.</h2><p id="message" role="status">Checking for a rebuilt cartridge\u2026</p><button id="play" disabled>PLAY CONTRA <span>\u2197</span></button></div>\n      </div>\n      <div id="squad" class="squad" hidden><span id="player-status-1"></span><span id="player-status-2"></span><span id="player-status-3"></span><span id="player-status-4"></span></div>\n      <div class="toolbar"><div><button id="pause" disabled>Pause</button><button id="reset" disabled>Reset</button></div><div><button id="mute" aria-pressed="false">Sound on</button><button id="fullscreen">Fullscreen \u2197</button></div></div>\n    </section>\n    <section class="touch" aria-label="Touch controller"><div class="dpad"><button data-key="ArrowUp" aria-label="Move up">\u2191</button><button data-key="ArrowLeft" aria-label="Move left">\u2190</button><button data-key="ArrowDown" aria-label="Move down">\u2193</button><button data-key="ArrowRight" aria-label="Move right">\u2192</button></div><div class="middle"><button data-key="ShiftRight">SELECT</button><button data-key="Enter">START</button></div><div class="actions"><button data-key="KeyZ">B<span>FIRE</span></button><button data-key="KeyX">A<span>JUMP</span></button></div></section>\n    <section class="briefing"><div><p class="eyebrow">KNOW YOUR CONTROLS</p><h2>Go in prepared.</h2></div><div class="controls"><p><kbd>\u2191</kbd><kbd>\u2190</kbd><kbd>\u2193</kbd><kbd>\u2192</kbd><span>Move / aim</span></p><p><kbd>Z</kbd><span>Fire</span><kbd>X</kbd><span>Jump</span></p><p><kbd>Enter</kbd><span>Start / in-game pause</span></p><p><kbd>Shift</kbd><span>Select / switch to 2 players</span></p></div><p class="controller-note">Gamepad ready.<br><span>Standard USB & Bluetooth controllers. Player 2: WASD, G fire, H jump. Player 3: IJKL, N fire, M jump. Player 4: numpad 8/4/5/6, 0 fire, decimal jump. Online: everyone uses arrows/Z/X for their assigned player.</span></p></section>\n    <footer><div><span class="verified">\u25C8</span><span id="provenance">Local cartridge \xB7 source verified</span></div><label class="load">Load original US ROM<input id="rom" type="file" accept=".nes" aria-label="Load original Contra US ROM"></label></footer>\n  </main>\n</body>\n</html>\n', type: "text/html; charset=utf-8" }, "/style.css": { text: ":root{color-scheme:dark;font-family:Arial,Helvetica,sans-serif;background:#111311;color:#e7e9de;--muted:#858c7c;--orange:#ef7349;--green:#b7c595}*{box-sizing:border-box}body{margin:0}main{width:min(1040px,92%);margin:0 auto}header{height:90px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #30352b}.wordmark{font-size:12px;letter-spacing:2px;color:#d7ddcb;text-decoration:none;font-weight:700}.wordmark span{color:var(--orange);margin:0 14px 0 4px}.edition{font:10px monospace;letter-spacing:1px;color:var(--muted)}.edition i{color:var(--orange);margin:0 10px}.intro{display:flex;justify-content:space-between;align-items:center;padding:44px 0 34px}.eyebrow{color:var(--orange);font:10px monospace;letter-spacing:2px;margin:0 0 18px}h1{font-family:Impact,'Arial Black',sans-serif;font-size:clamp(62px,10vw,108px);font-style:italic;letter-spacing:-2px;line-height:.95;margin:0}h1 span{vertical-align:top;font:18px Arial;margin-left:8px}.subtitle{color:#9ca38e;font-size:14px;margin:20px 0 0}.stamp{font:9px monospace;letter-spacing:1px;line-height:1.8;border-left:2px solid var(--orange);padding:8px 0 8px 20px;color:var(--muted)}.stamp strong{display:block;margin-top:10px;color:#c8cebb;font-size:13px;line-height:1.4}.console{border:1px solid #3a4133;background:#181c16;box-shadow:0 20px 70px #0005}.console-bar{height:41px;border-bottom:1px solid #333a2c;display:flex;justify-content:space-between;align-items:center;padding:0 20px;font:10px monospace;letter-spacing:1px;color:var(--muted)}.led{display:inline-block;width:6px;height:6px;border-radius:50%;background:#69715e;margin-right:9px}.led.live{background:var(--green);box-shadow:0 0 10px #b7c59566}#screen{height:min(64vh,640px);min-height:280px;position:relative;display:flex;align-items:center;justify-content:center;background:#050705;outline:none}canvas{height:100%;width:auto;max-width:100%;object-fit:contain;image-rendering:pixelated}#overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:radial-gradient(ellipse at center,#222b1d 0%,#0d110c 65%);padding:20px}#overlay[hidden]{display:none}#overlay h2{font-size:clamp(24px,4vw,43px);line-height:1.15;letter-spacing:-1px;margin:0 0 18px}#message{max-width:430px;color:#9ca58e;font-size:13px;line-height:1.6;margin:0 0 26px}button{cursor:pointer;font:inherit}button:disabled{cursor:default;opacity:.4}#play{background:var(--orange);border:0;color:#13170f;padding:16px 24px;min-width:210px;font-size:11px;font-weight:700;letter-spacing:1px}#play span{margin-left:40px}button:hover:not(:disabled){filter:brightness(1.2)}button:focus-visible,a:focus-visible,input:focus-visible{outline:2px solid var(--orange);outline-offset:4px}.toolbar{display:flex;justify-content:space-between;padding:10px 14px;border-top:1px solid #333a2c}.toolbar button{background:transparent;border:0;color:#a8b098;font-size:11px;padding:10px}.briefing{display:grid;grid-template-columns:1fr 1.5fr 1fr;gap:30px;padding:36px 0}.briefing h2{margin:0;font-size:23px;letter-spacing:-.5px}.briefing .eyebrow{color:var(--muted);font-size:9px}.controls p{display:flex;align-items:center;gap:5px;font-size:11px;margin:0 0 10px}.controls span{color:#9ca38e;margin:0 10px}kbd{border:1px solid #3e4636;border-bottom-width:2px;min-width:23px;padding:5px;text-align:center;font:10px monospace;border-radius:3px}.controller-note{margin:0;font-size:12px;line-height:1.7;color:var(--green)}.controller-note span{font-size:11px;color:var(--muted)}footer{border-top:1px solid #30352b;padding:23px 0 30px;display:flex;align-items:center;justify-content:space-between;font:10px monospace;color:var(--muted);gap:16px}.verified{color:var(--green);margin-right:8px}.load{cursor:pointer;color:#b7c595;text-decoration:underline;text-underline-offset:4px;position:relative;white-space:nowrap}.load input{position:absolute;inset:0;opacity:0;width:100%;cursor:pointer}.touch{display:none;justify-content:space-between;align-items:center;padding:25px 4px;gap:12px}.touch button{touch-action:none;user-select:none;-webkit-user-select:none;border:1px solid #424a38;background:#22291e;color:#c6d1b3;border-radius:6px;min-height:46px;min-width:46px}.dpad{display:grid;grid-template-columns:repeat(3,42px);gap:4px}.dpad button{min-width:42px}.dpad button:first-child{grid-column:2}.dpad button:nth-child(2){grid-column:1}.middle{display:flex;gap:6px}.middle button{font:8px monospace;min-width:44px}.actions{display:flex;gap:8px}.actions button{background:#aa4d31;border-radius:50%;width:52px;height:52px;font-weight:bold}.actions span{display:block;font:8px monospace;margin-top:4px}#screen:fullscreen{height:100vh;background:#000}#screen:fullscreen canvas{max-width:100vw;max-height:100vh}@media(pointer:coarse){.touch{display:flex}}@media(max-width:700px){header{height:65px}.edition{font-size:8px}.stamp{display:none}.intro{padding:30px 0}#screen{height:auto;aspect-ratio:256/240;min-height:0}.briefing{grid-template-columns:1fr;gap:22px}.controller-note{display:none}.touch{display:flex}.toolbar{padding:6px}footer{font-size:9px;align-items:flex-start}footer>div{max-width:55%}.eyebrow{font-size:9px}#overlay .eyebrow{display:none}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}\n\n.net-panel{margin:0 0 24px;padding:22px;border:1px solid #3a4133;background:#181c16;display:grid;gap:14px}.net-panel .eyebrow{margin-bottom:10px}.net-panel p{margin:0;color:#a8b098;font-size:12px;line-height:1.6}.net-buttons{display:flex;flex-wrap:wrap;align-items:center;gap:10px}.net-buttons button{padding:10px 16px;border:1px solid #566047;background:#252e1e;color:#d1ddbf;font-size:12px}.invite-label{font-size:11px;color:#a8b098;display:grid;gap:8px}.invite-label input{width:100%;padding:12px;background:#10150d;border:1px solid #3a4133;color:#d1ddbf;font:12px monospace}#net-detail{font:10px monospace;color:#b7c595}.net-panel .net-help{font-size:10px;color:#858c7c}.net-panel[hidden]{display:none}\n\n.net-panel details{font:10px monospace;color:#9ca38e}.net-panel summary{cursor:pointer}#net-diagnostics{white-space:pre-wrap;line-height:1.6;max-height:180px;overflow:auto}\n\n.invite-label select{padding:10px;background:#10150d;border:1px solid #3a4133;color:#d1ddbf;font:12px Arial}\n\n.mode-select{display:block;margin:0 0 20px;max-width:420px}.squad{display:flex;flex-wrap:wrap;gap:12px;padding:12px 18px;background:#111;font:12px monospace}.squad[hidden]{display:none}.squad span:nth-child(1){color:#879fff}.squad span:nth-child(2){color:#ff867e}.squad span:nth-child(3){color:#70dc68}.squad span:nth-child(4){color:#f4d052}\n", type: "text/css; charset=utf-8" }, "/app.js": { text: "import {FourPlayer} from './gameplay/four-player.mjs';\nimport {prepareTwoPlayerGame} from './netplay/game.mjs';\nimport {digestHex} from './netplay/digest.mjs';\nimport {DirectRoom} from './netplay/direct-room.mjs';\nimport {PartyRoom} from './netplay/party-room.mjs';\nimport NES from './vendor/jsnes/src/nes.js';\nimport {Room} from './netplay/room.mjs';\nimport {GameSession} from './netplay/game-session.mjs';\n\nconst EXPECTED = '1c747c78c678f14a68d4e5fcae065298a103f833638775860f0e5c5ffaa061f62d45fd8942148b1507c1fd57fde950a5d83f9f84a9782ec048a56067740c48e9';\nconst $ = (id) => document.getElementById(id);\nconst canvas = $('canvas');\nconst ctx = canvas.getContext('2d', {alpha:false});\nconst image = ctx.createImageData(256, 240);\nconst pixels = new Uint32Array(image.data.buffer);\nconst keys = new Map([\n  ['KeyX',[1,0]],['KeyZ',[1,1]],['ShiftRight',[1,2]],['ShiftLeft',[1,2]],['Enter',[1,3]],\n  ['ArrowUp',[1,4]],['ArrowDown',[1,5]],['ArrowLeft',[1,6]],['ArrowRight',[1,7]],\n  ['KeyH',[2,0]],['KeyG',[2,1]],['KeyR',[2,2]],['KeyT',[2,3]],\n  ['KeyM',[3,0]],['KeyN',[3,1]],['KeyI',[3,4]],['KeyK',[3,5]],['KeyJ',[3,6]],['KeyL',[3,7]],\n  ['NumpadDecimal',[4,0]],['Numpad0',[4,1]],['Numpad8',[4,4]],['Numpad5',[4,5]],['Numpad4',[4,6]],['Numpad6',[4,7]],\n  ['KeyW',[2,4]],['KeyS',[2,5]],['KeyA',[2,6]],['KeyD',[2,7]],\n]);\nlet rom = null, running = false, starting = false, muted = false;\nlet audio = null, node = null, gain = null, raf = 0, previous = 0, accumulator = 0;\nlet sampleCount = 0, frames = 0, fpsTime = 0;\nconst sampleL = new Float32Array(2048), sampleR = new Float32Array(2048);\nconst inputs = new Map();\nconst taps = new Set();\nlet room=null, netgame=null;\nlet deployment={directOnly:false};\nlet networkTimer=null;\nconst nes = new NES({\n  sampleRate:48000,\n  onFrame(buffer) { for (let i=0;i<pixels.length;i++) pixels[i] = 0xff000000 | buffer[i]; },\n  onAudioSample(left, right) {\n    if (node && running && !muted && sampleCount < sampleL.length) {\n      sampleL[sampleCount] = left; sampleR[sampleCount++] = right;\n    }\n  },\n});\nfunction input(source, player, button, down) {\n  if(room)player=room.player || 1;\n  const id = `${player}:${button}`;\n  if (!inputs.has(id)) inputs.set(id, new Set());\n  const held = inputs.get(id);\n  down ? held.add(source) : held.delete(source);\n  if (down && running) taps.add(id);\n  if (rom && !room && nes.controllers[player]) nes[(held.size || taps.has(id)) && running ? 'buttonDown' : 'buttonUp'](player,button);\n}\nfunction release() {\n  inputs.clear(); taps.clear();\n  if(nes.fourPlayer)nes.fourPlayer.setInputs(Array(nes.fourPlayer.count).fill(0));\n  if(!room)for(let p=1;p<=2;p++) for(let b=0;b<8;b++) nes.buttonUp(p,b);\n}\nfunction clearAudio() { sampleCount = 0; node?.port.postMessage('clear'); }\nfunction showState(text) { $('state').textContent=text; $('led').classList.toggle('live',running); }\nfunction pause() {\n  if(room?.started){requestCommand(\"pause\");return;}\n  stopLocal();\n}\nfunction stopLocal() {\n  running=false; cancelAnimationFrame(raf); release(); clearAudio();\n  if (audio?.state==='running') audio.suspend().catch(console.warn);\n  $('pause').textContent='Resume'; $('play').textContent='RESUME MISSION \u2197';\n  $('overlay-title').textContent='Mission paused.'; $('message').textContent='Take a breath. Resume when you\u2019re ready.';\n  $('overlay').hidden=false; showState('PAUSED');\n}\nasync function ensureAudio() {\n  if (!audio) {\n    audio = new AudioContext({sampleRate:48000,latencyHint:'interactive'});\n    const embedded = $('audio-source');\n    const url = embedded ? URL.createObjectURL(new Blob([embedded.textContent], {type:'application/javascript'})) : './audio-worklet.js';\n    if(audio.audioWorklet) {\n      try { await audio.audioWorklet.addModule(url); } finally { if (embedded) URL.revokeObjectURL(url); }\n      node = new AudioWorkletNode(audio,'contra-audio',{outputChannelCount:[2]});\n    } else {\n      if(embedded)URL.revokeObjectURL(url);\n      node=audio.createScriptProcessor(1024,0,2);\n      const left=new Float32Array(8192),right=new Float32Array(8192);let read=0,write=0;\n      node.port={postMessage:data=>{if(data==='clear'){read=write=0;return;}for(let i=0;i<data[0].length;i++){left[write%8192]=data[0][i];right[write%8192]=data[1][i];write++;if(write-read>8192)read=write-8192;}}};\n      node.onaudioprocess=event=>{const l=event.outputBuffer.getChannelData(0),r=event.outputBuffer.getChannelData(1);for(let i=0;i<l.length;i++){const have=read<write;l[i]=have?left[read%8192]:0;r[i]=have?right[read%8192]:0;if(have)read++;}};\n    }\n    gain = audio.createGain(); gain.gain.value=muted?0:0.65;\n    node.connect(gain).connect(audio.destination);\n  }\n  await audio.resume();\n}\nasync function play() {\n  if(room){if(room.started)requestCommand(\"resume\");return;}\n  if (!rom || running || starting) return;\n  starting=true;\n  try { await ensureAudio(); } catch(err) {\n    console.warn('Audio unavailable; playing silently.',err);\n    if(audio) await audio.close().catch(()=>{});\n    audio=null; node=null; gain=null;\n  }\n  starting=false;\n  if (document.hidden) return;\n  running=true; previous=0; accumulator=0; frames=0; fpsTime=0;\n  $('overlay').hidden=true; $('pause').textContent='Pause'; showState('MISSION ACTIVE');\n  $('screen').focus({preventScroll:true}); raf=requestAnimationFrame(tick);\n}\nfunction gamepads() {\n  const pads = navigator.getGamepads?.() || [];\n  const connected = Array.from(pads).filter(p=>p?.mapping==='standard').slice(0,Number($('player-count').value));\n  for(let p=1;p<=(room?1:Number($('player-count').value));p++) {\n    const pad=connected[p-1];\n    const pressed = i=>!!pad?.buttons[i]?.pressed;\n    const state=[pressed(0),pressed(1)||pressed(2),pressed(8),pressed(9),\n      pressed(12)||(pad?.axes[1]<-0.4),pressed(13)||(pad?.axes[1]>0.4),\n      pressed(14)||(pad?.axes[0]<-0.4),pressed(15)||(pad?.axes[0]>0.4)];\n    for(let b=0;b<8;b++) input('gamepad',p,b,!!state[b]);\n  }\n}\nfunction tick(now, fromTimer=false) {\n  if(!running) return;\n  const interval=1000/60.0988;\n  if(!previous) { previous=now; fpsTime=now; }\n  accumulator += Math.min(now-previous,interval*3); previous=now;\n  gamepads();\n  try {\n    while(accumulator>=interval) {\n      if(room?.started) {\n        if(!room.connected){room.fail(new Error('Peer disconnected'));return;}\n        let mask=0;\n        for(let b=0;b<8;b++){const id=`${room.player}:${b}`;if(inputs.get(id)?.size||taps.has(id))mask|=1<<b;}\n        const result=netgame.step(mask);\n        if(result.scheduled)taps.clear();\n        if(!result.advanced){accumulator=Math.min(accumulator,interval);if(result.state==='waiting')showState('WAITING FOR SQUAD');clearAudio();break;}\n        showState(`CO-OP / PLAYER ${room.player}`);\n      } else {\n        if(nes.fourPlayer)nes.fourPlayer.setInputs(Array.from({length:nes.fourPlayer.count},(_,p)=>{let mask=0;for(let b=0;b<8;b++)if(inputs.get(`${p+1}:${b}`)?.size||taps.has(`${p+1}:${b}`))mask|=1<<b;return mask;}));\n        nes.frame();\n      }\n      frames++;accumulator-=interval;\n      if(!room)taps.clear();\n      if(!room)for (const [id, held] of inputs) {\n        const [p,b]=id.split(':').map(Number);\n        if(nes.controllers[p])nes[held.size ? 'buttonDown' : 'buttonUp'](p,b);\n      }\n      if(sampleCount) {\n        const l=sampleL.slice(0,sampleCount),r=sampleR.slice(0,sampleCount);\n        node.port.postMessage([l,r],[l.buffer,r.buffer]); sampleCount=0;\n      }\n    }\n    ctx.putImageData(image,0,0);updateSquad();\n  } catch(err) { if(room){room.fail(err);return;}pause(); $('message').textContent=`Emulation stopped: ${err.message}`; return; }\n  if(now-fpsTime>=1000) {\n    $('fps').textContent=`${Math.round(frames*1000/(now-fpsTime))} FPS / NTSC`;\n    frames=0;fpsTime=now;\n  }\n  if(!fromTimer)raf=requestAnimationFrame(tick);\n}\nasync function load(buffer, rebuilt=false, peer=false) {\n  const bytes=new Uint8Array(buffer);\n  if(bytes.length!==131088 || ![0x4e,0x45,0x53,0x1a,8,0,0x21,0,0,0,0,0,0,0,0,0].every((v,i)=>bytes[i]===v))\n    throw new Error('Choose the original 131,088-byte Contra (US) iNES ROM.');\n  const hash=await digestHex('SHA-512',bytes);\n  if(hash!==EXPECTED) throw new Error('ROM hash mismatch. This cartridge is not the expected original Contra (US).');\n  if(running) pause();\n  if(room && !(peer && !room.started && room.player!==1))throw new Error('Leave the room before changing cartridges.');\n  rom=Array.from(bytes,b=>String.fromCharCode(b)).join('');\n  resetLocalGame(); release(); clearAudio();\n  $('play').disabled=false; $('pause').disabled=false; $('reset').disabled=false;\n  $('play').textContent='PLAY CONTRA \u2197'; $('overlay-title').innerText='Your next mission\\nstarts here.';\n  $('message').textContent=rebuilt?'Reassembled from source. Byte-for-byte verified. Press Play, then Enter to start.':'Original US cartridge verified. Press Play, then Enter to start.';\n  $('provenance').textContent=rebuilt?'Rebuilt cartridge \xB7 SHA-512 verified':'Original cartridge \xB7 SHA-512 verified';\n  $('overlay').hidden=false; showState('CARTRIDGE VERIFIED'); updateRoomButtons();\n}\n$('play').addEventListener('click',play);\n$('pause').addEventListener('click',()=>room?.started?requestCommand(netgame.paused?'resume':'pause'):running?pause():play());\n$('reset').addEventListener('click',()=>{\n  if(room){if(room.started)requestCommand('reset');return;}\n  if(!rom) return;\n  const wasRunning=running;\n  if(wasRunning) pause();\n  resetLocalGame(); release(); clearAudio();\n  if(wasRunning) play();\n  else { $('overlay-title').textContent='Fresh start.'; $('message').textContent='Cartridge reset. Resume to begin again.'; }\n});\n$('mute').addEventListener('click',()=>{\n  muted=!muted; clearAudio(); if(gain) gain.gain.value=muted?0:0.65;\n  $('mute').textContent=muted?'Sound off':'Sound on'; $('mute').setAttribute('aria-pressed',String(muted));\n});\n$('fullscreen').addEventListener('click',async()=>{\n  try { document.fullscreenElement?await document.exitFullscreen():await $('screen').requestFullscreen(); }\n  catch(err) { $('provenance').textContent='Fullscreen unavailable in this browser'; }\n});\nfor(const type of ['keydown','keyup']) document.addEventListener(type,e=>{\n  if(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLButtonElement || e.ctrlKey || e.metaKey || e.altKey) return;\n  if(e.code==='KeyP' && type==='keydown' && !e.repeat && rom) {room?.started?requestCommand(netgame.paused?'resume':'pause'):running?pause():play();return;}\n  const key=keys.get(e.code); if(!key || !running) return;\n  e.preventDefault(); input(e.code,...key,type==='keydown');\n});\nfor(const button of document.querySelectorAll('[data-key]')) {\n  button.addEventListener('pointerdown',e=>{\n    e.preventDefault(); button.setPointerCapture(e.pointerId);\n    if(running) input(`touch:${e.pointerId}`,...keys.get(button.dataset.key),true);\n  });\n  for(const type of ['pointerup','pointercancel','lostpointercapture']) button.addEventListener(type,e=>{\n    input(`touch:${e.pointerId}`,...keys.get(button.dataset.key),false);\n  });\n}\nwindow.addEventListener('blur',()=>{release();if(running&&!room)pause();});\ndocument.addEventListener('visibilitychange',()=>{release();if(document.hidden&&running&&!room)pause();});\n$('rom').addEventListener('change',async e=>{\n  const file=e.target.files[0]; if(!file) return;\n  try { if(file.size!==131088) throw new Error('Incorrect ROM size. Choose the original Contra (US) .nes file.'); await load(await file.arrayBuffer()); }\n  catch(err) { $('provenance').textContent=err.message; }\n  e.target.value='';\n});\n\n\nfunction resetLocalGame() {\n  nes.fourPlayer?.dispose();\n  const count=Number($('player-count').value);\n  if(count>2){prepareTwoPlayerGame(nes,rom);new FourPlayer(nes,count);}\n  else nes.loadROM(rom);\n  updateSquad();\n}\nfunction updateSquad() {\n  $('squad').hidden=!nes.fourPlayer;\n  if(!nes.fourPlayer)return;\n  const m=nes.cpu.mem,status=[{player:1,lives:m[0x32],gameOver:m[0x38],weapon:m[0xaa]},{player:2,lives:m[0x33],gameOver:m[0x39],weapon:m[0xab]},...nes.fourPlayer.status];\n  for(let i=1;i<=4;i++) {\n    const p=status.find(p=>p.player===i),element=$(`player-status-${i}`);element.hidden=!p;\n    if(p)element.textContent=`P${i} \xB7 ${p.gameOver?'OUT':`${p.lives+1} lives \xB7 ${['Rifle','Machine gun','Flame','Spread','Laser'][p.weapon&7]||'Rifle'}`}`;\n  }\n}\n$('player-count').addEventListener('change',()=>{if(!rom||room)return;if(running)stopLocal();resetLocalGame();$('message').textContent=Number($('player-count').value)>2?'Squad ready at stage 1. Resume to start.':'Original cartridge reset. Press Play, then Enter.';});\n\nfunction updateRoomButtons() {\n  $('host-room').disabled=!rom || !!room;\n  $('join-room').disabled=(!rom && !deployment.directOnly) || !!room;\n  $('leave-room').disabled=!room;\n  $('ready-room').disabled=!rom || !room?.connected || room.ready;\n  $('rom').disabled=!!room;$('net-transport').disabled=!!room || deployment.directOnly;$('player-count').disabled=!!room;\n  if(room && !room.started){$('play').disabled=true;$('pause').disabled=true;$('reset').disabled=true;}\n}\nfunction initializeNetwork() {\n  running=false;release();clearAudio();\n  const session=room;\n  netgame=new GameSession({nes,rom,room:room.id,player:room.player,players:room.players||2,send:packet=>session.send(packet),\n    onState:state=>{\n      clearAudio();release();const paused=state==='paused';\n      $('pause').textContent=paused?'Resume':'Pause';$('overlay').hidden=!paused;\n      if(paused){$('overlay-title').textContent='Co-op paused.';$('message').textContent='All players pause at the same frame.';$('play').textContent='RESUME CO-OP \u2197';showState('CO-OP PAUSED');}\n    },\n    onVerified:({frame,hash})=>{\n      $('net-detail').textContent=`Frame ${frame} synchronized \u2022 checksums match`;\n      $('screen').dataset.netFrame=String(frame);$('screen').dataset.netHash=hash;\n    },\n    onFatal:error=>session.fail(error),\n  });\n  netgame.start();\n  running=true;previous=0;accumulator=0;frames=0;fpsTime=0;\n  $('overlay').hidden=true;$('pause').disabled=false;$('reset').disabled=false;$('play').disabled=false;\n  $('pause').textContent='Pause';$('net-status').textContent=`${room.players||2}-player mission active. You are player ${room.player}.`;\n  $('screen').focus({preventScroll:true});\n}\nfunction requestCommand(action){try{netgame?.request(action);}catch(error){room?.fail(error);}}\nfunction endRoom(message='Left room. Local play is available.') {\n  const previousRoom=room;room=null;previousRoom?.close();netgame?.close();netgame=null;\n  clearInterval(networkTimer);networkTimer=null;\n  running=false;cancelAnimationFrame(raf);release();clearAudio();\n  if(rom)resetLocalGame();\n  $('overlay').hidden=false;$('overlay-title').textContent='Ready for your next mission.';\n  $('message').textContent=message;$('net-status').textContent=message;$('play').textContent='PLAY CONTRA \u2197';\n  $('play').disabled=!rom;$('pause').disabled=!rom;$('reset').disabled=!rom;\n  $('pause').textContent='Pause';$('copy-invite').disabled=true;$('net-detail').textContent='Every browser verifies the same US cartridge.';\n  delete $('screen').dataset.netFrame;delete $('screen').dataset.netHash;showState('LOCAL PLAY');updateRoomButtons();\n}\nasync function connectRoom(host) {\n  if(room || (!rom && (host || !deployment.directOnly)))return;\n  if(running)stopLocal();\n  let session;\n  let players=Number($('player-count').value);\n  if(!host){try{players=Number(new URLSearchParams(new URL($('invite').value.trim()).hash.slice(1)).get('players')||2);}catch{}}\n  if(![2,3,4].includes(players)){$('net-status').textContent='Invalid invitation player count';return;}\n  $('player-count').value=String(players);\n  const RoomType=deployment.directOnly?DirectRoom:players>2?PartyRoom:Room;\n  session=new RoomType({players,fingerprint:players>2?`${EXPECTED}:squad-v1:${players}`:EXPECTED,preferRelay:!window.isSecureContext || $('net-transport').value==='relay',\n    getCartridge:()=>rom,\n    onCartridge:async buffer=>{if(room!==session||session.started)throw new Error('Unexpected peer cartridge');await load(buffer,false,true);$('net-detail').textContent='Cartridge received directly from host \xB7 SHA-512 verified';updateRoomButtons();},\n    onDiagnostic:message=>{if(room===session){const lines=$('net-diagnostics').textContent.split('\\n');lines.push(message);$('net-diagnostics').textContent=lines.slice(-40).join('\\n');}},\n    onStatus:(message,link)=>{if(room!==session)return;$('net-status').textContent=message;if(link){$('invite').value=link;$('copy-invite').disabled=false;}updateRoomButtons();},\n    onStart:()=>{if(room!==session)return;try{initializeNetwork();raf=requestAnimationFrame(tick);networkTimer=setInterval(()=>{if(document.hidden&&running&&room?.started)tick(performance.now(),true);},16);}catch(error){session.fail(error);}},\n    onInput:(packet,player)=>{if(room===session)netgame?.input(packet,player);},\n    onCommand:(packet,request)=>{if(room===session)netgame?.command(packet,request);},\n    onHash:(packet,player)=>{if(room===session)netgame?.hash(packet,player);},\n    onClose:message=>{if(room===session)endRoom(message);},\n    onLatency:ms=>{if(room===session)$('net-status').textContent=`Player ${session.player} \u2022 ${session.relay?'server relay':'direct WebRTC'} \u2022 ${ms} ms round-trip`},\n  });\n  room=session;$('net-diagnostics').textContent='';updateRoomButtons();$('net-status').textContent='Connecting\u2026';\n  try {\n    if(host)await session.host();\n    else {\n      const invitation=new URL($('invite').value.trim());\n      if(invitation.origin!==location.origin || invitation.pathname!==location.pathname)throw new Error('Open the invitation at its original address, then load your ROM and join there.');\n      const params=new URLSearchParams(invitation.hash.slice(1));\n      if(!/^[A-Za-z0-9_-]{24}$/.test(params.get('room')||'') || !/^[A-Za-z0-9_-]{32}$/.test(params.get('invite')||''))throw new Error('Invalid invitation link');\n      await session.join(params.get('room'),params.get('invite'));\n    }\n  } catch(error){if(room===session)session.fail(error);}\n}\n$('host-room').addEventListener('click',()=>connectRoom(true));\n$('join-room').addEventListener('click',()=>connectRoom(false));\n$('leave-room').addEventListener('click',()=>endRoom());\n$('ready-room').addEventListener('click',async()=>{\n  const session=room;\n  if(!rom || !session?.connected)return;\n  try{try{await ensureAudio();}catch(error){console.warn('Audio unavailable; continuing silently',error);node=null;}if(room===session){session.markReady();updateRoomButtons();if(!session.started)$('net-status').textContent='Ready. Waiting for the other players\u2026';}}\n  catch(error){$('net-status').textContent=`Audio could not start: ${error.message}`;}\n});\n$('copy-invite').addEventListener('click',async()=>{\n  try{await navigator.clipboard.writeText($('invite').value);$('net-status').textContent='Invitation copied.';}\n  catch{$('net-status').textContent='Select and copy the invitation link above.';}\n});\nif(location.hash.includes('room=')){const count=new URLSearchParams(location.hash.slice(1)).get('players');if(['2','3','4'].includes(count))$('player-count').value=count;$('invite').value=location.href;$('net-status').textContent='Invitation received. Load your ROM, then click Join invitation.';}\n\ntry {\n  try {\n    const config=$('cartridge')?null:await fetch('/api/config');if(config?.ok)deployment=await config.json();\n    if(deployment.directOnly){$('net-transport').innerHTML='<option value=\"direct\">Direct WebRTC \xB7 cloud relay disabled</option>';$('net-transport').disabled=true;$('net-status').textContent='Host: load a ROM and create a room. Guests: join the invitation to receive it directly.';updateRoomButtons();}\n  }catch(error){console.warn('Room configuration unavailable',error);}\n  const embedded=$('cartridge');\n  if(embedded) {\n    const bytes=Uint8Array.from(atob(embedded.textContent.trim()),c=>c.charCodeAt(0));\n    await load(bytes.buffer,true);\n  } else {\n  const response=await fetch('./game/manifest.json');\n  if(!response.ok) throw new Error('No rebuilt cartridge yet. Load your original US ROM below, or run the local build first.');\n  const manifest=await response.json();\n  if(manifest.sha512!==EXPECTED || manifest.byteIdentical!==true) throw new Error('Build manifest verification failed. Rebuild the cartridge.');\n  const cartridge=await fetch('./game/contra.nes');\n  if(!cartridge.ok) throw new Error('Rebuilt cartridge missing. Run the local build.');\n  await load(await cartridge.arrayBuffer(),manifest.rebuilt!==false);\n  if(manifest.rebuilt===false){$('net-detail').textContent='Verified cartridge loaded from this LAN server.';$('net-status').textContent=location.hash.includes('room=')?'Server cartridge verified. Click Join invitation.':'Server cartridge verified. Create a room or join an invitation.';}\n  }\n} catch(err) { $('message').textContent=err.message; $('provenance').textContent='Awaiting cartridge'; showState('AWAITING CARTRIDGE'); }\n", type: "text/javascript; charset=utf-8" }, "/audio-worklet.js": { text: "// Local AudioWorklet; bounded stereo ring buffer, no dynamic code or network.\nclass ContraAudio extends AudioWorkletProcessor {\n  constructor() {\n    super();\n    this.left = new Float32Array(4096);\n    this.right = new Float32Array(4096);\n    this.read = 0; this.write = 0; this.count = 0;\n    this.port.onmessage = ({data}) => {\n      if (data === 'clear') { this.count = 0; this.read = this.write; return; }\n      const [left, right] = data;\n      for (let i = 0; i < left.length; i++) {\n        if (this.count === 4096) { this.read = (this.read + 1) & 4095; this.count--; }\n        this.left[this.write] = left[i]; this.right[this.write] = right[i];\n        this.write = (this.write + 1) & 4095; this.count++;\n      }\n    };\n  }\n  process(_inputs, outputs) {\n    const [left, right] = outputs[0];\n    for (let i = 0; i < left.length; i++) {\n      if (this.count) {\n        left[i] = this.left[this.read]; right[i] = this.right[this.read];\n        this.read = (this.read + 1) & 4095; this.count--;\n      } else { left[i] = 0; right[i] = 0; }\n    }\n    return true;\n  }\n}\nregisterProcessor('contra-audio', ContraAudio);\n", type: "text/javascript; charset=utf-8" }, "/netplay/digest.mjs": { text: "// MIT License \u2014 Copyright (c) 2026 Rick Gerkin.\n// SHA-2 fallback for LAN HTTP, where WebCrypto is unavailable. Constants are\n// the standard fractional square/cube roots of the first prime numbers.\nconst SHA2_H=[0x6a09e667f3bcc908n,0xbb67ae8584caa73bn,0x3c6ef372fe94f82bn,0xa54ff53a5f1d36f1n,0x510e527fade682d1n,0x9b05688c2b3e6c1fn,0x1f83d9abfb41bd6bn,0x5be0cd19137e2179n];\nconst SHA2_K=[0x428a2f98d728ae22n,0x7137449123ef65cdn,0xb5c0fbcfec4d3b2fn,0xe9b5dba58189dbbcn,0x3956c25bf348b538n,0x59f111f1b605d019n,0x923f82a4af194f9bn,0xab1c5ed5da6d8118n,0xd807aa98a3030242n,0x12835b0145706fben,0x243185be4ee4b28cn,0x550c7dc3d5ffb4e2n,0x72be5d74f27b896fn,0x80deb1fe3b1696b1n,0x9bdc06a725c71235n,0xc19bf174cf692694n,0xe49b69c19ef14ad2n,0xefbe4786384f25e3n,0xfc19dc68b8cd5b5n,0x240ca1cc77ac9c65n,0x2de92c6f592b0275n,0x4a7484aa6ea6e483n,0x5cb0a9dcbd41fbd4n,0x76f988da831153b5n,0x983e5152ee66dfabn,0xa831c66d2db43210n,0xb00327c898fb213fn,0xbf597fc7beef0ee4n,0xc6e00bf33da88fc2n,0xd5a79147930aa725n,0x6ca6351e003826fn,0x142929670a0e6e70n,0x27b70a8546d22ffcn,0x2e1b21385c26c926n,0x4d2c6dfc5ac42aedn,0x53380d139d95b3dfn,0x650a73548baf63den,0x766a0abb3c77b2a8n,0x81c2c92e47edaee6n,0x92722c851482353bn,0xa2bfe8a14cf10364n,0xa81a664bbc423001n,0xc24b8b70d0f89791n,0xc76c51a30654be30n,0xd192e819d6ef5218n,0xd69906245565a910n,0xf40e35855771202an,0x106aa07032bbd1b8n,0x19a4c116b8d2d0c8n,0x1e376c085141ab53n,0x2748774cdf8eeb99n,0x34b0bcb5e19b48a8n,0x391c0cb3c5c95a63n,0x4ed8aa4ae3418acbn,0x5b9cca4f7763e373n,0x682e6ff3d6b2b8a3n,0x748f82ee5defb2fcn,0x78a5636f43172f60n,0x84c87814a1f0ab72n,0x8cc702081a6439ecn,0x90befffa23631e28n,0xa4506cebde82bde9n,0xbef9a3f7b2c67915n,0xc67178f2e372532bn,0xca273eceea26619cn,0xd186b8c721c0c207n,0xeada7dd6cde0eb1en,0xf57d4f7fee6ed178n,0x6f067aa72176fban,0xa637dc5a2c898a6n,0x113f9804bef90daen,0x1b710b35131c471bn,0x28db77f523047d84n,0x32caab7b40c72493n,0x3c9ebe0a15c9bebcn,0x431d67c49c100d4cn,0x4cc5d4becb3e42b6n,0x597f299cfc657e2an,0x5fcb6fab3ad6faecn,0x6c44198c4a475817n];\nconst MASK64=(1n<<64n)-1n;\nconst rotr64=(v,n)=>(v>>BigInt(n))|((v<<BigInt(64-n))&MASK64);\nconst rotr32=(v,n)=>(v>>>n)|(v<<(32-n));\nexport async function digestHex(algorithm,input) {\n  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);\n  if(globalThis.crypto?.subtle) {\n    const hash=await crypto.subtle.digest(algorithm,bytes);\n    return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');\n  }\n  return sha2(algorithm,bytes);\n}\nexport function sha2(algorithm,bytes) {\n  if(!['SHA-256','SHA-512'].includes(algorithm))throw new Error('Unsupported digest');\n  const wide=algorithm==='SHA-512',block=wide?128:64,words=wide?80:64;\n  const padded=new Uint8Array(Math.ceil((bytes.length+1+(wide?16:8))/block)*block);\n  padded.set(bytes);padded[bytes.length]=128;\n  const view=new DataView(padded.buffer);\n  const bitLength=BigInt(bytes.length)*8n;view.setBigUint64(padded.length-8,bitLength);\n  if(wide) {\n    const h=[...SHA2_H],w=Array(80).fill(0n);\n    for(let offset=0;offset<padded.length;offset+=128) {\n      for(let i=0;i<16;i++)w[i]=view.getBigUint64(offset+i*8);\n      for(let i=16;i<80;i++) {\n        const a=w[i-15],b=w[i-2],s0=rotr64(a,1)^rotr64(a,8)^(a>>7n),s1=rotr64(b,19)^rotr64(b,61)^(b>>6n);\n        w[i]=(w[i-16]+s0+w[i-7]+s1)&MASK64;\n      }\n      let [a,b,c,d,e,f,g,j]=h;\n      for(let i=0;i<80;i++) {\n        const s1=rotr64(e,14)^rotr64(e,18)^rotr64(e,41),ch=(e&f)^((~e)&g);\n        const t1=(j+s1+ch+SHA2_K[i]+w[i])&MASK64;\n        const s0=rotr64(a,28)^rotr64(a,34)^rotr64(a,39),maj=(a&b)^(a&c)^(b&c),t2=(s0+maj)&MASK64;\n        j=g;g=f;f=e;e=(d+t1)&MASK64;d=c;c=b;b=a;a=(t1+t2)&MASK64;\n      }\n      [a,b,c,d,e,f,g,j].forEach((v,i)=>{h[i]=(h[i]+v)&MASK64;});\n    }\n    return h.map(v=>v.toString(16).padStart(16,'0')).join('');\n  }\n  const h=SHA2_H.map(v=>Number(v>>32n)>>>0),k=SHA2_K.slice(0,64).map(v=>Number(v>>32n)>>>0),w=new Uint32Array(words);\n  for(let offset=0;offset<padded.length;offset+=64) {\n    for(let i=0;i<16;i++)w[i]=view.getUint32(offset+i*4);\n    for(let i=16;i<64;i++) {\n      const a=w[i-15],b=w[i-2],s0=rotr32(a,7)^rotr32(a,18)^(a>>>3),s1=rotr32(b,17)^rotr32(b,19)^(b>>>10);\n      w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0;\n    }\n    let [a,b,c,d,e,f,g,j]=h;\n    for(let i=0;i<64;i++) {\n      const s1=rotr32(e,6)^rotr32(e,11)^rotr32(e,25),ch=(e&f)^(~e&g),t1=(j+s1+ch+k[i]+w[i])>>>0;\n      const s0=rotr32(a,2)^rotr32(a,13)^rotr32(a,22),maj=(a&b)^(a&c)^(b&c),t2=(s0+maj)>>>0;\n      j=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;\n    }\n    [a,b,c,d,e,f,g,j].forEach((v,i)=>{h[i]=(h[i]+v)>>>0;});\n  }\n  return h.map(v=>v.toString(16).padStart(8,'0')).join('');\n}\n", type: "text/javascript; charset=utf-8" }, "/netplay/direct-room.mjs": { text: "// MIT License \u2014 Copyright (c) 2026 Rick Gerkin.\nimport {PartyRoom} from './party-room.mjs';\n// Star topology: every guest has one authenticated direct link to player 1.\n// Player 1 forwards peer messages over those links, never through the server.\nclass DirectChannel {\n  constructor(room){this.room=room;this.readyState='connecting';}\n  get bufferedAmount(){return Math.max(0,...[...this.room.links.values()].map(l=>l.channel?.bufferedAmount||0));}\n  send(data){\n    if(typeof data!=='string'||data.length>4096||this.bufferedAmount>262144)throw new Error('Direct channel is congested');\n    if(this.room.player===1)for(const link of this.room.links.values())link.channel.send(JSON.stringify({from:1,data}));\n    else this.room.links.get(1).channel.send(data);\n  }\n  close(){this.readyState='closed';}\n}\nexport class DirectRoom extends PartyRoom {\n  constructor(options){super(options);this.players=options.players;this.links=new Map();this.relay=false;this.receiving=null;}\n  async open(){\n    if(!globalThis.RTCPeerConnection)throw new Error('This browser does not support WebRTC');\n    this.channel=new DirectChannel(this);this.opened=performance.now();\n    this.poll().catch(error=>this.fail(error));\n  }\n  async poll(){\n    while(!this.closed && !this.started){\n      const status=await this.request(`/api/rooms/${this.id}`);\n      if(this.player===1){\n        for(const player of status.roster.filter(p=>p!==1)){\n          let link=this.links.get(player);\n          if(!link){link=this.link(player);this.bind(link,link.pc.createDataChannel('contra-direct',{ordered:true}));\n            await link.pc.setLocalDescription(await link.pc.createOffer());await this.gather(link.pc);\n            await this.request(`/api/rooms/${this.id}`,{to:player,description:link.pc.localDescription.toJSON()});}\n          if(status.answers[player]&&!link.pc.remoteDescription)await link.pc.setRemoteDescription(status.answers[player]);\n        }\n      } else if(status.offers[this.player]&&!this.links.has(1)){\n        const link=this.link(1);link.pc.ondatachannel=event=>{if(event.channel.label!=='contra-direct'||link.channel){event.channel.close();return;}this.bind(link,event.channel);};\n        await link.pc.setRemoteDescription(status.offers[this.player]);await link.pc.setLocalDescription(await link.pc.createAnswer());await this.gather(link.pc);\n        await this.request(`/api/rooms/${this.id}`,{to:1,description:link.pc.localDescription.toJSON()});\n      }\n      if(!this.started&&performance.now()-this.opened>180000)throw new Error('Direct connection timed out. Check LAN firewall or Wi-Fi client isolation.');\n      await new Promise(resolve=>setTimeout(resolve,500));\n    }\n  }\n  link(player){\n    const pc=new RTCPeerConnection({iceServers:[],iceTransportPolicy:'all'}),link={player,pc,channel:null};this.links.set(player,link);\n    pc.onconnectionstatechange=()=>{this.onDiagnostic?.(`Player ${player}: ${pc.connectionState}`);if(['failed','closed'].includes(pc.connectionState))this.fail(new Error('Direct connection failed. Cloud relay is disabled.'));};\n    return link;\n  }\n  async gather(pc){\n    if(pc.iceGatheringState==='complete')return;\n    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pc.removeEventListener('icegatheringstatechange',check);reject(new Error('Local ICE gathering timed out'));},10000);\n      const check=()=>{if(pc.iceGatheringState==='complete'){clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',check);resolve();}};pc.addEventListener('icegatheringstatechange',check);check();});\n  }\n  bind(link,channel){\n    link.channel=channel;channel.binaryType='arraybuffer';\n    channel.onopen=()=>{\n      if(this.closed)return;\n      if(this.player===1){const rom=this.getCartridge?.();if(rom){channel.send(JSON.stringify({cartridge:131088}));for(let offset=0;offset<rom.length;offset+=16384)channel.send(Uint8Array.from(rom.slice(offset,offset+16384),c=>c.charCodeAt(0)));}}\n      this.openIfReady();\n      if(this.player===1)this.hello();\n    };\n    channel.onclose=()=>{if(!this.closed)this.fail(new Error('A player disconnected. Create a new room.'));};\n    channel.onerror=()=>this.fail(new Error('Direct data channel error'));\n    channel.onmessage=event=>{try{this.receiveDirect(link,event.data);}catch(error){this.fail(error);}};\n  }\n  openIfReady(){\n    const count=this.player===1?this.players-1:1;\n    if(this.channel.readyState==='open'||this.links.size!==count||[...this.links.values()].some(l=>l.channel?.readyState!=='open'))return;\n    this.channel.readyState='open';this.lastSeen=new Map();this.hello();\n    this.timer=setInterval(()=>{\n      if(this.started&&[...this.lastSeen.values()].some(t=>performance.now()-t>15000))return this.fail(new Error('A player stopped responding'));\n      this.hello();if(this.ready)this.send({kind:'ready'});this.lastPing=performance.now();this.send({kind:'ping',time:this.lastPing});\n    },1000);\n    this.onStatus(`Direct links established. Waiting for ${this.players} players to verify the cartridge.`);\n  }\n  hello(){if(this.channel.readyState==='open')this.send({kind:'hello',protocol:'contra-four-player-1',rom:this.fingerprint,players:this.players});}\n  receiveDirect(link,data){\n    if(data instanceof ArrayBuffer){\n      if(this.player===1||!this.receiving||data.byteLength>16384||this.receiving.offset+data.byteLength>131088)throw new Error('Unexpected cartridge chunk');\n      this.receiving.bytes.set(new Uint8Array(data),this.receiving.offset);this.receiving.offset+=data.byteLength;\n      if(this.receiving.offset===131088){const bytes=this.receiving.bytes;this.receiving=null;Promise.resolve(this.onCartridge?.(bytes.buffer)).catch(error=>this.fail(error));}\n      return;\n    }\n    if(typeof data!=='string'||data.length>8192)throw new Error('Invalid direct message');\n    const value=JSON.parse(data);\n    if(this.player!==1&&value.cartridge===131088){if(this.receiving||this.started)throw new Error('Unexpected cartridge transfer');this.receiving={bytes:new Uint8Array(131088),offset:0};return;}\n    let from,packet;\n    if(this.player===1){from=link.player;packet=value;\n      for(const other of this.links.values())if(other.player!==from&&other.channel?.readyState==='open')other.channel.send(JSON.stringify({from,data}));\n    } else {\n      if(!Number.isInteger(value.from)||value.from<1||value.from>this.players||value.from===this.player||typeof value.data!=='string'||value.data.length>4096)throw new Error('Invalid forwarded sender');\n      from=value.from;packet=JSON.parse(value.data);\n    }\n    if(packet.kind==='hello')this.openIfReady();\n    this.receive(packet,from);\n  }\n  close(){if(this.closed)return;super.close();for(const {pc,channel}of this.links.values()){pc.onconnectionstatechange=null;if(channel){channel.onclose=null;channel.onerror=null;channel.onmessage=null;}pc.close();}}\n}\n", type: "text/javascript; charset=utf-8" }, "/netplay/frame-sync.mjs": { text: "// MIT License \u2014 Copyright (c) 2026 Rick Gerkin.\n// Transport-independent lockstep for the original engine and squad extension.\nconst VERSION = 1;\n\nfunction integer(value, min, max, label) {\n  if (!Number.isSafeInteger(value) || value < min || value > max) {\n    throw new RangeError(`Invalid ${label}`);\n  }\n  return value;\n}\n\nexport class FrameSync {\n  constructor({session, players = 2, localPlayer, delay = 3, maxFutureFrames = 120}) {\n    if (typeof session !== 'string' || !session.length || session.length > 128) {\n      throw new TypeError('A session identifier is required');\n    }\n    this.players = integer(players, 2, 4, 'player count');\n    this.localPlayer = integer(localPlayer, 1, players, 'local player');\n    this.delay = integer(delay, 0, 12, 'input delay');\n    this.maxFutureFrames = integer(maxFutureFrames, Math.max(delay, 1), 600, 'input horizon');\n    this.session = session;\n    this.frame = 0;\n    this.paused = false;\n    this.pending = new Map();\n    // Both sides begin from the same emulator reset. The delay's initial frames\n    // are neutral, so startup doesn't require sending fabricated remote input.\n    for (let frame = 0; frame < delay; frame++) {\n      this.pending.set(frame, new Map(Array.from({length: players}, (_, i) => [i + 1, 0])));\n    }\n  }\n\n  // Schedule once per simulation frame, before trying to consume it. Repeating\n  // this while waiting retransmits exactly the original input for that frame.\n  schedule(mask) {\n    integer(mask, 0, 255, 'controller mask');\n    const frame = this.frame + this.delay;\n    const saved = this.pending.get(frame)?.get(this.localPlayer);\n    const packet = {version: VERSION, kind: 'input', session: this.session,\n      frame, player: this.localPlayer, mask: saved ?? mask};\n    this.receive(packet, this.localPlayer);\n    return packet;\n  }\n\n  // The transport must bind senderPlayer to the authenticated peer connection;\n  // it must never take senderPlayer from the incoming packet itself.\n  receive(packet, senderPlayer) {\n    integer(senderPlayer, 1, this.players, 'sender');\n    if (!packet || packet.version !== VERSION || packet.kind !== 'input' || packet.session !== this.session) {\n      throw new TypeError('Invalid input packet or session');\n    }\n    integer(packet.player, 1, this.players, 'packet player');\n    integer(packet.frame, 0, Number.MAX_SAFE_INTEGER, 'frame');\n    integer(packet.mask, 0, 255, 'controller mask');\n    if (packet.player !== senderPlayer) throw new Error('Peer cannot control another player');\n    if (packet.frame < this.frame) return false; // Old retransmission; never rewind.\n    if (packet.frame - this.frame > this.maxFutureFrames) throw new RangeError('Input too far ahead');\n    const inputs = this.pending.get(packet.frame) ?? new Map();\n    const previous = inputs.get(packet.player);\n    if (previous !== undefined && previous !== packet.mask) throw new Error('Conflicting input for a committed frame');\n    inputs.set(packet.player, packet.mask);\n    this.pending.set(packet.frame, inputs);\n    return previous === undefined;\n  }\n\n  get missingPlayers() {\n    const inputs = this.pending.get(this.frame);\n    return Array.from({length: this.players}, (_, i) => i + 1).filter(player => !inputs?.has(player));\n  }\n\n  // The caller runs exactly one nes.frame() per returned record. A missing\n  // record means wait for the peer: never guess inputs or advance on wall time.\n  takeFrame() {\n    if (this.paused || this.missingPlayers.length) return null;\n    const inputs = this.pending.get(this.frame);\n    const record = Object.freeze({frame: this.frame,\n      inputs: Object.freeze(Array.from({length: this.players}, (_, i) => inputs.get(i + 1)))});\n    this.pending.delete(this.frame);\n    this.frame++;\n    return record;\n  }\n}\n\nexport function applyInputs(nes, inputs) {\n  if(nes.fourPlayer)nes.fourPlayer.setInputs(inputs);\n  const ports=nes.fourPlayer?2:inputs.length;\n  for (let player = 1; player <= ports; player++) {\n    if (!nes.controllers[player]) throw new Error(`Game engine has no controller port for player ${player}`);\n    integer(inputs[player - 1], 0, 255, 'controller mask');\n  }\n  for (let player = 1; player <= ports; player++) {\n    for (let button = 0; button < 8; button++) {\n      nes[inputs[player - 1] & (1 << button) ? 'buttonDown' : 'buttonUp'](player, button);\n    }\n  }\n}\n", type: "text/javascript; charset=utf-8" }, "/netplay/game-session.mjs": { text: "// MIT License \u2014 Copyright (c) 2026 Rick Gerkin.\nimport {FourPlayer} from '../gameplay/four-player.mjs';\nimport {FrameSync, applyInputs} from './frame-sync.mjs';\nimport {prepareTwoPlayerGame, stateHash} from './game.mjs';\n\n// Owns simulation time; rendering, audio output, and transport live outside it.\nexport class GameSession {\n  constructor({nes,rom,room,player,players=2,send,onState=()=>{},onVerified=()=>{},onFatal=()=>{}}) {\n    Object.assign(this,{nes,rom,room,player,players,send,onState,onVerified,onFatal});\n    this.epoch=0;this.generation=0;this.closed=false;this.deferred=[];\n  }\n  start() {this.initialize();}\n  get frame(){return this.sync.frame;}\n  initialize() {\n    const deferred=this.deferred;this.deferred=[];\n    this.generation++;this.paused=false;this.commands=[];this.lastScheduled=-1;\n    this.localHashes=new Map();this.remoteHashes=new Map();\n    prepareTwoPlayerGame(this.nes,this.rom);\n    if(this.players>2)new FourPlayer(this.nes,this.players);\n    this.sync=new FrameSync({session:`${this.room}:${this.epoch}`,localPlayer:this.player,players:this.players,delay:4});\n    for(const entry of deferred){if(entry.type==='input')this.input(entry.packet,entry.player);else this.hash(entry.packet,entry.player);}\n    this.onState('running');this.capture();\n  }\n  close(){this.closed=true;this.generation++;}\n  fail(message){if(!this.closed){this.close();this.onFatal(new Error(message));}}\n  defer(entry) {\n    if(this.deferred.length>=128)throw new Error('Too many future-epoch messages');\n    this.deferred.push(entry);\n  }\n  input(packet,player) {\n    if(this.closed)return;\n    if(packet.session===`${this.room}:${this.epoch}`)this.sync.receive(packet,player);\n    else if(packet.session===`${this.room}:${this.epoch+1}` && this.commands.some(c=>c.action==='reset'))this.defer({type:'input',packet,player});\n  }\n  hash(packet,player=3-this.player) {\n    if(this.closed)return;\n    if(packet.epoch!==this.epoch) {\n      if(packet.epoch===this.epoch+1 && this.commands.some(c=>c.action==='reset'))this.defer({type:'hash',packet,player});\n      return;\n    }\n    if(this.remoteHashes.size>=16)throw new Error('Too many unverified state checksums');\n    if(!Number.isInteger(player)||player<1||player>this.players||player===this.player)throw new Error('Invalid checksum sender');\n    const hashes=this.remoteHashes.get(packet.frame) ?? new Map();\n    hashes.set(player,packet.hash);this.remoteHashes.set(packet.frame,hashes);this.compare(packet.frame);\n  }\n  compare(frame) {\n    const ours=this.localHashes.get(frame),theirs=this.remoteHashes.get(frame);\n    if(ours && theirs) {\n      if([...theirs.values()].some(hash=>hash!==ours)){this.fail('Game states diverged. Create a new room to restart in sync.');return;}\n      if(theirs.size!==this.players-1)return;\n      this.onVerified({frame,hash:ours,epoch:this.epoch});\n      this.localHashes.delete(frame);this.remoteHashes.delete(frame);\n    }\n  }\n  async capture() {\n    const {generation,epoch}=this,frame=this.frame;\n    try {\n      const hash=await stateHash(this.nes);\n      if(this.closed || this.generation!==generation)return;\n      this.localHashes.set(frame,hash);this.send({kind:'hash',frame,epoch,hash});this.compare(frame);\n      if(this.localHashes.size>16 || this.remoteHashes.size>16)this.fail('Peer checksum verification timed out.');\n    }catch(error){if(this.generation===generation)this.fail(error.message);}\n  }\n  request(action) {\n    if(!['pause','resume','reset'].includes(action))throw new Error('Unknown room action');\n    if(this.closed)return;\n    if(this.player!==1){this.send({kind:'request',action});return;}\n    if(this.commands.length>=32)throw new Error('Too many pending room controls');\n    let frame=this.paused?this.frame:this.frame+this.sync.delay+2;\n    if(action==='resume')frame=this.commands.find(c=>c.action==='pause')?.frame ?? this.frame;\n    const packet={kind:'command',action,frame,epoch:this.epoch};\n    this.send(packet);this.command(packet,false);\n  }\n  command(packet,isRequest) {\n    if(this.closed)return;\n    if(isRequest){if(this.player!==1)throw new Error('Only host accepts control requests');this.request(packet.action);return;}\n    if(packet.epoch!==this.epoch || !['pause','resume','reset'].includes(packet.action) || !Number.isSafeInteger(packet.frame) || packet.frame<this.frame || packet.frame>this.frame+120)throw new Error('Invalid control frame');\n    if(this.commands.length>=32)throw new Error('Too many pending room controls');\n    this.commands.push(packet);this.commands.sort((a,b)=>a.frame-b.frame);\n  }\n  step(mask) {\n    if(this.closed)return {state:'closed',advanced:false,scheduled:false};\n    while(this.commands.length && this.commands[0].frame===this.frame) {\n      const command=this.commands.shift();\n      if(command.action==='reset') {\n        this.epoch++;this.initialize();\n        return {state:'reset',advanced:false,scheduled:false};\n      }\n      this.paused=command.action==='pause';this.onState(this.paused?'paused':'running');\n    }\n    if(this.commands.length && this.commands[0].frame<this.frame)throw new Error('Room control arrived too late. Reconnect to resynchronize.');\n    if(this.paused)return {state:'paused',advanced:false,scheduled:false};\n    let scheduled=false;\n    if(this.lastScheduled!==this.frame+this.sync.delay) {\n      const packet=this.sync.schedule(mask);this.send(packet);this.lastScheduled=packet.frame;scheduled=true;\n    }\n    const record=this.sync.takeFrame();\n    if(!record)return {state:'waiting',advanced:false,scheduled};\n    applyInputs(this.nes,record.inputs);this.nes.frame();\n    if(this.frame%120===0)this.capture();\n    return {state:'running',advanced:true,scheduled};\n  }\n}\n", type: "text/javascript; charset=utf-8" }, "/netplay/game.mjs": { text: "import {digestHex} from './digest.mjs';\n// MIT License \u2014 Copyright (c) 2026 Rick Gerkin.\n// Deterministic two-player boot using only controller input and RAM state\n// observations. No copyrighted game instructions or assets are embedded here.\nexport function prepareTwoPlayerGame(nes, rom) {\n  nes.fourPlayer?.dispose();\n  nes.loadROM(rom);\n  for(let p=1;p<=2;p++)for(let b=0;b<8;b++)nes.buttonUp(p,b);\n  const step=count=>{for(let i=0;i<count;i++)nes.frame();};\n  step(600);\n  nes.buttonDown(1,2);step(2);nes.buttonUp(1,2);step(2);\n  nes.buttonDown(1,3);step(2);nes.buttonUp(1,3);\n  for(let i=0;i<900;i++) {\n    if(nes.cpu.mem[0x18]===5 && nes.cpu.mem[0x2c]===4 && nes.cpu.mem[0x90]===1 && nes.cpu.mem[0x91]===1) {\n      if(nes.cpu.mem[0x22]!==1 || nes.cpu.mem[0x1c]!==0)throw new Error('Two-player startup verification failed');\n      return;\n    }\n    nes.frame();\n  }\n  throw new Error('Could not enter two-player gameplay');\n}\n\nexport async function stateHash(nes) {\n  const bytes=new TextEncoder().encode(JSON.stringify(nes.toJSON()));\n  return digestHex('SHA-256',bytes);\n}\n", type: "text/javascript; charset=utf-8" }, "/netplay/party-room.mjs": { text: "// MIT License \u2014 Copyright (c) 2026 Rick Gerkin.\nimport {RelayChannel} from './relay.mjs';\nconst PARTY_PROTOCOL='contra-four-player-1';\nexport class PartyRoom {\n  constructor(options) {\n    Object.assign(this,options);this.players=options.players || 4;\n    this.abort=new AbortController();this.peers=new Set();this.readyPeers=new Set();\n    this.lastSeen=new Map();this.closed=false;this.ready=false;this.started=false;this.relay=true;\n  }\n  get player(){return this.credentials?.player;}\n  get id(){return this.credentials?.room;}\n  get connected(){return !this.closed && this.channel?.readyState==='open' && this.peers.size===this.players-1;}\n  async request(path,body) {\n    const response=await fetch(path,{method:body?'POST':'GET',signal:this.abort.signal,\n      headers:{...(body?{'Content-Type':'application/json'}:{}),...(this.credentials?{Authorization:`Bearer ${this.credentials.token}`}:{})},\n      ...(body?{body:JSON.stringify(body)}:{})});\n    const result=await response.json();if(!response.ok)throw new Error(result.error||'Room service unavailable');return result;\n  }\n  async host() {\n    this.credentials=await this.request('/api/rooms',{players:this.players});\n    if(this.credentials.players!==this.players)throw new Error('Restart the server to enable the new squad room API.');\n    const link=new URL(location.href);link.hash=new URLSearchParams({room:this.id,invite:this.credentials.invite,players:this.players}).toString();\n    this.onStatus(`Room created for ${this.players} players. Share the invitation with everyone.`,link.href);\n    await this.open();\n  }\n  async join(room,invite) {\n    this.credentials=await this.request(`/api/rooms/${encodeURIComponent(room)}`,{invite});\n    if(this.credentials.players!==this.players)throw new Error('Invitation player count does not match room');\n    await this.open();\n  }\n  async open() {\n    this.channel=new RelayChannel({room:this.id,player:this.player,players:this.players,token:this.credentials.token,\n      request:(...args)=>this.request(...args),signal:this.abort.signal,onError:error=>this.fail(error)});\n    this.channel.onmessage=event=>{try{this.receive(JSON.parse(event.data),event.from);}catch(error){this.fail(error);}};\n    await this.channel.open();\n    this.opened=performance.now();\n    const heartbeat=()=>{\n      if(this.closed)return;\n      const now=performance.now();\n      if(!this.connected && now-this.opened>180000)return this.fail(new Error('Room did not fill within three minutes.'));\n      if(this.started && [...this.lastSeen.values()].some(t=>now-t>15000))return this.fail(new Error('A player stopped responding. Create a new room.'));\n      this.send({kind:'hello',protocol:PARTY_PROTOCOL,rom:this.fingerprint,players:this.players});\n      if(this.ready)this.send({kind:'ready'});\n      this.lastPing=now;this.send({kind:'ping',time:now});\n    };\n    heartbeat();this.timer=setInterval(heartbeat,1000);\n    this.onDiagnostic?.(`Server relay open; waiting for ${this.players-1} peers`);\n  }\n  receive(packet,from) {\n    if(!Number.isInteger(from)||from<1||from>this.players||from===this.player||!packet||typeof packet!=='object')throw new Error('Invalid party sender/message');\n    this.lastSeen.set(from,performance.now());\n    if(packet.kind==='hello') {\n      if(packet.protocol!==PARTY_PROTOCOL||packet.rom!==this.fingerprint||packet.players!==this.players)throw new Error('Cartridge or multiplayer version mismatch');\n      const added=!this.peers.has(from);this.peers.add(from);\n      if(added){this.send({kind:'hello',protocol:PARTY_PROTOCOL,rom:this.fingerprint,players:this.players});this.onStatus(`${this.peers.size+1}/${this.players} players connected. You are player ${this.player}.${this.connected?' Click Ready.':''}`);}\n      return;\n    }\n    if(!this.peers.has(from))return; // Hello heartbeat establishes each authenticated stream.\n    switch(packet.kind) {\n      case 'ready':this.readyPeers.add(from);this.maybeStart();break;\n      case 'start':\n        if(from!==1||this.player===1||!this.connected||!this.ready)throw new Error('Invalid party start');\n        if(!this.started){this.started=true;this.onStart();}break;\n      case 'input':if(!this.started)throw new Error('Input before start');this.onInput(packet,from);break;\n      case 'hash':\n        if(!Number.isSafeInteger(packet.frame)||packet.frame<0||!Number.isSafeInteger(packet.epoch)||packet.epoch<0||!/^[a-f0-9]{64}$/.test(packet.hash))throw new Error('Invalid party checksum');\n        this.onHash(packet,from);break;\n      case 'request':if(this.player===1)this.onCommand(packet,true);break;\n      case 'command':if(from!==1||this.player===1)throw new Error('Only host can schedule commands');this.onCommand(packet,false);break;\n      case 'ping':if(!Number.isFinite(packet.time))throw new Error('Invalid ping');this.send({kind:'pong',to:from,time:packet.time});break;\n      case 'pong':if(packet.to===this.player && packet.time===this.lastPing)this.onLatency(Math.round(performance.now()-packet.time));break;\n      default:throw new Error('Unknown party message');\n    }\n  }\n  send(packet) {\n    if(this.closed || this.channel?.readyState!=='open')return false;\n    try{this.channel.send(JSON.stringify(packet));return true;}catch(error){this.fail(error);return false;}\n  }\n  markReady(){if(!this.connected||this.ready)return;this.ready=true;this.send({kind:'ready'});this.maybeStart();}\n  maybeStart(){if(this.player===1 && this.ready && this.readyPeers.size===this.players-1 && !this.started){this.send({kind:'start'});this.started=true;this.onStart();}}\n  fail(error){if(!this.closed){this.close();this.onClose(error.message);}}\n  close(){if(this.closed)return;this.closed=true;clearInterval(this.timer);this.channel?.close();this.abort.abort();}\n}\n", type: "text/javascript; charset=utf-8" }, "/netplay/relay.mjs": { text: "// MIT License \u2014 Copyright (c) 2026 Rick Gerkin.\n// Same-origin, authenticated streaming HTTP fallback; uses TLS when hosted on\n// HTTPS. It carries only the bounded room protocol, not the ROM or snapshots.\nexport class RelayChannel {\n  constructor({room,player,players=2,request,token,signal,onError}) {\n    Object.assign(this,{room,player,players,request,token,signal,onError});\n    this.readyState='connecting';this.pending=[];this.sending=false;this.bytes=0;\n  }\n  get bufferedAmount(){return this.bytes;}\n  async open() {\n    const response=await fetch(`/api/rooms/${this.room}/events`,{headers:{Authorization:`Bearer ${this.token}`},signal:this.signal});\n    if(!response.ok){const result=await response.json();throw new Error(result.error || 'Relay stream unavailable');}\n    this.reader=response.body.getReader();this.readyState='open';this.onopen?.();\n    this.receive().catch(error=>{if(this.readyState!=='closed')this.onError(error);});\n  }\n  send(data) {\n    if(this.readyState!=='open')throw new Error('Relay is not open');\n    if(typeof data!=='string' || data.length>4096 || this.bytes+data.length>262144)throw new Error('Relay send buffer is full');\n    this.pending.push(data);this.bytes+=data.length;\n    this.flush().catch(error=>{if(this.readyState!=='closed')this.onError(error);});\n  }\n  async flush() {\n    if(this.sending)return;\n    this.sending=true;\n    try {\n      while(this.pending.length && this.readyState==='open') {\n        const messages=this.pending.splice(0,16);\n        await this.request(`/api/rooms/${this.room}`,{messages});\n        this.bytes=Math.max(0,this.bytes-messages.reduce((sum,message)=>sum+message.length,0));\n      }\n    } finally {this.sending=false;}\n  }\n  async receive() {\n    const decoder=new TextDecoder();let buffer='';\n    while(this.readyState==='open') {\n      const {value,done}=await this.reader.read();\n      if(done)throw new Error('Relay disconnected. Create a new room to reconnect.');\n      buffer+=decoder.decode(value,{stream:true});\n      let end;\n      while((end=buffer.indexOf('\\n'))!==-1) {\n        const line=buffer.slice(0,end);buffer=buffer.slice(end+1);\n        if(line.length>262144)throw new Error('Relay batch is too large');\n        if(!line)continue;\n        const messages=JSON.parse(line);\n        if(!Array.isArray(messages) || messages.length>32)throw new Error('Invalid relay batch');\n        for(const message of messages) {\n          if(!Number.isInteger(message.from) || message.from<1 || message.from>this.players || message.from===this.player || typeof message.data!=='string' || message.data.length>4096)throw new Error('Invalid relay sender/message');\n          this.onmessage?.({data:message.data,from:message.from});\n        }\n      }\n      if(buffer.length>262144)throw new Error('Relay frame is too large');\n    }\n  }\n  close() {\n    if(this.readyState==='closed')return;\n    this.readyState='closed';this.pending=[];this.bytes=0;\n    this.reader?.cancel().catch(()=>{});\n  }\n}\n", type: "text/javascript; charset=utf-8" }, "/netplay/room.mjs": { text: "import {RelayChannel} from './relay.mjs';\n// MIT License \u2014 Copyright (c) 2026 Rick Gerkin.\nconst PROTOCOL = 'contra-jsnes-2.1.0-netplay-1';\nconst sleep = ms => new Promise(resolve => setTimeout(resolve, ms));\n\nexport class Room {\n  constructor({fingerprint, onStatus, onStart, onInput, onCommand, onHash, onClose, onLatency, onDiagnostic=()=>{}, preferRelay=false}) {\n    Object.assign(this,{fingerprint,onStatus,onStart,onInput,onCommand,onHash,onClose,onLatency,onDiagnostic,preferRelay});\n    this.closed=false; this.ready=false; this.remoteReady=false; this.started=false;\n    this.credentials=null;this.pc=null;this.channel=null;this.pingTimer=null;this.timeout=null;\n    this.abort=new AbortController();\n  }\n  async request(path, body) {\n    const response=await fetch(path,{method:body?'POST':'GET',\n      headers:{...(body?{'Content-Type':'application/json'}:{}),...(this.credentials?{Authorization:`Bearer ${this.credentials.token}`}:{})},\n      ...(body?{body:JSON.stringify(body)}:{}),signal:this.abort.signal});\n    const result=await response.json();\n    if(!response.ok)throw new Error(result.error || 'Room service unavailable');\n    return result;\n  }\n  trace(message){this.onDiagnostic(message);}\n  get player() { return this.credentials?.player; }\n  get id() { return this.credentials?.room; }\n  get connected() { return !this.closed && this.channel?.readyState==='open' && this.verified; }\n  async host() {\n    this.credentials=await this.request('/api/rooms',{});\n    const link=new URL(location.href);link.hash=new URLSearchParams({room:this.id,invite:this.credentials.invite}).toString();\n    this.onStatus('Room created. Send the invitation link to your partner.',link.href);\n    await this.setup(true);\n    if(!this.relay){\n      await this.pc.setLocalDescription(await this.pc.createOffer());\n      await this.gather();\n      if(!this.relay){this.trace('Host offer ready');await this.request(`/api/rooms/${this.id}`,{description:this.pc.localDescription.toJSON()});}\n    }\n    this.poll(true).catch(error=>this.fail(error));\n  }\n  async join(room,invite) {\n    this.credentials=await this.request(`/api/rooms/${encodeURIComponent(room)}`,{invite});\n    this.onStatus('Joined as player 2. Connecting to host\u2026');\n    await this.setup(false);\n    this.poll(false).catch(error=>this.fail(error));\n  }\n  async setup(host) {\n    const {iceServers}=await this.request('/api/config');\n    if(this.closed)return;\n    if(this.preferRelay || !globalThis.RTCPeerConnection){await this.startRelay();return;}\n    this.pc=new RTCPeerConnection({iceServers});\n    this.pc.onsignalingstatechange=()=>this.trace(`Signaling: ${this.pc.signalingState}`);\n    this.pc.onicegatheringstatechange=()=>this.trace(`ICE gathering: ${this.pc.iceGatheringState}`);\n    this.pc.oniceconnectionstatechange=()=>this.trace(`ICE connection: ${this.pc.iceConnectionState}`);\n    this.pc.onicecandidate=event=>{if(event.candidate)this.trace(`Local candidate: ${event.candidate.type || 'unknown'}`);};\n    this.pc.onicecandidateerror=event=>this.trace(`ICE server error: ${event.errorCode}`);\n    this.pc.onconnectionstatechange=()=>{\n      this.trace(`Peer connection: ${this.pc.connectionState}`);\n      if(this.pc.connectionState==='failed')this.fallback();\n      else if(this.pc.connectionState==='closed')this.fail(new Error('Peer connection closed. Create a new room to reconnect.'));\n      if(this.pc.connectionState==='disconnected')this.onStatus('Connection interrupted; waiting for your partner\u2026');\n    };\n    this.timeout=setTimeout(()=>this.fail(new Error('Connection timed out. Check the shared HTTPS address and STUN/TURN configuration.')),180000);\n    if(host)this.bind(this.pc.createDataChannel('contra-input',{ordered:true}));\n    else this.pc.ondatachannel=event=>{\n      if(this.channel || event.channel.label!=='contra-input'){event.channel.close();return;}\n      this.bind(event.channel);\n    };\n  }\n  async gather() {\n    if(this.relay || this.pc.iceGatheringState==='complete')return;\n    await new Promise(resolve=>{\n      const done=()=>{clearTimeout(timer);this.pc.removeEventListener('icegatheringstatechange',check);resolve();};\n      const check=()=>{if(this.pc.iceGatheringState==='complete')done();};\n      const timer=setTimeout(done,10000);\n      this.pc.addEventListener('icegatheringstatechange',check);check();\n    });\n    if(this.closed)throw new Error('Room closed');\n  }\n  async poll(host) {\n    while(!this.closed) {\n      const status=await this.request(`/api/rooms/${this.id}`);\n      if(status.relay && !this.relay)await this.startRelay();\n      if(!this.relay && !this.pc.remoteDescription) {\n        const description=host?status.answer:status.offer;\n        if(description) {\n          this.trace(`Received ${description.type}`);\n          await this.pc.setRemoteDescription(description);\n          if(!host) {\n            await this.pc.setLocalDescription(await this.pc.createAnswer());await this.gather();\n            if(!this.relay)await this.request(`/api/rooms/${this.id}`,{description:this.pc.localDescription.toJSON()});\n          }\n        }\n      }\n      await sleep(750);\n    }\n  }\n  fallback() {\n    if(this.closed || this.relay)return;\n    if(this.started){this.fail(new Error('Direct connection interrupted. Create a new room using Server relay.'));return;}\n    this.startRelay().catch(error=>this.fail(error));\n  }\n  async startRelay() {\n    if(this.closed || this.relay)return;\n    if(this.started)throw new Error('Partner requested a different transport during gameplay; create a new room.');\n    this.relay=true;this.verified=false;this.ready=false;this.remoteReady=false;\n    clearInterval(this.pingTimer);clearTimeout(this.timeout);\n    if(this.channel){this.channel.onclose=null;this.channel.onerror=null;this.channel.onmessage=null;this.channel.onopen=null;this.channel.close();this.channel=null;}\n    if(this.pc){this.pc.onconnectionstatechange=null;this.pc.oniceconnectionstatechange=null;this.pc.close();}\n    this.trace('Using same-server HTTP relay');this.onStatus('Connecting through the server relay\u2026');\n    await this.request(`/api/rooms/${this.id}`,{transport:'relay'});\n    if(this.closed)return;\n    const channel=new RelayChannel({room:this.id,player:this.player,token:this.credentials.token,\n      request:(...args)=>this.request(...args),signal:this.abort.signal,onError:error=>this.fail(error)});\n    this.bind(channel);await channel.open();\n  }\n  bind(channel) {\n    this.channel=channel;\n    channel.onopen=()=>{\n      this.trace(this.relay?'Server relay open':'Data channel open');\n      this.lastSeen=performance.now();\n      clearTimeout(this.timeout);this.timeout=setTimeout(()=>this.fail(new Error('Partner did not connect in time. Create a new room.')),180000);\n      this.send({kind:'hello',protocol:PROTOCOL,rom:this.fingerprint,player:this.player,delay:4});\n      this.pingTimer=setInterval(()=>{\n        if(this.verified && performance.now()-this.lastSeen>15000)return this.fail(new Error('Partner stopped responding. Create a new room to reconnect.'));\n        this.lastPing=performance.now();this.send({kind:'ping',time:this.lastPing});\n      },1000);\n    };\n    channel.onclose=()=>{if(!this.started&&!this.relay)this.fallback();else this.fail(new Error('Partner left the room.'));};\n    channel.onerror=()=>{if(!this.started&&!this.relay)this.fallback();else this.fail(new Error('Data channel error.'));};\n    channel.onmessage=event=>{\n      try {\n        if(typeof event.data!=='string' || event.data.length>4096)throw new Error('Invalid peer message');\n        const packet=JSON.parse(event.data);this.lastSeen=performance.now();\n        if(!packet || typeof packet!=='object')throw new Error('Invalid peer message');\n        if(packet.kind==='hello') {\n          if(this.verified || packet.protocol!==PROTOCOL || packet.rom!==this.fingerprint || packet.player!==3-this.player || packet.delay!==4)\n            throw new Error('Game version or room protocol does not match your partner.');\n          this.trace('Game handshake verified');\n          this.verified=true;clearTimeout(this.timeout);this.onStatus(`Connected as player ${this.player} via ${this.relay?'server relay':'WebRTC'}. Click Ready when both players have loaded their ROM.`);\n          return;\n        }\n        if(!this.verified)throw new Error('Peer handshake required');\n        switch(packet.kind) {\n          case 'ready':\n            this.remoteReady=true;this.onStatus('Partner is ready.');this.maybeStart();break;\n          case 'start':\n            if(this.player!==2 || this.started || !this.ready || !this.remoteReady)throw new Error('Unexpected start');\n            this.started=true;this.onStart();break;\n          case 'input':\n            if(!this.started)throw new Error('Input before start');\n            this.onInput(packet,3-this.player);break;\n          case 'request':\n            if(this.player!==1 || !['pause','resume','reset'].includes(packet.action))throw new Error('Invalid room request');\n            this.onCommand(packet,true);break;\n          case 'command':\n            if(this.player!==2 || !['pause','resume','reset'].includes(packet.action) || !Number.isSafeInteger(packet.frame) || !Number.isSafeInteger(packet.epoch))throw new Error('Invalid host command');\n            this.onCommand(packet,false);break;\n          case 'hash':\n            if(!Number.isSafeInteger(packet.frame) || packet.frame<0 || !Number.isSafeInteger(packet.epoch) || packet.epoch<0 || !/^[a-f0-9]{64}$/.test(packet.hash))throw new Error('Invalid state checksum');\n            this.onHash(packet);break;\n          case 'ping':\n            if(!Number.isFinite(packet.time))throw new Error('Invalid ping');\n            this.send({kind:'pong',time:packet.time});break;\n          case 'pong':\n            if(packet.time===this.lastPing)this.onLatency(Math.round(performance.now()-packet.time));break;\n          default:throw new Error('Unknown peer message');\n        }\n      } catch(error) { this.fail(error); }\n    };\n  }\n  send(packet) {\n    if(this.closed || this.channel?.readyState!=='open')return false;\n    if(this.channel.bufferedAmount>262144){this.fail(new Error('Peer connection is congested.'));return false;}\n    try{this.channel.send(JSON.stringify(packet));return true;}catch(error){this.fail(error);return false;}\n  }\n  markReady() {\n    if(!this.connected || this.ready)return;\n    this.ready=true;this.send({kind:'ready'});this.maybeStart();\n  }\n  maybeStart() {\n    if(this.player===1 && this.ready && this.remoteReady && !this.started) {\n      this.started=true;this.send({kind:'start'});this.onStart();\n    }\n  }\n  fail(error) {\n    if(this.closed)return;\n    this.trace(`Stopped: ${error.message}`);this.close();this.onClose(error.message);\n  }\n  close() {\n    if(this.closed)return;\n    this.closed=true;this.abort.abort();clearTimeout(this.timeout);clearInterval(this.pingTimer);\n    if(this.channel){this.channel.onclose=null;this.channel.onerror=null;this.channel.onmessage=null;this.channel.onopen=null;this.channel.close();}\n    if(this.pc){this.pc.onconnectionstatechange=null;this.pc.close();}\n  }\n}\n", type: "text/javascript; charset=utf-8" }, "/gameplay/four-player.mjs": { text: "// MIT License \u2014 Copyright (c) 2026 Rick Gerkin.\n// Emulator extension for the verified US cartridge. Only addresses and original\n// integration code live here; instructions, sprite definitions, and tiles are\n// read from the user's cartridge at runtime.\nconst UPDATE=0xd3b4, MOVE=0xd460, COLLIDE=0xe1d9, DRAW=0xae9d, TILE=0xaee3;\nconst FIELDS=[0x33,0x39,0xf2,0xf6,0xfa,0x301,0x31b,0x335,0x34f,0x7e4,0x7e5,\n  ...Array.from({length:38},(_,i)=>0x91+i*2)];\nconst index=address=>FIELDS.indexOf(address);\nconst reverse=mask=>{let out=0;for(let i=0;i<8;i++)out|=((mask>>i)&1)<<(7-i);return out;};\n\nexport class FourPlayer {\n  constructor(nes, count=4) {\n    if(![3,4].includes(count))throw new Error('Squad mode needs three or four characters');\n    if(nes.fourPlayer)throw new Error('Four-player extension already installed');\n    this.count=count;this.nes=nes;this.masks=[0,0,0,0];this.previous=[0,0];this.traps=[];this.tiles=[[],[]];this.busy=false;\n    this.owners=Array(16).fill(0);\n    this.level=nes.cpu.mem[0x30];this.players=Array.from({length:count-2},()=>this.read());\n    this.players.forEach((state,i)=>{state[index(0x335)]=80+i*24;});\n    this.originalWrite=nes.cpu.write;\n    const extension=this;\n    nes.cpu.write=function(address,value){\n      if(address>=0x388 && address<0x398 && !this.mem[address] && value)extension.owners[address-0x388]=extension.contextPlayer || this.mem[0x448+address-0x388]+1;\n      return extension.originalWrite.call(this,address,value);\n    };\n    this.originalEmulate=nes.cpu.emulate;\n    const engine=this;\n    nes.cpu.emulate=function(){return engine.emulate();};\n    this.originalFrame=nes.ui.writeFrame;\n    nes.ui.writeFrame=buffer=>{this.paint(buffer);this.originalFrame(buffer);};\n    this.originalJSON=nes.toJSON;\n    nes.toJSON=()=>({...this.originalJSON.call(nes),fourPlayer:{version:1,level:this.level,count:this.count,players:this.players,owners:this.owners,previous:this.previous,masks:this.masks}});\n    nes.fourPlayer=this;\n  }\n  read(){return FIELDS.map(a=>this.nes.cpu.mem[a]);}\n  write(state){FIELDS.forEach((a,i)=>{this.nes.cpu.mem[a]=state[i];});}\n  get status(){return this.players.map((p,i)=>({player:i+3,x:p[index(0x335)],y:p[index(0x31b)],state:p[index(0x91)],lives:p[index(0x33)],gameOver:p[index(0x39)],weapon:p[index(0xab)]}));}\n  setInputs(masks){if(masks.length!==this.count || masks.some(mask=>!Number.isInteger(mask)||mask<0||mask>255))throw new Error('Input count must match character count');this.masks=[...masks];}\n  // Invoke a cartridge subroutine as an extra simulation operation, without\n  // advancing video/audio time or disturbing the interrupted CPU context.\n  call(address,{bank,x=1,a=0,setup=()=>{}}={}) {\n    const {cpu,ppu,mmap}=this.nes,m=cpu.mem;\n    const registers=Object.fromEntries(Object.entries(cpu).filter(([,v])=>typeof v==='number'||typeof v==='boolean'));\n    const scratch=m.slice(0,0x18),stack=m.slice(0x1a0,0x200),prior=m.slice(0x7ec,0x7ee),oldBank=m[0x8000];\n    const advance=ppu.advanceDots;\n    this.busy=true;ppu.advanceDots=()=>{};\n    try {\n      cpu.irqRequested=false;cpu.nmiRaised=false;cpu.nmiPending=false;cpu.nmiImmediate=false;\n      cpu.REG_SP=0xff;cpu.REG_X=x;cpu.REG_ACC=a;\n      if(bank!==undefined)mmap.loadRomBank(bank,0x8000);\n      // RTS pops the stored return address and increments it. $6000 is a sentinel.\n      cpu.push(0x5f);cpu.push(0xff);cpu.REG_PC=address-1;setup(m);\n      let instructions=0;\n      while(cpu.REG_PC!==0x5fff) {\n        if(cpu.REG_SP<0xa0)throw new Error('Four-player cartridge stack budget exceeded');\n        if(++instructions>30000)throw new Error('Four-player cartridge routine exceeded its instruction budget');\n        this.originalEmulate.call(cpu);\n      }\n    } finally {\n      mmap.loadRomBank(oldBank,0x8000);m.set(scratch,0);m.set(stack,0x1a0);m.set(prior,0x7ec);\n      Object.assign(cpu,registers);ppu.advanceDots=advance;this.busy=false;\n    }\n  }\n  withPlayer(i,callback) {\n    const saved=this.read(),context=this.contextPlayer;this.contextPlayer=i+3;this.write(this.players[i]);\n    try{callback();this.players[i]=this.read();}finally{this.write(saved);this.contextPlayer=context;}\n  }\n  emulate() {\n    const cpu=this.nes.cpu,m=cpu.mem,pc=cpu.REG_PC+1;\n    if(!this.busy) {\n      const trap=this.traps.at(-1);\n      if(trap && trap.pc===pc && trap.sp===cpu.REG_SP) {\n        this.traps.pop();trap.callback();\n      }\n      if(m[0x18]===5) {\n        // Laser/flame/spread updates consult their owner's position and weapon.\n        // Run those updates against the extra context that created the bullet.\n        if(pc===0xb961 && m[0x8000]===6 && this.owners[cpu.REG_X]>=3) {\n          const owner=this.owners[cpu.REG_X]-3;\n          if(owner<this.players.length)this.withPlayer(owner,()=>this.call(0xb961,{x:cpu.REG_X}));\n          cpu.REG_PC=cpu.pull() | cpu.pull()<<8;\n          return 0;\n        }\n        if(pc===0xcf0a && this.players.some(p=>!p[index(0x39)]))cpu.REG_PC=0xcef6;\n        let callback;\n        if(pc===UPDATE)callback=()=>this.update();\n        else if(pc===COLLIDE)callback=()=>this.collide();\n        else if(pc===DRAW && m[0x8000]===1)callback=()=>this.draw();\n        if(callback) {\n          const sp=cpu.REG_SP;\n          this.traps.push({pc:((m[0x100|((sp+1)&255)] | m[0x100|((sp+2)&255)]<<8)+1)&65535,sp:((sp+2)&255),callback});\n        }\n      }\n    }\n    return this.originalEmulate.call(cpu);\n  }\n  update() {\n    const m=this.nes.cpu.mem;\n    if(this.level!==m[0x30]) {\n      this.level=m[0x30];this.players=this.players.map(old=>{\n        const state=this.read();state[index(0x33)]=old[index(0x33)];state[index(0x39)]=old[index(0x39)];return state;\n      });\n    }\n    const originalScroll=m[0x68];\n    for(let i=0;i<this.players.length;i++) {\n      this.withPlayer(i,()=>{\n        const state=reverse(this.masks[i+2]);m[0xf2]=state;m[0xf6]=state&~this.previous[i];m[0xfa]=state;\n        this.previous[i]=state;m[0xa3]=0;\n        if(!m[0x39])this.call(MOVE);\n      });\n    }\n    const scroll=m[0x68];\n    if(m[0x40]===0) {\n      // Apply the shared camera movement once to every character who did not\n      // cause it. The stock engine already corrected the original two players.\n      for(let i=0;i<this.players.length;i++) {\n        const p=this.players[i];\n        if(!p[index(0xa3)] && scroll) {\n          const addr=m[0x41]===0?0x335:0x31b;\n          p[index(addr)]=(p[index(addr)]+(m[0x41]===0?-scroll:scroll))&255;\n        }\n      }\n      const extra=Math.max(0,scroll-originalScroll);\n      if(extra)for(let i=0;i<2;i++) {\n        const addr=m[0x41]===0?0x334+i:0x31a+i;\n        m[addr]=(m[addr]+(m[0x41]===0?-extra:extra))&255;\n      }\n    }\n  }\n  collide() {\n    const m=this.nes.cpu.mem,savedState=m[0x90];\n    // Reuse the collision routine with the two additional, independent player\n    // contexts. Enemy health, pickups and bullets remain in the same world RAM.\n    try {\n      m[0x90]=3;\n      for(let i=0;i<this.players.length;i++)this.withPlayer(i,()=>{if(!m[0x39])this.call(COLLIDE);});\n    } finally {m[0x90]=savedState;}\n  }\n  draw() {\n    const m=this.nes.cpu.mem,oam=m.slice(0x200,0x300);\n    this.tiles=[[],[]];\n    try {\n      for(let i=0;i<this.players.length;i++)this.withPlayer(i,()=>{\n        if(m[0x39] || !m[0x301])return;\n        m.fill(0xf4,0x200,0x300);\n        this.call(TILE,{bank:1,a:m[0x301],setup:m=>{\n          m[0]=m[0x34f];m[1]=m[0x31b];m[2]=m[0x335];m[4]=0;m[7]=63;\n        }});\n        for(let a=0x200;a<0x300;a+=4)if(m[a]!==0xf4)this.tiles[i].push(Array.from(m.slice(a,a+4)));\n      });\n    } finally {m.set(oam,0x200);}\n  }\n  paint(buffer) {\n    const ppu=this.nes.ppu;\n    if(this.nes.cpu.mem[0x18]!==5 || ppu.f_spVisibility!==1)return;\n    // Extra characters use the cartridge's tile geometry and skin/shadow colors.\n    // Substitute only the colored clothing, independently of enemy palettes.\n    const clothing=[0x50c040,0x30c8f0]; // JSNES pixels are packed BGR.\n    for(let player=0;player<this.players.length;player++)for(const [sy,tile,attr,sx] of this.tiles[player]) {\n      const height=ppu.f_spriteSize?16:8;\n      for(let y=0;y<height;y++)for(let x=0;x<8;x++) {\n        const dx=sx+x,dy=sy+1+y;if(dx<8||dx>=248||dy<8||dy>=232)continue;\n        const py=attr&128?height-1-y:y;\n        const pattern=height===16?((tile&1)*256+(tile&254)+(py>>3)):tile+(ppu.f_spPatternTable?256:0);\n        const color=ppu.ptTile[pattern].pix[(py&7)*8+(attr&64?7-x:x)];if(!color)continue;\n        const at=dy*256+dx;\n        if((attr&32) && (ppu.pixrendered[at]&256))continue;\n        buffer[at]=color===2?clothing[player]:ppu.sprPalette[(attr&3)*4+color];\n      }\n    }\n  }\n  dispose() {\n    const nes=this.nes;nes.cpu.emulate=this.originalEmulate;nes.cpu.write=this.originalWrite;nes.ui.writeFrame=this.originalFrame;nes.toJSON=this.originalJSON;\n    delete nes.fourPlayer;\n  }\n}\n", type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/browser/frame-timer.js": { text: '// Debug logging, enabled via localStorage.jsnes_debug = 1\nlet debugEnabled = false;\ntry {\n  debugEnabled = !!localStorage.getItem("jsnes_debug");\n} catch {\n  // localStorage not available\n}\n\nconst FPS = 60.098;\n\nexport default class FrameTimer {\n  constructor(props) {\n    // Run at 60 FPS\n    this.onGenerateFrame = props.onGenerateFrame;\n    // Run on animation frame\n    this.onWriteFrame = props.onWriteFrame;\n    this.onAnimationFrame = this.onAnimationFrame.bind(this);\n    this.running = true;\n    this.interval = 1e3 / FPS;\n    this.lastFrameTime = false;\n  }\n\n  start() {\n    this.running = true;\n    this.requestAnimationFrame();\n  }\n\n  stop() {\n    this.running = false;\n    if (this._requestID) window.cancelAnimationFrame(this._requestID);\n    this.lastFrameTime = false;\n  }\n\n  requestAnimationFrame() {\n    this._requestID = window.requestAnimationFrame(this.onAnimationFrame);\n  }\n\n  generateFrame() {\n    this.onGenerateFrame();\n    this.lastFrameTime += this.interval;\n  }\n\n  onAnimationFrame = (time) => {\n    this.requestAnimationFrame();\n    // how many ms after 60fps frame time\n    let excess = time % this.interval;\n\n    // newFrameTime is the current time aligned to 60fps intervals.\n    // i.e. 16.6, 33.3, etc ...\n    let newFrameTime = time - excess;\n\n    // first frame, do nothing\n    if (!this.lastFrameTime) {\n      this.lastFrameTime = newFrameTime;\n      return;\n    }\n\n    let numFrames = Math.round(\n      (newFrameTime - this.lastFrameTime) / this.interval,\n    );\n\n    // This can happen a lot on a 144Hz display\n    if (numFrames === 0) {\n      return;\n    }\n\n    // update display on first frame only\n    this.generateFrame();\n    this.onWriteFrame();\n\n    // we generate additional frames evenly before the next\n    // onAnimationFrame call.\n    // additional frames are generated but not displayed\n    // until next frame draw\n    let timeToNextFrame = this.interval - excess;\n    for (let i = 1; i < numFrames; i++) {\n      setTimeout(\n        () => {\n          this.generateFrame();\n        },\n        (i * timeToNextFrame) / numFrames,\n      );\n    }\n    if (numFrames > 1 && debugEnabled) {\n      console.log("SKIP", numFrames - 1, this.lastFrameTime);\n    }\n  };\n}\n', type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/browser/gamepad.js": { text: 'export default class GamepadController {\n  constructor(options) {\n    this.onButtonDown = options.onButtonDown;\n    this.onButtonUp = options.onButtonUp;\n    this.gamepadState = [];\n    this.buttonCallback = null;\n  }\n\n  disableIfGamepadEnabled = (callback) => {\n    var self = this;\n    return (playerId, buttonId) => {\n      if (!self.gamepadConfig) {\n        return callback(playerId, buttonId);\n      }\n\n      var playerGamepadId = self.gamepadConfig.playerGamepadId;\n      if (!playerGamepadId || !playerGamepadId[playerId - 1]) {\n        // allow callback only if player is not associated to any gamepad\n        return callback(playerId, buttonId);\n      }\n    };\n  };\n\n  _getPlayerNumberFromGamepad = (gamepad) => {\n    if (this.gamepadConfig.playerGamepadId[0] === gamepad.id) {\n      return 1;\n    }\n\n    if (this.gamepadConfig.playerGamepadId[1] === gamepad.id) {\n      return 2;\n    }\n\n    return 1;\n  };\n\n  poll = () => {\n    const gamepads = navigator.getGamepads\n      ? navigator.getGamepads()\n      : navigator.webkitGetGamepads();\n\n    const usedPlayers = [];\n\n    for (let gamepadIndex = 0; gamepadIndex < gamepads.length; gamepadIndex++) {\n      const gamepad = gamepads[gamepadIndex];\n      const previousGamepad = this.gamepadState[gamepadIndex];\n\n      if (!gamepad) {\n        continue;\n      }\n\n      if (!previousGamepad) {\n        this.gamepadState[gamepadIndex] = gamepad;\n        continue;\n      }\n\n      const buttons = gamepad.buttons;\n      const previousButtons = previousGamepad.buttons;\n\n      if (this.buttonCallback) {\n        for (let code = 0; code < gamepad.axes.length; code++) {\n          const axis = gamepad.axes[code];\n          const previousAxis = previousGamepad.axes[code];\n\n          if (axis === -1 && previousAxis !== -1) {\n            this.buttonCallback({\n              gamepadId: gamepad.id,\n              type: "axis",\n              code: code,\n              value: axis,\n            });\n          }\n\n          if (axis === 1 && previousAxis !== 1) {\n            this.buttonCallback({\n              gamepadId: gamepad.id,\n              type: "axis",\n              code: code,\n              value: axis,\n            });\n          }\n        }\n\n        for (let code = 0; code < buttons.length; code++) {\n          const button = buttons[code];\n          const previousButton = previousButtons[code];\n          if (button.pressed && !previousButton.pressed) {\n            this.buttonCallback({\n              gamepadId: gamepad.id,\n              type: "button",\n              code: code,\n            });\n          }\n        }\n      } else if (this.gamepadConfig) {\n        let playerNumber = this._getPlayerNumberFromGamepad(gamepad);\n        if (usedPlayers.length < 2) {\n          if (usedPlayers.indexOf(playerNumber) !== -1) {\n            playerNumber++;\n            if (playerNumber > 2) playerNumber = 1;\n          }\n          usedPlayers.push(playerNumber);\n\n          if (this.gamepadConfig.configs[gamepad.id]) {\n            const configButtons =\n              this.gamepadConfig.configs[gamepad.id].buttons;\n\n            for (let i = 0; i < configButtons.length; i++) {\n              const configButton = configButtons[i];\n              if (configButton.type === "button") {\n                const code = configButton.code;\n                const button = buttons[code];\n                const previousButton = previousButtons[code];\n\n                if (button.pressed && !previousButton.pressed) {\n                  this.onButtonDown(playerNumber, configButton.buttonId);\n                } else if (!button.pressed && previousButton.pressed) {\n                  this.onButtonUp(playerNumber, configButton.buttonId);\n                }\n              } else if (configButton.type === "axis") {\n                const code = configButton.code;\n                const axis = gamepad.axes[code];\n                const previousAxis = previousGamepad.axes[code];\n\n                if (\n                  axis === configButton.value &&\n                  previousAxis !== configButton.value\n                ) {\n                  this.onButtonDown(playerNumber, configButton.buttonId);\n                }\n\n                if (\n                  axis !== configButton.value &&\n                  previousAxis === configButton.value\n                ) {\n                  this.onButtonUp(playerNumber, configButton.buttonId);\n                }\n              }\n            }\n          }\n        }\n      }\n\n      this.gamepadState[gamepadIndex] = {\n        buttons: buttons.map((b) => {\n          return { pressed: b.pressed };\n        }),\n        axes: gamepad.axes.slice(0),\n      };\n    }\n  };\n\n  promptButton = (f) => {\n    if (!f) {\n      this.buttonCallback = f;\n    } else {\n      this.buttonCallback = (buttonInfo) => {\n        this.buttonCallback = null;\n        f(buttonInfo);\n      };\n    }\n  };\n\n  loadGamepadConfig = () => {\n    var gamepadConfig;\n    try {\n      gamepadConfig = localStorage.getItem("gamepadConfig");\n      if (gamepadConfig) {\n        gamepadConfig = JSON.parse(gamepadConfig);\n      }\n    } catch (e) {\n      console.warn("Failed to get gamepadConfig from localStorage.", e);\n    }\n\n    this.gamepadConfig = gamepadConfig;\n  };\n\n  setGamepadConfig = (gamepadConfig) => {\n    try {\n      localStorage.setItem("gamepadConfig", JSON.stringify(gamepadConfig));\n      this.gamepadConfig = gamepadConfig;\n    } catch (e) {\n      console.warn("Failed to set gamepadConfig in localStorage.", e);\n    }\n  };\n\n  startPolling = () => {\n    if (!(navigator.getGamepads || navigator.webkitGetGamepads)) {\n      return { stop: () => {} };\n    }\n\n    let stopped = false;\n    const loop = () => {\n      if (stopped) return;\n\n      this.poll();\n      requestAnimationFrame(loop);\n    };\n    requestAnimationFrame(loop);\n\n    return {\n      stop: () => {\n        stopped = true;\n      },\n    };\n  };\n}\n', type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/browser/index.js": { text: 'import NES from "../nes.js";\nimport Screen from "./screen.js";\nimport Speakers from "./speakers.js";\nimport FrameTimer from "./frame-timer.js";\nimport KeyboardController from "./keyboard.js";\nimport GamepadController from "./gamepad.js";\n\n// Debug logging, enabled via localStorage.jsnes_debug = 1\nlet debugEnabled = false;\ntry {\n  debugEnabled = !!localStorage.getItem("jsnes_debug");\n} catch {\n  // localStorage not available\n}\nfunction debug(...args) {\n  if (debugEnabled) console.log(...args);\n}\n\n/**\n * Browser-based NES emulator that handles canvas rendering, audio output,\n * keyboard/gamepad input, and frame timing.\n *\n * Usage:\n *   const browser = new jsnes.Browser({\n *     container: document.getElementById("nes"),\n *     romData: romData,\n *     onError: (e) => console.error(e),\n *   });\n *\n * If romData is omitted, call browser.loadROM(data) then browser.start().\n */\nexport default class Browser {\n  constructor(options = {}) {\n    this._options = options;\n\n    // Create screen (creates <canvas> inside container)\n    this._screen = new Screen(options.container, {\n      onMouseDown: (x, y) => {\n        this.nes.zapperMove(x, y);\n        this.nes.zapperFireDown();\n      },\n      onMouseUp: () => {\n        this.nes.zapperFireUp();\n      },\n    });\n    this._screen.fitInParent();\n\n    // Create speakers\n    this._speakers = new Speakers({\n      onBufferUnderrun: () => {\n        // Generate extra frames so audio remains consistent. This happens for\n        // a variety of reasons:\n        // - Frame rate is not quite 60fps, so sometimes buffer empties\n        // - Page is not visible, so requestAnimationFrame doesn\'t get fired.\n        //   In this case emulator still runs at full speed, but timing is\n        //   done by audio instead of requestAnimationFrame.\n        // - System can\'t run emulator at full speed. In this case it\'ll stop\n        //    firing requestAnimationFrame.\n        debug("Buffer underrun, running extra frames to catch up");\n\n        // The NES produces ~800 samples per frame at 48kHz. Run two frames\n        // to ensure the worklet buffer is refilled.\n        this._frameTimer.generateFrame();\n        this._frameTimer.generateFrame();\n      },\n    });\n\n    // Create NES\n    this.nes = new NES({\n      onFrame: this._screen.setBuffer,\n      onStatusUpdate: debug,\n      onAudioSample: this._speakers.writeSample,\n      onBatteryRamWrite: options.onBatteryRamWrite || (() => {}),\n      sampleRate: this._speakers.getSampleRate(),\n    });\n\n    // Create frame timer\n    this._frameTimer = new FrameTimer({\n      onGenerateFrame: () => {\n        try {\n          this.nes.frame();\n          this._speakers.flush();\n        } catch (e) {\n          this.stop();\n          if (this._options.onError) {\n            this._options.onError(e);\n          }\n        }\n      },\n      onWriteFrame: this._screen.writeBuffer,\n    });\n\n    // Set up gamepad and keyboard\n    this.gamepad = new GamepadController({\n      onButtonDown: this.nes.buttonDown,\n      onButtonUp: this.nes.buttonUp,\n    });\n    this.gamepad.loadGamepadConfig();\n    this._gamepadPolling = this.gamepad.startPolling();\n\n    this.keyboard = new KeyboardController({\n      onButtonDown: this.gamepad.disableIfGamepadEnabled(this.nes.buttonDown),\n      onButtonUp: this.gamepad.disableIfGamepadEnabled(this.nes.buttonUp),\n    });\n    this.keyboard.loadKeys();\n\n    // Bind keyboard events\n    document.addEventListener("keydown", this.keyboard.handleKeyDown);\n    document.addEventListener("keyup", this.keyboard.handleKeyUp);\n    document.addEventListener("keypress", this.keyboard.handleKeyPress);\n\n    // Load ROM and start if provided\n    if (options.romData) {\n      this.nes.loadROM(options.romData);\n      this.start();\n    }\n  }\n\n  start() {\n    this._frameTimer.start();\n    this._speakers.start();\n    this._fpsInterval = setInterval(() => {\n      debug(`FPS: ${this.nes.getFPS()}`);\n    }, 1000);\n  }\n\n  stop() {\n    this._frameTimer.stop();\n    this._speakers.stop();\n    clearInterval(this._fpsInterval);\n  }\n\n  loadROM(data) {\n    this.stop();\n    this.nes.loadROM(data);\n    this.start();\n  }\n\n  /**\n   * Fill parent element with screen. Call if parent element changes size.\n   */\n  fitInParent() {\n    this._screen.fitInParent();\n  }\n\n  screenshot() {\n    return this._screen.screenshot();\n  }\n\n  /**\n   * Clean up all resources: stop emulation, remove event listeners, remove canvas.\n   */\n  destroy() {\n    this.stop();\n    document.removeEventListener("keydown", this.keyboard.handleKeyDown);\n    document.removeEventListener("keyup", this.keyboard.handleKeyUp);\n    document.removeEventListener("keypress", this.keyboard.handleKeyPress);\n    this._gamepadPolling.stop();\n    this._screen.destroy();\n  }\n\n  /**\n   * Load ROM data from a URL via XHR.\n   */\n  static loadROMFromURL(url, callback) {\n    var req = new XMLHttpRequest();\n    req.open("GET", url);\n    req.overrideMimeType("text/plain; charset=x-user-defined");\n    req.onerror = () =>\n      callback(new Error(`Error loading ${url}: ${req.statusText}`));\n    req.onload = function () {\n      if (this.status === 200) {\n        callback(null, this.responseText);\n      } else if (this.status === 0) {\n        // Aborted, ignore\n      } else {\n        req.onerror();\n      }\n    };\n    req.send();\n    return req;\n  }\n}\n', type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/browser/keyboard.js": { text: 'import Controller from "../controller.js";\n\n// Mapping keyboard code to [controller, button]\nconst KEYS = {\n  88: [1, Controller.BUTTON_A, "X"], // X\n  89: [1, Controller.BUTTON_B, "Y"], // Y (Central European keyboard)\n  90: [1, Controller.BUTTON_B, "Z"], // Z\n  17: [1, Controller.BUTTON_SELECT, "Right Ctrl"], // Right Ctrl\n  13: [1, Controller.BUTTON_START, "Enter"], // Enter\n  38: [1, Controller.BUTTON_UP, "Up"], // Up\n  40: [1, Controller.BUTTON_DOWN, "Down"], // Down\n  37: [1, Controller.BUTTON_LEFT, "Left"], // Left\n  39: [1, Controller.BUTTON_RIGHT, "Right"], // Right\n  83: [1, Controller.BUTTON_TURBO_A, "S"], // S\n  65: [1, Controller.BUTTON_TURBO_B, "A"], // A\n  103: [2, Controller.BUTTON_A, "Num-7"], // Num-7\n  105: [2, Controller.BUTTON_B, "Num-9"], // Num-9\n  99: [2, Controller.BUTTON_SELECT, "Num-3"], // Num-3\n  97: [2, Controller.BUTTON_START, "Num-1"], // Num-1\n  104: [2, Controller.BUTTON_UP, "Num-8"], // Num-8\n  98: [2, Controller.BUTTON_DOWN, "Num-2"], // Num-2\n  100: [2, Controller.BUTTON_LEFT, "Num-4"], // Num-4\n  102: [2, Controller.BUTTON_RIGHT, "Num-6"], // Num-6\n};\n\nexport default class KeyboardController {\n  constructor(options) {\n    this.onButtonDown = options.onButtonDown;\n    this.onButtonUp = options.onButtonUp;\n  }\n\n  loadKeys = () => {\n    var keys;\n    try {\n      keys = localStorage.getItem("keys");\n      if (keys) {\n        keys = JSON.parse(keys);\n      }\n    } catch (e) {\n      console.warn("Failed to get keys from localStorage.", e);\n    }\n\n    this.keys = keys || KEYS;\n  };\n\n  setKeys = (newKeys) => {\n    try {\n      localStorage.setItem("keys", JSON.stringify(newKeys));\n      this.keys = newKeys;\n    } catch (e) {\n      console.warn("Failed to set keys in localStorage.", e);\n    }\n  };\n\n  handleKeyDown = (e) => {\n    var key = this.keys[e.keyCode];\n    if (key) {\n      this.onButtonDown(key[0], key[1]);\n      e.preventDefault();\n    }\n  };\n\n  handleKeyUp = (e) => {\n    var key = this.keys[e.keyCode];\n    if (key) {\n      this.onButtonUp(key[0], key[1]);\n      e.preventDefault();\n    }\n  };\n\n  handleKeyPress = (e) => {\n    if (this.keys[e.keyCode]) {\n      e.preventDefault();\n    }\n  };\n}\n', type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/browser/screen.js": { text: 'const SCREEN_WIDTH = 256;\nconst SCREEN_HEIGHT = 240;\n\nexport default class Screen {\n  constructor(container, options = {}) {\n    this.onMouseDown = options.onMouseDown;\n    this.onMouseUp = options.onMouseUp;\n\n    // Create canvas element\n    this.canvas = document.createElement("canvas");\n    this.canvas.width = SCREEN_WIDTH;\n    this.canvas.height = SCREEN_HEIGHT;\n    this.canvas.style.imageRendering = "pixelated";\n    this.canvas.style.imageRendering = "crisp-edges";\n    container.appendChild(this.canvas);\n\n    // Mouse events for Zapper support\n    this._handleMouseDown = (e) => {\n      if (!this.onMouseDown) return;\n      // Make coordinates unscaled\n      let scale = SCREEN_WIDTH / parseFloat(this.canvas.style.width);\n      let rect = this.canvas.getBoundingClientRect();\n      let x = Math.round((e.clientX - rect.left) * scale);\n      let y = Math.round((e.clientY - rect.top) * scale);\n      this.onMouseDown(x, y);\n    };\n    this._handleMouseUp = () => {\n      if (this.onMouseUp) this.onMouseUp();\n    };\n    this.canvas.addEventListener("mousedown", this._handleMouseDown);\n    this.canvas.addEventListener("mouseup", this._handleMouseUp);\n\n    this._initCanvas();\n  }\n\n  _initCanvas() {\n    this.context = this.canvas.getContext("2d");\n    this.imageData = this.context.getImageData(\n      0,\n      0,\n      SCREEN_WIDTH,\n      SCREEN_HEIGHT,\n    );\n\n    this.context.fillStyle = "black";\n    // set alpha to opaque\n    this.context.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);\n\n    // buffer to write on next animation frame\n    this.buf = new ArrayBuffer(this.imageData.data.length);\n    // Get the canvas buffer in 8bit and 32bit\n    this.buf8 = new Uint8ClampedArray(this.buf);\n    this.buf32 = new Uint32Array(this.buf);\n\n    // Set alpha\n    for (var i = 0; i < this.buf32.length; ++i) {\n      this.buf32[i] = 0xff000000;\n    }\n  }\n\n  setBuffer = (buffer) => {\n    for (var y = 0; y < SCREEN_HEIGHT; ++y) {\n      for (var x = 0; x < SCREEN_WIDTH; ++x) {\n        var i = y * 256 + x;\n        // Convert pixel from NES BGR to canvas ABGR\n        this.buf32[i] = 0xff000000 | buffer[i]; // Full alpha\n      }\n    }\n  };\n\n  writeBuffer = () => {\n    this.imageData.data.set(this.buf8);\n    this.context.putImageData(this.imageData, 0, 0);\n  };\n\n  fitInParent = () => {\n    let parent = this.canvas.parentNode;\n    let parentWidth = parent.clientWidth;\n    let parentHeight = parent.clientHeight;\n    let parentRatio = parentWidth / parentHeight;\n    let desiredRatio = SCREEN_WIDTH / SCREEN_HEIGHT;\n    if (desiredRatio < parentRatio) {\n      this.canvas.style.width = `${Math.round(parentHeight * desiredRatio)}px`;\n      this.canvas.style.height = `${parentHeight}px`;\n    } else {\n      this.canvas.style.width = `${parentWidth}px`;\n      this.canvas.style.height = `${Math.round(parentWidth / desiredRatio)}px`;\n    }\n  };\n\n  screenshot() {\n    var img = new Image();\n    img.src = this.canvas.toDataURL("image/png");\n    return img;\n  }\n\n  destroy() {\n    this.canvas.removeEventListener("mousedown", this._handleMouseDown);\n    this.canvas.removeEventListener("mouseup", this._handleMouseUp);\n    this.canvas.parentNode.removeChild(this.canvas);\n  }\n}\n', type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/browser/speakers.js": { text: '// AudioWorklet processor code, inlined as a string so it can be loaded via\n// Blob URL without bundler-specific imports (e.g. ?raw). This avoids\n// requiring webpack/Vite to import the module source.\n//\n// The processor receives stereo samples from the main thread via MessagePort\n// and buffers them in a circular Float32Array for playback in process().\nconst workletCode = `\nclass NESAudioProcessor extends AudioWorkletProcessor {\n  constructor() {\n    super();\n    // Circular buffer sized to hold ~170ms of audio at 48kHz (8192 samples).\n    this.capacity = 8192;\n    this.bufferL = new Float32Array(this.capacity);\n    this.bufferR = new Float32Array(this.capacity);\n    this.readPos = 0;\n    this.writePos = 0;\n    this.count = 0;\n\n    this.port.onmessage = (e) => {\n      if (e.data.type === "samples") {\n        const left = e.data.left;\n        const right = e.data.right;\n        const len = left.length;\n\n        // If adding these samples would overflow, drop oldest to make room\n        if (this.count + len > this.capacity) {\n          const drop = this.count + len - this.capacity;\n          this.readPos = (this.readPos + drop) % this.capacity;\n          this.count -= drop;\n        }\n\n        for (let i = 0; i < len; i++) {\n          this.bufferL[this.writePos] = left[i];\n          this.bufferR[this.writePos] = right[i];\n          this.writePos = (this.writePos + 1) % this.capacity;\n        }\n        this.count += len;\n      }\n    };\n  }\n\n  process(inputs, outputs) {\n    const output = outputs[0];\n    if (!output || output.length < 2) return true;\n\n    const outL = output[0];\n    const outR = output[1];\n    const size = outL.length;\n\n    if (this.count < size) {\n      for (let i = 0; i < this.count; i++) {\n        outL[i] = this.bufferL[this.readPos];\n        outR[i] = this.bufferR[this.readPos];\n        this.readPos = (this.readPos + 1) % this.capacity;\n      }\n      for (let i = this.count; i < size; i++) {\n        outL[i] = 0;\n        outR[i] = 0;\n      }\n      this.count = 0;\n      this.port.postMessage({ type: "underrun" });\n    } else {\n      for (let i = 0; i < size; i++) {\n        outL[i] = this.bufferL[this.readPos];\n        outR[i] = this.bufferR[this.readPos];\n        this.readPos = (this.readPos + 1) % this.capacity;\n      }\n      this.count -= size;\n    }\n\n    return true;\n  }\n}\n\nregisterProcessor("nes-audio-processor", NESAudioProcessor);\n`;\n\n// How many samples to batch before posting to the worklet. Posting every\n// single sample individually would be too much MessagePort overhead.\n// 128 matches the AudioWorklet render quantum size.\nconst BATCH_SIZE = 128;\n\nexport default class Speakers {\n  constructor({ onBufferUnderrun }) {\n    this.onBufferUnderrun = onBufferUnderrun;\n    this.audioCtx = null;\n    this.node = null;\n    this.batchL = new Float32Array(BATCH_SIZE);\n    this.batchR = new Float32Array(BATCH_SIZE);\n    this.batchPos = 0;\n  }\n\n  getSampleRate() {\n    if (this.audioCtx) {\n      return this.audioCtx.sampleRate;\n    }\n    return 44100;\n  }\n\n  // start() is async because audioWorklet.addModule() returns a promise.\n  // Callers may fire-and-forget \u2014 the node will be null until the worklet\n  // loads, and writeSample() silently drops samples during that brief window.\n  async start() {\n    if (!window.AudioContext) {\n      return;\n    }\n    this.audioCtx = new window.AudioContext();\n\n    const blob = new Blob([workletCode], { type: "application/javascript" });\n    const workletUrl = URL.createObjectURL(blob);\n    await this.audioCtx.audioWorklet.addModule(workletUrl);\n    URL.revokeObjectURL(workletUrl);\n\n    this.node = new AudioWorkletNode(this.audioCtx, "nes-audio-processor", {\n      outputChannelCount: [2],\n    });\n\n    this.node.port.onmessage = (e) => {\n      if (e.data.type === "underrun" && this.onBufferUnderrun) {\n        this.onBufferUnderrun();\n      }\n    };\n\n    this.node.connect(this.audioCtx.destination);\n\n    // Chrome and other browsers require a user gesture before AudioContext can\n    // start. If suspended, resume on the first user interaction.\n    // See https://github.com/bfirsh/jsnes/issues/368\n    if (this.audioCtx.state === "suspended") {\n      this._resumeOnInteraction = () => {\n        if (this.audioCtx) {\n          this.audioCtx.resume();\n        }\n        this._removeResumeListeners();\n      };\n      document.addEventListener("keydown", this._resumeOnInteraction);\n      document.addEventListener("mousedown", this._resumeOnInteraction);\n      document.addEventListener("touchstart", this._resumeOnInteraction);\n    }\n  }\n\n  _removeResumeListeners() {\n    if (this._resumeOnInteraction) {\n      document.removeEventListener("keydown", this._resumeOnInteraction);\n      document.removeEventListener("mousedown", this._resumeOnInteraction);\n      document.removeEventListener("touchstart", this._resumeOnInteraction);\n      this._resumeOnInteraction = null;\n    }\n  }\n\n  stop() {\n    this._removeResumeListeners();\n    if (this.node) {\n      this.node.disconnect(this.audioCtx.destination);\n      this.node = null;\n    }\n    if (this.audioCtx) {\n      this.audioCtx.close().catch((e) => console.error(e));\n      this.audioCtx = null;\n    }\n    this.batchPos = 0;\n  }\n\n  writeSample = (left, right) => {\n    if (!this.node) return;\n\n    this.batchL[this.batchPos] = left;\n    this.batchR[this.batchPos] = right;\n    this.batchPos++;\n\n    if (this.batchPos >= BATCH_SIZE) {\n      this.node.port.postMessage({\n        type: "samples",\n        left: this.batchL.slice(),\n        right: this.batchR.slice(),\n      });\n      this.batchPos = 0;\n    }\n  };\n\n  // Flush any remaining batched samples to the worklet. Called after each\n  // frame to ensure partial batches are sent promptly.\n  flush() {\n    if (this.batchPos > 0 && this.node) {\n      this.node.port.postMessage({\n        type: "samples",\n        left: this.batchL.slice(0, this.batchPos),\n        right: this.batchR.slice(0, this.batchPos),\n      });\n      this.batchPos = 0;\n    }\n  }\n}\n', type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/controller.js": { text: `import { toJSON, fromJSON } from "./utils.js";

class Controller {
  static BUTTON_A = 0;
  static BUTTON_B = 1;
  static BUTTON_SELECT = 2;
  static BUTTON_START = 3;
  static BUTTON_UP = 4;
  static BUTTON_DOWN = 5;
  static BUTTON_LEFT = 6;
  static BUTTON_RIGHT = 7;
  // Turbo buttons rapidly toggle A/B each frame while held, simulating the
  // extra buttons on the NES Advantage and dogbone controllers.
  static BUTTON_TURBO_A = 8;
  static BUTTON_TURBO_B = 9;

  static JSON_PROPERTIES = [
    "state",
    "baseA",
    "baseB",
    "turboA",
    "turboB",
    "turboToggle",
  ];

  constructor() {
    this.state = new Array(8);
    for (let i = 0; i < this.state.length; i++) {
      this.state[i] = 0x40;
    }
    // Track the non-turbo ("base") state of A and B so we can restore them
    // when turbo is released while the regular button is still held.
    this.baseA = 0x40;
    this.baseB = 0x40;
    this.turboA = false;
    this.turboB = false;
    this.turboToggle = false;
  }

  buttonDown(key) {
    if (key === Controller.BUTTON_TURBO_A) {
      this.turboA = true;
    } else if (key === Controller.BUTTON_TURBO_B) {
      this.turboB = true;
    } else {
      this.state[key] = 0x41;
      if (key === Controller.BUTTON_A) this.baseA = 0x41;
      if (key === Controller.BUTTON_B) this.baseB = 0x41;
    }
  }

  buttonUp(key) {
    if (key === Controller.BUTTON_TURBO_A) {
      this.turboA = false;
      this.state[Controller.BUTTON_A] = this.baseA;
    } else if (key === Controller.BUTTON_TURBO_B) {
      this.turboB = false;
      this.state[Controller.BUTTON_B] = this.baseB;
    } else {
      this.state[key] = 0x40;
      if (key === Controller.BUTTON_A) this.baseA = 0x40;
      if (key === Controller.BUTTON_B) this.baseB = 0x40;
    }
  }

  // Called once per frame to toggle turbo button states. Produces a ~30 Hz
  // press rate at 60 FPS, matching the fast end of the NES Advantage's
  // adjustable turbo range.
  clock() {
    if (!this.turboA && !this.turboB) return;
    this.turboToggle = !this.turboToggle;
    if (this.turboA) {
      this.state[Controller.BUTTON_A] = this.turboToggle ? 0x41 : 0x40;
    }
    if (this.turboB) {
      this.state[Controller.BUTTON_B] = this.turboToggle ? 0x41 : 0x40;
    }
  }

  toJSON() {
    return toJSON(this);
  }

  fromJSON(s) {
    fromJSON(this, s);
  }
}

export default Controller;
`, type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/cpu.js": { text: `import { fromJSON, toJSON } from "./utils.js";

// ============================================================================
// 6502 opcode table
// ============================================================================
//
// The NES's CPU is a MOS 6502 variant (the Ricoh 2A03 on NTSC consoles,
// 2A07 on PAL). Like any CPU, it runs machine code by repeatedly fetching
// a byte from memory, decoding what that byte means, and executing the
// corresponding operation \u2014 the classic fetch-decode-execute loop.
//
// On the 6502, every (operation, addressing mode) pair is assigned its own
// unique 1-byte opcode. For example, "LDA" (Load Accumulator) has eight
// different opcode bytes because it supports eight addressing modes \u2014 one
// for "load from a fixed 2-byte address", one for "load from a zero-page
// address + X", and so on. That gives a total of 256 possible opcode bytes,
// of which the official 6502 defines 151; another ~80 are "unofficial"
// opcodes (see below); the rest are unused and would hang a real CPU.
//
// This file's emulate() method implements the fetch-decode-execute loop for
// a single CPU instruction. OPCODE_TABLE is the *decode* step: given the
// opcode byte we just fetched, it tells emulate() everything it needs to
// know before running the instruction:
//
//   ins    - which instruction to execute (INS_*). Used as the switch key
//            in the execute phase of emulate().
//   mode   - which addressing mode to use to find the operand (ADDR_*).
//            Used as the switch key in the addressing phase of emulate().
//   size   - how many bytes the instruction occupies in memory (1-3),
//            so emulate() knows how far to advance the program counter.
//   cycles - base cycle count. Some instructions pay an extra cycle when
//            an indexed addressing mode crosses a 256-byte "page" boundary
//            (since the 6502 has to do an extra bus cycle to correct the
//            high byte of the address), and the execute switch adds that
//            extra cycle where appropriate.
//
// OPCODE_TABLE is defined as a plain object literal below, keyed by the
// raw opcode byte (0-255). Unassigned bytes are simply absent; at dispatch
// time the lookup returns \`undefined\`, which is then replaced with a
// shared INVALID_OPCODE sentinel so that invalid opcodes fall through to
// the execute switch's default case and throw.
//
// The INS_* and ADDR_* numeric values here must match the \`case N:\` labels
// in the two switches in emulate(). If you ever renumber these, update
// both switches in lockstep.

// ----------------------------------------------------------------------------
// Addressing modes
// ----------------------------------------------------------------------------
//
// The 6502 has 13 addressing modes \u2014 different ways of specifying where an
// instruction's operand lives. Some modes take a literal value, some read
// from a fixed memory address, some compute an address from a base plus an
// index register (X or Y), and some dereference a pointer stored in memory.
//
// The numeric values here are used as \`case\` labels in the addressing-mode
// switch at the top of emulate(), which computes the final effective
// address (or loads the literal value) for each instruction before the
// instruction itself runs. The code in that switch is the authoritative
// source for what each mode actually does on the bus, including the
// sometimes-tricky "dummy reads" the real 6502 performs on indexed modes.
//
// Notation below: $XX means a 1-byte value (0-$FF), $XXXX means a 2-byte
// value (0-$FFFF). "Zero page" is the first 256 bytes of memory ($0000-
// $00FF), which the 6502 can address with a single byte \u2014 giving faster
// and smaller code than full 16-bit addresses.
//
// See https://www.nesdev.org/wiki/CPU_addressing_modes

const ADDR_ZP = 0; //          Zero page         \u2014 operand at $00XX
const ADDR_REL = 1; //         Relative          \u2014 PC + signed 8-bit offset (branches)
const ADDR_IMP = 2; //         Implied           \u2014 no operand (e.g. CLC, RTS, TAX)
const ADDR_ABS = 3; //         Absolute          \u2014 operand at $XXXX (any address)
const ADDR_ACC = 4; //         Accumulator       \u2014 operand is the A register itself
const ADDR_IMM = 5; //         Immediate         \u2014 operand is a literal byte (LDA #$42)
const ADDR_ZPX = 6; //         Zero page,X       \u2014 operand at ($XX + X) & $FF
const ADDR_ZPY = 7; //         Zero page,Y       \u2014 operand at ($XX + Y) & $FF
const ADDR_ABSX = 8; //        Absolute,X        \u2014 operand at $XXXX + X
const ADDR_ABSY = 9; //        Absolute,Y        \u2014 operand at $XXXX + Y
const ADDR_PREIDXIND = 10; //  (Indirect,X)      \u2014 pointer at ($XX + X) in zero page
const ADDR_POSTIDXIND = 11; // (Indirect),Y      \u2014 pointer at $XX in zero page, then + Y
const ADDR_INDABS = 12; //     Indirect absolute \u2014 pointer at $XXXX (JMP indirect only)

// ----------------------------------------------------------------------------
// Instructions
// ----------------------------------------------------------------------------
//
// The 6502 has 56 official instructions, each conventionally referred to
// by a 3-letter mnemonic (LDA, STA, JMP, etc.). Most instructions support
// several addressing modes, so one mnemonic usually maps to several opcode
// bytes \u2014 which is why OPCODE_TABLE below has multiple entries per
// mnemonic (e.g. LDA has eight, one for each addressing mode it supports).
//
// Each INS_* here is an internal identifier used as the \`case\` label in
// the execute switch in emulate(). The ordering and numeric values are
// arbitrary but must stay in sync with that switch.
//
// NOTE: the NES's 2A03/2A07 CPU omits the 6502's BCD (binary-coded decimal)
// mode. The CLD / SED instructions still exist and toggle the D flag, but
// the D flag has no effect on ADC/SBC. That's why the CLD/SED handlers in
// emulate() look like no-ops aside from flipping the flag.
//
// See https://www.nesdev.org/wiki/CPU for a per-instruction reference.

// Arithmetic & logic
const INS_ADC = 0; //  ADC \u2014 Add memory to accumulator with carry
const INS_AND = 1; //  AND \u2014 Bitwise AND memory with accumulator
const INS_ASL = 2; //  ASL \u2014 Arithmetic shift left (top bit \u2192 carry)
// Branches \u2014 each tests one status flag and jumps relative to PC if it matches
const INS_BCC = 3; //  BCC \u2014 Branch if carry clear
const INS_BCS = 4; //  BCS \u2014 Branch if carry set
const INS_BEQ = 5; //  BEQ \u2014 Branch if equal (zero flag set)
const INS_BIT = 6; //  BIT \u2014 Bit test: N \u2190 M.7, V \u2190 M.6, Z \u2190 (A & M) == 0
const INS_BMI = 7; //  BMI \u2014 Branch if minus (negative flag set)
const INS_BNE = 8; //  BNE \u2014 Branch if not equal (zero flag clear)
const INS_BPL = 9; //  BPL \u2014 Branch if plus (negative flag clear)
const INS_BRK = 10; // BRK \u2014 Software interrupt (pushes PC+2 and status, jumps via $FFFE)
const INS_BVC = 11; // BVC \u2014 Branch if overflow clear
const INS_BVS = 12; // BVS \u2014 Branch if overflow set
// Flag clears
const INS_CLC = 13; // CLC \u2014 Clear carry flag
const INS_CLD = 14; // CLD \u2014 Clear decimal flag (no effect on NES, see note above)
const INS_CLI = 15; // CLI \u2014 Clear interrupt disable flag
const INS_CLV = 16; // CLV \u2014 Clear overflow flag
// Compares \u2014 like subtract, but only set flags (don't modify the register)
const INS_CMP = 17; // CMP \u2014 Compare memory with accumulator
const INS_CPX = 18; // CPX \u2014 Compare memory with X
const INS_CPY = 19; // CPY \u2014 Compare memory with Y
// Decrements
const INS_DEC = 20; // DEC \u2014 Decrement memory by one
const INS_DEX = 21; // DEX \u2014 Decrement X by one
const INS_DEY = 22; // DEY \u2014 Decrement Y by one
// XOR
const INS_EOR = 23; // EOR \u2014 Bitwise exclusive-OR memory with accumulator
// Increments
const INS_INC = 24; // INC \u2014 Increment memory by one
const INS_INX = 25; // INX \u2014 Increment X by one
const INS_INY = 26; // INY \u2014 Increment Y by one
// Jumps
const INS_JMP = 27; // JMP \u2014 Unconditional jump
const INS_JSR = 28; // JSR \u2014 Jump to subroutine (pushes return address first)
// Loads
const INS_LDA = 29; // LDA \u2014 Load accumulator from memory
const INS_LDX = 30; // LDX \u2014 Load X from memory
const INS_LDY = 31; // LDY \u2014 Load Y from memory
// Shift
const INS_LSR = 32; // LSR \u2014 Logical shift right (bottom bit \u2192 carry)
// No-op
const INS_NOP = 33; // NOP \u2014 No operation
// OR
const INS_ORA = 34; // ORA \u2014 Bitwise OR memory with accumulator
// Stack pushes/pulls ("pull" is the 6502 term for "pop")
const INS_PHA = 35; // PHA \u2014 Push accumulator onto stack
const INS_PHP = 36; // PHP \u2014 Push processor status onto stack
const INS_PLA = 37; // PLA \u2014 Pull accumulator from stack
const INS_PLP = 38; // PLP \u2014 Pull processor status from stack
// Rotates (through carry)
const INS_ROL = 39; // ROL \u2014 Rotate left through carry (C \u2192 bit 0, bit 7 \u2192 C)
const INS_ROR = 40; // ROR \u2014 Rotate right through carry (C \u2192 bit 7, bit 0 \u2192 C)
// Returns
const INS_RTI = 41; // RTI \u2014 Return from interrupt (pulls status and PC)
const INS_RTS = 42; // RTS \u2014 Return from subroutine (pulls PC)
// Subtract
const INS_SBC = 43; // SBC \u2014 Subtract memory from accumulator with borrow
// Flag sets
const INS_SEC = 44; // SEC \u2014 Set carry flag
const INS_SED = 45; // SED \u2014 Set decimal flag (no effect on NES, see note above)
const INS_SEI = 46; // SEI \u2014 Set interrupt disable flag
// Stores
const INS_STA = 47; // STA \u2014 Store accumulator to memory
const INS_STX = 48; // STX \u2014 Store X to memory
const INS_STY = 49; // STY \u2014 Store Y to memory
// Register transfers
const INS_TAX = 50; // TAX \u2014 Transfer accumulator to X
const INS_TAY = 51; // TAY \u2014 Transfer accumulator to Y
const INS_TSX = 52; // TSX \u2014 Transfer stack pointer to X
const INS_TXA = 53; // TXA \u2014 Transfer X to accumulator
const INS_TXS = 54; // TXS \u2014 Transfer X to stack pointer
const INS_TYA = 55; // TYA \u2014 Transfer Y to accumulator

// ----------------------------------------------------------------------------
// Unofficial opcodes
// ----------------------------------------------------------------------------
//
// The 6502's instruction decoder is a combinational circuit rather than a
// lookup table, and about 80 of the 256 possible opcode bytes decode to
// instructions that weren't part of the official instruction set but still
// do *something* \u2014 usually a combination of two official instructions that
// happen to share hardware (e.g. SLO = "ASL then ORA"). Some shipped NES
// games, and most CPU test ROMs (including nestest and AccuracyCoin), use
// them deliberately, so a correct NES emulator has to implement them.
//
// See https://www.nesdev.org/wiki/Programming_with_unofficial_opcodes

// Combined arithmetic/logic on the accumulator (immediate operand only)
const INS_ALR = 56; // ALR (ASR) \u2014 AND then LSR:  A = (A & #imm) >> 1
const INS_ANC = 57; // ANC        \u2014 AND, but also copy result's bit 7 into carry
const INS_ARR = 58; // ARR        \u2014 AND then ROR, with peculiar N/V/C side effects
const INS_AXS = 59; // AXS (SBX)  \u2014 X = (A & X) - #imm (like CMP, but stores result)
// Combined load/store
const INS_LAX = 60; // LAX \u2014 Load A and X from memory simultaneously
const INS_SAX = 61; // SAX \u2014 Store (A & X) to memory
// Read-modify-write combos: each does an RMW on memory then an A-side op
const INS_DCP = 62; // DCP \u2014 DEC memory then CMP with A
const INS_ISC = 63; // ISC (ISB) \u2014 INC memory then SBC from A
const INS_RLA = 64; // RLA \u2014 ROL memory then AND with A
const INS_RRA = 65; // RRA \u2014 ROR memory then ADC with A
const INS_SLO = 66; // SLO \u2014 ASL memory then ORA with A
const INS_SRE = 67; // SRE \u2014 LSR memory then EOR with A
// Multi-byte NOPs. These consume extra bytes and (for IGN) still perform a
// dummy memory read, but don't otherwise affect state. Games occasionally
// use them for precise cycle-count padding.
const INS_SKB = 68; // SKB \u2014 2-byte NOP (skips an immediate byte)
const INS_IGN = 69; // IGN \u2014 3-byte NOP that still reads from memory

// "Unstable" opcodes whose output depends on the internal bus arbitration
// between CPU cycles. Most store (register & (high byte of target + 1)).
// The DMC audio channel's DMA transfer can hijack the bus mid-instruction
// and change the stored value \u2014 the emulator handles this interaction in
// the execute switch. Essentially no shipped games use these, but the
// AccuracyCoin test ROM does.
const INS_SHA = 71; // SHA (AHX) \u2014 Store A & X & (H+1)
const INS_SHS = 72; // SHS (TAS) \u2014 SP = A & X, then store SP & (H+1)
const INS_SHY = 73; // SHY (SYA) \u2014 Store Y & (H+1)
const INS_SHX = 74; // SHX (SXA) \u2014 Store X & (H+1)
const INS_LAE = 75; // LAE (LAS) \u2014 A = X = SP = (memory & SP)

// Opcodes whose behavior depends on a "magic" constant that varies between
// CPU manufacturing runs (and even across die temperature). Tests only
// exercise these with inputs (A = $FF, or immediate = $00) where the magic
// value cancels out of the result, so we can pick any reasonable magic.
const INS_ANE = 76; // ANE (XAA) \u2014 A = (A | magic) & X & #imm
const INS_LXA = 77; // LXA (ATX) \u2014 A = X = (A | magic) & #imm

// ----------------------------------------------------------------------------
// The opcode table
// ----------------------------------------------------------------------------
//
// OPCODE_TABLE is a plain object keyed by opcode byte. Every valid 6502
// opcode has an entry here; unassigned bytes (including the KIL/STP/JAM
// family that would hang a real CPU) are simply absent from the table.
// The dispatch site in emulate() substitutes INVALID_OPCODE on lookup
// miss, which has \`ins: -1\` \u2014 a value that matches no case in the
// execute switch, so dispatch falls through to the default case and
// throws a clear "invalid opcode" error.
//
// Using a shared INVALID_OPCODE object (rather than creating a fresh
// one per lookup miss) means V8 sees a stable hidden class for both
// valid and invalid lookups, which helps the JIT generate faster code
// for the dispatch.
//
// Size and cycle counts come from the official 6502 datasheet and match
// the nesdev wiki's tables at https://www.nesdev.org/wiki/CPU.
//
// The whole OPCODE_TABLE literal is marked \`// prettier-ignore\` so that
// prettier doesn't collapse the manual column alignment below \u2014 being
// able to scan straight down the "mode" column makes the table much
// more readable than the default formatting would allow.

const INVALID_OPCODE = { ins: -1, mode: 0, size: 1, cycles: 2 };

// prettier-ignore
const OPCODE_TABLE = {
  // ADC \u2014 Add with carry
  0x69: { ins: INS_ADC, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0x65: { ins: INS_ADC, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x75: { ins: INS_ADC, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0x6d: { ins: INS_ADC, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0x7d: { ins: INS_ADC, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0x79: { ins: INS_ADC, mode: ADDR_ABSY,       size: 3, cycles: 4 },
  0x61: { ins: INS_ADC, mode: ADDR_PREIDXIND,  size: 2, cycles: 6 },
  0x71: { ins: INS_ADC, mode: ADDR_POSTIDXIND, size: 2, cycles: 5 },

  // AND \u2014 Bitwise AND with accumulator
  0x29: { ins: INS_AND, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0x25: { ins: INS_AND, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x35: { ins: INS_AND, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0x2d: { ins: INS_AND, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0x3d: { ins: INS_AND, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0x39: { ins: INS_AND, mode: ADDR_ABSY,       size: 3, cycles: 4 },
  0x21: { ins: INS_AND, mode: ADDR_PREIDXIND,  size: 2, cycles: 6 },
  0x31: { ins: INS_AND, mode: ADDR_POSTIDXIND, size: 2, cycles: 5 },

  // ASL \u2014 Arithmetic shift left
  0x0a: { ins: INS_ASL, mode: ADDR_ACC,        size: 1, cycles: 2 },
  0x06: { ins: INS_ASL, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0x16: { ins: INS_ASL, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0x0e: { ins: INS_ASL, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0x1e: { ins: INS_ASL, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // Branches \u2014 each tests a status flag and jumps relative to PC if it matches
  0x90: { ins: INS_BCC, mode: ADDR_REL,        size: 2, cycles: 2 },
  0xb0: { ins: INS_BCS, mode: ADDR_REL,        size: 2, cycles: 2 },
  0xf0: { ins: INS_BEQ, mode: ADDR_REL,        size: 2, cycles: 2 },
  0x30: { ins: INS_BMI, mode: ADDR_REL,        size: 2, cycles: 2 },
  0xd0: { ins: INS_BNE, mode: ADDR_REL,        size: 2, cycles: 2 },
  0x10: { ins: INS_BPL, mode: ADDR_REL,        size: 2, cycles: 2 },
  0x50: { ins: INS_BVC, mode: ADDR_REL,        size: 2, cycles: 2 },
  0x70: { ins: INS_BVS, mode: ADDR_REL,        size: 2, cycles: 2 },

  // BIT \u2014 Test bits in memory against accumulator
  0x24: { ins: INS_BIT, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x2c: { ins: INS_BIT, mode: ADDR_ABS,        size: 3, cycles: 4 },

  // BRK \u2014 Software interrupt
  0x00: { ins: INS_BRK, mode: ADDR_IMP,        size: 1, cycles: 7 },

  // Flag clears
  0x18: { ins: INS_CLC, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0xd8: { ins: INS_CLD, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0x58: { ins: INS_CLI, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0xb8: { ins: INS_CLV, mode: ADDR_IMP,        size: 1, cycles: 2 },

  // CMP \u2014 Compare memory with accumulator (sets flags only)
  0xc9: { ins: INS_CMP, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0xc5: { ins: INS_CMP, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0xd5: { ins: INS_CMP, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0xcd: { ins: INS_CMP, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0xdd: { ins: INS_CMP, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0xd9: { ins: INS_CMP, mode: ADDR_ABSY,       size: 3, cycles: 4 },
  0xc1: { ins: INS_CMP, mode: ADDR_PREIDXIND,  size: 2, cycles: 6 },
  0xd1: { ins: INS_CMP, mode: ADDR_POSTIDXIND, size: 2, cycles: 5 },

  // CPX \u2014 Compare memory with X
  0xe0: { ins: INS_CPX, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0xe4: { ins: INS_CPX, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0xec: { ins: INS_CPX, mode: ADDR_ABS,        size: 3, cycles: 4 },

  // CPY \u2014 Compare memory with Y
  0xc0: { ins: INS_CPY, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0xc4: { ins: INS_CPY, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0xcc: { ins: INS_CPY, mode: ADDR_ABS,        size: 3, cycles: 4 },

  // DEC \u2014 Decrement memory by one
  0xc6: { ins: INS_DEC, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0xd6: { ins: INS_DEC, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0xce: { ins: INS_DEC, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0xde: { ins: INS_DEC, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // DEX / DEY \u2014 Decrement X / Y by one
  0xca: { ins: INS_DEX, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0x88: { ins: INS_DEY, mode: ADDR_IMP,        size: 1, cycles: 2 },

  // EOR \u2014 Bitwise exclusive-OR with accumulator
  0x49: { ins: INS_EOR, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0x45: { ins: INS_EOR, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x55: { ins: INS_EOR, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0x4d: { ins: INS_EOR, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0x5d: { ins: INS_EOR, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0x59: { ins: INS_EOR, mode: ADDR_ABSY,       size: 3, cycles: 4 },
  0x41: { ins: INS_EOR, mode: ADDR_PREIDXIND,  size: 2, cycles: 6 },
  0x51: { ins: INS_EOR, mode: ADDR_POSTIDXIND, size: 2, cycles: 5 },

  // INC \u2014 Increment memory by one
  0xe6: { ins: INS_INC, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0xf6: { ins: INS_INC, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0xee: { ins: INS_INC, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0xfe: { ins: INS_INC, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // INX / INY \u2014 Increment X / Y by one
  0xe8: { ins: INS_INX, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0xc8: { ins: INS_INY, mode: ADDR_IMP,        size: 1, cycles: 2 },

  // JMP \u2014 Unconditional jump (absolute or via indirect pointer)
  0x4c: { ins: INS_JMP, mode: ADDR_ABS,        size: 3, cycles: 3 },
  0x6c: { ins: INS_JMP, mode: ADDR_INDABS,     size: 3, cycles: 5 },

  // JSR \u2014 Jump to subroutine (pushes return address first)
  0x20: { ins: INS_JSR, mode: ADDR_ABS,        size: 3, cycles: 6 },

  // LDA \u2014 Load accumulator from memory
  0xa9: { ins: INS_LDA, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0xa5: { ins: INS_LDA, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0xb5: { ins: INS_LDA, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0xad: { ins: INS_LDA, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0xbd: { ins: INS_LDA, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0xb9: { ins: INS_LDA, mode: ADDR_ABSY,       size: 3, cycles: 4 },
  0xa1: { ins: INS_LDA, mode: ADDR_PREIDXIND,  size: 2, cycles: 6 },
  0xb1: { ins: INS_LDA, mode: ADDR_POSTIDXIND, size: 2, cycles: 5 },

  // LDX \u2014 Load X from memory
  0xa2: { ins: INS_LDX, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0xa6: { ins: INS_LDX, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0xb6: { ins: INS_LDX, mode: ADDR_ZPY,        size: 2, cycles: 4 },
  0xae: { ins: INS_LDX, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0xbe: { ins: INS_LDX, mode: ADDR_ABSY,       size: 3, cycles: 4 },

  // LDY \u2014 Load Y from memory
  0xa0: { ins: INS_LDY, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0xa4: { ins: INS_LDY, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0xb4: { ins: INS_LDY, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0xac: { ins: INS_LDY, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0xbc: { ins: INS_LDY, mode: ADDR_ABSX,       size: 3, cycles: 4 },

  // LSR \u2014 Logical shift right
  0x4a: { ins: INS_LSR, mode: ADDR_ACC,        size: 1, cycles: 2 },
  0x46: { ins: INS_LSR, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0x56: { ins: INS_LSR, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0x4e: { ins: INS_LSR, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0x5e: { ins: INS_LSR, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // NOP \u2014 No operation. $EA is the official NOP; the other six bytes are
  // unofficial single-byte NOPs that the 6502's decoder happens to treat
  // identically, and we handle them the same way.
  0x1a: { ins: INS_NOP, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0x3a: { ins: INS_NOP, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0x5a: { ins: INS_NOP, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0x7a: { ins: INS_NOP, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0xda: { ins: INS_NOP, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0xea: { ins: INS_NOP, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0xfa: { ins: INS_NOP, mode: ADDR_IMP,        size: 1, cycles: 2 },

  // ORA \u2014 Bitwise OR with accumulator
  0x09: { ins: INS_ORA, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0x05: { ins: INS_ORA, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x15: { ins: INS_ORA, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0x0d: { ins: INS_ORA, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0x1d: { ins: INS_ORA, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0x19: { ins: INS_ORA, mode: ADDR_ABSY,       size: 3, cycles: 4 },
  0x01: { ins: INS_ORA, mode: ADDR_PREIDXIND,  size: 2, cycles: 6 },
  0x11: { ins: INS_ORA, mode: ADDR_POSTIDXIND, size: 2, cycles: 5 },

  // Stack pushes/pulls \u2014 PHA/PLA move the accumulator, PHP/PLP the status
  // register. The 6502 stack lives in page 1 ($0100-$01FF), with SP as an
  // offset into that page.
  0x48: { ins: INS_PHA, mode: ADDR_IMP,        size: 1, cycles: 3 },
  0x08: { ins: INS_PHP, mode: ADDR_IMP,        size: 1, cycles: 3 },
  0x68: { ins: INS_PLA, mode: ADDR_IMP,        size: 1, cycles: 4 },
  0x28: { ins: INS_PLP, mode: ADDR_IMP,        size: 1, cycles: 4 },

  // ROL \u2014 Rotate left through carry
  0x2a: { ins: INS_ROL, mode: ADDR_ACC,        size: 1, cycles: 2 },
  0x26: { ins: INS_ROL, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0x36: { ins: INS_ROL, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0x2e: { ins: INS_ROL, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0x3e: { ins: INS_ROL, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // ROR \u2014 Rotate right through carry
  0x6a: { ins: INS_ROR, mode: ADDR_ACC,        size: 1, cycles: 2 },
  0x66: { ins: INS_ROR, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0x76: { ins: INS_ROR, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0x6e: { ins: INS_ROR, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0x7e: { ins: INS_ROR, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // RTI / RTS \u2014 Return from interrupt handler / subroutine
  0x40: { ins: INS_RTI, mode: ADDR_IMP,        size: 1, cycles: 6 },
  0x60: { ins: INS_RTS, mode: ADDR_IMP,        size: 1, cycles: 6 },

  // SBC \u2014 Subtract memory from accumulator with borrow.
  // $EB is an unofficial alternate opcode that the 6502's decoder treats
  // identically to the official $E9 (immediate SBC).
  0xe9: { ins: INS_SBC, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0xeb: { ins: INS_SBC, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0xe5: { ins: INS_SBC, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0xf5: { ins: INS_SBC, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0xed: { ins: INS_SBC, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0xfd: { ins: INS_SBC, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0xf9: { ins: INS_SBC, mode: ADDR_ABSY,       size: 3, cycles: 4 },
  0xe1: { ins: INS_SBC, mode: ADDR_PREIDXIND,  size: 2, cycles: 6 },
  0xf1: { ins: INS_SBC, mode: ADDR_POSTIDXIND, size: 2, cycles: 5 },

  // Flag sets
  0x38: { ins: INS_SEC, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0xf8: { ins: INS_SED, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0x78: { ins: INS_SEI, mode: ADDR_IMP,        size: 1, cycles: 2 },

  // STA \u2014 Store accumulator to memory
  0x85: { ins: INS_STA, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x95: { ins: INS_STA, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0x8d: { ins: INS_STA, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0x9d: { ins: INS_STA, mode: ADDR_ABSX,       size: 3, cycles: 5 },
  0x99: { ins: INS_STA, mode: ADDR_ABSY,       size: 3, cycles: 5 },
  0x81: { ins: INS_STA, mode: ADDR_PREIDXIND,  size: 2, cycles: 6 },
  0x91: { ins: INS_STA, mode: ADDR_POSTIDXIND, size: 2, cycles: 6 },

  // STX \u2014 Store X to memory
  0x86: { ins: INS_STX, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x96: { ins: INS_STX, mode: ADDR_ZPY,        size: 2, cycles: 4 },
  0x8e: { ins: INS_STX, mode: ADDR_ABS,        size: 3, cycles: 4 },

  // STY \u2014 Store Y to memory
  0x84: { ins: INS_STY, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x94: { ins: INS_STY, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0x8c: { ins: INS_STY, mode: ADDR_ABS,        size: 3, cycles: 4 },

  // Register transfers \u2014 copy one register to another in a single cycle
  0xaa: { ins: INS_TAX, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0xa8: { ins: INS_TAY, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0xba: { ins: INS_TSX, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0x8a: { ins: INS_TXA, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0x9a: { ins: INS_TXS, mode: ADDR_IMP,        size: 1, cycles: 2 },
  0x98: { ins: INS_TYA, mode: ADDR_IMP,        size: 1, cycles: 2 },

  // --- Unofficial opcodes ---
  //
  // These aren't part of the official 6502 spec but fall out of the chip's
  // decoder logic. Nestest and AccuracyCoin exercise them, and a handful
  // of shipped NES games rely on them. See the INS_* comments above for
  // what each one actually computes.

  // ALR (ASR) \u2014 AND then LSR
  0x4b: { ins: INS_ALR, mode: ADDR_IMM,        size: 2, cycles: 2 },

  // ANC \u2014 AND, with carry also set to bit 7 of the result
  0x0b: { ins: INS_ANC, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0x2b: { ins: INS_ANC, mode: ADDR_IMM,        size: 2, cycles: 2 },

  // ARR \u2014 AND then ROR (with quirky N/V/C flag behavior)
  0x6b: { ins: INS_ARR, mode: ADDR_IMM,        size: 2, cycles: 2 },

  // AXS (SBX) \u2014 X = (A & X) - immediate
  0xcb: { ins: INS_AXS, mode: ADDR_IMM,        size: 2, cycles: 2 },

  // LAX \u2014 Load A and X simultaneously from memory
  0xa3: { ins: INS_LAX, mode: ADDR_PREIDXIND,  size: 2, cycles: 6 },
  0xa7: { ins: INS_LAX, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0xaf: { ins: INS_LAX, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0xb3: { ins: INS_LAX, mode: ADDR_POSTIDXIND, size: 2, cycles: 5 },
  0xb7: { ins: INS_LAX, mode: ADDR_ZPY,        size: 2, cycles: 4 },
  0xbf: { ins: INS_LAX, mode: ADDR_ABSY,       size: 3, cycles: 4 },

  // SAX \u2014 Store (A & X) to memory
  0x83: { ins: INS_SAX, mode: ADDR_PREIDXIND,  size: 2, cycles: 6 },
  0x87: { ins: INS_SAX, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x8f: { ins: INS_SAX, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0x97: { ins: INS_SAX, mode: ADDR_ZPY,        size: 2, cycles: 4 },

  // DCP \u2014 DEC memory then CMP with A
  0xc3: { ins: INS_DCP, mode: ADDR_PREIDXIND,  size: 2, cycles: 8 },
  0xc7: { ins: INS_DCP, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0xcf: { ins: INS_DCP, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0xd3: { ins: INS_DCP, mode: ADDR_POSTIDXIND, size: 2, cycles: 8 },
  0xd7: { ins: INS_DCP, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0xdb: { ins: INS_DCP, mode: ADDR_ABSY,       size: 3, cycles: 7 },
  0xdf: { ins: INS_DCP, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // ISC (ISB) \u2014 INC memory then SBC from A
  0xe3: { ins: INS_ISC, mode: ADDR_PREIDXIND,  size: 2, cycles: 8 },
  0xe7: { ins: INS_ISC, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0xef: { ins: INS_ISC, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0xf3: { ins: INS_ISC, mode: ADDR_POSTIDXIND, size: 2, cycles: 8 },
  0xf7: { ins: INS_ISC, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0xfb: { ins: INS_ISC, mode: ADDR_ABSY,       size: 3, cycles: 7 },
  0xff: { ins: INS_ISC, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // RLA \u2014 ROL memory then AND with A
  0x23: { ins: INS_RLA, mode: ADDR_PREIDXIND,  size: 2, cycles: 8 },
  0x27: { ins: INS_RLA, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0x2f: { ins: INS_RLA, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0x33: { ins: INS_RLA, mode: ADDR_POSTIDXIND, size: 2, cycles: 8 },
  0x37: { ins: INS_RLA, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0x3b: { ins: INS_RLA, mode: ADDR_ABSY,       size: 3, cycles: 7 },
  0x3f: { ins: INS_RLA, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // RRA \u2014 ROR memory then ADC with A
  0x63: { ins: INS_RRA, mode: ADDR_PREIDXIND,  size: 2, cycles: 8 },
  0x67: { ins: INS_RRA, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0x6f: { ins: INS_RRA, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0x73: { ins: INS_RRA, mode: ADDR_POSTIDXIND, size: 2, cycles: 8 },
  0x77: { ins: INS_RRA, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0x7b: { ins: INS_RRA, mode: ADDR_ABSY,       size: 3, cycles: 7 },
  0x7f: { ins: INS_RRA, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // SLO \u2014 ASL memory then ORA with A
  0x03: { ins: INS_SLO, mode: ADDR_PREIDXIND,  size: 2, cycles: 8 },
  0x07: { ins: INS_SLO, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0x0f: { ins: INS_SLO, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0x13: { ins: INS_SLO, mode: ADDR_POSTIDXIND, size: 2, cycles: 8 },
  0x17: { ins: INS_SLO, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0x1b: { ins: INS_SLO, mode: ADDR_ABSY,       size: 3, cycles: 7 },
  0x1f: { ins: INS_SLO, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // SRE \u2014 LSR memory then EOR with A
  0x43: { ins: INS_SRE, mode: ADDR_PREIDXIND,  size: 2, cycles: 8 },
  0x47: { ins: INS_SRE, mode: ADDR_ZP,         size: 2, cycles: 5 },
  0x4f: { ins: INS_SRE, mode: ADDR_ABS,        size: 3, cycles: 6 },
  0x53: { ins: INS_SRE, mode: ADDR_POSTIDXIND, size: 2, cycles: 8 },
  0x57: { ins: INS_SRE, mode: ADDR_ZPX,        size: 2, cycles: 6 },
  0x5b: { ins: INS_SRE, mode: ADDR_ABSY,       size: 3, cycles: 7 },
  0x5f: { ins: INS_SRE, mode: ADDR_ABSX,       size: 3, cycles: 7 },

  // SKB \u2014 2-byte NOP that skips an immediate byte
  0x80: { ins: INS_SKB, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0x82: { ins: INS_SKB, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0x89: { ins: INS_SKB, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0xc2: { ins: INS_SKB, mode: ADDR_IMM,        size: 2, cycles: 2 },
  0xe2: { ins: INS_SKB, mode: ADDR_IMM,        size: 2, cycles: 2 },

  // IGN \u2014 3-byte NOP that still performs a memory read
  0x0c: { ins: INS_IGN, mode: ADDR_ABS,        size: 3, cycles: 4 },
  0x1c: { ins: INS_IGN, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0x3c: { ins: INS_IGN, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0x5c: { ins: INS_IGN, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0x7c: { ins: INS_IGN, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0xdc: { ins: INS_IGN, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0xfc: { ins: INS_IGN, mode: ADDR_ABSX,       size: 3, cycles: 4 },
  0x04: { ins: INS_IGN, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x44: { ins: INS_IGN, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x64: { ins: INS_IGN, mode: ADDR_ZP,         size: 2, cycles: 3 },
  0x14: { ins: INS_IGN, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0x34: { ins: INS_IGN, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0x54: { ins: INS_IGN, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0x74: { ins: INS_IGN, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0xd4: { ins: INS_IGN, mode: ADDR_ZPX,        size: 2, cycles: 4 },
  0xf4: { ins: INS_IGN, mode: ADDR_ZPX,        size: 2, cycles: 4 },

  // SHA (AHX) \u2014 Store A & X & (H+1)
  0x93: { ins: INS_SHA, mode: ADDR_POSTIDXIND, size: 2, cycles: 6 },
  0x9f: { ins: INS_SHA, mode: ADDR_ABSY,       size: 3, cycles: 5 },

  // SHS (TAS) \u2014 SP = A & X, then store SP & (H+1)
  0x9b: { ins: INS_SHS, mode: ADDR_ABSY,       size: 3, cycles: 5 },

  // SHY (SYA) \u2014 Store Y & (H+1)
  0x9c: { ins: INS_SHY, mode: ADDR_ABSX,       size: 3, cycles: 5 },

  // SHX (SXA) \u2014 Store X & (H+1)
  0x9e: { ins: INS_SHX, mode: ADDR_ABSY,       size: 3, cycles: 5 },

  // LAE (LAS) \u2014 A = X = SP = memory & SP
  0xbb: { ins: INS_LAE, mode: ADDR_ABSY,       size: 3, cycles: 4 },

  // ANE (XAA) \u2014 A = (A | magic) & X & immediate
  0x8b: { ins: INS_ANE, mode: ADDR_IMM,        size: 2, cycles: 2 },

  // LXA \u2014 A = X = (A | magic) & immediate
  0xab: { ins: INS_LXA, mode: ADDR_IMM,        size: 2, cycles: 2 },
};

class CPU {
  // IRQ Types
  IRQ_NORMAL = 0;
  IRQ_NMI = 1;
  IRQ_RESET = 2;

  constructor(nes) {
    this.nes = nes;

    // Main memory (Uint8Array is zero-initialized, so only need to set non-zero regions)
    this.mem = new Uint8Array(0x10000);

    this.mem.fill(0xff, 0, 0x2000);
    for (let p = 0; p < 4; p++) {
      let j = p * 0x800;
      this.mem[j + 0x008] = 0xf7;
      this.mem[j + 0x009] = 0xef;
      this.mem[j + 0x00a] = 0xdf;
      this.mem[j + 0x00f] = 0xbf;
    }

    // CPU Registers:
    this.REG_ACC = 0;
    this.REG_X = 0;
    this.REG_Y = 0;
    // Reset Stack pointer:
    this.REG_SP = 0x01ff;
    // Reset Program counter:
    this.REG_PC = 0x8000 - 1;
    this.REG_PC_NEW = 0x8000 - 1;
    // Reset Status register:
    this.REG_STATUS = 0x28;

    this.setStatus(0x28);

    // Set flags:
    // Note: F_ZERO stores the result byte, not a boolean. When the result
    // is 0, F_ZERO is 0 and the Z flag is considered set. Any non-zero
    // value means the Z flag is clear. This avoids a comparison on every
    // instruction that affects Z. All other flags are 0 or 1.
    this.F_CARRY = 0;
    this.F_DECIMAL = 0;
    this.F_INTERRUPT = 1;
    this.F_INTERRUPT_NEW = 1;
    this.F_OVERFLOW = 0;
    this.F_SIGN = 0;
    this.F_ZERO = 1;

    this.F_NOTUSED = 1;
    this.F_NOTUSED_NEW = 1;
    this.F_BRK = 1;
    this.F_BRK_NEW = 1;

    this.cyclesToHalt = 0;

    // Reset crash flag:
    this.crash = false;

    // Interrupt notification:
    this.irqRequested = false;
    this.irqType = null;

    // NMI edge-detection pipeline matching real 6502 timing.
    // When the PPU's NMI output transitions low\u2192high, nmiRaised is set.
    // The NMI delay depends on which PPU dot within the CPU cycle the edge
    // occurs at: the edge detector samples at \u03C62 (end of cycle), and the
    // internal signal goes high during \u03C61 of the NEXT cycle. The signal must
    // be high by the instruction's final cycle for NMI to fire after it.
    //
    // In practice, this means:
    // - VBL edge with >= 5 remaining PPU dots in the instruction: the edge
    //   is detected early enough \u2192 NMI fires after this instruction (0-delay).
    //   The frame loop sets nmiImmediate, and the next emulate() fires NMI
    //   without executing an instruction first.
    // - VBL edge with <= 4 remaining dots: the edge is in the last cycle \u2192
    //   NMI fires after the NEXT instruction (1-delay). The frame loop sets
    //   nmiPending, giving standard pipeline behavior.
    // - $2000 write enabling NMI while VBL is active: the write always
    //   happens on the last bus cycle, so nmiRaised\u2192nmiPending promotion
    //   at the start of the next emulate() gives correct 1-delay.
    //
    // See https://www.nesdev.org/wiki/NMI and
    // https://www.nesdev.org/wiki/CPU_interrupts
    this.nmiRaised = false; // Set by _updateNmiOutput() on rising edge
    this.nmiPending = false; // NMI fires at end of this emulate() call
    this.nmiImmediate = false; // NMI fires at START of next emulate() (0-delay)

    // Tracks the last value on the CPU data bus. When reading from unmapped
    // addresses ("open bus"), the NES returns this value. Updated on every
    // read, write, push, pull, and interrupt vector fetch.
    // See https://www.nesdev.org/wiki/Open_bus_behavior
    this.dataBus = 0;

    // Bus cycles completed in the current instruction. Incremented by every
    // load/write/push/pull call. Used by SHx instructions to detect DMC DMA
    // bus hijacking mid-instruction.
    this.instrBusCycles = 0;
    // APU frame counter cycles already advanced mid-instruction (for $4015
    // catch-up). Reset at start of each instruction.
    this.apuCatchupCycles = 0;
    // Running total of CPU cycles executed so far in the current frame.
    // Used to determine APU clock parity for $4016 OUT0 latching.
    // The 2A03's output ports (OUT0-OUT2) only update on APU clock edges,
    // which occur every 2 CPU cycles. This counter lets mapper code check
    // whether a given bus cycle falls on a "put" (even) or "get" (odd)
    // cycle. See https://www.nesdev.org/wiki/CPU_pin_out_and_signal_timing
    this._cpuCycleBase = 0;
    // Records which bus cycle nmiRaised was set during, for 0-delay vs
    // 1-delay NMI determination at end of instruction.
    this.nmiRaisedAtCycle = 0;
    // Sub-dot precision: remaining dots (including the VBlank dot) within
    // the ppu.advanceDots() call that raised NMI. Used together with
    // nmiRaisedAtCycle to compute remaining PPU dots for the >= 5
    // threshold check (matching the old frame loop behavior).
    this.nmiDotsRemainingInStep = 0;
  }

  // Emulates a single CPU instruction, returns the number of cycles
  emulate() {
    // 0-delay NMI: when VBL edge was detected early enough in the previous
    // instruction (>= 5 PPU dots remaining), the NMI signal propagates in
    // time for the final-cycle poll. On real hardware, the NMI sequence
    // begins instead of the next opcode fetch. Fire NMI without executing
    // an instruction. See https://www.nesdev.org/wiki/CPU_interrupts
    if (this.nmiImmediate) {
      this.nmiImmediate = false;
      this.nmiPending = false;
      this.nmiRaised = false;
      this.instrBusCycles = 0;

      this.REG_PC_NEW = this.REG_PC;
      this.F_INTERRUPT_NEW = this.F_INTERRUPT;
      this.doNonMaskableInterrupt(this.getStatus() & 0xef);
      this.REG_PC = this.REG_PC_NEW;
      this.F_INTERRUPT = this.F_INTERRUPT_NEW;
      this.F_BRK = this.F_BRK_NEW;
      this._cpuCycleBase += 7;
      return 7;
    }

    let temp;
    let add;
    // High byte of the base address before index addition, used by
    // SHA/SHX/SHY/SHS to compute the stored value as REG & (H+1).
    // Set in addressing mode cases 8 (ABSX), 9 (ABSY), 11 (POSTIDXIND).
    let baseHigh = 0;

    // Track interrupt overhead cycles. NMI and IRQ each take 7 bus cycles
    // (2 dummy reads + 3 pushes + 2 vector reads) that must be included
    // in the returned cycle count so the frame loop advances the PPU
    // correctly. See https://www.nesdev.org/wiki/CPU_interrupts
    let interruptCycles = 0;

    // Promote nmiRaised to nmiPending. This gives a 1-instruction delay
    // between the NMI assertion (rising edge in _updateNmiOutput) and the
    // NMI being serviced: the instruction that runs in this emulate() call
    // executes first, then NMI fires at the end. On real hardware, the 6502
    // detects NMI edges on the penultimate cycle of each instruction, so
    // the earliest an NMI can fire is after the instruction following the
    // one during which the edge occurred.
    // See https://www.nesdev.org/wiki/CPU_interrupts
    if (this.nmiRaised) {
      this.nmiPending = true;
      this.nmiRaised = false;
    }

    // Check IRQ/reset at the start of each instruction.
    if (this.irqRequested) {
      temp = this.getStatus();

      this.REG_PC_NEW = this.REG_PC;
      this.F_INTERRUPT_NEW = this.F_INTERRUPT;
      switch (this.irqType) {
        case 0: {
          // Normal IRQ:
          if (this.F_INTERRUPT !== 0) {
            break;
          }
          // Clear the B flag (bit 4) for hardware interrupts
          this.doIrq(temp & 0xef);
          interruptCycles = 7;
          break;
        }
        case 2: {
          // Reset:
          this.doResetInterrupt();
          interruptCycles = 7;
          break;
        }
      }

      this.REG_PC = this.REG_PC_NEW;
      this.F_INTERRUPT = this.F_INTERRUPT_NEW;
      this.F_BRK = this.F_BRK_NEW;
      this.irqRequested = false;
    }

    if (this.nes.mmap === null) return 32;

    // Reset bus cycle and APU catch-up counters for this instruction.
    this.instrBusCycles = 0;
    this.apuCatchupCycles = 0;
    this.nmiDotsRemainingInStep = 0;

    // Snapshot how many CPU cycles until the next DMC DMA fetch. Used by
    // SHx instructions to detect bus hijacking mid-instruction.
    this._dmcFetchCycles = this._cyclesToNextDmcFetch();

    // --- Fetch ---
    // Read the opcode byte at PC. (REG_PC is one less than the actual
    // instruction address \u2014 a convenience so that the post-increment in
    // REG_PC += opinfo.size below lands on the next instruction.)
    let opcode = this.loadFromCartridge(this.REG_PC + 1);
    this.dataBus = opcode;
    this.instrBusCycles = 1;
    this.nes.ppu.advanceDots(3);

    // --- Decode ---
    // Look up the opcode in the table at the top of this file to find out
    // which instruction this is, what addressing mode to use, how many
    // bytes it consumes, and its base cycle count. See OPCODE_TABLE.
    let opinfo = OPCODE_TABLE[opcode] ?? INVALID_OPCODE;
    let cycleCount = opinfo.cycles;
    let cycleAdd = 0; // extra cycles from page-crossing in indexed modes
    let addrMode = opinfo.mode;

    // Advance PC past the instruction's operand bytes so it points at the
    // next instruction. (opaddr keeps a copy of the pre-advance PC for
    // relative branches and the operand-byte fetches below.)
    let opaddr = this.REG_PC;
    this.REG_PC += opinfo.size;

    // --- Address (decode continued) ---
    // Each addressing mode has its own rules for turning the operand bytes
    // into an effective address (or literal value) for the instruction to
    // work with. The numeric \`case N:\` labels here match the ADDR_* values
    // at the top of the file \u2014 e.g. \`case 4:\` is ADDR_ACC. This switch
    // also performs any "dummy reads" the real 6502 does on certain modes;
    // those are real bus cycles that can trigger I/O side effects, so
    // skipping them would be a correctness bug, not an optimization.
    let addr = 0;
    switch (addrMode) {
      case 0: {
        // Zero Page mode. Use the address given after the opcode,
        // but without high byte.
        addr = this.loadDirect(opaddr + 2);
        break;
      }
      case 1: {
        // Relative mode.
        addr = this.loadDirect(opaddr + 2);
        if (addr < 0x80) {
          addr += this.REG_PC;
        } else {
          addr += this.REG_PC - 256;
        }
        break;
      }
      case 2: {
        // Implied mode. The 6502's second cycle performs a dummy read of the
        // byte at PC (the next opcode). This is a real bus operation that
        // updates the data bus and can trigger I/O side effects.
        // Note: opaddr is REG_PC which is one less than the actual instruction
        // address (opcode is at opaddr+1), so the dummy read targets opaddr+2.
        // See https://www.nesdev.org/wiki/CPU_addressing_modes
        this.loadDirect(opaddr + 2);
        break;
      }
      case 3: {
        // Absolute mode. Use the two bytes following the opcode as
        // an address.
        addr = this.load16bit(opaddr + 2);
        break;
      }
      case 4: {
        // Accumulator mode. The address is in the accumulator register.
        // Like implied mode, the 6502 performs a dummy read of the byte at PC
        // during its second cycle (opaddr+2, see case 2 comment).
        // See https://www.nesdev.org/wiki/CPU_addressing_modes
        this.loadDirect(opaddr + 2);
        addr = this.REG_ACC;
        break;
      }
      case 5: {
        // Immediate mode. The value is given after the opcode.
        addr = this.REG_PC;
        break;
      }
      case 6: {
        // Zero Page Indexed mode, X as index. Use the address given
        // after the opcode, then add the X register to get the final address.
        // The 6502 reads from the unindexed zero-page address while adding X.
        // This "dummy read" is a real bus cycle that can trigger I/O side effects.
        // See https://www.nesdev.org/wiki/CPU_addressing_modes
        let zpBase6 = this.loadDirect(opaddr + 2);
        this.loadDirect(zpBase6); // dummy read from unindexed zero-page address
        addr = (zpBase6 + this.REG_X) & 0xff;
        break;
      }
      case 7: {
        // Zero Page Indexed mode, Y as index. Same dummy read behavior as case 6.
        let zpBase7 = this.loadDirect(opaddr + 2);
        this.loadDirect(zpBase7); // dummy read from unindexed zero-page address
        addr = (zpBase7 + this.REG_Y) & 0xff;
        break;
      }
      case 8: {
        // Absolute Indexed Mode, X as index.
        addr = this.load16bit(opaddr + 2);
        baseHigh = (addr >> 8) & 0xff;
        if ((addr & 0xff00) !== ((addr + this.REG_X) & 0xff00)) {
          // Page boundary crossed: the 6502 first reads from the "wrong"
          // address (correct low byte, uncorrected high byte) before reading
          // the correct one. This dummy read is a real bus cycle that updates
          // the data bus and can trigger I/O side effects.
          // See https://www.nesdev.org/wiki/CPU_addressing_modes
          this.load((addr & 0xff00) | ((addr + this.REG_X) & 0xff));
          cycleAdd = 1;
        }
        addr += this.REG_X;
        break;
      }
      case 9: {
        // Absolute Indexed Mode, Y as index.
        // Same page-crossing dummy read behavior as case 8.
        addr = this.load16bit(opaddr + 2);
        baseHigh = (addr >> 8) & 0xff;
        if ((addr & 0xff00) !== ((addr + this.REG_Y) & 0xff00)) {
          this.load((addr & 0xff00) | ((addr + this.REG_Y) & 0xff));
          cycleAdd = 1;
        }
        addr += this.REG_Y;
        break;
      }
      case 10: {
        // Pre-indexed Indirect mode, (d,X). Read pointer from zero page,
        // add X, then read the 16-bit effective address. Wraps within zero page.
        // Dummy read from the unindexed pointer address while adding X.
        let zpPtr10 = this.loadDirect(opaddr + 2);
        this.loadDirect(zpPtr10); // dummy read: 6502 reads from ptr before adding X
        let zpAddr10 = (zpPtr10 + this.REG_X) & 0xff;
        addr =
          this.loadDirect(zpAddr10) |
          (this.loadDirect((zpAddr10 + 1) & 0xff) << 8);
        break;
      }
      case 11: {
        // Post-indexed Indirect mode, (d),Y. Read 16-bit base address from
        // zero page, then add Y. Page-crossing dummy read as in case 8.
        let zpAddr = this.loadDirect(opaddr + 2);
        addr =
          this.loadDirect(zpAddr) | (this.loadDirect((zpAddr + 1) & 0xff) << 8);
        baseHigh = (addr >> 8) & 0xff;
        if ((addr & 0xff00) !== ((addr + this.REG_Y) & 0xff00)) {
          this.load((addr & 0xff00) | ((addr + this.REG_Y) & 0xff));
          cycleAdd = 1;
        }
        addr += this.REG_Y;
        break;
      }
      case 12: {
        // Indirect Absolute mode (JMP indirect). Find the 16-bit address
        // contained at the given location. The 6502 has a famous bug: when
        // the pointer's low byte is $FF, the high byte wraps within the
        // same page instead of crossing to the next page.
        addr = this.load16bit(opaddr + 2); // Find op
        var hiAddr = (addr & 0xff00) | (((addr & 0xff) + 1) & 0xff);
        addr = this.load(addr) | (this.load(hiAddr) << 8);
        break;
      }
    }
    // Wrap around for addresses above 0xFFFF:
    addr &= 0xffff;

    // ----------------------------------------------------------------------------------------------------
    // Execute
    // ----------------------------------------------------------------------------------------------------
    //
    // Now that we know which instruction this is (opinfo.ins) and where
    // its operand lives (addr), actually run the operation. Each \`case\`
    // below handles one instruction; the numeric labels match the INS_*
    // values at the top of the file (e.g. \`case 0:\` is INS_ADC).
    //
    // Several instructions read their operand's addressing mode again
    // (via \`addrMode\`) to handle mode-specific quirks \u2014 e.g. ASL/LSR/ROL
    // /ROR operate on the accumulator directly when addrMode == ADDR_ACC
    // instead of reading and writing memory; stores and RMW instructions
    // perform extra dummy reads/writes in indexed modes to match the
    // real 6502's bus timing.
    //
    // The case labels are raw integers rather than INS_* constants so
    // that V8 compiles this dispatch into a jump table \u2014 it only does
    // that when every case expression is a literal integer at parse
    // time. With ~78 cases on the hottest loop in the emulator, using
    // constants would noticeably slow the dispatch.
    switch (opinfo.ins) {
      case 0: {
        // *******
        // * ADC *
        // *******

        // Add with carry.
        add = this.load(addr);
        temp = this.REG_ACC + add + this.F_CARRY;

        if (
          ((this.REG_ACC ^ add) & 0x80) === 0 &&
          ((this.REG_ACC ^ temp) & 0x80) !== 0
        ) {
          this.F_OVERFLOW = 1;
        } else {
          this.F_OVERFLOW = 0;
        }
        this.F_CARRY = temp > 255 ? 1 : 0;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        this.REG_ACC = temp & 255;
        cycleCount += cycleAdd;
        break;
      }
      case 1: {
        // *******
        // * AND *
        // *******

        // AND memory with accumulator.
        this.REG_ACC = this.REG_ACC & this.load(addr);
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        cycleCount += cycleAdd;
        break;
      }
      case 2: {
        // *******
        // * ASL *
        // *******

        // Shift left one bit
        if (addrMode === ADDR_ACC) {
          this.F_CARRY = (this.REG_ACC >> 7) & 1;
          this.REG_ACC = (this.REG_ACC << 1) & 255;
          this.F_SIGN = (this.REG_ACC >> 7) & 1;
          this.F_ZERO = this.REG_ACC;
        } else {
          // Read-Modify-Write (RMW) cycle pattern for memory operands:
          //   1. For indexed modes without page crossing, the 6502 always
          //      does a dummy read (same as stores, see case 47/STA).
          //   2. Read the value from the effective address.
          //   3. Write the ORIGINAL value back (dummy write) while computing.
          //   4. Write the MODIFIED value.
          // The dummy write is a real bus cycle \u2014 writing to I/O registers
          // like PPU $2007 twice has visible side effects.
          // See https://www.nesdev.org/wiki/CPU_addressing_modes (RMW column)
          if (
            cycleAdd === 0 &&
            (addrMode === ADDR_ABSX ||
              addrMode === ADDR_ABSY ||
              addrMode === ADDR_POSTIDXIND)
          ) {
            this.load(addr); // dummy read (indexed, no page crossing)
          }
          temp = this.load(addr);
          this.write(addr, temp); // dummy write (original value)
          this.F_CARRY = (temp >> 7) & 1;
          temp = (temp << 1) & 255;
          this.F_SIGN = (temp >> 7) & 1;
          this.F_ZERO = temp;
          this.write(addr, temp);
        }
        break;
      }
      case 3: {
        // *******
        // * BCC *
        // *******

        // Branch on carry clear
        if (this.F_CARRY === 0) {
          cycleCount += this._takeBranch(opaddr, addr);
        }
        break;
      }
      case 4: {
        // *******
        // * BCS *
        // *******

        // Branch on carry set
        if (this.F_CARRY === 1) {
          cycleCount += this._takeBranch(opaddr, addr);
        }
        break;
      }
      case 5: {
        // *******
        // * BEQ *
        // *******

        // Branch on zero
        if (this.F_ZERO === 0) {
          cycleCount += this._takeBranch(opaddr, addr);
        }
        break;
      }
      case 6: {
        // *******
        // * BIT *
        // *******

        temp = this.load(addr);
        this.F_SIGN = (temp >> 7) & 1;
        this.F_OVERFLOW = (temp >> 6) & 1;
        temp &= this.REG_ACC;
        this.F_ZERO = temp;
        break;
      }
      case 7: {
        // *******
        // * BMI *
        // *******

        // Branch on negative result
        if (this.F_SIGN === 1) {
          cycleCount += this._takeBranch(opaddr, addr);
        }
        break;
      }
      case 8: {
        // *******
        // * BNE *
        // *******

        // Branch on not zero
        if (this.F_ZERO !== 0) {
          cycleCount += this._takeBranch(opaddr, addr);
        }
        break;
      }
      case 9: {
        // *******
        // * BPL *
        // *******

        // Branch on positive result
        if (this.F_SIGN === 0) {
          cycleCount += this._takeBranch(opaddr, addr);
        }
        break;
      }
      case 10: {
        // *******
        // * BRK *
        // *******

        this.REG_PC += 2;
        this.push((this.REG_PC >> 8) & 255);
        this.push(this.REG_PC & 255);
        this.F_BRK = 1;
        this.push(this.getStatus());

        this.F_INTERRUPT = 1;
        //this.REG_PC = load(0xFFFE) | (load(0xFFFF) << 8);
        this.REG_PC = this.load16bit(0xfffe);
        this.REG_PC--;
        break;
      }
      case 11: {
        // *******
        // * BVC *
        // *******

        // Branch on overflow clear
        if (this.F_OVERFLOW === 0) {
          cycleCount += this._takeBranch(opaddr, addr);
        }
        break;
      }
      case 12: {
        // *******
        // * BVS *
        // *******

        // Branch on overflow set
        if (this.F_OVERFLOW === 1) {
          cycleCount += this._takeBranch(opaddr, addr);
        }
        break;
      }
      case 13: {
        // *******
        // * CLC *
        // *******

        // Clear carry flag
        this.F_CARRY = 0;
        break;
      }
      case 14: {
        // *******
        // * CLD *
        // *******

        // Clear decimal flag
        this.F_DECIMAL = 0;
        break;
      }
      case 15: {
        // *******
        // * CLI *
        // *******

        // Clear interrupt flag
        this.F_INTERRUPT = 0;
        break;
      }
      case 16: {
        // *******
        // * CLV *
        // *******

        // Clear overflow flag
        this.F_OVERFLOW = 0;
        break;
      }
      case 17: {
        // *******
        // * CMP *
        // *******

        // Compare memory and accumulator:
        temp = this.REG_ACC - this.load(addr);
        this.F_CARRY = temp >= 0 ? 1 : 0;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        cycleCount += cycleAdd;
        break;
      }
      case 18: {
        // *******
        // * CPX *
        // *******

        // Compare memory and index X:
        temp = this.REG_X - this.load(addr);
        this.F_CARRY = temp >= 0 ? 1 : 0;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        break;
      }
      case 19: {
        // *******
        // * CPY *
        // *******

        // Compare memory and index Y:
        temp = this.REG_Y - this.load(addr);
        this.F_CARRY = temp >= 0 ? 1 : 0;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        break;
      }
      case 20: {
        // *******
        // * DEC *
        // *******

        // Decrement memory by one (RMW pattern, see ASL case 2):
        if (
          cycleAdd === 0 &&
          (addrMode === ADDR_ABSX ||
            addrMode === ADDR_ABSY ||
            addrMode === ADDR_POSTIDXIND)
        ) {
          this.load(addr); // dummy read (indexed, no page crossing)
        }
        temp = this.load(addr);
        this.write(addr, temp); // dummy write (original value)
        temp = (temp - 1) & 0xff;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp;
        this.write(addr, temp);
        break;
      }
      case 21: {
        // *******
        // * DEX *
        // *******

        // Decrement index X by one:
        this.REG_X = (this.REG_X - 1) & 0xff;
        this.F_SIGN = (this.REG_X >> 7) & 1;
        this.F_ZERO = this.REG_X;
        break;
      }
      case 22: {
        // *******
        // * DEY *
        // *******

        // Decrement index Y by one:
        this.REG_Y = (this.REG_Y - 1) & 0xff;
        this.F_SIGN = (this.REG_Y >> 7) & 1;
        this.F_ZERO = this.REG_Y;
        break;
      }
      case 23: {
        // *******
        // * EOR *
        // *******

        // XOR Memory with accumulator, store in accumulator:
        this.REG_ACC = (this.load(addr) ^ this.REG_ACC) & 0xff;
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        cycleCount += cycleAdd;
        break;
      }
      case 24: {
        // *******
        // * INC *
        // *******

        // Increment memory by one (RMW pattern, see ASL case 2):
        if (
          cycleAdd === 0 &&
          (addrMode === ADDR_ABSX ||
            addrMode === ADDR_ABSY ||
            addrMode === ADDR_POSTIDXIND)
        ) {
          this.load(addr); // dummy read (indexed, no page crossing)
        }
        temp = this.load(addr);
        this.write(addr, temp); // dummy write (original value)
        temp = (temp + 1) & 0xff;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp;
        this.write(addr, temp);
        break;
      }
      case 25: {
        // *******
        // * INX *
        // *******

        // Increment index X by one:
        this.REG_X = (this.REG_X + 1) & 0xff;
        this.F_SIGN = (this.REG_X >> 7) & 1;
        this.F_ZERO = this.REG_X;
        break;
      }
      case 26: {
        // *******
        // * INY *
        // *******

        // Increment index Y by one:
        this.REG_Y++;
        this.REG_Y &= 0xff;
        this.F_SIGN = (this.REG_Y >> 7) & 1;
        this.F_ZERO = this.REG_Y;
        break;
      }
      case 27: {
        // *******
        // * JMP *
        // *******

        // Jump to new location:
        this.REG_PC = addr - 1;
        break;
      }
      case 28: {
        // *******
        // * JSR *
        // *******

        // Jump to new location, saving return address.
        // Push return address on stack:
        this.push((this.REG_PC >> 8) & 255);
        this.push(this.REG_PC & 255);
        // On real 6502, JSR reads the high byte of the target address as its
        // last cycle (after the pushes), updating the data bus. This matters
        // for open bus behavior when JSR targets unmapped addresses.
        // See https://www.nesdev.org/wiki/Open_bus_behavior
        this.loadDirect(opaddr + 3);
        this.REG_PC = addr - 1;
        break;
      }
      case 29: {
        // *******
        // * LDA *
        // *******

        // Load accumulator with memory:
        this.REG_ACC = this.load(addr);
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        cycleCount += cycleAdd;
        break;
      }
      case 30: {
        // *******
        // * LDX *
        // *******

        // Load index X with memory:
        this.REG_X = this.load(addr);
        this.F_SIGN = (this.REG_X >> 7) & 1;
        this.F_ZERO = this.REG_X;
        cycleCount += cycleAdd;
        break;
      }
      case 31: {
        // *******
        // * LDY *
        // *******

        // Load index Y with memory:
        this.REG_Y = this.load(addr);
        this.F_SIGN = (this.REG_Y >> 7) & 1;
        this.F_ZERO = this.REG_Y;
        cycleCount += cycleAdd;
        break;
      }
      case 32: {
        // *******
        // * LSR *
        // *******

        // Shift right one bit (RMW pattern, see ASL case 2):
        if (addrMode === ADDR_ACC) {
          temp = this.REG_ACC & 0xff;
          this.F_CARRY = temp & 1;
          temp >>= 1;
          this.REG_ACC = temp;
        } else {
          if (
            cycleAdd === 0 &&
            (addrMode === ADDR_ABSX ||
              addrMode === ADDR_ABSY ||
              addrMode === ADDR_POSTIDXIND)
          ) {
            this.load(addr); // dummy read (indexed, no page crossing)
          }
          temp = this.load(addr) & 0xff;
          this.write(addr, temp); // dummy write (original value)
          this.F_CARRY = temp & 1;
          temp >>= 1;
          this.write(addr, temp);
        }
        this.F_SIGN = 0;
        this.F_ZERO = temp;
        break;
      }
      case 33: {
        // *******
        // * NOP *
        // *******

        // No OPeration.
        // Ignore.
        break;
      }
      case 34: {
        // *******
        // * ORA *
        // *******

        // OR memory with accumulator, store in accumulator.
        temp = (this.load(addr) | this.REG_ACC) & 255;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp;
        this.REG_ACC = temp;
        cycleCount += cycleAdd;
        break;
      }
      case 35: {
        // *******
        // * PHA *
        // *******

        // Push accumulator on stack
        this.push(this.REG_ACC);
        break;
      }
      case 36: {
        // *******
        // * PHP *
        // *******

        // Push processor status on stack
        this.F_BRK = 1;
        this.push(this.getStatus());
        break;
      }
      case 37: {
        // *******
        // * PLA *
        // *******

        // Pull accumulator from stack
        this.REG_ACC = this.pull();
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        break;
      }
      case 38: {
        // *******
        // * PLP *
        // *******

        // Pull processor status from stack
        this.setStatusFromStack(this.pull());
        break;
      }
      case 39: {
        // *******
        // * ROL *
        // *******

        // Rotate one bit left (RMW pattern, see ASL case 2)
        if (addrMode === ADDR_ACC) {
          temp = this.REG_ACC;
          add = this.F_CARRY;
          this.F_CARRY = (temp >> 7) & 1;
          temp = ((temp << 1) & 0xff) + add;
          this.REG_ACC = temp;
        } else {
          if (
            cycleAdd === 0 &&
            (addrMode === ADDR_ABSX ||
              addrMode === ADDR_ABSY ||
              addrMode === ADDR_POSTIDXIND)
          ) {
            this.load(addr); // dummy read (indexed, no page crossing)
          }
          temp = this.load(addr);
          this.write(addr, temp); // dummy write (original value)
          add = this.F_CARRY;
          this.F_CARRY = (temp >> 7) & 1;
          temp = ((temp << 1) & 0xff) + add;
          this.write(addr, temp);
        }
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp;
        break;
      }
      case 40: {
        // *******
        // * ROR *
        // *******

        // Rotate one bit right (RMW pattern, see ASL case 2)
        if (addrMode === ADDR_ACC) {
          add = this.F_CARRY << 7;
          this.F_CARRY = this.REG_ACC & 1;
          temp = (this.REG_ACC >> 1) + add;
          this.REG_ACC = temp;
        } else {
          if (
            cycleAdd === 0 &&
            (addrMode === ADDR_ABSX ||
              addrMode === ADDR_ABSY ||
              addrMode === ADDR_POSTIDXIND)
          ) {
            this.load(addr); // dummy read (indexed, no page crossing)
          }
          temp = this.load(addr);
          this.write(addr, temp); // dummy write (original value)
          add = this.F_CARRY << 7;
          this.F_CARRY = temp & 1;
          temp = (temp >> 1) + add;
          this.write(addr, temp);
        }
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp;
        break;
      }
      case 41: {
        // *******
        // * RTI *
        // *******

        // Return from interrupt. Pull status and PC from stack.
        this.setStatusFromStack(this.pull());

        this.REG_PC = this.pull();
        this.REG_PC += this.pull() << 8;
        if (this.REG_PC === 0xffff) {
          return;
        }
        this.REG_PC--;
        break;
      }
      case 42: {
        // *******
        // * RTS *
        // *******

        // Return from subroutine. Pull PC from stack.

        this.REG_PC = this.pull();
        this.REG_PC += this.pull() << 8;

        if (this.REG_PC === 0xffff) {
          return; // return from NSF play routine:
        }
        break;
      }
      case 43: {
        // *******
        // * SBC *
        // *******

        add = this.load(addr);
        temp = this.REG_ACC - add - (1 - this.F_CARRY);
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        if (
          ((this.REG_ACC ^ temp) & 0x80) !== 0 &&
          ((this.REG_ACC ^ add) & 0x80) !== 0
        ) {
          this.F_OVERFLOW = 1;
        } else {
          this.F_OVERFLOW = 0;
        }
        this.F_CARRY = temp < 0 ? 0 : 1;
        this.REG_ACC = temp & 0xff;
        cycleCount += cycleAdd;
        break;
      }
      case 44: {
        // *******
        // * SEC *
        // *******

        // Set carry flag
        this.F_CARRY = 1;
        break;
      }
      case 45: {
        // *******
        // * SED *
        // *******

        // Set decimal mode
        this.F_DECIMAL = 1;
        break;
      }
      case 46: {
        // *******
        // * SEI *
        // *******

        // Set interrupt disable status
        this.F_INTERRUPT = 1;
        break;
      }
      case 47: {
        // *******
        // * STA *
        // *******

        // Store accumulator in memory.
        // Unlike loads, stores ALWAYS take the extra cycle for indexed
        // addressing, even without a page crossing. The page-crossing case
        // already added the dummy read in the addressing mode (cases 8/9/11);
        // this handles the non-crossing case.
        if (
          cycleAdd === 0 &&
          (addrMode === ADDR_ABSX ||
            addrMode === ADDR_ABSY ||
            addrMode === ADDR_POSTIDXIND)
        ) {
          this.load(addr);
        }
        this.write(addr, this.REG_ACC);
        break;
      }
      case 48: {
        // *******
        // * STX *
        // *******

        // Store index X in memory
        this.write(addr, this.REG_X);
        break;
      }
      case 49: {
        // *******
        // * STY *
        // *******

        // Store index Y in memory:
        this.write(addr, this.REG_Y);
        break;
      }
      case 50: {
        // *******
        // * TAX *
        // *******

        // Transfer accumulator to index X:
        this.REG_X = this.REG_ACC;
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        break;
      }
      case 51: {
        // *******
        // * TAY *
        // *******

        // Transfer accumulator to index Y:
        this.REG_Y = this.REG_ACC;
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        break;
      }
      case 52: {
        // *******
        // * TSX *
        // *******

        // Transfer stack pointer to index X:
        this.REG_X = this.REG_SP & 0xff;
        this.F_SIGN = (this.REG_SP >> 7) & 1;
        this.F_ZERO = this.REG_X;
        break;
      }
      case 53: {
        // *******
        // * TXA *
        // *******

        // Transfer index X to accumulator:
        this.REG_ACC = this.REG_X;
        this.F_SIGN = (this.REG_X >> 7) & 1;
        this.F_ZERO = this.REG_X;
        break;
      }
      case 54: {
        // *******
        // * TXS *
        // *******

        // Transfer index X to stack pointer:
        this.REG_SP = this.REG_X & 0xff;
        break;
      }
      case 55: {
        // *******
        // * TYA *
        // *******

        // Transfer index Y to accumulator:
        this.REG_ACC = this.REG_Y;
        this.F_SIGN = (this.REG_Y >> 7) & 1;
        this.F_ZERO = this.REG_Y;
        break;
      }
      case 56: {
        // *******
        // * ALR *
        // *******

        // Shift right one bit after ANDing:
        temp = this.REG_ACC & this.load(addr);
        this.F_CARRY = temp & 1;
        this.REG_ACC = this.F_ZERO = temp >> 1;
        this.F_SIGN = 0;
        break;
      }
      case 57: {
        // *******
        // * ANC *
        // *******

        // AND accumulator, setting carry to bit 7 result.
        this.REG_ACC = this.F_ZERO = this.REG_ACC & this.load(addr);
        this.F_CARRY = this.F_SIGN = (this.REG_ACC >> 7) & 1;
        break;
      }
      case 58: {
        // *******
        // * ARR *
        // *******

        // Rotate right one bit after ANDing:
        temp = this.REG_ACC & this.load(addr);
        this.REG_ACC = this.F_ZERO = (temp >> 1) + (this.F_CARRY << 7);
        this.F_SIGN = this.F_CARRY;
        this.F_CARRY = (temp >> 7) & 1;
        this.F_OVERFLOW = ((temp >> 7) ^ (temp >> 6)) & 1;
        break;
      }
      case 59: {
        // *******
        // * AXS *
        // *******

        // Set X to (X AND A) - value.
        // Like CMP, AXS sets N, Z, C but does NOT affect the V (overflow) flag.
        // https://www.nesdev.org/wiki/Programming_with_unofficial_opcodes
        temp = (this.REG_X & this.REG_ACC) - this.load(addr);
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        this.F_CARRY = temp < 0 ? 0 : 1;
        this.REG_X = temp & 0xff;
        break;
      }
      case 60: {
        // *******
        // * LAX *
        // *******

        // Load A and X with memory:
        this.REG_ACC = this.REG_X = this.F_ZERO = this.load(addr);
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        cycleCount += cycleAdd;
        break;
      }
      case 61: {
        // *******
        // * SAX *
        // *******

        // Store A AND X in memory:
        this.write(addr, this.REG_ACC & this.REG_X);
        break;
      }
      case 62: {
        // *******
        // * DCP *
        // *******

        // Decrement memory then compare (unofficial, RMW pattern see ASL case 2):
        if (
          cycleAdd === 0 &&
          (addrMode === ADDR_ABSX ||
            addrMode === ADDR_ABSY ||
            addrMode === ADDR_POSTIDXIND)
        ) {
          this.load(addr); // dummy read (indexed, no page crossing)
        }
        temp = this.load(addr);
        this.write(addr, temp); // dummy write (original value)
        temp = (temp - 1) & 0xff;
        this.write(addr, temp);

        // Then compare with the accumulator:
        temp = this.REG_ACC - temp;
        this.F_CARRY = temp >= 0 ? 1 : 0;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        break;
      }
      case 63: {
        // *******
        // * ISC *
        // *******

        // Increment memory then subtract (unofficial, RMW pattern see ASL case 2):
        if (
          cycleAdd === 0 &&
          (addrMode === ADDR_ABSX ||
            addrMode === ADDR_ABSY ||
            addrMode === ADDR_POSTIDXIND)
        ) {
          this.load(addr); // dummy read (indexed, no page crossing)
        }
        temp = this.load(addr);
        this.write(addr, temp); // dummy write (original value)
        temp = (temp + 1) & 0xff;
        this.write(addr, temp);

        // Then subtract from the accumulator:
        let isb_val = temp;
        temp = this.REG_ACC - isb_val - (1 - this.F_CARRY);
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        if (
          ((this.REG_ACC ^ temp) & 0x80) !== 0 &&
          ((this.REG_ACC ^ isb_val) & 0x80) !== 0
        ) {
          this.F_OVERFLOW = 1;
        } else {
          this.F_OVERFLOW = 0;
        }
        this.F_CARRY = temp < 0 ? 0 : 1;
        this.REG_ACC = temp & 0xff;
        break;
      }
      case 64: {
        // *******
        // * RLA *
        // *******

        // Rotate left then AND (unofficial, RMW pattern see ASL case 2)
        if (
          cycleAdd === 0 &&
          (addrMode === ADDR_ABSX ||
            addrMode === ADDR_ABSY ||
            addrMode === ADDR_POSTIDXIND)
        ) {
          this.load(addr); // dummy read (indexed, no page crossing)
        }
        temp = this.load(addr);
        this.write(addr, temp); // dummy write (original value)
        add = this.F_CARRY;
        this.F_CARRY = (temp >> 7) & 1;
        temp = ((temp << 1) & 0xff) + add;
        this.write(addr, temp);

        // Then AND with the accumulator.
        this.REG_ACC = this.REG_ACC & temp;
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        break;
      }
      case 65: {
        // *******
        // * RRA *
        // *******

        // Rotate right then add (unofficial, RMW pattern see ASL case 2)
        if (
          cycleAdd === 0 &&
          (addrMode === ADDR_ABSX ||
            addrMode === ADDR_ABSY ||
            addrMode === ADDR_POSTIDXIND)
        ) {
          this.load(addr); // dummy read (indexed, no page crossing)
        }
        temp = this.load(addr);
        this.write(addr, temp); // dummy write (original value)
        add = this.F_CARRY << 7;
        this.F_CARRY = temp & 1;
        temp = (temp >> 1) + add;
        this.write(addr, temp);

        // Then add to the accumulator
        let rra_val = temp;
        temp = this.REG_ACC + rra_val + this.F_CARRY;

        if (
          ((this.REG_ACC ^ rra_val) & 0x80) === 0 &&
          ((this.REG_ACC ^ temp) & 0x80) !== 0
        ) {
          this.F_OVERFLOW = 1;
        } else {
          this.F_OVERFLOW = 0;
        }
        this.F_CARRY = temp > 255 ? 1 : 0;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_ZERO = temp & 0xff;
        this.REG_ACC = temp & 255;
        break;
      }
      case 66: {
        // *******
        // * SLO *
        // *******

        // Shift left then OR (unofficial, RMW pattern see ASL case 2)
        if (
          cycleAdd === 0 &&
          (addrMode === ADDR_ABSX ||
            addrMode === ADDR_ABSY ||
            addrMode === ADDR_POSTIDXIND)
        ) {
          this.load(addr); // dummy read (indexed, no page crossing)
        }
        temp = this.load(addr);
        this.write(addr, temp); // dummy write (original value)
        this.F_CARRY = (temp >> 7) & 1;
        temp = (temp << 1) & 255;
        this.write(addr, temp);

        // Then OR with the accumulator.
        this.REG_ACC = this.REG_ACC | temp;
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        break;
      }
      case 67: {
        // *******
        // * SRE *
        // *******

        // Shift right then XOR (unofficial, RMW pattern see ASL case 2)
        if (
          cycleAdd === 0 &&
          (addrMode === ADDR_ABSX ||
            addrMode === ADDR_ABSY ||
            addrMode === ADDR_POSTIDXIND)
        ) {
          this.load(addr); // dummy read (indexed, no page crossing)
        }
        temp = this.load(addr) & 0xff;
        this.write(addr, temp); // dummy write (original value)
        this.F_CARRY = temp & 1;
        temp >>= 1;
        this.write(addr, temp);

        // Then XOR with the accumulator.
        this.REG_ACC = this.REG_ACC ^ temp;
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_ZERO = this.REG_ACC;
        break;
      }
      case 68: {
        // *******
        // * SKB *
        // *******

        // Do nothing
        break;
      }
      case 69: {
        // *******
        // * IGN *
        // *******

        // Do nothing but load.
        // TODO: Properly implement the double-reads.
        this.load(addr);
        cycleCount += cycleAdd;
        break;
      }
      case 71: {
        // *******
        // * SHA * (AHX/AXA)
        // *******

        // Store A AND X AND (high byte of base address + 1).
        // On page crossing, the high byte of the effective address is
        // replaced with the stored value \u2014 a quirk of the 6502's internal
        // bus arbitration during indexed addressing.
        // See https://www.nesdev.org/wiki/Programming_with_unofficial_opcodes

        // Stores always perform the indexed dummy read, even without page
        // crossing. This is a real bus cycle needed for correct timing
        // (and DMA overlap detection).
        // See https://www.nesdev.org/wiki/CPU_addressing_modes
        if (cycleAdd === 0) {
          this.load(addr);
        }
        // When a DMC DMA fires during this instruction's read cycles, the
        // DMA hijacks the internal bus and the "& (H+1)" factor is dropped.
        // See _cyclesToNextDmcFetch() for the full explanation, and
        // AccuracyCoin.asm lines 4441-4460 for the test ROM's DMA sync.
        let dmaDuringInstr =
          this._dmcFetchCycles > 0 &&
          this._dmcFetchCycles <= this.instrBusCycles;
        let shaVal = dmaDuringInstr
          ? this.REG_ACC & this.REG_X
          : this.REG_ACC & this.REG_X & (((baseHigh + 1) & 0xff) | 0);
        if (cycleAdd === 1) {
          addr = (shaVal << 8) | (addr & 0xff);
        }
        this.write(addr, shaVal);
        break;
      }
      case 72: {
        // *******
        // * SHS * (TAS/XAS)
        // *******

        // Transfer A AND X to SP, then store SP AND (high byte + 1).
        // Same page-crossing address glitch as SHA.
        // See https://www.nesdev.org/wiki/Programming_with_unofficial_opcodes
        if (cycleAdd === 0) {
          this.load(addr); // forced dummy read (see case 71 comment)
        }
        let dmaDuringInstr2 =
          this._dmcFetchCycles > 0 &&
          this._dmcFetchCycles <= this.instrBusCycles;
        this.REG_SP = 0x0100 | (this.REG_ACC & this.REG_X);
        let shsVal = dmaDuringInstr2
          ? this.REG_SP & 0xff
          : this.REG_SP & 0xff & ((baseHigh + 1) & 0xff);
        if (cycleAdd === 1) {
          addr = (shsVal << 8) | (addr & 0xff);
        }
        this.write(addr, shsVal);
        break;
      }
      case 73: {
        // *******
        // * SHY * (SYA/SAY)
        // *******

        // Store Y AND (high byte of base address + 1).
        // Same page-crossing address glitch as SHA.
        // See https://www.nesdev.org/wiki/Programming_with_unofficial_opcodes
        if (cycleAdd === 0) {
          this.load(addr); // forced dummy read (see case 71 comment)
        }
        let dmaDuringInstr3 =
          this._dmcFetchCycles > 0 &&
          this._dmcFetchCycles <= this.instrBusCycles;
        let shyVal = dmaDuringInstr3
          ? this.REG_Y
          : this.REG_Y & ((baseHigh + 1) & 0xff);
        if (cycleAdd === 1) {
          addr = (shyVal << 8) | (addr & 0xff);
        }
        this.write(addr, shyVal);
        break;
      }
      case 74: {
        // *******
        // * SHX * (SXA/XAS)
        // *******

        // Store X AND (high byte of base address + 1).
        // Same page-crossing address glitch as SHA.
        // See https://www.nesdev.org/wiki/Programming_with_unofficial_opcodes
        if (cycleAdd === 0) {
          this.load(addr); // forced dummy read (see case 71 comment)
        }
        let dmaDuringInstr4 =
          this._dmcFetchCycles > 0 &&
          this._dmcFetchCycles <= this.instrBusCycles;
        let shxVal = dmaDuringInstr4
          ? this.REG_X
          : this.REG_X & ((baseHigh + 1) & 0xff);
        if (cycleAdd === 1) {
          addr = (shxVal << 8) | (addr & 0xff);
        }
        this.write(addr, shxVal);
        break;
      }
      case 75: {
        // *******
        // * LAE * (LAS/LAR)
        // *******

        // Load A, X, and SP with (memory AND SP).
        // See https://www.nesdev.org/wiki/Programming_with_unofficial_opcodes
        temp = this.load(addr) & (this.REG_SP & 0xff);
        this.REG_ACC = this.REG_X = this.F_ZERO = temp;
        this.REG_SP = 0x0100 | temp;
        this.F_SIGN = (temp >> 7) & 1;
        cycleCount += cycleAdd;
        break;
      }
      case 76: {
        // *******
        // * ANE * (XAA)
        // *******

        // A = (A | MAGIC) & X & Immediate. The "magic" constant varies between
        // CPU revisions ($00, $EE, $FF, etc). Using $FF \u2014 the most common value
        // and the only one that passes AccuracyCoin's magic-independent tests.
        // See https://www.nesdev.org/wiki/Programming_with_unofficial_opcodes
        this.REG_ACC = this.F_ZERO =
          (this.REG_ACC | 0xff) & this.REG_X & this.load(addr);
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        break;
      }
      case 77: {
        // *******
        // * LXA * (LAX immediate/ATX)
        // *******

        // A = (A | MAGIC) & Immediate, X = A. Same magic constant issue as ANE.
        // See https://www.nesdev.org/wiki/Programming_with_unofficial_opcodes
        this.REG_ACC =
          this.REG_X =
          this.F_ZERO =
            (this.REG_ACC | 0xff) & this.load(addr);
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        break;
      }

      default: {
        // *******
        // * ??? *
        // *******

        throw new Error(
          \`Game crashed, invalid opcode at address $\${opaddr.toString(16)}\`,
        );
      }
    } // end of switch

    // Step PPU for any internal cycles not covered by bus operations.
    // Some instructions (RTS, RTI, PLA, PLP, JMP indirect) have CPU-internal
    // cycles that don't perform bus reads/writes. Since the PPU is advanced
    // inline (in load/write/push/pull), these internal cycles need explicit
    // PPU stepping to maintain correct total dot count per instruction.
    if (this.instrBusCycles < cycleCount) {
      let missingDots = (cycleCount - this.instrBusCycles) * 3;
      // Update instrBusCycles BEFORE stepping the PPU so that if VBlank
      // fires during this step, nmiRaisedAtCycle correctly reflects the
      // bus cycle these dots belong to. Without this, the NMI delay
      // formula double-counts: (instrBusCycles - nmiRaisedAtCycle) * 3
      // would treat these dots as "future steps" while
      // nmiDotsRemainingInStep already counts remaining dots within them.
      this.instrBusCycles = cycleCount;
      this.nes.ppu.advanceDots(missingDots);
    }

    // NMI delay: when nmiRaised was set during this instruction (by inline
    // PPU stepping triggering VBlank or by a $2000 write enabling NMI),
    // determine 0-delay vs 1-delay based on remaining PPU dots.
    //
    // remainingDots counts PPU dots from the VBlank edge to the end of
    // the instruction. It has two components:
    // 1. Dots from subsequent bus cycles: (instrBusCycles - nmiRaisedAtCycle) * 3
    // 2. Sub-step dots: nmiDotsRemainingInStep (ppu.advanceDots() records
    //    dots - i, which includes the VBlank dot itself)
    //
    // >= 5 remaining dots means the edge propagates in time for the
    // penultimate-cycle poll \u2192 0-delay (nmiImmediate).
    // < 5 remaining dots means 1-delay: leave nmiRaised set, it gets
    // promoted to nmiPending at the start of the NEXT emulate() call.
    //
    // For $2000 writes that enable NMI during VBlank, nmiRaisedAtCycle
    // equals instrBusCycles (last cycle) and nmiDotsRemainingInStep = 0,
    // giving remainingDots = 0 \u2192 1-delay (correct: write always on last
    // bus cycle, NMI fires after next instruction).
    //
    // See https://www.nesdev.org/wiki/CPU_interrupts
    if (this.nmiRaised) {
      let remainingDots =
        (this.instrBusCycles - this.nmiRaisedAtCycle) * 3 +
        this.nmiDotsRemainingInStep;
      if (remainingDots >= 5) {
        // 0-delay: NMI fires before the next instruction.
        this.nmiImmediate = true;
        this.nmiRaised = false;
      }
      // else: 1-delay. nmiRaised stays set for promotion at start of
      // next emulate(), giving standard 1-instruction delay.
    }

    // Fire NMI after the instruction completes. nmiPending comes from
    // promotion of nmiRaised at the start of this emulate() call
    // (edge occurred during the PREVIOUS instruction, 1-delay).
    // See https://www.nesdev.org/wiki/CPU_interrupts
    if (this.nmiPending) {
      this.REG_PC_NEW = this.REG_PC;
      this.F_INTERRUPT_NEW = this.F_INTERRUPT;
      // Clear the B flag (bit 4) for hardware interrupts
      this.doNonMaskableInterrupt(this.getStatus() & 0xef);
      this.REG_PC = this.REG_PC_NEW;
      this.F_INTERRUPT = this.F_INTERRUPT_NEW;
      this.F_BRK = this.F_BRK_NEW;
      this.nmiPending = false;
      interruptCycles = 7;
    }

    this._cpuCycleBase += cycleCount + interruptCycles;
    return cycleCount + interruptCycles;
  }

  // Reads from cartridge ROM, applying any active Game Genie patches.
  // Used for opcode fetches, operand reads, indirect jumps, and interrupt
  // vectors \u2014 all places where Game Genie can intercept ROM reads.
  //
  // This method is swapped at runtime via _updateCartridgeLoader() to avoid
  // checking Game Genie state on every ROM read. When no patches are active,
  // it points to _loadFromCartridgePlain (zero overhead). When patches are
  // active, it points to _loadFromCartridgeWithGameGenie.
  loadFromCartridge(addr) {
    return this.nes.mmap.load(addr);
  }

  _loadFromCartridgePlain(addr) {
    return this.nes.mmap.load(addr);
  }

  _loadFromCartridgeWithGameGenie(addr) {
    let value = this.nes.mmap.load(addr);
    return this.nes.gameGenie.applyCodes(addr, value);
  }

  // Swap loadFromCartridge to the appropriate implementation based on
  // whether Game Genie patches are active. Called by GameGenie when
  // patches or enabled state change.
  _updateCartridgeLoader() {
    if (this.nes.gameGenie.enabled && this.nes.gameGenie.patches.length > 0) {
      this.loadFromCartridge = this._loadFromCartridgeWithGameGenie;
    } else {
      // Delete instance property to fall back to the prototype method,
      // which is the plain loader. This keeps the hidden class stable
      // for V8 optimization.
      delete this.loadFromCartridge;
    }
  }

  // Each load() call represents one CPU bus read cycle. After the read,
  // advances the PPU by 3 dots to keep it in sync. APU is clocked in bulk
  // by the frame loop after each instruction.
  //
  // All reads (including PPU registers) use step-after: read first, then
  // advance. This matches the old _ppuCatchUp() behavior where the PPU
  // was advanced by instrBusCycles * 3 dots (completed cycles only, NOT
  // including the current one) before the read. Since prior bus ops have
  // already stepped the PPU, the read sees the same PPU state.
  load(addr) {
    if (addr < 0x2000) {
      // RAM (zero page, stack, general): most common path
      this.dataBus = this.mem[addr & 0x7ff];
      this.instrBusCycles++;
      this.nes.ppu.advanceDots(3);
    } else if (addr >= 0x4000) {
      // Cartridge ROM/RAM, APU, expansion ($4000+)
      if (addr === 0x4015) {
        // APU catch-up: advance frame counter before $4015 read so it sees
        // up-to-date length counter status and IRQ flags.
        this.nes.papu.advanceFrameCounter(
          this.instrBusCycles - this.apuCatchupCycles,
        );
        this.apuCatchupCycles = this.instrBusCycles;
        // $4015 reads are internal to the 2A03 \u2014 the APU status value does
        // not drive the external data bus. Return the status directly without
        // updating dataBus, so open bus reads after $4015 still see the
        // previous bus value. See https://www.nesdev.org/wiki/Open_bus_behavior
        let apuStatus = this.loadFromCartridge(addr);
        this.instrBusCycles++;
        this.nes.ppu.advanceDots(3);
        return apuStatus;
      }
      this.dataBus = this.loadFromCartridge(addr);
      this.instrBusCycles++;
      this.nes.ppu.advanceDots(3);
    } else {
      // PPU registers ($2000-$3FFF): increment bus cycle counter first
      // (for correct nmiRaisedAtCycle tracking), then read, then step PPU.
      // The read sees PPU state after all prior bus cycles' dots have been
      // stepped (but NOT the current cycle's dots), matching the old
      // _ppuCatchUp() behavior.
      this.instrBusCycles++;
      this.dataBus = this.loadFromCartridge(addr);
      this.nes.ppu.advanceDots(3);
    }
    return this.dataBus;
  }

  // Fast load for addresses guaranteed to be outside the PPU register range
  // ($2000-$3FFF) and APU status register ($4015). Still updates dataBus
  // (open bus behavior) and advances PPU/APU inline.
  //
  // Safe for:
  //   - Zero-page reads ($00-$FF): always internal RAM
  //   - Program-space operand reads (opaddr+2/+3): always PRG ROM ($8000+)
  //
  // NOT safe for arbitrary effective addresses that could be PPU/APU I/O.
  loadDirect(addr) {
    if (addr < 0x2000) {
      this.dataBus = this.mem[addr & 0x7ff];
    } else {
      this.dataBus = this.loadFromCartridge(addr);
    }
    this.instrBusCycles++;
    this.nes.ppu.advanceDots(3);
    return this.dataBus;
  }

  // Reads a 16-bit value as two separate bus operations with PPU/APU
  // stepping between them, matching the real 6502's two-cycle read.
  load16bit(addr) {
    let lo;
    if (addr < 0x1fff) {
      this.dataBus = this.mem[addr & 0x7ff];
      lo = this.dataBus;
      this.instrBusCycles++;
      this.nes.ppu.advanceDots(3);
      this.dataBus = this.mem[(addr + 1) & 0x7ff];
      this.instrBusCycles++;
      this.nes.ppu.advanceDots(3);
      return lo | (this.dataBus << 8);
    } else {
      this.dataBus = this.loadFromCartridge(addr);
      lo = this.dataBus;
      this.instrBusCycles++;
      this.nes.ppu.advanceDots(3);
      this.dataBus = this.loadFromCartridge(addr + 1);
      this.instrBusCycles++;
      this.nes.ppu.advanceDots(3);
      return lo | (this.dataBus << 8);
    }
  }

  // Each write() call represents one CPU bus write cycle. Write first,
  // then advance PPU by 3 dots. For PPU register writes ($2000-$3FFF),
  // the write takes effect with PPU state from prior cycles' dots (not
  // including current cycle), matching the old _ppuCatchUp() behavior.
  write(addr, val) {
    if (addr >= 0x2000 && addr < 0x4000) {
      // PPU register write: increment bus cycle counter first (so
      // nmiRaisedAtCycle is correct if _updateNmiOutput fires during
      // the write), then write, then step PPU. The write sees PPU state
      // from prior cycles' dots, matching the old _ppuCatchUp() behavior.
      this.instrBusCycles++;
      this.dataBus = val;
      this.nes.mmap.write(addr, val);
      this.nes.ppu.advanceDots(3);
    } else {
      this.dataBus = val;
      if (addr < 0x2000) {
        this.mem[addr & 0x7ff] = val;
      } else {
        this.nes.mmap.write(addr, val);
      }
      this.instrBusCycles++;
      this.nes.ppu.advanceDots(3);
    }
  }

  requestIrq(type) {
    if (this.irqRequested) {
      if (type === this.IRQ_NORMAL) {
        return;
      }
      // console.log("too fast irqs. type="+type);
    }
    this.irqRequested = true;
    this.irqType = type;
  }

  push(value) {
    this.dataBus = value;
    // Stack is always $0100-$01FF (internal RAM), so write directly to mem[]
    // instead of going through the mapper.
    this.mem[this.REG_SP | 0x100] = value;
    this.REG_SP--;
    this.REG_SP = this.REG_SP & 0xff;
    this.instrBusCycles++;
    this.nes.ppu.advanceDots(3);
  }

  pull() {
    this.REG_SP++;
    this.REG_SP = this.REG_SP & 0xff;
    // Stack is always $0100-$01FF (internal RAM), so read directly from mem[].
    this.dataBus = this.mem[0x100 | this.REG_SP];
    this.instrBusCycles++;
    this.nes.ppu.advanceDots(3);
    return this.dataBus;
  }

  // --- DMC DMA bus hijacking ---
  //
  // On real hardware, DMC DMA reads happen mid-instruction: the DMA unit
  // steals a bus cycle to fetch the next sample byte. Normally this is
  // invisible to the CPU, but SHx instructions (SHA/SHX/SHY/SHS) compute
  // their stored value partly from the address bus during an earlier cycle.
  // When a DMA read hijacks the bus between the address setup and the
  // store, the "& (H+1)" factor (derived from the high byte of the base
  // address) is lost. For example, SHY normally stores Y & (H+1), but
  // with a DMA it stores just Y.
  //
  // This emulator can't truly interleave DMA reads with instruction
  // execution (audio is clocked after each instruction in nes.js), so
  // instead we approximate it:
  //
  // 1. At the start of emulate(), snapshot _dmcFetchCycles = how many CPU
  //    cycles until the next DMC DMA fetch (computed by this method).
  //
  // 2. Each SHx instruction case checks whether the DMA would fire during
  //    its bus cycles: _dmcFetchCycles <= instrBusCycles. If so, the
  //    "& (H+1)" factor is dropped from the stored value.
  //
  // 3. Store instructions always perform the indexed dummy read even
  //    without page crossing (unlike loads which skip it), so
  //    instrBusCycles is correct for timing the overlap.
  //
  // 4. The DMC initial load (papu.js ChannelDM.writeReg $4015) triggers
  //    nextSample() immediately when the buffer is empty, matching the
  //    real hardware timing that test ROMs depend on to synchronize their
  //    DMA timing loops (DMASync in AccuracyCoin.asm).
  //
  // Returns a large number (0x7FFFFFFF) if no DMA fetch is pending.
  // See https://www.nesdev.org/wiki/APU_DMC
  _cyclesToNextDmcFetch() {
    if (!this.nes.papu) {
      return 0x7fffffff;
    }
    let dmc = this.nes.papu.dmc;
    if (!dmc || !dmc.isEnabled || dmc.dmaFrequency <= 0) {
      return 0x7fffffff;
    }
    if (!dmc.hasSample) {
      return 0x7fffffff;
    }
    // shiftCounter counts down in units of (nCycles << 3); each tick of
    // clockDmc consumes dmaFrequency units. When dmaCounter reaches 0,
    // endOfSample fires and may call nextSample (the actual DMA fetch).
    // The next DMA fetch occurs when all remaining dmaCounter ticks of
    // the shift register have elapsed, which is:
    //   (remaining shift ticks) / 8 CPU cycles per tick
    // But the first tick fires when shiftCounter reaches 0, so the
    // remaining CPU cycles to the next clockDmc call is ceil(shiftCounter/8).
    // After that, (dmaCounter - 1) more clockDmc calls must fire, each
    // taking dmaFrequency/8 CPU cycles.
    let cyclesPerClock = dmc.dmaFrequency >> 3;
    let cyclesToFirstClock = (dmc.shiftCounter + 7) >> 3;
    if (cyclesToFirstClock <= 0) cyclesToFirstClock = cyclesPerClock;
    return cyclesToFirstClock + (dmc.dmaCounter - 1) * cyclesPerClock;
  }

  // Branch dummy reads: when a branch is taken, the 6502 performs a dummy
  // read from the next sequential instruction address (cycle 3). On a page
  // crossing, it performs an additional dummy read from the "wrong" address
  // where PCH hasn't been fixed yet (cycle 4). These are real bus operations
  // that update the data bus and can trigger I/O side effects.
  // See https://www.nesdev.org/6502_cpu.txt (Relative addressing section)
  _takeBranch(opaddr, addr) {
    // Real addresses (jsnes REG_PC is offset by -1 from real PC)
    let nextPC = (opaddr + 3) & 0xffff; // address of next instruction
    let target = (addr + 1) & 0xffff; // actual branch target

    // Cycle 3: dummy read from next instruction address
    this.load(nextPC);

    if ((nextPC & 0xff00) !== (target & 0xff00)) {
      // Page crossing: cycle 4 dummy read from wrong address (unfixed PCH)
      let wrongAddr = (nextPC & 0xff00) | (target & 0x00ff);
      this.load(wrongAddr);
      this.REG_PC = addr;
      return 2;
    }
    this.REG_PC = addr;
    return 1;
  }

  pageCrossed(addr1, addr2) {
    return (addr1 & 0xff00) !== (addr2 & 0xff00);
  }

  haltCycles(cycles) {
    this.cyclesToHalt += cycles;
  }

  // Interrupt vector fetches update the data bus, just like normal reads.
  // The 3 pushes go through push() which already steps the PPU.
  // The 2 vector reads use loadFromCartridge() directly and need explicit
  // PPU steps. APU is clocked in the frame loop with the returned cycle count.
  doNonMaskableInterrupt(status) {
    if (this.nes.mmap === null) return;

    // Cycles 1-2: internal operations (dummy reads of PC on real hardware).
    // These are real bus cycles that advance the PPU but the read values
    // are discarded. We step the PPU without reading memory to avoid
    // side effects on the data bus.
    // See https://www.nesdev.org/wiki/CPU_interrupts
    this.instrBusCycles++;
    this.nes.ppu.advanceDots(3);
    this.instrBusCycles++;
    this.nes.ppu.advanceDots(3);

    this.REG_PC_NEW++;
    this.push((this.REG_PC_NEW >> 8) & 0xff);
    this.push(this.REG_PC_NEW & 0xff);
    this.F_INTERRUPT_NEW = 1;
    this.push(status);

    this.dataBus = this.loadFromCartridge(0xfffa);
    this.instrBusCycles++;
    this.nes.ppu.advanceDots(3);
    let lo = this.dataBus;
    this.dataBus = this.loadFromCartridge(0xfffb);
    this.instrBusCycles++;
    this.nes.ppu.advanceDots(3);
    this.REG_PC_NEW = lo | (this.dataBus << 8);
    this.REG_PC_NEW--;
  }

  doResetInterrupt() {
    this.dataBus = this.loadFromCartridge(0xfffc);
    this.instrBusCycles++;
    this.nes.ppu.advanceDots(3);
    let lo = this.dataBus;
    this.dataBus = this.loadFromCartridge(0xfffd);
    this.instrBusCycles++;
    this.nes.ppu.advanceDots(3);
    this.REG_PC_NEW = lo | (this.dataBus << 8);
    this.REG_PC_NEW--;
  }

  doIrq(status) {
    this.REG_PC_NEW++;
    this.push((this.REG_PC_NEW >> 8) & 0xff);
    this.push(this.REG_PC_NEW & 0xff);
    this.push(status);
    this.F_INTERRUPT_NEW = 1;
    this.F_BRK_NEW = 0;

    this.dataBus = this.loadFromCartridge(0xfffe);
    this.instrBusCycles++;
    this.nes.ppu.advanceDots(3);
    let lo = this.dataBus;
    this.dataBus = this.loadFromCartridge(0xffff);
    this.instrBusCycles++;
    this.nes.ppu.advanceDots(3);
    this.REG_PC_NEW = lo | (this.dataBus << 8);
    this.REG_PC_NEW--;
  }

  getStatus() {
    // F_ZERO is 0 when the Z flag is set, non-zero when clear (see reset())
    return (
      this.F_CARRY |
      ((this.F_ZERO === 0 ? 1 : 0) << 1) |
      (this.F_INTERRUPT << 2) |
      (this.F_DECIMAL << 3) |
      (this.F_BRK << 4) |
      (this.F_NOTUSED << 5) |
      (this.F_OVERFLOW << 6) |
      (this.F_SIGN << 7)
    );
  }

  setStatus(st) {
    this.F_CARRY = st & 1;
    // F_ZERO uses inverted encoding: 0 means Z is set (see reset())
    this.F_ZERO = ((st >> 1) & 1) === 1 ? 0 : 1;
    this.F_INTERRUPT = (st >> 2) & 1;
    this.F_DECIMAL = (st >> 3) & 1;
    this.F_BRK = (st >> 4) & 1;
    this.F_NOTUSED = (st >> 5) & 1;
    this.F_OVERFLOW = (st >> 6) & 1;
    this.F_SIGN = (st >> 7) & 1;
  }

  // Set status flags from a value pulled off the stack (PLP, RTI).
  // Bits 4 (B) and 5 (unused) don't exist as physical flags in the
  // 6502 and are ignored when pulling status from the stack.
  // See https://www.nesdev.org/wiki/Status_flags#The_B_flag
  setStatusFromStack(st) {
    this.F_CARRY = st & 1;
    this.F_ZERO = ((st >> 1) & 1) === 1 ? 0 : 1;
    this.F_INTERRUPT = (st >> 2) & 1;
    this.F_DECIMAL = (st >> 3) & 1;
    this.F_OVERFLOW = (st >> 6) & 1;
    this.F_SIGN = (st >> 7) & 1;
  }

  static JSON_PROPERTIES = [
    "mem",
    "cyclesToHalt",
    "dataBus",
    "irqRequested",
    "irqType",
    "nmiRaised",
    "nmiPending",
    "nmiImmediate",
    // Registers
    "REG_ACC",
    "REG_X",
    "REG_Y",
    "REG_SP",
    "REG_PC",
    "REG_PC_NEW",
    "REG_STATUS",
    // Status
    "F_CARRY",
    "F_DECIMAL",
    "F_INTERRUPT",
    "F_INTERRUPT_NEW",
    "F_OVERFLOW",
    "F_SIGN",
    "F_ZERO",
    "F_NOTUSED",
    "F_NOTUSED_NEW",
    "F_BRK",
    "F_BRK_NEW",
    "_cpuCycleBase",
  ];

  toJSON() {
    return toJSON(this);
  }

  fromJSON(s) {
    fromJSON(this, s);
  }
}

export default CPU;
`, type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/gamegenie.js": { text: 'const LETTER_VALUES = "APZLGITYEOXUKSVN";\n\nfunction toDigit(letter) {\n  return LETTER_VALUES.indexOf(letter);\n}\n\nfunction toLetter(digit) {\n  return LETTER_VALUES[digit];\n}\n\nfunction toHex(n, width) {\n  const s = n.toString(16);\n  return "0000".substring(0, width - s.length) + s;\n}\n\nclass GameGenie {\n  constructor() {\n    this.patches = [];\n    this.enabled = true;\n    // Callback invoked when patches or enabled state change, so the CPU\n    // can swap its loadFromCartridge function pointer. Set by NES after\n    // construction.\n    this.onChange = null;\n  }\n\n  setEnabled(enabled) {\n    this.enabled = enabled;\n    if (this.onChange) this.onChange();\n  }\n\n  addCode(code) {\n    const patch = this.decode(code);\n    if (!patch) {\n      throw new Error(`Invalid Game Genie code: ${code}`);\n    }\n    this.patches.push(patch);\n    if (this.onChange) this.onChange();\n  }\n\n  addPatch(addr, value, key) {\n    this.patches.push({ addr, value, key });\n    if (this.onChange) this.onChange();\n  }\n\n  removeAllCodes() {\n    this.patches = [];\n    if (this.onChange) this.onChange();\n  }\n\n  // Apply Game Genie patches to a value being read from the given address.\n  // Game Genie works by intercepting ROM reads and substituting values.\n  // The address is masked to 15 bits because Game Genie ignores the\n  // highest bit (ROM is mirrored in $8000-$FFFF).\n  applyCodes(addr, value) {\n    if (!this.enabled) return value;\n\n    for (let i = 0; i < this.patches.length; ++i) {\n      if (this.patches[i].addr === (addr & 0x7fff)) {\n        if (\n          this.patches[i].key === undefined ||\n          this.patches[i].key === value\n        ) {\n          return this.patches[i].value;\n        }\n      }\n    }\n    return value;\n  }\n\n  decode(code) {\n    if (code.includes(":")) return this.decodeHex(code);\n\n    const digits = code.toUpperCase().split("").map(toDigit);\n\n    let value =\n      ((digits[0] & 8) << 4) + ((digits[1] & 7) << 4) + (digits[0] & 7);\n    const addr =\n      ((digits[3] & 7) << 12) +\n      ((digits[4] & 8) << 8) +\n      ((digits[5] & 7) << 8) +\n      ((digits[1] & 8) << 4) +\n      ((digits[2] & 7) << 4) +\n      (digits[3] & 8) +\n      (digits[4] & 7);\n    let key;\n\n    if (digits.length === 8) {\n      value += digits[7] & 8;\n      key =\n        ((digits[6] & 8) << 4) +\n        ((digits[7] & 7) << 4) +\n        (digits[5] & 8) +\n        (digits[6] & 7);\n    } else {\n      value += digits[5] & 8;\n    }\n\n    const wantskey = !!(digits[2] >> 3);\n\n    return { value, addr, wantskey, key };\n  }\n\n  encodeHex(addr, value, key, wantskey) {\n    let s = toHex(addr, 4) + ":" + toHex(value, 2);\n\n    if (key !== undefined || wantskey) {\n      s += "?";\n    }\n\n    if (key !== undefined) {\n      s += toHex(key, 2);\n    }\n\n    return s;\n  }\n\n  decodeHex(s) {\n    const match = s.match(/([0-9a-fA-F]+):([0-9a-fA-F]+)(\\?[0-9a-fA-F]*)?/);\n    if (!match) return null;\n\n    const addr = parseInt(match[1], 16);\n    const value = parseInt(match[2], 16);\n    const wantskey = match[3] !== undefined;\n    const key =\n      match[3] !== undefined && match[3].length > 1\n        ? parseInt(match[3].substring(1), 16)\n        : undefined;\n\n    return { value, addr, wantskey, key };\n  }\n\n  encode(addr, value, key, wantskey) {\n    const digits = Array(6);\n\n    digits[0] = (value & 7) + ((value >> 4) & 8);\n    digits[1] = ((value >> 4) & 7) + ((addr >> 4) & 8);\n    digits[2] = (addr >> 4) & 7;\n    digits[3] = (addr >> 12) + (addr & 8);\n    digits[4] = (addr & 7) + ((addr >> 8) & 8);\n    digits[5] = (addr >> 8) & 7;\n\n    if (key === undefined) {\n      digits[5] += value & 8;\n      if (wantskey) digits[2] += 8;\n    } else {\n      digits[2] += 8;\n      digits[5] += key & 8;\n      digits[6] = (key & 7) + ((key >> 4) & 8);\n      digits[7] = ((key >> 4) & 7) + (value & 8);\n    }\n\n    const code = digits.map(toLetter).join("");\n\n    return code;\n  }\n}\n\nexport default GameGenie;\n', type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/index.js": { text: 'import Browser from "./browser/index.js";\nimport Controller from "./controller.js";\nimport GameGenie from "./gamegenie.js";\nimport NES from "./nes.js";\n\nexport { Browser, Controller, GameGenie, NES };\n', type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/mappers/index.js": { text: 'import Mapper0 from "./mapper0.js";\nimport Mapper1 from "./mapper1.js";\nimport Mapper2 from "./mapper2.js";\nimport Mapper3 from "./mapper3.js";\nimport Mapper4 from "./mapper4.js";\nimport Mapper5 from "./mapper5.js";\nimport Mapper7 from "./mapper7.js";\nimport Mapper9 from "./mapper9.js";\nimport Mapper11 from "./mapper11.js";\nimport Mapper34 from "./mapper34.js";\nimport Mapper38 from "./mapper38.js";\nimport Mapper66 from "./mapper66.js";\nimport Mapper71 from "./mapper71.js";\nimport Mapper79 from "./mapper79.js";\nimport Mapper94 from "./mapper94.js";\nimport Mapper118 from "./mapper118.js";\nimport Mapper119 from "./mapper119.js";\nimport Mapper140 from "./mapper140.js";\nimport Mapper180 from "./mapper180.js";\nimport Mapper240 from "./mapper240.js";\nimport Mapper241 from "./mapper241.js";\n\nexport default {\n  0: Mapper0,\n  1: Mapper1,\n  2: Mapper2,\n  3: Mapper3,\n  4: Mapper4,\n  5: Mapper5,\n  7: Mapper7,\n  9: Mapper9,\n  11: Mapper11,\n  34: Mapper34,\n  38: Mapper38,\n  66: Mapper66,\n  71: Mapper71,\n  79: Mapper79,\n  94: Mapper94,\n  118: Mapper118,\n  119: Mapper119,\n  140: Mapper140,\n  180: Mapper180,\n  240: Mapper240,\n  241: Mapper241,\n};\n', type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/mappers/mapper0.js": { text: `import { copyArrayElements } from "../utils.js";

// NROM - the simplest NES cartridge board (NES-NROM-128/NROM-256)
// Used by games like Super Mario Bros., Donkey Kong, Excitebike.
// No bank switching at all: 16 or 32 KB PRG-ROM, 8 KB CHR-ROM, fixed mirroring.
// See https://www.nesdev.org/wiki/NROM
class Mapper0 {
  static mapperName = "NROM";

  constructor(nes) {
    this.nes = nes;

    this.joy1StrobeState = 0;
    this.joy2StrobeState = 0;
    this.joypadLastWrite = 0;
    // The effective OUT0 value visible to the controller shift register.
    // On the 2A03, OUT0-OUT2 are output latches that only update on APU
    // clock edges (every 2 CPU cycles). Writes to $4016 on "get" cycles
    // (odd CPU cycle count) update the internal register but NOT the output
    // latch until the next APU clock. This distinction matters for RMW
    // instructions like DEC $4016 that produce a 1-cycle strobe pulse:
    // the dummy write and final write land on consecutive CPU cycles, and
    // whether the pulse is visible depends on APU clock alignment.
    // See https://www.nesdev.org/wiki/CPU_pin_out_and_signal_timing
    this.joypadOutputBit0 = 0;
    // CPU cycle at which the last $4016 write occurred (-2 = never)
    this.joypadLastWriteCycle = -2;

    this.zapperFired = false;
    this.zapperX = null;
    this.zapperY = null;

    // Set to true by mappers that need per-tile BG override (e.g. MMC5
    // ExRAM mode 1). When true, the PPU calls getBgTileData() for each
    // background tile during rendering.
    this.bgTileOverride = false;
  }

  write(address, value) {
    if (address < 0x2000) {
      // Mirroring of RAM:
      this.nes.cpu.mem[address & 0x7ff] = value;
    } else if (address >= 0x8000) {
      // ROM is not writable. Mappers may override this to handle bank switching.
    } else if (address >= 0x6000) {
      // Cartridge SRAM (0x6000-0x7FFF)
      this.nes.cpu.mem[address] = value;
      this.nes.opts.onBatteryRamWrite(address, value);
    } else if (address > 0x4017) {
      // Cartridge expansion area (0x4018-0x5FFF)
      this.nes.cpu.mem[address] = value;
    } else if (address > 0x2007 && address < 0x4000) {
      this.regWrite(0x2000 + (address & 0x7), value);
    } else {
      this.regWrite(address, value);
    }
  }

  writelow(address, value) {
    if (address < 0x2000) {
      // Mirroring of RAM:
      this.nes.cpu.mem[address & 0x7ff] = value;
    } else if (address >= 0x8000) {
      // ROM is not writable
    } else if (address > 0x4017) {
      // Cartridge RAM/expansion area (0x4018-0x7FFF)
      this.nes.cpu.mem[address] = value;
    } else if (address > 0x2007 && address < 0x4000) {
      this.regWrite(0x2000 + (address & 0x7), value);
    } else {
      this.regWrite(address, value);
    }
  }

  load(address) {
    // Wrap around:
    address &= 0xffff;

    // Check address range:
    if (address > 0x4017) {
      if (address < 0x6000) {
        // Open bus: $4018-$5FFF (unmapped expansion area)
        return this.nes.cpu.dataBus;
      }
      // Cartridge RAM ($6000-$7FFF) and ROM ($8000-$FFFF):
      return this.nes.cpu.mem[address];
    } else if (address >= 0x2000) {
      // I/O Ports.
      return this.regLoad(address);
    } else {
      // RAM (mirrored)
      return this.nes.cpu.mem[address & 0x7ff];
    }
  }

  regLoad(address) {
    switch (
      address >> 12 // use fourth nibble (0xF000)
    ) {
      case 0:
        break;

      case 1:
        break;

      case 2:
      // Fall through to case 3
      case 3:
        // PPU Registers
        switch (address & 0x7) {
          case 0x0:
            // 0x2000: PPU Control Register 1 (write-only, returns open bus)
            return this.nes.ppu.openBusLatch;

          case 0x1:
            // 0x2001: PPU Control Register 2 (write-only, returns open bus)
            return this.nes.ppu.openBusLatch;

          case 0x2:
            // 0x2002: PPU Status Register (bits 7-5 from status, 4-0 from open bus)
            return this.nes.ppu.readStatusRegister();

          case 0x3:
            // 0x2003: OAM Address (write-only, returns open bus)
            return this.nes.ppu.openBusLatch;

          case 0x4:
            // 0x2004: Sprite Memory read
            return this.nes.ppu.sramLoad();

          case 0x5:
            // 0x2005: Scroll (write-only, returns open bus)
            return this.nes.ppu.openBusLatch;

          case 0x6:
            // 0x2006: VRAM Address (write-only, returns open bus)
            return this.nes.ppu.openBusLatch;

          case 0x7:
            // 0x2007: VRAM read
            return this.nes.ppu.vramLoad();
        }
        break;
      case 4:
        // Sound+Joypad registers
        switch (address - 0x4015) {
          case 0:
            // 0x4015:
            // Sound channel enable, DMC Status
            return this.nes.papu.readReg(address);

          case 1:
            // 0x4016:
            // Joystick 1 + Strobe
            // Bits 0-4 from controller, bits 5-7 are open bus (data bus)
            // See https://www.nesdev.org/wiki/Open_bus_behavior
            return (this.joy1Read() & 0x1f) | (this.nes.cpu.dataBus & 0xe0);

          case 2: {
            // 0x4017:
            // Joystick 2 + Strobe
            // https://wiki.nesdev.com/w/index.php/Zapper
            // Bits 0-4 from controller/zapper, bits 5-7 are open bus (data bus)
            // Zapper bits (3=light sensor, 4=trigger) are only driven when the
            // zapper is connected (zapperX/Y non-null). With no zapper, these
            // bits are 0 (standard controller doesn't drive them).
            let w = 0;

            if (this.zapperX !== null && this.zapperY !== null) {
              // Zapper connected: bit 3 = light not detected
              if (!this.nes.ppu.isPixelWhite(this.zapperX, this.zapperY)) {
                w = 0x1 << 3;
              }
            }

            if (this.zapperFired) {
              w |= 0x1 << 4;
            }
            return (
              ((this.joy2Read() | w) & 0x1f) | (this.nes.cpu.dataBus & 0xe0)
            );
          }
        }
        break;
    }
    // Write-only registers (APU $4000-$4014, etc.) are open bus.
    // On real hardware, if a DMC DMA fetch coincides with this read cycle,
    // the DMA steals the CPU bus cycle and the fetched sample byte appears
    // on the data bus instead of the open bus value. This is how the ROM's
    // DMA sync loops (LDA $4000; BNE) detect DMC activity.
    // See https://www.nesdev.org/wiki/APU_DMC#Memory_reader
    let cpu = this.nes.cpu;
    if (
      cpu._dmcFetchCycles > 0 &&
      cpu._dmcFetchCycles === cpu.instrBusCycles + 1
    ) {
      let dmc = this.nes.papu.dmc;
      if (dmc && dmc.isEnabled) {
        return dmc.lastFetchedByte;
      }
    }
    return cpu.dataBus;
  }

  regWrite(address, value) {
    // All PPU register writes update the open bus latch
    if (address >= 0x2000 && address <= 0x3fff) {
      this.nes.ppu.openBusLatch = value;
      this.nes.ppu.openBusDecayFrames = 36; // ~600ms at 60fps
    }

    switch (address) {
      case 0x2000:
        // PPU Control register 1
        this.nes.cpu.mem[address] = value;
        this.nes.ppu.updateControlReg1(value);
        break;

      case 0x2001:
        // PPU Control register 2
        this.nes.cpu.mem[address] = value;
        this.nes.ppu.updateControlReg2(value);
        break;

      case 0x2003:
        // Set Sprite RAM address:
        this.nes.ppu.writeSRAMAddress(value);
        break;

      case 0x2004:
        // Write to Sprite RAM:
        this.nes.ppu.sramWrite(value);
        break;

      case 0x2005:
        // Screen Scroll offsets:
        this.nes.ppu.scrollWrite(value);
        break;

      case 0x2006:
        // Set VRAM address:
        this.nes.ppu.writeVRAMAddress(value);
        break;

      case 0x2007:
        // Write to VRAM:
        this.nes.ppu.vramWrite(value);
        break;

      case 0x4014:
        // Sprite Memory DMA Access
        this.nes.ppu.sramDMA(value);
        break;

      case 0x4015:
        // Sound Channel Switch, DMC Status
        this.nes.papu.writeReg(address, value);
        break;

      case 0x4016: {
        // Joystick 1 + Strobe
        // The 2A03 output ports (OUT0-OUT2) only update on APU clock edges,
        // which happen every 2 CPU cycles. A write to $4016 always updates
        // the internal register immediately, but the effective output
        // (joypadOutputBit0) only changes on odd-parity CPU cycles.
        // This matters for RMW instructions like DEC $4016: the dummy
        // write (original value) and real write (modified value) happen on
        // consecutive cycles. If the dummy write lands on an APU tick
        // (even) but the real write lands on a non-tick (odd), only the
        // dummy write's value reaches OUT0. The AccuracyCoin controller
        // strobe test verifies this behavior.
        let cpu = this.nes.cpu;
        let currentCycle = cpu._cpuCycleBase + cpu.instrBusCycles;

        // If previous write(s) haven't been applied to the output yet
        // (because they landed on odd cycles), sync them now if at least
        // one APU tick has passed since then.
        if (currentCycle - this.joypadLastWriteCycle > 1) {
          let prevBit = this.joypadLastWrite & 1;
          if (prevBit !== this.joypadOutputBit0) {
            if (this.joypadOutputBit0 === 1 && prevBit === 0) {
              this.joy1StrobeState = 0;
              this.joy2StrobeState = 0;
            }
            this.joypadOutputBit0 = prevBit;
          }
        }

        this.joypadLastWrite = value;
        this.joypadLastWriteCycle = currentCycle;

        // Apply to effective output only on APU tick ("put") cycles.
        // After OAM DMA sync, _cpuCycleBase is always odd, so the first
        // instruction cycle (_cpuCycleBase + 1) is even = "get". The 5th
        // cycle of a 6-cycle RMW (dummy write) is _cpuCycleBase + 4 = odd
        // = "put" = APU tick. This matches real hardware where OUT0 updates
        // on "put" cycles.
        if (currentCycle % 2 === 1) {
          let newBit = value & 1;
          if (this.joypadOutputBit0 === 1 && newBit === 0) {
            this.joy1StrobeState = 0;
            this.joy2StrobeState = 0;
          }
          this.joypadOutputBit0 = newBit;
        }
        break;
      }

      case 0x4017:
        // Sound channel frame sequencer:
        this.nes.papu.writeReg(address, value);
        break;

      default:
        // Sound registers
        // console.log("write to sound reg");
        if (address >= 0x4000 && address <= 0x4017) {
          this.nes.papu.writeReg(address, value);
        }
    }
  }

  // Sync any pending $4016 output that was deferred from odd-cycle writes.
  // Called before reads from $4016/$4017, since reads happen on a later
  // cycle and the APU clock will have ticked by then.
  _syncJoypadOutput() {
    let newBit = this.joypadLastWrite & 1;
    if (newBit !== this.joypadOutputBit0) {
      if (this.joypadOutputBit0 === 1 && newBit === 0) {
        this.joy1StrobeState = 0;
        this.joy2StrobeState = 0;
      }
      this.joypadOutputBit0 = newBit;
    }
  }

  joy1Read() {
    // Sync deferred output before checking strobe state
    this._syncJoypadOutput();

    // While strobe is active ($4016 bit 0 = 1), the shift register is
    // continuously reloaded, so reads always return button A's state.
    // See https://www.nesdev.org/wiki/Standard_controller
    if (this.joypadOutputBit0) {
      return this.nes.controllers[1].state[0];
    }

    let ret;
    if (this.joy1StrobeState < 8) {
      ret = this.nes.controllers[1].state[this.joy1StrobeState];
    } else {
      // After 8 reads, the shift register is empty and the serial data
      // line floats high, returning 1 on a standard NES controller.
      ret = 1;
    }

    this.joy1StrobeState++;
    if (this.joy1StrobeState === 24) {
      this.joy1StrobeState = 0;
    }

    return ret;
  }

  joy2Read() {
    // Sync deferred output before checking strobe state
    this._syncJoypadOutput();

    // While strobe is active, always return button A's state.
    if (this.joypadOutputBit0) {
      return this.nes.controllers[2].state[0];
    }

    let ret;
    if (this.joy2StrobeState < 8) {
      ret = this.nes.controllers[2].state[this.joy2StrobeState];
    } else {
      // After 8 reads, the shift register is empty \u2192 returns 1.
      ret = 1;
    }

    this.joy2StrobeState++;
    if (this.joy2StrobeState === 24) {
      this.joy2StrobeState = 0;
    }

    return ret;
  }

  loadROM() {
    if (!this.nes.rom.valid || this.nes.rom.romCount < 1) {
      throw new Error("NoMapper: Invalid ROM! Unable to load.");
    }

    // Load ROM into memory:
    this.loadPRGROM();

    // Load CHR-ROM:
    this.loadCHRROM();

    // Load Battery RAM (if present):
    this.loadBatteryRam();

    // Reset IRQ:
    //nes.getCpu().doResetInterrupt();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  loadPRGROM() {
    if (this.nes.rom.romCount > 1) {
      // Load the two first banks into memory.
      this.loadRomBank(0, 0x8000);
      this.loadRomBank(1, 0xc000);
    } else {
      // Load the one bank into both memory locations:
      this.loadRomBank(0, 0x8000);
      this.loadRomBank(0, 0xc000);
    }
  }

  loadCHRROM() {
    // console.log("Loading CHR ROM..");
    if (this.nes.rom.vromCount > 0) {
      if (this.nes.rom.vromCount === 1) {
        this.loadVromBank(0, 0x0000);
        this.loadVromBank(0, 0x1000);
      } else {
        this.loadVromBank(0, 0x0000);
        this.loadVromBank(1, 0x1000);
      }
    } else {
      //System.out.println("There aren't any CHR-ROM banks..");
    }
  }

  loadBatteryRam() {
    if (this.nes.rom.batteryRam) {
      let ram = this.nes.rom.batteryRam;
      if (ram !== null && ram.length === 0x2000) {
        // Load Battery RAM into memory:
        copyArrayElements(ram, 0, this.nes.cpu.mem, 0x6000, 0x2000);
      }
    }
  }

  loadRomBank(bank, address) {
    // Loads a ROM bank into the specified address.
    bank %= this.nes.rom.romCount;
    //let data = this.nes.rom.rom[bank];
    //cpuMem.write(address,data,data.length);
    copyArrayElements(
      this.nes.rom.rom[bank],
      0,
      this.nes.cpu.mem,
      address,
      16384,
    );
  }

  loadVromBank(bank, address) {
    if (this.nes.rom.vromCount === 0) {
      return;
    }
    this.nes.ppu.triggerRendering();

    copyArrayElements(
      this.nes.rom.vrom[bank % this.nes.rom.vromCount],
      0,
      this.nes.ppu.vramMem,
      address,
      4096,
    );

    let vromTile = this.nes.rom.vromTile[bank % this.nes.rom.vromCount];
    copyArrayElements(vromTile, 0, this.nes.ppu.ptTile, address >> 4, 256);
  }

  load32kRomBank(bank, address) {
    this.loadRomBank((bank * 2) % this.nes.rom.romCount, address);
    this.loadRomBank((bank * 2 + 1) % this.nes.rom.romCount, address + 16384);
  }

  load8kVromBank(bank4kStart, address) {
    if (this.nes.rom.vromCount === 0) {
      return;
    }
    this.nes.ppu.triggerRendering();

    this.loadVromBank(bank4kStart % this.nes.rom.vromCount, address);
    this.loadVromBank(
      (bank4kStart + 1) % this.nes.rom.vromCount,
      address + 4096,
    );
  }

  load1kVromBank(bank1k, address) {
    if (this.nes.rom.vromCount === 0) {
      return;
    }
    this.nes.ppu.triggerRendering();

    let bank4k = Math.floor(bank1k / 4) % this.nes.rom.vromCount;
    let bankoffset = (bank1k % 4) * 1024;
    copyArrayElements(
      this.nes.rom.vrom[bank4k],
      bankoffset,
      this.nes.ppu.vramMem,
      address,
      1024,
    );

    // Update tiles:
    let vromTile = this.nes.rom.vromTile[bank4k];
    let baseIndex = address >> 4;
    for (let i = 0; i < 64; i++) {
      this.nes.ppu.ptTile[baseIndex + i] = vromTile[((bank1k % 4) << 6) + i];
    }
  }

  load2kVromBank(bank2k, address) {
    if (this.nes.rom.vromCount === 0) {
      return;
    }
    this.nes.ppu.triggerRendering();

    let bank4k = Math.floor(bank2k / 2) % this.nes.rom.vromCount;
    let bankoffset = (bank2k % 2) * 2048;
    copyArrayElements(
      this.nes.rom.vrom[bank4k],
      bankoffset,
      this.nes.ppu.vramMem,
      address,
      2048,
    );

    // Update tiles:
    let vromTile = this.nes.rom.vromTile[bank4k];
    let baseIndex = address >> 4;
    for (let i = 0; i < 128; i++) {
      this.nes.ppu.ptTile[baseIndex + i] = vromTile[((bank2k % 2) << 7) + i];
    }
  }

  load8kRomBank(bank8k, address) {
    let bank16k = Math.floor(bank8k / 2) % this.nes.rom.romCount;
    let offset = (bank8k % 2) * 8192;

    //this.nes.cpu.mem.write(address,this.nes.rom.rom[bank16k],offset,8192);
    copyArrayElements(
      this.nes.rom.rom[bank16k],
      offset,
      this.nes.cpu.mem,
      address,
      8192,
    );
  }

  // Returns true if the PPU can write to the given pattern table address.
  // Most mappers only allow writes when there's no CHR ROM (pure CHR RAM).
  // Mappers with mixed CHR ROM/RAM (e.g. TQROM) override this.
  // eslint-disable-next-line no-unused-vars
  canWriteChr(address) {
    return this.nes.rom.vromCount === 0;
  }

  clockIrqCounter() {
    // Does nothing. This is used by the MMC3 mapper.
  }

  // eslint-disable-next-line no-unused-vars
  latchAccess(address) {
    // Does nothing. This is used by MMC2.
  }

  // Called by the PPU before rendering background tiles for a scanline.
  // Override in mappers that need per-phase CHR bank switching (e.g. MMC5,
  // which uses separate CHR bank sets for sprites vs backgrounds).
  onBgRender() {}

  // Called by the PPU before rendering sprites.
  // Override in mappers that need per-phase CHR bank switching.
  onSpriteRender() {}

  // Called per-tile during BG rendering when bgTileOverride is true.
  // Returns {tile, attrib} to override the tile and attribute for a
  // background tile, or null to use the default lookup.
  // Used by MMC5 ExRAM mode 1 for per-tile CHR bank selection.
  getBgTileData(/* baseTile, tileIndex, ht, vt */) {
    return null;
  }

  // Look up a sprite pattern tile by ptTile index (0-511).
  // Default: return from the PPU's current ptTile cache.
  // MMC5 overrides this to look up from Set A's VROM banks directly,
  // since ptTile may have BG data (Set B) loaded during BG rendering.
  // This avoids calling load*VromBank (which triggers triggerRendering).
  getSpritePatternTile(index) {
    return this.nes.ppu.ptTile[index];
  }

  toJSON() {
    return {
      joy1StrobeState: this.joy1StrobeState,
      joy2StrobeState: this.joy2StrobeState,
      joypadLastWrite: this.joypadLastWrite,
      joypadOutputBit0: this.joypadOutputBit0,
      joypadLastWriteCycle: this.joypadLastWriteCycle,
    };
  }

  fromJSON(s) {
    this.joy1StrobeState = s.joy1StrobeState;
    this.joy2StrobeState = s.joy2StrobeState;
    this.joypadLastWrite = s.joypadLastWrite;
    this.joypadOutputBit0 = s.joypadOutputBit0 || 0;
    this.joypadLastWriteCycle = s.joypadLastWriteCycle ?? -2;
  }
}

export default Mapper0;
`, type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/mappers/mapper1.js": { text: 'import Mapper0 from "./mapper0.js";\n\n// MMC1 / SxROM (SKROM, SLROM, SNROM, etc.)\n// Used by games like The Legend of Zelda, Metroid, Mega Man 2, Final Fantasy.\n// Writes use a 5-bit serial shift register (5 consecutive writes to load a value).\n// Provides switchable 16 KB PRG-ROM banks, 4 KB or 8 KB CHR banks,\n// and software-controlled nametable mirroring.\n// See https://www.nesdev.org/wiki/MMC1\nclass Mapper1 extends Mapper0 {\n  static mapperName = "MMC1";\n\n  constructor(nes) {\n    super(nes);\n\n    // 5-bit buffer:\n    this.regBuffer = 0;\n    this.regBufferCounter = 0;\n\n    // Register 0:\n    this.mirroring = 0;\n    this.oneScreenMirroring = 0;\n    this.prgSwitchingArea = 1;\n    this.prgSwitchingSize = 1;\n    this.vromSwitchingSize = 0;\n\n    // Register 1:\n    this.romSelectionReg0 = 0;\n\n    // Register 2:\n    this.romSelectionReg1 = 0;\n\n    // Register 3:\n    this.romBankSelect = 0;\n  }\n\n  write(address, value) {\n    // Writes to addresses other than MMC registers are handled by NoMapper.\n    if (address < 0x8000) {\n      super.write(address, value);\n      return;\n    }\n\n    // See what should be done with the written value:\n    if ((value & 128) !== 0) {\n      // Reset buffering:\n      this.regBufferCounter = 0;\n      this.regBuffer = 0;\n\n      // Reset register:\n      if (this.getRegNumber(address) === 0) {\n        this.prgSwitchingArea = 1;\n        this.prgSwitchingSize = 1;\n      }\n    } else {\n      // Continue buffering:\n      //regBuffer = (regBuffer & (0xFF-(1<<regBufferCounter))) | ((value & (1<<regBufferCounter))<<regBufferCounter);\n      this.regBuffer =\n        (this.regBuffer & (0xff - (1 << this.regBufferCounter))) |\n        ((value & 1) << this.regBufferCounter);\n      this.regBufferCounter++;\n\n      if (this.regBufferCounter === 5) {\n        // Use the buffered value:\n        this.setReg(this.getRegNumber(address), this.regBuffer);\n\n        // Reset buffer:\n        this.regBuffer = 0;\n        this.regBufferCounter = 0;\n      }\n    }\n  }\n\n  setReg(reg, value) {\n    let tmp;\n\n    switch (reg) {\n      case 0:\n        // Mirroring:\n        tmp = value & 3;\n        if (tmp !== this.mirroring) {\n          // Set mirroring:\n          this.mirroring = tmp;\n          if ((this.mirroring & 2) === 0) {\n            // SingleScreen mirroring overrides the other setting:\n            this.nes.ppu.setMirroring(this.nes.rom.SINGLESCREEN_MIRRORING);\n          } else if ((this.mirroring & 1) !== 0) {\n            // Not overridden by SingleScreen mirroring.\n            this.nes.ppu.setMirroring(this.nes.rom.HORIZONTAL_MIRRORING);\n          } else {\n            this.nes.ppu.setMirroring(this.nes.rom.VERTICAL_MIRRORING);\n          }\n        }\n\n        // PRG Switching Area;\n        this.prgSwitchingArea = (value >> 2) & 1;\n\n        // PRG Switching Size:\n        this.prgSwitchingSize = (value >> 3) & 1;\n\n        // VROM Switching Size:\n        this.vromSwitchingSize = (value >> 4) & 1;\n\n        break;\n\n      case 1:\n        // ROM selection:\n        this.romSelectionReg0 = (value >> 4) & 1;\n\n        // Check whether the cart has VROM:\n        if (this.nes.rom.vromCount > 0) {\n          // Select VROM bank at 0x0000:\n          if (this.vromSwitchingSize === 0) {\n            // Swap 8kB VROM:\n            if (this.romSelectionReg0 === 0) {\n              this.load8kVromBank(value & 0xf, 0x0000);\n            } else {\n              this.load8kVromBank(\n                Math.floor(this.nes.rom.vromCount / 2) + (value & 0xf),\n                0x0000,\n              );\n            }\n          } else {\n            // Swap 4kB VROM:\n            if (this.romSelectionReg0 === 0) {\n              this.loadVromBank(value & 0xf, 0x0000);\n            } else {\n              this.loadVromBank(\n                Math.floor(this.nes.rom.vromCount / 2) + (value & 0xf),\n                0x0000,\n              );\n            }\n          }\n        }\n\n        break;\n\n      case 2:\n        // ROM selection:\n        this.romSelectionReg1 = (value >> 4) & 1;\n\n        // Check whether the cart has VROM:\n        if (this.nes.rom.vromCount > 0) {\n          // Select VROM bank at 0x1000:\n          if (this.vromSwitchingSize === 1) {\n            // Swap 4kB of VROM:\n            if (this.romSelectionReg1 === 0) {\n              this.loadVromBank(value & 0xf, 0x1000);\n            } else {\n              this.loadVromBank(\n                Math.floor(this.nes.rom.vromCount / 2) + (value & 0xf),\n                0x1000,\n              );\n            }\n          }\n        }\n        break;\n\n      default: {\n        // Select ROM bank:\n        // -------------------------\n        let bank;\n        let baseBank = 0;\n\n        if (this.nes.rom.romCount >= 32) {\n          // 1024 kB cart\n          if (this.vromSwitchingSize === 0) {\n            if (this.romSelectionReg0 === 1) {\n              baseBank = 16;\n            }\n          } else {\n            baseBank =\n              (this.romSelectionReg0 | (this.romSelectionReg1 << 1)) << 3;\n          }\n        } else if (this.nes.rom.romCount >= 16) {\n          // 512 kB cart\n          if (this.romSelectionReg0 === 1) {\n            baseBank = 8;\n          }\n        }\n\n        if (this.prgSwitchingSize === 0) {\n          // 32kB\n          bank = baseBank + (value & 0xf);\n          this.load32kRomBank(bank, 0x8000);\n        } else {\n          // 16kB\n          bank = baseBank * 2 + (value & 0xf);\n          if (this.prgSwitchingArea === 0) {\n            this.loadRomBank(bank, 0xc000);\n          } else {\n            this.loadRomBank(bank, 0x8000);\n          }\n        }\n      }\n    }\n  }\n\n  // Returns the register number from the address written to:\n  getRegNumber(address) {\n    if (address >= 0x8000 && address <= 0x9fff) {\n      return 0;\n    } else if (address >= 0xa000 && address <= 0xbfff) {\n      return 1;\n    } else if (address >= 0xc000 && address <= 0xdfff) {\n      return 2;\n    } else {\n      return 3;\n    }\n  }\n\n  loadROM() {\n    if (!this.nes.rom.valid) {\n      throw new Error("MMC1: Invalid ROM! Unable to load.");\n    }\n\n    // Load PRG-ROM:\n    this.loadRomBank(0, 0x8000); //   First ROM bank..\n    this.loadRomBank(this.nes.rom.romCount - 1, 0xc000); // ..and last ROM bank.\n\n    // Load CHR-ROM:\n    this.loadCHRROM();\n\n    // Load Battery RAM (if present):\n    this.loadBatteryRam();\n\n    // Do Reset-Interrupt:\n    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);\n  }\n\n  // eslint-disable-next-line no-unused-vars\n  switchLowHighPrgRom(oldSetting) {\n    // not yet.\n  }\n\n  switch16to32() {\n    // not yet.\n  }\n\n  switch32to16() {\n    // not yet.\n  }\n\n  toJSON() {\n    let s = super.toJSON();\n    s.mirroring = this.mirroring;\n    s.oneScreenMirroring = this.oneScreenMirroring;\n    s.prgSwitchingArea = this.prgSwitchingArea;\n    s.prgSwitchingSize = this.prgSwitchingSize;\n    s.vromSwitchingSize = this.vromSwitchingSize;\n    s.romSelectionReg0 = this.romSelectionReg0;\n    s.romSelectionReg1 = this.romSelectionReg1;\n    s.romBankSelect = this.romBankSelect;\n    s.regBuffer = this.regBuffer;\n    s.regBufferCounter = this.regBufferCounter;\n    return s;\n  }\n\n  fromJSON(s) {\n    super.fromJSON(s);\n    this.mirroring = s.mirroring;\n    this.oneScreenMirroring = s.oneScreenMirroring;\n    this.prgSwitchingArea = s.prgSwitchingArea;\n    this.prgSwitchingSize = s.prgSwitchingSize;\n    this.vromSwitchingSize = s.vromSwitchingSize;\n    this.romSelectionReg0 = s.romSelectionReg0;\n    this.romSelectionReg1 = s.romSelectionReg1;\n    this.romBankSelect = s.romBankSelect;\n    this.regBuffer = s.regBuffer;\n    this.regBufferCounter = s.regBufferCounter;\n  }\n}\n\nexport default Mapper1;\n', type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/mappers/mapper11.js": { text: 'import Mapper0 from "./mapper0.js";\n\n// Color Dreams (unlicensed discrete mapper)\n// Used by games like Bible Adventures, Crystal Mines, Chiller, Metal Fighter.\n// Single register at $8000-$FFFF: bits 0-1 select 32 KB PRG bank,\n// bits 4-7 select 8 KB CHR bank.\n// See https://www.nesdev.org/wiki/Color_Dreams\nclass Mapper11 extends Mapper0 {\n  static mapperName = "Color Dreams";\n\n  constructor(nes) {\n    super(nes);\n  }\n\n  write(address, value) {\n    if (address < 0x8000) {\n      super.write(address, value);\n      return;\n    } else {\n      // Swap in the given PRG-ROM bank:\n      let prgbank1 = ((value & 0xf) * 2) % this.nes.rom.romCount;\n      let prgbank2 = ((value & 0xf) * 2 + 1) % this.nes.rom.romCount;\n\n      this.loadRomBank(prgbank1, 0x8000);\n      this.loadRomBank(prgbank2, 0xc000);\n\n      if (this.nes.rom.vromCount > 0) {\n        // Swap in the given VROM bank at 0x0000:\n        let bank = ((value >> 4) * 2) % this.nes.rom.vromCount;\n        this.loadVromBank(bank, 0x0000);\n        this.loadVromBank(bank + 1, 0x1000);\n      }\n    }\n  }\n}\n\nexport default Mapper11;\n', type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/mappers/mapper118.js": { text: `import Mapper4 from "./mapper4.js";

// TxSROM - MMC3 variant with CHR-controlled nametable mirroring
// Used by games like Armadillo, Pro Sport Hockey, Goal! Two.
// Identical to standard MMC3 except: the $A000 mirroring register is bypassed,
// and bit 7 of CHR bank register values controls CIRAM A10 (nametable page select)
// instead of being used for CHR addressing. This enables single-screen and
// diagonal mirroring modes that standard MMC3 cannot produce.
// See https://www.nesdev.org/wiki/INES_Mapper_118
class Mapper118 extends Mapper4 {
  static mapperName = "TxSROM";

  constructor(nes) {
    super(nes);
    // Raw CHR register values (R0-R5) \u2014 bit 7 is used for nametable control
    this.chrRegs = [0, 0, 0, 0, 0, 0];
  }

  write(address, value) {
    if (address === 0xa000) {
      // The standard MMC3 mirroring register is bypassed on TxSROM.
      // Nametable mirroring is instead controlled by bit 7 of CHR bank values.
      return;
    }
    super.write(address, value);
    if (address === 0x8000) {
      // chrAddressSelect may have changed, which affects which CHR registers
      // control which nametables
      this.updateNametableMirroring();
    }
  }

  executeCommand(cmd, arg) {
    if (cmd <= 5) {
      // CHR bank command: store the raw value, then mask bit 7 before passing
      // to the parent for CHR banking (bit 7 goes to CIRAM A10, not CHR A17)
      this.chrRegs[cmd] = arg;
      super.executeCommand(cmd, arg & 0x7f);
      this.updateNametableMirroring();
    } else {
      // PRG bank commands pass through unchanged
      super.executeCommand(cmd, arg);
    }
  }

  // Update nametable mirroring based on bit 7 of CHR register values.
  // The MMC3's CHR banking ignores A13, so pattern table addresses ($0xxx)
  // and nametable addresses ($2xxx) use the same bank selection. CHR A17
  // (bit 7) is wired to CIRAM A10 on TxSROM boards.
  //
  // When chrAddressSelect=0: R0/R1 (2KB banks) are at $0000-$0FFF, so they
  //   control nametables: R0 bit 7 \u2192 NT0+NT1, R1 bit 7 \u2192 NT2+NT3
  // When chrAddressSelect=1: R2-R5 (1KB banks) are at $0000-$0FFF, so they
  //   control individual nametables: R2\u2192NT0, R3\u2192NT1, R4\u2192NT2, R5\u2192NT3
  updateNametableMirroring() {
    let ppu = this.nes.ppu;

    if (this.chrAddressSelect === 0) {
      let nt01 = (this.chrRegs[0] >> 7) & 1;
      let nt23 = (this.chrRegs[1] >> 7) & 1;
      ppu.ntable1[0] = nt01;
      ppu.ntable1[1] = nt01;
      ppu.ntable1[2] = nt23;
      ppu.ntable1[3] = nt23;
    } else {
      ppu.ntable1[0] = (this.chrRegs[2] >> 7) & 1;
      ppu.ntable1[1] = (this.chrRegs[3] >> 7) & 1;
      ppu.ntable1[2] = (this.chrRegs[4] >> 7) & 1;
      ppu.ntable1[3] = (this.chrRegs[5] >> 7) & 1;
    }

    // Update VRAM mirror table to match ntable1 settings
    for (let i = 0; i < 4; i++) {
      let source = 0x2000 + i * 0x400;
      let target = 0x2000 + ppu.ntable1[i] * 0x400;
      ppu.defineMirrorRegion(source, target, 0x400);
    }

    // Invalidate the PPU's mirroring cache so setMirroring() won't skip
    // updates if called later
    ppu.currentMirroring = -1;
  }

  loadROM() {
    super.loadROM();
    this.updateNametableMirroring();
  }

  toJSON() {
    let s = super.toJSON();
    s.chrRegs = this.chrRegs.slice();
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.chrRegs = s.chrRegs;
    this.updateNametableMirroring();
  }
}

export default Mapper118;
`, type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/mappers/mapper119.js": { text: 'import Mapper4 from "./mapper4.js";\nimport Tile from "../tile.js";\nimport { copyArrayElements } from "../utils.js";\n\n// TQROM - MMC3 variant that supports both CHR ROM and CHR RAM simultaneously.\n// Used by Pin-Bot and High Speed (both by Rare).\n// Identical to standard MMC3 except: bit 6 of the CHR bank register values\n// selects between CHR ROM (0) and CHR RAM (1). Bits 0-5 specify the bank\n// within the selected chip, allowing up to 64KB CHR ROM and 8KB CHR RAM.\n// A 74HC32 ORs PPU A13 with CHR A16 (bit 6) to generate the ROM chip-enable,\n// while CHR A16 directly enables the RAM chip.\n// See https://www.nesdev.org/wiki/INES_Mapper_119\nclass Mapper119 extends Mapper4 {\n  static mapperName = "TQROM";\n\n  constructor(nes) {\n    super(nes);\n\n    // 8KB of CHR RAM (8 x 1KB banks)\n    this.chrRam = new Uint8Array(8192);\n\n    // Pre-decoded tiles for CHR RAM banks. Each 1KB bank has 64 tiles (1KB / 16\n    // bytes per tile). These are persistent Tile objects: when a CHR RAM bank is\n    // loaded into a PPU slot, ptTile entries point here, and PPU patternWrite()\n    // updates them in place on $2007 writes.\n    this.chrRamTiles = new Array(8);\n    for (let i = 0; i < 8; i++) {\n      this.chrRamTiles[i] = new Array(64);\n      for (let j = 0; j < 64; j++) {\n        this.chrRamTiles[i][j] = new Tile();\n      }\n    }\n\n    // Tracks which CHR RAM bank (0-7) is mapped at each 1KB PPU pattern table\n    // slot (0-7 for addresses $0000-$1FFF), or -1 if CHR ROM is there.\n    this.chrRamSlots = [-1, -1, -1, -1, -1, -1, -1, -1];\n  }\n\n  executeCommand(cmd, arg) {\n    switch (cmd) {\n      case Mapper4.CMD_SEL_2_1K_VROM_0000: {\n        // Select 2 consecutive 1KB banks at $0000/$0400 (or $1000/$1400)\n        let base = this.chrAddressSelect === 0 ? 0x0000 : 0x1000;\n        if (arg & 0x40) {\n          let bank = arg & 0x06; // 2KB-aligned within CHR RAM\n          this.load1kChrRamBank(bank, base);\n          this.load1kChrRamBank(bank + 1, base + 0x0400);\n        } else {\n          let bank = arg & 0x3f;\n          this.saveChrRamSlot(base);\n          this.saveChrRamSlot(base + 0x0400);\n          this.chrRamSlots[base >> 10] = -1;\n          this.chrRamSlots[(base >> 10) + 1] = -1;\n          this.load1kVromBank(bank, base);\n          this.load1kVromBank(bank + 1, base + 0x0400);\n        }\n        break;\n      }\n\n      case Mapper4.CMD_SEL_2_1K_VROM_0800: {\n        let base = this.chrAddressSelect === 0 ? 0x0800 : 0x1800;\n        if (arg & 0x40) {\n          let bank = arg & 0x06;\n          this.load1kChrRamBank(bank, base);\n          this.load1kChrRamBank(bank + 1, base + 0x0400);\n        } else {\n          let bank = arg & 0x3f;\n          this.saveChrRamSlot(base);\n          this.saveChrRamSlot(base + 0x0400);\n          this.chrRamSlots[base >> 10] = -1;\n          this.chrRamSlots[(base >> 10) + 1] = -1;\n          this.load1kVromBank(bank, base);\n          this.load1kVromBank(bank + 1, base + 0x0400);\n        }\n        break;\n      }\n\n      case Mapper4.CMD_SEL_1K_VROM_1000: {\n        let base = this.chrAddressSelect === 0 ? 0x1000 : 0x0000;\n        if (arg & 0x40) {\n          this.load1kChrRamBank(arg & 0x07, base);\n        } else {\n          this.saveChrRamSlot(base);\n          this.chrRamSlots[base >> 10] = -1;\n          this.load1kVromBank(arg & 0x3f, base);\n        }\n        break;\n      }\n\n      case Mapper4.CMD_SEL_1K_VROM_1400: {\n        let base = this.chrAddressSelect === 0 ? 0x1400 : 0x0400;\n        if (arg & 0x40) {\n          this.load1kChrRamBank(arg & 0x07, base);\n        } else {\n          this.saveChrRamSlot(base);\n          this.chrRamSlots[base >> 10] = -1;\n          this.load1kVromBank(arg & 0x3f, base);\n        }\n        break;\n      }\n\n      case Mapper4.CMD_SEL_1K_VROM_1800: {\n        let base = this.chrAddressSelect === 0 ? 0x1800 : 0x0800;\n        if (arg & 0x40) {\n          this.load1kChrRamBank(arg & 0x07, base);\n        } else {\n          this.saveChrRamSlot(base);\n          this.chrRamSlots[base >> 10] = -1;\n          this.load1kVromBank(arg & 0x3f, base);\n        }\n        break;\n      }\n\n      case Mapper4.CMD_SEL_1K_VROM_1C00: {\n        let base = this.chrAddressSelect === 0 ? 0x1c00 : 0x0c00;\n        if (arg & 0x40) {\n          this.load1kChrRamBank(arg & 0x07, base);\n        } else {\n          this.saveChrRamSlot(base);\n          this.chrRamSlots[base >> 10] = -1;\n          this.load1kVromBank(arg & 0x3f, base);\n        }\n        break;\n      }\n\n      default:\n        // PRG commands (6, 7) pass through to MMC3\n        super.executeCommand(cmd, arg);\n    }\n  }\n\n  // Save the current vramMem content of a 1KB PPU slot back to chrRam.\n  // This must be called before overwriting a slot that has CHR RAM mapped,\n  // so that any PPU $2007 writes to that region are preserved.\n  saveChrRamSlot(address) {\n    let slot = address >> 10;\n    let bank = this.chrRamSlots[slot];\n    if (bank === -1) return;\n    copyArrayElements(\n      this.nes.ppu.vramMem,\n      slot << 10,\n      this.chrRam,\n      bank * 1024,\n      1024,\n    );\n  }\n\n  // Load a 1KB CHR RAM bank into the PPU pattern table at the given address.\n  load1kChrRamBank(bank, address) {\n    this.nes.ppu.triggerRendering();\n    bank &= 0x07;\n\n    // Save the old CHR RAM content if this slot had a different bank mapped\n    this.saveChrRamSlot(address);\n\n    let slot = address >> 10;\n    this.chrRamSlots[slot] = bank;\n\n    // Copy CHR RAM data into PPU VRAM\n    let srcOffset = bank * 1024;\n    copyArrayElements(\n      this.chrRam,\n      srcOffset,\n      this.nes.ppu.vramMem,\n      address,\n      1024,\n    );\n\n    // Rebuild tiles from CHR RAM data and install them in ppuTile\n    this.rebuildChrRamTiles(bank);\n    let baseIndex = address >> 4;\n    for (let i = 0; i < 64; i++) {\n      this.nes.ppu.ptTile[baseIndex + i] = this.chrRamTiles[bank][i];\n    }\n  }\n\n  // Rebuild the pre-decoded Tile objects for a CHR RAM bank from raw bytes.\n  rebuildChrRamTiles(bank) {\n    let base = bank * 1024;\n    for (let i = 0; i < 1024; i++) {\n      let tileIndex = i >> 4;\n      let leftOver = i % 16;\n      if (leftOver < 8) {\n        this.chrRamTiles[bank][tileIndex].setScanline(\n          leftOver,\n          this.chrRam[base + i],\n          this.chrRam[base + i + 8],\n        );\n      } else {\n        this.chrRamTiles[bank][tileIndex].setScanline(\n          leftOver - 8,\n          this.chrRam[base + i - 8],\n          this.chrRam[base + i],\n        );\n      }\n    }\n  }\n\n  // Allow PPU writes to pattern table addresses that are mapped to CHR RAM.\n  canWriteChr(address) {\n    if (address >= 0x2000) return false;\n    return this.chrRamSlots[address >> 10] !== -1;\n  }\n\n  toJSON() {\n    // Flush any pending CHR RAM writes from vramMem back to chrRam\n    for (let slot = 0; slot < 8; slot++) {\n      this.saveChrRamSlot(slot << 10);\n    }\n    let s = super.toJSON();\n    s.chrRam = Array.from(this.chrRam);\n    s.chrRamSlots = this.chrRamSlots.slice();\n    return s;\n  }\n\n  fromJSON(s) {\n    super.fromJSON(s);\n    this.chrRam = new Uint8Array(s.chrRam);\n    this.chrRamSlots = s.chrRamSlots;\n    // Rebuild all CHR RAM tile data\n    for (let bank = 0; bank < 8; bank++) {\n      this.rebuildChrRamTiles(bank);\n    }\n    // Re-install CHR RAM tiles into PPU ptTile for active slots\n    for (let slot = 0; slot < 8; slot++) {\n      let bank = this.chrRamSlots[slot];\n      if (bank !== -1) {\n        let baseIndex = (slot << 10) >> 4;\n        for (let i = 0; i < 64; i++) {\n          this.nes.ppu.ptTile[baseIndex + i] = this.chrRamTiles[bank][i];\n        }\n      }\n    }\n  }\n}\n\nexport default Mapper119;\n', type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/mappers/mapper140.js": { text: 'import Mapper0 from "./mapper0.js";\n\n// Jaleco JF-11 / JF-14\n// Used by Bio Senshi Dan - Increaser Tono Tatakai.\n// Similar to GxROM (mapper 66) but register is at $6000-$7FFF instead of $8000+,\n// which means it cannot coexist with SRAM. Bits 4-5 select 32 KB PRG bank,\n// bits 0-3 select 8 KB CHR bank.\n// See https://www.nesdev.org/wiki/INES_Mapper_140\nclass Mapper140 extends Mapper0 {\n  static mapperName = "Jaleco JF-11/JF-14";\n\n  constructor(nes) {\n    super(nes);\n  }\n\n  write(address, value) {\n    if (address < 0x6000 || address > 0x7fff) {\n      super.write(address, value);\n      return;\n    } else {\n      // Swap in the given PRG-ROM bank at 0x8000:\n      this.load32kRomBank((value >> 4) & 3, 0x8000);\n\n      // Swap in the given VROM bank at 0x0000:\n      this.load8kVromBank((value & 0xf) * 2, 0x0000);\n    }\n  }\n}\n\nexport default Mapper140;\n', type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/mappers/mapper180.js": { text: 'import Mapper0 from "./mapper0.js";\n\n// UNROM (AND-logic variant, HVC-UNROM)\n// Used by Crazy Climber.\n// Inverted UxROM: first 16 KB bank fixed at $8000, switchable bank at $C000.\n// Standard UxROM fixes the last bank; this variant uses AND logic instead of OR logic\n// on the bank select lines, producing the opposite fixed-bank behavior.\n// See https://www.nesdev.org/wiki/INES_Mapper_180\nclass Mapper180 extends Mapper0 {\n  static mapperName = "UNROM (Crazy Climber)";\n\n  constructor(nes) {\n    super(nes);\n  }\n\n  write(address, value) {\n    // Writes to addresses other than MMC registers are handled by NoMapper.\n    if (address < 0x8000) {\n      super.write(address, value);\n      return;\n    } else {\n      // This is a ROM bank select command.\n      // Swap in the given ROM bank at 0xc000:\n      this.loadRomBank(value, 0xc000);\n    }\n  }\n\n  loadROM() {\n    if (!this.nes.rom.valid) {\n      throw new Error("Mapper 180: Invalid ROM! Unable to load.");\n    }\n\n    // Load PRG-ROM:\n    this.loadRomBank(0, 0x8000);\n    this.loadRomBank(0, 0xc000);\n\n    // Load CHR-ROM:\n    this.loadCHRROM();\n\n    // Do Reset-Interrupt:\n    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);\n  }\n}\n\nexport default Mapper180;\n', type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/mappers/mapper2.js": { text: 'import Mapper0 from "./mapper0.js";\n\n// UxROM (NES-UNROM, NES-UOROM)\n// Used by games like Mega Man, Castlevania, Contra, Duck Tales, Metal Gear.\n// 16 KB switchable PRG-ROM bank at $8000, last 16 KB bank fixed at $C000.\n// Uses CHR-RAM (no CHR-ROM bank switching).\n// See https://www.nesdev.org/wiki/UxROM\nclass Mapper2 extends Mapper0 {\n  static mapperName = "UxROM";\n\n  constructor(nes) {\n    super(nes);\n  }\n\n  write(address, value) {\n    // Writes to addresses other than MMC registers are handled by NoMapper.\n    if (address < 0x8000) {\n      super.write(address, value);\n      return;\n    } else {\n      // This is a ROM bank select command.\n      // Swap in the given ROM bank at 0x8000:\n      this.loadRomBank(value, 0x8000);\n    }\n  }\n\n  loadROM() {\n    if (!this.nes.rom.valid) {\n      throw new Error("UNROM: Invalid ROM! Unable to load.");\n    }\n\n    // Load PRG-ROM:\n    this.loadRomBank(0, 0x8000);\n    this.loadRomBank(this.nes.rom.romCount - 1, 0xc000);\n\n    // Load CHR-ROM:\n    this.loadCHRROM();\n\n    // Do Reset-Interrupt:\n    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);\n  }\n}\n\nexport default Mapper2;\n', type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/mappers/mapper240.js": { text: 'import Mapper0 from "./mapper0.js";\n\n// Mapper 240 (Jing Ke Xin Zhuan / Sheng Huo Lie Zhuan PCBs)\n// Used by Jing Ke Xin Zhuan, Sheng Huo Lie Zhuan.\n// Register at $4020-$5FFF: upper nibble selects 32 KB PRG bank,\n// lower nibble selects 8 KB CHR bank.\n// See https://www.nesdev.org/wiki/INES_Mapper_240\nclass Mapper240 extends Mapper0 {\n  static mapperName = "Mapper 240";\n\n  constructor(nes) {\n    super(nes);\n  }\n\n  write(address, value) {\n    if (address < 0x4020 || address > 0x5fff) {\n      super.write(address, value);\n      return;\n    } else {\n      // Swap in the given PRG-ROM bank at 0x8000:\n      this.load32kRomBank((value >> 4) & 3, 0x8000);\n\n      // Swap in the given VROM bank at 0x0000:\n      this.load8kVromBank((value & 0xf) * 2, 0x0000);\n    }\n  }\n}\n\nexport default Mapper240;\n', type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/mappers/mapper241.js": { text: 'import Mapper0 from "./mapper0.js";\n\n// BxROM variant (Hengge Technology)\n// Used by various Hengge Technology titles and educational cartridges.\n// BxROM-like 32 KB PRG bank switching via writes to $8000-$FFFF,\n// with optional battery-backed WRAM at $6000-$7FFF.\n// See https://www.nesdev.org/wiki/INES_Mapper_241\nclass Mapper241 extends Mapper0 {\n  static mapperName = "BxROM (Mapper 241)";\n\n  constructor(nes) {\n    super(nes);\n  }\n\n  write(address, value) {\n    if (address < 0x8000) {\n      super.write(address, value);\n      return;\n    } else {\n      this.load32kRomBank(value, 0x8000);\n    }\n  }\n}\n\nexport default Mapper241;\n', type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/mappers/mapper3.js": { text: `import Mapper0 from "./mapper0.js";

// CNROM
// Used by games like Solomon's Key, Arkanoid, Arkista's Ring, Bump 'n' Jump.
// Fixed PRG-ROM (up to 32 KB), with switchable 8 KB CHR-ROM banks.
// See https://www.nesdev.org/wiki/INES_Mapper_003
class Mapper3 extends Mapper0 {
  static mapperName = "CNROM";

  constructor(nes) {
    super(nes);
  }

  write(address, value) {
    // Writes to addresses other than MMC registers are handled by NoMapper.
    if (address < 0x8000) {
      super.write(address, value);
      return;
    } else {
      // This is a ROM bank select command.
      // Swap in the given ROM bank at 0x8000:
      // This is a VROM bank select command.
      // Swap in the given VROM bank at 0x0000:
      this.load8kVromBank(value * 2, 0x0000);
    }
  }
}

export default Mapper3;
`, type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/mappers/mapper34.js": { text: 'import Mapper0 from "./mapper0.js";\n\n// BNROM (NES-BNROM)\n// Used by games like Deadly Towers (Mashou), Darkseed.\n// Simple 32 KB PRG-ROM bank switching via writes to $8000-$FFFF.\n// No CHR bank switching (uses CHR-RAM or fixed CHR-ROM).\n// Note: iNES mapper 34 also covers NINA-001; this implementation handles BNROM only.\n// See https://www.nesdev.org/wiki/INES_Mapper_034\nclass Mapper34 extends Mapper0 {\n  static mapperName = "BNROM";\n\n  constructor(nes) {\n    super(nes);\n  }\n\n  write(address, value) {\n    if (address < 0x8000) {\n      super.write(address, value);\n      return;\n    } else {\n      this.load32kRomBank(value, 0x8000);\n    }\n  }\n}\n\nexport default Mapper34;\n', type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/mappers/mapper38.js": { text: 'import Mapper0 from "./mapper0.js";\n\n// PCI556 (UNL-PCI556) - Bit Corp\n// Used by Crime Busters.\n// Nearly identical to GxROM (mapper 66) but the register is at $7000-$7FFF.\n// Bits 0-1 select 32 KB PRG bank, bits 2-3 select 8 KB CHR bank.\n// See https://www.nesdev.org/wiki/INES_Mapper_038\nclass Mapper38 extends Mapper0 {\n  static mapperName = "PCI556";\n\n  constructor(nes) {\n    super(nes);\n  }\n\n  write(address, value) {\n    if (address < 0x7000 || address > 0x7fff) {\n      super.write(address, value);\n      return;\n    } else {\n      // Swap in the given PRG-ROM bank at 0x8000:\n      this.load32kRomBank(value & 3, 0x8000);\n\n      // Swap in the given VROM bank at 0x0000:\n      this.load8kVromBank(((value >> 2) & 3) * 2, 0x0000);\n    }\n  }\n}\n\nexport default Mapper38;\n', type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/mappers/mapper4.js": { text: `import Mapper0 from "./mapper0.js";

// MMC3 / TxROM (TSROM, TLSROM, TQROM, etc.)
// Used by games like Super Mario Bros. 2, Super Mario Bros. 3, Kirby's Adventure.
// Fine-grained bank switching: two 8 KB switchable PRG-ROM banks, two 2 KB + four
// 1 KB CHR banks. Provides a scanline-counting IRQ for split-screen effects and
// software-switchable H/V nametable mirroring.
// See https://www.nesdev.org/wiki/MMC3
class Mapper4 extends Mapper0 {
  static mapperName = "MMC3";
  static CMD_SEL_2_1K_VROM_0000 = 0;
  static CMD_SEL_2_1K_VROM_0800 = 1;
  static CMD_SEL_1K_VROM_1000 = 2;
  static CMD_SEL_1K_VROM_1400 = 3;
  static CMD_SEL_1K_VROM_1800 = 4;
  static CMD_SEL_1K_VROM_1C00 = 5;
  static CMD_SEL_ROM_PAGE1 = 6;
  static CMD_SEL_ROM_PAGE2 = 7;

  constructor(nes) {
    super(nes);
    this.command = 0;
    this.prgAddressSelect = 0;
    this.chrAddressSelect = 0;
    this.pageNumber = 0;
    this.irqCounter = 0;
    this.irqLatchValue = 0;
    this.irqEnable = 0;
    this.prgAddressChanged = false;
  }

  write(address, value) {
    // Writes to addresses other than MMC registers are handled by NoMapper.
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }

    switch (address & 0xe001) {
      case 0x8000: {
        // Command/Address Select register
        this.command = value & 7;
        const tmp = (value >> 6) & 1;
        if (tmp !== this.prgAddressSelect) {
          this.prgAddressChanged = true;
        }
        this.prgAddressSelect = tmp;
        this.chrAddressSelect = (value >> 7) & 1;
        break;
      }

      case 0x8001:
        // Page number for command
        this.executeCommand(this.command, value);
        break;

      case 0xa000:
        // Mirroring select
        if ((value & 1) !== 0) {
          this.nes.ppu.setMirroring(this.nes.rom.HORIZONTAL_MIRRORING);
        } else {
          this.nes.ppu.setMirroring(this.nes.rom.VERTICAL_MIRRORING);
        }
        break;

      case 0xa001:
        // SaveRAM Toggle
        // TODO
        //nes.getRom().setSaveState((value&1)!=0);
        break;

      case 0xc000:
        // IRQ Counter register
        this.irqCounter = value;
        //nes.ppu.mapperIrqCounter = 0;
        break;

      case 0xc001:
        // IRQ Latch register
        this.irqLatchValue = value;
        break;

      case 0xe000:
        // IRQ Control Reg 0 (disable)
        //irqCounter = irqLatchValue;
        this.irqEnable = 0;
        break;

      case 0xe001:
        // IRQ Control Reg 1 (enable)
        this.irqEnable = 1;
        break;

      // No default needed: the 0xE001 mask maps every address >= $8000
      // to one of the eight cases above.
    }
  }

  executeCommand(cmd, arg) {
    switch (cmd) {
      case Mapper4.CMD_SEL_2_1K_VROM_0000:
        // Select 2 1KB VROM pages at 0x0000:
        if (this.chrAddressSelect === 0) {
          this.load1kVromBank(arg, 0x0000);
          this.load1kVromBank(arg + 1, 0x0400);
        } else {
          this.load1kVromBank(arg, 0x1000);
          this.load1kVromBank(arg + 1, 0x1400);
        }
        break;

      case Mapper4.CMD_SEL_2_1K_VROM_0800:
        // Select 2 1KB VROM pages at 0x0800:
        if (this.chrAddressSelect === 0) {
          this.load1kVromBank(arg, 0x0800);
          this.load1kVromBank(arg + 1, 0x0c00);
        } else {
          this.load1kVromBank(arg, 0x1800);
          this.load1kVromBank(arg + 1, 0x1c00);
        }
        break;

      case Mapper4.CMD_SEL_1K_VROM_1000:
        // Select 1K VROM Page at 0x1000:
        if (this.chrAddressSelect === 0) {
          this.load1kVromBank(arg, 0x1000);
        } else {
          this.load1kVromBank(arg, 0x0000);
        }
        break;

      case Mapper4.CMD_SEL_1K_VROM_1400:
        // Select 1K VROM Page at 0x1400:
        if (this.chrAddressSelect === 0) {
          this.load1kVromBank(arg, 0x1400);
        } else {
          this.load1kVromBank(arg, 0x0400);
        }
        break;

      case Mapper4.CMD_SEL_1K_VROM_1800:
        // Select 1K VROM Page at 0x1800:
        if (this.chrAddressSelect === 0) {
          this.load1kVromBank(arg, 0x1800);
        } else {
          this.load1kVromBank(arg, 0x0800);
        }
        break;

      case Mapper4.CMD_SEL_1K_VROM_1C00:
        // Select 1K VROM Page at 0x1C00:
        if (this.chrAddressSelect === 0) {
          this.load1kVromBank(arg, 0x1c00);
        } else {
          this.load1kVromBank(arg, 0x0c00);
        }
        break;

      case Mapper4.CMD_SEL_ROM_PAGE1:
        if (this.prgAddressChanged) {
          // Load the two hardwired banks:
          if (this.prgAddressSelect === 0) {
            this.load8kRomBank((this.nes.rom.romCount - 1) * 2, 0xc000);
          } else {
            this.load8kRomBank((this.nes.rom.romCount - 1) * 2, 0x8000);
          }
          this.prgAddressChanged = false;
        }

        // Select first switchable ROM page:
        if (this.prgAddressSelect === 0) {
          this.load8kRomBank(arg, 0x8000);
        } else {
          this.load8kRomBank(arg, 0xc000);
        }
        break;

      case Mapper4.CMD_SEL_ROM_PAGE2:
        // Select second switchable ROM page:
        this.load8kRomBank(arg, 0xa000);

        // hardwire appropriate bank:
        if (this.prgAddressChanged) {
          // Load the two hardwired banks:
          if (this.prgAddressSelect === 0) {
            this.load8kRomBank((this.nes.rom.romCount - 1) * 2, 0xc000);
          } else {
            this.load8kRomBank((this.nes.rom.romCount - 1) * 2, 0x8000);
          }
          this.prgAddressChanged = false;
        }
    }
  }

  loadROM() {
    if (!this.nes.rom.valid) {
      throw new Error("MMC3: Invalid ROM! Unable to load.");
    }

    // Load hardwired PRG banks (0xC000 and 0xE000):
    this.load8kRomBank((this.nes.rom.romCount - 1) * 2, 0xc000);
    this.load8kRomBank((this.nes.rom.romCount - 1) * 2 + 1, 0xe000);

    // Load swappable PRG banks (0x8000 and 0xA000):
    this.load8kRomBank(0, 0x8000);
    this.load8kRomBank(1, 0xa000);

    // Load CHR-ROM:
    this.loadCHRROM();

    // Load Battery RAM (if present):
    this.loadBatteryRam();

    // Do Reset-Interrupt:
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  clockIrqCounter() {
    if (this.irqEnable === 1) {
      this.irqCounter--;
      if (this.irqCounter < 0) {
        // Trigger IRQ:
        //nes.getCpu().doIrq();
        this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
        this.irqCounter = this.irqLatchValue;
      }
    }
  }

  toJSON() {
    let s = super.toJSON();
    s.command = this.command;
    s.prgAddressSelect = this.prgAddressSelect;
    s.chrAddressSelect = this.chrAddressSelect;
    s.pageNumber = this.pageNumber;
    s.irqCounter = this.irqCounter;
    s.irqLatchValue = this.irqLatchValue;
    s.irqEnable = this.irqEnable;
    s.prgAddressChanged = this.prgAddressChanged;
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.command = s.command;
    this.prgAddressSelect = s.prgAddressSelect;
    this.chrAddressSelect = s.chrAddressSelect;
    this.pageNumber = s.pageNumber;
    this.irqCounter = s.irqCounter;
    this.irqLatchValue = s.irqLatchValue;
    this.irqEnable = s.irqEnable;
    this.prgAddressChanged = s.prgAddressChanged;
  }
}

export default Mapper4;
`, type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/mappers/mapper5.js": { text: `import Mapper0 from "./mapper0.js";
import { copyArrayElements } from "../utils.js";

// MMC5 / ExROM (EKROM, ELROM, ETROM, EWROM)
// Used by games like Castlevania III, Just Breed, Uncharted Waters, Metal Slader Glory.
// The most complex Nintendo mapper. Flexible PRG/CHR banking (up to 1 MB each),
// expansion audio (2 pulse + PCM), 8x8 hardware multiplier, 1 KB ExRAM for extended
// nametable attributes, vertical split screen, and scanline-counting IRQ.
// See https://www.nesdev.org/wiki/MMC5
class Mapper5 extends Mapper0 {
  static mapperName = "MMC5";

  constructor(nes) {
    super(nes);

    // PRG banking
    // $5100: PRG mode (0=32K, 1=16K+16K, 2=16K+8K+8K, 3=8K+8K+8K+8K)
    this.prgMode = 3; // Power-on default: mode 3 (8K banks)
    // $5113-$5117: PRG bank registers. Raw values written by the game.
    // $5113 always maps RAM to $6000-$7FFF.
    // $5114-$5116 bit 7: 0=RAM, 1=ROM. $5117 always ROM.
    this.prgBankReg = new Uint8Array(5); // indices 0-4 for $5113-$5117
    this.prgBankReg[4] = 0xff; // $5117 defaults to last page (0xFF)

    // PRG RAM: up to 64 KB (two 32 KB chips), banked into $6000-$7FFF.
    // Also mappable into $8000-$DFFF via bank registers with bit 7 clear.
    this.prgRam = new Uint8Array(0x10000); // 64 KB PRG RAM

    // PRG RAM write protection: $5102 and $5103
    // Writes only enabled when $5102=%10 and $5103=%01
    // Both reset to %11 ($03) per nesdev wiki, which keeps RAM write-protected.
    this.prgRamProtectA = 0x03; // $5102
    this.prgRamProtectB = 0x03; // $5103

    // CHR banking
    // $5101: CHR mode (0=8K, 1=4K, 2=2K, 3=1K)
    this.chrMode = 3; // Power-on default: mode 3 (1K banks)
    // $5120-$5127: CHR bank set A (sprite banks)
    this.chrBankA = new Uint16Array(8);
    // $5128-$512B: CHR bank set B (background banks)
    this.chrBankB = new Uint16Array(4);
    // $5130: Upper CHR bank bits (bits 8-9 appended to bank registers)
    this.chrUpperBits = 0;
    // Tracks which CHR set was last written (0=A, 1=B) for $2007 access
    this.lastChrWrite = 0;

    // Nametable mapping: $5105
    // Each 2-bit field: 0=CIRAM A, 1=CIRAM B, 2=ExRAM, 3=Fill
    this.ntMapping = new Uint8Array(4);

    // ExRAM: 1 KB internal to MMC5, used for nametable/extended attributes/RAM
    // $5104: ExRAM mode (0=nametable, 1=ext attributes, 2=RAM, 3=read-only)
    this.exramMode = 0;
    this.exram = new Uint8Array(0x400); // 1 KB

    // Fill mode: $5106/$5107
    this.fillTile = 0;
    this.fillAttr = 0;

    // Scanline IRQ: $5203/$5204
    // The MMC5 counts scanlines by monitoring PPU nametable fetches.
    // See https://www.nesdev.org/wiki/MMC5#Scanline_detection_and_scanline_IRQ
    this.irqTarget = 0; // $5203: target scanline
    this.irqEnabled = false; // $5204 bit 7 write: IRQ enable
    this.irqPending = false; // $5204 bit 7 read: IRQ pending flag
    this.inFrame = false; // $5204 bit 6 read: in-frame flag
    this.irqCounter = 0; // Internal scanline counter

    // Hardware multiplier: $5205/$5206
    // Write two 8-bit unsigned values, read 16-bit product immediately.
    // Wiki doesn't specify power-on default; FCEUX uses 0. Using 0 as safe default.
    this.multA = 0;
    this.multB = 0;

    // Split screen: $5200-$5202
    // Not commonly used. Basic support for register storage.
    this.splitEnabled = false; // $5200 bit 7
    this.splitRight = false; // $5200 bit 6 (0=left, 1=right)
    this.splitTile = 0; // $5200 bits 0-4: tile threshold
    this.splitScroll = 0; // $5201: vertical scroll for split
    this.splitPage = 0; // $5202: 4K CHR page for split

    // Expansion audio: two pulse channels + PCM
    // The MMC5 pulse channels are similar to APU square channels but lack
    // sweep units and don't silence at low frequencies.
    // See https://www.nesdev.org/wiki/MMC5_audio
    this.pulse1 = this._initPulse();
    this.pulse2 = this._initPulse();
    this.pcmValue = 0; // $5011: raw 8-bit PCM output
    this.pcmReadMode = false; // $5010 bit 0
    this.pcmIrqEnabled = false; // $5010 bit 7
    this.audioEnabled = 0; // $5015: pulse channel enable bits

    // Tracks which CHR bank set is currently loaded into the PPU's pattern
    // table cache. Used by onBgRender/onSpriteRender to avoid redundant
    // bank switches. -1 = unknown/dirty, 0 = set A (sprites), 1 = set B (BG).
    this._chrBankTarget = -1;
  }

  // Initialize a pulse channel state object.
  // MMC5 pulse channels are like APU square channels minus the sweep unit.
  _initPulse() {
    return {
      enabled: false,
      dutyCycle: 0, // 2-bit duty
      lengthHalt: false, // envelope loop / length counter halt
      constantVolume: false,
      volume: 0, // 4-bit volume/envelope
      timer: 0, // 11-bit timer period
      timerCounter: 0,
      lengthCounter: 0,
      envelopeCounter: 0,
      envelopeDecay: 15,
      envelopeStart: false,
      sequencePos: 0,
    };
  }

  // --- CPU Read Handler ---
  // Override load() to handle MMC5 register reads and banked PRG access.
  load(address) {
    address &= 0xffff;

    if (address < 0x5000) {
      // Standard read (RAM, PPU regs, APU regs, controllers)
      return super.load(address);
    }

    // $5000-$5017: Expansion audio read-back
    if (address === 0x5015) {
      // Status register: bits 0-1 indicate pulse channel length counter > 0
      let val = 0;
      if (this.pulse1.lengthCounter > 0) val |= 0x01;
      if (this.pulse2.lengthCounter > 0) val |= 0x02;
      return val;
    }

    if (address === 0x5010) {
      // PCM IRQ status (bit 7). Reading clears the flag.
      // PCM IRQ is rarely used; return 0 for now.
      return 0;
    }

    // $5100-$5104: Write-only control registers \u2014 return open bus
    if (address >= 0x5100 && address <= 0x5104) {
      return this.nes.cpu.dataBus;
    }

    // $5105: Nametable mapping (write-only, open bus on read)
    if (address === 0x5105) {
      return this.nes.cpu.dataBus;
    }

    // $5204: Scanline IRQ status
    if (address === 0x5204) {
      // The in-frame flag reflects whether the PPU is actively rendering.
      // Since the PPU only calls clockIrqCounter during rendering, we check
      // the current PPU state to determine in-frame for reads outside rendering.
      let ppu = this.nes.ppu;
      let rendering =
        ppu.scanline >= 20 &&
        ppu.scanline <= 260 &&
        (ppu.f_bgVisibility === 1 || ppu.f_spVisibility === 1);
      if (!rendering) {
        this.inFrame = false;
      }

      let val = 0;
      if (this.irqPending) val |= 0x80;
      if (this.inFrame) val |= 0x40;
      // Reading $5204 acknowledges (clears) the IRQ pending flag
      this.irqPending = false;
      return val;
    }

    // $5205: Multiplier result low byte
    if (address === 0x5205) {
      return (this.multA * this.multB) & 0xff;
    }

    // $5206: Multiplier result high byte
    if (address === 0x5206) {
      return ((this.multA * this.multB) >> 8) & 0xff;
    }

    // $5C00-$5FFF: ExRAM
    if (address >= 0x5c00 && address <= 0x5fff) {
      // Readable in modes 2 and 3 only; otherwise open bus
      if (this.exramMode >= 2) {
        return this.exram[address - 0x5c00];
      }
      return this.nes.cpu.dataBus;
    }

    // $5000-$5BFF other: expansion area, return open bus
    if (address < 0x6000) {
      return this.nes.cpu.dataBus;
    }

    // $6000-$7FFF: PRG RAM (banked via $5113)
    if (address < 0x8000) {
      let bank = this.prgBankReg[0] & 0x07; // 3-bit page within 64K RAM
      let offset = bank * 0x2000 + (address - 0x6000);
      return this.prgRam[offset & 0xffff];
    }

    // $8000-$FFFF: PRG ROM/RAM (banked via $5114-$5117 and prgMode)
    return this._readPrg(address);
  }

  // Read from banked PRG space ($8000-$FFFF).
  // In modes where a region can map to RAM (bit 7 of bank reg = 0),
  // reads come from prgRam. Otherwise, reads come from ROM.
  _readPrg(address) {
    let slot, reg, isRam, bank, base;

    switch (this.prgMode) {
      case 0:
        // Mode 0: One 32K bank at $8000-$FFFF, controlled by $5117
        // Ignore low 2 bits for 32K alignment
        reg = this.prgBankReg[4];
        bank = (reg & 0x7c) >> 2; // 32K page = bits 6-2
        return this._readPrgRom32k(bank, address - 0x8000);

      case 1:
        // Mode 1: Two 16K banks
        // $8000-$BFFF: $5115 (can be RAM if bit 7=0)
        // $C000-$FFFF: $5117 (always ROM)
        if (address < 0xc000) {
          reg = this.prgBankReg[2]; // $5115
          isRam = (reg & 0x80) === 0;
          if (isRam) {
            bank = (reg & 0x06) >> 1; // 16K RAM page
            return this.prgRam[bank * 0x4000 + (address - 0x8000)];
          }
          bank = (reg & 0x7e) >> 1; // 16K ROM page (ignore bit 0)
          return this._readPrgRom16k(bank, address - 0x8000);
        } else {
          reg = this.prgBankReg[4]; // $5117
          bank = (reg & 0x7e) >> 1; // 16K ROM page
          return this._readPrgRom16k(bank, address - 0xc000);
        }

      case 2:
        // Mode 2: 16K + 8K + 8K
        // $8000-$BFFF: $5115 (RAM or ROM)
        // $C000-$DFFF: $5116 (RAM or ROM)
        // $E000-$FFFF: $5117 (always ROM)
        if (address < 0xc000) {
          reg = this.prgBankReg[2]; // $5115
          isRam = (reg & 0x80) === 0;
          if (isRam) {
            bank = (reg & 0x06) >> 1;
            return this.prgRam[bank * 0x4000 + (address - 0x8000)];
          }
          bank = (reg & 0x7e) >> 1;
          return this._readPrgRom16k(bank, address - 0x8000);
        } else if (address < 0xe000) {
          reg = this.prgBankReg[3]; // $5116
          isRam = (reg & 0x80) === 0;
          if (isRam) {
            bank = reg & 0x07;
            return this.prgRam[bank * 0x2000 + (address - 0xc000)];
          }
          bank = reg & 0x7f;
          return this._readPrgRom8k(bank, address - 0xc000);
        } else {
          reg = this.prgBankReg[4]; // $5117
          bank = reg & 0x7f;
          return this._readPrgRom8k(bank, address - 0xe000);
        }

      case 3:
      default:
        // Mode 3: Four 8K banks
        // $8000-$9FFF: $5114 (RAM or ROM)
        // $A000-$BFFF: $5115 (RAM or ROM)
        // $C000-$DFFF: $5116 (RAM or ROM)
        // $E000-$FFFF: $5117 (always ROM)
        if (address < 0xa000) {
          slot = 1; // $5114
        } else if (address < 0xc000) {
          slot = 2; // $5115
        } else if (address < 0xe000) {
          slot = 3; // $5116
        } else {
          slot = 4; // $5117
        }
        reg = this.prgBankReg[slot];
        base =
          slot === 1
            ? 0x8000
            : slot === 2
              ? 0xa000
              : slot === 3
                ? 0xc000
                : 0xe000;
        // $5117 is always ROM; $5114-$5116 use bit 7 for RAM/ROM select
        if (slot < 4 && (reg & 0x80) === 0) {
          bank = reg & 0x07;
          return this.prgRam[bank * 0x2000 + (address - base)];
        }
        bank = reg & 0x7f;
        return this._readPrgRom8k(bank, address - base);
    }
  }

  // Read a byte from PRG ROM given a 32K bank number and offset within it.
  _readPrgRom32k(bank32k, offset) {
    // ROM is stored as 16K banks in rom.rom[]
    let bank16k =
      (bank32k * 2 + Math.floor(offset / 0x4000)) % this.nes.rom.romCount;
    let innerOffset = offset % 0x4000;
    return this.nes.rom.rom[bank16k][innerOffset];
  }

  // Read a byte from PRG ROM given a 16K bank number and offset within it.
  _readPrgRom16k(bank16k, offset) {
    bank16k %= this.nes.rom.romCount;
    return this.nes.rom.rom[bank16k][offset];
  }

  // Read a byte from PRG ROM given an 8K bank number and offset within it.
  _readPrgRom8k(bank8k, offset) {
    let bank16k = Math.floor(bank8k / 2) % this.nes.rom.romCount;
    let innerOffset = (bank8k % 2) * 0x2000 + offset;
    if (bank16k < this.nes.rom.romCount) {
      return this.nes.rom.rom[bank16k][innerOffset];
    }
    return 0;
  }

  // --- CPU Write Handler ---
  write(address, value) {
    // Standard NES write handling for addresses below $5000
    if (address < 0x5000) {
      super.write(address, value);

      // MMC5 monitors writes to $2000 to track 8x8 vs 8x16 sprite mode.
      // This affects which CHR bank set is used for rendering.
      // The PPU already parses $2000, so we just note it here.
      return;
    }

    // $5000-$5015: Expansion audio registers
    if (address >= 0x5000 && address <= 0x5003) {
      this._writePulse(this.pulse1, address - 0x5000, value);
      return;
    }
    if (address >= 0x5004 && address <= 0x5007) {
      this._writePulse(this.pulse2, address - 0x5004, value);
      return;
    }
    if (address === 0x5010) {
      this.pcmReadMode = (value & 0x01) !== 0;
      this.pcmIrqEnabled = (value & 0x80) !== 0;
      return;
    }
    if (address === 0x5011) {
      // Raw PCM write. Writing $00 has no effect on the output.
      if (!this.pcmReadMode && value !== 0) {
        this.pcmValue = value;
      }
      return;
    }
    if (address === 0x5015) {
      // Expansion audio status: bits 0-1 enable pulse channels
      this.audioEnabled = value & 0x03;
      this.pulse1.enabled = (value & 0x01) !== 0;
      this.pulse2.enabled = (value & 0x02) !== 0;
      if (!this.pulse1.enabled) this.pulse1.lengthCounter = 0;
      if (!this.pulse2.enabled) this.pulse2.lengthCounter = 0;
      return;
    }

    // $5100: PRG banking mode
    if (address === 0x5100) {
      this.prgMode = value & 0x03;
      this._syncPrg();
      return;
    }

    // $5101: CHR banking mode
    if (address === 0x5101) {
      this.chrMode = value & 0x03;
      this._syncChr();
      return;
    }

    // $5102/$5103: PRG RAM write protection
    if (address === 0x5102) {
      this.prgRamProtectA = value & 0x03;
      return;
    }
    if (address === 0x5103) {
      this.prgRamProtectB = value & 0x03;
      return;
    }

    // $5104: ExRAM mode
    if (address === 0x5104) {
      this.exramMode = value & 0x03;
      // ExRAM mode 1 enables per-tile BG override: each ExRAM byte provides
      // a 4KB CHR bank + attribute for the corresponding background tile.
      this.bgTileOverride = this.exramMode === 1;
      this._syncNametables();
      return;
    }

    // $5105: Nametable mapping
    if (address === 0x5105) {
      let v = value;
      this.ntMapping[0] = v & 0x03;
      v >>= 2;
      this.ntMapping[1] = v & 0x03;
      v >>= 2;
      this.ntMapping[2] = v & 0x03;
      v >>= 2;
      this.ntMapping[3] = v & 0x03;
      this._syncNametables();
      return;
    }

    // $5106: Fill-mode tile
    if (address === 0x5106) {
      this.fillTile = value;
      this._syncNametables();
      return;
    }

    // $5107: Fill-mode attribute (bottom 2 bits)
    if (address === 0x5107) {
      this.fillAttr = value & 0x03;
      this._syncNametables();
      return;
    }

    // $5113: PRG RAM bank for $6000-$7FFF
    if (address === 0x5113) {
      this.prgBankReg[0] = value & 0x07;
      return;
    }

    // $5114-$5117: PRG bank registers
    if (address >= 0x5114 && address <= 0x5117) {
      let idx = address - 0x5113; // 1-4
      this.prgBankReg[idx] = value;
      this._syncPrg();
      return;
    }

    // $5120-$5127: CHR bank set A (sprites / "last written" set)
    if (address >= 0x5120 && address <= 0x5127) {
      let reg = address - 0x5120;
      this.chrBankA[reg] = (this.chrUpperBits << 8) | value;
      this.lastChrWrite = 0;
      this._syncChr();
      return;
    }

    // $5128-$512B: CHR bank set B (background)
    if (address >= 0x5128 && address <= 0x512b) {
      let reg = address - 0x5128;
      this.chrBankB[reg] = (this.chrUpperBits << 8) | value;
      this.lastChrWrite = 1;
      this._syncChr();
      return;
    }

    // $5130: Upper CHR bank bits
    if (address === 0x5130) {
      this.chrUpperBits = value & 0x03;
      return;
    }

    // $5200: Split screen control
    if (address === 0x5200) {
      this.splitEnabled = (value & 0x80) !== 0;
      this.splitRight = (value & 0x40) !== 0;
      this.splitTile = value & 0x1f;
      return;
    }

    // $5201: Split screen Y scroll
    if (address === 0x5201) {
      this.splitScroll = value;
      return;
    }

    // $5202: Split screen CHR page
    if (address === 0x5202) {
      this.splitPage = value & 0x3f;
      return;
    }

    // $5203: Scanline IRQ target
    if (address === 0x5203) {
      this.irqTarget = value;
      return;
    }

    // $5204: Scanline IRQ enable
    if (address === 0x5204) {
      this.irqEnabled = (value & 0x80) !== 0;
      // If both enabled and pending, fire IRQ immediately
      if (this.irqEnabled && this.irqPending) {
        this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
      }
      return;
    }

    // $5205: Multiplier operand A
    if (address === 0x5205) {
      this.multA = value;
      return;
    }

    // $5206: Multiplier operand B
    if (address === 0x5206) {
      this.multB = value;
      return;
    }

    // $5C00-$5FFF: ExRAM writes
    if (address >= 0x5c00 && address <= 0x5fff) {
      let exAddr = address - 0x5c00;
      if (this.exramMode === 0 || this.exramMode === 1) {
        // Modes 0/1: writable only during rendering (in-frame).
        // If not in-frame, $00 is written instead.
        this.exram[exAddr] = this.inFrame ? value : 0x00;
        // If ExRAM is used as a nametable, sync it to VRAM
        this._syncExramToVram(exAddr);
      } else if (this.exramMode === 2) {
        // Mode 2: general-purpose RAM, always writable
        this.exram[exAddr] = value;
      }
      // Mode 3: read-only, writes have no effect
      return;
    }

    // $6000-$7FFF: PRG RAM writes (write-protected via $5102/$5103)
    if (address >= 0x6000 && address <= 0x7fff) {
      if (this.prgRamProtectA === 0x02 && this.prgRamProtectB === 0x01) {
        let bank = this.prgBankReg[0] & 0x07;
        let offset = bank * 0x2000 + (address - 0x6000);
        this.prgRam[offset & 0xffff] = value;
        // Also write to CPU mem for compatibility with save state / battery RAM
        this.nes.cpu.mem[address] = value;
        this.nes.opts.onBatteryRamWrite(address, value);
      }
      return;
    }

    // $8000-$FFFF: PRG ROM/RAM writes
    if (address >= 0x8000) {
      this._writePrg(address, value);
      return;
    }
  }

  // Handle writes to the PRG address space ($8000-$FFFF).
  // Some bank slots may be mapped to RAM if bit 7 of the bank register is 0.
  _writePrg(address, value) {
    let slot, reg, isRam, bank, base;

    switch (this.prgMode) {
      case 0:
        // Mode 0: Entire $8000-$FFFF is a single 32K ROM bank \u2014 not writable
        return;

      case 1:
        // $8000-$BFFF: $5115 (can be RAM)
        // $C000-$FFFF: $5117 (always ROM)
        if (address < 0xc000) {
          reg = this.prgBankReg[2];
          isRam = (reg & 0x80) === 0;
          if (isRam && this._isPrgRamWritable()) {
            bank = (reg & 0x06) >> 1;
            this.prgRam[bank * 0x4000 + (address - 0x8000)] = value;
          }
        }
        return;

      case 2:
        // $8000-$BFFF: $5115 (can be RAM)
        // $C000-$DFFF: $5116 (can be RAM)
        // $E000-$FFFF: $5117 (always ROM)
        if (address < 0xc000) {
          reg = this.prgBankReg[2];
          isRam = (reg & 0x80) === 0;
          if (isRam && this._isPrgRamWritable()) {
            bank = (reg & 0x06) >> 1;
            this.prgRam[bank * 0x4000 + (address - 0x8000)] = value;
          }
        } else if (address < 0xe000) {
          reg = this.prgBankReg[3];
          isRam = (reg & 0x80) === 0;
          if (isRam && this._isPrgRamWritable()) {
            bank = reg & 0x07;
            this.prgRam[bank * 0x2000 + (address - 0xc000)] = value;
          }
        }
        return;

      case 3:
      default:
        // $8000-$9FFF: $5114 (can be RAM)
        // $A000-$BFFF: $5115 (can be RAM)
        // $C000-$DFFF: $5116 (can be RAM)
        // $E000-$FFFF: $5117 (always ROM)
        if (address < 0xa000) {
          slot = 1;
          base = 0x8000;
        } else if (address < 0xc000) {
          slot = 2;
          base = 0xa000;
        } else if (address < 0xe000) {
          slot = 3;
          base = 0xc000;
        } else {
          return; // $5117 is always ROM
        }
        reg = this.prgBankReg[slot];
        isRam = (reg & 0x80) === 0;
        if (isRam && this._isPrgRamWritable()) {
          bank = reg & 0x07;
          this.prgRam[bank * 0x2000 + (address - base)] = value;
        }
        return;
    }
  }

  // Check if PRG RAM writes are enabled via the two protection registers.
  _isPrgRamWritable() {
    return this.prgRamProtectA === 0x02 && this.prgRamProtectB === 0x01;
  }

  // --- PRG Synchronization ---
  // Copy the selected PRG ROM banks into CPU address space so the CPU can
  // read them directly. This follows the same approach as other mappers.
  // Called when prgMode or bank registers change.
  _syncPrg() {
    switch (this.prgMode) {
      case 0: {
        // 32K bank at $8000-$FFFF from $5117
        let reg = this.prgBankReg[4];
        let bank = (reg & 0x7c) >> 2; // 32K page
        this.load32kRomBank(bank, 0x8000);
        break;
      }
      case 1: {
        // $8000-$BFFF from $5115, $C000-$FFFF from $5117
        let regLo = this.prgBankReg[2]; // $5115
        if (regLo & 0x80) {
          // ROM
          let bank16k = (regLo & 0x7e) >> 1;
          this.loadRomBank(bank16k % this.nes.rom.romCount, 0x8000);
        }
        // else: RAM \u2014 reads will be handled by load() override

        let regHi = this.prgBankReg[4]; // $5117
        let bank16kHi = (regHi & 0x7e) >> 1;
        this.loadRomBank(bank16kHi % this.nes.rom.romCount, 0xc000);
        break;
      }
      case 2: {
        // $8000-$BFFF from $5115, $C000-$DFFF from $5116, $E000-$FFFF from $5117
        let regA = this.prgBankReg[2]; // $5115
        if (regA & 0x80) {
          let bank16k = (regA & 0x7e) >> 1;
          this.loadRomBank(bank16k % this.nes.rom.romCount, 0x8000);
        }

        let regB = this.prgBankReg[3]; // $5116
        if (regB & 0x80) {
          this.load8kRomBank(regB & 0x7f, 0xc000);
        }

        let regC = this.prgBankReg[4]; // $5117
        this.load8kRomBank(regC & 0x7f, 0xe000);
        break;
      }
      case 3:
      default: {
        // Four 8K banks from $5114-$5117
        for (let i = 1; i <= 4; i++) {
          let reg = this.prgBankReg[i];
          let addr = 0x6000 + i * 0x2000; // $8000, $A000, $C000, $E000
          // $5117 (i=4) is always ROM; $5114-$5116 check bit 7
          if (i === 4 || reg & 0x80) {
            this.load8kRomBank(reg & 0x7f, addr);
          }
          // RAM banks are handled dynamically in load()
        }
        break;
      }
    }
  }

  // --- CHR Synchronization ---
  // Apply the current CHR bank registers to PPU pattern table memory.
  // See https://www.nesdev.org/wiki/MMC5#CHR_banking
  _syncChr() {
    // Trigger rendering before changing banks, so any accumulated scanlines
    // are drawn with the OLD CHR bank values. This is important for mid-frame
    // bank switches (e.g. via scanline IRQ handlers that change CHR registers
    // before writing to PPU scroll registers).
    this.nes.ppu.triggerRendering();

    // Invalidate cached CHR bank target so the render hooks re-apply
    // when rendering starts.
    this._chrBankTarget = -1;

    if (this.nes.ppu.f_spriteSize === 0) {
      // 8x8 sprite mode: only bank set A is used for ALL fetches (sprites,
      // backgrounds, and $2007 reads). Bank set B is completely ignored.
      // This was confirmed by hardware tests \u2014 see FCEUX bug #787.
      this._applyChrSetA();
      this._chrBankTarget = 0;
    }
    // In 8x16 sprite mode, the onBgRender/onSpriteRender hooks handle
    // switching between set A (sprites) and set B (backgrounds) during
    // rendering. Outside rendering (VBlank), $2007 reads use whichever
    // set was last loaded by the hooks \u2014 this is an acceptable simplification
    // since we can't call load*VromBank here (it triggers triggerRendering).
  }

  // Apply CHR bank set A ($5120-$5127) based on chrMode.
  _applyChrSetA() {
    if (this.nes.rom.vromCount === 0) return;

    switch (this.chrMode) {
      case 0:
        // 8K mode: $5127 selects an 8K page
        this.load8kVromBank((this.chrBankA[7] & 0xff) * 2, 0x0000);
        break;
      case 1:
        // 4K mode: $5123 selects 4K at $0000, $5127 selects 4K at $1000
        this.loadVromBank(this.chrBankA[3] & 0xff, 0x0000);
        this.loadVromBank(this.chrBankA[7] & 0xff, 0x1000);
        break;
      case 2:
        // 2K mode: $5121/$5123/$5125/$5127 each select 2K
        this.load2kVromBank(this.chrBankA[1] & 0x1ff, 0x0000);
        this.load2kVromBank(this.chrBankA[3] & 0x1ff, 0x0800);
        this.load2kVromBank(this.chrBankA[5] & 0x1ff, 0x1000);
        this.load2kVromBank(this.chrBankA[7] & 0x1ff, 0x1800);
        break;
      case 3:
      default:
        // 1K mode: $5120-$5127 each select a 1K page
        for (let i = 0; i < 8; i++) {
          this.load1kVromBank(this.chrBankA[i] & 0x3ff, i * 0x0400);
        }
        break;
    }
  }

  // Apply CHR bank set B ($5128-$512B) based on chrMode.
  // Set B uses only 4 registers, so larger modes replicate them.
  _applyChrSetB() {
    if (this.nes.rom.vromCount === 0) return;

    switch (this.chrMode) {
      case 0:
        // 8K mode: $512B selects an 8K page
        this.load8kVromBank((this.chrBankB[3] & 0xff) * 2, 0x0000);
        break;
      case 1:
        // 4K mode: $512B selects 4K at both halves
        this.loadVromBank(this.chrBankB[3] & 0xff, 0x0000);
        this.loadVromBank(this.chrBankB[3] & 0xff, 0x1000);
        break;
      case 2:
        // 2K mode: $5129/$512B each select 2K, replicated across 8K
        this.load2kVromBank(this.chrBankB[1] & 0x1ff, 0x0000);
        this.load2kVromBank(this.chrBankB[3] & 0x1ff, 0x0800);
        this.load2kVromBank(this.chrBankB[1] & 0x1ff, 0x1000);
        this.load2kVromBank(this.chrBankB[3] & 0x1ff, 0x1800);
        break;
      case 3:
      default:
        // 1K mode: $5128-$512B each select 1K, replicated for both halves
        for (let i = 0; i < 4; i++) {
          this.load1kVromBank(this.chrBankB[i] & 0x3ff, i * 0x0400);
          this.load1kVromBank(this.chrBankB[i] & 0x3ff, (i + 4) * 0x0400);
        }
        break;
    }
  }

  // --- Nametable Synchronization ---
  // Configure the PPU's vramMirrorTable AND internal NameTable objects to
  // reflect the MMC5's nametable mapping. Each of the 4 nametable slots
  // ($2000/$2400/$2800/$2C00) can be mapped to:
  //   0: NES CIRAM page A ($2000)
  //   1: NES CIRAM page B ($2400)
  //   2: ExRAM (internal 1KB, stored at $2800 in VRAM)
  //   3: Fill mode (stored at $2C00 in VRAM)
  //
  // IMPORTANT: The PPU uses TWO parallel data structures for nametables:
  //   1. vramMem[] + vramMirrorTable[] \u2014 raw bytes, for $2007 VRAM reads
  //   2. nameTable[0-3] + ntable1[0-3] \u2014 parsed tile/attrib, for rendering
  // We must update BOTH so the renderer sees the correct nametable data.
  // See https://www.nesdev.org/wiki/MMC5#Nametable_mapping
  _syncNametables() {
    let ppu = this.nes.ppu;

    // First, populate the fill-mode nametable at VRAM $2C00.
    // 960 bytes of tile index followed by 64 bytes of attribute.
    // The attribute byte packs the fill palette into all four sub-quadrants.
    let fillAttrByte =
      this.fillAttr |
      (this.fillAttr << 2) |
      (this.fillAttr << 4) |
      (this.fillAttr << 6);
    for (let i = 0; i < 960; i++) {
      ppu.vramMem[0x2c00 + i] = this.fillTile;
    }
    for (let i = 960; i < 1024; i++) {
      ppu.vramMem[0x2c00 + i] = fillAttrByte;
    }

    // Copy ExRAM into VRAM at $2800 for nametable use.
    // In modes 2/3 (general-purpose RAM), ExRAM reads as all zeros for nametable.
    if (this.exramMode >= 2) {
      for (let i = 0; i < 0x400; i++) {
        ppu.vramMem[0x2800 + i] = 0;
      }
    } else {
      copyArrayElements(this.exram, 0, ppu.vramMem, 0x2800, 0x400);
    }

    // Physical VRAM locations for each source:
    //   0 \u2192 $2000 (CIRAM A)
    //   1 \u2192 $2400 (CIRAM B)
    //   2 \u2192 $2800 (ExRAM copy)
    //   3 \u2192 $2C00 (Fill mode)
    const sourceBase = [0x2000, 0x2400, 0x2800, 0x2c00];

    for (let nt = 0; nt < 4; nt++) {
      let logicalBase = 0x2000 + nt * 0x400;
      let physBase = sourceBase[this.ntMapping[nt]];
      ppu.defineMirrorRegion(logicalBase, physBase, 0x400);
    }

    // Also mirror $3000-$3EFF \u2192 $2000-$2EFF as per normal NES behavior
    ppu.defineMirrorRegion(0x3000, 0x2000, 0xf00);

    // Update ntable1 so the renderer reads from the correct NameTable objects.
    // ntMapping values 0-3 map directly to NameTable indices 0-3:
    //   0 \u2192 NameTable 0 (CIRAM A, VRAM $2000)
    //   1 \u2192 NameTable 1 (CIRAM B, VRAM $2400)
    //   2 \u2192 NameTable 2 (ExRAM, VRAM $2800)
    //   3 \u2192 NameTable 3 (Fill, VRAM $2C00)
    for (let nt = 0; nt < 4; nt++) {
      ppu.ntable1[nt] = this.ntMapping[nt];
    }

    // Populate NameTable 2 with ExRAM data so the renderer can see it.
    // The PPU renderer reads from nameTable[].tile[] and nameTable[].attrib[],
    // NOT from vramMem directly, so we must sync both.
    this._populateNameTable(2, 0x2800);

    // Populate NameTable 3 with fill-mode data.
    this._populateNameTable(3, 0x2c00);
  }

  // Populate a NameTable object from a 1KB region of vramMem.
  // The first 960 bytes are tile indices, the next 64 are attribute table bytes.
  _populateNameTable(ntIndex, vramBase) {
    let ppu = this.nes.ppu;
    let nt = ppu.nameTable[ntIndex];

    // Copy tile indices (960 bytes = 30 rows \xD7 32 columns)
    for (let i = 0; i < 960; i++) {
      nt.tile[i] = ppu.vramMem[vramBase + i];
    }

    // Decode attribute table (64 bytes) into per-tile attributes.
    // Each attribute byte controls a 4\xD74 tile area (32\xD732 pixels).
    for (let i = 0; i < 64; i++) {
      nt.writeAttrib(i, ppu.vramMem[vramBase + 960 + i]);
    }
  }

  // Sync a single ExRAM byte to both the VRAM copy at $2800 and NameTable 2.
  // Called when ExRAM is written via $5C00-$5FFF in modes 0/1.
  _syncExramToVram(exAddr) {
    if (this.exramMode < 2) {
      let ppu = this.nes.ppu;
      ppu.vramMem[0x2800 + exAddr] = this.exram[exAddr];

      // Also update NameTable 2 so the renderer sees the change.
      if (exAddr < 960) {
        // Tile index update
        ppu.nameTable[2].tile[exAddr] = this.exram[exAddr];
      } else if (exAddr < 1024) {
        // Attribute table update \u2014 decode into per-tile attributes
        ppu.nameTable[2].writeAttrib(exAddr - 960, this.exram[exAddr]);
      }
    }
  }

  // --- Expansion Audio ---
  // Write to a pulse channel register. Layout matches the NES APU square channels
  // ($4000-$4003) except that $5001/$5005 (sweep) has no effect on MMC5 pulses.
  _writePulse(pulse, reg, value) {
    switch (reg) {
      case 0:
        // $5000/$5004: Duty, length counter halt, constant volume, volume/envelope
        pulse.dutyCycle = (value >> 6) & 0x03;
        pulse.lengthHalt = (value & 0x20) !== 0;
        pulse.constantVolume = (value & 0x10) !== 0;
        pulse.volume = value & 0x0f;
        break;
      case 1:
        // $5001/$5005: Sweep \u2014 no effect on MMC5 pulse channels
        break;
      case 2:
        // $5002/$5006: Timer low 8 bits
        pulse.timer = (pulse.timer & 0x700) | value;
        break;
      case 3:
        // $5003/$5007: Length counter load, timer high 3 bits
        pulse.timer = (pulse.timer & 0x0ff) | ((value & 0x07) << 8);
        if (pulse.enabled) {
          pulse.lengthCounter = this.nes.papu.getLengthMax(value);
        }
        pulse.envelopeStart = true;
        pulse.sequencePos = 0;
        break;
    }
  }

  // --- Scanline IRQ Counter ---
  // Called by the PPU once per scanline when BG or sprites are enabled.
  // The PPU calls this at scanline 20 (pre-render) and scanlines 21-260 (visible).
  // The MMC5 uses an up-counter that resets when entering rendering and increments
  // each scanline, firing an IRQ when it matches the target value in $5203.
  // See https://www.nesdev.org/wiki/MMC5#Scanline_detection_and_scanline_IRQ
  clockIrqCounter() {
    let scanline = this.nes.ppu.scanline;

    if (scanline === 20) {
      // Pre-render scanline: entering active rendering.
      // Set in-frame and reset the scanline counter.
      this.inFrame = true;
      this.irqCounter = 0;
      return;
    }

    // Visible scanlines (21-260): increment counter and compare.
    this.irqCounter++;
    // $5203 value of 0 is a special case that never matches.
    if (this.irqTarget !== 0 && this.irqCounter === this.irqTarget) {
      this.irqPending = true;
      if (this.irqEnabled) {
        this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
      }
    }

    // Clock expansion audio length counters once per scanline.
    // The MMC5 has no frame sequencer; length counters run at a fixed rate
    // tied to scanline timing. We approximate by clocking every 4 scanlines
    // (~240 Hz, matching the APU frame counter quarter-frame rate).
    // See https://www.nesdev.org/wiki/MMC5_audio
    if ((this.irqCounter & 3) === 0) {
      this._clockPulseLengthCounter(this.pulse1);
      this._clockPulseLengthCounter(this.pulse2);
    }
  }

  // Decrement a pulse channel's length counter if it's active and not halted.
  _clockPulseLengthCounter(pulse) {
    if (pulse.enabled && !pulse.lengthHalt && pulse.lengthCounter > 0) {
      pulse.lengthCounter--;
    }
  }

  // --- CHR Bank Switching for Sprite/BG Phases ---
  // The MMC5 uses dual CHR bank sets in 8x16 sprite mode ($2000 bit 5 = 1):
  //   - Bank set A ($5120-$5127) is used for sprite pattern fetches
  //   - Bank set B ($5128-$512B) is used for background pattern fetches
  // In 8x8 sprite mode, only bank set A is used for all fetches.
  // The PPU calls these hooks before each rendering phase so we can swap
  // the pattern table data in the ptTile cache.
  // See https://www.nesdev.org/wiki/MMC5#CHR_banking

  onBgRender() {
    if (this.nes.ppu.f_spriteSize === 1 && this._chrBankTarget !== 1) {
      this._applyChrSetB();
      this._chrBankTarget = 1;
      // Invalidate the PPU's tile cache since we swapped CHR data
      this.nes.ppu.validTileData = false;
    }
  }

  onSpriteRender() {
    if (this.nes.ppu.f_spriteSize === 1 && this._chrBankTarget !== 0) {
      this._applyChrSetA();
      this._chrBankTarget = 0;
    }
  }

  // Look up a sprite pattern tile from Set A's VROM banks directly.
  // In 8x16 mode, ptTile may have BG data (Set B) during BG rendering,
  // but sprite 0 hit detection needs Set A data. This method reads from
  // the pre-decoded VROM tile cache without modifying ptTile or calling
  // load*VromBank (which would trigger triggerRendering).
  // In 8x8 mode, ptTile already has Set A data from _syncChr(), so we
  // just return from ptTile directly.
  // See FCEUX's mmc5_PPURead() which uses separate MMC5SPRVPage/MMC5BGVPage
  // arrays instead of copying banks back and forth.
  getSpritePatternTile(index) {
    // In 8x8 mode, ptTile has the correct Set A data already
    if (this.nes.ppu.f_spriteSize !== 1 || this.nes.rom.vromCount === 0) {
      return this.nes.ppu.ptTile[index];
    }

    // In 8x16 mode, look up the tile from Set A's VROM banks.
    // The index maps to a slot in the 8KB pattern table space:
    //   index 0-255 \u2192 $0000-$0FFF, index 256-511 \u2192 $1000-$1FFF
    let vromCount = this.nes.rom.vromCount;
    let vromTile = this.nes.rom.vromTile;

    switch (this.chrMode) {
      case 0: {
        // 8K mode: chrBankA[7] selects an 8K page (two 4K banks)
        let bank4kStart = (this.chrBankA[7] & 0xff) * 2;
        let half = index >= 256 ? 1 : 0;
        let bank4k = (bank4kStart + half) % vromCount;
        return vromTile[bank4k][index - half * 256];
      }
      case 1: {
        // 4K mode: chrBankA[3] \u2192 $0000, chrBankA[7] \u2192 $1000
        let bank4k;
        if (index < 256) {
          bank4k = (this.chrBankA[3] & 0xff) % vromCount;
        } else {
          bank4k = (this.chrBankA[7] & 0xff) % vromCount;
        }
        return vromTile[bank4k][index % 256];
      }
      case 2: {
        // 2K mode: chrBankA[1]/[3]/[5]/[7] select four 2K chunks (128 tiles each)
        let regIndex = [1, 3, 5, 7];
        let slot = index >> 7; // 0-3
        let tileInSlot = index & 127;
        let bank2k = this.chrBankA[regIndex[slot]] & 0x1ff;
        let bank4k = Math.floor(bank2k / 2) % vromCount;
        return vromTile[bank4k][((bank2k % 2) << 7) + tileInSlot];
      }
      case 3:
      default: {
        // 1K mode: chrBankA[0-7] each select a 1K chunk (64 tiles each)
        let slot = index >> 6; // 0-7
        let tileInSlot = index & 63;
        let bank1k = this.chrBankA[slot] & 0x3ff;
        let bank4k = Math.floor(bank1k / 4) % vromCount;
        return vromTile[bank4k][((bank1k % 4) << 6) + tileInSlot];
      }
    }
  }

  // ExRAM mode 1 (extended attributes): per-tile CHR bank and palette override.
  // Each byte in ExRAM at $5C00-$5FFF corresponds to a nametable tile position:
  //   Bits 5-0: 4KB CHR bank number (combined with $5130 upper bits)
  //   Bits 7-6: Palette/attribute number for this tile
  // This replaces both the normal CHR bank set B and the attribute table for
  // background tiles, allowing each tile to independently select from up to
  // 16,384 unique background tiles. Used by Castlevania III for detailed BGs.
  // See https://www.nesdev.org/wiki/MMC5#Extended_RAM
  getBgTileData(baseTile, tileIndex, ht, vt) {
    if (this.exramMode !== 1 || this.nes.rom.vromCount === 0) return null;

    // ExRAM byte for this nametable tile position
    let exAddr = vt * 32 + ht;
    let exByte = this.exram[exAddr];

    // Bits 5-0 select a 4KB CHR bank, combined with chrUpperBits ($5130)
    // to form the full bank number: (upper << 6) | (exByte & 0x3F)
    let chrBank4k = (exByte & 0x3f) | (this.chrUpperBits << 6);
    let bank4k = chrBank4k % this.nes.rom.vromCount;

    // Look up the pre-decoded tile from VROM. The tile index (0-255) from
    // the nametable directly indexes into the selected 4KB bank.
    let tile = this.nes.rom.vromTile[bank4k][tileIndex];
    if (!tile) return null;

    // Bits 7-6 provide the attribute (palette number), replacing the
    // normal attribute table. Shift left by 2 to match PPU palette format.
    let attrib = ((exByte >> 6) & 0x03) << 2;

    return { tile, attrib };
  }

  // --- ROM Loading ---
  loadROM() {
    if (!this.nes.rom.valid) {
      throw new Error("MMC5: Invalid ROM! Unable to load.");
    }

    // Default PRG banking: last bank at $E000-$FFFF (mode 3 default)
    this.prgBankReg[4] = 0xff;
    this._syncPrg();

    // Load CHR-ROM if present
    this.loadCHRROM();

    // Load Battery RAM (if present)
    this.loadBatteryRam();

    // Initialize nametable mapping (default to vertical mirroring pattern)
    this._syncNametables();

    // Reset interrupt
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  // --- Save State Support ---
  toJSON() {
    let s = super.toJSON();
    s.prgMode = this.prgMode;
    s.prgBankReg = Array.from(this.prgBankReg);
    s.prgRam = Array.from(this.prgRam);
    s.prgRamProtectA = this.prgRamProtectA;
    s.prgRamProtectB = this.prgRamProtectB;
    s.chrMode = this.chrMode;
    s.chrBankA = Array.from(this.chrBankA);
    s.chrBankB = Array.from(this.chrBankB);
    s.chrUpperBits = this.chrUpperBits;
    s.lastChrWrite = this.lastChrWrite;
    s.ntMapping = Array.from(this.ntMapping);
    s.exramMode = this.exramMode;
    s.exram = Array.from(this.exram);
    s.fillTile = this.fillTile;
    s.fillAttr = this.fillAttr;
    s.irqTarget = this.irqTarget;
    s.irqEnabled = this.irqEnabled;
    s.irqPending = this.irqPending;
    s.inFrame = this.inFrame;
    s.irqCounter = this.irqCounter;
    s.multA = this.multA;
    s.multB = this.multB;
    s.splitEnabled = this.splitEnabled;
    s.splitRight = this.splitRight;
    s.splitTile = this.splitTile;
    s.splitScroll = this.splitScroll;
    s.splitPage = this.splitPage;
    s.pcmValue = this.pcmValue;
    s.pcmReadMode = this.pcmReadMode;
    s.pcmIrqEnabled = this.pcmIrqEnabled;
    s.audioEnabled = this.audioEnabled;
    s.pulse1 = Object.assign({}, this.pulse1);
    s.pulse2 = Object.assign({}, this.pulse2);
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.prgMode = s.prgMode;
    this.prgBankReg = new Uint8Array(s.prgBankReg);
    this.prgRam = new Uint8Array(s.prgRam);
    this.prgRamProtectA = s.prgRamProtectA;
    this.prgRamProtectB = s.prgRamProtectB;
    this.chrMode = s.chrMode;
    this.chrBankA = new Uint16Array(s.chrBankA);
    this.chrBankB = new Uint16Array(s.chrBankB);
    this.chrUpperBits = s.chrUpperBits;
    this.lastChrWrite = s.lastChrWrite;
    this.ntMapping = new Uint8Array(s.ntMapping);
    this.exramMode = s.exramMode;
    this.exram = new Uint8Array(s.exram);
    this.fillTile = s.fillTile;
    this.fillAttr = s.fillAttr;
    this.irqTarget = s.irqTarget;
    this.irqEnabled = s.irqEnabled;
    this.irqPending = s.irqPending;
    this.inFrame = s.inFrame;
    this.irqCounter = s.irqCounter;
    this.multA = s.multA;
    this.multB = s.multB;
    this.splitEnabled = s.splitEnabled;
    this.splitRight = s.splitRight;
    this.splitTile = s.splitTile;
    this.splitScroll = s.splitScroll;
    this.splitPage = s.splitPage;
    this.pcmValue = s.pcmValue;
    this.pcmReadMode = s.pcmReadMode;
    this.pcmIrqEnabled = s.pcmIrqEnabled;
    this.audioEnabled = s.audioEnabled;
    if (s.pulse1) this.pulse1 = Object.assign(this._initPulse(), s.pulse1);
    if (s.pulse2) this.pulse2 = Object.assign(this._initPulse(), s.pulse2);

    // Re-sync banks after loading state
    this._syncPrg();
    this._syncChr();
    this._syncNametables();
  }
}

export default Mapper5;
`, type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/mappers/mapper66.js": { text: 'import Mapper0 from "./mapper0.js";\n\n// GxROM (NES-GNROM, NES-MHROM)\n// Used by games like Doraemon, Dragon Power, Gumshoe, Super Mario Bros. + Duck Hunt.\n// Discrete mapper with 32 KB PRG and 8 KB CHR bank switching via a single register\n// at $8000-$FFFF. Bits 4-5 select PRG bank, bits 0-1 select CHR bank.\n// See https://www.nesdev.org/wiki/GxROM\nclass Mapper66 extends Mapper0 {\n  static mapperName = "GxROM";\n\n  constructor(nes) {\n    super(nes);\n  }\n\n  write(address, value) {\n    if (address < 0x8000) {\n      super.write(address, value);\n      return;\n    } else {\n      // Swap in the given PRG-ROM bank at 0x8000:\n      this.load32kRomBank((value >> 4) & 3, 0x8000);\n\n      // Swap in the given VROM bank at 0x0000:\n      this.load8kVromBank((value & 3) * 2, 0x0000);\n    }\n  }\n}\n\nexport default Mapper66;\n', type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/mappers/mapper7.js": { text: 'import Mapper0 from "./mapper0.js";\n\n// AxROM (NES-AMROM, NES-ANROM, NES-AOROM)\n// Used by games like Battletoads, Marble Madness, Wizards & Warriors.\n// 32 KB switchable PRG-ROM bank (bits 0-2) with single-screen nametable mirroring\n// select (bit 4). Uses CHR-RAM, no CHR bank switching.\n// See https://www.nesdev.org/wiki/AxROM\nclass Mapper7 extends Mapper0 {\n  static mapperName = "AxROM";\n\n  constructor(nes) {\n    super(nes);\n  }\n\n  write(address, value) {\n    // Writes to addresses other than MMC registers are handled by NoMapper.\n    if (address < 0x8000) {\n      super.write(address, value);\n    } else {\n      this.load32kRomBank(value & 0x7, 0x8000);\n      if (value & 0x10) {\n        this.nes.ppu.setMirroring(this.nes.rom.SINGLESCREEN_MIRRORING2);\n      } else {\n        this.nes.ppu.setMirroring(this.nes.rom.SINGLESCREEN_MIRRORING);\n      }\n    }\n  }\n\n  loadROM() {\n    if (!this.nes.rom.valid) {\n      throw new Error("AOROM: Invalid ROM! Unable to load.");\n    }\n\n    // Load PRG-ROM:\n    this.loadPRGROM();\n\n    // Load CHR-ROM:\n    this.loadCHRROM();\n\n    // Do Reset-Interrupt:\n    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);\n  }\n}\n\nexport default Mapper7;\n', type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/mappers/mapper71.js": { text: 'import Mapper0 from "./mapper0.js";\n\n// Camerica/Codemasters mapper (BF9093/BF9097)\n// Used by games like Fire Hawk, Micro Machines, Bee 52, MiG 29, etc.\n// Largely a clone of UxROM with optional 1-screen mirroring control.\n// See https://www.nesdev.org/wiki/INES_Mapper_071\nclass Mapper71 extends Mapper0 {\n  static mapperName = "Camerica";\n\n  constructor(nes) {\n    super(nes);\n  }\n\n  write(address, value) {\n    if (address < 0x8000) {\n      super.write(address, value);\n      return;\n    }\n\n    if (address >= 0x9000 && address < 0xa000) {\n      // $9000-$9FFF: 1-screen mirroring control (Fire Hawk / BF9097 variant)\n      // Bit 4 selects which CIRAM nametable to fill all four screen slots\n      if (value & 0x10) {\n        this.nes.ppu.setMirroring(this.nes.rom.SINGLESCREEN_MIRRORING2);\n      } else {\n        this.nes.ppu.setMirroring(this.nes.rom.SINGLESCREEN_MIRRORING);\n      }\n    } else if (address >= 0xc000) {\n      // $C000-$FFFF: PRG bank select (bits 3-0 select 16 KiB bank at $8000)\n      this.loadRomBank(value & 0x0f, 0x8000);\n    }\n  }\n\n  loadROM() {\n    if (!this.nes.rom.valid) {\n      throw new Error("Mapper 71: Invalid ROM! Unable to load.");\n    }\n\n    // Load first PRG bank at $8000, last at $C000 (fixed)\n    this.loadRomBank(0, 0x8000);\n    this.loadRomBank(this.nes.rom.romCount - 1, 0xc000);\n\n    // Load CHR-ROM (usually CHR-RAM, so this may be a no-op)\n    this.loadCHRROM();\n\n    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);\n  }\n}\n\nexport default Mapper71;\n', type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/mappers/mapper79.js": { text: 'import Mapper0 from "./mapper0.js";\n\n// NINA-03/NINA-06 (American Video Entertainment)\n// Used by games like Tiles of Fate, Krazy Kreatures, Impossible Mission II.\n// GxROM-like mapper with the register in the expansion area ($4100-$5FFF)\n// instead of the cartridge space. Address decode: (addr & $E100) == $4100.\n// Register format: .... PCCC\n//   P (bit 3): selects 32 KB PRG bank\n//   CCC (bits 0-2): selects 8 KB CHR bank\n// See https://www.nesdev.org/wiki/INES_Mapper_079\nclass Mapper79 extends Mapper0 {\n  static mapperName = "NINA-03/NINA-06";\n\n  constructor(nes) {\n    super(nes);\n  }\n\n  write(address, value) {\n    // The NINA register is active at addresses where (address & $E100) == $4100.\n    // This covers $4100-$41FF, $4300-$43FF, $4500-$45FF, ... $5F00-$5FFF.\n    if ((address & 0xe100) === 0x4100) {\n      // Swap 32 KB PRG bank based on bit 3\n      this.load32kRomBank((value >> 3) & 1, 0x8000);\n\n      // Swap 8 KB CHR bank based on bits 0-2\n      this.load8kVromBank((value & 7) * 2, 0x0000);\n    }\n\n    super.write(address, value);\n  }\n}\n\nexport default Mapper79;\n', type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/mappers/mapper9.js": { text: `import Mapper0 from "./mapper0.js";

// MMC2 (PNROM / PEEOROM)
// Used exclusively by Mike Tyson's Punch-Out!! (and Punch-Out!!).
// Features tile-triggered CHR bank switching: two independent 4 KB CHR latches
// automatically swap between two banks when the PPU fetches specific tiles ($FD/$FE).
// PRG: 8 KB switchable at $8000, three 8 KB fixed banks at $A000-$FFFF.
// See https://www.nesdev.org/wiki/MMC2
class Mapper9 extends Mapper0 {
  static mapperName = "MMC2";

  constructor(nes) {
    super(nes);

    // PRG bank register ($A000-$AFFF): selects 8 KB bank at $8000
    this.prgBank = 0;

    // CHR bank registers: each pattern table half has two possible banks,
    // selected by the corresponding latch state ($FD or $FE).
    this.chrBankFD0 = 0; // $B000: CHR bank for $0000 when latch0 = $FD
    this.chrBankFE0 = 0; // $C000: CHR bank for $0000 when latch0 = $FE
    this.chrBankFD1 = 0; // $D000: CHR bank for $1000 when latch1 = $FD
    this.chrBankFE1 = 0; // $E000: CHR bank for $1000 when latch1 = $FE

    // Latch states: $FD or $FE, one per pattern table half.
    // Both initialize to $FE on power-up.
    this.latch0 = 0xfe;
    this.latch1 = 0xfe;
  }

  write(address, value) {
    if (address < 0x8000) {
      super.write(address, value);
      return;
    }

    // Only the top nibble matters for register selection
    switch (address & 0xf000) {
      case 0xa000:
        // $A000-$AFFF: PRG bank select (bits 3-0 select 8 KB bank at $8000)
        this.prgBank = value & 0x0f;
        this.load8kRomBank(this.prgBank, 0x8000);
        break;

      case 0xb000:
        // $B000-$BFFF: CHR bank for $0000 when latch0 = $FD
        this.chrBankFD0 = value & 0x1f;
        this._updateChr0();
        break;

      case 0xc000:
        // $C000-$CFFF: CHR bank for $0000 when latch0 = $FE
        this.chrBankFE0 = value & 0x1f;
        this._updateChr0();
        break;

      case 0xd000:
        // $D000-$DFFF: CHR bank for $1000 when latch1 = $FD
        this.chrBankFD1 = value & 0x1f;
        this._updateChr1();
        break;

      case 0xe000:
        // $E000-$EFFF: CHR bank for $1000 when latch1 = $FE
        this.chrBankFE1 = value & 0x1f;
        this._updateChr1();
        break;

      case 0xf000:
        // $F000-$FFFF: Mirroring (bit 0: 0=vertical, 1=horizontal)
        if (value & 0x01) {
          this.nes.ppu.setMirroring(this.nes.rom.HORIZONTAL_MIRRORING);
        } else {
          this.nes.ppu.setMirroring(this.nes.rom.VERTICAL_MIRRORING);
        }
        break;
    }
  }

  // Load the correct CHR bank into $0000 based on latch0 state.
  _updateChr0() {
    let bank = this.latch0 === 0xfd ? this.chrBankFD0 : this.chrBankFE0;
    this.loadVromBank(bank, 0x0000);
  }

  // Load the correct CHR bank into $1000 based on latch1 state.
  _updateChr1() {
    let bank = this.latch1 === 0xfd ? this.chrBankFD1 : this.chrBankFE1;
    this.loadVromBank(bank, 0x1000);
  }

  // Called by the PPU when pattern table memory is accessed.
  // Updates the CHR latches based on the tile being fetched.
  // The latch switches AFTER the data has been read, so the
  // tile at $FD/$FE itself is rendered with the old bank.
  // See https://www.nesdev.org/wiki/MMC2#Latch_0_($0000-$0FFF)
  latchAccess(address) {
    // Only reload CHR banks when the latch state actually changes.
    // The same trigger tile may appear on many consecutive scanlines (e.g. a
    // column of $FD tiles in the nametable), and redundantly calling
    // loadVromBank on every fetch would copy 4 KB of VRAM each time.
    if (address === 0x0fd8) {
      // Latch 0 triggers on exactly $0FD8
      if (this.latch0 !== 0xfd) {
        this.latch0 = 0xfd;
        this._updateChr0();
      }
    } else if (address === 0x0fe8) {
      // Latch 0 triggers on exactly $0FE8
      if (this.latch0 !== 0xfe) {
        this.latch0 = 0xfe;
        this._updateChr0();
      }
    } else if (address >= 0x1fd8 && address <= 0x1fdf) {
      // Latch 1 triggers on $1FD8-$1FDF
      if (this.latch1 !== 0xfd) {
        this.latch1 = 0xfd;
        this._updateChr1();
      }
    } else if (address >= 0x1fe8 && address <= 0x1fef) {
      // Latch 1 triggers on $1FE8-$1FEF
      if (this.latch1 !== 0xfe) {
        this.latch1 = 0xfe;
        this._updateChr1();
      }
    }
  }

  loadROM() {
    if (!this.nes.rom.valid) {
      throw new Error("MMC2: Invalid ROM! Unable to load.");
    }

    // Load first switchable 8 KB PRG bank at $8000
    this.load8kRomBank(0, 0x8000);

    // Load the last three 8 KB PRG banks fixed at $A000-$FFFF
    let lastBank8k = (this.nes.rom.romCount - 1) * 2 + 1;
    this.load8kRomBank(lastBank8k - 2, 0xa000);
    this.load8kRomBank(lastBank8k - 1, 0xc000);
    this.load8kRomBank(lastBank8k, 0xe000);

    // Load CHR-ROM
    this.loadCHRROM();

    // Load Battery RAM (if present)
    this.loadBatteryRam();

    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  toJSON() {
    let s = super.toJSON();
    s.prgBank = this.prgBank;
    s.chrBankFD0 = this.chrBankFD0;
    s.chrBankFE0 = this.chrBankFE0;
    s.chrBankFD1 = this.chrBankFD1;
    s.chrBankFE1 = this.chrBankFE1;
    s.latch0 = this.latch0;
    s.latch1 = this.latch1;
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.prgBank = s.prgBank;
    this.chrBankFD0 = s.chrBankFD0;
    this.chrBankFE0 = s.chrBankFE0;
    this.chrBankFD1 = s.chrBankFD1;
    this.chrBankFE1 = s.chrBankFE1;
    this.latch0 = s.latch0;
    this.latch1 = s.latch1;
  }
}

export default Mapper9;
`, type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/mappers/mapper94.js": { text: 'import Mapper0 from "./mapper0.js";\n\n// UN1ROM (HVC-UN1ROM)\n// Used by Senjou no Ookami (Commando).\n// UxROM variant where the bank number is in bits 2-4 instead of bits 0-2.\n// 16 KB switchable PRG-ROM at $8000, last 16 KB bank fixed at $C000.\n// See https://www.nesdev.org/wiki/INES_Mapper_094\nclass Mapper94 extends Mapper0 {\n  static mapperName = "UN1ROM";\n\n  constructor(nes) {\n    super(nes);\n  }\n\n  write(address, value) {\n    // Writes to addresses other than MMC registers are handled by NoMapper.\n    if (address < 0x8000) {\n      super.write(address, value);\n      return;\n    } else {\n      // This is a ROM bank select command.\n      // Swap in the given ROM bank at 0x8000:\n      this.loadRomBank(value >> 2, 0x8000);\n    }\n  }\n\n  loadROM() {\n    if (!this.nes.rom.valid) {\n      throw new Error("UN1ROM: Invalid ROM! Unable to load.");\n    }\n\n    // Load PRG-ROM:\n    this.loadRomBank(0, 0x8000);\n    this.loadRomBank(this.nes.rom.romCount - 1, 0xc000);\n\n    // Load CHR-ROM:\n    this.loadCHRROM();\n\n    // Do Reset-Interrupt:\n    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);\n  }\n}\n\nexport default Mapper94;\n', type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/nes.js": { text: 'import CPU from "./cpu.js";\nimport Controller from "./controller.js";\nimport PPU from "./ppu/index.js";\nimport PAPU from "./papu/index.js";\nimport GameGenie from "./gamegenie.js";\nimport ROM from "./rom.js";\n\nclass NES {\n  constructor(opts) {\n    this.opts = {\n      onFrame: function () {},\n      onAudioSample: null,\n      onStatusUpdate: function () {},\n      onBatteryRamWrite: function () {},\n\n      emulateSound: true,\n      sampleRate: 48000, // Sound sample rate in hz\n\n      ...opts,\n    };\n\n    this.ui = {\n      writeFrame: this.opts.onFrame,\n      updateStatus: this.opts.onStatusUpdate,\n    };\n    this.cpu = new CPU(this);\n    this.ppu = new PPU(this);\n    this.papu = new PAPU(this);\n    this.gameGenie = new GameGenie();\n    this.gameGenie.onChange = () => this.cpu._updateCartridgeLoader();\n    this.mmap = null;\n    this.controllers = {\n      1: new Controller(),\n      2: new Controller(),\n    };\n\n    this.fpsFrameCount = 0;\n    this.romData = null;\n\n    this.ui.updateStatus("Ready to load a ROM.");\n  }\n\n  // Resets the system\n  reset() {\n    this.cpu = new CPU(this);\n    this.ppu = new PPU(this);\n    this.papu = new PAPU(this);\n\n    if (this.mmap !== null) {\n      this.mmap = this.rom.createMapper();\n    }\n\n    this.lastFpsTime = null;\n    this.fpsFrameCount = 0;\n\n    this.crashed = false;\n  }\n\n  // The frame loop. PPU is advanced inline after every CPU bus operation\n  // (in cpu.load/write/push/pull). APU is clocked in bulk after each\n  // instruction for compatibility with its sample timing logic.\n  frame = () => {\n    if (this.crashed) {\n      throw new Error(\n        "Game has crashed. Call reset() or loadROM() to restart.",\n      );\n    }\n    this.controllers[1].clock();\n    this.controllers[2].clock();\n    this.ppu.startFrame();\n    let cycles;\n    const cpu = this.cpu;\n    const ppu = this.ppu;\n    const papu = this.papu;\n    try {\n      for (;;) {\n        if (cpu.cyclesToHalt === 0) {\n          // Execute a CPU instruction. PPU advancement happens inline\n          // inside the bus operations (load/write/push/pull).\n          cycles = cpu.emulate();\n\n          // Clock APU with the full cycle count. The frame counter portion\n          // subtracts any cycles already advanced by APU catch-up.\n          papu.clockFrameCounter(cycles, cpu.apuCatchupCycles);\n          cpu.apuCatchupCycles = 0;\n\n          // Check if VBlank fired during inline PPU stepping.\n          if (ppu.frameEnded) {\n            ppu.frameEnded = false;\n            break;\n          }\n        } else {\n          // DMA halt cycles: step PPU per cycle. APU is clocked in bulk.\n          let chunk = Math.min(cpu.cyclesToHalt, 8);\n          for (let i = 0; i < chunk; i++) {\n            ppu.advanceDots(3);\n          }\n          papu.clockFrameCounter(chunk);\n          cpu.cyclesToHalt -= chunk;\n          cpu._cpuCycleBase += chunk;\n\n          if (ppu.frameEnded) {\n            ppu.frameEnded = false;\n            break;\n          }\n        }\n      }\n    } catch (e) {\n      this.crashed = true;\n      throw e;\n    }\n    this.fpsFrameCount++;\n  };\n\n  buttonDown = (controller, button) => {\n    this.controllers[controller].buttonDown(button);\n  };\n\n  buttonUp = (controller, button) => {\n    this.controllers[controller].buttonUp(button);\n  };\n\n  zapperMove = (x, y) => {\n    if (!this.mmap) return;\n    this.mmap.zapperX = x;\n    this.mmap.zapperY = y;\n  };\n\n  zapperFireDown = () => {\n    if (!this.mmap) return;\n    this.mmap.zapperFired = true;\n  };\n\n  zapperFireUp = () => {\n    if (!this.mmap) return;\n    this.mmap.zapperFired = false;\n  };\n\n  getFPS() {\n    const now = Date.now();\n    let fps = null;\n    if (this.lastFpsTime) {\n      fps = this.fpsFrameCount / ((now - this.lastFpsTime) / 1000);\n    }\n    this.fpsFrameCount = 0;\n    this.lastFpsTime = now;\n    return fps;\n  }\n\n  reloadROM() {\n    if (this.romData !== null) {\n      this.loadROM(this.romData);\n    }\n  }\n\n  // Loads a ROM file into the CPU and PPU.\n  // The ROM file is validated first.\n  loadROM(data) {\n    // Load ROM file:\n    this.rom = new ROM(this);\n    this.rom.load(data);\n\n    this.reset();\n    this.mmap = this.rom.createMapper();\n    this.mmap.loadROM();\n    this.ppu.setMirroring(this.rom.getMirroringType());\n    this.romData = data;\n  }\n\n  // Adjust audio sample timing for a non-standard host frame rate. At the\n  // default 60fps each frame() produces ~800 samples at 48kHz. If the host\n  // calls frame() less often (e.g. 30fps), the sample timer must fire more\n  // frequently per CPU cycle so each frame still fills the audio buffer.\n  setFramerate(rate) {\n    this.papu.setFrameRate(rate);\n  }\n\n  toJSON() {\n    return {\n      // romData: this.romData,\n      cpu: this.cpu.toJSON(),\n      mmap: this.mmap.toJSON(),\n      ppu: this.ppu.toJSON(),\n      papu: this.papu.toJSON(),\n      controllers: {\n        1: this.controllers[1].toJSON(),\n        2: this.controllers[2].toJSON(),\n      },\n    };\n  }\n\n  fromJSON(s) {\n    this.reset();\n    // this.romData = s.romData;\n    this.cpu.fromJSON(s.cpu);\n    this.mmap.fromJSON(s.mmap);\n    this.ppu.fromJSON(s.ppu);\n    this.papu.fromJSON(s.papu);\n    if (s.controllers) {\n      if (s.controllers[1]) this.controllers[1].fromJSON(s.controllers[1]);\n      if (s.controllers[2]) this.controllers[2].fromJSON(s.controllers[2]);\n    }\n  }\n}\n\nexport default NES;\n', type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/papu/channel-dm.js": { text: 'import { fromJSON, toJSON } from "../utils.js";\n\nclass ChannelDM {\n  static MODE_NORMAL = 0;\n  static MODE_LOOP = 1;\n  static MODE_IRQ = 2;\n\n  static JSON_PROPERTIES = [\n    "isEnabled",\n    "hasSample",\n    "irqGenerated",\n    "playMode",\n    "dmaFrequency",\n    "dmaCounter",\n    "deltaCounter",\n    "playStartAddress",\n    "playAddress",\n    "playLength",\n    "playLengthCounter",\n    "shiftCounter",\n    "reg4012",\n    "reg4013",\n    "sample",\n    "dacLsb",\n    "data",\n    "lastFetchedByte",\n  ];\n\n  constructor(papu) {\n    this.papu = papu;\n\n    this.isEnabled = false;\n    this.hasSample = false;\n    this.irqGenerated = false;\n    this.playMode = ChannelDM.MODE_NORMAL;\n    this.dmaFrequency = 0;\n    this.dmaCounter = 0;\n    this.deltaCounter = 0;\n    this.playStartAddress = 0;\n    this.playAddress = 0;\n    this.playLength = 0;\n    this.playLengthCounter = 0;\n    this.sample = 0;\n    this.dacLsb = 0;\n    this.shiftCounter = 0;\n    this.reg4012 = 0;\n    this.reg4013 = 0;\n    this.data = 0;\n    this.lastFetchedByte = 0;\n  }\n\n  clockDmc() {\n    // Only alter DAC value if the sample buffer has data:\n    if (this.hasSample) {\n      if ((this.data & 1) === 0) {\n        // Decrement delta:\n        if (this.deltaCounter > 0) {\n          this.deltaCounter--;\n        }\n      } else {\n        // Increment delta:\n        if (this.deltaCounter < 63) {\n          this.deltaCounter++;\n        }\n      }\n\n      // Update sample value:\n      this.sample = this.isEnabled ? (this.deltaCounter << 1) + this.dacLsb : 0;\n\n      // Update shift register:\n      this.data >>= 1;\n    }\n\n    this.dmaCounter--;\n    if (this.dmaCounter <= 0) {\n      // No more sample bits.\n      this.hasSample = false;\n      this.endOfSample();\n      this.dmaCounter = 8;\n    }\n\n    if (this.irqGenerated) {\n      this.papu.nes.cpu.requestIrq(this.papu.nes.cpu.IRQ_NORMAL);\n    }\n  }\n\n  endOfSample() {\n    if (this.playLengthCounter === 0 && this.playMode === ChannelDM.MODE_LOOP) {\n      // Start from beginning of sample:\n      this.playAddress = this.playStartAddress;\n      this.playLengthCounter = this.playLength;\n    }\n\n    if (this.playLengthCounter > 0) {\n      // Fetch next sample:\n      this.nextSample();\n\n      if (this.playLengthCounter === 0) {\n        // Last byte of sample fetched, generate IRQ:\n        if (this.playMode === ChannelDM.MODE_IRQ) {\n          // Generate IRQ:\n          this.irqGenerated = true;\n        }\n      }\n    }\n  }\n\n  nextSample() {\n    // Fetch byte:\n    this.data = this.papu.nes.mmap.load(this.playAddress);\n    // On real hardware, the DMA fetch puts this byte on the CPU data bus.\n    // Store it so cpu.load() can detect DMA bus hijacking mid-instruction.\n    // See https://www.nesdev.org/wiki/APU_DMC#Memory_reader\n    this.lastFetchedByte = this.data;\n    this.papu.nes.cpu.haltCycles(4);\n\n    this.playLengthCounter--;\n    this.playAddress++;\n    if (this.playAddress > 0xffff) {\n      this.playAddress = 0x8000;\n    }\n\n    this.hasSample = true;\n  }\n\n  writeReg(address, value) {\n    if (address === 0x4010) {\n      // Play mode, DMA Frequency\n      if (value >> 6 === 0) {\n        this.playMode = ChannelDM.MODE_NORMAL;\n      } else if (((value >> 6) & 1) === 1) {\n        this.playMode = ChannelDM.MODE_LOOP;\n      } else if (value >> 6 === 2) {\n        this.playMode = ChannelDM.MODE_IRQ;\n      }\n\n      if ((value & 0x80) === 0) {\n        this.irqGenerated = false;\n      }\n\n      this.dmaFrequency = this.papu.getDmcFrequency(value & 0xf);\n    } else if (address === 0x4011) {\n      // Delta counter load register:\n      this.deltaCounter = (value >> 1) & 63;\n      this.dacLsb = value & 1;\n      this.sample = (this.deltaCounter << 1) + this.dacLsb; // update sample value\n    } else if (address === 0x4012) {\n      // DMA address load register.\n      // Only updates the start address register \u2014 the active playAddress is\n      // loaded from playStartAddress when a sample restart occurs (via $4015).\n      // See https://www.nesdev.org/wiki/APU_DMC\n      this.playStartAddress = (value << 6) | 0x0c000;\n      this.reg4012 = value;\n    } else if (address === 0x4013) {\n      // Length of play code.\n      // Only updates the length register \u2014 the active playLengthCounter is\n      // loaded from playLength when a sample restart occurs (via $4015 or\n      // loop). Writing $4013 does not affect a currently playing sample.\n      // See https://www.nesdev.org/wiki/APU_DMC\n      this.playLength = (value << 4) + 1;\n      this.reg4013 = value;\n    } else if (address === 0x4015) {\n      // DMC/IRQ Status\n      // Writing $4015 always clears the DMC IRQ flag first, before any\n      // other effects. On real hardware, the flag clear occurs on the\n      // write cycle, while DMA fetches happen 3-4 cycles later \u2014 so a\n      // DMA fetch triggered by this write CAN set a new IRQ flag.\n      // See https://www.nesdev.org/wiki/APU_DMC\n      this.irqGenerated = false;\n\n      if (((value >> 4) & 1) === 0) {\n        // Disable: set bytes remaining to 0.\n        this.playLengthCounter = 0;\n      } else {\n        // Enable: only restart the sample if bytes remaining is 0.\n        // If the sample is still playing (bytes remaining > 0), this\n        // write has no effect on playback.\n        if (this.playLengthCounter === 0) {\n          this.playAddress = this.playStartAddress;\n          this.playLengthCounter = this.playLength;\n          // On real hardware, when DMC is enabled and the sample buffer is\n          // empty, a DMA fetch fires within a few CPU cycles. Trigger it\n          // immediately so the DMASync loop in test ROMs can detect the\n          // first fetch. See https://www.nesdev.org/wiki/APU_DMC\n          if (!this.hasSample && this.playLengthCounter > 0) {\n            this.nextSample();\n            this.dmaCounter = 8;\n            this.shiftCounter = this.dmaFrequency;\n            // If the immediate DMA fetch consumed the last byte (e.g. a\n            // 1-byte sample), set the IRQ flag just like endOfSample does.\n            if (\n              this.playLengthCounter === 0 &&\n              this.playMode === ChannelDM.MODE_IRQ\n            ) {\n              this.irqGenerated = true;\n            }\n          }\n        }\n      }\n    }\n  }\n\n  setEnabled(value) {\n    // Just track the enable flag. The restart logic (reloading address and\n    // length counter) is handled in writeReg for $4015, which is always\n    // called after setEnabled in the $4015 write path.\n    this.isEnabled = value;\n  }\n\n  getLengthStatus() {\n    return this.playLengthCounter === 0 || !this.isEnabled ? 0 : 1;\n  }\n\n  getIrqStatus() {\n    return this.irqGenerated ? 1 : 0;\n  }\n\n  toJSON() {\n    return toJSON(this);\n  }\n\n  fromJSON(s) {\n    fromJSON(this, s);\n  }\n}\n\nexport default ChannelDM;\n', type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/papu/channel-noise.js": { text: 'import { fromJSON, toJSON } from "../utils.js";\n\nclass ChannelNoise {\n  constructor(papu) {\n    this.papu = papu;\n\n    this.progTimerCount = 0;\n    this.progTimerMax = 0;\n    this.isEnabled = false;\n    this.lengthCounter = 0;\n    this.lengthCounterEnable = false;\n    this.envDecayDisable = false;\n    this.envDecayLoopEnable = false;\n    this.envReset = false;\n    this.shiftNow = false;\n    this.envDecayRate = 0;\n    this.envDecayCounter = 0;\n    this.envVolume = 0;\n    this.masterVolume = 0;\n    this.shiftReg = 1;\n    this.randomBit = 0;\n    this.randomMode = 0;\n    this.sampleValue = 0;\n    this.tmp = 0;\n    this.accValue = 0;\n    this.accCount = 1;\n  }\n\n  clockLengthCounter() {\n    if (this.lengthCounterEnable && this.lengthCounter > 0) {\n      this.lengthCounter--;\n      if (this.lengthCounter === 0) {\n        this.updateSampleValue();\n      }\n    }\n  }\n\n  clockEnvDecay() {\n    if (this.envReset) {\n      // Reset envelope:\n      this.envReset = false;\n      this.envDecayCounter = this.envDecayRate + 1;\n      this.envVolume = 0xf;\n    } else if (--this.envDecayCounter <= 0) {\n      // Normal handling:\n      this.envDecayCounter = this.envDecayRate + 1;\n      if (this.envVolume > 0) {\n        this.envVolume--;\n      } else {\n        this.envVolume = this.envDecayLoopEnable ? 0xf : 0;\n      }\n    }\n    if (this.envDecayDisable) {\n      this.masterVolume = this.envDecayRate;\n    } else {\n      this.masterVolume = this.envVolume;\n    }\n    this.updateSampleValue();\n  }\n\n  updateSampleValue() {\n    if (this.isEnabled && this.lengthCounter > 0) {\n      this.sampleValue = this.randomBit * this.masterVolume;\n    }\n  }\n\n  writeReg(address, value) {\n    if (address === 0x400c) {\n      // Volume/Envelope decay:\n      this.envDecayDisable = (value & 0x10) !== 0;\n      this.envDecayRate = value & 0xf;\n      this.envDecayLoopEnable = (value & 0x20) !== 0;\n      this.lengthCounterEnable = (value & 0x20) === 0;\n      if (this.envDecayDisable) {\n        this.masterVolume = this.envDecayRate;\n      } else {\n        this.masterVolume = this.envVolume;\n      }\n    } else if (address === 0x400e) {\n      // Programmable timer:\n      this.progTimerMax = this.papu.getNoiseWaveLength(value & 0xf);\n      this.randomMode = value >> 7;\n    } else if (address === 0x400f) {\n      // Length counter \u2014 only loaded when the channel is enabled via $4015.\n      // Writing this register while disabled has no effect on the length counter.\n      // See https://www.nesdev.org/wiki/APU#Status_($4015)\n      if (this.isEnabled) {\n        this.lengthCounter = this.papu.getLengthMax(value & 248);\n      }\n      this.envReset = true;\n    }\n    // Update:\n    //updateSampleValue();\n  }\n\n  setEnabled(value) {\n    this.isEnabled = value;\n    if (!value) {\n      this.lengthCounter = 0;\n    }\n    this.updateSampleValue();\n  }\n\n  getLengthStatus() {\n    return this.lengthCounter === 0 || !this.isEnabled ? 0 : 1;\n  }\n\n  toJSON() {\n    return toJSON(this);\n  }\n\n  fromJSON(s) {\n    fromJSON(this, s);\n  }\n\n  static JSON_PROPERTIES = [\n    "isEnabled",\n    "envDecayDisable",\n    "envDecayLoopEnable",\n    "lengthCounterEnable",\n    "envReset",\n    "shiftNow",\n    "lengthCounter",\n    "progTimerCount",\n    "progTimerMax",\n    "envDecayRate",\n    "envDecayCounter",\n    "envVolume",\n    "masterVolume",\n    "shiftReg",\n    "randomBit",\n    "randomMode",\n    "sampleValue",\n    "accValue",\n    "accCount",\n    "tmp",\n  ];\n}\n\nexport default ChannelNoise;\n', type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/papu/channel-square.js": { text: 'import { fromJSON, toJSON } from "../utils.js";\n\nclass ChannelSquare {\n  constructor(papu, square1) {\n    this.papu = papu;\n\n    // prettier-ignore\n    this.dutyLookup = [\n           0, 1, 0, 0, 0, 0, 0, 0,\n           0, 1, 1, 0, 0, 0, 0, 0,\n           0, 1, 1, 1, 1, 0, 0, 0,\n           1, 0, 0, 1, 1, 1, 1, 1\n      ];\n    // prettier-ignore\n    this.impLookup = [\n           1,-1, 0, 0, 0, 0, 0, 0,\n           1, 0,-1, 0, 0, 0, 0, 0,\n           1, 0, 0, 0,-1, 0, 0, 0,\n          -1, 0, 1, 0, 0, 0, 0, 0\n      ];\n\n    this.sqr1 = square1;\n\n    this.progTimerCount = 0;\n    this.progTimerMax = 0;\n    this.lengthCounter = 0;\n    this.squareCounter = 0;\n    this.sweepCounter = 0;\n    this.sweepCounterMax = 0;\n    this.sweepMode = 0;\n    this.sweepShiftAmount = 0;\n    this.envDecayRate = 0;\n    this.envDecayCounter = 0;\n    this.envVolume = 0;\n    this.masterVolume = 0;\n    this.dutyMode = 0;\n    this.vol = 0;\n    this.isEnabled = false;\n    this.lengthCounterEnable = false;\n    this.sweepActive = false;\n    this.sweepCarry = false;\n    this.envDecayDisable = false;\n    this.envDecayLoopEnable = false;\n    this.envReset = false;\n    this.updateSweepPeriod = false;\n    this.sweepResult = 0;\n    this.sampleValue = 0;\n  }\n\n  clockLengthCounter() {\n    if (this.lengthCounterEnable && this.lengthCounter > 0) {\n      this.lengthCounter--;\n      if (this.lengthCounter === 0) {\n        this.updateSampleValue();\n      }\n    }\n  }\n\n  clockEnvDecay() {\n    if (this.envReset) {\n      // Reset envelope:\n      this.envReset = false;\n      this.envDecayCounter = this.envDecayRate + 1;\n      this.envVolume = 0xf;\n    } else if (--this.envDecayCounter <= 0) {\n      // Normal handling:\n      this.envDecayCounter = this.envDecayRate + 1;\n      if (this.envVolume > 0) {\n        this.envVolume--;\n      } else {\n        this.envVolume = this.envDecayLoopEnable ? 0xf : 0;\n      }\n    }\n\n    if (this.envDecayDisable) {\n      this.masterVolume = this.envDecayRate;\n    } else {\n      this.masterVolume = this.envVolume;\n    }\n    this.updateSampleValue();\n  }\n\n  clockSweep() {\n    if (--this.sweepCounter <= 0) {\n      this.sweepCounter = this.sweepCounterMax + 1;\n      if (\n        this.sweepActive &&\n        this.sweepShiftAmount > 0 &&\n        this.progTimerMax > 7\n      ) {\n        // Calculate result from shifter:\n        this.sweepCarry = false;\n        if (this.sweepMode === 0) {\n          this.progTimerMax += this.progTimerMax >> this.sweepShiftAmount;\n          if (this.progTimerMax > 0x7ff) {\n            this.progTimerMax = 4095;\n            this.sweepCarry = true;\n          }\n        } else {\n          this.progTimerMax =\n            this.progTimerMax -\n            ((this.progTimerMax >> this.sweepShiftAmount) +\n              (this.sqr1 ? 1 : 0));\n        }\n      }\n    }\n\n    if (this.updateSweepPeriod) {\n      this.updateSweepPeriod = false;\n      this.sweepCounter = this.sweepCounterMax + 1;\n    }\n  }\n\n  updateSampleValue() {\n    if (this.isEnabled && this.lengthCounter > 0 && this.progTimerMax > 7) {\n      if (\n        this.sweepMode === 0 &&\n        this.progTimerMax + (this.progTimerMax >> this.sweepShiftAmount) > 0x7ff\n      ) {\n        //if (this.sweepCarry) {\n        this.sampleValue = 0;\n      } else {\n        this.sampleValue =\n          this.masterVolume *\n          this.dutyLookup[(this.dutyMode << 3) + this.squareCounter];\n      }\n    } else {\n      this.sampleValue = 0;\n    }\n  }\n\n  writeReg(address, value) {\n    let addrAdd = this.sqr1 ? 0 : 4;\n    if (address === 0x4000 + addrAdd) {\n      // Volume/Envelope decay:\n      this.envDecayDisable = (value & 0x10) !== 0;\n      this.envDecayRate = value & 0xf;\n      this.envDecayLoopEnable = (value & 0x20) !== 0;\n      this.dutyMode = (value >> 6) & 0x3;\n      this.lengthCounterEnable = (value & 0x20) === 0;\n      if (this.envDecayDisable) {\n        this.masterVolume = this.envDecayRate;\n      } else {\n        this.masterVolume = this.envVolume;\n      }\n      this.updateSampleValue();\n    } else if (address === 0x4001 + addrAdd) {\n      // Sweep:\n      this.sweepActive = (value & 0x80) !== 0;\n      this.sweepCounterMax = (value >> 4) & 7;\n      this.sweepMode = (value >> 3) & 1;\n      this.sweepShiftAmount = value & 7;\n      this.updateSweepPeriod = true;\n    } else if (address === 0x4002 + addrAdd) {\n      // Programmable timer:\n      this.progTimerMax &= 0x700;\n      this.progTimerMax |= value;\n    } else if (address === 0x4003 + addrAdd) {\n      // Programmable timer, length counter\n      this.progTimerMax &= 0xff;\n      this.progTimerMax |= (value & 0x7) << 8;\n\n      if (this.isEnabled) {\n        this.lengthCounter = this.papu.getLengthMax(value & 0xf8);\n      }\n\n      this.envReset = true;\n    }\n  }\n\n  setEnabled(value) {\n    this.isEnabled = value;\n    if (!value) {\n      this.lengthCounter = 0;\n    }\n    this.updateSampleValue();\n  }\n\n  getLengthStatus() {\n    return this.lengthCounter === 0 || !this.isEnabled ? 0 : 1;\n  }\n\n  toJSON() {\n    return toJSON(this);\n  }\n\n  fromJSON(s) {\n    fromJSON(this, s);\n  }\n\n  static JSON_PROPERTIES = [\n    "isEnabled",\n    "lengthCounterEnable",\n    "sweepActive",\n    "envDecayDisable",\n    "envDecayLoopEnable",\n    "envReset",\n    "sweepCarry",\n    "updateSweepPeriod",\n    "progTimerCount",\n    "progTimerMax",\n    "lengthCounter",\n    "squareCounter",\n    "sweepCounter",\n    "sweepCounterMax",\n    "sweepMode",\n    "sweepShiftAmount",\n    "envDecayRate",\n    "envDecayCounter",\n    "envVolume",\n    "masterVolume",\n    "dutyMode",\n    "sweepResult",\n    "sampleValue",\n    "vol",\n  ];\n}\n\nexport default ChannelSquare;\n', type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/papu/channel-triangle.js": { text: 'import { fromJSON, toJSON } from "../utils.js";\n\nclass ChannelTriangle {\n  constructor(papu) {\n    this.papu = papu;\n\n    this.progTimerCount = 0;\n    this.progTimerMax = 0;\n    this.triangleCounter = 0;\n    this.isEnabled = false;\n    this.sampleCondition = false;\n    this.lengthCounter = 0;\n    this.lengthCounterEnable = false;\n    this.linearCounter = 0;\n    this.lcLoadValue = 0;\n    this.lcHalt = true;\n    this.lcControl = false;\n    this.tmp = 0;\n    this.sampleValue = 0xf;\n  }\n\n  clockLengthCounter() {\n    if (this.lengthCounterEnable && this.lengthCounter > 0) {\n      this.lengthCounter--;\n      if (this.lengthCounter === 0) {\n        this.updateSampleCondition();\n      }\n    }\n  }\n\n  clockLinearCounter() {\n    if (this.lcHalt) {\n      // Load:\n      this.linearCounter = this.lcLoadValue;\n      this.updateSampleCondition();\n    } else if (this.linearCounter > 0) {\n      // Decrement:\n      this.linearCounter--;\n      this.updateSampleCondition();\n    }\n    if (!this.lcControl) {\n      // Clear halt flag:\n      this.lcHalt = false;\n    }\n  }\n\n  getLengthStatus() {\n    return this.lengthCounter === 0 || !this.isEnabled ? 0 : 1;\n  }\n\n  // eslint-disable-next-line no-unused-vars\n  readReg(address) {\n    return 0;\n  }\n\n  writeReg(address, value) {\n    if (address === 0x4008) {\n      // New values for linear counter:\n      this.lcControl = (value & 0x80) !== 0;\n      this.lcLoadValue = value & 0x7f;\n\n      // Length counter enable:\n      this.lengthCounterEnable = !this.lcControl;\n    } else if (address === 0x400a) {\n      // Programmable timer:\n      this.progTimerMax &= 0x700;\n      this.progTimerMax |= value;\n    } else if (address === 0x400b) {\n      // Programmable timer, length counter\n      this.progTimerMax &= 0xff;\n      this.progTimerMax |= (value & 0x07) << 8;\n      // Length counter is only loaded when the channel is enabled via $4015.\n      // Writing this register while disabled has no effect on the length counter.\n      // See https://www.nesdev.org/wiki/APU#Status_($4015)\n      if (this.isEnabled) {\n        this.lengthCounter = this.papu.getLengthMax(value & 0xf8);\n      }\n      this.lcHalt = true;\n    }\n\n    this.updateSampleCondition();\n  }\n\n  clockProgrammableTimer(nCycles) {\n    if (this.progTimerMax > 0) {\n      this.progTimerCount += nCycles;\n      while (\n        this.progTimerMax > 0 &&\n        this.progTimerCount >= this.progTimerMax\n      ) {\n        this.progTimerCount -= this.progTimerMax;\n        if (\n          this.isEnabled &&\n          this.lengthCounter > 0 &&\n          this.linearCounter > 0\n        ) {\n          this.clockTriangleGenerator();\n        }\n      }\n    }\n  }\n\n  clockTriangleGenerator() {\n    this.triangleCounter++;\n    this.triangleCounter &= 0x1f;\n  }\n\n  setEnabled(value) {\n    this.isEnabled = value;\n    if (!value) {\n      this.lengthCounter = 0;\n    }\n    this.updateSampleCondition();\n  }\n\n  updateSampleCondition() {\n    this.sampleCondition =\n      this.isEnabled &&\n      this.progTimerMax > 7 &&\n      this.linearCounter > 0 &&\n      this.lengthCounter > 0;\n  }\n\n  toJSON() {\n    return toJSON(this);\n  }\n\n  fromJSON(s) {\n    fromJSON(this, s);\n  }\n\n  static JSON_PROPERTIES = [\n    "isEnabled",\n    "sampleCondition",\n    "lengthCounterEnable",\n    "lcHalt",\n    "lcControl",\n    "progTimerCount",\n    "progTimerMax",\n    "triangleCounter",\n    "lengthCounter",\n    "linearCounter",\n    "lcLoadValue",\n    "sampleValue",\n    "tmp",\n  ];\n}\n\nexport default ChannelTriangle;\n', type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/papu/index.js": { text: `import { fromJSON, toJSON } from "../utils.js";
import ChannelDM from "./channel-dm.js";
import ChannelNoise from "./channel-noise.js";
import ChannelSquare from "./channel-square.js";
import ChannelTriangle from "./channel-triangle.js";

const CPU_FREQ_NTSC = 1789772.5; //1789772.72727272d;
// const CPU_FREQ_PAL = 1773447.4;

// Frame counter step timing tables (in CPU cycles).
// The APU frame counter fires at these specific cycle positions within each
// sequence. On real hardware, the APU clock is half the CPU clock, so
// these correspond to APU cycles 3728.5, 7456.5, 11185.5, 14914, 14914.5 etc.
// In 4-step mode, the IRQ flag is set 1 CPU cycle before the clock event
// (at 29828 vs 29829), so step 3 is split into two sub-steps.
// See https://www.nesdev.org/wiki/APU_Frame_Counter
const FRAME_STEPS_4 = [7457, 14913, 22371, 29828, 29829];
// 5-step mode step 3 fires at 29829 per the nesdev wiki, not 29828. This is
// fine because fireFrameStep step 3 in 5-step mode is a no-op (no clock or IRQ).
const FRAME_STEPS_5 = [7457, 14913, 22371, 29829, 37281];
const FRAME_PERIOD_4 = 29830; // Total CPU cycles for 4-step sequence
const FRAME_PERIOD_5 = 37282; // Total CPU cycles for 5-step sequence

class PAPU {
  constructor(nes) {
    this.nes = nes;

    this.square1 = new ChannelSquare(this, true);
    this.square2 = new ChannelSquare(this, false);
    this.triangle = new ChannelTriangle(this);
    this.noise = new ChannelNoise(this);
    this.dmc = new ChannelDM(this);

    this.startedPlaying = false;
    this.recordOutput = false;
    this.triValue = 0;

    // DC removal vars:
    this.prevSampleL = 0;
    this.prevSampleR = 0;
    this.smpAccumL = 0;
    this.smpAccumR = 0;

    // DAC range:
    this.dacRange = 0;
    this.dcValue = 0;

    // Master volume:
    this.masterVolume = 256;

    // Panning:
    this.panning = [80, 170, 100, 150, 128];
    this.setPanning(this.panning);

    // Initialize lookup tables:
    this.initLengthLookup();
    this.initDmcFrequencyLookup();
    this.initNoiseWavelengthLookup();
    this.initDACtables();

    // Init sound registers:
    for (let i = 0; i < 0x14; i++) {
      if (i === 0x10) {
        this.writeReg(0x4010, 0x10);
      } else {
        this.writeReg(0x4000 + i, 0);
      }
    }

    this.sampleRate = this.nes.opts.sampleRate;
    this.sampleTimerMax = Math.floor(
      (1024.0 * CPU_FREQ_NTSC) / this.sampleRate,
    );
    this.sampleTimer = 0;
    this.updateChannelEnable(0);
    this.frameCycleCounter = 0;
    this.frameStep = 0;
    this.countSequence = 0;
    this.sampleCount = 0;
    this.frameIrqEnabled = false;
    this.frameIrqActive = false;
    // Deferred clearing of the frame IRQ flag: on real hardware, reading
    // $4015 doesn't clear bit 6 immediately. The clear takes effect at the
    // next APU "get" cycle (the APU clock runs at half the CPU rate, so
    // get/put phases alternate every CPU cycle). This matters when $4015 is
    // read twice in quick succession (e.g., by the SLO RMW instruction's
    // dummy read + actual read, which are 1 CPU cycle apart). Depending on
    // the APU phase alignment, the second read may or may not still see
    // the flag. See AccuracyCoin test 0x0467 subtests 6 and 7.
    // https://www.nesdev.org/wiki/APU_Frame_Counter
    this.frameIrqClearPending = false;
    // APU cycle parity tracks the CPU cycle count modulo 2, determining
    // which APU half-cycle phase we're on (get or put).
    this.apuCycleParity = 0;
    this.accCount = 0;
    this.smpSquare1 = 0;
    this.smpSquare2 = 0;
    this.smpTriangle = 0;
    this.smpDmc = 0;
    this.channelEnableValue = 0xff;
    this.extraCycles = 0;
    this.maxSample = -500000;
    this.minSample = 500000;
  }

  // eslint-disable-next-line no-unused-vars
  readReg(address) {
    // Read 0x4015:
    let tmp = 0;
    tmp |= this.square1.getLengthStatus();
    tmp |= this.square2.getLengthStatus() << 1;
    tmp |= this.triangle.getLengthStatus() << 2;
    tmp |= this.noise.getLengthStatus() << 3;
    tmp |= this.dmc.getLengthStatus() << 4;
    // Bit 5 is open bus (not driven by APU), comes from CPU data bus
    // See https://www.nesdev.org/wiki/Open_bus_behavior
    tmp |= this.nes.cpu.dataBus & 0x20;
    // Frame interrupt flag: reflects whether the flag is set, regardless of
    // the IRQ inhibit bit in $4017. The inhibit only prevents the IRQ from
    // firing, not the flag from being reported.
    tmp |= (this.frameIrqActive ? 1 : 0) << 6;
    tmp |= this.dmc.getIrqStatus() << 7;

    // Reading $4015 schedules the frame interrupt flag for clearing, but
    // the actual clear is deferred to the next APU "get" cycle. This means
    // if two reads happen 1 CPU cycle apart (e.g., dummy + actual read in
    // an RMW instruction), the second read may still see the flag depending
    // on APU clock phase alignment. The DMC interrupt flag is NOT cleared.
    // Only schedule a clear when the flag is actually set; otherwise a stale
    // pending clear could race with a future fireFrameStep that sets the flag.
    // See https://www.nesdev.org/wiki/APU#Status_($4015)
    if (this.frameIrqActive) {
      this.frameIrqClearPending = true;
    }

    return tmp & 0xff;
  }

  writeReg(address, value) {
    if (address >= 0x4000 && address < 0x4004) {
      // Square Wave 1 Control
      this.square1.writeReg(address, value);
      // console.log("Square Write");
    } else if (address >= 0x4004 && address < 0x4008) {
      // Square 2 Control
      this.square2.writeReg(address, value);
    } else if (address >= 0x4008 && address < 0x400c) {
      // Triangle Control
      this.triangle.writeReg(address, value);
    } else if (address >= 0x400c && address <= 0x400f) {
      // Noise Control
      this.noise.writeReg(address, value);
    } else if (address === 0x4010) {
      // DMC Play mode & DMA frequency
      this.dmc.writeReg(address, value);
    } else if (address === 0x4011) {
      // DMC Delta Counter
      this.dmc.writeReg(address, value);
    } else if (address === 0x4012) {
      // DMC Play code starting address
      this.dmc.writeReg(address, value);
    } else if (address === 0x4013) {
      // DMC Play code length
      this.dmc.writeReg(address, value);
    } else if (address === 0x4015) {
      // Channel enable
      this.updateChannelEnable(value);

      // DMC/IRQ Status
      this.dmc.writeReg(address, value);
    } else if (address === 0x4017) {
      // Frame counter control
      // Bit 7: sequence mode (0=4-step, 1=5-step)
      // Bit 6: IRQ inhibit (0=IRQs enabled, 1=IRQs disabled)
      // See https://www.nesdev.org/wiki/APU_Frame_Counter
      this.countSequence = (value >> 7) & 1;
      // Writing $4017 resets the frame counter's internal divider, but on
      // real hardware the reset is delayed after the write cycle. The delay
      // depends on the APU clock phase at the write:
      //   "get" phase (odd parity): reset after 3 CPU cycles
      //   "put" phase (even parity): reset after 4 CPU cycles
      // Since the emulator clocks the full STA instruction's cycles (4 for
      // STA absolute) after writeReg, we compensate by starting the counter
      // negative so it reaches 0 at the true reset point.
      // See https://www.nesdev.org/wiki/APU_Frame_Counter
      let cpu = this.nes.cpu;
      let pendingCycles = cpu.instrBusCycles + 1 - cpu.apuCatchupCycles;
      let writeParity = (this.apuCycleParity + pendingCycles) & 1;
      // "get" phase (odd): -6 \u2192 after STA (4 cycles) \u2192 -2, after 2 cycles \u2192 0
      // "put" phase (even): -7 \u2192 after STA (4 cycles) \u2192 -3, after 3 cycles \u2192 0
      this.frameCycleCounter = -7 + writeParity;
      this.frameStep = 0;

      if (value & 0x40) {
        // IRQ inhibit set: clear the frame interrupt flag and prevent
        // future frame IRQs from firing
        this.frameIrqEnabled = false;
        this.frameIrqActive = false;
        this.frameIrqClearPending = false;
      } else {
        // IRQ inhibit clear: enable frame IRQs (flag is not affected)
        this.frameIrqEnabled = true;
      }

      if (this.countSequence === 1) {
        // 5-step mode: immediately clock all quarter-frame and half-frame
        // units on the write cycle
        this.clockQuarterFrame();
        this.clockHalfFrame();
      }
    }
  }

  // Updates channel enable status.
  // This is done on writes to the
  // channel enable register (0x4015),
  // and when the user enables/disables channels
  // in the GUI.
  updateChannelEnable(value) {
    this.channelEnableValue = value & 0xffff;
    this.square1.setEnabled((value & 1) !== 0);
    this.square2.setEnabled((value & 2) !== 0);
    this.triangle.setEnabled((value & 4) !== 0);
    this.noise.setEnabled((value & 8) !== 0);
    this.dmc.setEnabled((value & 16) !== 0);
  }

  // Clocks all APU channel timers and the frame counter by nCycles CPU cycles.
  // Called once per instruction from the frame loop with the total cycle count.
  // frameCounterAlreadyAdvanced is the number of frame counter cycles already
  // advanced mid-instruction by APU catch-up (advanceFrameCounter). This is
  // subtracted from the frame counter portion only, not from channel timers.
  clockFrameCounter(nCycles, frameCounterAlreadyAdvanced) {
    let frameCounterCycles = nCycles - (frameCounterAlreadyAdvanced || 0);

    // Process deferred frame IRQ clear and update APU cycle parity for
    // the remaining cycles not yet advanced by advanceFrameCounter.
    this.processFrameIrqClear(frameCounterCycles);
    this.apuCycleParity = (this.apuCycleParity + frameCounterCycles) & 1;

    // Don't process channel ticks beyond next sampling:
    nCycles += this.extraCycles;
    let maxCycles = this.sampleTimerMax - this.sampleTimer;
    if (nCycles << 10 > maxCycles) {
      this.extraCycles = ((nCycles << 10) - maxCycles) >> 10;
      nCycles -= this.extraCycles;
    } else {
      this.extraCycles = 0;
    }

    let dmc = this.dmc;
    let triangle = this.triangle;
    let square1 = this.square1;
    let square2 = this.square2;
    let noise = this.noise;

    // Clock DMC:
    if (dmc.isEnabled) {
      dmc.shiftCounter -= nCycles << 3;
      while (dmc.shiftCounter <= 0 && dmc.dmaFrequency > 0) {
        dmc.shiftCounter += dmc.dmaFrequency;
        dmc.clockDmc();
      }
    }

    // Clock Triangle channel Prog timer:
    if (triangle.progTimerMax > 0) {
      triangle.progTimerCount -= nCycles;
      while (triangle.progTimerCount <= 0) {
        triangle.progTimerCount += triangle.progTimerMax + 1;
        if (triangle.linearCounter > 0 && triangle.lengthCounter > 0) {
          triangle.triangleCounter++;
          triangle.triangleCounter &= 0x1f;

          if (triangle.isEnabled) {
            if (triangle.triangleCounter >= 0x10) {
              // Normal value.
              triangle.sampleValue = triangle.triangleCounter & 0xf;
            } else {
              // Inverted value.
              triangle.sampleValue = 0xf - (triangle.triangleCounter & 0xf);
            }
            triangle.sampleValue <<= 4;
          }
        }
      }
    }

    // Clock Square channel 1 Prog timer:
    square1.progTimerCount -= nCycles;
    if (square1.progTimerCount <= 0) {
      square1.progTimerCount += (square1.progTimerMax + 1) << 1;

      square1.squareCounter++;
      square1.squareCounter &= 0x7;
      square1.updateSampleValue();
    }

    // Clock Square channel 2 Prog timer:
    square2.progTimerCount -= nCycles;
    if (square2.progTimerCount <= 0) {
      square2.progTimerCount += (square2.progTimerMax + 1) << 1;

      square2.squareCounter++;
      square2.squareCounter &= 0x7;
      square2.updateSampleValue();
    }

    // Clock noise channel Prog timer:
    let acc_c = nCycles;
    if (noise.progTimerCount - acc_c > 0) {
      // Do all cycles at once:
      noise.progTimerCount -= acc_c;
      noise.accCount += acc_c;
      noise.accValue += acc_c * noise.sampleValue;
    } else {
      // Slow-step:
      while (acc_c-- > 0) {
        if (--noise.progTimerCount <= 0 && noise.progTimerMax > 0) {
          // Update noise shift register:
          noise.shiftReg <<= 1;
          noise.tmp =
            ((noise.shiftReg << (noise.randomMode === 0 ? 1 : 6)) ^
              noise.shiftReg) &
            0x8000;
          if (noise.tmp !== 0) {
            // Sample value must be 0.
            noise.shiftReg |= 0x01;
            noise.randomBit = 0;
            noise.sampleValue = 0;
          } else {
            // Find sample value:
            noise.randomBit = 1;
            if (noise.isEnabled && noise.lengthCounter > 0) {
              noise.sampleValue = noise.masterVolume;
            } else {
              noise.sampleValue = 0;
            }
          }

          noise.progTimerCount += noise.progTimerMax;
        }

        noise.accValue += noise.sampleValue;
        noise.accCount++;
      }
    }

    // Frame IRQ handling:
    if (this.frameIrqEnabled && this.frameIrqActive) {
      this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
    }

    // Clock frame counter: fire steps at the correct CPU cycle positions.
    // Uses the uncapped cycle count to maintain accurate timing.
    this._advanceFrameSteps(frameCounterCycles);

    // Accumulate sample value:
    this.accSample(nCycles);

    // Clock sample timer:
    this.sampleTimer += nCycles << 10;
    if (this.sampleTimer >= this.sampleTimerMax) {
      // Sample channels:
      this.sample();
      this.sampleTimer -= this.sampleTimerMax;
    }
  }

  // Process the deferred frame IRQ flag clear. On real hardware, reading
  // $4015 schedules the clear for the next APU "get" cycle (which happens
  // every 2 CPU cycles). If the current APU phase is "put" (parity 0),
  // the next "get" is 1 cycle away. If "get" (parity 1), it's 2 cycles
  // away. This must be called BEFORE updating apuCycleParity for the
  // current advance, so it sees the parity at the start of the period.
  // See https://www.nesdev.org/wiki/APU_Frame_Counter
  processFrameIrqClear(nCycles) {
    if (!this.frameIrqClearPending || nCycles <= 0) return;
    // Determine how many CPU cycles until the next APU "get" boundary.
    let cyclesToNextGet = (this.apuCycleParity & 1) === 0 ? 1 : 2;
    if (nCycles >= cyclesToNextGet) {
      this.frameIrqActive = false;
      this.frameIrqClearPending = false;
    }
  }

  // Advance only the frame counter steps without clocking channel timers,
  // DMC, or audio sampling. Used by CPU APU catch-up to update frame counter
  // state (length counters, envelopes) before $4015 reads, without disturbing
  // DMC DMA timing or audio generation.
  advanceFrameCounter(nCycles) {
    this.processFrameIrqClear(nCycles);
    this.apuCycleParity = (this.apuCycleParity + nCycles) & 1;
    this._advanceFrameSteps(nCycles);
  }

  // Advance frame counter steps and handle period wrap. Shared by both
  // clockFrameCounter (full APU tick) and advanceFrameCounter (catch-up only).
  // The step loop and period wrap are separated: steps fire when the counter
  // reaches each step's cycle position, and the period wrap only occurs when
  // the counter reaches the full period length (not immediately after the
  // last step). This matters because in 4-step mode, the last step fires at
  // 29829 but the period wrap (and 3rd IRQ assertion) occurs at 29830.
  // See https://www.nesdev.org/wiki/APU_Frame_Counter
  _advanceFrameSteps(frameCounterCycles) {
    this.frameCycleCounter += frameCounterCycles;
    let steps = this.countSequence === 0 ? FRAME_STEPS_4 : FRAME_STEPS_5;
    let period = this.countSequence === 0 ? FRAME_PERIOD_4 : FRAME_PERIOD_5;
    for (;;) {
      if (
        this.frameStep < steps.length &&
        this.frameCycleCounter >= steps[this.frameStep]
      ) {
        this.fireFrameStep(this.frameStep);
        this.frameStep++;
      } else if (
        this.frameStep >= steps.length &&
        this.frameCycleCounter >= period
      ) {
        // Period wrap: reset the frame counter for the next sequence.
        this.frameStep = 0;
        this.frameCycleCounter -= period;
        // In 4-step mode, the IRQ flag is asserted for 3 consecutive CPU
        // cycles: at 29828 (step 3), 29829 (step 4), and 29830 (period wrap).
        // On the 3rd cycle (period wrap), the flag is set only if the IRQ
        // inhibit flag is clear. If inhibit is set, the flag is actively
        // cleared (it was unconditionally set on cycles 29828-29829).
        // See https://www.nesdev.org/wiki/APU_Frame_Counter
        if (this.countSequence === 0) {
          this.frameIrqActive = this.frameIrqEnabled;
          this.frameIrqClearPending = false;
        }
      } else {
        break;
      }
    }
  }

  accSample(cycles) {
    // Special treatment for triangle channel - need to interpolate.
    if (this.triangle.sampleCondition) {
      this.triValue = Math.floor(
        (this.triangle.progTimerCount << 4) / (this.triangle.progTimerMax + 1),
      );
      if (this.triValue > 16) {
        this.triValue = 16;
      }
      if (this.triangle.triangleCounter >= 16) {
        this.triValue = 16 - this.triValue;
      }

      // Add non-interpolated sample value:
      this.triValue += this.triangle.sampleValue;
    }

    // Now sample normally:
    if (cycles === 2) {
      this.smpTriangle += this.triValue << 1;
      this.smpDmc += this.dmc.sample << 1;
      this.smpSquare1 += this.square1.sampleValue << 1;
      this.smpSquare2 += this.square2.sampleValue << 1;
      this.accCount += 2;
    } else if (cycles === 4) {
      this.smpTriangle += this.triValue << 2;
      this.smpDmc += this.dmc.sample << 2;
      this.smpSquare1 += this.square1.sampleValue << 2;
      this.smpSquare2 += this.square2.sampleValue << 2;
      this.accCount += 4;
    } else {
      this.smpTriangle += cycles * this.triValue;
      this.smpDmc += cycles * this.dmc.sample;
      this.smpSquare1 += cycles * this.square1.sampleValue;
      this.smpSquare2 += cycles * this.square2.sampleValue;
      this.accCount += cycles;
    }
  }

  // Fire a frame counter step. Each step clocks different APU units depending
  // on the mode and step number.
  // See https://www.nesdev.org/wiki/APU_Frame_Counter
  fireFrameStep(step) {
    if (this.countSequence === 0) {
      // Mode 0 (4-step):
      //   Step 0 (7457): quarter frame (envelope + linear counter)
      //   Step 1 (14913): half frame (quarter + length counter + sweep)
      //   Step 2 (22371): quarter frame
      //   Step 3 (29828): set frame IRQ flag only (1 cycle before clock)
      //   Step 4 (29829): half frame + set frame IRQ flag
      // On real hardware, the IRQ flag is asserted 1 CPU cycle before the
      // clock event at the end of the 4-step sequence. This is why step 3
      // is split from step 4.
      // See https://www.nesdev.org/wiki/APU_Frame_Counter
      switch (step) {
        case 0:
          this.clockQuarterFrame();
          break;
        case 1:
          this.clockQuarterFrame();
          this.clockHalfFrame();
          break;
        case 2:
          this.clockQuarterFrame();
          break;
        case 3:
          // IRQ flag is UNCONDITIONALLY set 1 CPU cycle before the half-frame
          // clock, regardless of the IRQ inhibit flag ($4017 bit 6). On real
          // hardware, the flag is driven high by the frame counter output for
          // cycles 29828-29829 even when inhibit is set; only the period wrap
          // at 29830 respects the inhibit flag. Cancel any pending deferred
          // clear since the flag is being re-asserted by hardware.
          // See AccuracyCoin tests I-L.
          this.frameIrqActive = true;
          this.frameIrqClearPending = false;
          break;
        case 4:
          this.clockQuarterFrame();
          this.clockHalfFrame();
          // IRQ flag continues to be unconditionally asserted on this cycle.
          this.frameIrqActive = true;
          this.frameIrqClearPending = false;
          break;
      }
    } else {
      // Mode 1 (5-step):
      //   Step 0: quarter frame
      //   Step 1: half frame
      //   Step 2: quarter frame
      //   Step 3: nothing (no clocking, no IRQ)
      //   Step 4: half frame
      switch (step) {
        case 0:
          this.clockQuarterFrame();
          break;
        case 1:
          this.clockQuarterFrame();
          this.clockHalfFrame();
          break;
        case 2:
          this.clockQuarterFrame();
          break;
        case 3:
          // Nothing happens at step 4 in 5-step mode
          break;
        case 4:
          this.clockQuarterFrame();
          this.clockHalfFrame();
          break;
      }
    }
  }

  // Quarter frame: clock envelopes and triangle linear counter (~240Hz)
  clockQuarterFrame() {
    this.square1.clockEnvDecay();
    this.square2.clockEnvDecay();
    this.noise.clockEnvDecay();
    this.triangle.clockLinearCounter();
  }

  // Half frame: clock length counters and sweep units (~120Hz)
  clockHalfFrame() {
    this.triangle.clockLengthCounter();
    this.square1.clockLengthCounter();
    this.square2.clockLengthCounter();
    this.noise.clockLengthCounter();
    this.square1.clockSweep();
    this.square2.clockSweep();
  }

  // Samples the channels, mixes the output together, then writes to buffer.
  sample() {
    let sq_index, tnd_index;

    if (this.accCount > 0) {
      this.smpSquare1 <<= 4;
      this.smpSquare1 = Math.floor(this.smpSquare1 / this.accCount);

      this.smpSquare2 <<= 4;
      this.smpSquare2 = Math.floor(this.smpSquare2 / this.accCount);

      this.smpTriangle = Math.floor(this.smpTriangle / this.accCount);

      this.smpDmc <<= 4;
      this.smpDmc = Math.floor(this.smpDmc / this.accCount);

      this.accCount = 0;
    } else {
      this.smpSquare1 = this.square1.sampleValue << 4;
      this.smpSquare2 = this.square2.sampleValue << 4;
      this.smpTriangle = this.triangle.sampleValue;
      this.smpDmc = this.dmc.sample << 4;
    }

    let smpNoise = Math.floor((this.noise.accValue << 4) / this.noise.accCount);
    this.noise.accValue = smpNoise >> 4;
    this.noise.accCount = 1;

    // Stereo sound.

    // Left channel:
    sq_index =
      (this.smpSquare1 * this.stereoPosLSquare1 +
        this.smpSquare2 * this.stereoPosLSquare2) >>
      8;
    tnd_index =
      (3 * this.smpTriangle * this.stereoPosLTriangle +
        (smpNoise << 1) * this.stereoPosLNoise +
        this.smpDmc * this.stereoPosLDMC) >>
      8;
    if (sq_index >= this.square_table.length) {
      sq_index = this.square_table.length - 1;
    }
    if (tnd_index >= this.tnd_table.length) {
      tnd_index = this.tnd_table.length - 1;
    }
    let sampleValueL =
      this.square_table[sq_index] + this.tnd_table[tnd_index] - this.dcValue;

    // Right channel:
    sq_index =
      (this.smpSquare1 * this.stereoPosRSquare1 +
        this.smpSquare2 * this.stereoPosRSquare2) >>
      8;
    tnd_index =
      (3 * this.smpTriangle * this.stereoPosRTriangle +
        (smpNoise << 1) * this.stereoPosRNoise +
        this.smpDmc * this.stereoPosRDMC) >>
      8;
    if (sq_index >= this.square_table.length) {
      sq_index = this.square_table.length - 1;
    }
    if (tnd_index >= this.tnd_table.length) {
      tnd_index = this.tnd_table.length - 1;
    }
    let sampleValueR =
      this.square_table[sq_index] + this.tnd_table[tnd_index] - this.dcValue;

    // Remove DC from left channel:
    let smpDiffL = sampleValueL - this.prevSampleL;
    this.prevSampleL += smpDiffL;
    this.smpAccumL += smpDiffL - (this.smpAccumL >> 10);
    sampleValueL = this.smpAccumL;

    // Remove DC from right channel:
    let smpDiffR = sampleValueR - this.prevSampleR;
    this.prevSampleR += smpDiffR;
    this.smpAccumR += smpDiffR - (this.smpAccumR >> 10);
    sampleValueR = this.smpAccumR;

    // Write:
    if (sampleValueL > this.maxSample) {
      this.maxSample = sampleValueL;
    }
    if (sampleValueL < this.minSample) {
      this.minSample = sampleValueL;
    }

    if (this.nes.opts.onAudioSample) {
      this.nes.opts.onAudioSample(sampleValueL / 32768, sampleValueR / 32768);
    }

    // Reset sampled values:
    this.smpSquare1 = 0;
    this.smpSquare2 = 0;
    this.smpTriangle = 0;
    this.smpDmc = 0;
  }

  getLengthMax(value) {
    return this.lengthLookup[value >> 3];
  }

  getDmcFrequency(value) {
    if (value >= 0 && value < 0x10) {
      return this.dmcFreqLookup[value];
    }
    return 0;
  }

  getNoiseWaveLength(value) {
    if (value >= 0 && value < 0x10) {
      return this.noiseWavelengthLookup[value];
    }
    return 0;
  }

  // Recalculate the sample timer for a non-standard host frame rate.
  // At 60fps the timer fires once per (CPU_FREQ / sampleRate) cycles. If the
  // host calls frame() at a different rate, scale proportionally so the total
  // audio output per second stays constant.
  setFrameRate(rate) {
    this.sampleTimerMax = Math.floor(
      (1024.0 * CPU_FREQ_NTSC * rate) / (this.sampleRate * 60.0),
    );
  }

  setPanning(pos) {
    for (let i = 0; i < 5; i++) {
      this.panning[i] = pos[i];
    }
    this.updateStereoPos();
  }

  setMasterVolume(value) {
    if (value < 0) {
      value = 0;
    }
    if (value > 256) {
      value = 256;
    }
    this.masterVolume = value;
    this.updateStereoPos();
  }

  updateStereoPos() {
    this.stereoPosLSquare1 = (this.panning[0] * this.masterVolume) >> 8;
    this.stereoPosLSquare2 = (this.panning[1] * this.masterVolume) >> 8;
    this.stereoPosLTriangle = (this.panning[2] * this.masterVolume) >> 8;
    this.stereoPosLNoise = (this.panning[3] * this.masterVolume) >> 8;
    this.stereoPosLDMC = (this.panning[4] * this.masterVolume) >> 8;

    this.stereoPosRSquare1 = this.masterVolume - this.stereoPosLSquare1;
    this.stereoPosRSquare2 = this.masterVolume - this.stereoPosLSquare2;
    this.stereoPosRTriangle = this.masterVolume - this.stereoPosLTriangle;
    this.stereoPosRNoise = this.masterVolume - this.stereoPosLNoise;
    this.stereoPosRDMC = this.masterVolume - this.stereoPosLDMC;
  }

  initLengthLookup() {
    // prettier-ignore
    this.lengthLookup = [
            0x0A, 0xFE,
            0x14, 0x02,
            0x28, 0x04,
            0x50, 0x06,
            0xA0, 0x08,
            0x3C, 0x0A,
            0x0E, 0x0C,
            0x1A, 0x0E,
            0x0C, 0x10,
            0x18, 0x12,
            0x30, 0x14,
            0x60, 0x16,
            0xC0, 0x18,
            0x48, 0x1A,
            0x10, 0x1C,
            0x20, 0x1E
        ];
  }

  initDmcFrequencyLookup() {
    this.dmcFreqLookup = new Array(16);

    this.dmcFreqLookup[0x0] = 0xd60;
    this.dmcFreqLookup[0x1] = 0xbe0;
    this.dmcFreqLookup[0x2] = 0xaa0;
    this.dmcFreqLookup[0x3] = 0xa00;
    this.dmcFreqLookup[0x4] = 0x8f0;
    this.dmcFreqLookup[0x5] = 0x7f0;
    this.dmcFreqLookup[0x6] = 0x710;
    this.dmcFreqLookup[0x7] = 0x6b0;
    this.dmcFreqLookup[0x8] = 0x5f0;
    this.dmcFreqLookup[0x9] = 0x500;
    this.dmcFreqLookup[0xa] = 0x470;
    this.dmcFreqLookup[0xb] = 0x400;
    this.dmcFreqLookup[0xc] = 0x350;
    this.dmcFreqLookup[0xd] = 0x2a0;
    this.dmcFreqLookup[0xe] = 0x240;
    this.dmcFreqLookup[0xf] = 0x1b0;
    //for(int i=0;i<16;i++)dmcFreqLookup[i]/=8;
  }

  initNoiseWavelengthLookup() {
    this.noiseWavelengthLookup = new Array(16);

    this.noiseWavelengthLookup[0x0] = 0x004;
    this.noiseWavelengthLookup[0x1] = 0x008;
    this.noiseWavelengthLookup[0x2] = 0x010;
    this.noiseWavelengthLookup[0x3] = 0x020;
    this.noiseWavelengthLookup[0x4] = 0x040;
    this.noiseWavelengthLookup[0x5] = 0x060;
    this.noiseWavelengthLookup[0x6] = 0x080;
    this.noiseWavelengthLookup[0x7] = 0x0a0;
    this.noiseWavelengthLookup[0x8] = 0x0ca;
    this.noiseWavelengthLookup[0x9] = 0x0fe;
    this.noiseWavelengthLookup[0xa] = 0x17c;
    this.noiseWavelengthLookup[0xb] = 0x1fc;
    this.noiseWavelengthLookup[0xc] = 0x2fa;
    this.noiseWavelengthLookup[0xd] = 0x3f8;
    this.noiseWavelengthLookup[0xe] = 0x7f2;
    this.noiseWavelengthLookup[0xf] = 0xfe4;
  }

  initDACtables() {
    let value, ival, i;
    let max_sqr = 0;
    let max_tnd = 0;

    this.square_table = new Array(32 * 16);
    this.tnd_table = new Array(204 * 16);

    for (i = 0; i < 32 * 16; i++) {
      value = 95.52 / (8128.0 / (i / 16.0) + 100.0);
      value *= 0.98411;
      value *= 50000.0;
      ival = Math.floor(value);

      this.square_table[i] = ival;
      if (ival > max_sqr) {
        max_sqr = ival;
      }
    }

    for (i = 0; i < 204 * 16; i++) {
      value = 163.67 / (24329.0 / (i / 16.0) + 100.0);
      value *= 0.98411;
      value *= 50000.0;
      ival = Math.floor(value);

      this.tnd_table[i] = ival;
      if (ival > max_tnd) {
        max_tnd = ival;
      }
    }

    this.dacRange = max_sqr + max_tnd;
    this.dcValue = this.dacRange / 2;
  }

  toJSON() {
    let obj = toJSON(this);
    obj.dmc = this.dmc.toJSON();
    obj.noise = this.noise.toJSON();
    obj.square1 = this.square1.toJSON();
    obj.square2 = this.square2.toJSON();
    obj.triangle = this.triangle.toJSON();
    return obj;
  }

  fromJSON(s) {
    fromJSON(this, s);
    this.dmc.fromJSON(s.dmc);
    this.noise.fromJSON(s.noise);
    this.square1.fromJSON(s.square1);
    this.square2.fromJSON(s.square2);
    this.triangle.fromJSON(s.triangle);
  }

  static JSON_PROPERTIES = [
    "channelEnableValue",
    "sampleRate",
    "frameIrqEnabled",
    "frameIrqActive",
    "frameIrqClearPending",
    "apuCycleParity",
    "startedPlaying",
    "recordOutput",
    "frameCycleCounter",
    "frameStep",
    "countSequence",
    "sampleTimer",
    "sampleTimerMax",
    "sampleCount",
    "triValue",
    "smpSquare1",
    "smpSquare2",
    "smpTriangle",
    "smpDmc",
    "accCount",
    "prevSampleL",
    "prevSampleR",
    "smpAccumL",
    "smpAccumR",
    "masterVolume",
    "stereoPosLSquare1",
    "stereoPosLSquare2",
    "stereoPosLTriangle",
    "stereoPosLNoise",
    "stereoPosLDMC",
    "stereoPosRSquare1",
    "stereoPosRSquare2",
    "stereoPosRTriangle",
    "stereoPosRNoise",
    "stereoPosRDMC",
    "extraCycles",
    "maxSample",
    "minSample",
    "panning",
  ];
}

export default PAPU;
`, type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/ppu/index.js": { text: `import Tile from "../tile.js";
import { fromJSON, toJSON } from "../utils.js";
import NameTable from "./nametable.js";
import PaletteTable from "./palette-table.js";

class PPU {
  // Status flags:
  STATUS_VRAMWRITE = 4;
  STATUS_SLSPRITECOUNT = 5;
  STATUS_SPRITE0HIT = 6;
  STATUS_VBLANK = 7;

  constructor(nes) {
    this.nes = nes;

    // Rendering Options:
    this.showSpr0Hit = false;
    this.clipToTvSize = true;

    let i;

    // Memory (Uint8Array is zero-initialized)
    this.vramMem = new Uint8Array(0x8000);
    this.spriteMem = new Uint8Array(0x100);

    // VRAM I/O:
    this.vramAddress = null;
    this.vramTmpAddress = null;
    this.vramBufferedReadValue = 0;
    this.firstWrite = true; // VRAM/Scroll Hi/Lo latch
    // PPU has its own internal I/O bus. All PPU register writes update this
    // latch. Reading write-only registers ($2000,$2001,$2003,$2005,$2006)
    // returns this value. $2002 uses bits 4-0 from this latch.
    // On real hardware the latch decays to 0 per-bit after ~600ms.
    this.openBusLatch = 0;
    this.openBusDecayFrames = 0;

    // SPR-RAM I/O:
    this.sramAddress = 0; // 8-bit only.

    this.currentMirroring = -1;
    // NMI edge detection state. On real hardware, /NMI is level-sensitive but
    // the PPU only asserts it on a rising edge: when (vblankFlag AND nmiEnabled)
    // transitions from false to true. See https://www.nesdev.org/wiki/NMI
    this.nmiOutput = false; // Current NMI output level
    this.nmiSuppressed = false; // Suppresses VBlank set when $2002 read at dot 0
    // Set by endScanline(261) to indicate that a full frame has been rendered
    // and VBlank should fire at dot 1 of scanline 0. Prevents premature VBlank
    // on the first frame when the PPU starts at scanline 0.
    this.vblankPending = false;
    // Set by step() when VBlank fires, signals frame loop to break.
    this.frameEnded = false;
    this.dummyCycleToggle = false;
    this.validTileData = false;
    this.scanlineAlreadyRendered = null;

    // Control Flags Register 1:
    this.f_nmiOnVblank = 0; // NMI on VBlank. 0=disable, 1=enable
    this.f_spriteSize = 0; // Sprite size. 0=8x8, 1=8x16
    this.f_bgPatternTable = 0; // Background Pattern Table address. 0=0x0000,1=0x1000
    this.f_spPatternTable = 0; // Sprite Pattern Table address. 0=0x0000,1=0x1000
    this.f_addrInc = 0; // PPU Address Increment. 0=1,1=32
    this.f_nTblAddress = 0; // Name Table Address. 0=0x2000,1=0x2400,2=0x2800,3=0x2C00

    // Control Flags Register 2:
    this.f_color = 0; // Background color. 0=black, 1=blue, 2=green, 4=red
    this.f_spVisibility = 0; // Sprite visibility. 0=not displayed,1=displayed
    this.f_bgVisibility = 0; // Background visibility. 0=Not Displayed,1=displayed
    this.f_spClipping = 0; // Sprite clipping. 0=Sprites invisible in left 8-pixel column,1=No clipping
    this.f_bgClipping = 0; // Background clipping. 0=BG invisible in left 8-pixel column, 1=No clipping
    this.f_dispType = 0; // Display type. 0=color, 1=monochrome

    // Counters:
    this.cntFV = 0;
    this.cntV = 0;
    this.cntH = 0;
    this.cntVT = 0;
    this.cntHT = 0;

    // Registers:
    this.regFV = 0;
    this.regV = 0;
    this.regH = 0;
    this.regVT = 0;
    this.regHT = 0;
    this.regFH = 0;
    this.regS = 0;

    // These are temporary variables used in rendering and sound procedures.
    // Their states outside of those procedures can be ignored.
    // TODO: the use of this is a bit weird, investigate
    this.curNt = null;

    // Variables used when rendering:
    this.attrib = new Uint8Array(32);
    this.buffer = new Uint32Array(256 * 240);
    this.bgbuffer = new Uint32Array(256 * 240);
    this.pixrendered = new Uint32Array(256 * 240);

    this.validTileData = null;

    this.scantile = new Array(32);

    // Initialize misc vars:
    this.scanline = 0;
    this.lastRenderedScanline = -1;
    this.curX = 0;

    // Sprite data (unpacked from primary OAM for quick access):
    this.sprX = new Uint8Array(64); // X coordinate
    this.sprY = new Uint8Array(64); // Y coordinate
    this.sprTile = new Uint8Array(64); // Tile Index (into pattern table)
    this.sprCol = new Uint8Array(64); // Upper two bits of color
    this.vertFlip = new Uint8Array(64); // Vertical Flip (0/1)
    this.horiFlip = new Uint8Array(64); // Horizontal Flip (0/1)
    this.bgPriority = new Uint8Array(64); // Background priority (0/1)
    this.spr0HitX = 0; // Sprite #0 hit X coordinate
    this.spr0HitY = 0; // Sprite #0 hit Y coordinate
    this.hitSpr0 = false;

    // Secondary OAM: 32 bytes (8 sprites \xD7 4 bytes each).
    // On real hardware, the PPU evaluates sprites during cycles 65-256 of each
    // visible scanline, copying in-range sprites into this buffer. Only these
    // sprites (max 8) are rendered on the next scanline.
    // This buffer persists across scanlines \u2014 it is NOT cleared on the
    // pre-render scanline, so stale data from the last evaluation can cause
    // sprites to appear on NES scanline 0.
    // See https://www.nesdev.org/wiki/PPU_sprite_evaluation
    this.secondaryOAM = new Uint8Array(32);
    this.secondaryOAM.fill(0xff); // $FF = no valid sprites (matches hardware clear)
    // How many sprites were found during the last evaluation (0-8).
    this.spritesFound = 0;
    // Whether sprite 0 (relative to OAMADDR) was in the last evaluation.
    // This determines whether sprite 0 hit detection is active.
    this.sprite0InSecondary = false;

    // Per-scanline sprite evaluation results. Evaluation on visible scanline N
    // determines which sprites appear on scanline N+1. Because jsnes uses
    // batched/lazy sprite rendering, we store results per scanline so the
    // renderer can look them up when it runs later.
    // See https://www.nesdev.org/wiki/PPU_sprite_evaluation
    //
    // Storage layout: 240 scanlines \xD7 up to 8 sprites \xD7 4 bytes = flat arrays.
    this.scanlineSpriteCount = new Uint8Array(241); // +1 for buffer
    this.scanlineSecondaryOAM = new Uint8Array(241 * 32);
    this.scanlineSprite0 = new Uint8Array(241); // 1 if sprite 0 present

    // Palette data:
    this.sprPalette = new Uint32Array(16);
    this.imgPalette = new Uint32Array(16);

    // Create pattern table tile buffers:
    this.ptTile = new Array(512);
    for (i = 0; i < 512; i++) {
      this.ptTile[i] = new Tile();
    }

    // Create nametable buffers:
    // Name table data:
    this.ntable1 = new Array(4);
    this.currentMirroring = -1;
    this.nameTable = new Array(4);
    for (i = 0; i < 4; i++) {
      this.nameTable[i] = new NameTable(32, 32, \`Nt\${i}\`);
    }

    // Initialize mirroring lookup table:
    this.vramMirrorTable = new Uint16Array(0x8000);
    for (i = 0; i < 0x8000; i++) {
      this.vramMirrorTable[i] = i;
    }

    this.palTable = new PaletteTable();
    this.palTable.loadNTSCPalette();
    //this.palTable.loadDefaultPalette();

    this.updateControlReg1(0);
    this.updateControlReg2(0);
  }

  // Sets Nametable mirroring.
  setMirroring(mirroring) {
    if (mirroring === this.currentMirroring) {
      return;
    }

    this.currentMirroring = mirroring;
    this.triggerRendering();

    // Remove mirroring:
    if (this.vramMirrorTable === null) {
      this.vramMirrorTable = new Uint16Array(0x8000);
    }
    for (let i = 0; i < 0x8000; i++) {
      this.vramMirrorTable[i] = i;
    }

    // Palette mirroring:
    this.defineMirrorRegion(0x3f20, 0x3f00, 0x20);
    this.defineMirrorRegion(0x3f40, 0x3f00, 0x20);
    this.defineMirrorRegion(0x3f80, 0x3f00, 0x20);
    this.defineMirrorRegion(0x3fc0, 0x3f00, 0x20);

    // Additional mirroring:
    this.defineMirrorRegion(0x3000, 0x2000, 0xf00);
    this.defineMirrorRegion(0x4000, 0x0000, 0x4000);

    if (mirroring === this.nes.rom.HORIZONTAL_MIRRORING) {
      // Horizontal mirroring.

      this.ntable1[0] = 0;
      this.ntable1[1] = 0;
      this.ntable1[2] = 1;
      this.ntable1[3] = 1;

      this.defineMirrorRegion(0x2400, 0x2000, 0x400);
      this.defineMirrorRegion(0x2c00, 0x2800, 0x400);
    } else if (mirroring === this.nes.rom.VERTICAL_MIRRORING) {
      // Vertical mirroring.

      this.ntable1[0] = 0;
      this.ntable1[1] = 1;
      this.ntable1[2] = 0;
      this.ntable1[3] = 1;

      this.defineMirrorRegion(0x2800, 0x2000, 0x400);
      this.defineMirrorRegion(0x2c00, 0x2400, 0x400);
    } else if (mirroring === this.nes.rom.SINGLESCREEN_MIRRORING) {
      // Single Screen mirroring

      this.ntable1[0] = 0;
      this.ntable1[1] = 0;
      this.ntable1[2] = 0;
      this.ntable1[3] = 0;

      this.defineMirrorRegion(0x2400, 0x2000, 0x400);
      this.defineMirrorRegion(0x2800, 0x2000, 0x400);
      this.defineMirrorRegion(0x2c00, 0x2000, 0x400);
    } else if (mirroring === this.nes.rom.SINGLESCREEN_MIRRORING2) {
      this.ntable1[0] = 1;
      this.ntable1[1] = 1;
      this.ntable1[2] = 1;
      this.ntable1[3] = 1;

      this.defineMirrorRegion(0x2400, 0x2400, 0x400);
      this.defineMirrorRegion(0x2800, 0x2400, 0x400);
      this.defineMirrorRegion(0x2c00, 0x2400, 0x400);
    } else {
      // Assume Four-screen mirroring.

      this.ntable1[0] = 0;
      this.ntable1[1] = 1;
      this.ntable1[2] = 2;
      this.ntable1[3] = 3;
    }
  }

  // Define a mirrored area in the address lookup table.
  // Assumes the regions don't overlap.
  // The 'to' region is the region that is physically in memory.
  defineMirrorRegion(fromStart, toStart, size) {
    for (let i = 0; i < size; i++) {
      this.vramMirrorTable[fromStart + i] = toStart + i;
    }
  }

  startVBlank() {
    // NMI is now handled by _updateNmiOutput() edge detection \u2014 the VBlank
    // flag is set at dot 1 of scanline 0 in the frame/catch-up loops, which
    // call _updateNmiOutput() to fire NMI on the rising edge.

    // PPU open bus latch decay: on real hardware each bit decays to 0
    // after ~600ms (~36 frames). We use a simple per-latch frame counter.
    if (this.openBusDecayFrames > 0) {
      this.openBusDecayFrames--;
      if (this.openBusDecayFrames === 0) {
        this.openBusLatch = 0;
      }
    }

    // Make sure everything is rendered:
    if (this.lastRenderedScanline < 239) {
      this.renderFramePartially(
        this.lastRenderedScanline + 1,
        240 - this.lastRenderedScanline,
      );
    }

    // End frame:
    this.endFrame();

    // Reset scanline counter:
    this.lastRenderedScanline = -1;
  }

  // Fire the VBlank set event at dot 1 of scanline 0 (NES scanline 241).
  // dotsRemaining is the number of dots left in the current advanceDots()
  // call (including the VBlank dot), used for NMI delay calculation.
  // 0 means VBlank fires at the boundary between steps.
  _fireVblankSet(cpu, dotsRemaining) {
    this.vblankPending = false;
    if (!this.nmiSuppressed) {
      this.setStatusFlag(this.STATUS_VBLANK, true);
      this._updateNmiOutput();
      if (cpu.nmiRaised) {
        cpu.nmiDotsRemainingInStep = dotsRemaining;
      }
    }
    this.nmiSuppressed = false;
    this.startVBlank();
    this.frameEnded = true;
  }

  // Fire the VBlank clear event at dot 1 of scanline 20 (NES scanline 261,
  // pre-render). isLastDot indicates whether this is the last dot of the
  // current advanceDots() call. The 6502's NMI edge detector samples at \u03C62
  // (~2/3 through the bus cycle), so we only promote nmiRaised to nmiPending
  // when \u03C62 has had time to sample the rising edge \u2014 i.e., on the last dot.
  // See https://www.nesdev.org/wiki/NMI
  _fireVblankClear(cpu, isLastDot) {
    if (cpu.nmiRaised && isLastDot) {
      cpu.nmiPending = true;
      cpu.nmiRaised = false;
    }
    this.setStatusFlag(this.STATUS_VBLANK, false);
    this.setStatusFlag(this.STATUS_SPRITE0HIT, false);
    // Sprite overflow flag is cleared at the same time as VBlank and
    // sprite 0 hit, at dot 1 of the pre-render scanline.
    // See https://www.nesdev.org/wiki/PPU_registers#PPUSTATUS
    this.setStatusFlag(this.STATUS_SLSPRITECOUNT, false);
    this.hitSpr0 = false;
    this.spr0HitX = -1;
    this.spr0HitY = -1;
    this._updateNmiOutput();
  }

  // Advance the PPU by the given number of dots. Called after every CPU bus
  // cycle with dots=3 (PPU runs at 3x CPU clock). Handles all per-dot events:
  // VBlank set/clear, sprite 0 hit, and scanline boundaries.
  //
  // Sets this.frameEnded = true when VBlank fires (scanline 0, dot 1),
  // signaling the frame loop to break after the current instruction.
  advanceDots(dots) {
    let finalCurX = this.curX + dots;

    // Fast path: skip dot-by-dot when no per-dot events can fire.
    // This handles ~99% of calls since VBlank, sprite 0, and scanline
    // boundaries are rare relative to total dots per frame.
    if (
      finalCurX < 341 &&
      !(
        this.scanline === 0 &&
        this.vblankPending &&
        this.curX <= 1 &&
        finalCurX >= 1
      ) &&
      !(this.scanline === 20 && this.curX <= 1 && finalCurX >= 1) &&
      (this.spr0HitX < this.curX || this.spr0HitX >= finalCurX)
    ) {
      this.curX = finalCurX;
      return;
    }

    // Slow path: advance dot-by-dot checking for events.
    let cpu = this.nes.cpu;
    for (let i = 0; i < dots; i++) {
      // VBlank set at dot 1 of scanline 0 (NES scanline 241).
      if (this.scanline === 0 && this.curX === 1 && this.vblankPending) {
        this._fireVblankSet(cpu, dots - i);
        this.curX++;
        continue;
      }

      // VBlank clear at dot 1 of scanline 20 (NES scanline 261, pre-render).
      if (this.scanline === 20 && this.curX === 1) {
        this._fireVblankClear(cpu, i === dots - 1);
      }

      // Sprite 0 hit check. On real hardware, sprite 0 hit requires BOTH
      // background and sprite rendering to be enabled at the hit dot.
      // See https://www.nesdev.org/wiki/PPU_OAM#Sprite_zero_hits
      if (
        this.curX === this.spr0HitX &&
        this.f_bgVisibility === 1 &&
        this.f_spVisibility === 1 &&
        this.scanline - 21 === this.spr0HitY
      ) {
        this.setStatusFlag(this.STATUS_SPRITE0HIT, true);
      }

      this.curX++;
      if (this.curX === 341) {
        this.curX = 0;
        this.endScanline();
      }
    }

    // Post-loop boundary checks: if curX landed on a VBlank or VBlank-clear
    // dot after the loop exhausted all dots, fire the event now. This handles
    // the case where the last iteration incremented curX to 1 but the loop
    // exited before the VBlank check could run at the START of the next
    // iteration. On real hardware, VBL is set at the START of dot 1, so
    // reads at that dot must see the updated state.
    // See https://www.nesdev.org/wiki/PPU_frame_timing
    if (this.scanline === 0 && this.curX === 1 && this.vblankPending) {
      this._fireVblankSet(cpu, 0);
    }
    if (this.scanline === 20 && this.curX === 1) {
      // isLastDot=true: the loop exhausted all dots so \u03C62 has sampled.
      this._fireVblankClear(cpu, true);
    }
  }

  endScanline() {
    switch (this.scanline) {
      case 19:
        // Dummy scanline.
        // May be variable length:
        if (this.dummyCycleToggle) {
          // Remove dead cycle at end of scanline,
          // for next scanline:
          this.curX = 1;
          this.dummyCycleToggle = !this.dummyCycleToggle;
        }
        break;

      case 20:
        // Pre-render scanline (NES scanline 261). VBlank and sprite 0 hit
        // flags are cleared at dot 1, handled by the frame loop and catch-up
        // loop for cycle-accurate timing.

        // OAM corruption: if OAMADDR != 0 at the beginning of the pre-render
        // scanline, the 8 bytes at (OAMADDR & $F8) overwrite OAM[0..7].
        // This happens BEFORE the OAMADDR reset at cycles 257-320.
        // See https://www.nesdev.org/wiki/PPU_OAM#Sprite_0_corruption
        this.performOAMCorruption();

        if (this.f_bgVisibility === 1 || this.f_spVisibility === 1) {
          // Update counters:
          this.cntFV = this.regFV;
          this.cntV = this.regV;
          this.cntH = this.regH;
          this.cntVT = this.regVT;
          this.cntHT = this.regHT;

          // On real hardware, the PPU runs a unified rendering pipeline
          // whenever either BG or sprites is enabled. BG tile fetches and
          // shift register loading happen regardless of which specific layer
          // flag is set. The individual visibility flags only affect the
          // final pixel output stage.
          // See https://www.nesdev.org/wiki/PPU_rendering
          if (this.f_bgVisibility === 1 || this.f_spVisibility === 1) {
            // Render dummy scanline:
            this.renderBgScanline(false, 0);
          }

          // Sprite evaluation does NOT happen on the pre-render scanline, and
          // secondary OAM is NOT cleared either. The pre-render scanline's sprite
          // tile loading (cycles 257-320) reads from the stale secondary OAM left
          // over from the last visible scanline's evaluation. If any stale sprites
          // happen to be at Y=0, they will render on NES scanline 0.
          // See https://www.nesdev.org/wiki/PPU_sprite_evaluation
          //
          // Buffer row 0 is the pre-render dummy row (no sprites).
          this.scanlineSpriteCount[0] = 0;
          this.scanlineSprite0[0] = 0;
          for (let i = 0; i < 32; i++) {
            this.scanlineSecondaryOAM[i] = 0xff;
          }

          // Buffer row 1 = NES scanline 0. Copy stale secondary OAM data from
          // the last evaluation (preserved in this.secondaryOAM). On real hardware,
          // the secondary OAM register persists and the pre-render scanline doesn't
          // clear it, allowing stale sprites to appear on scanline 0.
          // See AccuracyCoin "Sprites on Scanline 0" test.
          let scanline0Base = 1 * 32;
          for (let i = 0; i < 32; i++) {
            this.scanlineSecondaryOAM[scanline0Base + i] = this.secondaryOAM[i];
          }
          this.scanlineSpriteCount[1] = this.spritesFound;
          this.scanlineSprite0[1] = this.sprite0InSecondary ? 1 : 0;

          // OAMADDR is reset to 0 during sprite tile loading (cycles 257-320).
          this.sramAddress = 0;
        }

        if (this.f_bgVisibility === 1 && this.f_spVisibility === 1) {
          // Check sprite 0 hit for dummy scanline (buffer row 0).
          this.checkSprite0(0);
        }

        // Pre-compute sprite 0 hit for the first visible scanline (buffer
        // row 1). The dummy render above advanced the scroll counters to point
        // at row 1's vertical position, and the secondary OAM for row 1 was
        // set up from stale data above. This allows the dot-by-dot loop in
        // step() to detect the hit at the correct PPU dot during scanline 21.
        if (
          !this.hitSpr0 &&
          this.f_bgVisibility === 1 &&
          this.f_spVisibility === 1
        ) {
          if (this._precomputeSprite0Hit(1)) {
            this.hitSpr0 = true;
          }
        }

        if (this.f_bgVisibility === 1 || this.f_spVisibility === 1) {
          // Clock mapper IRQ Counter:
          this.nes.mmap.clockIrqCounter();
        }
        break;

      case 261:
        // Post-render scanline (NES scanline 240), no rendering.
        // VBlank flag is set at dot 1 of the NEXT scanline (scanline 0 / NES 241)
        // by the frame loop and catch-up loop, gated on vblankPending.
        this.vblankPending = true;

        // Wrap around:
        this.scanline = -1; // will be incremented to 0

        break;

      default:
        if (this.scanline >= 21 && this.scanline <= 260) {
          // NES visible scanline index (0-239). The PPU's internal scanline
          // counter starts at 0 for VBlank, 20 for pre-render, 21 for the
          // first visible scanline. The buffer row is scanline - 20 (1-240),
          // offset by 1 because the pre-render scanline renders row 0.
          let bufferScan = this.scanline + 1 - 21;

          // OAM corruption at the start of each visible scanline.
          // Normally OAMADDR is 0 here (reset by evaluation on the previous
          // scanline), but writes to $2003 during rendering can trigger this.
          this.performOAMCorruption();

          // Render normally. On real hardware the PPU runs a unified
          // rendering pipeline when either BG or sprites is enabled \u2014 BG
          // tile fetches, shift register loading, and VRAM address
          // increments all happen regardless of which layer flag is set.
          // The individual visibility flags only suppress the final pixel
          // output. We must always populate bgbuffer/pixrendered so that
          // sprite 0 hit detection works even when BG was briefly disabled.
          // See https://www.nesdev.org/wiki/PPU_rendering
          if (this.f_bgVisibility === 1 || this.f_spVisibility === 1) {
            if (!this.scanlineAlreadyRendered) {
              // update scroll:
              this.cntHT = this.regHT;
              this.cntH = this.regH;
              this.renderBgScanline(true, bufferScan);
            }
            this.scanlineAlreadyRendered = false;

            // Check for sprite 0 hit on this scanline.
            // Only check if sprite 0 is in the secondary OAM for this scanline
            // (determined by evaluation on the previous scanline).
            // Sprite 0 hit requires BOTH BG and sprite rendering to be enabled.
            if (
              !this.hitSpr0 &&
              this.f_bgVisibility === 1 &&
              this.f_spVisibility === 1 &&
              this.scanlineSprite0[bufferScan]
            ) {
              if (this.checkSprite0(bufferScan)) {
                this.hitSpr0 = true;
              }
            }
          }

          // Evaluate sprites for the NEXT scanline. On real hardware this
          // happens during cycles 65-256 of each visible scanline. Evaluation
          // on scanline N determines sprites for scanline N+1.
          // The evaluation target is bufferScan+1 because sprites have a +1 Y
          // offset (sprite Y=0 renders on display row 1, not row 0).
          // See https://www.nesdev.org/wiki/PPU_sprite_evaluation
          if (bufferScan < 240) {
            this.evaluateSprites(bufferScan + 1);
          }

          // Pre-compute sprite 0 hit for the NEXT visible scanline. The BG
          // render above advanced the scroll counters to the next row, and
          // evaluateSprites just set up the secondary OAM for the next row.
          // By detecting the hit now, step()'s dot loop will see spr0HitX/Y
          // when processing the next scanline's dots, allowing the hit flag
          // to be set at the correct PPU cycle.
          if (
            !this.hitSpr0 &&
            this.f_bgVisibility === 1 &&
            this.f_spVisibility === 1
          ) {
            this._precomputeSprite0Hit(bufferScan + 1);
            if (this.spr0HitX !== -1) {
              this.hitSpr0 = true;
            }
          }

          if (this.f_bgVisibility === 1 || this.f_spVisibility === 1) {
            // Clock mapper IRQ Counter:
            this.nes.mmap.clockIrqCounter();
          }
        }
    }

    this.scanline++;
    this.regsToAddress();
    this.cntsToAddress();
  }

  startFrame() {
    // Clear per-scanline sprite evaluation data from the previous frame.
    // scanlineSpriteCount is set to 0 so no sprites render on un-evaluated
    // scanlines. scanlineSprite0 is cleared to prevent stale sprite 0 hits.
    // Note: the pre-render scanline handler (case 20 in endScanline) may
    // later set scanlineSpriteCount[1] with stale data from the hardware
    // secondary OAM, allowing sprites to appear on NES scanline 0.
    // We don't need to clear scanlineSecondaryOAM here because:
    // - Evaluated scanlines fill it in evaluateSprites() (phase 1 clear)
    // - The pre-render handler fills row 1 from stale secondaryOAM
    // - scanlineSecondaryOAM for other non-evaluated rows is never read
    //   because their scanlineSpriteCount is 0
    this.scanlineSpriteCount.fill(0);
    this.scanlineSprite0.fill(0);

    // Set background color:
    let bgColor;

    if (this.f_dispType === 0) {
      // Color display.
      // f_color determines color emphasis.
      // Use first entry of image palette as BG color.
      bgColor = this.imgPalette[0];
    } else {
      // Monochrome display.
      // f_color determines the bg color.
      switch (this.f_color) {
        case 0:
          // Black
          bgColor = 0x00000;
          break;
        case 1:
          // Green
          bgColor = 0x00ff00;
          break;
        case 2:
          // Blue
          bgColor = 0x0000ff;
          break;
        case 3:
          // Invalid. Use black.
          bgColor = 0x000000;
          break;
        case 4:
          // Red
          bgColor = 0xff0000;
          break;
        default:
          // Invalid. Use black.
          bgColor = 0x0;
      }
    }

    this.buffer.fill(bgColor);
    this.pixrendered.fill(65);
  }

  endFrame() {
    let i, y;
    let buffer = this.buffer;

    // Draw spr#0 hit coordinates:
    if (this.showSpr0Hit) {
      // Spr 0 position:
      if (
        this.sprX[0] >= 0 &&
        this.sprX[0] < 256 &&
        this.sprY[0] >= 0 &&
        this.sprY[0] < 240
      ) {
        for (i = 0; i < 256; i++) {
          buffer[(this.sprY[0] << 8) + i] = 0xff5555;
        }
        for (i = 0; i < 240; i++) {
          buffer[(i << 8) + this.sprX[0]] = 0xff5555;
        }
      }
      // Hit position:
      if (
        this.spr0HitX >= 0 &&
        this.spr0HitX < 256 &&
        this.spr0HitY >= 0 &&
        this.spr0HitY < 240
      ) {
        for (i = 0; i < 256; i++) {
          buffer[(this.spr0HitY << 8) + i] = 0x55ff55;
        }
        for (i = 0; i < 240; i++) {
          buffer[(i << 8) + this.spr0HitX] = 0x55ff55;
        }
      }
    }

    // This is a bit lazy..
    // if either the sprites or the background should be clipped,
    // both are clipped after rendering is finished.
    if (
      this.clipToTvSize ||
      this.f_bgClipping === 0 ||
      this.f_spClipping === 0
    ) {
      // Clip left 8-pixels column:
      for (y = 0; y < 240; y++) {
        buffer.fill(0, y << 8, (y << 8) + 8);
      }
    }

    if (this.clipToTvSize) {
      // Clip right 8-pixels column too:
      for (y = 0; y < 240; y++) {
        buffer.fill(0, (y << 8) + 248, (y << 8) + 256);
      }

      // Clip top and bottom 8 pixels:
      buffer.fill(0, 0, 8 << 8);
      buffer.fill(0, 232 << 8, 240 << 8);
    }

    this.nes.ui.writeFrame(buffer);
  }

  updateControlReg1(value) {
    this.triggerRendering();

    this.f_nmiOnVblank = (value >> 7) & 1;
    this.f_spriteSize = (value >> 5) & 1;
    this.f_bgPatternTable = (value >> 4) & 1;
    this.f_spPatternTable = (value >> 3) & 1;
    this.f_addrInc = (value >> 2) & 1;
    this.f_nTblAddress = value & 3;

    this.regV = (value >> 1) & 1;
    this.regH = value & 1;
    this.regS = (value >> 4) & 1;

    // Writing $2000 can toggle NMI enable while VBlank is active. If NMI is
    // enabled during VBlank, a rising edge fires NMI. If disabled, a pending
    // NMI is cancelled. See https://www.nesdev.org/wiki/NMI
    this._updateNmiOutput();
  }

  // Recomputes the NMI output level from (vblankFlag AND nmiEnabled).
  // On a false\u2192true transition (rising edge), sets nmiRaised on the CPU.
  // On a true\u2192false transition (falling edge), may cancel a not-yet-latched
  // NMI edge.
  //
  // On real 6502 hardware, the NMI edge detector samples the /NMI line at
  // \u03C62 of each CPU cycle. Once a falling edge is detected (line goes low),
  // the internal NMI signal is latched and held until the NMI handler
  // begins executing \u2014 even if /NMI goes back high on the very next cycle.
  //
  // The edge detector needs the NMI output to be stably asserted before \u03C62
  // to latch. Two cases where the edge is NOT latched:
  //
  // 1. Same bus cycle: NMI output went high\u2192low within one bus cycle.
  //    The edge detector never saw a stable assertion at \u03C62.
  //
  // 2. Post-loop boundary: NMI output went high at the very end of a
  //    step() call (post-loop check, nmiDotsRemainingInStep=0), right at
  //    the \u03C62 boundary. If the NEXT bus cycle immediately causes a falling
  //    edge (e.g., $2002 read clearing VBL) BEFORE its step() runs, the
  //    edge detector at the next \u03C62 sees the line deasserted. This models
  //    the PPU\u2192CPU propagation delay for NMI output changes right at \u03C62.
  //
  // nmiPending (promoted from a previous instruction) is never cleared.
  // See https://www.nesdev.org/wiki/NMI
  _updateNmiOutput() {
    let vblank = (this.nes.cpu.mem[0x2002] & 0x80) !== 0;
    let newOutput = this.f_nmiOnVblank !== 0 && vblank;
    if (newOutput && !this.nmiOutput) {
      // Rising edge: set nmiRaised. At the end of the current instruction,
      // the CPU checks how many bus cycles remained after this edge to
      // determine 0-delay (immediate) vs 1-delay NMI.
      this.nes.cpu.nmiRaised = true;
      this.nes.cpu.nmiRaisedAtCycle = this.nes.cpu.instrBusCycles;
    } else if (!newOutput && this.nmiOutput) {
      // Falling edge: cancel nmiRaised only if it hasn't been latched yet.
      if (this.nes.cpu.nmiRaised) {
        let busCycleDiff =
          this.nes.cpu.instrBusCycles - this.nes.cpu.nmiRaisedAtCycle;
        if (
          busCycleDiff === 0 ||
          (busCycleDiff === 1 && this.nes.cpu.nmiDotsRemainingInStep === 0)
        ) {
          // Case 1: same bus cycle, or Case 2: post-loop edge on the
          // immediately previous bus cycle. Edge not latched \u2014 cancel.
          this.nes.cpu.nmiRaised = false;
        }
        // else: edge was latched at a previous \u03C62, don't cancel.
      }
    }
    this.nmiOutput = newOutput;
  }

  updateControlReg2(value) {
    this.triggerRendering();

    this.f_color = (value >> 5) & 7;
    this.f_spVisibility = (value >> 4) & 1;
    this.f_bgVisibility = (value >> 3) & 1;
    this.f_spClipping = (value >> 2) & 1;
    this.f_bgClipping = (value >> 1) & 1;
    this.f_dispType = value & 1;

    // When both BG and sprite rendering become enabled mid-scanline,
    // re-check sprite 0 hit. The unified PPU pipeline populates BG shift
    // registers whenever either flag is set, so BG tile data exists in
    // pixrendered even if only sprites were previously enabled. Re-enabling
    // BG mid-scanline can trigger sprite 0 hit against this data.
    if (
      !this.hitSpr0 &&
      this.f_bgVisibility === 1 &&
      this.f_spVisibility === 1 &&
      this.scanline >= 21 &&
      this.scanline <= 260
    ) {
      let bufferScan = this.scanline + 1 - 21;
      if (this.scanlineSprite0[bufferScan]) {
        if (this.checkSprite0(bufferScan)) {
          this.hitSpr0 = true;
        }
      }
    }

    if (this.f_dispType === 0) {
      this.palTable.setEmphasis(this.f_color);
    }
    this.updatePalettes();
  }

  setStatusFlag(flag, value) {
    let n = 1 << flag;
    this.nes.cpu.mem[0x2002] =
      (this.nes.cpu.mem[0x2002] & (255 - n)) | (value ? n : 0);
  }

  // CPU Register $2002:
  // Read the Status Register.
  readStatusRegister() {
    let tmp = this.nes.cpu.mem[0x2002];

    // Reset scroll & VRAM Address toggle:
    this.firstWrite = true;

    // NMI suppression: reading $2002 one PPU dot BEFORE VBlank is set
    // (curX=0 of scanline 0 / NES scanline 241) causes the VBL flag to
    // never be set for this frame, suppressing both the flag and NMI.
    // The read itself correctly returns VBL=0 (it hasn't been set yet).
    //
    // At curX=1 (the exact VBL set dot), the post-loop check in
    // _ppuCatchUp() already fired VBlank, so VBL=1 here. The read sees
    // VBL=1, clears the flag, and _updateNmiOutput() below cancels NMI
    // (the flag was held for less than 1 CPU cycle). This matches Mesen's
    // behavior where VBL reads as SET at the simultaneous dot.
    //
    // See https://www.nesdev.org/wiki/PPU_frame_timing
    if (this.scanline === 0 && this.curX === 0) {
      this.nmiSuppressed = true;
    }

    // Clear VBlank flag:
    this.setStatusFlag(this.STATUS_VBLANK, false);

    // Clearing VBlank may cause a falling edge on NMI output, cancelling
    // any pending NMI.
    this._updateNmiOutput();

    // Only bits 7-5 come from the status register; bits 4-0 are open bus.
    tmp = (tmp & 0xe0) | (this.openBusLatch & 0x1f);
    this.openBusLatch = tmp;
    this.openBusDecayFrames = 36; // ~600ms at 60fps

    // Fetch status data:
    return tmp;
  }

  // CPU Register $2003:
  // Write the SPR-RAM address that is used for sramWrite (Register 0x2004 in CPU memory map)
  writeSRAMAddress(address) {
    this.sramAddress = address;
  }

  // CPU Register $2004 (R):
  // Read from SPR-RAM (Sprite RAM / OAM).
  // During rendering, returns phase-dependent values instead of normal OAM:
  //  - Cycles 1-64 (secondary OAM clear): returns $FF
  //  - Cycles 65-256 (sprite evaluation): returns the byte being read
  //  - Cycles 257-320 (sprite tile loading): returns secondary OAM data
  // During VBlank or when rendering is disabled, returns OAM[OAMADDR] normally.
  // Bits 2-4 of byte 2 (attributes) always read as 0 (unimplemented bits).
  // See https://www.nesdev.org/wiki/PPU_registers#OAMDATA
  sramLoad() {
    let renderingEnabled =
      this.f_spVisibility === 1 || this.f_bgVisibility === 1;

    // During visible or pre-render scanlines with rendering enabled,
    // $2004 reads return internal PPU sprite data, not OAM directly.
    // See https://www.nesdev.org/wiki/PPU_registers#OAMDATA
    if (renderingEnabled && this.scanline >= 20 && this.scanline <= 260) {
      let dot = this.curX;
      if (dot <= 64) {
        // Dots 0-64: secondary OAM clear phase (dots 1-64, plus idle dot 0).
        // $2004 reads always return $FF because the internal clear signal
        // forces the OAM read bus to $FF.
        return 0xff;
      } else if (dot <= 256) {
        // Dots 65-256: sprite evaluation phase. $2004 returns the OAM byte
        // currently being read by the evaluation logic. We approximate this
        // by returning OAM[OAMADDR] since OAMADDR tracks the evaluation
        // read pointer during this phase.
        // Bits 2-4 of attribute bytes (byte 2 of each entry) always read as 0.
        let val = this.spriteMem[this.sramAddress];
        if ((this.sramAddress & 3) === 2) {
          val &= 0xe3;
        }
        return val;
      } else {
        // Dots 257-340: sprite tile loading and background prefetch.
        // $2004 reads return $FF during this entire phase. The PPU's
        // internal OAM read bus is not driven by the evaluation logic.
        // See AccuracyCoin "$2004 behavior" test.
        return 0xff;
      }
    }

    // Normal read during VBlank or rendering disabled.
    // Bits 2-4 of attribute byte are unimplemented, always read as 0.
    let value = this.spriteMem[this.sramAddress];
    if ((this.sramAddress & 3) === 2) {
      value &= 0xe3;
    }
    return value;
  }

  // CPU Register $2004 (W):
  // Write to SPR-RAM (Sprite RAM).
  // The address should be set first.
  sramWrite(value) {
    let renderingEnabled =
      this.f_spVisibility === 1 || this.f_bgVisibility === 1;

    if (renderingEnabled && this.scanline >= 20 && this.scanline <= 260) {
      // During rendering on visible/pre-render scanlines, writes to $2004
      // are suppressed (value is NOT stored to OAM). Instead, OAMADDR is
      // incremented by 4 and ANDed with $FC, matching the hardware's
      // internal evaluation counter behavior.
      // See https://www.nesdev.org/wiki/PPU_registers#OAMDATA
      this.sramAddress = (this.sramAddress + 4) & 0xfc;
    } else {
      // Normal write during VBlank or rendering disabled
      this.spriteMem[this.sramAddress] = value;
      this.spriteRamWriteUpdate(this.sramAddress, value);
      this.sramAddress++;
      this.sramAddress %= 0x100;
    }
  }

  // CPU Register $2005:
  // Write to scroll registers.
  // The first write is the vertical offset, the second is the
  // horizontal offset:
  scrollWrite(value) {
    this.triggerRendering();

    if (this.firstWrite) {
      // First write, horizontal scroll:
      this.regHT = (value >> 3) & 31;
      this.regFH = value & 7;
    } else {
      // Second write, vertical scroll:
      this.regFV = value & 7;
      this.regVT = (value >> 3) & 31;
    }
    this.firstWrite = !this.firstWrite;
  }

  // CPU Register $2006:
  // Sets the adress used when reading/writing from/to VRAM.
  // The first write sets the high byte, the second the low byte.
  writeVRAMAddress(address) {
    if (this.firstWrite) {
      this.regFV = (address >> 4) & 3;
      this.regV = (address >> 3) & 1;
      this.regH = (address >> 2) & 1;
      this.regVT = (this.regVT & 7) | ((address & 3) << 3);
    } else {
      this.triggerRendering();

      this.regVT = (this.regVT & 24) | ((address >> 5) & 7);
      this.regHT = address & 31;

      this.cntFV = this.regFV;
      this.cntV = this.regV;
      this.cntH = this.regH;
      this.cntVT = this.regVT;
      this.cntHT = this.regHT;

      this.checkSprite0(this.scanline + 1 - 21);
    }

    this.firstWrite = !this.firstWrite;

    // Invoke mapper latch:
    this.cntsToAddress();
    if (this.vramAddress < 0x2000) {
      this.nes.mmap.latchAccess(this.vramAddress);
    }
  }

  // CPU Register $2007(R):
  // Read from PPU memory. The address should be set first.
  vramLoad() {
    let tmp;

    this.cntsToAddress();
    this.regsToAddress();

    // If address is in range 0x0000-0x3EFF, return buffered values:
    if (this.vramAddress <= 0x3eff) {
      tmp = this.vramBufferedReadValue;

      // Update buffered value:
      if (this.vramAddress < 0x2000) {
        this.vramBufferedReadValue = this.vramMem[this.vramAddress];
      } else {
        this.vramBufferedReadValue = this.mirroredLoad(this.vramAddress);
      }

      // Mapper latch access:
      if (this.vramAddress < 0x2000) {
        this.nes.mmap.latchAccess(this.vramAddress);
      }

      this._incrementVramAddress();

      this.cntsFromAddress();
      this.regsFromAddress();

      return tmp; // Return the previous buffered value.
    }

    // Palette RAM ($3F00-$3FFF): value is returned directly (no buffer
    // delay), but the read buffer is loaded with the nametable data
    // "behind" the palette at (address & $2FFF).
    // Palette RAM is only 32 bytes; addresses mirror every $20 bytes.
    // Backdrop mirrors: $3F10/$3F14/$3F18/$3F1C \u2192 $3F00/$3F04/$3F08/$3F0C.
    // Values are 6-bit; upper 2 bits come from the PPU open bus latch.
    // See https://www.nesdev.org/wiki/PPU_palettes
    let palIdx = this.vramAddress & 0x1f;
    if ((palIdx & 0x13) === 0x10) {
      palIdx &= 0x0f; // backdrop mirror
    }
    tmp = (this.vramMem[0x3f00 + palIdx] & 0x3f) | (this.openBusLatch & 0xc0);

    // Update buffer with nametable data behind the palette
    this.vramBufferedReadValue = this.mirroredLoad(this.vramAddress & 0x2fff);

    this._incrementVramAddress();

    this.cntsFromAddress();
    this.regsFromAddress();

    return tmp;
  }

  // CPU Register $2007(W):
  // Write to PPU memory. The address should be set first.
  vramWrite(value) {
    this.triggerRendering();
    this.cntsToAddress();
    this.regsToAddress();

    if (this.vramAddress >= 0x2000) {
      // Mirroring is used.
      this.mirroredWrite(this.vramAddress, value);
    } else {
      // Pattern table ($0000-$1FFF): writable if CHR RAM is mapped here.
      // The mapper decides \u2014 most mappers allow writes only when there's no
      // CHR ROM at all, but some (e.g. TQROM/mapper 119) have both CHR ROM
      // and CHR RAM and allow writes to CHR RAM-mapped regions.
      if (this.nes.mmap.canWriteChr(this.vramAddress)) {
        this.writeMem(this.vramAddress, value);
      }

      // Invoke mapper latch:
      this.nes.mmap.latchAccess(this.vramAddress);
    }

    this._incrementVramAddress();
    this.regsFromAddress();
    this.cntsFromAddress();
  }

  // CPU Register $4014:
  // Write 256 bytes of main memory into Sprite RAM (OAM).
  // DMA always copies exactly 256 bytes from CPU page $XX00-$XXFF.
  // The destination starts at the current OAMADDR and wraps within OAM.
  // See https://www.nesdev.org/wiki/PPU_registers#OAMDMA
  sramDMA(value) {
    let baseAddress = value * 0x100;
    let data;
    for (let i = 0; i < 256; i++) {
      data = this.nes.cpu.mem[baseAddress + i];
      let oamAddr = (this.sramAddress + i) & 0xff;
      this.spriteMem[oamAddr] = data;
      this.spriteRamWriteUpdate(oamAddr, data);
    }

    // OAM DMA takes 513 CPU cycles (1 wait + 256 read/write pairs), plus
    // an extra alignment cycle if the CPU is on an odd cycle (a "put" cycle).
    // This ensures the DMA always begins on an even cycle, synchronizing the
    // CPU to a known cycle parity. The AccuracyCoin controller strobe test
    // relies on this alignment to verify APU-clock-gated OUT0 behavior.
    // See https://www.nesdev.org/wiki/DMA#OAM_DMA
    let cpu = this.nes.cpu;
    let currentCycle = cpu._cpuCycleBase + cpu.instrBusCycles;
    let cycles = currentCycle % 2 === 0 ? 514 : 513;
    cpu.haltCycles(cycles);
  }

  // Updates the scroll registers from a new VRAM address.
  regsFromAddress() {
    let address = (this.vramTmpAddress >> 8) & 0xff;
    this.regFV = (address >> 4) & 7;
    this.regV = (address >> 3) & 1;
    this.regH = (address >> 2) & 1;
    this.regVT = (this.regVT & 7) | ((address & 3) << 3);

    address = this.vramTmpAddress & 0xff;
    this.regVT = (this.regVT & 24) | ((address >> 5) & 7);
    this.regHT = address & 31;
  }

  // Increments the VRAM address after a $2007 read or write. During active
  // rendering (either BG or sprites enabled on a visible/pre-render scanline),
  // the increment behaves differently: instead of the normal +1 or +32 linear
  // increment, the PPU performs simultaneous coarse X and Y increments with
  // proper wrapping. This is because the v register is being used as part of
  // the rendering address logic, not as a simple pointer.
  // See https://www.nesdev.org/wiki/PPU_scrolling#$2007_reads_and_writes
  // See https://www.nesdev.org/wiki/PPU_registers#PPUDATA
  _incrementVramAddress() {
    let renderingEnabled =
      this.f_spVisibility === 1 || this.f_bgVisibility === 1;
    // jsnes scanlines 20-260 = NES pre-render + visible scanlines
    let onRenderingScanline = this.scanline >= 20 && this.scanline <= 260;

    if (renderingEnabled && onRenderingScanline) {
      // Coarse X increment (with horizontal nametable toggle on overflow)
      if ((this.vramAddress & 0x001f) === 31) {
        this.vramAddress &= ~0x001f; // coarse X = 0
        this.vramAddress ^= 0x0400; // toggle horizontal nametable
      } else {
        this.vramAddress += 1;
      }

      // Y increment: fine Y first, then coarse Y on overflow
      if ((this.vramAddress & 0x7000) !== 0x7000) {
        this.vramAddress += 0x1000; // fine Y += 1
      } else {
        this.vramAddress &= ~0x7000; // fine Y = 0
        let coarseY = (this.vramAddress >> 5) & 0x1f;
        if (coarseY === 29) {
          coarseY = 0;
          this.vramAddress ^= 0x0800; // toggle vertical nametable
        } else if (coarseY === 31) {
          coarseY = 0; // wrap without nametable toggle
        } else {
          coarseY += 1;
        }
        this.vramAddress = (this.vramAddress & ~0x03e0) | (coarseY << 5);
      }
    } else {
      // Normal linear increment outside rendering
      this.vramAddress += this.f_addrInc === 1 ? 32 : 1;
    }
  }

  // Updates the scroll registers from a new VRAM address.
  cntsFromAddress() {
    let address = (this.vramAddress >> 8) & 0xff;
    this.cntFV = (address >> 4) & 3;
    this.cntV = (address >> 3) & 1;
    this.cntH = (address >> 2) & 1;
    this.cntVT = (this.cntVT & 7) | ((address & 3) << 3);

    address = this.vramAddress & 0xff;
    this.cntVT = (this.cntVT & 24) | ((address >> 5) & 7);
    this.cntHT = address & 31;
  }

  regsToAddress() {
    let b1 = (this.regFV & 7) << 4;
    b1 |= (this.regV & 1) << 3;
    b1 |= (this.regH & 1) << 2;
    b1 |= (this.regVT >> 3) & 3;

    let b2 = (this.regVT & 7) << 5;
    b2 |= this.regHT & 31;

    this.vramTmpAddress = ((b1 << 8) | b2) & 0x7fff;
  }

  cntsToAddress() {
    let b1 = (this.cntFV & 7) << 4;
    b1 |= (this.cntV & 1) << 3;
    b1 |= (this.cntH & 1) << 2;
    b1 |= (this.cntVT >> 3) & 3;

    let b2 = (this.cntVT & 7) << 5;
    b2 |= this.cntHT & 31;

    this.vramAddress = ((b1 << 8) | b2) & 0x7fff;
  }

  incTileCounter(count) {
    for (let i = count; i !== 0; i--) {
      this.cntHT++;
      if (this.cntHT === 32) {
        this.cntHT = 0;
        this.cntVT++;
        if (this.cntVT >= 30) {
          this.cntH++;
          if (this.cntH === 2) {
            this.cntH = 0;
            this.cntV++;
            if (this.cntV === 2) {
              this.cntV = 0;
              this.cntFV++;
              this.cntFV &= 0x7;
            }
          }
        }
      }
    }
  }

  // Reads from memory, taking into account
  // mirroring/mapping of address ranges.
  mirroredLoad(address) {
    return this.vramMem[this.vramMirrorTable[address]];
  }

  // Writes to memory, taking into account
  // mirroring/mapping of address ranges.
  mirroredWrite(address, value) {
    if (address >= 0x3f00 && address < 0x3f20) {
      // Palette write mirroring.
      if (address === 0x3f00 || address === 0x3f10) {
        this.writeMem(0x3f00, value);
        this.writeMem(0x3f10, value);
      } else if (address === 0x3f04 || address === 0x3f14) {
        this.writeMem(0x3f04, value);
        this.writeMem(0x3f14, value);
      } else if (address === 0x3f08 || address === 0x3f18) {
        this.writeMem(0x3f08, value);
        this.writeMem(0x3f18, value);
      } else if (address === 0x3f0c || address === 0x3f1c) {
        this.writeMem(0x3f0c, value);
        this.writeMem(0x3f1c, value);
      } else {
        this.writeMem(address, value);
      }
    } else {
      // Use lookup table for mirrored address:
      if (address < this.vramMirrorTable.length) {
        this.writeMem(this.vramMirrorTable[address], value);
      } else {
        throw new Error(\`Invalid VRAM address: \${address.toString(16)}\`);
      }
    }
  }

  triggerRendering() {
    // Guard against recursion from mapper latch bank switches during rendering.
    // When the PPU is already rendering and a latch-triggered loadVromBank calls
    // triggerRendering, we must not re-enter the rendering loop.
    if (this._inRendering) return;
    if (this.scanline >= 21 && this.scanline <= 260) {
      // Render sprites, and combine:
      this.renderFramePartially(
        this.lastRenderedScanline + 1,
        this.scanline - 21 - this.lastRenderedScanline,
      );

      // Set last rendered scanline:
      this.lastRenderedScanline = this.scanline - 21;
    }
  }

  renderFramePartially(startScan, scanCount) {
    this._inRendering = true;

    // Let the mapper swap CHR banks for sprite rendering.
    // MMC5 uses separate CHR bank sets for sprites vs backgrounds.
    this.nes.mmap.onSpriteRender();

    if (this.f_spVisibility === 1) {
      this.renderSpritesPartially(startScan, scanCount, 1);
    }

    if (this.f_bgVisibility === 1) {
      let si = startScan << 8;
      let ei = (startScan + scanCount) << 8;
      if (ei > 0xf000) {
        ei = 0xf000;
      }
      let buffer = this.buffer;
      let bgbuffer = this.bgbuffer;
      let pixrendered = this.pixrendered;
      for (let destIndex = si; destIndex < ei; destIndex++) {
        if (pixrendered[destIndex] > 0xff) {
          buffer[destIndex] = bgbuffer[destIndex];
        }
      }
    }

    if (this.f_spVisibility === 1) {
      this.renderSpritesPartially(startScan, scanCount, 0);
    }

    // Restore BG CHR banks for subsequent background scanline rendering.
    this.nes.mmap.onBgRender();

    this._inRendering = false;
    this.validTileData = false;
  }

  renderBgScanline(bgbuffer, scan) {
    let baseTile = this.regS === 0 ? 0 : 256;
    // Base address for pattern table fetches (used for mapper latch triggers).
    // On real hardware, the PPU puts this address on its bus when fetching tile
    // data, and mappers like MMC2 monitor these fetches.
    let baseAddr = this.regS === 0 ? 0x0000 : 0x1000;
    let destIndex = (scan << 8) - this.regFH;

    this.curNt = this.ntable1[this.cntV + this.cntV + this.cntH];

    this.cntHT = this.regHT;
    this.cntH = this.regH;
    this.curNt = this.ntable1[this.cntV + this.cntV + this.cntH];

    if (scan < 240 && scan - this.cntFV >= 0) {
      let tscanoffset = this.cntFV << 3;
      let scantile = this.scantile;
      let attrib = this.attrib;
      let ptTile = this.ptTile;
      let nameTable = this.nameTable;
      let imgPalette = this.imgPalette;
      let pixrendered = this.pixrendered;
      let targetBuffer = bgbuffer ? this.bgbuffer : this.buffer;
      let mmap = this.nes.mmap;

      let t, tpix, att, col;

      this._inRendering = true;

      // Let the mapper swap CHR banks for background rendering.
      // MMC5 uses separate CHR bank sets for sprites vs backgrounds.
      this.nes.mmap.onBgRender();

      // Simulate unused sprite slot dummy fetches from the previous scanline.
      // On real hardware, the PPU fetches patterns for 8 sprites per scanline
      // during cycles 257-320. Unused slots fetch tile $FF. In 8x16 sprite
      // mode, tile $FF selects pattern table $1000 (bit 0 = 1) with top-half
      // tile $FE. The high-plane byte fetch at $1FE8 triggers MMC2/MMC4
      // latch 1 \u2192 $FE, resetting it before the next scanline's BG fetches.
      // Without this, latch 1 can stay at $FD from a previous BG trigger tile,
      // causing sprite corruption (e.g. in Punch-Out!!'s crowd).
      // See https://www.nesdev.org/wiki/MMC2
      if (this.f_spriteSize === 1) {
        mmap.latchAccess(0x1fe8);
      }

      for (let tile = 0; tile < 32; tile++) {
        if (scan >= 0) {
          // Look up nametable tile index (needed for both rendering and mapper
          // latch access even when tile data is cached).
          let tileIndex = nameTable[this.curNt].getTileIndex(
            this.cntHT,
            this.cntVT,
          );

          // Fetch tile & attrib data:
          if (this.validTileData) {
            // Get data from array:
            t = scantile[tile];
            if (typeof t === "undefined") {
              continue;
            }
            tpix = t.pix;
            att = attrib[tile];
          } else {
            // Fetch data:
            t = ptTile[baseTile + tileIndex];
            if (typeof t === "undefined") {
              continue;
            }
            tpix = t.pix;
            att = nameTable[this.curNt].getAttrib(this.cntHT, this.cntVT);

            // MMC5 ExRAM mode 1: per-tile CHR bank and attribute override.
            // Each ExRAM byte provides a 4KB CHR bank (bits 5-0) and palette
            // (bits 7-6) for the corresponding background tile, allowing
            // each tile to use a different CHR bank independently.
            if (mmap.bgTileOverride) {
              let override = mmap.getBgTileData(
                baseTile,
                tileIndex,
                this.cntHT,
                this.cntVT,
              );
              if (override) {
                t = override.tile;
                tpix = t.pix;
                att = override.attrib;
              }
            }

            scantile[tile] = t;
            attrib[tile] = att;
          }

          // Render tile scanline:
          let sx = 0;
          let x = (tile << 3) - this.regFH;

          if (x > -8) {
            if (x < 0) {
              destIndex -= x;
              sx = -x;
            }
            if (t.opaque[this.cntFV]) {
              for (; sx < 8; sx++) {
                targetBuffer[destIndex] =
                  imgPalette[tpix[tscanoffset + sx] + att];
                pixrendered[destIndex] |= 256;
                destIndex++;
              }
            } else {
              for (; sx < 8; sx++) {
                col = tpix[tscanoffset + sx];
                if (col !== 0) {
                  targetBuffer[destIndex] = imgPalette[col + att];
                  pixrendered[destIndex] |= 256;
                }
                destIndex++;
              }
            }
          }

          // Mapper latch access: simulate the PPU's pattern table high byte
          // fetch. On real hardware, the PPU reads the high plane byte at
          // (baseAddr + tileIndex*16 + fineY + 8), and MMC2/MMC4 monitor
          // this address to trigger CHR bank switches. The latch updates
          // AFTER the fetch, so the current tile is rendered with the old
          // bank (correct, since we already read from ptTile above) and
          // subsequent tiles will use the new bank.
          // See https://www.nesdev.org/wiki/MMC2
          mmap.latchAccess(baseAddr + tileIndex * 16 + this.cntFV + 8);
        }

        // Increase Horizontal Tile Counter:
        if (++this.cntHT === 32) {
          this.cntHT = 0;
          this.cntH++;
          this.cntH %= 2;
          this.curNt = this.ntable1[(this.cntV << 1) + this.cntH];
        }
      }
      this._inRendering = false;

      // Tile data for one row should now have been fetched,
      // so the data in the array is valid.
      this.validTileData = true;
    }

    // update vertical scroll:
    this.cntFV++;
    if (this.cntFV === 8) {
      this.cntFV = 0;
      this.cntVT++;
      if (this.cntVT === 30) {
        this.cntVT = 0;
        this.cntV++;
        this.cntV %= 2;
        this.curNt = this.ntable1[(this.cntV << 1) + this.cntH];
      } else if (this.cntVT === 32) {
        this.cntVT = 0;
      }

      // Invalidate fetched data:
      this.validTileData = false;
    }
  }

  // OAM corruption (2C02G/H hardware bug): if OAMADDR is not zero at the
  // beginning of the pre-render or any visible scanline (when rendering is
  // enabled), the 8 bytes at (OAMADDR & $F8) are copied over the first 8
  // bytes of OAM. This is a DRAM refresh glitch, separate from evaluation.
  // See https://www.nesdev.org/wiki/PPU_OAM#Sprite_0_corruption
  performOAMCorruption() {
    let renderingEnabled =
      this.f_spVisibility === 1 || this.f_bgVisibility === 1;
    if (!renderingEnabled) return;
    if (this.sramAddress === 0) return;

    let srcBase = this.sramAddress & 0xf8;
    for (let i = 0; i < 8; i++) {
      this.spriteMem[i] = this.spriteMem[(srcBase + i) & 0xff];
    }
    // Update unpacked sprite data for the corrupted entries
    for (let i = 0; i < 8; i++) {
      this.spriteRamWriteUpdate(i, this.spriteMem[i]);
    }
  }

  // Evaluate sprites for the given scanline, populating secondary OAM and
  // storing results in per-scanline arrays for later batch rendering.
  //
  // On real hardware this runs during cycles 65-256 of each visible scanline,
  // finding up to 8 sprites that are in range for the NEXT scanline. The
  // algorithm is a state machine with counters n (sprite index, 0-63) and
  // m (byte within sprite, 0-3). It includes the hardware sprite overflow
  // bug where both n AND m are incremented when checking for a 9th sprite.
  //
  // targetScanline: the NES scanline (0-239) whose sprites we're evaluating.
  //   Evaluation on visible scanline N finds sprites for scanline N+1.
  //   Results are stored in scanlineSecondaryOAM[targetScanline].
  //
  // See https://www.nesdev.org/wiki/PPU_sprite_evaluation
  evaluateSprites(targetScanline) {
    let renderingEnabled =
      this.f_spVisibility === 1 || this.f_bgVisibility === 1;

    // On real hardware, secondary OAM clear and evaluation only happen when
    // rendering is enabled. When disabled, the secondary OAM retains stale
    // data from the last evaluation, and OAMADDR is not reset. We skip
    // clearing the per-scanline data too, so stale sprites persist.
    if (!renderingEnabled) return;

    // Phase 1: Clear secondary OAM to $FF (cycles 1-64)
    let oamBase = targetScanline * 32;
    for (let i = 0; i < 32; i++) {
      this.scanlineSecondaryOAM[oamBase + i] = 0xff;
    }
    this.scanlineSpriteCount[targetScanline] = 0;
    this.scanlineSprite0[targetScanline] = 0;

    let spriteHeight = this.f_spriteSize === 0 ? 8 : 16;
    let spritesFound = 0;
    let secondaryIndex = 0; // Write pointer into secondary OAM (0-31)

    // Phase 2: Sprite evaluation (cycles 65-256)
    // Start scanning from sprite n = OAMADDR / 4.
    // The starting OAMADDR determines which sprite is treated as "sprite 0"
    // for hit detection and priority. A misaligned OAMADDR (not divisible
    // by 4) causes m to start at a non-zero value, reading the wrong byte
    // types as Y coordinates.
    let startN = (this.sramAddress >> 2) & 0x3f;
    let startM = this.sramAddress & 0x03;
    let overflowM = 0; // m counter for overflow bug (separate from startM)

    let n = startN;
    let firstSprite = true; // First sprite may have misaligned m

    // Evaluation checks sprites from startN through 63, then stops when n
    // wraps back to 0. Sprites 0 through startN-1 are never checked, making
    // them invisible. This is documented behavior:
    // "No more sprites will be found once the end of OAM is reached,
    //  effectively hiding any sprites before the starting OAMADDR."
    // See https://www.nesdev.org/wiki/PPU_sprite_evaluation
    let evaluated = 0;
    do {
      let m;
      if (spritesFound >= 8) {
        // In overflow detection mode: use the buggy m counter
        m = overflowM;
      } else if (firstSprite) {
        // First sprite: m may be non-zero (misaligned OAMADDR)
        m = startM;
      } else {
        m = 0;
      }
      firstSprite = false;

      let yByte = this.spriteMem[(n * 4 + m) & 0xff];

      // Check if sprite is in range for the target buffer row.
      // On real hardware the comparison is NES_scanline >= Y && < Y + height.
      // Since targetScanline is in buffer coordinates (NES scanline + 1),
      // this becomes targetScanline > Y && targetScanline <= Y + height.
      // The comparison uses whatever byte we read (even if it's not Y).
      if (targetScanline > yByte && targetScanline <= yByte + spriteHeight) {
        if (spritesFound < 8) {
          // Copy 4 bytes to secondary OAM, starting from the actual read
          // address (n*4+m). When OAMADDR is misaligned (m != 0), this
          // copies garbled data: the bytes after m in this entry followed
          // by bytes from the next entry, matching hardware behavior.
          for (let b = 0; b < 4; b++) {
            this.scanlineSecondaryOAM[oamBase + secondaryIndex + b] =
              this.spriteMem[(n * 4 + m + b) & 0xff];
          }
          // The first sprite in evaluation order (at OAMADDR/4) is the one
          // that triggers sprite 0 hit, regardless of its OAM index.
          // On real hardware, setting OAMADDR to a non-zero value causes
          // the sprite at that address to act as "sprite 0" for hit detection.
          // See https://www.nesdev.org/wiki/PPU_OAM#Sprite_zero_hits
          if (evaluated === 0) {
            this.scanlineSprite0[targetScanline] = 1;
          }
          spritesFound++;
          secondaryIndex += 4;
        } else {
          // 9th in-range sprite found: set sprite overflow flag.
          // On real hardware this is STATUS_SLSPRITECOUNT (bit 5 of $2002).
          this.setStatusFlag(this.STATUS_SLSPRITECOUNT, true);
          break; // After overflow is found, evaluation enters idle
        }
      } else if (spritesFound >= 8) {
        // Sprite overflow bug: when 8 sprites have been found and we're
        // checking for a 9th, a hardware bug causes BOTH n and m to be
        // incremented when the sprite is not in range. This makes the
        // evaluation read diagonally through OAM \u2014 checking tile indices,
        // attributes, and X coordinates as if they were Y coordinates.
        // This produces both false positives and false negatives for overflow.
        // See https://www.nesdev.org/wiki/PPU_sprite_evaluation
        overflowM = (overflowM + 1) & 0x03;
      }

      n = (n + 1) & 0x3f;
      evaluated++;
    } while (n !== 0);

    this.scanlineSpriteCount[targetScanline] = spritesFound;

    // Also save to the hardware secondary OAM buffer. On real hardware,
    // secondary OAM is a physical 32-byte register that persists across
    // scanlines. It is NOT cleared on the pre-render scanline, so stale
    // data from the last visible scanline's evaluation can affect sprite
    // tile loading on the pre-render scanline, potentially causing sprites
    // to appear on NES scanline 0.
    // See https://www.nesdev.org/wiki/PPU_sprite_evaluation
    for (let i = 0; i < 32; i++) {
      this.secondaryOAM[i] = this.scanlineSecondaryOAM[oamBase + i];
    }
    this.spritesFound = spritesFound;
    this.sprite0InSecondary = this.scanlineSprite0[targetScanline] === 1;

    // OAMADDR is set to 0 during sprite tile loading (cycles 257-320).
    // On real hardware this happens at the start of HBlank.
    this.sramAddress = 0;
  }

  // Render sprites for a range of scanlines using per-scanline secondary OAM
  // data from sprite evaluation. Only the 8 (or fewer) sprites selected by
  // evaluation are rendered, enforcing the hardware's per-scanline sprite limit.
  //
  // bgPri: 0 = render sprites with bg priority 0 (in front of background),
  //         1 = render sprites with bg priority 1 (behind background).
  //
  // Each scanline's sprites come from scanlineSecondaryOAM[], populated by
  // evaluateSprites() during endScanline(). Sprite data is read from secondary
  // OAM format: [Y, tile, attributes, X] \xD7 8 sprites.
  renderSpritesPartially(startscan, scancount, bgPri) {
    if (this.f_spVisibility !== 1) return;

    let mmap = this.nes.mmap;
    let ptTile = this.ptTile;
    let buffer = this.buffer;
    let sprPalette = this.sprPalette;
    let pixrendered = this.pixrendered;

    for (let scan = startscan; scan < startscan + scancount; scan++) {
      if (scan < 0 || scan >= 240) continue;

      let count = this.scanlineSpriteCount[scan];
      let oamBase = scan * 32;

      for (let i = 0; i < count; i++) {
        let sprY = this.scanlineSecondaryOAM[oamBase + i * 4 + 0];
        let sprTile = this.scanlineSecondaryOAM[oamBase + i * 4 + 1];
        let sprAttr = this.scanlineSecondaryOAM[oamBase + i * 4 + 2];
        let sprX = this.scanlineSecondaryOAM[oamBase + i * 4 + 3];

        let vertFlip = (sprAttr >> 7) & 1;
        let horiFlip = (sprAttr >> 6) & 1;
        let priority = (sprAttr >> 5) & 1;
        let palAdd = (sprAttr & 3) << 2;

        if (priority !== bgPri) continue;
        if (this.f_spriteSize === 0) {
          // 8x8 sprites
          let tileIndex = this.f_spPatternTable === 0 ? sprTile : sprTile + 256;
          let sprBaseAddr = this.f_spPatternTable === 0 ? 0x0000 : 0x1000;

          // Render only the one scanline row that falls on 'scan'
          let dy = sprY + 1; // +1 because sprite Y in OAM is display line - 1
          let fineY = scan - dy;
          if (fineY < 0 || fineY >= 8) continue;

          ptTile[tileIndex].render(
            buffer,
            0,
            fineY,
            8,
            fineY + 1,
            sprX,
            dy,
            palAdd,
            sprPalette,
            horiFlip,
            vertFlip,
            i, // priority: lower index in secondary OAM = higher priority
            pixrendered,
          );

          // Mapper latch: simulate PPU's sprite pattern table fetch.
          mmap.latchAccess(sprBaseAddr + sprTile * 16 + 8);
        } else {
          // 8x16 sprites: tile index bit 0 selects pattern table ($0000/$1000),
          // top tile is (index & $FE), bottom tile is (index & $FE) + 1.
          let sprBaseAddr = (sprTile & 1) !== 0 ? 0x1000 : 0x0000;
          let topTileNum = sprTile & 0xfe;
          let top = (sprTile & 1) !== 0 ? topTileNum - 1 + 256 : topTileNum;

          let dy = sprY + 1;
          let fineY = scan - dy;
          if (fineY < 0 || fineY >= 16) continue;

          // Determine which half (top/bottom) this scanline falls in
          let tileOffset, tileFineY;
          if (fineY < 8) {
            tileOffset = vertFlip ? 1 : 0;
            tileFineY = fineY;
          } else {
            tileOffset = vertFlip ? 0 : 1;
            tileFineY = fineY - 8;
          }

          ptTile[top + tileOffset].render(
            buffer,
            0,
            tileFineY,
            8,
            tileFineY + 1,
            sprX,
            dy + (fineY < 8 ? 0 : 8),
            palAdd,
            sprPalette,
            horiFlip,
            vertFlip,
            i,
            pixrendered,
          );

          // Mapper latch: simulate fetches for both halves of 8x16 sprite.
          mmap.latchAccess(sprBaseAddr + topTileNum * 16 + 8);
          mmap.latchAccess(sprBaseAddr + (topTileNum + 1) * 16 + 8);
        }
      }
    }
  }

  // Check if sprite 0 overlaps with a background tile pixel on this scanline.
  // "Sprite 0" is the first sprite in evaluation order \u2014 normally OAM entry 0,
  // but a non-zero OAMADDR can make a different entry act as sprite 0.
  //
  // On real hardware, sprite 0 hit only fires when a non-transparent sprite
  // pixel overlaps with a non-transparent background tile pixel. We check
  // pixrendered[bufferIndex] > 0xff because bit 8 (256) is set by
  // renderBgScanline when an actual background tile pixel is rendered.
  // See https://www.nesdev.org/wiki/PPU_OAM#Sprite_zero_hits
  checkSprite0(scan) {
    this.spr0HitX = -1;
    this.spr0HitY = -1;

    if (scan < 0 || scan >= 240) return false;
    if (!this.scanlineSprite0[scan]) return false;
    if (this.scanlineSpriteCount[scan] === 0) return false;

    // Read sprite 0's data from secondary OAM (first entry, slot 0).
    let oamBase = scan * 32;
    let sprY = this.scanlineSecondaryOAM[oamBase + 0];
    let sprTile = this.scanlineSecondaryOAM[oamBase + 1];
    let sprAttr = this.scanlineSecondaryOAM[oamBase + 2];
    let x = this.scanlineSecondaryOAM[oamBase + 3];
    let y = sprY + 1; // +1 because sprite Y in OAM is display line - 1

    let vertFlip = (sprAttr >> 7) & 1;
    let horiFlip = (sprAttr >> 6) & 1;

    // Sprite 0 hit has additional conditions beyond pixel overlap:
    // - No hit at x=255 (hardware doesn't check the last pixel)
    // - No hit at x=0..7 when left-side clipping is enabled for either
    //   sprites (f_spClipping===0) or background (f_bgClipping===0)
    // See https://www.nesdev.org/wiki/PPU_OAM#Sprite_zero_hits
    let leftClip = this.f_spClipping === 0 || this.f_bgClipping === 0;

    // Check each pixel of the sprite for overlap with background.
    // Returns the first x position where hit occurs, or -1 if no hit.
    let toffset;
    let t;

    // Use the mapper's getSpritePatternTile() instead of ptTile directly.
    // On MMC5 in 8x16 mode, ptTile may have BG data (Set B) after
    // renderBgScanline, but sprite 0 needs sprite data (Set A).
    let mmap = this.nes.mmap;

    if (this.f_spriteSize === 0) {
      // 8x8 sprites.
      let tIndexAdd = this.f_spPatternTable === 0 ? 0 : 256;
      if (y <= scan && y + 8 > scan && x < 256) {
        t = mmap.getSpritePatternTile(sprTile + tIndexAdd);
        toffset = vertFlip ? 7 - (scan - y) : scan - y;
        toffset *= 8;
        return this._checkSpr0Pixels(t, toffset, x, horiFlip, scan, leftClip);
      }
    } else {
      // 8x16 sprites: tile index bit 0 selects pattern table.
      if (y <= scan && y + 16 > scan && x < 256) {
        toffset = vertFlip ? 15 - (scan - y) : scan - y;

        if (toffset < 8) {
          t = mmap.getSpritePatternTile(
            sprTile + (vertFlip ? 1 : 0) + ((sprTile & 1) !== 0 ? 255 : 0),
          );
        } else {
          t = mmap.getSpritePatternTile(
            sprTile + (vertFlip ? 0 : 1) + ((sprTile & 1) !== 0 ? 255 : 0),
          );
          toffset = vertFlip ? 15 - toffset : toffset - 8;
        }
        toffset *= 8;
        return this._checkSpr0Pixels(t, toffset, x, horiFlip, scan, leftClip);
      }
    }

    return false;
  }

  // Helper: scan 8 pixels of sprite 0's tile row for overlap with background.
  // Checks for non-transparent sprite pixel overlapping non-transparent BG pixel,
  // excluding x=255 and left-clipped pixels (x=0..7 when leftClip is true).
  _checkSpr0Pixels(tile, toffset, startX, horiFlip, scan, leftClip) {
    let bufferIndex = scan * 256 + startX;

    for (let px = 0; px < 8; px++) {
      let tileIdx = horiFlip ? 7 - px : px;
      let pixelX = startX + px;

      if (pixelX >= 0 && pixelX < 255) {
        // Skip left 8 pixels when clipping is enabled
        if (leftClip && pixelX < 8) {
          bufferIndex++;
          continue;
        }

        if (
          bufferIndex >= 0 &&
          bufferIndex < 61440 &&
          this.pixrendered[bufferIndex] > 0xff &&
          tile.pix[toffset + tileIdx] !== 0
        ) {
          this.spr0HitX = pixelX;
          this.spr0HitY = scan;
          return true;
        }
      }
      bufferIndex++;
    }
    return false;
  }

  // Pre-computes sprite 0 hit for the NEXT scanline by checking BG tile data
  // directly, without requiring a full BG render. This is called after
  // renderBgScanline advances the scroll counters (cntFV/cntVT/cntV) to the
  // next row's position. By detecting the hit one scanline early, the dot-by-
  // dot loop in step() can set STATUS_SPRITE0HIT at the correct PPU cycle
  // instead of one full scanline late.
  //
  // The approach: for each of sprite 0's 8 pixels, compute which BG tile
  // occupies that screen position using the scroll registers, then check if
  // both the sprite pixel and BG pixel are non-transparent.
  //
  // See https://www.nesdev.org/wiki/PPU_OAM#Sprite_zero_hits
  _precomputeSprite0Hit(nextBufferScan) {
    if (nextBufferScan < 1 || nextBufferScan > 239) return false;
    if (!this.scanlineSprite0[nextBufferScan]) return false;
    if (this.scanlineSpriteCount[nextBufferScan] === 0) return false;

    // Read sprite 0 from secondary OAM for the next scanline.
    let oamBase = nextBufferScan * 32;
    let sprY = this.scanlineSecondaryOAM[oamBase + 0];
    let sprTile = this.scanlineSecondaryOAM[oamBase + 1];
    let sprAttr = this.scanlineSecondaryOAM[oamBase + 2];
    let sprX = this.scanlineSecondaryOAM[oamBase + 3];
    let y = sprY + 1; // +1 because sprite Y in OAM is display line - 1

    let vertFlip = (sprAttr >> 7) & 1;
    let horiFlip = (sprAttr >> 6) & 1;
    let leftClip = this.f_spClipping === 0 || this.f_bgClipping === 0;

    // Check if sprite 0 overlaps the next scanline.
    let spriteHeight = this.f_spriteSize === 0 ? 8 : 16;
    if (!(y <= nextBufferScan && y + spriteHeight > nextBufferScan))
      return false;
    if (sprX >= 256) return false;

    // Compute sprite tile row for this scanline.
    let sprRow = vertFlip
      ? spriteHeight - 1 - (nextBufferScan - y)
      : nextBufferScan - y;
    let sprTileObj, toffset;

    if (this.f_spriteSize === 0) {
      // 8x8 sprites.
      let tIndexAdd = this.f_spPatternTable === 0 ? 0 : 256;
      sprTileObj = this.ptTile[sprTile + tIndexAdd];
      toffset = sprRow * 8;
    } else {
      // 8x16 sprites: tile index bit 0 selects pattern table.
      let patternBase = (sprTile & 1) !== 0 ? 256 : 0;
      let baseTileIdx = sprTile & ~1;
      if (sprRow < 8) {
        sprTileObj =
          this.ptTile[baseTileIdx + patternBase + (vertFlip ? 1 : 0)];
        toffset = sprRow * 8;
      } else {
        sprTileObj =
          this.ptTile[baseTileIdx + patternBase + (vertFlip ? 0 : 1)];
        toffset = (sprRow - 8) * 8;
      }
    }
    if (!sprTileObj) return false;

    // BG vertical position: cntFV/cntVT/cntV have already been advanced to
    // the next row by renderBgScanline's scroll update.
    let bgFineY = this.cntFV;
    let bgCoarseY = this.cntVT;
    let bgNtV = this.cntV;
    let baseBgTile = this.regS === 0 ? 0 : 256;

    // Check each sprite pixel against the BG tile at that position.
    for (let px = 0; px < 8; px++) {
      let screenX = sprX + px;
      if (screenX >= 255) continue; // no hit at x=255
      if (leftClip && screenX < 8) continue;

      // Check sprite pixel non-transparent.
      let tileIdx = horiFlip ? 7 - px : px;
      if (sprTileObj.pix[toffset + tileIdx] === 0) continue;

      // Compute which BG tile covers this screen X using the horizontal
      // scroll registers (regHT/regH are reloaded at the start of each
      // visible scanline on real hardware).
      let tileOffset = (screenX + this.regFH) >> 3;
      let absCol = this.regHT + tileOffset;
      let bgNtH = this.regH;
      if (absCol >= 32) {
        absCol -= 32;
        bgNtH ^= 1; // toggle horizontal nametable
      }

      // Look up the BG tile from the nametable.
      let ntIdx = this.ntable1[(bgNtV << 1) + bgNtH];
      let bgTileIndex = this.nameTable[ntIdx].getTileIndex(absCol, bgCoarseY);
      let bgTile = this.ptTile[baseBgTile + bgTileIndex];
      if (!bgTile) continue;

      // Check BG pixel non-transparent at (fineX, fineY).
      let bgPixelX = (screenX + this.regFH) & 7;
      if (bgTile.pix[bgFineY * 8 + bgPixelX] !== 0) {
        // Hit found! Store in NES scanline coordinates for step() matching.
        // step() compares scanline - 21 against spr0HitY, where
        // scanline - 21 = bufferScan - 1, so we store nextBufferScan - 1.
        this.spr0HitX = screenX;
        this.spr0HitY = nextBufferScan - 1;
        return true;
      }
    }
    return false;
  }

  // This will write to PPU memory, and
  // update internally buffered data
  // appropriately.
  writeMem(address, value) {
    this.vramMem[address] = value;

    // Update internally buffered data:
    if (address < 0x2000) {
      this.vramMem[address] = value;
      this.patternWrite(address, value);
    } else if (address >= 0x2000 && address < 0x23c0) {
      this.nameTableWrite(this.ntable1[0], address - 0x2000, value);
    } else if (address >= 0x23c0 && address < 0x2400) {
      this.attribTableWrite(this.ntable1[0], address - 0x23c0, value);
    } else if (address >= 0x2400 && address < 0x27c0) {
      this.nameTableWrite(this.ntable1[1], address - 0x2400, value);
    } else if (address >= 0x27c0 && address < 0x2800) {
      this.attribTableWrite(this.ntable1[1], address - 0x27c0, value);
    } else if (address >= 0x2800 && address < 0x2bc0) {
      this.nameTableWrite(this.ntable1[2], address - 0x2800, value);
    } else if (address >= 0x2bc0 && address < 0x2c00) {
      this.attribTableWrite(this.ntable1[2], address - 0x2bc0, value);
    } else if (address >= 0x2c00 && address < 0x2fc0) {
      this.nameTableWrite(this.ntable1[3], address - 0x2c00, value);
    } else if (address >= 0x2fc0 && address < 0x3000) {
      this.attribTableWrite(this.ntable1[3], address - 0x2fc0, value);
    } else if (address >= 0x3f00 && address < 0x3f20) {
      this.updatePalettes();
    }
  }

  // Reads data from $3f00 to $f20
  // into the two buffered palettes.
  updatePalettes() {
    let i;

    for (i = 0; i < 16; i++) {
      if (this.f_dispType === 0) {
        this.imgPalette[i] = this.palTable.getEntry(
          this.vramMem[0x3f00 + i] & 63,
        );
      } else {
        this.imgPalette[i] = this.palTable.getEntry(
          this.vramMem[0x3f00 + i] & 0x30,
        );
      }
    }
    for (i = 0; i < 16; i++) {
      if (this.f_dispType === 0) {
        this.sprPalette[i] = this.palTable.getEntry(
          this.vramMem[0x3f10 + i] & 63,
        );
      } else {
        this.sprPalette[i] = this.palTable.getEntry(
          this.vramMem[0x3f10 + i] & 0x30,
        );
      }
    }
  }

  // Updates the internal pattern
  // table buffers with this new byte.
  // In vNES, there is a version of this with 4 arguments which isn't used.
  patternWrite(address, value) {
    let tileIndex = address >> 4;
    let leftOver = address & 15;
    if (leftOver < 8) {
      this.ptTile[tileIndex].setScanline(
        leftOver,
        value,
        this.vramMem[address + 8],
      );
    } else {
      this.ptTile[tileIndex].setScanline(
        leftOver - 8,
        this.vramMem[address - 8],
        value,
      );
    }
  }

  // Updates the internal name table buffers
  // with this new byte.
  nameTableWrite(index, address, value) {
    this.nameTable[index].tile[address] = value;

    // Update Sprite #0 hit:
    let bufferScan = this.scanline + 1 - 21;
    this.checkSprite0(bufferScan);
  }

  // Updates the internal pattern
  // table buffers with this new attribute
  // table byte.
  attribTableWrite(index, address, value) {
    this.nameTable[index].writeAttrib(address, value);
    // Also store the raw attribute byte in the tile array at offset 0x3C0
    // (= 960 = 30*32). On real hardware, when coarse Y is 30 or 31, the PPU's
    // nametable fetch address lands in the attribute table region and the raw
    // byte is used as a tile index. This is the "attributes as tiles" quirk.
    // See https://www.nesdev.org/wiki/PPU_scrolling
    this.nameTable[index].tile[0x3c0 + address] = value;
  }

  // Updates the internally buffered sprite
  // data with this new byte of info.
  spriteRamWriteUpdate(address, value) {
    let tIndex = address >> 2;

    if (tIndex === 0) {
      let bufferScan = this.scanline + 1 - 21;
      this.checkSprite0(bufferScan);
    }

    switch (address & 3) {
      case 0:
        // Y coordinate
        this.sprY[tIndex] = value;
        break;
      case 1:
        // Tile index
        this.sprTile[tIndex] = value;
        break;
      case 2:
        // Attributes
        this.vertFlip[tIndex] = (value >> 7) & 1;
        this.horiFlip[tIndex] = (value >> 6) & 1;
        this.bgPriority[tIndex] = (value >> 5) & 1;
        this.sprCol[tIndex] = (value & 3) << 2;
        break;
      case 3:
        // X coordinate
        this.sprX[tIndex] = value;
        break;
    }
  }

  isPixelWhite(x, y) {
    this.triggerRendering();
    return this.nes.ppu.buffer[(y << 8) + x] === 0xffffff;
  }

  toJSON() {
    let i;
    let state = toJSON(this);

    state.nameTable = [];
    for (i = 0; i < this.nameTable.length; i++) {
      state.nameTable[i] = this.nameTable[i].toJSON();
    }

    state.ptTile = [];
    for (i = 0; i < this.ptTile.length; i++) {
      state.ptTile[i] = this.ptTile[i].toJSON();
    }

    return state;
  }

  fromJSON(state) {
    let i;

    fromJSON(this, state);

    for (i = 0; i < this.nameTable.length; i++) {
      this.nameTable[i].fromJSON(state.nameTable[i]);
    }

    for (i = 0; i < this.ptTile.length; i++) {
      this.ptTile[i].fromJSON(state.ptTile[i]);
    }

    // Sprite data:
    for (i = 0; i < this.spriteMem.length; i++) {
      this.spriteRamWriteUpdate(i, this.spriteMem[i]);
    }
  }

  static JSON_PROPERTIES = [
    // Memory
    "vramMem",
    "spriteMem",
    // Counters
    "cntFV",
    "cntV",
    "cntH",
    "cntVT",
    "cntHT",
    // Registers
    "regFV",
    "regV",
    "regH",
    "regVT",
    "regHT",
    "regFH",
    "regS",
    // VRAM addr
    "vramAddress",
    "vramTmpAddress",
    // Control/Status registers
    "f_nmiOnVblank",
    "f_spriteSize",
    "f_bgPatternTable",
    "f_spPatternTable",
    "f_addrInc",
    "f_nTblAddress",
    "f_color",
    "f_spVisibility",
    "f_bgVisibility",
    "f_spClipping",
    "f_bgClipping",
    "f_dispType",
    // VRAM I/O
    "vramBufferedReadValue",
    "firstWrite",
    "openBusLatch",
    "openBusDecayFrames",
    // Mirroring
    "currentMirroring",
    "vramMirrorTable",
    "ntable1",
    // SPR-RAM I/O
    "sramAddress",
    // Sprites. Most sprite data is rebuilt from spriteMem
    "hitSpr0",
    // Secondary OAM: persistent hardware state (not cleared on pre-render)
    "secondaryOAM",
    "spritesFound",
    "sprite0InSecondary",
    // Palettes
    "sprPalette",
    "imgPalette",
    // Rendering progression
    "curX",
    "scanline",
    "lastRenderedScanline",
    "curNt",
    "scantile",
    // Used during rendering
    "attrib",
    "buffer",
    "bgbuffer",
    "pixrendered",
    // Misc
    "nmiOutput",
    "nmiSuppressed",
    "vblankPending",
    "dummyCycleToggle",
    "validTileData",
    "scanlineAlreadyRendered",
  ];
}

export default PPU;
`, type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/ppu/nametable.js": { text: "class NameTable {\n  constructor(width, height, name) {\n    this.width = width;\n    this.height = height;\n    this.name = name;\n\n    this.tile = new Uint8Array(width * height);\n    this.attrib = new Uint8Array(width * height);\n  }\n\n  getTileIndex(x, y) {\n    return this.tile[y * this.width + x];\n  }\n\n  getAttrib(x, y) {\n    return this.attrib[y * this.width + x];\n  }\n\n  writeAttrib(index, value) {\n    let basex = (index % 8) * 4;\n    let basey = Math.floor(index / 8) * 4;\n    let add;\n    let tx, ty;\n    let attindex;\n\n    for (let sqy = 0; sqy < 2; sqy++) {\n      for (let sqx = 0; sqx < 2; sqx++) {\n        add = (value >> (2 * (sqy * 2 + sqx))) & 3;\n        for (let y = 0; y < 2; y++) {\n          for (let x = 0; x < 2; x++) {\n            tx = basex + sqx * 2 + x;\n            ty = basey + sqy * 2 + y;\n            attindex = ty * this.width + tx;\n            this.attrib[attindex] = (add << 2) & 12;\n          }\n        }\n      }\n    }\n  }\n\n  toJSON() {\n    return {\n      tile: Array.from(this.tile),\n      attrib: Array.from(this.attrib),\n    };\n  }\n\n  fromJSON(s) {\n    this.tile.set(s.tile);\n    this.attrib.set(s.attrib);\n  }\n}\n\nexport default NameTable;\n", type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/ppu/palette-table.js": { text: "class PaletteTable {\n  constructor() {\n    this.curTable = new Uint32Array(64);\n    this.emphTable = new Array(8);\n    this.currentEmph = -1;\n  }\n\n  loadNTSCPalette() {\n    // prettier-ignore\n    this.curTable = new Uint32Array([0x525252, 0xB40000, 0xA00000, 0xB1003D, 0x740069, 0x00005B, 0x00005F, 0x001840, 0x002F10, 0x084A08, 0x006700, 0x124200, 0x6D2800, 0x000000, 0x000000, 0x000000, 0xC4D5E7, 0xFF4000, 0xDC0E22, 0xFF476B, 0xD7009F, 0x680AD7, 0x0019BC, 0x0054B1, 0x006A5B, 0x008C03, 0x00AB00, 0x2C8800, 0xA47200, 0x000000, 0x000000, 0x000000, 0xF8F8F8, 0xFFAB3C, 0xFF7981, 0xFF5BC5, 0xFF48F2, 0xDF49FF, 0x476DFF, 0x00B4F7, 0x00E0FF, 0x00E375, 0x03F42B, 0x78B82E, 0xE5E218, 0x787878, 0x000000, 0x000000, 0xFFFFFF, 0xFFF2BE, 0xF8B8B8, 0xF8B8D8, 0xFFB6FF, 0xFFC3FF, 0xC7D1FF, 0x9ADAFF, 0x88EDF8, 0x83FFDD, 0xB8F8B8, 0xF5F8AC, 0xFFFFB0, 0xF8D8F8, 0x000000, 0x000000]);\n    this.makeTables();\n    this.setEmphasis(0);\n  }\n\n  loadPALPalette() {\n    // prettier-ignore\n    this.curTable = new Uint32Array([0x525252, 0xB40000, 0xA00000, 0xB1003D, 0x740069, 0x00005B, 0x00005F, 0x001840, 0x002F10, 0x084A08, 0x006700, 0x124200, 0x6D2800, 0x000000, 0x000000, 0x000000, 0xC4D5E7, 0xFF4000, 0xDC0E22, 0xFF476B, 0xD7009F, 0x680AD7, 0x0019BC, 0x0054B1, 0x006A5B, 0x008C03, 0x00AB00, 0x2C8800, 0xA47200, 0x000000, 0x000000, 0x000000, 0xF8F8F8, 0xFFAB3C, 0xFF7981, 0xFF5BC5, 0xFF48F2, 0xDF49FF, 0x476DFF, 0x00B4F7, 0x00E0FF, 0x00E375, 0x03F42B, 0x78B82E, 0xE5E218, 0x787878, 0x000000, 0x000000, 0xFFFFFF, 0xFFF2BE, 0xF8B8B8, 0xF8B8D8, 0xFFB6FF, 0xFFC3FF, 0xC7D1FF, 0x9ADAFF, 0x88EDF8, 0x83FFDD, 0xB8F8B8, 0xF5F8AC, 0xFFFFB0, 0xF8D8F8, 0x000000, 0x000000]);\n    this.makeTables();\n    this.setEmphasis(0);\n  }\n\n  makeTables() {\n    let r, g, b, col, i, rFactor, gFactor, bFactor;\n\n    // Calculate a table for each possible emphasis setting:\n    for (let emph = 0; emph < 8; emph++) {\n      // Determine color component factors:\n      rFactor = 1.0;\n      gFactor = 1.0;\n      bFactor = 1.0;\n\n      // NTSC emphasis bits from $2001:\n      // Bit 5 (emph & 1): Emphasize Red \u2192 darken Green + Blue\n      // Bit 6 (emph & 2): Emphasize Green \u2192 darken Red + Blue\n      // Bit 7 (emph & 4): Emphasize Blue \u2192 darken Red + Green\n      // See https://www.nesdev.org/wiki/PPU_registers#Color_emphasis\n      if ((emph & 1) !== 0) {\n        gFactor = 0.75;\n        bFactor = 0.75;\n      }\n      if ((emph & 2) !== 0) {\n        rFactor = 0.75;\n        bFactor = 0.75;\n      }\n      if ((emph & 4) !== 0) {\n        rFactor = 0.75;\n        gFactor = 0.75;\n      }\n\n      this.emphTable[emph] = new Uint32Array(64);\n\n      // Calculate table:\n      for (i = 0; i < 64; i++) {\n        col = this.curTable[i];\n        r = Math.floor(this.getRed(col) * rFactor);\n        g = Math.floor(this.getGreen(col) * gFactor);\n        b = Math.floor(this.getBlue(col) * bFactor);\n        this.emphTable[emph][i] = this.getRgb(r, g, b);\n      }\n    }\n  }\n\n  setEmphasis(emph) {\n    if (emph !== this.currentEmph) {\n      this.currentEmph = emph;\n      for (let i = 0; i < 64; i++) {\n        this.curTable[i] = this.emphTable[emph][i];\n      }\n    }\n  }\n\n  getEntry(yiq) {\n    return this.curTable[yiq];\n  }\n\n  getRed(rgb) {\n    return (rgb >> 16) & 0xff;\n  }\n\n  getGreen(rgb) {\n    return (rgb >> 8) & 0xff;\n  }\n\n  getBlue(rgb) {\n    return rgb & 0xff;\n  }\n\n  getRgb(r, g, b) {\n    return (r << 16) | (g << 8) | b;\n  }\n\n  loadDefaultPalette() {\n    this.curTable[0] = this.getRgb(117, 117, 117);\n    this.curTable[1] = this.getRgb(39, 27, 143);\n    this.curTable[2] = this.getRgb(0, 0, 171);\n    this.curTable[3] = this.getRgb(71, 0, 159);\n    this.curTable[4] = this.getRgb(143, 0, 119);\n    this.curTable[5] = this.getRgb(171, 0, 19);\n    this.curTable[6] = this.getRgb(167, 0, 0);\n    this.curTable[7] = this.getRgb(127, 11, 0);\n    this.curTable[8] = this.getRgb(67, 47, 0);\n    this.curTable[9] = this.getRgb(0, 71, 0);\n    this.curTable[10] = this.getRgb(0, 81, 0);\n    this.curTable[11] = this.getRgb(0, 63, 23);\n    this.curTable[12] = this.getRgb(27, 63, 95);\n    this.curTable[13] = this.getRgb(0, 0, 0);\n    this.curTable[14] = this.getRgb(0, 0, 0);\n    this.curTable[15] = this.getRgb(0, 0, 0);\n    this.curTable[16] = this.getRgb(188, 188, 188);\n    this.curTable[17] = this.getRgb(0, 115, 239);\n    this.curTable[18] = this.getRgb(35, 59, 239);\n    this.curTable[19] = this.getRgb(131, 0, 243);\n    this.curTable[20] = this.getRgb(191, 0, 191);\n    this.curTable[21] = this.getRgb(231, 0, 91);\n    this.curTable[22] = this.getRgb(219, 43, 0);\n    this.curTable[23] = this.getRgb(203, 79, 15);\n    this.curTable[24] = this.getRgb(139, 115, 0);\n    this.curTable[25] = this.getRgb(0, 151, 0);\n    this.curTable[26] = this.getRgb(0, 171, 0);\n    this.curTable[27] = this.getRgb(0, 147, 59);\n    this.curTable[28] = this.getRgb(0, 131, 139);\n    this.curTable[29] = this.getRgb(0, 0, 0);\n    this.curTable[30] = this.getRgb(0, 0, 0);\n    this.curTable[31] = this.getRgb(0, 0, 0);\n    this.curTable[32] = this.getRgb(255, 255, 255);\n    this.curTable[33] = this.getRgb(63, 191, 255);\n    this.curTable[34] = this.getRgb(95, 151, 255);\n    this.curTable[35] = this.getRgb(167, 139, 253);\n    this.curTable[36] = this.getRgb(247, 123, 255);\n    this.curTable[37] = this.getRgb(255, 119, 183);\n    this.curTable[38] = this.getRgb(255, 119, 99);\n    this.curTable[39] = this.getRgb(255, 155, 59);\n    this.curTable[40] = this.getRgb(243, 191, 63);\n    this.curTable[41] = this.getRgb(131, 211, 19);\n    this.curTable[42] = this.getRgb(79, 223, 75);\n    this.curTable[43] = this.getRgb(88, 248, 152);\n    this.curTable[44] = this.getRgb(0, 235, 219);\n    this.curTable[45] = this.getRgb(0, 0, 0);\n    this.curTable[46] = this.getRgb(0, 0, 0);\n    this.curTable[47] = this.getRgb(0, 0, 0);\n    this.curTable[48] = this.getRgb(255, 255, 255);\n    this.curTable[49] = this.getRgb(171, 231, 255);\n    this.curTable[50] = this.getRgb(199, 215, 255);\n    this.curTable[51] = this.getRgb(215, 203, 255);\n    this.curTable[52] = this.getRgb(255, 199, 255);\n    this.curTable[53] = this.getRgb(255, 199, 219);\n    this.curTable[54] = this.getRgb(255, 191, 179);\n    this.curTable[55] = this.getRgb(255, 219, 171);\n    this.curTable[56] = this.getRgb(255, 231, 163);\n    this.curTable[57] = this.getRgb(227, 255, 163);\n    this.curTable[58] = this.getRgb(171, 243, 191);\n    this.curTable[59] = this.getRgb(179, 255, 207);\n    this.curTable[60] = this.getRgb(159, 255, 243);\n    this.curTable[61] = this.getRgb(0, 0, 0);\n    this.curTable[62] = this.getRgb(0, 0, 0);\n    this.curTable[63] = this.getRgb(0, 0, 0);\n\n    this.makeTables();\n    this.setEmphasis(0);\n  }\n}\n\nexport default PaletteTable;\n", type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/rom.js": { text: 'import Mappers from "./mappers/index.js";\nimport Tile from "./tile.js";\n\nclass ROM {\n  // Mirroring types (instance properties so they\'re accessible via\n  // this.nes.rom.HORIZONTAL_MIRRORING etc. in PPU and mappers):\n  VERTICAL_MIRRORING = 0;\n  HORIZONTAL_MIRRORING = 1;\n  FOURSCREEN_MIRRORING = 2;\n  SINGLESCREEN_MIRRORING = 3;\n  SINGLESCREEN_MIRRORING2 = 4;\n  SINGLESCREEN_MIRRORING3 = 5;\n  SINGLESCREEN_MIRRORING4 = 6;\n  CHRROM_MIRRORING = 7;\n\n  constructor(nes) {\n    this.nes = nes;\n    this.valid = false;\n  }\n\n  load(data) {\n    let i, j, v;\n\n    // Accept Uint8Array, ArrayBuffer, Buffer, or binary string.\n    if (data instanceof ArrayBuffer) {\n      data = new Uint8Array(data);\n    }\n    const isTypedArray = ArrayBuffer.isView(data);\n\n    if (isTypedArray) {\n      if (\n        data.length < 4 ||\n        data[0] !== 0x4e ||\n        data[1] !== 0x45 ||\n        data[2] !== 0x53 ||\n        data[3] !== 0x1a\n      ) {\n        throw new Error("Not a valid NES ROM.");\n      }\n    } else {\n      if (!data.startsWith("NES\\x1a")) {\n        throw new Error("Not a valid NES ROM.");\n      }\n    }\n\n    this.header = new Uint8Array(16);\n    for (i = 0; i < 16; i++) {\n      this.header[i] = isTypedArray ? data[i] : data.charCodeAt(i) & 0xff;\n    }\n\n    // Flags from byte 6 (shared between iNES 1.0 and NES 2.0)\n    this.mirroring = (this.header[6] & 1) !== 0 ? 1 : 0;\n    this.batteryRam = (this.header[6] & 2) !== 0;\n    this.trainer = (this.header[6] & 4) !== 0;\n    this.fourScreen = (this.header[6] & 8) !== 0;\n\n    // Detect NES 2.0: byte 7 bits 3..2 == 0b10\n    // https://www.nesdev.org/wiki/NES_2.0\n    this.isNES2 = (this.header[7] & 0x0c) === 0x08;\n\n    if (this.isNES2) {\n      this._loadNES2Header();\n    } else {\n      this._loadINES1Header();\n    }\n\n    /* TODO\n        if (this.batteryRam)\n            this.loadBatteryRam();*/\n\n    // Load PRG-ROM banks:\n    this.rom = new Array(this.romCount);\n    // Skip past the 16-byte header, plus 512-byte trainer if present.\n    // See https://www.nesdev.org/wiki/INES#Trainer\n    let offset = 16 + (this.trainer ? 512 : 0);\n    for (i = 0; i < this.romCount; i++) {\n      this.rom[i] = new Uint8Array(16384);\n      for (j = 0; j < 16384; j++) {\n        if (offset + j >= data.length) {\n          break;\n        }\n        this.rom[i][j] = isTypedArray\n          ? data[offset + j]\n          : data.charCodeAt(offset + j) & 0xff;\n      }\n      offset += 16384;\n    }\n    // Load CHR-ROM banks:\n    this.vrom = new Array(this.vromCount);\n    for (i = 0; i < this.vromCount; i++) {\n      this.vrom[i] = new Uint8Array(4096);\n      for (j = 0; j < 4096; j++) {\n        if (offset + j >= data.length) {\n          break;\n        }\n        this.vrom[i][j] = isTypedArray\n          ? data[offset + j]\n          : data.charCodeAt(offset + j) & 0xff;\n      }\n      offset += 4096;\n    }\n\n    // Create VROM tiles:\n    this.vromTile = new Array(this.vromCount);\n    for (i = 0; i < this.vromCount; i++) {\n      this.vromTile[i] = new Array(256);\n      for (j = 0; j < 256; j++) {\n        this.vromTile[i][j] = new Tile();\n      }\n    }\n\n    // Convert CHR-ROM banks to tiles:\n    let tileIndex;\n    let leftOver;\n    for (v = 0; v < this.vromCount; v++) {\n      for (i = 0; i < 4096; i++) {\n        tileIndex = i >> 4;\n        leftOver = i % 16;\n        if (leftOver < 8) {\n          this.vromTile[v][tileIndex].setScanline(\n            leftOver,\n            this.vrom[v][i],\n            this.vrom[v][i + 8],\n          );\n        } else {\n          this.vromTile[v][tileIndex].setScanline(\n            leftOver - 8,\n            this.vrom[v][i - 8],\n            this.vrom[v][i],\n          );\n        }\n      }\n    }\n\n    this.valid = true;\n  }\n\n  // Parse iNES 1.0 header fields (bytes 4-15).\n  _loadINES1Header() {\n    this.romCount = this.header[4];\n    this.vromCount = this.header[5] * 2; // Get the number of 4kB banks, not 8kB\n    this.mapperType = (this.header[6] >> 4) | (this.header[7] & 0xf0);\n\n    // Check whether bytes 8-15 are zero. Non-zero values in this region\n    // typically indicate garbage (e.g. "DiskDude!" in old ROM dumps), so\n    // we discard the upper mapper nibble from byte 7 to be safe.\n    let foundError = false;\n    for (let i = 8; i < 16; i++) {\n      if (this.header[i] !== 0) {\n        foundError = true;\n        break;\n      }\n    }\n    if (foundError) {\n      this.mapperType &= 0xf; // Ignore byte 7\n    }\n\n    // Default NES 2.0 fields to zero for iNES 1.0 ROMs so consumers\n    // don\'t need to check isNES2 before accessing them.\n    this.subMapper = 0;\n    this.prgRamSize = 0;\n    this.prgNvRamSize = 0;\n    this.chrRamSize = 0;\n    this.chrNvRamSize = 0;\n    this.timingMode = 0;\n    this.consoleType = 0;\n  }\n\n  // Parse NES 2.0 header fields (bytes 4-15).\n  // https://www.nesdev.org/wiki/NES_2.0\n  _loadNES2Header() {\n    // Mapper number: 12 bits from bytes 6, 7, and 8.\n    //   Byte 6 D7..D4: mapper D3..D0\n    //   Byte 7 D7..D4: mapper D7..D4\n    //   Byte 8 D3..D0: mapper D11..D8\n    this.mapperType =\n      (this.header[6] >> 4) |\n      (this.header[7] & 0xf0) |\n      ((this.header[8] & 0x0f) << 8);\n\n    // Submapper: byte 8 D7..D4\n    this.subMapper = (this.header[8] >> 4) & 0x0f;\n\n    // PRG-ROM size: byte 9 D3..D0 (MSB) combined with byte 4 (LSB).\n    // When MSB nibble is 0xF, an exponent-multiplier encoding is used:\n    //   size = 2^E * (M*2 + 1) bytes, where E = bits 7..2, M = bits 1..0.\n    const prgMsb = this.header[9] & 0x0f;\n    if (prgMsb === 0x0f) {\n      const e = (this.header[4] >> 2) & 0x3f;\n      const m = this.header[4] & 0x03;\n      this.romCount = Math.ceil((Math.pow(2, e) * (m * 2 + 1)) / 16384);\n    } else {\n      this.romCount = (prgMsb << 8) | this.header[4];\n    }\n\n    // CHR-ROM size: byte 9 D7..D4 (MSB) combined with byte 5 (LSB).\n    // Same exponent-multiplier encoding when MSB nibble is 0xF.\n    // Internally we store as 4KB bank count (vromCount = 8KB units * 2).\n    const chrMsb = (this.header[9] >> 4) & 0x0f;\n    if (chrMsb === 0x0f) {\n      const e = (this.header[5] >> 2) & 0x3f;\n      const m = this.header[5] & 0x03;\n      this.vromCount = Math.ceil((Math.pow(2, e) * (m * 2 + 1)) / 4096);\n    } else {\n      // 12-bit value is in 8KB units; double it for 4KB bank count.\n      this.vromCount = ((chrMsb << 8) | this.header[5]) * 2;\n    }\n\n    // PRG-RAM sizes (byte 10).\n    // Lower nibble: volatile PRG-RAM; upper nibble: non-volatile PRG-NVRAM.\n    // Encoding: 0 = none, otherwise 64 << value bytes.\n    this.prgRamSize = ROM._decodeRamSize(this.header[10] & 0x0f);\n    this.prgNvRamSize = ROM._decodeRamSize((this.header[10] >> 4) & 0x0f);\n\n    // CHR-RAM sizes (byte 11).\n    // Lower nibble: volatile CHR-RAM; upper nibble: non-volatile CHR-NVRAM.\n    // Note: with NES 2.0, do not assume 8KB CHR-RAM when CHR-ROM is 0;\n    // CHR-RAM must be explicitly specified here.\n    this.chrRamSize = ROM._decodeRamSize(this.header[11] & 0x0f);\n    this.chrNvRamSize = ROM._decodeRamSize((this.header[11] >> 4) & 0x0f);\n\n    // CPU/PPU timing mode (byte 12, low 2 bits).\n    // 0 = NTSC (RP2C02), 1 = PAL (RP2C07), 2 = Multi-region, 3 = Dendy (UA6538)\n    this.timingMode = this.header[12] & 0x03;\n\n    // Console type (byte 7, bits 1..0).\n    // 0 = NES/Famicom, 1 = Vs. System, 2 = Playchoice 10, 3 = Extended\n    this.consoleType = this.header[7] & 0x03;\n  }\n\n  // Decode NES 2.0 RAM shift-count encoding.\n  // Value 0 means no RAM; otherwise size = 64 << value (in bytes).\n  // https://www.nesdev.org/wiki/NES_2.0#PRG-(NV)RAM/EEPROM\n  static _decodeRamSize(value) {\n    if (value === 0) return 0;\n    return 64 << value;\n  }\n\n  getMirroringType() {\n    if (this.fourScreen) {\n      return this.FOURSCREEN_MIRRORING;\n    }\n    if (this.mirroring === 0) {\n      return this.HORIZONTAL_MIRRORING;\n    }\n    return this.VERTICAL_MIRRORING;\n  }\n\n  mapperSupported() {\n    return typeof Mappers[this.mapperType] !== "undefined";\n  }\n\n  createMapper() {\n    if (this.mapperSupported()) {\n      return new Mappers[this.mapperType](this.nes);\n    } else {\n      throw new Error(`Unsupported mapper: ${this.mapperType}`);\n    }\n  }\n}\n\nexport default ROM;\n', type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/tile.js": { text: "class Tile {\n  constructor() {\n    // Tile data: color indices 0\u20133\n    this.pix = new Uint8Array(64);\n\n    this.initialized = false;\n    this.opaque = new Uint8Array(8);\n  }\n\n  setBuffer(scanline) {\n    for (let y = 0; y < 8; y++) {\n      this.setScanline(y, scanline[y], scanline[y + 8]);\n    }\n  }\n\n  setScanline(sline, b1, b2) {\n    this.initialized = true;\n    let tIndex = sline << 3;\n    for (let x = 0; x < 8; x++) {\n      this.pix[tIndex + x] =\n        ((b1 >> (7 - x)) & 1) + (((b2 >> (7 - x)) & 1) << 1);\n      if (this.pix[tIndex + x] === 0) {\n        this.opaque[sline] = false;\n      }\n    }\n  }\n\n  render(\n    buffer,\n    srcx1,\n    srcy1,\n    srcx2,\n    srcy2,\n    dx,\n    dy,\n    palAdd,\n    palette,\n    flipHorizontal,\n    flipVertical,\n    pri,\n    priTable,\n  ) {\n    if (dx < -7 || dx >= 256 || dy < -7 || dy >= 240) {\n      return;\n    }\n\n    if (dx < 0) {\n      srcx1 -= dx;\n    }\n    if (dx + srcx2 >= 256) {\n      srcx2 = 256 - dx;\n    }\n\n    if (dy < 0) {\n      srcy1 -= dy;\n    }\n    if (dy + srcy2 >= 240) {\n      srcy2 = 240 - dy;\n    }\n\n    let fbIndex, tIndex, palIndex, tpri;\n\n    if (!flipHorizontal && !flipVertical) {\n      fbIndex = (dy << 8) + dx;\n      tIndex = 0;\n      for (let y = 0; y < 8; y++) {\n        for (let x = 0; x < 8; x++) {\n          if (x >= srcx1 && x < srcx2 && y >= srcy1 && y < srcy2) {\n            palIndex = this.pix[tIndex];\n            tpri = priTable[fbIndex];\n            if (palIndex !== 0 && pri <= (tpri & 0xff)) {\n              buffer[fbIndex] = palette[palIndex + palAdd];\n              tpri = (tpri & 0xf00) | pri;\n              priTable[fbIndex] = tpri;\n            }\n          }\n          fbIndex++;\n          tIndex++;\n        }\n        fbIndex -= 8;\n        fbIndex += 256;\n      }\n    } else if (flipHorizontal && !flipVertical) {\n      fbIndex = (dy << 8) + dx;\n      tIndex = 7;\n      for (let y = 0; y < 8; y++) {\n        for (let x = 0; x < 8; x++) {\n          if (x >= srcx1 && x < srcx2 && y >= srcy1 && y < srcy2) {\n            palIndex = this.pix[tIndex];\n            tpri = priTable[fbIndex];\n            if (palIndex !== 0 && pri <= (tpri & 0xff)) {\n              buffer[fbIndex] = palette[palIndex + palAdd];\n              tpri = (tpri & 0xf00) | pri;\n              priTable[fbIndex] = tpri;\n            }\n          }\n          fbIndex++;\n          tIndex--;\n        }\n        fbIndex -= 8;\n        fbIndex += 256;\n        tIndex += 16;\n      }\n    } else if (flipVertical && !flipHorizontal) {\n      fbIndex = (dy << 8) + dx;\n      tIndex = 56;\n      for (let y = 0; y < 8; y++) {\n        for (let x = 0; x < 8; x++) {\n          if (x >= srcx1 && x < srcx2 && y >= srcy1 && y < srcy2) {\n            palIndex = this.pix[tIndex];\n            tpri = priTable[fbIndex];\n            if (palIndex !== 0 && pri <= (tpri & 0xff)) {\n              buffer[fbIndex] = palette[palIndex + palAdd];\n              tpri = (tpri & 0xf00) | pri;\n              priTable[fbIndex] = tpri;\n            }\n          }\n          fbIndex++;\n          tIndex++;\n        }\n        fbIndex -= 8;\n        fbIndex += 256;\n        tIndex -= 16;\n      }\n    } else {\n      fbIndex = (dy << 8) + dx;\n      tIndex = 63;\n      for (let y = 0; y < 8; y++) {\n        for (let x = 0; x < 8; x++) {\n          if (x >= srcx1 && x < srcx2 && y >= srcy1 && y < srcy2) {\n            palIndex = this.pix[tIndex];\n            tpri = priTable[fbIndex];\n            if (palIndex !== 0 && pri <= (tpri & 0xff)) {\n              buffer[fbIndex] = palette[palIndex + palAdd];\n              tpri = (tpri & 0xf00) | pri;\n              priTable[fbIndex] = tpri;\n            }\n          }\n          fbIndex++;\n          tIndex--;\n        }\n        fbIndex -= 8;\n        fbIndex += 256;\n      }\n    }\n  }\n\n  isTransparent(x, y) {\n    return this.pix[(y << 3) + x] === 0;\n  }\n\n  toJSON() {\n    return {\n      opaque: Array.from(this.opaque),\n      pix: Array.from(this.pix),\n    };\n  }\n\n  fromJSON(s) {\n    this.opaque.set(s.opaque);\n    this.pix.set(s.pix);\n  }\n}\n\nexport default Tile;\n", type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/src/utils.js": { text: "export function copyArrayElements(src, srcPos, dest, destPos, length) {\n  for (let i = 0; i < length; ++i) {\n    dest[destPos + i] = src[srcPos + i];\n  }\n}\n\nexport function copyArray(src) {\n  return src.slice(0);\n}\n\nexport function fromJSON(obj, state) {\n  const props = obj.constructor.JSON_PROPERTIES;\n  for (let i = 0; i < props.length; i++) {\n    const prop = props[i];\n    const current = obj[prop];\n    const value = state[prop];\n    if (ArrayBuffer.isView(current) && Array.isArray(value)) {\n      // Typed arrays: copy data in-place instead of replacing the array,\n      // since JSON.parse produces plain arrays not typed arrays.\n      current.set(value);\n    } else {\n      obj[prop] = value;\n    }\n  }\n}\n\nexport function toJSON(obj) {\n  const state = {};\n  const props = obj.constructor.JSON_PROPERTIES;\n  for (let i = 0; i < props.length; i++) {\n    const prop = props[i];\n    const value = obj[prop];\n    // Typed arrays must be converted to plain arrays for JSON.stringify,\n    // which otherwise serializes them as objects ({0: v, 1: v, ...}).\n    state[prop] = ArrayBuffer.isView(value) ? Array.from(value) : value;\n  }\n  return state;\n}\n", type: "text/javascript; charset=utf-8" }, "/vendor/jsnes/LICENSE": { text: '\n                                 Apache License\n                           Version 2.0, January 2004\n                        http://www.apache.org/licenses/\n\n   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION\n\n   1. Definitions.\n\n      "License" shall mean the terms and conditions for use, reproduction,\n      and distribution as defined by Sections 1 through 9 of this document.\n\n      "Licensor" shall mean the copyright owner or entity authorized by\n      the copyright owner that is granting the License.\n\n      "Legal Entity" shall mean the union of the acting entity and all\n      other entities that control, are controlled by, or are under common\n      control with that entity. For the purposes of this definition,\n      "control" means (i) the power, direct or indirect, to cause the\n      direction or management of such entity, whether by contract or\n      otherwise, or (ii) ownership of fifty percent (50%) or more of the\n      outstanding shares, or (iii) beneficial ownership of such entity.\n\n      "You" (or "Your") shall mean an individual or Legal Entity\n      exercising permissions granted by this License.\n\n      "Source" form shall mean the preferred form for making modifications,\n      including but not limited to software source code, documentation\n      source, and configuration files.\n\n      "Object" form shall mean any form resulting from mechanical\n      transformation or translation of a Source form, including but\n      not limited to compiled object code, generated documentation,\n      and conversions to other media types.\n\n      "Work" shall mean the work of authorship, whether in Source or\n      Object form, made available under the License, as indicated by a\n      copyright notice that is included in or attached to the work\n      (an example is provided in the Appendix below).\n\n      "Derivative Works" shall mean any work, whether in Source or Object\n      form, that is based on (or derived from) the Work and for which the\n      editorial revisions, annotations, elaborations, or other modifications\n      represent, as a whole, an original work of authorship. For the purposes\n      of this License, Derivative Works shall not include works that remain\n      separable from, or merely link (or bind by name) to the interfaces of,\n      the Work and Derivative Works thereof.\n\n      "Contribution" shall mean any work of authorship, including\n      the original version of the Work and any modifications or additions\n      to that Work or Derivative Works thereof, that is intentionally\n      submitted to Licensor for inclusion in the Work by the copyright owner\n      or by an individual or Legal Entity authorized to submit on behalf of\n      the copyright owner. For the purposes of this definition, "submitted"\n      means any form of electronic, verbal, or written communication sent\n      to the Licensor or its representatives, including but not limited to\n      communication on electronic mailing lists, source code control systems,\n      and issue tracking systems that are managed by, or on behalf of, the\n      Licensor for the purpose of discussing and improving the Work, but\n      excluding communication that is conspicuously marked or otherwise\n      designated in writing by the copyright owner as "Not a Contribution."\n\n      "Contributor" shall mean Licensor and any individual or Legal Entity\n      on behalf of whom a Contribution has been received by Licensor and\n      subsequently incorporated within the Work.\n\n   2. Grant of Copyright License. Subject to the terms and conditions of\n      this License, each Contributor hereby grants to You a perpetual,\n      worldwide, non-exclusive, no-charge, royalty-free, irrevocable\n      copyright license to reproduce, prepare Derivative Works of,\n      publicly display, publicly perform, sublicense, and distribute the\n      Work and such Derivative Works in Source or Object form.\n\n   3. Grant of Patent License. Subject to the terms and conditions of\n      this License, each Contributor hereby grants to You a perpetual,\n      worldwide, non-exclusive, no-charge, royalty-free, irrevocable\n      (except as stated in this section) patent license to make, have made,\n      use, offer to sell, sell, import, and otherwise transfer the Work,\n      where such license applies only to those patent claims licensable\n      by such Contributor that are necessarily infringed by their\n      Contribution(s) alone or by combination of their Contribution(s)\n      with the Work to which such Contribution(s) was submitted. If You\n      institute patent litigation against any entity (including a\n      cross-claim or counterclaim in a lawsuit) alleging that the Work\n      or a Contribution incorporated within the Work constitutes direct\n      or contributory patent infringement, then any patent licenses\n      granted to You under this License for that Work shall terminate\n      as of the date such litigation is filed.\n\n   4. Redistribution. You may reproduce and distribute copies of the\n      Work or Derivative Works thereof in any medium, with or without\n      modifications, and in Source or Object form, provided that You\n      meet the following conditions:\n\n      (a) You must give any other recipients of the Work or\n          Derivative Works a copy of this License; and\n\n      (b) You must cause any modified files to carry prominent notices\n          stating that You changed the files; and\n\n      (c) You must retain, in the Source form of any Derivative Works\n          that You distribute, all copyright, patent, trademark, and\n          attribution notices from the Source form of the Work,\n          excluding those notices that do not pertain to any part of\n          the Derivative Works; and\n\n      (d) If the Work includes a "NOTICE" text file as part of its\n          distribution, then any Derivative Works that You distribute must\n          include a readable copy of the attribution notices contained\n          within such NOTICE file, excluding those notices that do not\n          pertain to any part of the Derivative Works, in at least one\n          of the following places: within a NOTICE text file distributed\n          as part of the Derivative Works; within the Source form or\n          documentation, if provided along with the Derivative Works; or,\n          within a display generated by the Derivative Works, if and\n          wherever such third-party notices normally appear. The contents\n          of the NOTICE file are for informational purposes only and\n          do not modify the License. You may add Your own attribution\n          notices within Derivative Works that You distribute, alongside\n          or as an addendum to the NOTICE text from the Work, provided\n          that such additional attribution notices cannot be construed\n          as modifying the License.\n\n      You may add Your own copyright statement to Your modifications and\n      may provide additional or different license terms and conditions\n      for use, reproduction, or distribution of Your modifications, or\n      for any such Derivative Works as a whole, provided Your use,\n      reproduction, and distribution of the Work otherwise complies with\n      the conditions stated in this License.\n\n   5. Submission of Contributions. Unless You explicitly state otherwise,\n      any Contribution intentionally submitted for inclusion in the Work\n      by You to the Licensor shall be under the terms and conditions of\n      this License, without any additional terms or conditions.\n      Notwithstanding the above, nothing herein shall supersede or modify\n      the terms of any separate license agreement you may have executed\n      with Licensor regarding such Contributions.\n\n   6. Trademarks. This License does not grant permission to use the trade\n      names, trademarks, service marks, or product names of the Licensor,\n      except as required for reasonable and customary use in describing the\n      origin of the Work and reproducing the content of the NOTICE file.\n\n   7. Disclaimer of Warranty. Unless required by applicable law or\n      agreed to in writing, Licensor provides the Work (and each\n      Contributor provides its Contributions) on an "AS IS" BASIS,\n      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or\n      implied, including, without limitation, any warranties or conditions\n      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A\n      PARTICULAR PURPOSE. You are solely responsible for determining the\n      appropriateness of using or redistributing the Work and assume any\n      risks associated with Your exercise of permissions under this License.\n\n   8. Limitation of Liability. In no event and under no legal theory,\n      whether in tort (including negligence), contract, or otherwise,\n      unless required by applicable law (such as deliberate and grossly\n      negligent acts) or agreed to in writing, shall any Contributor be\n      liable to You for damages, including any direct, indirect, special,\n      incidental, or consequential damages of any character arising as a\n      result of this License or out of the use or inability to use the\n      Work (including but not limited to damages for loss of goodwill,\n      work stoppage, computer failure or malfunction, or any and all\n      other commercial damages or losses), even if such Contributor\n      has been advised of the possibility of such damages.\n\n   9. Accepting Warranty or Additional Liability. While redistributing\n      the Work or Derivative Works thereof, You may choose to offer,\n      and charge a fee for, acceptance of support, warranty, indemnity,\n      or other liability obligations and/or rights consistent with this\n      License. However, in accepting such obligations, You may act only\n      on Your own behalf and on Your sole responsibility, not on behalf\n      of any other Contributor, and only if You agree to indemnify,\n      defend, and hold each Contributor harmless for any liability\n      incurred by, or claims asserted against, such Contributor by reason\n      of your accepting any such warranty or additional liability.\n\n   END OF TERMS AND CONDITIONS\n\n   Copyright 2020 Ben Firshman\n\n   Licensed under the Apache License, Version 2.0 (the "License");\n   you may not use this file except in compliance with the License.\n   You may obtain a copy of the License at\n\n       http://www.apache.org/licenses/LICENSE-2.0\n\n   Unless required by applicable law or agreed to in writing, software\n   distributed under the License is distributed on an "AS IS" BASIS,\n   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.\n   See the License for the specific language governing permissions and\n   limitations under the License.\n', type: "text/plain; charset=utf-8" }, "/LICENSE": { text: 'MIT License\n\nCopyright (c) 2026 Rick Gerkin\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n', type: "text/plain; charset=utf-8" }, "/THIRD_PARTY_NOTICES.md": { text: "# Third-party notices and excluded game content\n\nThe MIT license in this repository applies to the original browser UI, integration, scripts, and documentation authored for this project. It does not relicense third-party software or grant rights to Contra.\n\n## Included: JSNES 2.1.0\n\nJSNES is an NES emulator by Ben Firshman and contributors, distributed under Apache License 2.0. Its unmodified source and compiled bundle are included at `web/vendor/jsnes/`. The full upstream license is retained at `web/vendor/jsnes/LICENSE`; version metadata is in `web/vendor/jsnes/package.json`. Upstream: https://github.com/bfirsh/jsnes. Registry archive integrity is recorded in `sources.lock.json`. The npm archive contains no separate NOTICE file. We have not modified the included JSNES files.\n\n## Excluded: Contra and its annotated disassembly\n\nContra game code, ROM images, extracted graphics/audio, screenshots, sprites, the generated standalone HTML containing a ROM, and save states are not included in the Git repository. Contra names and marks identify the game and do not imply affiliation or endorsement by Konami.\n\nThe annotated reconstruction is available separately at https://github.com/vermiceli/nes-contra-us. No license file was present at the pinned revision. This repository therefore links to that upstream project without redistributing its contents or claiming a license to them. File hashes, revision identifiers, ROM fingerprints, and interoperability references are metadata, not a bundled copy of the game.\n\n## Optional local toolchain: cc65\n\nThe build instructions reference cc65 V2.19 at https://github.com/cc65/cc65, under its upstream zlib-style license. Neither its source nor native binaries are redistributed here. Obtain and retain upstream licensing when using it separately.\n\nUsers must supply a game image and separately obtain any reconstruction sources they are authorized to use. The browser file chooser reads the selected ROM locally; it does not upload it. Generated ROMs, extracted assets, and ROM-containing standalone packages must remain outside this public repository. A local rebuild does not grant redistribution rights.\n", type: "text/markdown; charset=utf-8" } };

// src/entry.mjs
var headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
};
var response = /* @__PURE__ */ __name((body2, status = 200, extra = {}) => new Response(body2, { status, headers: { ...headers, ...extra } }), "response");
var json = /* @__PURE__ */ __name((body2, status = 200) => response(JSON.stringify(body2), status, { "Content-Type": "application/json" }), "json");
async function body(request) {
  if (!(request.headers.get("Content-Type") || "").startsWith("application/json")) throw new RoomError(415, "Expected JSON");
  let value;
  try {
    value = JSON.parse(await boundedText(request, 65536));
  } catch {
    throw new RoomError(400, "Invalid or oversized JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RoomError(400, "Expected an object");
  return value;
}
__name(body, "body");
var ContraRoom = class extends DurableObject {
  static {
    __name(this, "ContraRoom");
  }
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL)");
  }
  async invoke(method, ...args) {
    try {
      const execute = await prepareAction(method, args);
      const outcome = this.ctx.storage.transactionSync(() => {
        const rows = this.ctx.storage.sql.exec("SELECT state FROM room WHERE id=1").toArray();
        const result = execute(rows.length ? JSON.parse(rows[0].state) : null, Date.now());
        this.ctx.storage.sql.exec("INSERT OR REPLACE INTO room(id,state) VALUES(1,?)", JSON.stringify(result.state));
        return result;
      });
      await this.ctx.storage.setAlarm(outcome.state.expires);
      return { ok: true, value: outcome.result };
    } catch (error) {
      if (error instanceof RoomError) return { ok: false, status: error.status, error: error.message };
      throw error;
    }
  }
  async alarm() {
    const rows = this.ctx.storage.sql.exec("SELECT state FROM room WHERE id=1").toArray();
    const expiry = rows.length ? JSON.parse(rows[0].state).expires : 0;
    if (expiry > Date.now()) await this.ctx.storage.setAlarm(expiry);
    else await this.ctx.storage.deleteAll();
  }
};
var LoginThrottle = class extends DurableObject {
  static {
    __name(this, "LoginThrottle");
  }
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS throttle (id INTEGER PRIMARY KEY CHECK(id=1), until INTEGER, count INTEGER)");
  }
  async attempt() {
    const value = this.ctx.storage.transactionSync(() => {
      const rows = this.ctx.storage.sql.exec("SELECT until,count FROM throttle WHERE id=1").toArray(), now = Date.now();
      const value2 = rows.length && now < rows[0].until ? rows[0] : { until: now + 6e4, count: 0 };
      value2.count++;
      this.ctx.storage.sql.exec("INSERT OR REPLACE INTO throttle(id,until,count) VALUES(1,?,?)", value2.until, value2.count);
      return value2;
    });
    await this.ctx.storage.setAlarm(value.until);
    return value.count <= 10;
  }
  async alarm() {
    const rows = this.ctx.storage.sql.exec("SELECT until FROM throttle WHERE id=1").toArray();
    if (rows.length && rows[0].until > Date.now()) await this.ctx.storage.setAlarm(rows[0].until);
    else await this.ctx.storage.deleteAll();
  }
};
async function roomCall(stub, ...args) {
  const result = await stub.invoke(...args);
  if (!result.ok) throw new RoomError(result.status, result.error);
  return result.value;
}
__name(roomCall, "roomCall");
var entry_default = {
  async fetch(request, env) {
    try {
      const url = new URL(request.url), path = url.pathname;
      if (!env.SITE_PASSWORD || !env.SESSION_SECRET) return response("Private Contra setup is incomplete.", 503);
      if (request.method === "POST" && request.headers.get("Origin") !== url.origin) return response("Origin not allowed", 403);
      if (path === "/login") {
        if (request.method === "GET") return response(loginPage(), 200, { "Content-Type": "text/html; charset=utf-8" });
        if (request.method !== "POST") return response("Method not allowed", 405);
        const id = await sha(request.headers.get("CF-Connecting-IP") || "unknown");
        if (!await env.LOGIN_THROTTLE.getByName(id).attempt()) return response("Too many attempts. Try again in a minute.", 429);
        if (!(request.headers.get("Content-Type") || "").startsWith("application/x-www-form-urlencoded")) return response("Expected form data", 415);
        const password = new URLSearchParams(await boundedText(request, 2048)).get("password") || "";
        if (!equal(await sha(password), await sha(env.SITE_PASSWORD))) return response(loginPage(true), 401, { "Content-Type": "text/html; charset=utf-8" });
        return response(null, 303, { "Location": "/", "Set-Cookie": await sessionCookie(env.SESSION_SECRET) });
      }
      if (!await authenticated(request, env.SESSION_SECRET)) return path.startsWith("/api/") ? json({ error: "Sign in at the game site first." }, 401) : response(null, 303, { "Location": "/login" });
      if (path === "/api/config" && request.method === "GET") return json({ iceServers: [], directOnly: true, peerCartridge: true });
      if (path === "/api/rooms" && request.method === "POST") {
        const input = await body(request), id = await sha("create:" + request.headers.get("CF-Connecting-IP"));
        if (!await env.LOGIN_THROTTLE.getByName(id).attempt()) return json({ error: "Too many rooms; try again in a minute." }, 429);
        const room = randomToken(18);
        return json(await roomCall(env.ROOMS.getByName(room), "create", input.players || 2, room), 201);
      }
      if (path.startsWith("/api/")) {
        const match = path.match(/^\/api\/rooms\/([A-Za-z0-9_-]{24})$/);
        if (!match) return json({ error: "Only room introductions are supported; cloud gameplay relay is disabled." }, 404);
        const stub = env.ROOMS.getByName(match[1]);
        if (request.method === "POST") {
          const input = await body(request);
          if (Object.hasOwn(input, "invite")) return json(await roomCall(stub, "join", input.invite));
          return json(await roomCall(stub, "access", (request.headers.get("Authorization") || "").replace(/^Bearer /, ""), input));
        }
        if (request.method === "GET") return json(await roomCall(stub, "access", (request.headers.get("Authorization") || "").replace(/^Bearer /, "")));
        return json({ error: "Method not allowed" }, 405);
      }
      if (!["GET", "HEAD"].includes(request.method)) return response("Method not allowed", 405);
      const asset = cloudflare_assets_inline_default[path === "/" ? "/index.html" : path];
      if (!asset) return response("Not found", 404);
      return response(request.method === "HEAD" ? null : asset.text, 200, { "Content-Type": asset.type });
    } catch (error) {
      return json({ error: error instanceof RoomError ? error.message : "Request failed" }, error instanceof RoomError ? error.status : 400);
    }
  }
};
export {
  ContraRoom,
  LoginThrottle,
  entry_default as default
};
//# sourceMappingURL=entry.js.map
