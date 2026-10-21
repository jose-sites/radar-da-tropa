export function fileType(data: Uint8Array): string | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 8 && [137,80,78,71,13,10,26,10].every((v,i) => data[i] === v)) return 'image/png';
  const ascii = (i: number, n: number) => String.fromCharCode(...data.subarray(i,i+n));
  if (data.length >= 12 && ascii(0,4) === 'RIFF' && ascii(8,4) === 'WEBP') return 'image/webp';
  if (data.length >= 24 && ascii(4,4) === 'ftyp' && /^(isom|iso2|mp4[12]|avc1|M4V )$/.test(ascii(8,4))) return 'video/mp4';
  return null;
}

export function mp4Duration(data: Uint8Array): number | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const read64 = (p: number) => Number(view.getBigUint64(p));
  let movie: number | null = null;
  let maxTrack = 0;
  function boxes(start: number, end: number, depth: number): void {
    if (depth > 8) return;
    for (let at=start; at+8<=end;) {
      let size = view.getUint32(at);
      const kind = String.fromCharCode(...data.subarray(at+4,at+8));
      let head = 8;
      if (size === 1) { if (at+16>end) return; size=read64(at+8); head=16; }
      if (size === 0) size=end-at;
      if (!Number.isSafeInteger(size) || size<head || at+size>end) return;
      if (kind === 'mvhd' || kind === 'mdhd') {
        const p=at+head;
        const version=data[p];
        if (version!==0 && version!==1) return;
        const rateAt=p+(version===1?20:12);
        const durationAt=p+(version===1?24:16);
        if (durationAt+(version===1?8:4)<=at+size) {
          const rate=view.getUint32(rateAt);
          const ticks=version===1?read64(durationAt):view.getUint32(durationAt);
          if (rate>0 && Number.isFinite(ticks)) {
            const seconds=ticks/rate;
            if (kind==='mvhd') movie=seconds;
            else maxTrack=Math.max(maxTrack,seconds);
          }
        }
      }
      if (['moov','trak','mdia'].includes(kind)) boxes(at+head,at+size,depth+1);
      at+=size;
    }
  }
  boxes(0,data.length,0);
  const seconds=Math.max(movie ?? 0,maxTrack);
  return seconds>0 && Number.isFinite(seconds) ? seconds : null;
}

// Produce a separate public copy. Strip image metadata and MP4 user metadata
// without shifting video byte offsets. Visible personal data still requires care.
export function publicEvidenceCopy(data: Uint8Array,mime: string): Uint8Array {
 const join=(parts:Uint8Array[])=>{const out=new Uint8Array(parts.reduce((n,x)=>n+x.length,0));let at=0;for(const part of parts){out.set(part,at);at+=part.length;}return out;};
 const invalid=()=>{throw new Error('Não foi possível preparar uma cópia pública válida.');};
 if(mime==='image/jpeg') {
  const parts=[data.subarray(0,2)];let at=2,segments=0,ended=false;
  while(at<data.length) {
   if(++segments>10000 || data[at]!==255) return invalid();
   const start=at;while(data[at]===255)at++;
   const marker=data[at++];
   if(marker===217){parts.push(new Uint8Array([255,217]));ended=true;break;}
   if(marker===0 || marker===216 || at+2>data.length) return invalid();
   const length=(data[at]<<8)|data[at+1];if(length<2 || at+length>data.length)return invalid();
   const end=at+length;
   if(!(marker>=224 && marker<=239) && marker!==254)parts.push(data.subarray(start,end));
   at=end;
   if(marker===218) {
    const scan=at;
    while(at<data.length){if(data[at]===255){let next=at+1;while(data[next]===255)next++;if(data[next]!==0 && !(data[next]>=208 && data[next]<=215))break;at=next+1;}else at++;}
    parts.push(data.subarray(scan,at));
   }
  }
  if(!ended)return invalid();return join(parts);
 }
 if(mime==='image/png') {
  const parts=[data.subarray(0,8)];const view=new DataView(data.buffer,data.byteOffset,data.byteLength);let at=8,count=0,ended=false;
  while(at+12<=data.length){if(++count>10000)return invalid();const length=view.getUint32(at),end=at+length+12;if(end>data.length)return invalid();const kind=String.fromCharCode(...data.subarray(at+4,at+8));if(['IHDR','PLTE','IDAT','IEND','tRNS'].includes(kind))parts.push(data.subarray(at,end));at=end;if(kind==='IEND'){ended=true;break;}}
  if(!ended)return invalid();return join(parts);
 }
 if(mime==='image/webp') {
  const parts:Uint8Array[]=[];const view=new DataView(data.buffer,data.byteOffset,data.byteLength);let at=12,count=0;
  while(at+8<=data.length){if(++count>10000)return invalid();const length=view.getUint32(at+4,true),end=at+8+length+(length%2);if(end>data.length)return invalid();const kind=String.fromCharCode(...data.subarray(at,at+4));if(['VP8 ','VP8L','VP8X','ALPH','ANIM','ANMF'].includes(kind)){const chunk=data.slice(at,end);if(kind==='VP8X'){if(length<10)return invalid();chunk[8]&=~0x2c;}parts.push(chunk);}at=end;}
  if(at!==data.length || !parts.length)return invalid();const result=join([data.slice(0,12),...parts]);new DataView(result.buffer).setUint32(4,result.length-8,true);return result;
 }
 if(mime==='video/mp4') {
  const result=new Uint8Array(data);const view=new DataView(result.buffer);const containers=['moov','trak','mdia','minf','stbl','edts','dinf','mvex','moof','traf','mfra'];let count=0;
  function clean(start:number,end:number,depth:number):void {
   if(depth>10)return invalid();
   for(let at=start;at<end;) {
    if(++count>10000 || at+8>end)return invalid();let size=view.getUint32(at),head=8;const kind=String.fromCharCode(...result.subarray(at+4,at+8));
    if(size===1){if(at+16>end)return invalid();size=Number(view.getBigUint64(at+8));head=16;}if(size===0)size=end-at;
    if(!Number.isSafeInteger(size) || size<head || at+size>end)return invalid();
    if(['udta','meta','uuid','free','skip'].includes(kind)){result.set([102,114,101,101],at+4);result.fill(0,at+head,at+size);}
    else if(containers.includes(kind))clean(at+head,at+size,depth+1);
    else if(['mvhd','tkhd','mdhd'].includes(kind)){const p=at+head,version=result[p];if(version>1 || p+4+(version===1?16:8)>at+size)return invalid();result.fill(0,p+4,p+4+(version===1?16:8));}
    at+=size;
   }
  }
  clean(0,result.length,0);return result;
 }
 return invalid();
}
