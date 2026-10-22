// MIT License — Copyright (c) 2026 Rick Gerkin.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {authenticated,sessionCookie,boundedText} from '../cloudflare/src/auth.mjs';
import {prepareAction} from '../cloudflare/src/room-state.mjs';
const origin='https://contra.example';
test('password session cookies are signed, time-limited, and reject tampering',async()=>{
  const now=Date.now(),secret='test-only-signing-secret',cookie=await sessionCookie(secret,now);
  assert(cookie.includes('HttpOnly; Secure; SameSite=Strict'));
  const request=value=>new Request(origin,{headers:{Cookie:value}});
  assert(await authenticated(request(cookie),secret,now+1000));
  assert(!await authenticated(request(cookie),secret,now+9*60*60*1000));
  assert(!await authenticated(request(cookie),secret+'wrong',now));
  assert(!await authenticated(request(cookie.replace('contra_session=','contra_session=9')),secret,now));
  assert(!await authenticated(request('contra_session=garbage'),secret,now));
});
test('four-player signaling survives serialization and authenticates every direction',async()=>{
  let state=null,now=Date.now();
  async function invoke(method,...args){const execute=await prepareAction(method,args),outcome=execute(state?structuredClone(state):null,now);state=JSON.parse(JSON.stringify(outcome.state));return outcome.result;}
  const host=await invoke('create',4,'a'.repeat(24)),peers=[host];
  for(let i=0;i<3;i++)peers.push(await invoke('join',host.invite));
  assert.deepEqual(peers.map(p=>p.player),[1,2,3,4]);
  assert(!JSON.stringify(state).includes(host.token));assert(!JSON.stringify(state).includes(host.invite));
  await assert.rejects(invoke('join',host.invite),e=>e.status===409);
  await assert.rejects(invoke('access','bad-token'),e=>e.status===403);
  for(let p=2;p<=4;p++){
    await invoke('access',host.token,{to:p,description:{type:'offer',sdp:'offer-'+p}});
    const guest=await invoke('access',peers[p-1].token);assert.equal(guest.offers[p].sdp,'offer-'+p);assert.equal(guest.offers[p===2?3:2],undefined);
    await invoke('access',peers[p-1].token,{to:1,description:{type:'answer',sdp:'answer-'+p}});
  }
  const status=await invoke('access',host.token);assert.equal(Object.keys(status.answers).length,3);
  await assert.rejects(invoke('access',peers[1].token,{to:3,description:{type:'offer',sdp:'spoof'}}),e=>e.status===400);
  await assert.rejects(invoke('access',host.token,{transport:'relay',messages:['input']}),e=>e.status===400);
  await assert.rejects(invoke('access',host.token,{to:2,description:{type:'offer',sdp:'changed'}}),e=>e.status===409);
  now=state.expires+1;await assert.rejects(invoke('access',host.token),e=>e.status===404);
});
test('login and signaling body reads enforce actual streamed size, not just headers',async()=>{
  assert.equal(await boundedText(new Request(origin,{method:'POST',body:'small'}),8),'small');
  await assert.rejects(boundedText(new Request(origin,{method:'POST',body:'too large'}),4));
});
