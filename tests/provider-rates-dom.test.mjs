import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://localhost:5174'});
for(const name of ['window','document','navigator','HTMLElement','HTMLButtonElement','HTMLInputElement','Node','Element','Event','MouseEvent'])Object.defineProperty(globalThis,name,{configurable:true,writable:true,value:dom.window[name]});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {default:React,act}=await import('react');const {createRoot}=await import('react-dom/client');
const {default:ProviderRateSettings}=await import('../app/provider-rate-settings.tsx');
const {default:EntryAmount}=await import('../components/entry-amount.tsx');
const {brusselsToday}=await import('../lib/business.ts');
const wait=()=>new Promise(r=>setTimeout(r,20));
const change=(input,value)=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));};
const today=brusselsToday();
test('own form loads current effective date, sends own rate and optimistic version, preserves input on conflict',async()=>{
 const payloads=[];let saved=0;globalThis.fetch=async(url,options)=>{if(options?.body){payloads.push(JSON.parse(options.body));return{ok:false,json:async()=>({error:'Ce tarif a changé.'})};}return{ok:true,json:async()=>({rates:[{effective_from:today,hourly_rate_cents:5000,version:3}]})};};
 const root=createRoot(document.getElementById('root'));await act(async()=>{root.render(React.createElement(ProviderRateSettings,{memberId:'alice',onSaved:()=>saved++}));await wait();});
 const amount=document.querySelector('input[inputmode=decimal]');assert.equal(amount.value,'50.00');assert.match(document.body.textContent,/Mon tarif avec Sumatoni/);assert.match(document.body.textContent,/heures déjà saisies/);
 await act(async()=>{change(amount,'55,25');await wait();});await act(async()=>{document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await wait();});
 assert.deepEqual(payloads,[{member_id:'alice',effective_from:today,hourly_rate:'55,25',version:3}]);assert.equal(saved,0);assert.equal(amount.value,'55,25');assert.match(document.querySelector('[role=alert]').textContent,/a changé/);await act(async()=>root.unmount());
});
test('admin row stays private until expanded; new effective date leaves earlier rate in history',async()=>{
 let requests=0,payload;globalThis.fetch=async(url,options)=>{requests++;if(options?.body){payload=JSON.parse(options.body);return{ok:true,json:async()=>({rates:[{effective_from:'2026-11-01',hourly_rate_cents:6000,version:1},{effective_from:today,hourly_rate_cents:5000,version:1}]})};}return{ok:true,json:async()=>({rates:[{effective_from:today,hourly_rate_cents:5000,version:1}]})};};
 const root=createRoot(document.getElementById('root'));await act(async()=>{root.render(React.createElement(ProviderRateSettings,{memberId:'alice',compact:true,onSaved:()=>{}}));await wait();});assert.equal(requests,0);assert.equal(document.querySelector('form'),null);
 await act(async()=>{document.querySelector('button').click();await wait();});assert.equal(requests,1);
 await act(async()=>{change(document.querySelector('input[type=date]'),'2026-11-01');await wait();});assert.equal(document.querySelector('input[inputmode=decimal]').value,'');
 await act(async()=>{change(document.querySelector('input[inputmode=decimal]'),'60');await wait();});await act(async()=>{document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await wait();});assert.deepEqual(payload,{member_id:'alice',effective_from:'2026-11-01',hourly_rate:'60',version:0});assert.equal(document.querySelectorAll('.rate-history li').length,2);assert.match(document.querySelector('[role=status]').textContent,/enregistré/);await act(async()=>root.unmount());
});
test('rendered provider amount ignores client sale price even if hostile props contain it',async()=>{
 const root=createRoot(document.getElementById('root')),entry={start:540,end:556,hourly_rate_cents:98765,provider_rate_cents:5000};
 await act(async()=>root.render(React.createElement(EntryAmount,{entry,role:'partner'})));assert.match(document.body.textContent,/Mon montant HT/);assert.match(document.body.textContent,/25,00/);assert.doesNotMatch(document.body.textContent,/493,83|987,65/);
 await act(async()=>root.render(React.createElement(EntryAmount,{entry:{...entry,provider_rate_cents:null},role:'partner'})));assert.match(document.body.textContent,/Non renseigné/);assert.doesNotMatch(document.body.textContent,/493,83/);
 await act(async()=>root.render(React.createElement(EntryAmount,{entry,role:'admin'})));assert.match(document.body.textContent,/493,83/);await act(async()=>root.unmount());
});
