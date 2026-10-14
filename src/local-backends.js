import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { stores,cfg } from './config.js';
import { listStores,testStore,products,lowStock,recentOrders,sales,orderContent,findBarcode } from './prestashop.js';
import { orderStates,listDiscounts,productChanges,previewProduct,previewStock,previewOrderState,discountInput,previewDiscount,applyPreview } from './write.js';

const privateDir=path.join(os.homedir(),'.codex','private','ecommerce-connections');
const adapter=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../output/siteground-connect/ssh_api.py');
const python=process.env.FC_BACKENDS_PYTHON;
if(!python) throw new Error('Local Python runtime is not configured');
for(const store of stores){
  const account=JSON.parse(await fs.readFile(path.join(privateDir,store.id+'.json'),'utf8'));
  if(account.store_id!==store.id || !account.ok) throw new Error('Unverified backend account');
  process.env[store.keyEnv]=account.key;
}
const signingFile=path.join(privateDir,'preview-signing.key');
try { await fs.writeFile(signingFile,crypto.randomBytes(32).toString('hex'),{flag:'wx',mode:0o600}); } catch(error) { if(error.code!=='EEXIST') throw error; }
cfg.bearer=(await fs.readFile(signingFile,'utf8')).trim();
const enabled=[];
for(const store of stores){const account=JSON.parse(await fs.readFile(path.join(privateDir,store.id+'.json'),'utf8'));if(account.write_enabled)enabled.push(store.id);}
process.env.PS_WRITE_STORES=enabled.join(',');
const resources=new Set(['products','stock_availables','orders','order_states','specific_prices']);
globalThis.fetch=async function(input,options={}){
  const url=new URL(input);
  const store=stores.find(s=>new URL(s.baseUrl).hostname===url.hostname);
  const route=url.pathname.match(/^\/api\/([a-z_]+)(?:\/(\d+))?$/);
  const resource=route?.[1],method=options.method||'GET';
  const allowed=method==='GET'?resources:method==='PATCH'?new Set(['products','stock_availables','specific_prices']):method==='POST'?new Set(['specific_prices','order_histories']):new Set();
  if(!store || !allowed.has(resource) || (method==='PATCH' && !route[2]) || (method==='POST' && route[2])) throw new Error('Request outside local backend scope');
  const request={store_id:store.id,resource,method,params:Object.fromEntries(url.searchParams),raw_response:true};
  if(route[2])request.id=Number(route[2]);
  if(options.body)request.body=options.body;
  const data=await new Promise((resolve,reject)=>{
    const child=spawn(python,[adapter],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='';
    const timer=setTimeout(()=>{child.kill();reject(new Error('Backend read timed out'));},50000);
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>2_000_000){child.kill();reject(new Error('Backend response exceeded the limit'));}});
    child.stderr.on('data',()=>{});
    child.on('error',()=>{clearTimeout(timer);reject(new Error('Local backend adapter could not start'));});
    child.on('close',code=>{
      clearTimeout(timer);
      try{const parsed=JSON.parse(output);if(code!==0 || parsed.error)reject(new Error('Backend read failed'));else resolve(parsed);}catch{reject(new Error('Invalid local backend response'));}
    });
    child.stdin.end(JSON.stringify(request));
  });
  return new Response(data.status===204?null:data.body,{status:data.status,headers:{'content-type':'application/json'}});
};

const server=new McpServer({name:'fc-ecommerce-backends-local',version:'1.1.0'});
const out=data=>({content:[{type:'text',text:JSON.stringify(data,null,2)}],structuredContent:Array.isArray(data)?{items:data}:data});
const handler=fn=>async args=>{try{return out(await fn(args));}catch(error){return {content:[{type:'text',text:'Error: '+error.message}],isError:true};}};
const annotations={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
const register=(name,title,description,inputSchema,fn)=>server.registerTool(name,{title,description,inputSchema,annotations:{...annotations,readOnlyHint:name!=='prestashop_apply_preview',destructiveHint:name==='prestashop_apply_preview',idempotentHint:name!=='prestashop_apply_preview'}},handler(fn));
register('prestashop_list_stores','E-commerce backends','List locally configured PrestaShop backends and writing availability.',{},()=>listStores());
register('prestashop_test_connection','Test backend','Test backend API access through encrypted SSH. Read-only.',{storeId:z.string()},a=>testStore(a.storeId));
register('prestashop_find_barcode','Find barcode','Find an exact EAN/UPC in base products. Excludes combination-specific codes. Read-only.',{storeId:z.string().min(1),barcode:z.string().regex(/^(?:\d{8}|\d{12}|\d{13})$/)},findBarcode);
register('prestashop_list_products','Products','Read product IDs, references, prices and publication status. Read-only.',{storeId:z.string(),search:z.string().max(60).optional(),limit:z.number().int().min(1).max(100).default(25)},products);
register('prestashop_low_stock','Stock','Read stock quantities and combination IDs. Read-only.',{storeId:z.string(),maxQuantity:z.number().int().min(0).max(100000).default(5),limit:z.number().int().min(1).max(100).default(50)},lowStock);
register('prestashop_recent_orders','Orders','Read order references, totals, states and dates. Excludes customer personal data.',{storeId:z.string(),limit:z.number().int().min(1).max(100).default(25)},recentOrders);
register('prestashop_sales_summary','Sales','Summarize valid-order revenue for a date range. Read-only.',{storeId:z.string(),from:z.string(),to:z.string()},sales);
register('prestashop_order_content','Order content','Read products, quantities and prices for one order; no customer personal fields.',{storeId:z.string(),orderId:z.number().int().positive()},orderContent);
register('prestashop_order_states','Order states','Read the available order states. Read-only.',{storeId:z.string()},orderStates);
register('prestashop_list_discounts','Discounts','Read discounts for one product. Read-only.',{storeId:z.string(),productId:z.number().int().positive()},listDiscounts);
const identity={storeId:z.string().min(1)},recordId=z.number().int().positive().max(2147483647);
register('prestashop_preview_product_update','Preview product update','Preview existing product changes. Price is tax-exclusive; localized content requires languageId. Does not write.',{...identity,productId:recordId,languageId:recordId.optional(),changes:productChanges},previewProduct);
register('prestashop_preview_stock_update','Preview stock update','Preview an absolute stock quantity for a stock row or combination. Does not write.',{...identity,stockId:recordId,quantity:z.number().int().min(0).max(2147483647)},previewStock);
register('prestashop_preview_discount','Preview discount','Preview a discount for all customers in one explicit shop. Percentage is 0-100; amount requires currencyId. Existing discounts require specificPriceId. Does not write.',discountInput,previewDiscount);
register('prestashop_preview_order_state','Preview order transition','Preview order state changes. Hooks can change invoices, stock and integrations. Customer email is not requested. Does not write.',{...identity,orderId:recordId,stateId:recordId},previewOrderState);
register('prestashop_apply_preview','Apply approved preview','Apply exactly one signed preview only after the user explicitly approves the store, record, before/after values and effects. Never infer approval from configuring writing. Token expires after 10 minutes. Re-reads before and verifies after; never automatically retry uncertain results.',{previewToken:z.string().max(200000),confirm:z.literal(true)},applyPreview);
await server.connect(new StdioServerTransport());
