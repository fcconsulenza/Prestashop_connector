import test from 'node:test';
import assert from 'node:assert/strict';
import {findBarcode} from '../src/prestashop.js';
test('barcode uses exact upstream filter, retains zeroes and refuses an ignored filter',async()=>{
 const original=global.fetch;process.env.PS_KEY_ADIPIETRO='fixture';let url;
 try{
 global.fetch=async input=>{url=new URL(input);return Response.json({products:[{id:20593,name:'Item',ean13:'0036000291452',price:'12'}]});};
 const result=await findBarcode({storeId:'adipietro',barcode:'036000291452'});
 assert.equal(url.searchParams.get('filter[ean13]'),'[0036000291452|036000291452]');assert.equal(url.searchParams.has('filter[name]'),false);assert.equal(result.items[0].ean13,'0036000291452');
 global.fetch=async()=>Response.json({products:[{id:1,ean13:'8056420481310'}]});await assert.rejects(findBarcode({storeId:'adipietro',barcode:'036000291452'}),/not respected/);
 global.fetch=async()=>Response.json({products:[]});assert.equal((await findBarcode({storeId:'adipietro',barcode:'8056420481310'})).items.length,0);
 global.fetch=async()=>{throw Error('must not request invalid codes');};await assert.rejects(findBarcode({storeId:'adipietro',barcode:'8056420481311'}),/controllo/);
 }finally{global.fetch=original;delete process.env.PS_KEY_ADIPIETRO;}
});
