import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildRequest,sshRequest} from '../src/cloud-ssh.js';
test('cloud bridge rejects broad methods and requires signed-preview metadata',()=>{
 const url=new URL('https://cartoschool.it/api/products/7?output_format=JSON');
 assert.throws(()=>buildRequest(url,{method:'DELETE'}),/scope/);
 assert.throws(()=>buildRequest(url,{method:'PATCH',body:'<xml/>'}),/signed preview/);
 const request=buildRequest(url,{method:'PATCH',body:'<xml/>',headers:{'X-FC-Preview-Nonce':'nonce','X-FC-Preview-Expires':'123'}});
 assert.equal(request.id,7);assert.equal(request.body,'<xml/>');assert.equal(request.nonce,'nonce');
 assert.throws(()=>buildRequest(new URL('https://cartoschool.it/api/orders/7'),{method:'PATCH'}),/scope/);
 assert.throws(()=>buildRequest(new URL('https://cartoschool.it/api/products?ws_key=bad')),/Forbidden/);
});
test('SSH connections fail closed without pinned host identity or dedicated private key',async()=>{
 await assert.rejects(sshRequest({keyEnv:'MISSING_TEST_KEY'},{}),/key is missing/);
 process.env.FC_TEST_KEY='test';
 try{await assert.rejects(sshRequest({keyEnv:'FC_TEST_KEY'},{}),/host identity/);}finally{delete process.env.FC_TEST_KEY;}
});

