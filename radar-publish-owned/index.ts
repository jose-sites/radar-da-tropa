import {fileType,mp4Duration,publicEvidenceCopy} from '../evidence-media.ts';
const base=Deno.env.get('SUPABASE_URL')!;
const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const headers={apikey:service,Authorization:`Bearer ${service}`};
const maxBytes=20*1024*1024;
function cors(origin:string|null) {return {'Access-Control-Allow-Origin':['https://radardatropa.pages.dev','https://jose-sites.github.io'].includes(origin || '')?origin!:'https://radardatropa.pages.dev','Access-Control-Allow-Headers':'apikey, authorization, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store',Vary:'Origin'};}
Deno.serve(async request=>{
 const origin=request.headers.get('origin');const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:cors(origin)});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors(origin)});
 if(request.method!=='POST')return reply(405,{error:'Método inválido'});
 const token=crypto.randomUUID(),deadline=Date.now()+90000;let reportId='',pin='',expected=0,leased=false,committing=false;
 const copied:string[]=[];
 const forwarded=request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || '';
 const call=async(path:string,init:RequestInit)=>fetch(base+path,{...init,signal:AbortSignal.timeout(Math.max(1,Math.min(15000,deadline-Date.now())))});
 const rpc=async(name:string,args:unknown)=>{
  const response=await call('/rest/v1/rpc/'+name,{method:'POST',headers:{...headers,'Content-Type':'application/json','x-forwarded-for':forwarded},body:JSON.stringify(args)});
  if(!response.ok)throw new Error('Não foi possível concluir a publicação. Tente novamente.');return response.status===204?null:response.json();
 };
 const begin=()=>rpc('radar_begin_owned_publication',{p_pin:pin,p_report_id:reportId,p_token:token,p_expected:expected});
 try {
  const input=await request.json();reportId=input.reportId;pin=input.pin;expected=input.expectedFiles;
  if(typeof reportId!=='string' || !/^[0-9a-f-]{36}$/i.test(reportId) || typeof pin!=='string' || !Number.isInteger(expected) || expected<0 || expected>3)return reply(400,{error:'Envio inválido'});
  const context=await begin();
  if(!context || context.denied)return reply(403,{error:'Este PIN não tem permissão para publicar este relato automaticamente.'});
  if(context.published)return reply(200,context);
  if(context.busy)return reply(409,{error:'A publicação já está em andamento. Aguarde e tente novamente.'});
  if(context.incomplete)return reply(409,{error:'Termine de enviar e verificar todos os anexos antes de publicar.'});
  leased=true;const evidence:{path:string,mime:string}[]=[];
  for(const ticket of context.tickets) {
   const path=ticket.path;
   if(typeof path!=='string' || !new RegExp('^reports/'+reportId+'/[0-9a-f-]{36}\\.(jpg|png|webp|mp4)$','i').test(path))throw new Error('Caminho de prova inválido.');
   const response=await call('/storage/v1/object/authenticated/radar-evidence/'+path,{headers});
   if(!response.ok)throw new Error('Não foi possível ler um dos anexos. Tente novamente.');
   if(Number(response.headers.get('content-length'))>maxBytes)throw new Error('O anexo excede 20 MB.');
   const reader=response.body?.getReader();if(!reader)throw new Error('Anexo vazio.');
   let size=0;const chunks:Uint8Array[]=[];
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new Error('O anexo excede 20 MB.');}chunks.push(value);}
   const data=new Uint8Array(size);let at=0;for(const chunk of chunks){data.set(chunk,at);at+=chunk.length;}
   const mime=fileType(data),duration=mime==='video/mp4'?mp4Duration(data):null;
   if(!mime || mime!==ticket.mime || (mime==='video/mp4' && (duration===null || duration>30)))throw new Error('Uma prova não passou pela validação de formato ou duração.');
   const clean=publicEvidenceCopy(data,mime);
   if(fileType(clean)!==mime || (mime==='video/mp4' && mp4Duration(clean)!==duration))throw new Error('A cópia pública não passou pela validação.');
   // Track before POST: a lost response may still have stored the copy.
   copied.push(path);
   const upload=await call('/storage/v1/object/radar-public-evidence/'+path,{method:'POST',headers:{...headers,'Content-Type':mime,'x-upsert':'true'},body:clean});
   if(!upload.ok)throw new Error('Não foi possível publicar uma prova. Os originais foram preservados para tentar novamente.');
   evidence.push({path,mime});
  }
  committing=true;const result=await rpc('radar_finish_owned_publication',{p_report_id:reportId,p_token:token,p_evidence:evidence});
  return reply(200,result);
 }catch(error) {
  if(leased) {
   // Never delete published files when only the final response was lost.
   if(committing) {
    try{const state=await begin();if(state?.published)return reply(200,state);if(state?.busy)return reply(503,{error:'A publicação está sendo confirmada. Tente novamente em alguns instantes.'});}
    catch{return reply(503,{error:'Não foi possível confirmar a publicação. Tente novamente; o relato não será duplicado.'});}
   }
   try{
    if(copied.length){const removed=await call('/storage/v1/object/radar-public-evidence',{method:'DELETE',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({prefixes:copied})});if(!removed.ok)throw new Error('Cleanup deferred');}
    await rpc('radar_abort_owned_publication',{p_report_id:reportId,p_token:token});
   }catch{/* The short lease expires; retry reuses the same object paths. */}
  }
  return reply(503,{error:error instanceof Error?error.message:'Falha ao publicar. Tente novamente.'});
 }
});
