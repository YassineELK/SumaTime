import test from 'node:test';
import assert from 'node:assert/strict';
import { entraConfiguration, entraGuid, entraStatus } from '../lib/entra-config.ts';
import { tenant, clientId } from './entra-mock.mjs';
const original = {...process.env};
function configure(overrides={}){Object.assign(process.env,{ENTRA_ENABLED:'true',ENTRA_TENANT_ID:tenant,ENTRA_CLIENT_ID:clientId,ENTRA_CLIENT_SECRET:'dummy-only',APP_URL:'https://dev.example.test',ENTRA_SESSION_MINUTES:'60'},overrides);}
test('Entra is optional and rejects insecure or ambiguous configuration',()=>{
 try{
  process.env.ENTRA_ENABLED='false';assert.equal(entraConfiguration(),null);assert.equal(entraStatus(),'disabled');
  configure();const c=entraConfiguration();assert.equal(c.redirectUri,'https://dev.example.test/api/auth/entra/callback');assert.equal(c.sessionSeconds,3600);
  assert.equal(entraGuid(tenant.toUpperCase()),tenant);
  for(const APP_URL of ['http://internal.example.test','https://u:secret@example.test','https://example.test/prefix','https://example.test/?next=evil','ftp://127.0.0.1']){configure({APP_URL});assert.throws(entraConfiguration);assert.equal(entraStatus(),'incomplete');}
  configure({APP_URL:'http://localhost:5173'});assert.equal(entraStatus(),'ready');
  for(const value of ['common','organizations','consumers','../other']){configure({ENTRA_TENANT_ID:value});assert.throws(entraConfiguration);}
  for(const value of ['0','14','241','1.5','NaN']){configure({ENTRA_SESSION_MINUTES:value});assert.throws(entraConfiguration);}
  configure({ENTRA_CLIENT_SECRET:''});assert.equal(entraStatus(),'incomplete');
 }finally{process.env=original;}
});
