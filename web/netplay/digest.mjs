// MIT License — Copyright (c) 2026 Rick Gerkin.
// SHA-2 fallback for LAN HTTP, where WebCrypto is unavailable. Constants are
// the standard fractional square/cube roots of the first prime numbers.
const SHA2_H=[0x6a09e667f3bcc908n,0xbb67ae8584caa73bn,0x3c6ef372fe94f82bn,0xa54ff53a5f1d36f1n,0x510e527fade682d1n,0x9b05688c2b3e6c1fn,0x1f83d9abfb41bd6bn,0x5be0cd19137e2179n];
const SHA2_K=[0x428a2f98d728ae22n,0x7137449123ef65cdn,0xb5c0fbcfec4d3b2fn,0xe9b5dba58189dbbcn,0x3956c25bf348b538n,0x59f111f1b605d019n,0x923f82a4af194f9bn,0xab1c5ed5da6d8118n,0xd807aa98a3030242n,0x12835b0145706fben,0x243185be4ee4b28cn,0x550c7dc3d5ffb4e2n,0x72be5d74f27b896fn,0x80deb1fe3b1696b1n,0x9bdc06a725c71235n,0xc19bf174cf692694n,0xe49b69c19ef14ad2n,0xefbe4786384f25e3n,0xfc19dc68b8cd5b5n,0x240ca1cc77ac9c65n,0x2de92c6f592b0275n,0x4a7484aa6ea6e483n,0x5cb0a9dcbd41fbd4n,0x76f988da831153b5n,0x983e5152ee66dfabn,0xa831c66d2db43210n,0xb00327c898fb213fn,0xbf597fc7beef0ee4n,0xc6e00bf33da88fc2n,0xd5a79147930aa725n,0x6ca6351e003826fn,0x142929670a0e6e70n,0x27b70a8546d22ffcn,0x2e1b21385c26c926n,0x4d2c6dfc5ac42aedn,0x53380d139d95b3dfn,0x650a73548baf63den,0x766a0abb3c77b2a8n,0x81c2c92e47edaee6n,0x92722c851482353bn,0xa2bfe8a14cf10364n,0xa81a664bbc423001n,0xc24b8b70d0f89791n,0xc76c51a30654be30n,0xd192e819d6ef5218n,0xd69906245565a910n,0xf40e35855771202an,0x106aa07032bbd1b8n,0x19a4c116b8d2d0c8n,0x1e376c085141ab53n,0x2748774cdf8eeb99n,0x34b0bcb5e19b48a8n,0x391c0cb3c5c95a63n,0x4ed8aa4ae3418acbn,0x5b9cca4f7763e373n,0x682e6ff3d6b2b8a3n,0x748f82ee5defb2fcn,0x78a5636f43172f60n,0x84c87814a1f0ab72n,0x8cc702081a6439ecn,0x90befffa23631e28n,0xa4506cebde82bde9n,0xbef9a3f7b2c67915n,0xc67178f2e372532bn,0xca273eceea26619cn,0xd186b8c721c0c207n,0xeada7dd6cde0eb1en,0xf57d4f7fee6ed178n,0x6f067aa72176fban,0xa637dc5a2c898a6n,0x113f9804bef90daen,0x1b710b35131c471bn,0x28db77f523047d84n,0x32caab7b40c72493n,0x3c9ebe0a15c9bebcn,0x431d67c49c100d4cn,0x4cc5d4becb3e42b6n,0x597f299cfc657e2an,0x5fcb6fab3ad6faecn,0x6c44198c4a475817n];
const MASK64=(1n<<64n)-1n;
const rotr64=(v,n)=>(v>>BigInt(n))|((v<<BigInt(64-n))&MASK64);
const rotr32=(v,n)=>(v>>>n)|(v<<(32-n));
export async function digestHex(algorithm,input) {
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  if(globalThis.crypto?.subtle) {
    const hash=await crypto.subtle.digest(algorithm,bytes);
    return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
  }
  return sha2(algorithm,bytes);
}
export function sha2(algorithm,bytes) {
  if(!['SHA-256','SHA-512'].includes(algorithm))throw new Error('Unsupported digest');
  const wide=algorithm==='SHA-512',block=wide?128:64,words=wide?80:64;
  const padded=new Uint8Array(Math.ceil((bytes.length+1+(wide?16:8))/block)*block);
  padded.set(bytes);padded[bytes.length]=128;
  const view=new DataView(padded.buffer);
  const bitLength=BigInt(bytes.length)*8n;view.setBigUint64(padded.length-8,bitLength);
  if(wide) {
    const h=[...SHA2_H],w=Array(80).fill(0n);
    for(let offset=0;offset<padded.length;offset+=128) {
      for(let i=0;i<16;i++)w[i]=view.getBigUint64(offset+i*8);
      for(let i=16;i<80;i++) {
        const a=w[i-15],b=w[i-2],s0=rotr64(a,1)^rotr64(a,8)^(a>>7n),s1=rotr64(b,19)^rotr64(b,61)^(b>>6n);
        w[i]=(w[i-16]+s0+w[i-7]+s1)&MASK64;
      }
      let [a,b,c,d,e,f,g,j]=h;
      for(let i=0;i<80;i++) {
        const s1=rotr64(e,14)^rotr64(e,18)^rotr64(e,41),ch=(e&f)^((~e)&g);
        const t1=(j+s1+ch+SHA2_K[i]+w[i])&MASK64;
        const s0=rotr64(a,28)^rotr64(a,34)^rotr64(a,39),maj=(a&b)^(a&c)^(b&c),t2=(s0+maj)&MASK64;
        j=g;g=f;f=e;e=(d+t1)&MASK64;d=c;c=b;b=a;a=(t1+t2)&MASK64;
      }
      [a,b,c,d,e,f,g,j].forEach((v,i)=>{h[i]=(h[i]+v)&MASK64;});
    }
    return h.map(v=>v.toString(16).padStart(16,'0')).join('');
  }
  const h=SHA2_H.map(v=>Number(v>>32n)>>>0),k=SHA2_K.slice(0,64).map(v=>Number(v>>32n)>>>0),w=new Uint32Array(words);
  for(let offset=0;offset<padded.length;offset+=64) {
    for(let i=0;i<16;i++)w[i]=view.getUint32(offset+i*4);
    for(let i=16;i<64;i++) {
      const a=w[i-15],b=w[i-2],s0=rotr32(a,7)^rotr32(a,18)^(a>>>3),s1=rotr32(b,17)^rotr32(b,19)^(b>>>10);
      w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0;
    }
    let [a,b,c,d,e,f,g,j]=h;
    for(let i=0;i<64;i++) {
      const s1=rotr32(e,6)^rotr32(e,11)^rotr32(e,25),ch=(e&f)^(~e&g),t1=(j+s1+ch+k[i]+w[i])>>>0;
      const s0=rotr32(a,2)^rotr32(a,13)^rotr32(a,22),maj=(a&b)^(a&c)^(b&c),t2=(s0+maj)>>>0;
      j=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
    }
    [a,b,c,d,e,f,g,j].forEach((v,i)=>{h[i]=(h[i]+v)>>>0;});
  }
  return h.map(v=>v.toString(16).padStart(8,'0')).join('');
}
