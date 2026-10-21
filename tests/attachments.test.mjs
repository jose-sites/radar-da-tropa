import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('async function sendEvidenceFile('),end=html.indexOf('async function uploadEvidence(',start);
function transport(behavior) {
  const state={headers:{},url:null};
  const context=vm.createContext({Response,Error,SUPABASE_URL:'https://example.supabase.co',SUPABASE_KEY:'public',
    XMLHttpRequest:class {
      constructor(){this.upload={};}
      open(method,url){state.method=method;state.url=url;}
      setRequestHeader(key,value){state.headers[key]=value;}
      send(body){state.body=body;behavior(this);}
    }});
  vm.runInContext(html.slice(start,end),context);return {context,state};
}
test('upload progress comes from measured browser bytes, not an estimated timer',async()=>{
  const {context,state}=transport(request=>{request.upload.onprogress({lengthComputable:true,loaded:25,total:100});request.upload.onprogress({lengthComputable:true,loaded:100,total:100});request.status=200;request.responseText='{}';request.onload();});
  const percentages=[];const response=await context.sendEvidenceFile('reports/test.jpg',{type:'image/jpeg'},value=>percentages.push(value));
  assert.deepEqual(percentages,[25,100]);assert.equal(response.status,200);assert.equal(state.headers['Content-Type'],'image/jpeg');
});
test('an unknown total does not claim a false percentage',async()=>{
  const {context}=transport(request=>{request.upload.onprogress({lengthComputable:false,loaded:10,total:0});request.status=200;request.responseText='{}';request.onload();});
  const percentages=[];await context.sendEvidenceFile('reports/test.jpg',{type:'image/jpeg'},value=>percentages.push(value));assert.deepEqual(percentages,[]);
});
test('network interruptions and timeouts explain that the attachment can be retried',async()=>{
  for(const event of ['onerror','ontimeout','onabort']) {
    const {context}=transport(request=>request[event]());
    await assert.rejects(context.sendEvidenceFile('reports/test.jpg',{type:'image/jpeg'},()=>{}),/tente novamente/i);
  }
});
test('the transport preserves HTTP failure status for retry handling',async()=>{
  const {context}=transport(request=>{request.status=503;request.responseText='{"message":"temporário"}';request.onload();});
  const response=await context.sendEvidenceFile('reports/test.jpg',{type:'image/jpeg'},()=>{});assert.equal(response.status,503);assert.equal((await response.json()).message,'temporário');
});
