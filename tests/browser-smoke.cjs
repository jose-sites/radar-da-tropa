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
 const state={reports:0,tickets:0,uploads:0};
 await page.route('**/*',async route=>{
  const request=route.request(),url=request.url();
  if(request.isNavigationRequest() && url.startsWith('https://radardatropa.pages.dev/')) return route.fulfill({status:200,contentType:'text/html',body:html});
  const reply=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data),headers:{'access-control-allow-origin':'*'}});
  if(!url.startsWith(base))return route.abort();
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*'}});
  const rpc=url.split('/rpc/')[1];
  if(rpc==='radar_public_stats')return reply({published_reports:2,reported_profiles:1,active_streamers:1,verified_streamers:0,whatsapp_number:'5527981325470'});
  if(rpc==='radar_public_groups')return reply({groups:[group],total_profiles:1});
  if(rpc==='radar_admin_dashboard_v5')return reply({reports:[{...report,upload_issues:1},{...report,id:secondId,handle:'outro',status:'published',profile_verified:true}],streamers:[],appeals:[{id:secondId,handle:'outro',report_handle:'perfil_exemplo',created_at:report.created_at,status:'pending',message:'Contestação de teste',evidence:[]}],audit:[],privacy_requests:[],whatsapp_number:'5527981325470'});
  if(rpc==='radar_verify_pin')return reply({id:streamerId,name:'Streamer Teste'});
  if(rpc==='radar_submit_report_v2'){state.reports++;return reply(secondId);}
  if(rpc==='radar_create_upload_ticket'){state.tickets++;return reply(`reports/${secondId}/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa.jpg`);}
  if(url.includes('/storage/v1/object/radar-evidence/')){state.uploads++;assert.equal(request.headers()['content-type'],'image/jpeg');if(state.uploads===1)return route.fulfill({status:503,contentType:'application/json',body:'{"message":"Falha temporária simulada. Tente novamente."}'});return reply({});}
  if(url.includes('/functions/v1/radar-upload-check'))return reply({verified:true});
  if(url.includes('/functions/v1/radar-sync'))return reply({profileVerified:false,error:'verification_pending'});
  return reply({});
 });
 await page.goto('https://radardatropa.pages.dev/');await page.waitForSelector('.result-card');
 if(stage==='photos') {
  await page.locator('.nav-btn[data-go=relatar]').click();await page.locator('#pin-input').fill('A'.repeat(20));await page.locator('#pin-preview').click();await page.waitForSelector('#report-panel.show');
  await page.locator('#report-handle').fill('perfil_teste');await page.locator('#report-reason').fill('Teste fictício de foto sem gravar no banco de produção.');
  const filename='<b>minha foto</b>.png';
  await page.locator('#report-files').setInputFiles({name:filename,mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
  assert.equal(await page.locator('.attachment-info strong').textContent(),filename);assert.equal(await page.locator('.attachment-item b').count(),0);assert.equal(await page.locator('.attachment-item img').count(),1);
  await page.locator('#report-form button[type=submit]').click();await page.waitForSelector('.attachment-item[data-phase=error]');
  assert.match(await page.locator('.attachment-status').textContent(),/Falha temporária/);assert.equal(await page.locator('#report-files').evaluate(el=>el.files.length),1);
  await page.locator('#report-form button[type=submit]').click();await page.waitForSelector('.attachment-item[data-phase=done]');
  assert.equal(await page.locator('.attachment-item progress').evaluate(el=>el.value),100);assert.equal(state.reports,1);assert.equal(state.tickets,1);assert.equal(state.uploads,2);
  await page.locator('#back-to-pin').click();assert.equal(await page.locator('.attachment-item').count(),0);
  console.log('PASS photos: preview, escaped filename, measured upload, failure message, preserved retry, no duplicate report or ticket, preview cleanup');
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
