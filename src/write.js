import crypto from 'node:crypto';
import { z } from 'zod';
import { cfg, getStore } from './config.js';
import { psGet } from './prestashop.js';

const id = z.number().int().positive().max(2147483647);
const decimal = z.number().finite().min(0).max(100000000);
export const productChanges = z.object({
  price: decimal.optional(), active: z.boolean().optional(),
  reference: z.string().max(64).optional(), ean13: z.string().regex(/^\d{0,13}$/).optional(),
  weight: decimal.optional(), name: z.string().min(1).max(128).optional(),
  description: z.string().max(50000).optional(), description_short: z.string().max(800).optional(),
  meta_title: z.string().max(128).optional(), meta_description: z.string().max(512).optional()
}).strict().refine(x => Object.keys(x).length > 0, 'Provide at least one field');
const languageFields = new Set(['name','description','description_short','meta_title','meta_description']);
const scalar = v => typeof v === 'object' && v !== null ? v['#text'] ?? v.value ?? '' : v ?? '';
const escape = v => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const used = new Map();
const pending = new Set();
const discountFields=['id_product','id_shop','id_shop_group','id_currency','id_country','id_group','id_customer','id_product_attribute','id_cart','price','from_quantity','reduction','reduction_tax','reduction_type','from','to'];
const dateTime=z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/).refine(v=>Number.isFinite(Date.parse(v.replace(' ','T'))),'Invalid date');
export const discountInput={storeId:z.string().min(1),productId:id,shopId:id,specificPriceId:id.optional(),
  reductionType:z.enum(['percentage','amount']),reduction:decimal,
  currencyId:z.number().int().min(0).max(2147483647).default(0),from:dateTime.optional(),to:dateTime.optional()};

export function writeEnabled(storeId) {
  return (process.env.PS_WRITE_STORES || '').split(',').map(s=>s.trim()).includes(storeId);
}
function requireWrite(storeId) {
  getStore(storeId);
  if (!writeEnabled(storeId)) throw new Error('Writing is disabled for this store; configure PS_WRITE_STORES and the dedicated key permissions');
}
function signingKey() {
  if (!cfg.bearer) throw new Error('MCP authentication is not configured');
  return cfg.bearer;
}
function sign(plan) {
  const payload = Buffer.from(JSON.stringify(plan)).toString('base64url');
  return `${payload}.${crypto.createHmac('sha256', signingKey()).update(payload).digest('base64url')}`;
}
function decode(token) {
  if (typeof token !== 'string' || token.length > 200000) throw new Error('Invalid preview token');
  const [payload,mac,extra] = token.split('.');
  const expected = crypto.createHmac('sha256', signingKey()).update(payload || '').digest('base64url');
  if (extra || !mac || mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac),Buffer.from(expected))) throw new Error('Invalid preview token');
  let p;
  try { p=JSON.parse(Buffer.from(payload,'base64url').toString()); } catch { throw new Error('Invalid preview token'); }
  if (p.expiresAt < Date.now()) throw new Error('Preview expired; generate a new preview');
  return p;
}
async function record(storeId,resource,recordId,fields) {
  const data=await psGet(storeId,resource,{'filter[id]':`[${recordId}]`,display:`[id,${fields.join(',')}]`,limit:'0,1'});
  const rows=Array.isArray(data[resource])?data[resource]:[data[resource]];
  const row=rows.find(r=>Number(scalar(r?.id))===recordId);
  if (!row) throw new Error('Requested record was not found');
  return row;
}
function value(row,field,languageId) {
  if (languageFields.has(field)) {
    let languages=row[field]?.language ?? row[field];
    if (!Array.isArray(languages)) languages=languages ? [languages] : [];
    const language=languages.find(l=>Number(l.id ?? l['@attributes']?.id)===languageId);
    if (!language) throw new Error(`Language ${languageId} was not found for ${field}`);
    return String(scalar(language));
  }
  if (field==='active') return String(scalar(row[field]))==='1';
  if (['price','weight','quantity','current_state','reduction','reduction_tax','from_quantity'].includes(field)||field.startsWith('id_')) return Number(scalar(row[field]));
  return String(scalar(row[field]));
}
async function readBefore(plan) {
  if (plan.resource==='specific_prices' && plan.create) {
    const data=await psGet(plan.storeId,'specific_prices',{'filter[id_product]':`[${plan.changes.id_product}]`,display:'[id]',limit:'0,1'});
    return {existing: (Array.isArray(data.specific_prices)?data.specific_prices:[data.specific_prices]).filter(Boolean).map(r=>Number(scalar(r.id)))};
  }
  const fields=Object.keys(plan.changes);
  const row=await record(plan.storeId,plan.resource,plan.id,fields);
  return Object.fromEntries(fields.map(f=>[f,value(row,f,plan.languageId)]));
}
function preview(plan) {
  if (JSON.stringify(plan.before)===JSON.stringify(plan.changes)) return {changed:false,store_id:plan.storeId,record_id:plan.id};
  plan.expiresAt=Date.now()+10*60*1000;
  plan.nonce=crypto.randomUUID();
  return {changed:true,store_id:plan.storeId,resource:plan.resource,record_id:plan.id,before:plan.before,after:plan.changes,
    language_id:plan.languageId ?? null,order_state:plan.state ?? null,
    effects:plan.resource==='orders'?'Order-state hooks may change stock, invoices and integrations. No customer email is requested.':'Updates existing record fields only.',
    expires_at:new Date(plan.expiresAt).toISOString(),preview_token:sign(plan)};
}
export async function previewProduct({storeId,productId,changes,languageId}) {
  requireWrite(storeId); id.parse(productId); changes=productChanges.parse(changes);
  if (Object.keys(changes).some(f=>languageFields.has(f))) id.parse(languageId);
  const p={storeId,resource:'products',id:productId,changes,languageId};
  p.before=await readBefore(p);
  return preview(p);
}
export async function previewStock({storeId,stockId,quantity}) {
  requireWrite(storeId); id.parse(stockId); z.number().int().min(0).max(2147483647).parse(quantity);
  const p={storeId,resource:'stock_availables',id:stockId,changes:{quantity}};
  const row=await record(storeId,'stock_availables',stockId,['quantity','depends_on_stock']);
  if (String(scalar(row.depends_on_stock))==='1') throw new Error('Stock depends on advanced warehouse management; direct quantity changes are disabled');
  p.before={quantity:value(row,'quantity')};
  return preview(p);
}
export async function orderStates({storeId}) {
  const data=await psGet(storeId,'order_states',{display:'[id,name,invoice,delivery,paid,logable,shipped,send_email]',limit:'0,250'});
  const rows=Array.isArray(data.order_states)?data.order_states:[data.order_states];
  return rows.filter(Boolean).map(r=>Object.fromEntries(['id','name','invoice','delivery','paid','logable','shipped','send_email'].map(f=>[f,r[f] ?? null])));
}
export async function previewOrderState({storeId,orderId,stateId}) {
  requireWrite(storeId); id.parse(orderId); id.parse(stateId);
  const state=(await orderStates({storeId})).find(s=>Number(scalar(s.id))===stateId);
  if (!state) throw new Error('Requested order state was not found');
  const p={storeId,resource:'orders',id:orderId,changes:{current_state:stateId},state};
  p.before=await readBefore(p);
  return preview(p);
}
export async function previewDiscount(input) {
  const a=z.object(discountInput).strict().parse(input);
  requireWrite(a.storeId);
  if(a.reductionType==='percentage'&&a.reduction>100) throw new Error('Percentage must be between 0 and 100');
  if(a.reductionType==='amount'&&!a.currencyId) throw new Error('Amount discounts require an explicit currencyId');
  if(a.from&&a.to&&a.from>a.to) throw new Error('Discount start must precede its end');
  await record(a.storeId,'products',a.productId,['price']);
  const p={storeId:a.storeId,resource:'specific_prices',id:a.specificPriceId||0,create:!a.specificPriceId,
    changes:{id_product:a.productId,id_shop:a.shopId,id_shop_group:0,id_currency:a.currencyId,id_country:0,id_group:0,id_customer:0,id_product_attribute:0,id_cart:0,
      price:-1,from_quantity:1,reduction:a.reductionType==='percentage'?a.reduction/100:a.reduction,reduction_tax:1,reduction_type:a.reductionType,
      from:a.from||'0000-00-00 00:00:00',to:a.to||'0000-00-00 00:00:00'}};
  p.before=await readBefore(p);
  if(p.create&&p.before.existing.length) throw new Error('Product already has specific prices; inspect them and provide an explicit specificPriceId');
  if(!p.create&&(p.before.id_product!==a.productId||p.before.id_shop!==a.shopId||p.before.id_customer!==0||p.before.id_group!==0||p.before.id_product_attribute!==0||p.before.id_cart!==0||p.before.id_country!==0||p.before.from_quantity!==1)) throw new Error('Selected discount has a different product, shop or audience; modification refused');
  return preview(p);
}
export async function listDiscounts({storeId,productId}) {
  id.parse(productId);
  const d=await psGet(storeId,'specific_prices',{'filter[id_product]':`[${productId}]`,display:'[id,id_shop,id_product_attribute,reduction,reduction_type,reduction_tax,id_currency,from_quantity,from,to]',limit:'0,250'});
  return (Array.isArray(d.specific_prices)?d.specific_prices:[d.specific_prices]).filter(Boolean);
}
async function send(plan) {
  const s=getStore(plan.storeId);
  const isOrder=plan.resource==='orders';
  const resource=isOrder?'order_histories':plan.resource;
  const create=isOrder||plan.create;
  const url=new URL(`${s.baseUrl}/api/${resource}${create?'':`/${plan.id}`}`);
  url.searchParams.set('output_format','JSON');
  if (isOrder) url.searchParams.set('sendemail','0');
  const node=isOrder?'order_history':plan.resource==='products'?'product':plan.resource==='specific_prices'?'specific_price':'stock_available';
  const fields=isOrder?`<id_order>${plan.id}</id_order><id_order_state>${plan.changes.current_state}</id_order_state>`:
    (create?'':`<id>${plan.id}</id>`)+Object.entries(plan.changes).map(([field,v])=>`<${field}>${languageFields.has(field)?`<language id="${plan.languageId}">${escape(v)}</language>`:escape(typeof v==='boolean'?Number(v):v)}</${field}>`).join('');
  let r;
  try {
    r=await fetch(url,{method:create?'POST':'PATCH',redirect:'manual',signal:AbortSignal.timeout(15000),headers:{
      Authorization:`Basic ${Buffer.from(`${s.apiKey}:`).toString('base64')}`,
      'Content-Type':'application/xml',Accept:'application/json','Output-Format':'JSON','User-Agent':'FC-AI-Connector/0.4.0'},
      body:`<?xml version="1.0" encoding="UTF-8"?><prestashop><${node}>${fields}</${node}></prestashop>`});
  } catch { throw new Error('Write outcome is uncertain; inspect the record before making a new attempt'); }
  const body=await r.text().catch(()=>null);
  if (r.status>=300 && r.status<400) throw new Error('API redirect refused; inspect the record before retrying');
  if (!r.ok) throw new Error(`PrestaShop write HTTP ${r.status}; inspect the record before retrying`);
  if (r.status!==204) {
    let data;
    try {data=JSON.parse(body);} catch {throw new Error('Non-JSON write response; outcome is uncertain, inspect the record before retrying');}
    if (data.errors) throw new Error('PrestaShop returned write errors; inspect the record before retrying');
    if(plan.create) {
      const created=data.specific_price ?? data.specific_prices?.[0];
      const createdId=Number(scalar(created?.id));
      if(!Number.isSafeInteger(createdId)||createdId<=0) throw new Error('Discount submitted but its ID is unavailable; inspect before retrying');
      plan.id=createdId; plan.create=false;
    }
  }
  if(plan.create) throw new Error('Discount submitted without its ID; inspect before retrying');
}
export async function applyPreview({previewToken,confirm}) {
  if (confirm!==true) throw new Error('Explicit confirmation is required');
  const plan=decode(previewToken);
  requireWrite(plan.storeId);
  for (const [nonce,expiry] of used) if(expiry<Date.now()) used.delete(nonce);
  if (used.has(plan.nonce)||pending.has(plan.nonce)) throw new Error('Preview already used or being applied; generate a new preview');
  pending.add(plan.nonce);
  try {
    const current=await readBefore(plan);
    if (JSON.stringify(current)!==JSON.stringify(plan.before)) throw new Error('Record changed since preview; generate a new preview');
    if (plan.resource==='stock_availables') {
      const row=await record(plan.storeId,'stock_availables',plan.id,['depends_on_stock']);
      if(String(scalar(row.depends_on_stock))==='1') throw new Error('Advanced stock management became enabled; generate a new preview');
    }
    used.set(plan.nonce,plan.expiresAt);
    await send(plan);
    let actual;
    try {actual=await readBefore(plan);} catch {throw new Error('Write submitted but verification failed; inspect the record before retrying');}
    const verified=JSON.stringify(actual)===JSON.stringify(plan.changes);
    console.log(JSON.stringify({event:'prestashop_write',storeId:plan.storeId,resource:plan.resource,id:plan.id,verified}));
    return {ok:verified,verified,store_id:plan.storeId,resource:plan.resource,record_id:plan.id,actual,
      ...(verified?{}:{warning:'Saved values differ from the preview; inspect before retrying'})};
  } finally {pending.delete(plan.nonce);}
}
