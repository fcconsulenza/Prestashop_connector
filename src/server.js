import express from "express";
import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { cfg } from "./config.js";
import { listStores,testStore,products,lowStock,recentOrders,sales } from "./prestashop.js";

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
const out=data=>({content:[{type:"text",text:JSON.stringify(data,null,2)}],structuredContent:data});
const fail=e=>({content:[{type:"text",text:`Error: ${e instanceof Error?e.message:String(e)}`}],isError:true});

function makeServer(){
  const m=new McpServer({name:"fc-ai-prestashop-connector",version:"0.3.0"});
  m.registerTool("prestashop_list_stores",{title:"List PrestaShop stores",description:"List configured FC stores. Read-only.",inputSchema:{}},async()=>out(listStores()));
  m.registerTool("prestashop_test_connection",{title:"Test PrestaShop connection",description:"Test read-only connectivity to a configured store.",inputSchema:{storeId:z.string().min(1)}},async a=>{try{return out(await testStore(a.storeId))}catch(e){return fail(e)}});
  m.registerTool("prestashop_list_products",{title:"List products",description:"Read products from a configured PrestaShop store.",inputSchema:{storeId:z.string().min(1),search:z.string().max(60).optional(),limit:z.number().int().min(1).max(100).default(25)}},async a=>{try{return out(await products(a))}catch(e){return fail(e)}});
  m.registerTool("prestashop_low_stock",{title:"Low stock",description:"Read stock rows at or below a threshold.",inputSchema:{storeId:z.string().min(1),maxQuantity:z.number().int().min(0).max(100000).default(5),limit:z.number().int().min(1).max(100).default(50)}},async a=>{try{return out(await lowStock(a))}catch(e){return fail(e)}});
  m.registerTool("prestashop_recent_orders",{title:"Recent orders",description:"Read order references, totals, states and dates. No customer PII.",inputSchema:{storeId:z.string().min(1),limit:z.number().int().min(1).max(100).default(25)}},async a=>{try{return out(await recentOrders(a))}catch(e){return fail(e)}});
  m.registerTool("prestashop_sales_summary",{title:"Sales summary",description:"Calculate valid-order gross revenue, AOV and FC management fee for a date range.",inputSchema:{storeId:z.string().min(1),from:z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/),to:z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/)}},async a=>{try{return out(await sales(a))}catch(e){return fail(e)}});
  return m;
}
app.get("/health",(_q,r)=>r.json({ok:true,service:"fc-ai-prestashop-connector",version:"0.3.0",mode:"read-only"}));
app.post("/mcp",auth,async(req,res)=>{
  const m=makeServer();
  const t=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  try{await m.connect(t);await t.handleRequest(req,res,req.body)}
  catch(e){if(!res.headersSent)res.status(500).json({error:"MCP request failed"})}
  finally{await t.close().catch(()=>{});await m.close().catch(()=>{})}
});
app.all("/mcp",auth,(_q,r)=>r.status(405).json({error:"Use POST for this stateless MCP endpoint"}));
app.listen(cfg.port,"0.0.0.0",()=>console.log(`FC AI Connector listening on ${cfg.port}`));
