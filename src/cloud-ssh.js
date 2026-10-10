import crypto from 'node:crypto';
import {Client} from 'ssh2';
import {stores} from './config.js';
let active=0;
const waiting=[];
function release(){active--;const next=waiting.shift();if(next){clearTimeout(next.timer);active++;next.resolve(release);}}
async function acquire(){
 if(active<4){active++;return release;}
 if(waiting.length>=32)throw new Error('Cloud SSH capacity exceeded');
 return new Promise((resolve,reject)=>{
  const entry={resolve,reject};entry.timer=setTimeout(()=>{const index=waiting.indexOf(entry);if(index>=0)waiting.splice(index,1);reject(new Error('Cloud SSH queue timed out'));},15000);
  waiting.push(entry);
 });
}

export function buildRequest(url,options={}) {
 const route=url.pathname.match(/^\/api\/([a-z_]+)(?:\/(\d+))?$/);
 const method=options.method||'GET', resource=route?.[1];
 const scope={GET:['products','stock_availables','orders','order_states','specific_prices'],PATCH:['products','stock_availables','specific_prices'],POST:['specific_prices','order_histories']};
 if(!scope[method]?.includes(resource)||(method==='PATCH'&&!route[2])||(method==='POST'&&route[2]))throw new Error('Request outside cloud SSH scope');
 const params=Object.fromEntries(url.searchParams);
 if(['ps_method','ws_key','url'].some(k=>k in params))throw new Error('Forbidden backend parameter');
 const request={method,resource,params};
 if(route[2])request.id=Number(route[2]);
 if(options.body)request.body=options.body;
 if(method!=='GET'){
  request.nonce=options.headers?.['X-FC-Preview-Nonce'];
  request.expires=options.headers?.['X-FC-Preview-Expires'];
  if(!request.nonce||!request.expires)throw new Error('A signed preview is required for cloud SSH writes');
 }
 return request;
}
export async function sshRequest(connection,request){
 const privateKey=process.env[connection.keyEnv];
 if(!privateKey)throw new Error('Cloud SSH key is missing');
 if(!/^[a-f0-9]{64}$/.test(connection.hostHash))throw new Error('Cloud SSH host identity is missing');
 const releaseSlot=await acquire();
 return new Promise((resolve,reject)=>{
  const client=new Client();let settled=false;
  const finish=(err,result)=>{if(settled)return;settled=true;clearTimeout(timer);releaseSlot();client.end();err?reject(err):resolve(result);};
  const timer=setTimeout(()=>finish(new Error('Cloud SSH request timed out; do not automatically retry writes')),45000);
  client.on('error',()=>finish(new Error('Cloud SSH connection failed')));
  client.on('ready',()=>client.exec('fc-prestashop-bridge',(err,stream)=>{
   if(err)return finish(new Error('Cloud SSH bridge could not start'));
   let output='';stream.on('data',chunk=>{output+=chunk;if(output.length>2_000_000)finish(new Error('Cloud SSH response exceeded the limit'));});
   stream.stderr.on('data',()=>{});
   stream.on('error',()=>finish(new Error('Cloud SSH bridge interrupted')));
   stream.on('close',code=>{
    try{const data=JSON.parse(output);if(code!==0||!Number.isInteger(data.status)||typeof data.body!=='string')throw Error();finish(null,data);}catch{finish(new Error('Cloud SSH bridge returned an invalid response'));}
   });
   stream.end(JSON.stringify(request));
  }));
  try{client.connect({host:connection.host,port:connection.port||18765,username:connection.user,privateKey,readyTimeout:15000,algorithms:{serverHostKey:['ssh-ed25519']},hostHash:'sha256',hostVerifier:hash=>{
   const a=Buffer.from(hash),b=Buffer.from(connection.hostHash);return a.length===b.length&&crypto.timingSafeEqual(a,b);
  }});}catch{finish(new Error('Cloud SSH connection could not start'));}
 });
}
export function installCloudSsh(){
 const connections=JSON.parse(process.env.FC_CLOUD_SSH_CONNECTIONS||'{}');
 const original=globalThis.fetch;
 globalThis.fetch=async(input,options={})=>{
  const url=new URL(input);const store=stores.find(s=>new URL(s.baseUrl).hostname===url.hostname);
  if(!store||!connections[store.id])return original(input,options);
  const data=await sshRequest(connections[store.id],buildRequest(url,options));
  return new Response(data.status===204?null:data.body,{status:data.status,headers:{'content-type':'application/json'}});
 };
 return Object.keys(connections).length;
}

