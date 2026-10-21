import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const context=vm.createContext({SUPABASE_URL:'https://example.supabase.co',location:{hostname:'radardatropa.pages.dev',pathname:'/ficha/11111111-1111-4111-8111-111111111111',search:''},URLSearchParams});
vm.runInContext(html.slice(html.indexOf('function dossierHref('),html.indexOf('function dossierReport(')),context);
vm.runInContext(html.slice(html.indexOf('function profileRoute('),html.indexOf('function openCurrentRoute(')),context);
test('public proof gallery accepts only reviewed report object paths',()=>{
 assert.equal(context.publicProofs([{path:'javascript:alert(1)'},{path:'appeals/private.jpg'},{path:'reports/../../private.jpg'}]),'');
 assert.match(context.publicProofs([{path:'reports/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.jpg'}]),/radar-public-evidence/);
});
test('dossier deep links and existing report links retain distinct routes',()=>{
 assert.equal(context.profileRoute().kind,'ficha');
 context.location.pathname='/';context.location.search='?relato=11111111-1111-4111-8111-111111111111';assert.equal(context.profileRoute().kind,'perfil');
 context.location.hostname='jose-sites.github.io';assert.match(context.dossierHref('id'),/^\?ficha=/);
});
