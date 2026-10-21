import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');const context=vm.createContext({escapeHtml:value=>String(value).replace(/[<>]/g,x=>x==='<'?'&lt;':'&gt;'),formattedDate:()=> '21/10/2026'});
vm.runInContext(html.slice(html.indexOf('function handleChangeNotice('),html.indexOf('function cardEventDate(')),context);
test('handle change notices require a linked identity and valid distinct aliases',()=>{
 assert.equal(context.handleChangeNotice('atual',['antigo'],false),'');assert.equal(context.handleChangeNotice('atual',['ATUAL','<script>'],true),'');
 const result=context.handleChangeNotice('atual',['antigo','ANTIGO'],true);assert.equal((result.match(/@antigo/g)||[]).length,1);assert.match(result,/agora <b>@atual/);
});
test('resolution history escapes public notes without changing the original allegation',()=>{
 const result=context.resolutionBlock({resolution_status:'resolved',resolution_note:'<script>unsafe</script>',resolution_history:[{status:'open',note:'Reaberto',created_at:'date'}]},true);
 assert.match(result,/Caso resolvido/);assert.equal(result.includes('<script>'),false);assert.match(result,/Histórico do caso/);
 assert.equal(context.resolutionBlock({resolution_status:'open'}),'');
});
