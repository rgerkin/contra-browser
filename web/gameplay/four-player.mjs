// MIT License — Copyright (c) 2026 Rick Gerkin.
// Emulator extension for the verified US cartridge. Only addresses and original
// integration code live here; instructions, sprite definitions, and tiles are
// read from the user's cartridge at runtime.
const UPDATE=0xd3b4, MOVE=0xd460, COLLIDE=0xe1d9, DRAW=0xae9d, TILE=0xaee3;
const FIELDS=[0x33,0x39,0xf2,0xf6,0xfa,0x301,0x31b,0x335,0x34f,0x7e4,0x7e5,
  ...Array.from({length:38},(_,i)=>0x91+i*2)];
const index=address=>FIELDS.indexOf(address);
const reverse=mask=>{let out=0;for(let i=0;i<8;i++)out|=((mask>>i)&1)<<(7-i);return out;};

export class FourPlayer {
  constructor(nes, count=4) {
    if(![3,4].includes(count))throw new Error('Squad mode needs three or four characters');
    if(nes.fourPlayer)throw new Error('Four-player extension already installed');
    this.count=count;this.nes=nes;this.masks=[0,0,0,0];this.previous=[0,0];this.traps=[];this.tiles=[[],[]];this.busy=false;
    this.owners=Array(16).fill(0);
    this.level=nes.cpu.mem[0x30];this.players=Array.from({length:count-2},()=>this.read());
    this.players.forEach((state,i)=>{state[index(0x335)]=80+i*24;});
    this.originalWrite=nes.cpu.write;
    const extension=this;
    nes.cpu.write=function(address,value){
      if(address>=0x388 && address<0x398 && !this.mem[address] && value)extension.owners[address-0x388]=extension.contextPlayer || this.mem[0x448+address-0x388]+1;
      return extension.originalWrite.call(this,address,value);
    };
    this.originalEmulate=nes.cpu.emulate;
    const engine=this;
    nes.cpu.emulate=function(){return engine.emulate();};
    this.originalFrame=nes.ui.writeFrame;
    nes.ui.writeFrame=buffer=>{this.paint(buffer);this.originalFrame(buffer);};
    this.originalJSON=nes.toJSON;
    nes.toJSON=()=>({...this.originalJSON.call(nes),fourPlayer:{version:1,level:this.level,count:this.count,players:this.players,owners:this.owners,previous:this.previous,masks:this.masks}});
    nes.fourPlayer=this;
  }
  read(){return FIELDS.map(a=>this.nes.cpu.mem[a]);}
  write(state){FIELDS.forEach((a,i)=>{this.nes.cpu.mem[a]=state[i];});}
  get status(){return this.players.map((p,i)=>({player:i+3,x:p[index(0x335)],y:p[index(0x31b)],state:p[index(0x91)],lives:p[index(0x33)],gameOver:p[index(0x39)],weapon:p[index(0xab)]}));}
  setInputs(masks){if(masks.length!==this.count || masks.some(mask=>!Number.isInteger(mask)||mask<0||mask>255))throw new Error('Input count must match character count');this.masks=[...masks];}
  // Invoke a cartridge subroutine as an extra simulation operation, without
  // advancing video/audio time or disturbing the interrupted CPU context.
  call(address,{bank,x=1,a=0,setup=()=>{}}={}) {
    const {cpu,ppu,mmap}=this.nes,m=cpu.mem;
    const registers=Object.fromEntries(Object.entries(cpu).filter(([,v])=>typeof v==='number'||typeof v==='boolean'));
    const scratch=m.slice(0,0x18),stack=m.slice(0x1a0,0x200),prior=m.slice(0x7ec,0x7ee),oldBank=m[0x8000];
    const advance=ppu.advanceDots;
    this.busy=true;ppu.advanceDots=()=>{};
    try {
      cpu.irqRequested=false;cpu.nmiRaised=false;cpu.nmiPending=false;cpu.nmiImmediate=false;
      cpu.REG_SP=0xff;cpu.REG_X=x;cpu.REG_ACC=a;
      if(bank!==undefined)mmap.loadRomBank(bank,0x8000);
      // RTS pops the stored return address and increments it. $6000 is a sentinel.
      cpu.push(0x5f);cpu.push(0xff);cpu.REG_PC=address-1;setup(m);
      let instructions=0;
      while(cpu.REG_PC!==0x5fff) {
        if(cpu.REG_SP<0xa0)throw new Error('Four-player cartridge stack budget exceeded');
        if(++instructions>30000)throw new Error('Four-player cartridge routine exceeded its instruction budget');
        this.originalEmulate.call(cpu);
      }
    } finally {
      mmap.loadRomBank(oldBank,0x8000);m.set(scratch,0);m.set(stack,0x1a0);m.set(prior,0x7ec);
      Object.assign(cpu,registers);ppu.advanceDots=advance;this.busy=false;
    }
  }
  withPlayer(i,callback) {
    const saved=this.read(),context=this.contextPlayer;this.contextPlayer=i+3;this.write(this.players[i]);
    try{callback();this.players[i]=this.read();}finally{this.write(saved);this.contextPlayer=context;}
  }
  emulate() {
    const cpu=this.nes.cpu,m=cpu.mem,pc=cpu.REG_PC+1;
    if(!this.busy) {
      const trap=this.traps.at(-1);
      if(trap && trap.pc===pc && trap.sp===cpu.REG_SP) {
        this.traps.pop();trap.callback();
      }
      if(m[0x18]===5) {
        // Laser/flame/spread updates consult their owner's position and weapon.
        // Run those updates against the extra context that created the bullet.
        if(pc===0xb961 && m[0x8000]===6 && this.owners[cpu.REG_X]>=3) {
          const owner=this.owners[cpu.REG_X]-3;
          if(owner<this.players.length)this.withPlayer(owner,()=>this.call(0xb961,{x:cpu.REG_X}));
          cpu.REG_PC=cpu.pull() | cpu.pull()<<8;
          return 0;
        }
        if(pc===0xcf0a && this.players.some(p=>!p[index(0x39)]))cpu.REG_PC=0xcef6;
        let callback;
        if(pc===UPDATE)callback=()=>this.update();
        else if(pc===COLLIDE)callback=()=>this.collide();
        else if(pc===DRAW && m[0x8000]===1)callback=()=>this.draw();
        if(callback) {
          const sp=cpu.REG_SP;
          this.traps.push({pc:((m[0x100|((sp+1)&255)] | m[0x100|((sp+2)&255)]<<8)+1)&65535,sp:((sp+2)&255),callback});
        }
      }
    }
    return this.originalEmulate.call(cpu);
  }
  update() {
    const m=this.nes.cpu.mem;
    if(this.level!==m[0x30]) {
      this.level=m[0x30];this.players=this.players.map(old=>{
        const state=this.read();state[index(0x33)]=old[index(0x33)];state[index(0x39)]=old[index(0x39)];return state;
      });
    }
    const originalScroll=m[0x68];
    for(let i=0;i<this.players.length;i++) {
      this.withPlayer(i,()=>{
        const state=reverse(this.masks[i+2]);m[0xf2]=state;m[0xf6]=state&~this.previous[i];m[0xfa]=state;
        this.previous[i]=state;m[0xa3]=0;
        if(!m[0x39])this.call(MOVE);
      });
    }
    const scroll=m[0x68];
    if(m[0x40]===0) {
      // Apply the shared camera movement once to every character who did not
      // cause it. The stock engine already corrected the original two players.
      for(let i=0;i<this.players.length;i++) {
        const p=this.players[i];
        if(!p[index(0xa3)] && scroll) {
          const addr=m[0x41]===0?0x335:0x31b;
          p[index(addr)]=(p[index(addr)]+(m[0x41]===0?-scroll:scroll))&255;
        }
      }
      const extra=Math.max(0,scroll-originalScroll);
      if(extra)for(let i=0;i<2;i++) {
        const addr=m[0x41]===0?0x334+i:0x31a+i;
        m[addr]=(m[addr]+(m[0x41]===0?-extra:extra))&255;
      }
    }
  }
  collide() {
    const m=this.nes.cpu.mem,savedState=m[0x90];
    // Reuse the collision routine with the two additional, independent player
    // contexts. Enemy health, pickups and bullets remain in the same world RAM.
    try {
      m[0x90]=3;
      for(let i=0;i<this.players.length;i++)this.withPlayer(i,()=>{if(!m[0x39])this.call(COLLIDE);});
    } finally {m[0x90]=savedState;}
  }
  draw() {
    const m=this.nes.cpu.mem,oam=m.slice(0x200,0x300);
    this.tiles=[[],[]];
    try {
      for(let i=0;i<this.players.length;i++)this.withPlayer(i,()=>{
        if(m[0x39] || !m[0x301])return;
        m.fill(0xf4,0x200,0x300);
        this.call(TILE,{bank:1,a:m[0x301],setup:m=>{
          m[0]=m[0x34f];m[1]=m[0x31b];m[2]=m[0x335];m[4]=0;m[7]=63;
        }});
        for(let a=0x200;a<0x300;a+=4)if(m[a]!==0xf4)this.tiles[i].push(Array.from(m.slice(a,a+4)));
      });
    } finally {m.set(oam,0x200);}
  }
  paint(buffer) {
    const ppu=this.nes.ppu;
    if(this.nes.cpu.mem[0x18]!==5 || ppu.f_spVisibility!==1)return;
    // Extra characters use the cartridge's tile geometry and skin/shadow colors.
    // Substitute only the colored clothing, independently of enemy palettes.
    const clothing=[0x50c040,0x30c8f0]; // JSNES pixels are packed BGR.
    for(let player=0;player<this.players.length;player++)for(const [sy,tile,attr,sx] of this.tiles[player]) {
      const height=ppu.f_spriteSize?16:8;
      for(let y=0;y<height;y++)for(let x=0;x<8;x++) {
        const dx=sx+x,dy=sy+1+y;if(dx<8||dx>=248||dy<8||dy>=232)continue;
        const py=attr&128?height-1-y:y;
        const pattern=height===16?((tile&1)*256+(tile&254)+(py>>3)):tile+(ppu.f_spPatternTable?256:0);
        const color=ppu.ptTile[pattern].pix[(py&7)*8+(attr&64?7-x:x)];if(!color)continue;
        const at=dy*256+dx;
        if((attr&32) && (ppu.pixrendered[at]&256))continue;
        buffer[at]=color===2?clothing[player]:ppu.sprPalette[(attr&3)*4+color];
      }
    }
  }
  dispose() {
    const nes=this.nes;nes.cpu.emulate=this.originalEmulate;nes.cpu.write=this.originalWrite;nes.ui.writeFrame=this.originalFrame;nes.toJSON=this.originalJSON;
    delete nes.fourPlayer;
  }
}
