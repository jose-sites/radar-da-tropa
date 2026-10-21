import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const media=html.slice(html.indexOf('async function decodeEvidenceImage('),html.indexOf('\nfunction selectAppealReport('));
function client() {
 const calls={tickets:[],uploads:[],checks:0,released:0};
 const context=vm.createContext({Blob,WeakMap,AbortSignal,setTimeout,clearTimeout,console,Error,
  SUPABASE_URL:'https://example.supabase.co',SUPABASE_KEY:'public',
  uploadedFiles:new WeakMap(),uploadReservations:new WeakMap(),
  URL:{createObjectURL(){return 'blob:test';},revokeObjectURL(){calls.released++;}},
  Image:class {constructor(){this.naturalWidth=1200;this.naturalHeight=800;}set src(value){if(value)setTimeout(()=>this.onload(),0);}},
  document:{createElement(){return {getContext(){return {fillRect(){},drawImage(){}};},toBlob(callback,type){callback(new Blob(['jpeg'],{type}));}};}},
  rpc:async(name,args)=>{calls.tickets.push(args);return 'reports/'+args.p_target_id+'/test.jpg';},
  fetch:async(url,options)=>{if(url.includes('/storage/')){calls.uploads.push(options);return new Response('{}');}calls.checks++;return new Response('{"verified":true}');},
  parseResponse:async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error||'failed');return body;}
 });
 vm.runInContext(media,context);return {context,calls};
}
const photo=()=>new Blob(['png'],{type:'image/png'});
test('photo preparation uses the Safari fallback, emits JPEG and releases its object URL',async()=>{
 const {context,calls}=client();context.createImageBitmap=async()=>{throw new Error('unsupported');};
 const result=await context.imageWithoutMetadata(photo());assert.equal(result.type,'image/jpeg');assert.equal(calls.released,1);
});
test('upload ticket and storage Content-Type use the converted MIME',async()=>{
 const {context,calls}=client();await context.uploadEvidence('report','first','secret',photo());
 assert.equal(calls.tickets[0].p_mime,'image/jpeg');assert.equal(calls.uploads[0].headers['Content-Type'],'image/jpeg');
});
test('transient storage failure reuses the ticket on retry',async()=>{
 const {context,calls}=client();const file=photo();let uploads=0;
 context.fetch=async url=>url.includes('/storage/')?new Response('{}',{status:++uploads===1?503:200}):new Response('{"verified":true}');
 await assert.rejects(context.uploadEvidence('report','first','secret',file));
 await context.uploadEvidence('report','first','secret',file);
 assert.equal(calls.tickets.length,1);assert.equal(uploads,2);
});
test('verification retry does not reupload an already stored file',async()=>{
 const {context,calls}=client();const file=photo();let uploads=0,checks=0;
 context.fetch=async url=>{if(url.includes('/storage/')){uploads++;return new Response('{}');}return new Response('{}',{status:++checks===1?503:200});};
 await assert.rejects(context.uploadEvidence('report','first','secret',file));await context.uploadEvidence('report','first','secret',file);
 assert.equal(uploads,1);assert.equal(calls.tickets.length,1);assert.equal(checks,2);
});
test('a rejected object is reuploaded on retry without allocating another ticket',async()=>{
 const {context,calls}=client();const file=photo();let uploads=0,checks=0;
 context.fetch=async url=>{if(url.includes('/storage/')){uploads++;return new Response('{}');}return new Response('{}',{status:++checks===1?422:200});};
 await assert.rejects(context.uploadEvidence('report','first','secret',file));await context.uploadEvidence('report','first','secret',file);
 assert.equal(uploads,2);assert.equal(calls.tickets.length,1);
});
test('successful files are skipped only for the same saved report',async()=>{
 const {context,calls}=client();const file=photo();await context.uploadEvidence('report','first','secret',file);
 await context.uploadEvidence('report','first','secret',file);assert.equal(calls.tickets.length,1);
 await context.uploadEvidence('report','second','secret',file);assert.equal(calls.tickets.length,2);
});
test('image acceptance includes HEIC but excludes SVG and arbitrary extensions',()=>{
 const {context}=client();assert.equal(context.isEvidenceImage({type:'image/heic'}),true);
 assert.equal(context.isEvidenceImage({type:'',name:'IMG.HEIC'}),true);
 assert.equal(context.isEvidenceImage({type:'image/svg+xml',name:'x.svg'}),false);
});
const verifier=readFileSync(new URL('../radar-upload-check/index.ts',import.meta.url),'utf8');
function server(){const context=vm.createContext({Uint8Array,DataView,Number,String,Math,Date,Set,Error,
 Deno:{env:{get(){return 'configured';}},serve(){}},Response});vm.runInContext(stripTypeScriptTypes(verifier),context);return context;}
test('server identifies JPEG/PNG content and rejects unrecognized bytes',()=>{
 const context=server();assert.equal(context.fileType(new Uint8Array([255,216,255])),'image/jpeg');
 assert.equal(context.fileType(new Uint8Array([137,80,78,71,13,10,26,10])),'image/png');
 assert.equal(context.fileType(new Uint8Array([60,115,118,103,62])),null);
});
test('server reads MP4 duration and rejects unsupported box versions',()=>{
 const context=server();const bytes=new Uint8Array(32);const view=new DataView(bytes.buffer);
 view.setUint32(0,32);bytes.set([109,118,104,100],4);view.setUint32(20,1000);view.setUint32(24,31000);
 assert.equal(context.mp4Duration(bytes),31);
 bytes[8]=2;assert.equal(context.mp4Duration(bytes),null);
});
test('streamer badge is explicit about Radar verification',()=>{
 const context=vm.createContext({});const begin=html.indexOf('function streamerBadge(');const end=html.indexOf('async function loadPublicStats(',begin);vm.runInContext(html.slice(begin,end),context);
 assert.equal(context.streamerBadge(false),'');assert.match(context.streamerBadge(true),/não é um selo oficial/);
});
