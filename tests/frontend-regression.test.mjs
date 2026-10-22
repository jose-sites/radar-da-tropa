import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
function dashboardApp() {
 const requests=[],rendered=[];
 const context=vm.createContext({
  adminSession:{access_token:'fixture'},dashboardRequestSerial:0,dashboard:{reports:[]},
  rpc(){const pending=deferred();requests.push(pending);return pending.promise;},
  document:{getElementById:()=>({value:''})},
  renderDashboard(){rendered.push(context.dashboard);},loadPublicStats(){},toast(){},
 });
 vm.runInContext(html.slice(html.indexOf('async function loadDashboard()'),html.indexOf('function renderDashboard()')),context);
 return {context,requests,rendered};
}
test('a dashboard response cannot restore private data after logout',async()=>{
 const {context,requests,rendered}=dashboardApp();const pending=context.loadDashboard();
 context.adminSession=null;context.dashboardRequestSerial++;
 requests[0].resolve({reports:['private data']});await pending;
 assert.equal(context.dashboard.reports.length,0);assert.equal(rendered.length,0);
});
test('an older dashboard response cannot overwrite a newer review',async()=>{
 const {context,requests,rendered}=dashboardApp();const first=context.loadDashboard(),second=context.loadDashboard();
 requests[1].resolve({reports:['newer']});await second;
 requests[0].resolve({reports:['older']});await first;
 assert.equal(context.dashboard.reports[0],'newer');assert.equal(rendered.length,1);
});
test('closing the private photo dialog discards an in-flight response without a blob URL',async()=>{
 const pending=deferred();let blobUrls=0;
 const holder={textContent:'',innerHTML:''},dialog={open:false,dataset:{},showModal(){this.open=true;}};
 const context=vm.createContext({
  adminSession:{access_token:'fixture'},evidenceRequestSerial:0,SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_KEY:'public',
  document:{getElementById:id=>id==='evidence-dialog'?dialog:holder},
  ensureAdminToken:async()=> 'fixture',fetch:()=>pending.promise,
  URL:{createObjectURL(){blobUrls++;return 'blob:fixture';},revokeObjectURL(){}},
 });
 vm.runInContext(html.slice(html.indexOf('async function openEvidence('),html.indexOf("document.getElementById('admin-dashboard').addEventListener",html.indexOf('async function openEvidence('))),context);
 const task=context.openEvidence('reports/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.jpg');
 dialog.open=false;holder.textContent='';context.evidenceRequestSerial++;
 pending.resolve(new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/jpeg'}}));await task;
 assert.equal(blobUrls,0);assert.equal(holder.textContent,'');assert.equal(holder.innerHTML,'');
});
