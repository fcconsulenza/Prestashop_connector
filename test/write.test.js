import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewProduct, previewStock, previewOrderState, previewDiscount, applyPreview } from '../src/write.js';
import { cfg } from '../src/config.js';

test('writes require enabled store, signed approval, fresh values; exact PATCH is verified and cannot replay', async()=>{
  const original=global.fetch;
  const bearer=cfg.bearer;
  cfg.bearer='test-signing-key';process.env.PS_KEY_LACARTOLERIA='fake-test-key';
  let price=10,active='1',writes=0;
  try {
    delete process.env.PS_WRITE_STORES;
    await assert.rejects(previewProduct({storeId:'lacartoleria',productId:1,changes:{price:9}}),/Writing is disabled/);
    process.env.PS_WRITE_STORES='lacartoleria';
    global.fetch=async(url,options)=>{
      assert.equal(url.hostname,'www.lacartoleria.it');assert.equal(options.redirect,'manual');
      if(options.method==='PATCH') {
        writes++;
        assert.equal(url.pathname,'/api/products/1');
        assert.ok(options.body.includes('<price>9</price><active>0</active>'));
        assert.ok(!options.body.includes('fake-test-key'));
        price=9;active='0';return new Response('{}');
      }
      return Response.json({products:[{id:'1',price:String(price),active}]});
    };
    const p=await previewProduct({storeId:'lacartoleria',productId:1,changes:{price:9,active:false}});
    assert.equal(writes,0);
    await assert.rejects(applyPreview({previewToken:p.preview_token,confirm:false}),/confirmation/);
    await assert.rejects(applyPreview({previewToken:p.preview_token+'x',confirm:true}),/Invalid preview/);
    price=11;
    await assert.rejects(applyPreview({previewToken:p.preview_token,confirm:true}),/changed since preview/);
    assert.equal(writes,0);price=10;
    const result=await applyPreview({previewToken:p.preview_token,confirm:true});assert.equal(result.verified,true);
    await assert.rejects(applyPreview({previewToken:p.preview_token,confirm:true}),/already used/);
    assert.equal(writes,1);
    await assert.rejects(previewProduct({storeId:'lacartoleria',productId:1,changes:{id_customer:4}}));
    await assert.rejects(previewProduct({storeId:'lacartoleria',productId:1,changes:{price:-1}}));
  } finally {global.fetch=original;cfg.bearer=bearer;delete process.env.PS_KEY_LACARTOLERIA;delete process.env.PS_WRITE_STORES;}
});

test('stock rejects warehouse dependency; order transition posts history without customer email; uncertain writes cannot replay',async()=>{
  const original=global.fetch,bearer=cfg.bearer;
  cfg.bearer='test-signing-key';process.env.PS_KEY_LACARTOLERIA='fake';process.env.PS_WRITE_STORES='lacartoleria';
  let state=1,writes=0;
  try {
    global.fetch=async()=>Response.json({stock_availables:[{id:'4',quantity:'5',depends_on_stock:'1'}]});
    await assert.rejects(previewStock({storeId:'lacartoleria',stockId:4,quantity:7}),/warehouse/);
    global.fetch=async(url,o)=>{
      if(o.method==='POST') {writes++;assert.equal(url.pathname,'/api/order_histories');assert.equal(url.searchParams.get('sendemail'),'0');assert.ok(o.body.includes('<id_order>6</id_order><id_order_state>2</id_order_state>'));state=2;return Response.json({order_history:{id:'77'}});}
      if(url.pathname.endsWith('order_states')) return Response.json({order_states:[{id:'2',name:[{id:'1',value:'Preparing'}],invoice:'0'}]});
      return Response.json({orders:[{id:'6',current_state:String(state)}]});
    };
    const p=await previewOrderState({storeId:'lacartoleria',orderId:6,stateId:2});
    assert.equal((await applyPreview({previewToken:p.preview_token,confirm:true})).verified,true);assert.equal(writes,1);
    global.fetch=async(url,o)=>o.method==='PATCH'?new Response('<html>secret challenge</html>',{status:202}):Response.json({stock_availables:[{id:'4',quantity:'5',depends_on_stock:'0'}]});
    const s=await previewStock({storeId:'lacartoleria',stockId:4,quantity:7});
    await assert.rejects(applyPreview({previewToken:s.preview_token,confirm:true}),/outcome is uncertain/);
    await assert.rejects(applyPreview({previewToken:s.preview_token,confirm:true}),/already used/);
  } finally {global.fetch=original;cfg.bearer=bearer;delete process.env.PS_KEY_LACARTOLERIA;delete process.env.PS_WRITE_STORES;}
});

test('discount creation is shop-scoped, converts percentages, verifies created record and rejects existing discounts',async()=>{
  const original=global.fetch,bearer=cfg.bearer;
  cfg.bearer='test-signing-key';process.env.PS_KEY_LACARTOLERIA='fake';process.env.PS_WRITE_STORES='lacartoleria';
  let discount=null;
  try {
    global.fetch=async(url,o)=>{
      if(url.pathname.endsWith('products')) return Response.json({products:[{id:'1',price:'10'}]});
      if(o.method==='POST') {assert.ok(o.body.includes('<reduction>0.15</reduction>'));assert.ok(o.body.includes('<id_shop>1</id_shop>'));assert.ok(!o.body.includes('<id>0</id>'));discount=Object.fromEntries([...o.body.matchAll(/<([a-z_]+)>([^<]*)<\/\1>/g)].map(m=>[m[1],m[2]]));discount.id='88';return Response.json({specific_price:{id:'88'}});}
      return Response.json({specific_prices:discount?[discount]:[]});
    };
    const args={storeId:'lacartoleria',productId:1,shopId:1,reductionType:'percentage',reduction:15};
    const p=await previewDiscount(args);
    assert.equal((await applyPreview({previewToken:p.preview_token,confirm:true})).verified,true);
    await assert.rejects(previewDiscount(args),/already has specific prices/);
    await assert.rejects(previewDiscount({...args,reduction:101}),/between/);
    await assert.rejects(previewDiscount({...args,reductionType:'amount'}),/currencyId/);
  } finally {global.fetch=original;cfg.bearer=bearer;delete process.env.PS_KEY_LACARTOLERIA;delete process.env.PS_WRITE_STORES;}
});
