import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existingProject,projectConfiguration} from '../scripts/cloudflare-project.mjs';

test('deployment uses the existing project production branch, including direct-upload projects',()=>{
  assert.deepEqual(projectConfiguration({success:true,result:{name:'radardatropa',subdomain:'radardatropa.pages.dev',production_branch:'production'}}),
    {project:'radardatropa',hostname:'radardatropa.pages.dev',branch:'production'});
});
test('an unknown project or another hostname is rejected without creating anything',()=>{
  for(const data of [{success:false},{success:true,result:{name:'other',subdomain:'radardatropa.pages.dev'}},
    {success:true,result:{name:'radardatropa',subdomain:'other.pages.dev'}}]) assert.throws(()=>projectConfiguration(data),/Nenhum projeto será criado/);
});
test('remote branch names cannot inject shell environment entries',()=>{
  assert.throws(()=>projectConfiguration({success:true,result:{name:'radardatropa',subdomain:'radardatropa.pages.dev',production_branch:'main\nINJECT=value'}}));
});
test('credentials are required before any API request is made',async()=>{
  let requests=0;
  await assert.rejects(existingProject('',undefined,async()=>{requests++;}));
  assert.equal(requests,0);
});
test('only a read request is used to verify the existing project',async()=>{
  const account='a'.repeat(32);
  const result=await existingProject(account,'test-token',async(url,options)=>{
    assert.equal(url,`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/radardatropa`);
    assert.equal(options.method,undefined);assert.equal(options.headers.Authorization,'Bearer test-token');
    return new Response(JSON.stringify({success:true,result:{name:'radardatropa',subdomain:'radardatropa.pages.dev',production_branch:'main'}}));
  });
  assert.equal(result.branch,'main');
});
test('API authorization failure is reported without leaking the credential',async()=>{
  await assert.rejects(existingProject('a'.repeat(32),'private-test-token',async()=>new Response('{}',{status:403})),error=>{
    assert.match(error.message,/HTTP 403/);assert.ok(!error.message.includes('private-test-token'));return true;
  });
});
