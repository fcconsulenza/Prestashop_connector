import express from "express";
import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { cfg } from "./config.js";
import { listStores,testStore,products,lowStock,recentOrders,sales } from "./prestashop.js";
import { productChanges, previewProduct, previewStock, previewOrderState, orderStates, applyPreview, discountInput, previewDiscount, listDiscounts } from './write.js';

const app=express();
app.use(express.json({limit:"1mb"}));

function auth(req,res,next){
  if(!cfg.bearer) return res.status(503).json({error:"MCP authentication is not configured"});
  const supplied=req.headers.authorization||"";
  const expected=`Bearer ${cfg.bearer}`;
  const a=Buffer.from(supplied), b=Buffer.from(expected);
  if(a.length!==b.length || !crypto.timingSafeEqual(a,b)) return res.status(401).json({error:"Unauthorized"});
  next();
}
const out=data=>({content:[{type:"text",text:JSON.stringify(data,null,2)}],structuredContent:Array.isArray(data)?{items:data}:data});
const fail=e=>({content:[{type:"text",text:`Error: ${e instanceof Error?e.message:String(e)}`}],isError:true});

function makeServer(){
  const m=new McpServer({name:"fc-ai-prestashop-connector",version:"0.4.0"});
  m.registerTool("prestashop_list_stores",{title:"List PrestaShop stores",description:"List configured FC stores. Read-only.",inputSchema:{}},async()=>out(listStores()));
  m.registerTool("prestashop_test_connection",{title:"Test PrestaShop connection",description:"Test read-only connectivity to a configured store.",inputSchema:{storeId:z.string().min(1)}},async a=>{try{return out(await testStore(a.storeId))}catch(e){return fail(e)}});
  m.registerTool("prestashop_list_products",{title:"List products",description:"Read products from a configured PrestaShop store.",inputSchema:{storeId:z.string().min(1),search:z.string().max(60).optional(),limit:z.number().int().min(1).max(100).default(25)}},async a=>{try{return out(await products(a))}catch(e){return fail(e)}});
  m.registerTool("prestashop_low_stock",{title:"Low stock",description:"Read stock rows at or below a threshold.",inputSchema:{storeId:z.string().min(1),maxQuantity:z.number().int().min(0).max(100000).default(5),limit:z.number().int().min(1).max(100).default(50)}},async a=>{try{return out(await lowStock(a))}catch(e){return fail(e)}});
  m.registerTool("prestashop_recent_orders",{title:"Recent orders",description:"Read order references, totals, states and dates. No customer PII.",inputSchema:{storeId:z.string().min(1),limit:z.number().int().min(1).max(100).default(25)}},async a=>{try{return out(await recentOrders(a))}catch(e){return fail(e)}});
  m.registerTool("prestashop_sales_summary",{title:"Sales summary",description:"Calculate valid-order gross revenue, AOV and FC management fee for a date range.",inputSchema:{storeId:z.string().min(1),from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),to:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}},async a=>{try{return out(await sales(a))}catch(e){return fail(e)}});
  const identity={storeId:z.string().min(1)};
  const recordId=z.number().int().positive().max(2147483647);
  const register=(name,description,inputSchema,fn)=>m.registerTool(name,{description,inputSchema,annotations:{readOnlyHint:name!=='prestashop_apply_preview',destructiveHint:name==='prestashop_apply_preview',idempotentHint:name!=='prestashop_apply_preview',openWorldHint:true}},async a=>{try{return out(await fn(a))}catch(e){return fail(e)}});
  register('prestashop_order_states','Read available order state IDs, labels and workflow flags.',identity,orderStates);
  register('prestashop_list_discounts','Read discount IDs, shop, combination, quantity threshold, reduction and dates for one product.',{...identity,productId:recordId},listDiscounts);
  register('prestashop_preview_product_update','Preview updates to an existing product. Price is tax-exclusive. Localized content requires languageId. Does not write.',{...identity,productId:recordId,languageId:recordId.optional(),changes:productChanges},previewProduct);
  register('prestashop_preview_stock_update','Preview an absolute stock quantity for a stock_availables row, including a combination-specific row. Does not write.',{...identity,stockId:recordId,quantity:z.number().int().min(0).max(2147483647)},previewStock);
  register('prestashop_preview_discount','Preview a product discount for all customers in one explicit shop. Percentage uses 0-100; amount requires currencyId and is tax-inclusive. No dates means no expiration. Existing discounts require an explicit specificPriceId; reduction=0 neutralizes that discount. Does not write.',discountInput,previewDiscount);
  register('prestashop_preview_order_state','Preview an order-state transition. State hooks may change invoices, stock and integrations; customer email is not requested. Does not write.',{...identity,orderId:recordId,stateId:recordId},previewOrderState);
  register('prestashop_apply_preview','Apply exactly one signed preview only after the user explicitly approves its store, record, before/after values and effects. Never infer approval from a general request to configure writing. Token expires in 10 minutes. Re-reads before and verifies after; never automatically retry an uncertain outcome.',{previewToken:z.string().max(200000),confirm:z.literal(true)},applyPreview);
  return m;
}
app.get("/health",(_q,r)=>r.json({ok:true,service:"fc-ai-prestashop-connector",version:"0.4.0",mode:"scoped-writes"}));
app.post("/mcp",auth,async(req,res)=>{
  const method=String(req.body?.method||"").replace(/[^a-zA-Z0-9_/.]/g,"").slice(0,60);
  res.on("finish",()=>console.log(JSON.stringify({event:"mcp_request",method,status:res.statusCode})));
  const m=makeServer();
  const t=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  try{await m.connect(t);await t.handleRequest(req,res,req.body)}
  catch(e){if(!res.headersSent)res.status(500).json({error:"MCP request failed"})}
  finally{await t.close().catch(()=>{});await m.close().catch(()=>{})}
});
app.all("/mcp",auth,(_q,r)=>r.status(405).json({error:"Use POST for this stateless MCP endpoint"}));
app.listen(cfg.port,"0.0.0.0",()=>console.log(`FC AI Connector listening on ${cfg.port}`));
