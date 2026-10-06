import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://localhost:5173/login'});
for(const name of ['window','document','history','navigator','HTMLElement','HTMLButtonElement','HTMLInputElement','HTMLSelectElement','Node','Element','DocumentFragment','MutationObserver','getComputedStyle','Event','CustomEvent','MouseEvent','NodeFilter'])Object.defineProperty(globalThis,name,{configurable:true,writable:true,value:dom.window[name]});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.requestAnimationFrame=cb=>setTimeout(()=>cb(Date.now()),0);globalThis.cancelAnimationFrame=clearTimeout;
const {createRoot}=await import('react-dom/client');const {default:Login}=await import('../app/login/page.tsx');const {default:AccountPanel}=await import('../app/account-panel.tsx');const {default:TeamPanel}=await import('../app/team-panel.tsx');
const wait=()=>new Promise(r=>setTimeout(r,20));
function input(element,value){Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new dom.window.Event('input',{bubbles:true}));element.dispatchEvent(new dom.window.Event('change',{bubbles:true}));}
test('Microsoft login is offered only when ready; fallback remains and safe callback errors are explained',async()=>{
 for(const state of ['ready','disabled','incomplete']){
  globalThis.fetch=async()=>({json:async()=>({setup:false,ldap:true,entra:state})});const root=createRoot(document.getElementById('root'));
  await act(async()=>{root.render(React.createElement(Login));await wait();});
  assert.equal(Boolean(document.querySelector('a[href="/api/auth/entra/start"]')),state==='ready');assert.ok(document.querySelector('input[autocomplete=username]'));assert.ok(document.querySelector('input[type=password]'));
  await act(async()=>{root.unmount();await wait();});
 }
 for(const code of ['denied','constructor','__proto__','unknown']){
  dom.reconfigure({url:'http://localhost:5173/login?entra_error='+code});globalThis.fetch=async()=>({json:async()=>({setup:false,ldap:false,entra:'ready'})});const root=createRoot(document.getElementById('root'));
  await act(async()=>{root.render(React.createElement(Login));await wait();});assert.match(document.querySelector('[role=alert]').textContent,code==='denied'?/n’a pas accès/:/a expiré/);assert.equal(window.location.search,'');await act(async()=>{root.unmount();});
 }
});
test('Microsoft account explains who manages credentials and never offers a Microsoft password form',async()=>{
 const root=createRoot(document.getElementById('root'));await act(async()=>{root.render(React.createElement(AccountPanel,{me:{id:'alice',name:'Alice',email:'alice@example.test',provider:'entra'},onDone:()=>{}}));await wait();});
 assert.equal(document.querySelectorAll('input[type=password]').length,0);assert.match(document.body.textContent,/Microsoft 365 Sumatoni/);assert.match(document.body.textContent,/double authentification/);await act(async()=>{root.unmount();});
});
test('admin can attach Microsoft to an existing member without creating a duplicate or requesting a password',async()=>{
 const payloads=[];let reloads=0;globalThis.fetch=async(url,options)=>{if(options?.body)payloads.push(JSON.parse(options.body));return{ok:true,json:async()=>({entra:'disabled',entraTenantId:'11111111-1111-4111-8111-111111111111'})};};
 const data={me:{id:'admin',role:'admin',provider:'local'},members:[{id:'alice-stable',name:'Alice',email:'alice@example.test',provider:'local',role:'partner',active:1}],clients:[],entries:[]};const root=createRoot(document.getElementById('root'));
 await act(async()=>{root.render(React.createElement(TeamPanel,{data,reload:()=>reloads++,toggle:()=>{}}));await wait();});
 await act(async()=>{[...document.querySelectorAll('button')].find(b=>b.textContent==='Rattacher Microsoft').click();await wait();});
 const form=[...document.querySelectorAll('form')].find(f=>f.textContent.includes('Microsoft · Alice'));
 assert.equal(form.querySelectorAll('input[type=password]').length,0);assert.equal(form.querySelectorAll('input')[0].value,'11111111-1111-4111-8111-111111111111');
 await act(async()=>{input(form.querySelectorAll('input')[1],'33333333-3333-4333-8333-333333333333');form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await wait();});
 assert.deepEqual(payloads,[{action:'entraLink',id:'alice-stable',tenantId:'11111111-1111-4111-8111-111111111111',objectId:'33333333-3333-4333-8333-333333333333'}]);assert.equal(reloads,1);await act(async()=>{root.unmount();});
});
