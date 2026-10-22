import { fetchPublicTikTokProfile, fetchPublicTikTokLiveProfile } from '../tiktok-profile.ts';
// Código temporário na bio do TikTok para identificar quem apresenta um recurso.
const base = Deno.env.get('SUPABASE_URL') || '';
const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const auth = {apikey:service,Authorization:'Bearer '+service};
const allowed = new Set(['https://radardatropa.pages.dev','https://jose-sites.github.io']);
const cors = (origin:string|null) => ({
  'Access-Control-Allow-Origin':allowed.has(origin||'')?origin!:'https://radardatropa.pages.dev',
  'Access-Control-Allow-Headers':'apikey, authorization, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
  'Content-Type':'application/json','Cache-Control':'no-store',
});
const reply = (status:number,body:unknown,origin:string|null) =>
  new Response(JSON.stringify(body),{status,headers:cors(origin)});
async function query(path:string,method='GET',body?:unknown) {
  const result=await fetch(base+'/rest/v1/'+path,{
    method,headers:{...auth,'Content-Type':'application/json',Prefer:'return=representation'},
    body:body===undefined?undefined:JSON.stringify(body),
  });
  if(!result.ok) throw new Error('Serviço de verificação indisponível.');
  return result.status===204?null:result.json();
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
Deno.serve(async request=>{
  const origin=request.headers.get('origin');
  if(request.method==='OPTIONS') return new Response(null,{status:204,headers:cors(origin)});
  if(request.method!=='POST') return reply(405,{error:'Método inválido.'},origin);
  try {
    const body=await request.json();
    if(body.action==='start') {
      if(typeof body.reportId!=='string'||!uuid.test(body.reportId)) return reply(400,{error:'Relato inválido.'},origin);
      const reports=await query('radar_reports?id=eq.'+body.reportId+'&status=eq.published&select=id,handle,profile_id');
      if(!reports?.length) return reply(404,{error:'Relato não encontrado.'},origin);
      const since=new Date(Date.now()-60*60*1000).toISOString();
      const recent=await query('radar_appeal_challenges?report_id=eq.'+body.reportId+'&created_at=gte.'+encodeURIComponent(since)+'&select=id');
      if(recent.length>=3) return reply(429,{error:'Limite de códigos atingido. Tente mais tarde.'},origin);
      const code='RADAR-'+crypto.randomUUID().replaceAll('-','').slice(0,8).toUpperCase();
      const created=await query('radar_appeal_challenges','POST',{report_id:body.reportId,handle:reports[0].handle,code});
      return reply(200,{id:created[0].id,code},origin);
    }
    if(body.action==='verify') {
      if(typeof body.challengeId!=='string'||!uuid.test(body.challengeId)) return reply(400,{error:'Código inválido.'},origin);
      const rows=await query('radar_appeal_challenges?id=eq.'+body.challengeId+'&select=id,report_id,handle,code,expires_at,attempts,verified_at');
      const row=rows?.[0];
      if(!row||Date.parse(row.expires_at)<Date.now()||row.attempts>=5) return reply(410,{error:'Código expirado. Gere outro.'},origin);
      if(row.verified_at) return reply(200,{verified:true},origin);
      let profile;
      try {
        try { profile = await fetchPublicTikTokLiveProfile(row.handle); }
        catch (error) {
          const code = error instanceof Error ? error.message : '';
          if (!['public_profile_unavailable', 'public_profile_timeout'].includes(code)) throw error;
          profile = await fetchPublicTikTokProfile('username', row.handle);
        }
      }
      catch { return reply(503,{error:'O TikTok não disponibilizou a bio agora. Tente mais tarde ou envie o recurso sem confirmar o perfil.'},origin); }
      // Provider failures do not spend one of the user's code-verification attempts.
      await query('radar_appeal_challenges?id=eq.'+row.id,'PATCH',{attempts:row.attempts+1});
      const signature=String(profile?.signature||'');
      if(!signature.toUpperCase().includes(row.code.toUpperCase())) return reply(200,{verified:false},origin);
      const reports=await query('radar_reports?id=eq.'+row.report_id+'&status=eq.published&select=profile_id,handle');
      const report=reports?.[0];
      if(!report) return reply(404,{error:'Relato indisponível.'},origin);
      const current=String(profile?.uniqueId||'').toLowerCase();
      const stable=String(profile?.id||'');
      if(!/^\d{5,30}$/.test(stable)) return reply(200,{verified:false},origin);
      if(report.profile_id) {
        const linked=await query('radar_profiles?id=eq.'+report.profile_id+'&select=tiktok_user_id');
        if(!linked?.length||linked[0].tiktok_user_id!==stable) return reply(200,{verified:false},origin);
      } else if(current!==String(report.handle).toLowerCase()) return reply(200,{verified:false},origin);
      await query('radar_appeal_challenges?id=eq.'+row.id,'PATCH',{
        verified_at:new Date().toISOString(),verified_tiktok_user_id:stable});
      return reply(200,{verified:true},origin);
    }
    return reply(400,{error:'Ação inválida.'},origin);
  } catch { return reply(500,{error:'Não foi possível verificar a conta agora.'},origin); }
});
