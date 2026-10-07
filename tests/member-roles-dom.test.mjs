import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://localhost:5173'});
for(const name of ['window','document','history','navigator','HTMLElement','HTMLButtonElement','HTMLInputElement','HTMLSelectElement','Node','Element','DocumentFragment','MutationObserver','getComputedStyle','Event','CustomEvent','MouseEvent','NodeFilter'])Object.defineProperty(globalThis,name,{configurable:true,writable:true,value:dom.window[name]});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {createRoot}=await import('react-dom/client');const {default:TeamPanel}=await import('../app/team-panel.tsx');
const wait=()=>new Promise(r=>setTimeout(r,20));
const member=(id,role='partner',active=1)=>({id,name:id,email:id+'@example.test',role,active,provider:'entra'});
const data={me:member('owner','admin'),members:[member('owner','admin'),member('alice'),member('other','admin'),member('disabled','partner',0)],clients:[],entries:[]};
const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
test('role change needs an explicit confirmation; self role is hidden and disabled member cannot be promoted',async()=>{
 const payloads=[];let reloads=0;globalThis.fetch=async(url,options)=>{if(options?.body)payloads.push(JSON.parse(options.body));return{ok:true,json:async()=>({entra:'ready'})};};
 const root=createRoot(document.getElementById('root'));await act(async()=>{root.render(React.createElement(TeamPanel,{data,reload:()=>reloads++,toggle:()=>{}}));await wait();});
 assert.equal(document.body.textContent.includes('Partenaire'),false);assert.equal(document.body.textContent.includes('partenaire'),false);assert.match(document.body.textContent,/Prestataire/);
 const rows=[...document.querySelectorAll('.team-member')];assert.equal(rows[0].textContent.includes('Passer en prestataire'),false);assert.ok(rows[3].querySelector('.team-actions button').disabled);
 await act(async()=>{button('Rendre administrateur').click();await wait();});assert.deepEqual(payloads,[]);
 let form=document.querySelector('form[aria-label="Modifier le rôle de alice"]');assert.match(form.textContent,/modifier et exporter toutes les prestations/);assert.match(form.textContent,/sessions SumaTime seront déconnectées/);
 await act(async()=>{[...form.querySelectorAll('button')].find(b=>b.textContent==='Annuler').click();await wait();});assert.equal(document.querySelector('form[aria-label="Modifier le rôle de alice"]'),null);assert.deepEqual(payloads,[]);
 await act(async()=>{button('Rendre administrateur').click();await wait();});form=document.querySelector('form[aria-label="Modifier le rôle de alice"]');
 await act(async()=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await wait();});assert.deepEqual(payloads,[{action:'memberRole',id:'alice',role:'admin',expectedRole:'partner'}]);assert.equal(reloads,1);assert.equal(document.querySelector('form[aria-label="Modifier le rôle de alice"]'),null);await act(async()=>root.unmount());
});
test('failed demotion leaves confirmation open and explains the server refusal',async()=>{
 globalThis.fetch=async(url,options)=>({ok:!options?.body,json:async()=>options?.body?{error:'Conservez un administrateur local de secours.'}:{entra:'ready'}});
 const root=createRoot(document.getElementById('root'));await act(async()=>{root.render(React.createElement(TeamPanel,{data,reload:()=>assert.fail('unexpected reload'),toggle:()=>{}}));await wait();});
 await act(async()=>{button('Passer en prestataire').click();await wait();});const form=document.querySelector('form[aria-label="Modifier le rôle de other"]');assert.match(form.textContent,/uniquement ses propres prestations/);
 await act(async()=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await wait();});assert.match(document.querySelector('[role=alert]').textContent,/secours/);assert.ok(document.querySelector('form[aria-label="Modifier le rôle de other"]'));await act(async()=>root.unmount());
});
