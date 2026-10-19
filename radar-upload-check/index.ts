// Verifica anexos privados depois do upload. A publicação de provas é separada.
const base = Deno.env.get('SUPABASE_URL')!;
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const headers = { apikey: service, Authorization: `Bearer ${service}` };
const cors = (origin: string | null) => ({
  'Access-Control-Allow-Origin': ['https://radardatropa.pages.dev', 'https://jose-sites.github.io'].includes(origin || '') ? origin! : 'https://radardatropa.pages.dev',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
});
const reply = (status: number, body: unknown, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: cors(origin) });

function fileType(data: Uint8Array): string | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 8 && [137,80,78,71,13,10,26,10].every((v,i) => data[i] === v)) return 'image/png';
  const ascii = (i: number, n: number) => String.fromCharCode(...data.subarray(i,i+n));
  if (data.length >= 12 && ascii(0,4) === 'RIFF' && ascii(8,4) === 'WEBP') return 'image/webp';
  if (data.length >= 24 && ascii(4,4) === 'ftyp' && /^(isom|iso2|mp4[12]|avc1|M4V )$/.test(ascii(8,4))) return 'video/mp4';
  return null;
}

function mp4Duration(data: Uint8Array): number | null {
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

async function rest(path: string, init: RequestInit) {
  const response=await fetch(`${base}/rest/v1/${path}`,{
    ...init, headers:{...headers,'Content-Type':'application/json',...init.headers},
  });
  if (!response.ok) throw new Error(`Banco indisponível (${response.status})`);
  return response.status===204 ? null : response.json();
}

Deno.serve(async request => {
  const origin=request.headers.get('origin');
  if (request.method==='OPTIONS') return new Response(null,{status:204,headers:cors(origin)});
  if (request.method!=='POST') return reply(405,{error:'Método inválido'},origin);
  try {
    const {path,secret}=await request.json();
    if (typeof path!=='string' || !/^(reports|appeals)\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|mp4)$/.test(path) || typeof secret!=='string')
      return reply(400,{error:'Envio inválido'},origin);
    const allowed=await rest('rpc/radar_check_upload_secret',{method:'POST',body:JSON.stringify({p_path:path,p_secret:secret})});
    if (allowed!==true) return reply(403,{error:'Envio não autorizado'},origin);
    const ticket=await rest(`radar_upload_tickets?object_path=eq.${encodeURIComponent(path)}&select=id,verified_at`,{method:'GET'});
    if (!ticket?.length) return reply(404,{error:'Arquivo não encontrado'},origin);
    if (ticket[0].verified_at) return reply(200,{verified:true},origin);
    const object=await fetch(`${base}/storage/v1/object/authenticated/radar-evidence/${path}`,{headers});
    if (!object.ok) return reply(404,{error:'Arquivo não encontrado'},origin);
    const length=Number(object.headers.get('content-length'));
    if (length>20*1024*1024) throw new Error('Cada arquivo deve ter até 20 MB.');
    const data=new Uint8Array(await object.arrayBuffer());
    const mime=fileType(data);
    const ext=path.split('.').pop();
    const expected: Record<string,string>={jpg:'image/jpeg',png:'image/png',webp:'image/webp',mp4:'video/mp4'};
    const duration=mime==='video/mp4' ? mp4Duration(data) : null;
    const invalid=data.length===0 || data.length>20*1024*1024 || mime!==expected[ext!] ||
      (mime==='video/mp4' && (duration===null || duration>30));
    if (invalid) {
      await fetch(`${base}/storage/v1/object/radar-evidence`,{method:'DELETE',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({prefixes:[path]})});
      await rest(`radar_upload_tickets?id=eq.${ticket[0].id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({rejection_reason:'Formato, tamanho ou duração inválidos'})});
      return reply(422,{error:'O servidor recusou o arquivo: formato, tamanho ou duração inválidos.'},origin);
    }
    await rest(`radar_upload_tickets?id=eq.${ticket[0].id}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({verified_at:new Date().toISOString(),detected_mime:mime,duration_seconds:duration})});
    return reply(200,{verified:true,mime,duration},origin);
  } catch(error) {
    return reply(500,{error:error instanceof Error ? error.message : 'Não foi possível verificar o arquivo.'},origin);
  }
});
