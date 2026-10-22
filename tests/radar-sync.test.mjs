import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const source = readFileSync(new URL('../radar-sync/index.ts', import.meta.url), 'utf8');
const publicSource = readFileSync(new URL('../tiktok-profile.ts', import.meta.url), 'utf8');
const publicScript = '{' + stripTypeScriptTypes(publicSource.replace(/^export /gm, '')) + '; globalThis.fetchPublicTikTokProfile = fetchPublicTikTokProfile; globalThis.parseTikTokProfile = parseTikTokProfile; globalThis.fetchPublicTikTokSummary = fetchPublicTikTokSummary; globalThis.fetchPublicTikTokLiveProfile = fetchPublicTikTokLiveProfile; }';
const profileHtml = user => `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify({ __DEFAULT_SCOPE__: { 'webapp.user-detail': { statusCode: 0, userInfo: { user } } } })}</script>`;
const reportId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
function server(options = {}) {
  let handler;
  const calls = [];
  const report = { id: reportId, handle: 'example', profile_id: null,
    profile_resolution_attempt_at: null, profile_resolution_error: null, created_at: new Date().toISOString(),
    ...options.report };
  const query = {
    select() { return this; }, eq() { return this; }, is() { return this; },
    neq() { return this; }, or(filter) {calls.push(filter);return this;}, order(){return this;}, limit(){return this;},
    update(values) { Object.assign(report, values); calls.push('update'); return this; },
    maybeSingle() { return Promise.resolve({ data: report, error: null }); },
    then(resolve) { return Promise.resolve({ data:options.pendingReports ? [report] : [], error: null }).then(resolve); }
  };
  const profileQuery = {
    select() { return this; }, eq() { return this; }, upsert() { return this; },
    or(filter){calls.push(filter);return this;},order(){return this;},limit(){return this;},
    update() { return this; },
    maybeSingle() { return Promise.resolve({ data: { id: 'identified-profile', current_handle: 'example', avatar_path: null }, error: null }); },
    then(resolve) { return Promise.resolve({ data:[], error: null }).then(resolve); }
  };
  const streamerUpdates=[],streamerFilters=[];
  const streamerQuery={
    select(){return this;},order(){return this;},limit(){return this;},or(value){streamerFilters.push(['or',value]);return this;},
    eq(...args){streamerFilters.push(args);return this;},is(...args){streamerFilters.push(args);return this;},
    update(values){streamerUpdates.push(values);return this;},
    maybeSingle(){return Promise.resolve({data:options.streamerClaimDenied?null:{id:reportId},error:null});},
    then(resolve){return Promise.resolve({data:options.pendingStreamers || [],error:null}).then(resolve);}
  };
  const admin = { async rpc() { calls.push('verifyPin'); return { data: options.invalidPin ? null : { id: 'streamer' }, error: null }; }, from(table) { calls.push('database'); return table === 'radar_reports' ? query : table === 'radar_streamers' ? streamerQuery : profileQuery; } };
  const caller = {
    auth: { async getUser() { calls.push('getUser'); return { data: { user: options.invalidUser ? null : { id: 'user' } }, error: null }; } },
    async rpc(name,args) {
      if(name==='radar_is_admin'){calls.push('isAdmin');return {data:options.isAdmin ?? true,error:null};}
      calls.push(name);if(args)calls.push(args);
      if(name==='radar_admin_claim_streamer_lookup')return {data:!options.claimDenied,error:null};
      return {data:null,error:options.linkFails?{message:'unavailable'}:null};
    }
  };
  const context = vm.createContext({
    Request, Response, Date, Set, JSON, String, Boolean, Error, AbortController, URL, TextDecoder,
    setTimeout(callback, delay) { if (delay === 1000 || delay === 3000) { calls.push(`wait:${delay}`); queueMicrotask(callback); return undefined; } return setTimeout(callback, delay); }, clearTimeout, console: { error() {} },
    createClient(_url, _key, config) { return config.global ? caller : admin; },
    fetch: async url => { if (url.includes('/api-live/user/room/')) { calls.push('liveProvider'); return new Response(JSON.stringify(options.liveProfile ? {statusCode:0,data:{user:options.liveProfile}} : {statusCode:10202,data:null}),{status:options.liveStatus ?? 200,headers:{'content-type':'application/json'}}); } if (url.includes('/oembed?')) { calls.push('summary'); return new Response(JSON.stringify(options.summary ?? {}), {status:options.summary ? 200 : 404,headers:{'content-type':'application/json'}}); } calls.push('provider'); const step=options.providerSteps?.[calls.filter(x=>x==='provider').length-1]; if(step instanceof Error) throw step; if(step) return new Response(profileHtml(step.profile ?? {}), {status:step.status,headers:{'content-type':'text/html'}}); if(options.stableUnavailable && url.includes('/share/user/')) return new Response('<html>Unavailable</html>',{headers:{'content-type':'text/html'}}); return new Response(profileHtml(options.providerProfile ?? {}), { status: options.providerStatus ?? 429, headers: { 'content-type': 'text/html' } }); },
    Deno: { env: { get(name) { return {
      SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service',
      SUPABASE_ANON_KEY: 'public', RADAR_SYNC_TOKEN: 's'.repeat(48), FETCHLAYER_API_KEY: options.missingIntegration ? '' : 'provider-key'
    }[name]; } }, serve(callback) { handler = callback; } }
  });
  vm.runInContext(publicScript, context);
  vm.runInContext(stripTypeScriptTypes(source.replace(/^import .*\n/gm, '')), context);
  return { report, calls, streamerUpdates, streamerFilters, async resolveStreamer(streamer){return context.resolveStreamerProfile(streamer,new Date(Date.now()-1800000).toISOString());}, async submit(pin = '0123456789') {
    const response = await handler(new Request('https://example.supabase.co/functions/v1/radar-sync', {
      method: 'POST', headers: {origin:'https://radardatropa.pages.dev','content-type':'application/json'}, body: JSON.stringify({reportId,pin})
    }));
    return {status:response.status,body:await response.json()};
  }, async sync(profile) {return context.syncProfile(profile);}, async scheduled(options, authorized=true) {
    const headers = { 'content-type':'application/json','origin':'https://radardatropa.pages.dev' };
    if(authorized) headers['x-radar-sync-token']='s'.repeat(48);
    const response=await handler(new Request('https://example.supabase.co/functions/v1/radar-sync',{method:'POST',headers,body:JSON.stringify(options)}));
    return {status:response.status,body:await response.json()};
  }, async streamerProfile(auth = 'Bearer user-token', payload = {}) {
    const headers = {origin:'https://radardatropa.pages.dev','content-type':'application/json'};
    if(auth)headers.authorization=auth;
    const response=await handler(new Request('https://example.supabase.co/functions/v1/radar-sync',{
      method:'POST',headers,body:JSON.stringify({action:'streamer-profile',streamerId:reportId,handle:'example',...payload})
    }));
    return {status:response.status,body:await response.json()};
  }, async retry(auth = 'Bearer user-token') {
    const headers = { origin: 'https://radardatropa.pages.dev', 'content-type': 'application/json' };
    if (auth) headers.authorization = auth;
    const response = await handler(new Request('https://example.supabase.co/functions/v1/radar-sync', {
      method: 'POST', headers, body: JSON.stringify({ action: 'retry', reportId })
    }));
    return { status: response.status, body: await response.json() };
  } };
}

test('administrator can retry an old report and gets the actual provider failure', async () => {
  const app = server({ report: { created_at: '2020-01-01' } });
  const result = await app.retry();
  assert.equal(result.status, 200);
  assert.equal(result.body.profileVerified, false);
  assert.equal(result.body.error, 'public_rate_limited');
  assert.equal(app.report.profile_resolution_error, 'public_rate_limited');
  assert.equal(app.report.profile_id, null);
  assert.ok(app.calls.indexOf('isAdmin') < app.calls.indexOf('database'));
});
for (const [name, options, auth] of [
  ['missing token', {}, ''], ['invalid session', { invalidUser: true }, 'Bearer user-token'],
  ['non-administrator', { isAdmin: false }, 'Bearer user-token']
]) test(`retry rejects ${name} before reading or updating reports`, async () => {
  const app = server(options);
  assert.equal((await app.retry(auth)).status, 403);
  assert.ok(!app.calls.includes('database'));
  assert.ok(!app.calls.includes('provider'));
});
test('recent attempts are rate limited without another provider request', async () => {
  const app = server({ report: { profile_resolution_attempt_at: new Date().toISOString() } });
  const result = await app.retry();
  assert.equal(result.status, 429);
  assert.equal(result.body.error, 'retry_later');
  assert.ok(!app.calls.includes('provider'));
});
test('an already identified profile is returned without a new lookup', async () => {
  const app = server({ report: { profile_id: 'existing-profile' } });
  const result = await app.retry();
  assert.equal(result.body.profileVerified, true);
  assert.equal(result.body.error, null);
  assert.ok(!app.calls.includes('provider'));
});
test('public lookup needs no paid provider key', async () => {
  const app = server({ missingIntegration: true, providerStatus: 200,
    providerProfile: { id: '1234567890', uniqueId: 'example' } });
  const result = await app.retry();
  assert.equal(result.status, 200);
  assert.equal(result.body.profileVerified, true);
});
test('a valid provider identity is linked before the result says verified', async () => {
  const app = server({ providerStatus: 200, providerProfile: { id: '1234567890', uniqueId: 'example' } });
  const result = await app.retry();
  assert.equal(result.body.profileVerified, true);
  assert.equal(result.body.error, null);
  assert.equal(app.report.profile_id, 'identified-profile');
  assert.equal(app.report.profile_resolution_error, null);
});
test('unresolved profiles are never confirmed when the provider returns no account', async () => {
  const app = server({ providerStatus: 200 });
  const result = await app.retry();
  assert.equal(result.body.profileVerified, false);
  assert.equal(result.body.error, 'public_profile_unavailable');
});

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const helpers = html.slice(html.indexOf('function profileSyncMessage('), html.indexOf('async function retryProfileSync('));
function browser(fetchImpl) {
  const context = vm.createContext({ fetch: fetchImpl, SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_KEY: 'public', AbortSignal, ensureAdminToken: async () => 'user-token' });
  vm.runInContext(helpers, context);
  return context;
}
test('browser preserves backend errors instead of silently treating them as pending', async () => {
  const app = browser(async () => new Response(JSON.stringify({ error: 'integration_unavailable' }), { status: 503 }));
  const result = await app.requestProfileSync({ reportId });
  assert.equal(result.error, 'integration_unavailable');
  assert.match(app.profileSyncMessage(result.error), /não está configurado/);
});
test('network and non-JSON gateway failures produce an honest failure message', async () => {
  for (const fetchImpl of [async () => { throw new Error('offline'); }, async () => new Response('<html>Error</html>', { status: 502 })]) {
    const app = browser(fetchImpl);
    const result = await app.requestProfileSync({ reportId });
    assert.equal(result.profileVerified, false);
    assert.equal(result.error, 'sync_failed');
    assert.match(app.profileSyncMessage(result.error), /falhou/);
  }
});
test('administrator retry sends the session token', async () => {
  const app = browser(async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer user-token');
    assert.equal(JSON.parse(options.body).action, 'retry');
    return new Response(JSON.stringify({ profileVerified: true }));
  });
  assert.equal((await app.requestProfileSync({ action: 'retry', reportId }, true)).profileVerified, true);
});

function publicReader() {
  const context = vm.createContext({ URL, Response, AbortController, TextDecoder, setTimeout, clearTimeout });
  vm.runInContext(publicScript, context);
  return context;
}
test('public parser uses only the requested account, preserving the full stable ID and bio', () => {
  const reader = publicReader();
  const result = reader.parseTikTokProfile(profileHtml({ id: '7506280430036747320', uniqueId: 'Example', signature: 'RADAR-TEST' }), 'username', 'example');
  assert.equal(result.id, '7506280430036747320');
  assert.equal(result.signature, 'RADAR-TEST');
});
test('missing data, challenge pages, rounded IDs and wrong identities are not verified', () => {
  const reader = publicReader();
  for (const html of ['<html>captcha</html>', '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">invalid</script>',
    profileHtml({ id: 7506280430036747320, uniqueId: 'example' }),
    profileHtml({ id: '7506280430036747320', uniqueId: 'other' })])
    assert.throws(() => reader.parseTikTokProfile(html, 'username', 'example'));
  assert.throws(() => reader.parseTikTokProfile(profileHtml({ id: '7506280430036747320', uniqueId: 'example' }), 'userId', '1111111111'), /identity_mismatch/);
});
test('stable ID lookup follows an official redirect and accepts the new handle for that same ID', async () => {
  const reader = publicReader();
  const urls = [];
  const result = await reader.fetchPublicTikTokProfile('userId', '7506280430036747320', async url => {
    urls.push(url);
    return urls.length === 1 ? new Response(null, { status: 302, headers: { location: '/@new_handle' } })
      : new Response(profileHtml({ id: '7506280430036747320', uniqueId: 'new_handle' }), { headers: { 'content-type': 'text/html' } });
  });
  assert.equal(urls[0], 'https://www.tiktok.com/share/user/7506280430036747320');
  assert.equal(result.uniqueId, 'new_handle');
});
test('redirects cannot send requests to arbitrary hosts or insecure URLs', async () => {
  for (const location of ['https://attacker.example/', 'http://www.tiktok.com/', 'https://user:password@www.tiktok.com/']) {
    const reader = publicReader(); let requests = 0;
    await assert.rejects(reader.fetchPublicTikTokProfile('username', 'example', async () => {
      requests++;
      return new Response(null, { status: 302, headers: { location } });
    }), /public_profile_unavailable/);
    assert.equal(requests, 1);
  }
});
test('oversized HTML is rejected rather than processed', async () => {
  const reader = publicReader();
  await assert.rejects(reader.fetchPublicTikTokProfile('username', 'example', async () =>
    new Response('x'.repeat(2_000_001), { headers: { 'content-type': 'text/html' } })), /public_profile_unavailable/);
});

const appealSource = readFileSync(new URL('../radar-appeal-identity/index.ts', import.meta.url), 'utf8');
function appealServer({ lookupFails = false, liveFails = false, liveError = 'public_profile_unavailable', signature = 'RADAR-TEST', stableId = '1234567890' } = {}) {
  let handler;
  const changes = [], providers = [];
  const context = vm.createContext({
    Response, Request, Date, JSON, String, Error,
    Deno: { env: { get() { return 'configured'; } }, serve(fn) { handler = fn; } },
    fetchPublicTikTokLiveProfile: async () => {
      providers.push('api-live');
      if (lookupFails || liveFails) throw new Error(lookupFails ? 'public_profile_unavailable' : liveError);
      return { id: stableId, uniqueId: 'example', signature };
    },
    fetchPublicTikTokProfile: async () => {
      providers.push('html');
      if (lookupFails) throw new Error('public_profile_unavailable');
      return { id: stableId, uniqueId: 'example', signature };
    },
    fetch: async (url, options) => {
      let rows;
      if (options.method === 'PATCH') { changes.push(JSON.parse(options.body)); rows = []; }
      else if (url.includes('radar_appeal_challenges?')) rows = [{ id: reportId, report_id: reportId,
        handle: 'example', code: 'RADAR-TEST', expires_at: new Date(Date.now() + 60000).toISOString(), attempts: 0 }];
      else if (url.includes('radar_profiles?')) rows = [{ tiktok_user_id: '1234567890' }];
      else rows = [{ profile_id: 'linked-profile', handle: 'example' }];
      return new Response(JSON.stringify(rows));
    }
  });
  vm.runInContext(stripTypeScriptTypes(appealSource.replace(/^import .*\n/gm, '')), context);
  return { changes, providers, async verify() {
    const response = await handler(new Request('https://example.supabase.co/functions/v1/radar-appeal-identity', {
      method: 'POST', headers: { origin: 'https://radardatropa.pages.dev', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'verify', challengeId: reportId })
    }));
    return { status: response.status, body: await response.json() };
  } };
}
test('unavailable public TikTok pages do not use up bio challenge attempts', async () => {
  const app = appealServer({ lookupFails: true });
  assert.equal((await app.verify()).status, 503);
  assert.equal(app.changes.length, 0);
});
test('a readable bio without the code uses an attempt but does not confirm ownership', async () => {
  const app = appealServer({ signature: 'no code' });
  assert.equal((await app.verify()).body.verified, false);
  assert.equal(app.changes[0].attempts, 1);
  assert.ok(!app.changes.some(row => row.verified_at));
});
test('a matching bio code on a different stable ID does not confirm ownership', async () => {
  const app = appealServer({ stableId: '9999999999' });
  assert.equal((await app.verify()).body.verified, false);
  assert.ok(!app.changes.some(row => row.verified_at));
});
test('bio verification still requires both the code and the linked permanent identity', async () => {
  const app = appealServer();
  assert.equal((await app.verify()).body.verified, true);
  assert.equal(app.changes.at(-1).verified_tiktok_user_id, '1234567890');
});

test('private content does not prevent reading an explicitly public account identity', () => {
  const reader = publicReader();
  const html = profileHtml({ id: '7506280430036747320', uniqueId: 'example', privateAccount: true }).replace('"statusCode":0','"statusCode":10222');
  assert.equal(reader.parseTikTokProfile(html,'username','example').id,'7506280430036747320');
  assert.throws(() => reader.parseTikTokProfile(html.replace('"privateAccount":true','"privateAccount":false'),'username','example'));
  assert.throws(() => reader.parseTikTokProfile(html.replace('10222','10221'),'username','example'));
});

test('normal schedule keeps the daily profile interval; authenticated recovery permits a five-minute interval', async () => {
  const normal=server();assert.equal((await normal.scheduled({})).status,200);
  const regular=normal.calls.find(x=>x.startsWith('last_attempt_at.is.null'));
  const recovery=server();assert.equal((await recovery.scheduled({refreshProfiles:true})).status,200);
  const forced=recovery.calls.find(x=>x.startsWith('last_attempt_at.is.null'));
  const regularAt=Date.parse(regular.split('.lt.')[1]),forcedAt=Date.parse(forced.split('.lt.')[1]);
  assert.ok(forcedAt-regularAt>23*60*60*1000);
  const outsider=server();assert.equal((await outsider.scheduled({refreshProfiles:true},false)).status,400);
  assert.ok(!outsider.calls.includes('provider'));
});

test('daily refresh falls back to the last known handle only if the permanent ID still matches',async()=>{
  const options={stableUnavailable:true,providerStatus:200,providerProfile:{id:'1234567890',uniqueId:'example'}};
  const same=server(options);assert.equal(await same.sync({id:'identified-profile',tiktok_user_id:'1234567890',current_handle:'example'}),true);
  assert.equal(same.calls.filter(x=>x==='provider').length,2);
  const reassigned=server(options);assert.equal(await reassigned.sync({id:'identified-profile',tiktok_user_id:'9999999999',current_handle:'example'}),false);
});
test('daily refresh does not send an extra request after a TikTok rate limit',async()=>{
  const app=server();assert.equal(await app.sync({id:'identified-profile',tiktok_user_id:'1234567890',current_handle:'example'}),false);
  assert.equal(app.calls.filter(x=>x==='provider').length,1);
});


test('temporary initial lookup failures retry with backoff and link once on success', async () => {
  const app=server({providerSteps:[{status:503},new Error('public_profile_timeout'),{status:200,profile:{id:'1234567890',uniqueId:'example'}}]});
  const result=await app.submit();
  assert.equal(result.status,200);assert.equal(result.body.profileVerified,true);
  assert.equal(app.calls.filter(x=>x==='provider').length,3);
  assert.deepEqual(app.calls.filter(x=>x.startsWith('wait:')),['wait:1000','wait:3000']);
  assert.equal(app.calls.filter(x=>x==='update').length,2);
  assert.ok(app.calls.indexOf('verifyPin')<app.calls.indexOf('provider'));
});
test('three unsuccessful lookups stay unresolved and stop retrying',async()=>{
  const app=server({providerStatus:503});const result=await app.retry();
  assert.equal(result.body.profileVerified,false);assert.equal(result.body.error,'public_profile_unavailable');
  assert.equal(app.calls.filter(x=>x==='provider').length,3);assert.equal(app.report.profile_id,null);
});
test('a rate limit or a different identity stops immediate retries',async()=>{
  for(const options of [{},{providerStatus:200,providerProfile:{id:'1234567890',uniqueId:'someone_else'}}]){
    const app=server(options);assert.equal((await app.retry()).body.profileVerified,false);
    assert.equal(app.calls.filter(x=>x==='provider').length,1);
    assert.equal(app.calls.filter(x=>x.startsWith('wait:')).length,0);
  }
});
test('ten digit PIN still requires server verification before any report lookup',async()=>{
  const app=server({invalidPin:true});assert.equal((await app.submit()).status,403);
  assert.ok(app.calls.includes('verifyPin'));assert.ok(!app.calls.includes('database'));assert.ok(!app.calls.includes('provider'));
});
test('scheduled report resolution keeps a single attempt per report',async()=>{
  const app=server({pendingReports:true,providerStatus:503});const result=await app.scheduled({});
  assert.equal(result.status,200);assert.equal(result.body.failed,1);
  assert.equal(app.calls.filter(x=>x==='provider').length,1);
  assert.equal(app.calls.filter(x=>x.startsWith('wait:')).length,0);
});

const officialSummary={type:'rich',provider_name:'TikTok',provider_url:'https://www.tiktok.com',author_url:'https://www.tiktok.com/@example',author_name:'Example Name'};
test('official public summary fills name without confirming a permanent identity',async()=>{
 const app=server({providerStatus:503,summary:officialSummary});const result=await app.submit();
 assert.equal(result.body.profileVerified,false);assert.equal(result.body.profileFound,true);
 assert.equal(result.body.error,'public_profile_partial');assert.equal(app.report.profile_id,null);
 assert.equal(app.report.public_profile_name,'Example Name');assert.equal(app.calls.filter(x=>x==='summary').length,1);
});
test('summary accepts only the exact requested TikTok author, never rounded IDs or embed handles as permanent IDs',async()=>{
 const reader=publicReader();
 const summary=await reader.fetchPublicTikTokSummary('example',async()=>new Response(JSON.stringify({...officialSummary,embed_product_id:'example'}),{headers:{'content-type':'application/json'}}));
 assert.equal(summary.displayName,'Example Name');assert.equal(summary.id,undefined);
 for(const bad of [{author_url:'https://www.tiktok.com/@someone_else'},{author_url:'https://attacker.example/@example'},{provider_name:'Other'},{author_name:''}]){
  await assert.rejects(reader.fetchPublicTikTokSummary('example',async()=>new Response(JSON.stringify({...officialSummary,...bad}),{headers:{'content-type':'application/json'}})));
 }
});
test('official summary rejects redirects and oversized responses',async()=>{
 const reader=publicReader();
 await assert.rejects(reader.fetchPublicTikTokSummary('example',async(_url,options)=>{
  assert.equal(options.redirect,'error');return new Response('x'.repeat(32001),{headers:{'content-type':'application/json'}});
 }));
});
test('rate limiting does not trigger an additional metadata request',async()=>{
 const app=server({summary:officialSummary});await app.retry();assert.equal(app.calls.filter(x=>x==='summary').length,0);
});

test('public API-live identity links immediately without HTML or browser lookups',async()=>{
 const app=server({liveProfile:{id:'7434339024405300279',uniqueId:'example',avatarLarger:null}});
 const result=await app.submit();assert.equal(result.body.profileVerified,true);
 assert.equal(app.report.profile_id,'identified-profile');assert.equal(app.calls.filter(x=>x==='liveProvider').length,1);
 assert.equal(app.calls.filter(x=>x==='provider'||x==='summary').length,0);
});
test('API-live parser uses user.id, preserving precision and never substituting roomId',async()=>{
 const reader=publicReader();let requested;
 const result=await reader.fetchPublicTikTokLiveProfile('example',async(url,options)=>{
  requested=new URL(url);assert.equal(options.redirect,'error');
  return new Response(JSON.stringify({statusCode:0,data:{user:{id:'7434339024405300279',roomId:'1111111111111111111',uniqueId:'Example',avatarLarger:'https://p19.tiktokcdn.com/avatar.jpg',signature:'bio'}}}),{headers:{'content-type':'application/json'}});
 });
 assert.equal(result.id,'7434339024405300279');assert.equal(result.uniqueId,'Example');assert.equal(result.signature,'bio');
 assert.equal(requested.origin,'https://www.tiktok.com');assert.equal(requested.searchParams.get('uniqueId'),'example');
});
test('API-live missing, mismatched or rounded account identities are never confirmed',async()=>{
 const reader=publicReader();
 for(const user of [null,{id:7434339024405300000,uniqueId:'example'},{roomId:'7434339024405300279',uniqueId:'example'},{id:'7434339024405300279',uniqueId:'someone_else'}]){
  await assert.rejects(reader.fetchPublicTikTokLiveProfile('example',async()=>new Response(JSON.stringify({statusCode:0,data:{user}}),{headers:{'content-type':'application/json'}})));
 }
});
test('API-live rate limit or mismatched account stops fallbacks',async()=>{
 for(const options of [{liveStatus:429},{liveProfile:{id:'7434339024405300279',uniqueId:'someone_else'}}]){
  const app=server(options);assert.equal((await app.retry()).body.profileVerified,false);
  assert.equal(app.calls.filter(x=>x==='provider'||x==='summary').length,0);
 }
});
test('API-live response size and redirect policy are bounded',async()=>{
 const reader=publicReader();await assert.rejects(reader.fetchPublicTikTokLiveProfile('example',async()=>new Response('x'.repeat(250001),{headers:{'content-type':'application/json'}})));
});

test('bio verification uses API-live without depending on HTML access', async () => {
  const app = appealServer();
  assert.equal((await app.verify()).body.verified, true);
  assert.deepEqual(app.providers, ['api-live']);
});
test('bio verification falls back to HTML when API-live has no account', async () => {
  const app = appealServer({liveFails:true});
  assert.equal((await app.verify()).body.verified, true);
  assert.deepEqual(app.providers, ['api-live', 'html']);
});
for (const code of ['public_rate_limited', 'identity_mismatch']) test(`bio verification stops after ${code} without spending a challenge attempt`, async () => {
  const app = appealServer({liveFails:true,liveError:code});
  assert.equal((await app.verify()).status, 503);
  assert.deepEqual(app.providers, ['api-live']);
  assert.equal(app.changes.length, 0);
});

for (const [label, options, auth] of [
  ['missing authorization',{},''],['invalid session',{invalidUser:true},'Bearer invalid'],['non-admin',{isAdmin:false},'Bearer ordinary']
]) test(`streamer profile rejects ${label} before querying providers or private data`,async()=>{
  const app=server(options);assert.equal((await app.streamerProfile(auth)).status,403);
  assert.ok(!app.calls.includes('database'));assert.ok(!app.calls.includes('liveProvider'));
  assert.ok(!app.calls.includes('radar_admin_claim_streamer_lookup'));
});
test('streamer profile reservation stops repeated lookups',async()=>{
  const app=server({claimDenied:true});assert.equal((await app.streamerProfile()).status,429);
  assert.ok(!app.calls.includes('liveProvider'));assert.ok(!app.calls.includes('database'));
});
test('failed TikTok lookup never replaces a streamer profile or grants a badge',async()=>{
  const app=server();assert.equal((await app.streamerProfile()).status,502);
  assert.ok(!app.calls.includes('radar_admin_link_streamer_profile'));
});
test('streamer linking saves a precise TikTok identity after administrator validation',async()=>{
  const app=server({liveProfile:{id:'7434339024405300279',uniqueId:'example'}});
  assert.equal((await app.streamerProfile()).body.linked,true);
  assert.ok(app.calls.indexOf('isAdmin')<app.calls.indexOf('liveProvider'));
  assert.ok(app.calls.includes('radar_admin_link_streamer_profile'));
  assert.ok(app.calls.some(x=>x?.p_profile_id==='identified-profile'));
  assert.ok(!app.calls.includes('radar_admin_set_verified'));
});
test('streamer linking reports persistence failures instead of a false success',async()=>{
  const app=server({liveProfile:{id:'7434339024405300279',uniqueId:'example'},linkFails:true});
  const result=await app.streamerProfile();assert.equal(result.status,502);assert.equal(result.body.linked,false);
});
test('streamer lookup rejects URLs and malicious handles before external access',async()=>{
  const app=server();assert.equal((await app.streamerProfile('Bearer user-token',{handle:'https://internal.example'})).status,400);
  assert.equal(app.calls.length,0);
});

test('approved streamer handles are linked automatically without granting or changing a badge',async()=>{
 const app=server({pendingStreamers:[{id:reportId,display_name:'example'}],liveProfile:{id:'7434339024405300279',uniqueId:'example'}});
 const result=await app.scheduled({});assert.equal(result.status,200);assert.equal(result.body.streamersLinked,1);
 assert.ok(app.streamerUpdates.some(x=>x.tiktok_profile_id==='identified-profile'));
 assert.ok(app.streamerUpdates.every(x=>!('is_verified' in x)));
 assert.ok(app.streamerFilters.some(([name,value])=>name==='is_verified' && value===true));
 assert.ok(app.streamerFilters.some(([name,value])=>name==='tiktok_profile_id' && value===null));
});
test('automatic streamer lookup stops when a reservation was lost',async()=>{
 const app=server({streamerClaimDenied:true});assert.equal(await app.resolveStreamer({id:reportId,display_name:'example'}),null);
 assert.ok(!app.calls.includes('liveProvider'));
});
test('failed lookup leaves the existing badge and empty profile link unchanged',async()=>{
 const app=server();assert.equal(await app.resolveStreamer({id:reportId,display_name:'example'}),false);
 assert.equal(app.streamerUpdates.length,1);assert.ok(!('tiktok_profile_id' in app.streamerUpdates[0]));
});
test('generic admin labels and names that are not handles are never mapped to unrelated TikTok accounts',async()=>{
 const app=server();for(const name of ['admin','administrador','Streamer com espaços'])assert.equal(await app.resolveStreamer({id:reportId,display_name:name}),null);
 assert.equal(app.streamerUpdates.length,0);assert.ok(!app.calls.includes('liveProvider'));
});
