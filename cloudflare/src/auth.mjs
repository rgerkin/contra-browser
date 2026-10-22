// MIT License — Copyright (c) 2026 Rick Gerkin.
const encoder=new TextEncoder();
const COOKIE='contra_session';
const hours=8*60*60;
export const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;};
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
export const sha=async value=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));
async function signature(payload,secret){const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',key,encoder.encode(payload)));}
export async function sessionCookie(secret,now=Date.now()) {
  const payload=`${Math.floor(now/1000)+hours}.${crypto.randomUUID()}`;
  return `${COOKIE}=${payload}.${await signature(payload,secret)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${hours}`;
}
export async function authenticated(request,secret,now=Date.now()) {
  const value=(request.headers.get('Cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  if(!value || value.length>200)return false;
  const [expiry,nonce,mac,...extra]=value.split('.');
  if(extra.length||!/^\d{10}$/.test(expiry||'')||!/^[-a-f0-9]{36}$/.test(nonce||'')||!Number.isSafeInteger(Number(expiry))||Number(expiry)<=Math.floor(now/1000)||Number(expiry)>Math.floor(now/1000)+hours||!/^[a-f0-9]{64}$/.test(mac||''))return false;
  return equal(mac,await signature(`${expiry}.${nonce}`,secret));
}
export function loginPage(error=false){return `<!doctype html><html lang="en"><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><title>Contra · Private game</title><style>body{background:#111511;color:#eee;font:18px system-ui;max-width:420px;margin:15vh auto;padding:24px}input,button{font:inherit;padding:12px;box-sizing:border-box;width:100%;margin:12px 0}button{cursor:pointer}p{color:#b9c5b5}</style><h1>Contra</h1><p>Enter the shared game password.</p>${error?'<p role="alert">Password not accepted. Try again.</p>':''}<form method="post" action="/login"><label>Password<input name="password" type="password" autocomplete="current-password" maxlength="256" required autofocus></label><button>Open game</button></form></html>`;}
export async function boundedText(request,max) {
  if(Number(request.headers.get('Content-Length'))>max)throw new Error('Request too large');
  const reader=request.body?.getReader();if(!reader)return '';
  const chunks=[];let size=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new Error('Request too large');}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes);
}
