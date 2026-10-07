import test from 'node:test';
import assert from 'node:assert/strict';
import { entraAssigned, ENTRA_ASSIGNMENT_CACHE_MS } from '../lib/entra-assignments.ts';
import { tenant, clientId, aliceOid, bobOid } from './entra-mock.mjs';
const resource = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const originalFetch = globalThis.fetch;
let sequence = 0;
const config = () => ({ tenantId: tenant, clientId, secret: 'test-only-' + ++sequence, accessMode: 'assignment' });
const response = (value, status=200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const row = (principalId=aliceOid, principalType='User') => ({ principalId, principalType, resourceId: resource });
function mock(options={}) {
 const calls=[];
 globalThis.fetch=async (url, init) => {
  url=new URL(url);calls.push({url,init});
  assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.ok(init.signal);
  if(url.origin==='https://login.microsoftonline.com') {
   const body=new URLSearchParams(init.body);
   assert.equal(body.get('scope'),'https://graph.microsoft.com/.default');assert.equal(body.get('grant_type'),'client_credentials');
   return options.token?.(url,init) || response({access_token:'test-graph-bearer',token_type:'Bearer',expires_in:3600});
  }
  assert.equal(url.origin,'https://graph.microsoft.com');assert.equal(init.headers.Authorization,'Bearer test-graph-bearer');
  if(url.pathname.includes("(appId=")) return options.app?.(url,init) || response({id:resource,appId:clientId,appRoleAssignmentRequired:true});
  return options.page?.(url,init) || response({value:[row()]});
 };return calls;
}
test.afterEach(()=>{globalThis.fetch=originalFetch;});
test('default access is read from the application assignment, not token roles or email',async()=>{
 const calls=mock();const c=config();assert.equal(await entraAssigned(c,aliceOid),true);assert.equal(await entraAssigned(c,bobOid),false);
 assert.equal(calls.length,3,'all session checks share the short application snapshot');assert.equal(calls[1].url.pathname,`/v1.0/servicePrincipals(appId='${clientId}')`);
});
test('pagination is complete, ignoring groups and other services',async()=>{
 mock({page:url=>url.searchParams.has('$skiptoken')?response({value:[row(aliceOid)]}):response({value:[row(bobOid,'Group'),row(bobOid,'ServicePrincipal')],'@odata.nextLink':`https://graph.microsoft.com/v1.0/servicePrincipals/${resource}/appRoleAssignedTo?$skiptoken=2`})});
 const c=config();assert.equal(await entraAssigned(c,aliceOid),true);assert.equal(await entraAssigned(c,bobOid),false);
});
test('every new login forces a fresh assignment read and concurrent checks share one request',async()=>{
 let assigned=true;const calls=mock({page:async()=>{await new Promise(r=>setTimeout(r,10));return response({value:assigned?[row()]:[]});}});const c=config();
 assert.deepEqual(await Promise.all([entraAssigned(c,aliceOid,true),entraAssigned(c,aliceOid,true)]),[true,true]);assert.equal(calls.length,3);
 assigned=false;assert.equal(await entraAssigned(c,aliceOid,true),false);assert.equal(await entraAssigned(c,aliceOid),false);assert.equal(calls.length,5,'token reused but assignment metadata/list refreshed');
});
test('expired cache never grants access when Graph fails; failure clears cached allowance',async()=>{
 const oldNow=Date.now;let now=oldNow();Date.now=()=>now;
 try{let offline=false;const calls=mock({page:()=>offline?response({error:'private-provider-message'},503):response({value:[row()]})});const c=config();
  assert.equal(await entraAssigned(c,aliceOid),true);offline=true;now+=ENTRA_ASSIGNMENT_CACHE_MS+1;
  await assert.rejects(entraAssigned(c,aliceOid),/^Error: Le contrôle/);const count=calls.length;
  await assert.rejects(entraAssigned(c,aliceOid));assert.equal(calls.length,count,'short failure backoff prevents a request storm');
  offline=false;now+=5001;assert.equal(await entraAssigned(c,aliceOid),true);
 }finally{Date.now=oldNow;}
});
test('fresh-check outage clears a still-valid positive cache',async()=>{
 let offline=false;mock({page:()=>offline?response({},403):response({value:[row()]})});const c=config();assert.equal(await entraAssigned(c,aliceOid),true);offline=true;
 await assert.rejects(entraAssigned(c,aliceOid,true));await assert.rejects(entraAssigned(c,aliceOid));
});
test('application and credentials isolate cached permissions',async()=>{
 let assigned=true;mock({page:()=>response({value:assigned?[row()]:[]})});const c=config();assert.equal(await entraAssigned(c,aliceOid),true);assigned=false;
 assert.equal(await entraAssigned({...c,secret:'rotated-secret'},aliceOid),false);
});
test('assignment requirement and exact application identity are required',async()=>{
 for(const app of [{id:resource,appId:clientId,appRoleAssignmentRequired:false},{id:resource,appId:tenant,appRoleAssignmentRequired:true},{id:'invalid',appId:clientId,appRoleAssignmentRequired:true}]) {
  const calls=mock({app:()=>response(app)});await assert.rejects(entraAssigned(config(),aliceOid));assert.equal(calls.length,2);
 }
});
test('pagination cannot exfiltrate a bearer through nextLink',async()=>{
 for(const link of ['https://evil.test/steal',`http://graph.microsoft.com/v1.0/servicePrincipals/${resource}/appRoleAssignedTo`,`https://graph.microsoft.com/v1.0/users`,`https://user:pass@graph.microsoft.com/v1.0/servicePrincipals/${resource}/appRoleAssignedTo`]){
  const calls=mock({page:()=>response({value:[row()],'@odata.nextLink':link})});await assert.rejects(entraAssigned(config(),aliceOid));assert.equal(calls.length,3,'unsafe URL was never fetched');
 }
});
test('a partial page cannot authorize when a later page fails',async()=>{
 mock({page:url=>url.searchParams.has('$skiptoken')?response({},503):response({value:[row()],'@odata.nextLink':`https://graph.microsoft.com/v1.0/servicePrincipals/${resource}/appRoleAssignedTo?$skiptoken=2`})});await assert.rejects(entraAssigned(config(),aliceOid));
});
test('cycles and malformed/wrong-resource assignments fail closed',async()=>{
 for(const value of [null,[row(aliceOid,'Unexpected')],[{...row(),resourceId:tenant}],[{...row(),principalId:'not-a-guid'}]]){
  mock({page:()=>response({value})});await assert.rejects(entraAssigned(config(),aliceOid));
 }
 mock({page:url=>response({value:[row()],'@odata.nextLink':url.href})});await assert.rejects(entraAssigned(config(),aliceOid));
});
test('Graph denial or token errors do not expose upstream content',async()=>{
 for(const token of [response({error:'client_secret=private-secret'},401),response({access_token:'private-token',token_type:'Bearer',expires_in:10}),response({access_token:'private-token',token_type:'Other',expires_in:3600})]){
  const calls=mock({token:()=>token});await assert.rejects(entraAssigned(config(),aliceOid),error=>error.message==='Le contrôle des accès Microsoft est indisponible.');assert.equal(calls.length,1);
 }
});
test('redirects, network failure and oversized body are denied',async()=>{
 for(const page of [()=>{throw new Error('fetch failed with sensitive response');},()=>response({value:[],padding:'x'.repeat(2_000_001)}),()=>new Response('{}',{status:200,headers:{'Content-Type':'text/html'}})]){
  mock({page});await assert.rejects(entraAssigned(config(),aliceOid),error=>!error.message.includes('sensitive'));
 }
});
test('manual mode never contacts Graph',async()=>{
 const calls=mock();await assert.rejects(entraAssigned({...config(),accessMode:'manual'},aliceOid));assert.equal(calls.length,0);
});
