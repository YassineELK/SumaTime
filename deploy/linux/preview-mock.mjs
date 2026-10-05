import { DatabaseSync } from 'node:sqlite';
import { mockGlpi } from './glpi-mock.mjs';
if(process.env.DATABASE_PATH!=='/var/lib/sumatime-preview/timesheet.sqlite')throw new Error('Preview database required');
const db=new DatabaseSync(process.env.DATABASE_PATH,{readOnly:true});
const entities=db.prepare('SELECT glpi_entity_id FROM clients WHERE glpi_entity_id IS NOT NULL').all().map(x=>Number(x.glpi_entity_id));db.close();
await mockGlpi(8792,entities.length?entities:[4,9]);
console.log('Simulated GLPI listening on loopback:8792; no real GLPI connection.');
