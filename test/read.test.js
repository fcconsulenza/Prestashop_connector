import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { products, recentOrders, testStore } from '../src/prestashop.js';

test('canonical API, JSON headers, safe errors and order PII allowlist', async () => {
  const original=global.fetch;
  process.env.PS_KEY_ADIPIETRO='test-key';
  try {
    global.fetch=async (url,options)=>{
      assert.equal(url.hostname,'adipietro.it');
      assert.equal(options.redirect,'manual');
      assert.equal(options.headers['Output-Format'],'JSON');
      return new Response(JSON.stringify({orders:[{id:'1',reference:'ABC',total_paid_tax_incl:'100',id_customer:'SECRET',email:'SECRET',current_state:'2',valid:'1'}]}));
    };
    const orders=await recentOrders({storeId:'adipietro',limit:5});
    assert.equal(orders[0].total_paid_tax_incl,100);
    assert.ok(!JSON.stringify(orders).includes('SECRET'));
    global.fetch=async()=>new Response('SECRET customer data',{status:401});
    await assert.rejects(testStore('adipietro'),/^Error: PrestaShop HTTP 401 for products$/);
    global.fetch=async()=>new Response('',{status:302,headers:{location:'https://example.com'}});
    await assert.rejects(testStore('adipietro'),/redirects the API/);
    global.fetch=async()=>new Response(JSON.stringify({products:[{id:3,price:'12.34',reference:'SKU',active:'1'}]}));
    assert.equal((await products({storeId:'adipietro',limit:5}))[0].price_tax_excl,12.34);
  } finally {global.fetch=original;delete process.env.PS_KEY_ADIPIETRO;}
});

test('real MCP transport: auth, handshake, six tools, object structuredContent', async () => {
  const child=spawn(process.execPath,['src/server.js'],{env:{...process.env,PORT:'31983',MCP_BEARER_TOKEN:'local-test-only'}});
  const exited=once(child,'exit');
  try {
    await Promise.race([once(child.stdout,'data'),new Promise((_,reject)=>setTimeout(()=>reject(new Error('startup timeout')),10000))]);
    const denied=await fetch('http://127.0.0.1:31983/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(denied.status,401);
    const client=new Client({name:'verification',version:'1'});
    await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:31983/mcp'),{requestInit:{headers:{Authorization:'Bearer local-test-only'}}}));
    assert.equal((await client.listTools()).tools.length,6);
    const result=await client.callTool({name:'prestashop_list_stores',arguments:{}});
    assert.ok(Array.isArray(result.structuredContent.items));
    assert.equal(result.structuredContent.items[0].id,'adipietro');
    await client.close();
  } finally {child.kill();await exited;}
});
