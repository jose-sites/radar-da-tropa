// Browser checks use isolated API fixtures; no WhatsApp message or production write occurs.
const {chromium}=require(process.env.RADAR_PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs');const assert=require('node:assert/strict');const path=require('node:path');
const root=path.resolve(__dirname,'..');const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const base=/const SUPABASE_URL = '([^']+)'/.exec(html)[1];
const reportId='11111111-1111-4111-8111-111111111111';
const secondId='22222222-2222-4222-8222-222222222222';
const streamerId='33333333-3333-4333-8333-333333333333';
const report={id:reportId,handle:'perfil_exemplo',reason:'Relato fictício usado somente para validar a interface.',category:'outro',created_at:'2026-10-21T10:00:00Z',event_date:'2026-10-20',streamer_id:streamerId,streamer_name:'Streamer Teste',streamer_verified:false,profile_verified:false,status:'pending',evidence:[]};
const group={...report,profile_id:null,report_count:2,streamer_count:1,reports:[report,{...report,id:secondId}]};
const stage=process.argv[2] || 'photos';
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const state={reports:0,tickets:0,uploads:0,pinAttempts:0,pinProtocol:null,pinStatus:'received',pinReply:'',pinNote:'',publications:0};
 await page.route('**/*',async route=>{
  const request=route.request(),url=request.url();
  if(request.isNavigationRequest() && url.startsWith('https://radardatropa.pages.dev/')) return route.fulfill({status:200,contentType:'text/html',body:html});
  const reply=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data),headers:{'access-control-allow-origin':'*'}});
  if(!url.startsWith(base))return route.abort();
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'}});
  const rpc=url.split('/rpc/')[1];
  if(rpc==='radar_public_stats')return reply({published_reports:2,reported_profiles:1,active_streamers:1,verified_streamers:0,whatsapp_number:'5527981325470'});
  if(rpc==='radar_public_groups')return reply({groups:[group],total_profiles:1});
  if(rpc==='radar_profile_dossier') {const args=request.postDataJSON();return reply({profile:{...report,profile_verified:true,last_checked_at:report.created_at},aliases:[{handle:'anterior',first_seen_at:report.created_at}],total_reports:2,streamer_count:1,reports:[{...report,id:args.p_offset?secondId:reportId,reason:'<script>unsafe</script>',proofs:[]}]});}
  if(rpc==='radar_report_detail_v2')return reply({...report,id:request.postDataJSON().p_id,proofs:stage==='owned'?[{path:`reports/${reportId}/${secondId}.mp4`,mime:'video/mp4'},{path:`reports/${reportId}/${secondId}.jpg`,mime:'image/jpeg'}]:[]});
  if(rpc==='radar_submit_pin_request') {const args=request.postDataJSON();state.pinAttempts++;if(state.pinProtocol)assert.equal(args.p_protocol,state.pinProtocol);state.pinProtocol=args.p_protocol;if(state.pinAttempts===1)return route.fulfill({status:503,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"message":"Conexão temporariamente indisponível"}'});return reply({id:secondId,name:args.p_name,handle:args.p_handle,context:args.p_context,status:'received',created_at:report.created_at});}
  if(rpc==='radar_pin_request_status')return reply(request.postDataJSON().p_protocol===state.pinProtocol?{handle:'streamer_teste',status:state.pinStatus,reply:state.pinReply,updated_at:report.created_at}:null);
  if(rpc==='radar_admin_update_pin_request'){const args=request.postDataJSON();state.pinStatus=args.p_status;state.pinReply=args.p_reply;state.pinNote=args.p_note;return reply(null);}
  if(rpc==='radar_admin_dashboard_v6')return reply({pin_requests:[{id:secondId,name:'Streamer Teste',handle:'streamer_teste',context:'Participação fictícia nas lives.',contact:'5527999999999',status:state.pinStatus,public_reply:state.pinReply,admin_note:state.pinNote,created_at:report.created_at}],reports:[{...report,upload_issues:1},{...report,id:secondId,handle:'outro',status:'published',profile_verified:true}],streamers:[],appeals:[{id:secondId,handle:'outro',report_handle:'perfil_exemplo',created_at:report.created_at,status:'pending',message:'Contestação de teste',evidence:[]}],audit:[],privacy_requests:[],whatsapp_number:'5527981325470'});
  if(rpc==='radar_verify_pin')return reply({id:streamerId,name:'Streamer Teste',can_auto_publish:stage==='owned'});
  if(rpc==='radar_submit_report_v2'){state.reports++;return reply(secondId);}
  if(rpc==='radar_create_upload_ticket'){state.tickets++;return reply(`reports/${secondId}/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa.jpg`);}
  if(url.includes('/storage/v1/object/radar-evidence/')){state.uploads++;assert.equal(request.headers()['content-type'],'image/jpeg');if(state.uploads===1)return route.fulfill({status:503,contentType:'application/json',body:'{"message":"Falha temporária simulada. Tente novamente."}'});return reply({});}
  if(url.includes('/functions/v1/radar-publish-owned')){state.publications++;assert.equal(request.postDataJSON().pin,'1234512345');if(state.publications===1)return route.fulfill({status:503,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"error":"Falha temporária ao confirmar a publicação"}'});return reply({published:true,proof_count:request.postDataJSON().expectedFiles});}
  if(url.includes('/functions/v1/radar-upload-check'))return reply({verified:true});
  if(url.includes('/functions/v1/radar-sync'))return reply({profileVerified:false,error:'verification_pending'});
  return reply({});
 });
 await page.goto('https://radardatropa.pages.dev/');await page.waitForSelector('.result-card');
 if(stage==='cards') {
  await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}'});
  const sample={...report,category:'nao_pagamento',status:'published',streamer_name:'admin',profile_verified:true,last_checked_at:new Date().toISOString(),report_count:1,reports:[{...report,category:'nao_pagamento',streamer_name:'admin'}]};
  for(const width of [320,390,430,768,1280]){
   await page.setViewportSize({width,height:900});await page.evaluate(sample=>renderReports([sample],''),sample);
   const card=page.locator('.report-card');
   assert.equal(await card.locator('.report-card-top .report-category').textContent(),'!Não pagamento');
   assert.equal(await card.locator('.report-author').count(),1);
   assert.equal(await card.locator('.report-author').evaluate(el=>el===el.parentElement.lastElementChild),true);
   assert.match(await card.locator('.report-author').textContent(),/Denunciado por admin/);
   assert.match(await card.locator('.report-dates').textContent(),/Ocorrido em20\/10\/2026/);
   const dates=await card.locator('.report-dates').boundingBox(),proof=await card.locator('.report-proof-link').boundingBox();assert.ok(proof.y-(dates.y+dates.height)>=23,JSON.stringify({width,dates,proof,styles:await card.locator('.report-dates').evaluate(el=>({margin:getComputedStyle(el).marginBottom,display:getComputedStyle(el).display}))}));
   const links=card.locator('.report-secondary-links a');assert.equal(await links.count(),2);
   for(let index=0;index<2;index++)assert.ok((await links.nth(index).boundingBox()).height>=44);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(sample=>renderReports([sample],''),sample);
  if(process.env.RADAR_CARD_SCREENSHOT)await page.locator('.report-card').screenshot({path:process.env.RADAR_CARD_SCREENSHOT});
  await page.locator('.report-proof-link').click();await page.waitForSelector('#detail-appeal');assert.match(page.url(),new RegExp('/perfil/'+reportId));
  await page.evaluate(()=>showView('consultar',false));
  const mixed={...sample,handle:'a'.repeat(40),report_count:2,reports:[{...report,category:'nao_pagamento',streamer_name:'<b>nome</b>',reason:'Texto com <script>não executar</script>'},{...report,id:secondId,category:'abuso',streamer_name:'Outro streamer',event_date:null}]};
  await page.evaluate(sample=>renderReports([sample],''),mixed);
  assert.match(await page.locator('.report-card-top').textContent(),/Múltiplas categorias/);assert.equal(await page.locator('.report-author').count(),2);assert.equal(await page.locator('.report-card script,.report-author b').count(),0);
  assert.match(await page.locator('.report-author').first().textContent(),/<b>nome<\/b>/);assert.equal(await page.locator('.report-case').last().locator('.report-dates dt').count(),1);
  assert.equal(await page.locator('.report-proof-link').last().getAttribute('data-profile-id'),secondId);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  console.log('PASS cards: category first, author at bottom, separate dates/actions, five widths, grouped reports, escaped text and report navigation');
 }
 if(stage==='photos') {
  await page.locator('.nav-btn[data-go=relatar]').click();await page.locator('#pin-input').fill('A'.repeat(20));await page.locator('#pin-preview').click();await page.waitForSelector('#report-panel.show');
  await page.locator('#report-handle').fill('perfil_teste');await page.locator('#report-reason').fill('Teste fictício de foto sem gravar no banco de produção.');
  const filename='<b>minha foto</b>.png';
  await page.locator('#report-files').setInputFiles({name:filename,mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
  assert.equal(await page.locator('.attachment-info strong').textContent(),filename);assert.equal(await page.locator('.attachment-item b').count(),0);assert.equal(await page.locator('.attachment-item img').count(),1);
  await page.locator('#report-form button[type=submit]').click();await page.waitForSelector('.attachment-item[data-phase=error]');
  assert.match(await page.locator('.attachment-status').textContent(),/Falha temporária/);assert.equal(await page.locator('#report-files').evaluate(el=>el.files.length),1);
  await page.locator('#report-form button[type=submit]').click();await page.waitForSelector('.attachment-item[data-phase=done]');
  assert.equal(await page.locator('.attachment-item progress').evaluate(el=>el.value),100);assert.equal(state.reports,1);assert.equal(state.tickets,1);assert.equal(state.uploads,2);assert.equal(state.publications,0);
  await page.locator('#back-to-pin').click();assert.equal(await page.locator('.attachment-item').count(),0);
  console.log('PASS photos: preview, escaped filename, measured upload, failure message, preserved retry, no duplicate report or ticket, preview cleanup');
 }
 if(stage==='owned') {
  await page.locator('.nav-btn[data-go=relatar]').click();await page.locator('#pin-input').fill('1234512345');await page.locator('#pin-preview').click();await page.waitForSelector('#report-panel.show');
  assert.match(await page.locator('#report-publish-mode').textContent(),/publica automaticamente/);
  await page.locator('#report-handle').fill('perfil_teste');await page.locator('#report-reason').fill('Teste fictício de publicação automática sem gravação real.');
  await page.locator('#report-files').setInputFiles({name:'foto.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
  await page.locator('#report-form button[type=submit]').click();await page.waitForSelector('.attachment-item[data-phase=error]');assert.equal(state.publications,0);
  await page.locator('#report-form button[type=submit]').click();await page.waitForFunction(()=>document.querySelector('#report-form button[type=submit]').textContent==='Tentar publicação');
  assert.equal(state.publications,1);assert.equal(await page.locator('#report-files').evaluate(el=>el.disabled),true);
  await page.locator('#report-form button[type=submit]').click();await page.waitForFunction(()=>document.getElementById('preview-reason').textContent.includes('publicado automaticamente'));
  assert.equal(state.reports,1);assert.equal(state.tickets,1);assert.equal(state.uploads,2);assert.equal(state.publications,2);assert.equal(await page.locator('#report-files').evaluate(el=>el.disabled),false);
  await page.locator('#report-handle').fill('outro_perfil');await page.locator('#report-reason').fill('Novo relato de teste sem anexos para publicação automática.');await page.locator('#report-form button[type=submit]').click();await page.waitForFunction(()=>pendingReport===null && document.querySelector('#report-form button[type=submit]').disabled===false);
  assert.equal(state.reports,2);assert.equal(state.publications,3);
  await page.evaluate(id=>openProfile(id),reportId);await page.waitForSelector('#detail-appeal');assert.equal(await page.locator('.detail-proofs video').count(),1);assert.equal(await page.locator('.detail-proofs img').count(),1);
  console.log('PASS owner: 10-digit PIN, explicit auto mode, no publication after upload failure, retry without duplicates, public photo/video and no-attachment report');
 }
 if(stage==='pin') {
  await page.locator('.nav-btn[data-go=relatar]').click();await page.locator('.pin-request summary').first().click();
  await page.locator('#pin-request-name').fill('Streamer Teste');await page.locator('#pin-request-handle').fill('@streamer_teste');await page.locator('#pin-request-context').fill('Participo das lives há bastante tempo.');
  await page.locator('#pin-request-submit').click();await page.waitForFunction(()=>document.getElementById('pin-request-status').textContent.includes('preservados'));
  assert.equal(await page.locator('#pin-request-name').inputValue(),'Streamer Teste');
  await page.locator('#pin-request-submit').click();await page.waitForSelector('#pin-request-receipt:visible');
  const protocol=await page.locator('#pin-request-protocol').textContent();assert.match(protocol,/^[0-9A-F]{32}$/);assert.equal(state.pinAttempts,2);
  const whatsapp=new URL(await page.locator('#pin-request-whatsapp').getAttribute('href'));assert.equal(whatsapp.hostname,'wa.me');assert.equal(whatsapp.pathname,'/5527981325470');assert.equal(whatsapp.searchParams.get('text').includes(protocol),false);
  await page.reload();await page.locator('.nav-btn[data-go=relatar]').click();await page.locator('.pin-request summary').first().click();await page.waitForSelector('#pin-request-receipt:visible');assert.equal(await page.locator('#pin-request-protocol').textContent(),protocol);assert.equal(state.pinAttempts,2);
  await page.locator('.pin-request summary').nth(1).click();await page.locator('#pin-tracking-form button').click();await page.waitForFunction(()=>document.getElementById('pin-tracking-result').textContent.includes('Recebido'));
  await page.evaluate(()=>{saveSession({access_token:'fixture',expires_at:Date.now()+3600000});showView('admin',false);openDashboard();});await page.waitForSelector('[data-pin-request]');await page.locator('[data-pin-request] summary').click();
  await page.locator('[data-pin-state]').selectOption('responded');await page.locator('[data-pin-reply]').fill('Entre em contato pelo WhatsApp.');await page.locator('[data-pin-note]').fill('Nota privada');await page.locator('[data-pin-save]').click();await page.waitForFunction(()=>document.querySelector('[data-pin-request] summary .dash-status').textContent==='Respondido');
  assert.equal(state.pinNote,'Nota privada');
  await page.evaluate(()=>showView('relatar',false));await page.locator('#pin-tracking-form button').click();await page.waitForFunction(()=>document.getElementById('pin-tracking-result').textContent.includes('Respondido'));
  assert.equal((await page.locator('#pin-tracking-result').textContent()).includes('Nota privada'),false);
  console.log('PASS PIN: connection retry, one protocol, saved receipt, WhatsApp prepared only, private admin review and status lookup');
 }
 if(stage==='dossier') {
  await page.locator('[data-dossier-id]').click();await page.waitForSelector('#dossier-timeline article');
  assert.match(page.url(),/\/ficha\//);assert.equal(await page.locator('#dossier-timeline article').count(),1);
  assert.match(await page.locator('.dossier-aliases').textContent(),/@anterior/);assert.equal(await page.locator('#dossier-timeline script').count(),0);
  await page.locator('#dossier-more').click();await page.waitForFunction(()=>document.querySelectorAll('#dossier-timeline article').length===2);
  assert.equal(await page.locator('#dossier-more').isVisible(),false);
  await page.reload();await page.waitForSelector('#dossier-timeline article');
  await page.locator('#dossier-timeline [data-profile-id]').click();await page.waitForSelector('#detail-appeal');
  assert.match(page.url(),/\/perfil\//);await page.locator('#detail-appeal').click();assert.equal(await page.evaluate(()=>selectedAppealReport),reportId);
  console.log('PASS dossier: full history, safe text, pagination, deep-link reload and individual appeal');
 }
 if(stage==='panel') {
  await page.evaluate(()=>{saveSession({access_token:'fixture',expires_at:Date.now()+3600000});showView('admin',false);openDashboard();});
  await page.waitForSelector('[data-review-id]');assert.equal(await page.locator('[data-review-id]').count(),2);
  await page.locator('[data-review-id]').first().locator('summary').click();
  await page.locator('[data-review-id]').first().locator('textarea').fill('Rascunho preservado');
  await page.locator('#admin-report-status').selectOption('published');assert.equal(await page.locator('[data-review-id]').count(),1);
  assert.equal(await page.locator('#metric-reports').textContent(),'2');assert.equal(await page.locator('#metric-pending').textContent(),'1');
  await page.locator('#admin-report-clear').click();assert.equal(await page.locator('[data-review-id]').first().locator('textarea').inputValue(),'Rascunho preservado');
  assert.equal(await page.locator('[data-review-id]').first().evaluate(el=>el.open),true);
  await page.locator('#admin-report-attachments').selectOption('issues');assert.equal(await page.locator('[data-review-id]').count(),1);
  await page.locator('#admin-report-query').fill('@inexistente');await page.waitForFunction(()=>document.querySelectorAll('[data-review-id]').length===0);
  await page.locator('#admin-report-clear').click();await page.locator('#admin-appeal-status').selectOption('accepted');assert.equal(await page.locator('[data-appeal-id]').count(),0);
  await page.locator('#admin-appeal-status').selectOption('pending');assert.equal(await page.locator('[data-appeal-id]').count(),1);
  console.log('PASS panel: combined filters, reset, fixed totals, preserved draft, appeal filters, mobile layout');
 }
 assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 } finally {await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
