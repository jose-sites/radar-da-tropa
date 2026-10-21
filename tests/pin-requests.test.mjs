import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const values={'pin-request-name':' Teste ','pin-request-handle':'@nome_teste','pin-request-context':'Contexto suficiente para solicitar acesso.','pin-request-contact':'+55 (27) 99999-9999'};
const context=vm.createContext({document:{getElementById:id=>({value:values[id]})}});
vm.runInContext(html.slice(html.indexOf('function pinRequestPayload('),html.indexOf('function persistPinDraft(')),context);
test('PIN request normalizes a handle and international WhatsApp number',()=>{
 const result=context.pinRequestPayload();assert.equal(result.p_name,'Teste');assert.equal(result.p_handle,'nome_teste');assert.equal(result.p_contact,'5527999999999');
});
test('a PIN request can be registered without a WhatsApp number',()=>{
 values['pin-request-contact']='';assert.equal(context.pinRequestPayload().p_contact,null);
});
test('malformed identity and incomplete request details are rejected before sending',()=>{
 values['pin-request-handle']='nome<script>';assert.throws(()=>context.pinRequestPayload(),/Confira/);
 values['pin-request-handle']='nome';values['pin-request-context']='curto';assert.throws(()=>context.pinRequestPayload(),/Confira/);
});
