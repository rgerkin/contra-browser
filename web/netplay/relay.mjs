// MIT License — Copyright (c) 2026 Rick Gerkin.
// Same-origin, authenticated streaming HTTP fallback; uses TLS when hosted on
// HTTPS. It carries only the bounded room protocol, not the ROM or snapshots.
export class RelayChannel {
  constructor({room,player,request,token,signal,onError}) {
    Object.assign(this,{room,player,request,token,signal,onError});
    this.readyState='connecting';this.pending=[];this.sending=false;this.bytes=0;
  }
  get bufferedAmount(){return this.bytes;}
  async open() {
    const response=await fetch(`/api/rooms/${this.room}/events`,{headers:{Authorization:`Bearer ${this.token}`},signal:this.signal});
    if(!response.ok){const result=await response.json();throw new Error(result.error || 'Relay stream unavailable');}
    this.reader=response.body.getReader();this.readyState='open';this.onopen?.();
    this.receive().catch(error=>{if(this.readyState!=='closed')this.onError(error);});
  }
  send(data) {
    if(this.readyState!=='open')throw new Error('Relay is not open');
    if(typeof data!=='string' || data.length>4096 || this.bytes+data.length>262144)throw new Error('Relay send buffer is full');
    this.pending.push(data);this.bytes+=data.length;
    this.flush().catch(error=>{if(this.readyState!=='closed')this.onError(error);});
  }
  async flush() {
    if(this.sending)return;
    this.sending=true;
    try {
      while(this.pending.length && this.readyState==='open') {
        const messages=this.pending.splice(0,16);
        await this.request(`/api/rooms/${this.room}`,{messages});
        this.bytes=Math.max(0,this.bytes-messages.reduce((sum,message)=>sum+message.length,0));
      }
    } finally {this.sending=false;}
  }
  async receive() {
    const decoder=new TextDecoder();let buffer='';
    while(this.readyState==='open') {
      const {value,done}=await this.reader.read();
      if(done)throw new Error('Relay disconnected. Create a new room to reconnect.');
      buffer+=decoder.decode(value,{stream:true});
      let end;
      while((end=buffer.indexOf('\n'))!==-1) {
        const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
        if(line.length>262144)throw new Error('Relay batch is too large');
        if(!line)continue;
        const messages=JSON.parse(line);
        if(!Array.isArray(messages) || messages.length>32)throw new Error('Invalid relay batch');
        for(const message of messages) {
          if(message.from!==3-this.player || typeof message.data!=='string' || message.data.length>4096)throw new Error('Invalid relay sender/message');
          this.onmessage?.({data:message.data});
        }
      }
      if(buffer.length>262144)throw new Error('Relay frame is too large');
    }
  }
  close() {
    if(this.readyState==='closed')return;
    this.readyState='closed';this.pending=[];this.bytes=0;
    this.reader?.cancel().catch(()=>{});
  }
}
