import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { products, recentOrders, testStore, orderContent, sales } from '../src/prestashop.js';

test('canonical API, JSON headers, safe errors and order PII allowlist', async () => {
  const original=global.fetch;
  process.env.PS_KEY_ADIPIETRO='test-key';
  try {
    global.fetch=async (url,options)=>{
      assert.equal(url.hostname,'adipietro.it');
      assert.equal(options.redirect,'manual');
      assert.equal(options.headers['Output-Format'],'JSON');
      assert.equal(url.searchParams.get('date'),'1');
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
    global.fetch=async()=>new Response('[]');
    assert.deepEqual(await products({storeId:'adipietro',limit:5}),[]);
    assert.deepEqual(await testStore('adipietro'),{ok:true,store_id:'adipietro'});
  } finally {global.fetch=original;delete process.env.PS_KEY_ADIPIETRO;}
});

test('real MCP transport: auth, handshake, fourteen tools, object structuredContent', async () => {
  const child=spawn(process.execPath,['src/server.js'],{env:{...process.env,PORT:'31983',MCP_BEARER_TOKEN:'local-test-only'}});
  const exited=once(child,'exit');
  try {
    await Promise.race([once(child.stdout,'data'),new Promise((_,reject)=>setTimeout(()=>reject(new Error('startup timeout')),10000))]);
    const denied=await fetch('http://127.0.0.1:31983/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(denied.status,401);
    const client=new Client({name:'verification',version:'1'});
    await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:31983/mcp'),{requestInit:{headers:{Authorization:'Bearer local-test-only'}}}));
    const tools=(await client.listTools()).tools;
    assert.equal(tools.length,14);
    assert.equal(tools.find(t=>t.name==='prestashop_apply_preview').annotations.readOnlyHint,false);
    const result=await client.callTool({name:'prestashop_list_stores',arguments:{}});
    assert.ok(Array.isArray(result.structuredContent.items));
    assert.equal(result.structuredContent.items[0].id,'adipietro');
    await client.close();
  } finally {child.kill();await exited;}
});

test('localized names, textual EAN, filtered order lines and daily sums including empty days',async()=>{
 const original=global.fetch;process.env.PS_KEY_ADIPIETRO='fake';
 try{
  global.fetch=async()=>Response.json({products:[{id:1,name:[{id:2,value:'Other'},{id:1,value:'Italiano'}],ean13:'0123456789012'}]});
  const p=(await products({storeId:'adipietro'}))[0];assert.equal(p.name,'Italiano');assert.equal(p.ean13,'0123456789012');
  global.fetch=async()=>Response.json({orders:[{id:4,id_customer:'SECRET',note:'SECRET',associations:{order_rows:[{product_id:2,product_name:'Item',product_ean13:'0123456789012',product_quantity:3,unit_price_tax_incl:'5',email:'SECRET'}]}}]});
  const o=await orderContent({storeId:'adipietro',orderId:4});assert.equal(o.items[0].quantity,3);assert.ok(!JSON.stringify(o).includes('SECRET'));
  global.fetch=async()=>Response.json({orders:[{id:1,date_add:'2026-10-05 11:00:00',valid:'1',total_paid_tax_incl:'10.25'},{id:2,date_add:'2026-10-05 12:00:00',valid:'1',total_paid_tax_incl:'1.75'},{id:3,date_add:'2026-10-06 12:00:00',valid:'0',total_paid_tax_incl:'999'}]});
  const result=await sales({storeId:'adipietro',from:'2026-10-05',to:'2026-10-06'});
  assert.deepEqual(result.daily,[{date:'2026-10-05',orders:2,revenue_tax_incl:12},{date:'2026-10-06',orders:0,revenue_tax_incl:0}]);assert.equal(result.revenue_tax_incl,12);
 }finally{global.fetch=original;delete process.env.PS_KEY_ADIPIETRO;}
});

