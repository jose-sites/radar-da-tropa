import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const context=vm.createContext({});
vm.runInContext(html.slice(html.indexOf('function normalizeAdminSearch('),html.indexOf('function captureAdminDrafts(')),context);
const reports=[
 {id:'a',handle:'joao',streamer_name:'José',reason:'Não pagou',category:'nao_pagamento',status:'pending',profile_verified:false,upload_issues:1,evidence:[],created_at:'2026-10-20'},
 {id:'b',handle:'maria',streamer_name:'Ana',category:'outro',status:'published',profile_verified:true,evidence:['photo'],created_at:'2026-10-21'},
 {id:'c',handle:'antigo',original_handle:'joao_anterior',category:'outro',status:'rejected',profile_verified:false,evidence:[],created_at:'2026-10-19'}
];
const ids=result=>Array.from(result,r=>r.id);
test('admin search ignores accents and leading @, and includes original handle',()=>{
 assert.deepEqual(ids(context.filterAdminReports(reports,{query:'@JOAO'})),['a','c']);
 assert.deepEqual(ids(context.filterAdminReports(reports,{query:'Jose'})),['a']);
 assert.deepEqual(ids(context.filterAdminReports(reports,{query:'nao pagou'})),['a']);
});
test('admin filters combine status, category, identity and attachment state',()=>{
 assert.deepEqual(ids(context.filterAdminReports(reports,{status:'pending',category:'nao_pagamento',identity:'unverified',attachments:'issues'})),['a']);
 assert.deepEqual(ids(context.filterAdminReports(reports,{identity:'verified',attachments:'with'})),['b']);
 assert.deepEqual(ids(context.filterAdminReports(reports,{status:'published',attachments:'without'})),[]);
});
test('ordering prioritizes pending cases without mutating dashboard data',()=>{
 assert.deepEqual(ids(context.filterAdminReports(reports,{sort:'pending'})),['a','b','c']);
 assert.deepEqual(ids(context.filterAdminReports(reports,{sort:'oldest'})),['c','a','b']);
 assert.deepEqual(ids(reports),['a','b','c']);
});
test('appeal filter supports each moderation outcome',()=>{
 const appeals=[{status:'pending'},{status:'accepted'},{status:'denied'}];
 assert.equal(context.filterAdminAppeals(appeals,'accepted').length,1);
 assert.equal(context.filterAdminAppeals(appeals,'all').length,3);
});
