import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
test('MCP authentication, schema discovery and invalid input with synthetic credentials', {timeout:15000},async()=>{
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const child=spawn(process.execPath,['src/server.js'],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,PATH:path.dirname(process.execPath),PORT:String(port),MCP_BEARER_TOKEN:'synthetic-fixture-only-token'},stdio:'ignore'});
 const url='http://127.0.0.1:'+port;
 try{
  let ready=false;for(let i=0;i<80;i++){try{if((await fetch(url+'/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,75));}assert.ok(ready,'Server startup');
  const rpc=(body,token)=>fetch(url+'/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
  assert.equal((await rpc({jsonrpc:'2.0',id:1,method:'tools/list'})).status,401);
  assert.equal((await rpc({jsonrpc:'2.0',id:2,method:'tools/list'},'invalid-fixture')).status,401);
  const discovered=await rpc({jsonrpc:'2.0',id:3,method:'tools/list'},'synthetic-fixture-only-token');assert.equal(discovered.status,200);const tools=(await discovered.json()).result.tools;assert.ok(tools.length>=10);assert.ok(tools.find(t=>t.name==='prestashop_apply_preview'));
  const bad=await rpc({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'prestashop_list_products',arguments:{storeId:12}}},'synthetic-fixture-only-token');const rejected=await bad.json();assert.ok(rejected.error||rejected.result?.isError,'Schema must reject invalid store identity');
 }finally{child.kill();await new Promise(r=>child.once('exit',r));}
});
