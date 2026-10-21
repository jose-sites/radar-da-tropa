import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const source=readFileSync(new URL('../collector-bridge.ts',import.meta.url),'utf8');
const claims={repository:'jose-sites/radar-da-tropa',repository_id:'1424001421',repository_owner_id:'138799985',ref:'refs/heads/main',workflow_ref:'jose-sites/radar-da-tropa/.github/workflows/tiktok-collector.yml@refs/heads/main',event_name:'schedule',runner_environment:'github-hosted'};
const id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', lease='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
function app(options={}){
 const calls=[];let writes=0;let profileCalls=0;
 const row={id,handle:'example',browser_attempts:1};
 const query={
  select(){calls.push(['select']);return this;},eq(...args){calls.push(['eq',...args]);return this;},is(...args){calls.push(['is',...args]);return this;},gt(...args){calls.push(['gt',...args]);return this;},or(...args){calls.push(['or',...args]);return this;},order(){return this;},limit(){return this;},
  update(values){writes++;calls.push(['update',values]);return this;},
  async maybeSingle(){return {data:options.expired?null:row,error:null};},
  then(resolve){return Promise.resolve({data:[row],error:null}).then(resolve);}
 };
 const context=vm.createContext({URL,Date,Response,Error,Boolean,String,Math,crypto:webcrypto,
  createRemoteJWKSet(){return 'keys';},async jwtVerify(_token,keys,settings){
   assert.equal(keys,'keys');assert.equal(settings.issuer,'https://token.actions.githubusercontent.com');assert.equal(settings.audience,'radar-da-tropa:browser-collector:v1');assert.deepEqual([...settings.algorithms],['RS256']);assert.equal(settings.maxTokenAge,'5m');
   if(options.badSignature)throw Error('bad signature');return {payload:{...claims,...options.claims}};
  }
 });
 vm.runInContext(stripTypeScriptTypes(source.replace(/^import .*\n/gm,'').replace(/^export /gm,'')),context);
 return {context,calls,get writes(){return writes;},get profileCalls(){return profileCalls;},async request(body,authorization='Bearer signed-token'){
  const result=await context.collectorRequest(new Request('https://example.test',{method:'POST',headers:authorization?{authorization}:{},body:JSON.stringify(body)}),{from(){calls.push(['database']);return query;}},async()=>{profileCalls++;return 'verified-id';});
  return {status:result.status,body:await result.json()};
 }};
}
test('collector rejects missing credentials, bad signatures, foreign workflows and pull requests before database access',async()=>{
 for(const [options,auth] of [[{},''],[{badSignature:true},undefined],[{claims:{repository_id:'999'}},undefined],[{claims:{repository_owner_id:'999'}},undefined],[{claims:{ref:'refs/heads/other'}},undefined],[{claims:{event_name:'pull_request'}},undefined],[{claims:{workflow_ref:'other.yml'}},undefined]]){
  const server=app(options);assert.equal((await server.request({action:'claim'},auth)).status,403);assert.equal(server.calls.length,0);
 }
});
test('only published unresolved reports can be leased and optimistic attempts prevent concurrent claims',async()=>{
 const server=app();const result=await server.request({action:'claim'});assert.equal(result.status,200);assert.equal(result.body.jobs.length,1);
 assert.ok(server.calls.some(x=>x[0]==='eq'&&x[1]==='status'&&x[2]==='published'));
 assert.ok(server.calls.some(x=>x[0]==='is'&&x[1]==='profile_id'&&x[2]===null));
 assert.ok(server.calls.some(x=>x[0]==='eq'&&x[1]==='browser_attempts'&&x[2]===1));
 assert.equal(server.calls.find(x=>x[0]==='update')[1].browser_attempts,2);
});
test('valid browser identity links the profile while preserving report moderation status',async()=>{
 const server=app();const result=await server.request({action:'complete',reportId:id,lease,provider:'tiktok-api',profile:{id:'7506280430036747320',uniqueId:'Example'}});
 assert.equal(result.body.profileVerified,true);assert.equal(server.profileCalls,1);
 const changes=server.calls.find(x=>x[0]==='update')[1];assert.equal(changes.profile_id,'verified-id');assert.equal(changes.browser_lease,null);assert.ok(!('status' in changes));
});
test('failed browser lookup records a delay without claiming confirmation',async()=>{
 const server=app();const result=await server.request({action:'complete',reportId:id,lease,error:'unavailable'});
 assert.equal(result.body.profileVerified,false);assert.equal(server.profileCalls,0);
 const changes=server.calls.find(x=>x[0]==='update')[1];assert.ok(!('profile_id' in changes));assert.ok(Date.parse(changes.browser_next_at)>Date.now()+14*60000);
});
test('expired leases cannot modify reports or profiles',async()=>{
 const server=app({expired:true});assert.equal((await server.request({action:'complete',reportId:id,lease,provider:'tiktok-api',profile:{id:'1234567890',uniqueId:'example'}})).status,409);assert.equal(server.writes,0);assert.equal(server.profileCalls,0);
});
test('wrong usernames, rounded numeric IDs and unknown providers cannot link profiles',async()=>{
 for(const overrides of [{profile:{id:'1234567890',uniqueId:'wrong'}},{profile:{id:7506280430036747000,uniqueId:'example'}},{provider:'untrusted'}]){
  const server=app();assert.equal((await server.request({action:'complete',reportId:id,lease,provider:'tiktok-api',profile:{id:'1234567890',uniqueId:'example'},...overrides})).status,400);assert.equal(server.profileCalls,0);assert.equal(server.writes,0);
 }
});
test('browser retry delay grows from fifteen minutes and caps at one day',()=>{
 const {context}=app();assert.equal(context.collectorDelay(1),15*60000);assert.equal(context.collectorDelay(2),30*60000);assert.equal(context.collectorDelay(3),60*60000);assert.equal(context.collectorDelay(100),24*60*60000);
});

test('numeric TikTok error codes are preserved without linking an identity',async()=>{
 const server=app();const result=await server.request({action:'complete',reportId:id,lease,error:'tiktok_status_209002'});
 assert.equal(result.body.error,'tiktok_status_209002');assert.equal(result.body.profileVerified,false);
 assert.equal(server.calls.find(x=>x[0]==='update')[1].profile_resolution_error,'tiktok_status_209002');
 assert.equal(server.profileCalls,0);
});
