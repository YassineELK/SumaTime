import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
export async function mockGlpi(port=8790) {
  const sessions=new Map(),calls=[];
  const tickets=Array.from({length:13},(_,i)=>({id:101+i,name:i===0?'Configurer le VPN du nouveau collaborateur':i===1?'Diagnostic réseau — agence Bruxelles':i===2?'Installation du poste et accès Microsoft 365':'Intervention de démonstration '+(i+1),status:i===2?5:i%4+1,entities_id:i===1?9:4}));
  const server=createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');const path=url.pathname.replace('/apirest.php/','');
    calls.push({path,method:req.method,user:sessions.get(req.headers['session-token'])||null,query:url.search});
    const send=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    if(req.method!=='GET')return send(405,{error:'Read only'});
    if(req.headers['app-token']!=='mock-app-token')return send(403,['BAD_APP_TOKEN','secret should never leak']);
    if(path==='initSession'){
      const token=req.headers.authorization?.replace('user_token ','');
      if(!['alice-test-token','bob-test-token','admin-test-token','broken-test-token','redirect-test-token','slow-test-token'].includes(token))return send(401,['BAD_TOKEN','secret should never leak']);
      const session=randomUUID();sessions.set(session,token);return send(200,{session_token:session});
    }
    const user=sessions.get(req.headers['session-token']);if(!user)return send(401,['SESSION_EXPIRED']);
    if(path==='killSession'){sessions.delete(req.headers['session-token']);return send(200,true);}
    if(path==='getMyProfiles')return send(200,{myprofiles:[{id:1,name:'Technicien'}]});
    if(user==='redirect-test-token'){res.writeHead(302,{Location:'http://127.0.0.1:8791/leak'});return res.end();}
    if(user==='slow-test-token'){const timer=setTimeout(()=>send(200,{}),20000);res.on('close',()=>clearTimeout(timer));return;}
    if(path==='listSearchOptions/Ticket')return send(200,{2:{table:'glpi_tickets',field:'id'},1:{table:'glpi_tickets',field:'name'},12:{table:'glpi_tickets',field:'status'}});
    const permitted=tickets.filter(t=>user!=='bob-test-token'||t.id===102);
    if(path==='search/Ticket'){
      if(user==='broken-test-token')return send(200,{oops:'unexpected'});
      let selected=permitted;
      for(let i=0;i<2;i++){const field=url.searchParams.get(`criteria[${i}][field]`),value=url.searchParams.get(`criteria[${i}][value]`);if(field==='12')selected=selected.filter(t=>t.status<5);if(field==='1')selected=selected.filter(t=>t.name.toLowerCase().includes(value.toLowerCase()));if(field==='2')selected=selected.filter(t=>String(t.id)===value.replaceAll('^','').replaceAll('$',''));}
      const offset=Number((url.searchParams.get('range')||'0-9').split('-')[0]);
      return send(200,{totalcount:selected.length,data:selected.slice(offset,offset+10).map(t=>({'2':t.id}))});
    }
    if(path.startsWith('Ticket/')){const ticket=permitted.find(t=>t.id===Number(path.split('/')[1]));return ticket?send(200,ticket):send(403,['FORBIDDEN']);}
    send(404,{error:'Unknown mock API'});
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));return {server,sessions,calls};
}
