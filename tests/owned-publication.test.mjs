import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';import {stripTypeScriptTypes} from 'node:module';
const media=readFileSync(new URL('../evidence-media.ts',import.meta.url),'utf8').replaceAll('export function','function');
const edge=readFileSync(new URL('../radar-publish-owned/index.ts',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'');
const report='11111111-1111-4111-8111-111111111111',path=`reports/${report}/22222222-2222-4222-8222-222222222222.jpg`;
const jpeg=new Uint8Array([255,216,255,225,0,8,69,88,73,70,0,0,255,218,0,2,1,2,3,255,217]);
const baseContext=()=>vm.createContext({Uint8Array,DataView,Number,String,Math,Date,Error,Set});
const m=baseContext();vm.runInContext(stripTypeScriptTypes(media),m);
test('public JPEG copies remove EXIF and trailing bytes while preserving image scan',()=>{
 const out=m.publicEvidenceCopy(new Uint8Array([...jpeg,80,82,73,86,65,84,69]),'image/jpeg');assert.deepEqual(Array.from(out),[255,216,255,218,0,2,1,2,3,255,217]);
 assert.throws(()=>m.publicEvidenceCopy(new Uint8Array([255,216,255,225,255,255]),'image/jpeg'));
});
function box(kind,data){const out=new Uint8Array(data.length+8);new DataView(out.buffer).setUint32(0,out.length);out.set(Buffer.from(kind),4);out.set(data,8);return out;}
test('MP4 copies remove user metadata without changing sample offsets or duration',()=>{
 const mvhd=new Uint8Array(24);new DataView(mvhd.buffer).setUint32(12,1000);new DataView(mvhd.buffer).setUint32(16,10000);mvhd[4]=10;
 const payload=Buffer.concat([box('ftyp',Buffer.from('isom000000000000')),box('moov',Buffer.concat([box('mvhd',mvhd),box('udta',Buffer.from('GPS PRIVATE'))])),box('mdat',new Uint8Array([1,2,3]))]);
 const out=m.publicEvidenceCopy(payload,'video/mp4');assert.equal(out.length,payload.length);assert.equal(Buffer.from(out).includes(Buffer.from('GPS PRIVATE')),false);assert.equal(m.mp4Duration(out),10);assert.equal(m.fileType(out),'video/mp4');
});
function server(options={}) {
 const calls={uploads:0,removals:0,finish:0,begins:0,abort:0};let handler;
 const context=vm.createContext({Uint8Array,DataView,Number,String,Math,Date,Error,Set,JSON,RegExp,Response,Request,AbortSignal,crypto:{randomUUID:()=> '33333333-3333-4333-8333-333333333333'},
  Deno:{env:{get:name=>name==='SUPABASE_URL'?'https://fixture.supabase.co':'server-only'},serve:fn=>handler=fn},
  fetch:async(url,init={})=>{
   if(url.endsWith('/rpc/radar_begin_owned_publication')){calls.begins++;return Response.json(options.denied?{denied:true}:options.incomplete?{incomplete:true}:options.busy?{busy:true}:options.lostCommit && calls.finish?{published:true,proof_count:1}:{tickets:options.noFiles?[]:[{path,mime:'image/jpeg'}]});}
   if(url.includes('/authenticated/'))return new Response(options.wrongType?'INVALID':jpeg);
   if(url.includes('/radar-public-evidence')){if(init.method==='DELETE'){calls.removals++;return Response.json({});}calls.uploads++;assert.equal(init.headers['Content-Type'],'image/jpeg');assert.equal(Buffer.from(init.body).includes(Buffer.from('EXIF')),false);return new Response('{}',{status:options.uploadFails?503:200});}
   if(url.endsWith('/rpc/radar_finish_owned_publication')){calls.finish++;if(options.lostCommit)throw new Error('connection lost after commit');return Response.json({published:true,proof_count:options.noFiles?0:1});}
   if(url.endsWith('/rpc/radar_abort_owned_publication')){calls.abort++;return new Response(null,{status:204});}
   throw new Error('Unexpected request '+url);
  }});
 vm.runInContext(stripTypeScriptTypes(media+'\n'+edge),context);
 return {calls,send:input=>handler(new Request('https://fixture/functions/v1/radar-publish-owned',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input || {reportId:report,pin:'1234512345',expectedFiles:1})}))};
}
test('ordinary, unrelated and incomplete reports cannot upload a public copy',async()=>{
 for(const option of ['denied','incomplete','busy']){const s=server({[option]:true});const r=await s.send();assert.equal(r.status,option==='denied'?403:409);assert.equal(s.calls.uploads,0);assert.equal(s.calls.finish,0);}
});
test('owner publication copies validated bytes before committing a report',async()=>{
 const s=server();const response=await s.send();assert.equal(response.status,200);assert.equal((await response.json()).published,true);assert.equal(s.calls.uploads,1);assert.equal(s.calls.finish,1);
});
test('failed public copy preserves private originals and aborts publication',async()=>{
 const s=server({uploadFails:true});const r=await s.send();assert.equal(r.status,503);assert.equal(s.calls.finish,0);assert.equal(s.calls.removals,1);assert.equal(s.calls.abort,1);
});
test('wrong file signatures never reach public storage',async()=>{
 const s=server({wrongType:true});assert.equal((await s.send()).status,503);assert.equal(s.calls.uploads,0);assert.equal(s.calls.finish,0);
});
test('a lost final response does not delete evidence that was already published',async()=>{
 const s=server({lostCommit:true});assert.equal((await s.send()).status,200);assert.equal(s.calls.begins,2);assert.equal(s.calls.removals,0);assert.equal(s.calls.abort,0);
});
test('a report without attachments can be published without creating any object',async()=>{
 const s=server({noFiles:true});assert.equal((await s.send({reportId:report,pin:'1234512345',expectedFiles:0})).status,200);assert.equal(s.calls.uploads,0);assert.equal(s.calls.finish,1);
});
test('PNG copies keep image chunks and discard text metadata',()=>{
 const signature=new Uint8Array([137,80,78,71,13,10,26,10]);const chunk=(kind,bytes)=>{const out=new Uint8Array(bytes.length+12);new DataView(out.buffer).setUint32(0,bytes.length);out.set(Buffer.from(kind),4);out.set(bytes,8);return out;};
 const bytes=Buffer.concat([signature,chunk('IHDR',new Uint8Array(13)),chunk('tEXt',Buffer.from('GPS PRIVATE')),chunk('IDAT',new Uint8Array([1,2])),chunk('IEND',new Uint8Array())]);
 const out=m.publicEvidenceCopy(bytes,'image/png');assert.equal(Buffer.from(out).includes(Buffer.from('GPS PRIVATE')),false);assert.equal(m.fileType(out),'image/png');
});
test('WebP copies remove EXIF/XMP chunks and their feature flags',()=>{
 const chunk=(kind,bytes)=>{const out=new Uint8Array(bytes.length+8+(bytes.length%2));new DataView(out.buffer).setUint32(4,bytes.length,true);out.set(Buffer.from(kind),0);out.set(bytes,8);return out;};
 const flags=new Uint8Array(10);flags[0]=0x2c;const bytes=Buffer.concat([Buffer.from('RIFF0000WEBP'),chunk('VP8X',flags),chunk('EXIF',Buffer.from('GPS PRIVATE')),chunk('VP8 ',new Uint8Array([1,2]))]);
 const out=m.publicEvidenceCopy(bytes,'image/webp');assert.equal(Buffer.from(out).includes(Buffer.from('GPS PRIVATE')),false);assert.equal(out[20]&0x2c,0);assert.equal(m.fileType(out),'image/webp');assert.equal(new DataView(out.buffer).getUint32(4,true),out.length-8);
});
