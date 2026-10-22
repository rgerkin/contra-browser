// MIT License — Copyright (c) 2026 Rick Gerkin.
import {DurableObject} from 'cloudflare:workers';
import {authenticated,sessionCookie,loginPage,boundedText,sha,equal} from './auth.mjs';
import {prepareAction,RoomError,randomToken} from './room-state.mjs';
import assets from '../../build/cloudflare-assets.inline.json';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"};
const response=(body,status=200,extra={})=>new Response(body,{status,headers:{...headers,...extra}});
const json=(body,status=200)=>response(JSON.stringify(body),status,{'Content-Type':'application/json'});
async function body(request){if(!(request.headers.get('Content-Type')||'').startsWith('application/json'))throw new RoomError(415,'Expected JSON');let value;try{value=JSON.parse(await boundedText(request,65536));}catch{throw new RoomError(400,'Invalid or oversized JSON');}if(!value||typeof value!=='object'||Array.isArray(value))throw new RoomError(400,'Expected an object');return value;}
export class ContraRoom extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL)');}
  async invoke(method,...args){
    try {
    const execute=await prepareAction(method,args);
    const outcome=this.ctx.storage.transactionSync(()=>{
      const rows=this.ctx.storage.sql.exec('SELECT state FROM room WHERE id=1').toArray();
      const result=execute(rows.length?JSON.parse(String(rows[0].state)):null,Date.now());
      this.ctx.storage.sql.exec('INSERT OR REPLACE INTO room(id,state) VALUES(1,?)',JSON.stringify(result.state));
      return result;
    });
    await this.ctx.storage.setAlarm(outcome.state.expires);return {ok:true,value:outcome.result};
    } catch(error){if(error instanceof RoomError)return {ok:false,status:error.status,error:error.message};throw error;}
  }
  async alarm(){
    const rows=this.ctx.storage.sql.exec('SELECT state FROM room WHERE id=1').toArray();
    const expiry=rows.length?JSON.parse(String(rows[0].state)).expires:0;
    if(expiry>Date.now())await this.ctx.storage.setAlarm(expiry);else await this.ctx.storage.deleteAll();
  }
}
export class LoginThrottle extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS throttle (id INTEGER PRIMARY KEY CHECK(id=1), until INTEGER, count INTEGER)');}
  async attempt(){
    const value=this.ctx.storage.transactionSync(()=>{
      const rows=this.ctx.storage.sql.exec('SELECT until,count FROM throttle WHERE id=1').toArray(),now=Date.now();
      const value=rows.length&&now<Number(rows[0].until)?{until:Number(rows[0].until),count:Number(rows[0].count)}:{until:now+60000,count:0};value.count++;
      this.ctx.storage.sql.exec('INSERT OR REPLACE INTO throttle(id,until,count) VALUES(1,?,?)',value.until,value.count);return value;
    });
    await this.ctx.storage.setAlarm(value.until);return value.count<=10;
  }
  async alarm(){
    const rows=this.ctx.storage.sql.exec('SELECT until FROM throttle WHERE id=1').toArray();
    if(rows.length&&Number(rows[0].until)>Date.now())await this.ctx.storage.setAlarm(Number(rows[0].until));else await this.ctx.storage.deleteAll();
  }
}
async function roomCall(stub,...args){
  const result=await stub.invoke(...args);
  if(!result.ok)throw new RoomError(result.status,result.error);
  return result.value;
}
export default {
  async fetch(request,env){
    try {
      const url=new URL(request.url),path=url.pathname;
      if(!env.SITE_PASSWORD||!env.SESSION_SECRET)return response('Private Contra setup is incomplete.',503);
      if(request.method==='POST'&&request.headers.get('Origin')!==url.origin)return response('Origin not allowed',403);
      if(path==='/login') {
        if(request.method==='GET')return response(loginPage(),200,{'Content-Type':'text/html; charset=utf-8'});
        if(request.method!=='POST')return response('Method not allowed',405);
        const id=await sha(request.headers.get('CF-Connecting-IP')||'unknown');
        if(!await env.LOGIN_THROTTLE.getByName(id).attempt())return response('Too many attempts. Try again in a minute.',429);
        if(!(request.headers.get('Content-Type')||'').startsWith('application/x-www-form-urlencoded'))return response('Expected form data',415);
        const password=new URLSearchParams(await boundedText(request,2048)).get('password')||'';
        if(!equal(await sha(password),await sha(env.SITE_PASSWORD)))return response(loginPage(true),401,{'Content-Type':'text/html; charset=utf-8'});
        return response(null,303,{'Location':'/','Set-Cookie':await sessionCookie(env.SESSION_SECRET)});
      }
      if(!await authenticated(request,env.SESSION_SECRET))return path.startsWith('/api/')?json({error:'Sign in at the game site first.'},401):response(null,303,{'Location':'/login'});
      if(path==='/api/config'&&request.method==='GET')return json({iceServers:[],directOnly:true,peerCartridge:true});
      if(path==='/api/rooms'&&request.method==='POST'){
        const input=await body(request),id=await sha('create:'+request.headers.get('CF-Connecting-IP'));
        if(!await env.LOGIN_THROTTLE.getByName(id).attempt())return json({error:'Too many rooms; try again in a minute.'},429);
        const room=randomToken(18);return json(await roomCall(env.ROOMS.getByName(room),'create',input.players||2,room),201);
      }
      if(path.startsWith('/api/')){
        const match=path.match(/^\/api\/rooms\/([A-Za-z0-9_-]{24})$/);
        if(!match)return json({error:'Only room introductions are supported; cloud gameplay relay is disabled.'},404);
        const stub=env.ROOMS.getByName(match[1]);
        if(request.method==='POST'){
          const input=await body(request);
          if(Object.hasOwn(input,'invite'))return json(await roomCall(stub,'join',input.invite));
          return json(await roomCall(stub,'access',(request.headers.get('Authorization')||'').replace(/^Bearer /,''),input));
        }
        if(request.method==='GET')return json(await roomCall(stub,'access',(request.headers.get('Authorization')||'').replace(/^Bearer /,'')));
        return json({error:'Method not allowed'},405);
      }
      if(!['GET','HEAD'].includes(request.method))return response('Method not allowed',405);
      const asset=assets[path==='/'?'/index.html':path];
      if(!asset)return response('Not found',404);
      return response(request.method==='HEAD'?null:asset.text,200,{'Content-Type':asset.type});
    } catch(error){return json({error:error instanceof RoomError?error.message:'Request failed'},error instanceof RoomError?error.status:400);}
  }
};
