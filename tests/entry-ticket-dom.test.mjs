import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import EntryTicket from '../components/entry-ticket.tsx';
test('entry visibly shows the number and escaped title without confusing title and notes',()=>{const html=renderToStaticMarkup(React.createElement(EntryTicket,{entry:{ticket:'GLPI-1141',ticket_source:'glpi',ticket_title:'RDP <script>alert(1)</script>'}}));assert.match(html,/GLPI-1141/);assert.match(html,/class="ticket-title"/);assert.match(html,/RDP &lt;script&gt;/);assert.doesNotMatch(html,/<script>/);});
test('old entries expose a readable missing title and pending does not repeat its label',()=>{const html=renderToStaticMarkup(React.createElement(EntryTicket,{entry:{ticket:'GLPI-1141',ticket_source:'legacy',ticket_title:null}}));assert.match(html,/Intitulé non disponible/);const pending=renderToStaticMarkup(React.createElement(EntryTicket,{entry:{ticket:'À compléter',ticket_source:'pending'}}));assert.doesNotMatch(pending,/ticket-title/);});
