import { cfg, getStore, stores } from "./config.js";

const val = v => {
  if (v == null) return v;
  if (typeof v === "object" && "#text" in v) return v["#text"];
  return v;
};
const arr = (o,k) => !o?.[k] ? [] : Array.isArray(o[k]) ? o[k] : [o[k]];

async function psGet(storeId, resource, params={}) {
  const s=getStore(storeId);
  const url=new URL(`${s.baseUrl}/api/${resource}`);
  url.searchParams.set("output_format","JSON");
  for (const [k,v] of Object.entries(params)) if(v!==undefined && v!==null) url.searchParams.set(k,String(v));
  const auth=Buffer.from(`${s.apiKey}:`).toString("base64");
  const r=await fetch(url,{headers:{Authorization:`Basic ${auth}`,Accept:"application/json","Output-Format":"JSON","User-Agent":"FC-AI-Connector/0.3.1"},redirect:"manual",signal:AbortSignal.timeout(15000)});
  const t=await r.text();
  if(r.status>=300 && r.status<400) throw new Error(`PrestaShop redirects the API (HTTP ${r.status}); configure the canonical store URL`);
  if(!r.ok) throw new Error(`PrestaShop HTTP ${r.status} for ${resource}`);
  if(!t.trim()) throw new Error(`PrestaShop returned an empty response for ${resource}`);
  let data;
  try{data=JSON.parse(t)}catch{throw new Error(`PrestaShop returned non-JSON data for ${resource} (HTTP ${r.status}; content-type ${r.headers.get("content-type")||"unknown"})`)}
  if(data.errors) throw new Error(`PrestaShop returned API errors for ${resource}`);
  if(!data[resource]) throw new Error(`PrestaShop response is missing ${resource}`);
  return data;
}

export function listStores(){
  return stores.map(s=>({id:s.id,name:s.name,base_url:s.baseUrl,configured:Boolean(process.env[s.keyEnv]),mode:"read-only",management_fee_percent:s.fee}));
}

export async function testStore(storeId){
  await psGet(storeId,"products",{display:"[id]",limit:"0,1"});
  return {ok:true,store_id:storeId};
}

export async function products({storeId,search,limit=25}){
  const p={display:"[id,reference,ean13,price,active,date_upd]",sort:"[id_DESC]",limit:`0,${Math.min(limit,cfg.maxPage)}`};
  if(search) p["filter[name]"]=`%[${String(search).slice(0,60)}]%`;
  const d=await psGet(storeId,"products",p);
  return arr(d,"products").map(x=>({id:Number(val(x.id)),reference:val(x.reference)||"",ean13:val(x.ean13)||"",price_tax_excl:Number(val(x.price)||0),active:String(val(x.active))==="1",updated_at:val(x.date_upd)||null}));
}

export async function lowStock({storeId,maxQuantity=5,limit=50}){
  const d=await psGet(storeId,"stock_availables",{display:"[id,id_product,id_product_attribute,quantity,out_of_stock]","filter[quantity]":`[0,${Number(maxQuantity)}]`,sort:"[quantity_ASC]",limit:`0,${Math.min(limit,cfg.maxPage)}`});
  return arr(d,"stock_availables").map(x=>({stock_id:Number(val(x.id)),product_id:Number(val(x.id_product)),combination_id:Number(val(x.id_product_attribute)||0),quantity:Number(val(x.quantity)||0),out_of_stock_behavior:Number(val(x.out_of_stock)||0)}));
}

export async function recentOrders({storeId,limit=25}){
  const d=await psGet(storeId,"orders",{display:"[id,reference,total_paid_tax_incl,current_state,date_add,date_upd,valid]",sort:"[date_add_DESC]",limit:`0,${Math.min(limit,cfg.maxPage)}`});
  return arr(d,"orders").map(x=>({id:Number(val(x.id)),reference:val(x.reference)||"",total_paid_tax_incl:Number(val(x.total_paid_tax_incl)||0),state_id:Number(val(x.current_state)||0),valid:String(val(x.valid))==="1",created_at:val(x.date_add)||null,updated_at:val(x.date_upd)||null}));
}

export async function sales({storeId,from,to}){
  const s=getStore(storeId);
  const start=new Date(`${from}T00:00:00`), end=new Date(`${to}T23:59:59`);
  if(Number.isNaN(+start)||Number.isNaN(+end)||start>end) throw new Error("Invalid date range");
  let offset=0, scanned=0, matched=[];
  const size=Math.min(cfg.maxPage,100);
  while(scanned<cfg.maxOrders){
    const d=await psGet(storeId,"orders",{display:"[id,reference,total_paid_tax_incl,current_state,date_add,valid]",sort:"[date_add_DESC]",limit:`${offset},${size}`});
    const batch=arr(d,"orders"); if(!batch.length) break;
    for(const x of batch){
      scanned++;
      const dt=new Date(String(val(x.date_add)).replace(" ","T"));
      if(dt>=start&&dt<=end&&String(val(x.valid))==="1") matched.push({id:Number(val(x.id)),total:Number(val(x.total_paid_tax_incl)||0)});
    }
    const oldest=new Date(String(val(batch.at(-1)?.date_add)).replace(" ","T"));
    if(oldest<start||batch.length<size) break;
    offset+=size;
  }
  const revenue=matched.reduce((a,x)=>a+x.total,0);
  return {store_id:s.id,store_name:s.name,from,to,orders:matched.length,revenue_tax_incl:+revenue.toFixed(2),average_order_value:+(matched.length?revenue/matched.length:0).toFixed(2),management_fee_percent:s.fee,management_fee_amount:+(revenue*s.fee/100).toFixed(2),scan_limit_reached:scanned>=cfg.maxOrders};
}
