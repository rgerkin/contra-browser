// MIT License — Copyright (c) 2026 Rick Gerkin.
// Deterministic two-player boot using only controller input and RAM state
// observations. No copyrighted game instructions or assets are embedded here.
export function prepareTwoPlayerGame(nes, rom) {
  nes.loadROM(rom);
  for(let p=1;p<=2;p++)for(let b=0;b<8;b++)nes.buttonUp(p,b);
  const step=count=>{for(let i=0;i<count;i++)nes.frame();};
  step(600);
  nes.buttonDown(1,2);step(2);nes.buttonUp(1,2);step(2);
  nes.buttonDown(1,3);step(2);nes.buttonUp(1,3);
  for(let i=0;i<900;i++) {
    if(nes.cpu.mem[0x18]===5 && nes.cpu.mem[0x2c]===4 && nes.cpu.mem[0x90]===1 && nes.cpu.mem[0x91]===1) {
      if(nes.cpu.mem[0x22]!==1 || nes.cpu.mem[0x1c]!==0)throw new Error('Two-player startup verification failed');
      return;
    }
    nes.frame();
  }
  throw new Error('Could not enter two-player gameplay');
}

export async function stateHash(nes) {
  const bytes=new TextEncoder().encode(JSON.stringify(nes.toJSON()));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
