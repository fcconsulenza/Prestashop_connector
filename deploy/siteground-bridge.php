<?php
error_reporting(0);
ini_set('display_errors','0');
// Included into the runner after its opening PHP tag. No dynamic PHP evaluation.
function fc_deny($status=400){echo json_encode(['status'=>$status,'body'=>json_encode(['errors'=>[['message'=>'Restricted bridge rejected the request']]])]);exit(1);}
if(getenv('SSH_ORIGINAL_COMMAND')!=='fc-prestashop-bridge')fc_deny(403);
$raw=stream_get_contents(STDIN,1000001);
if(strlen($raw)>1000000)fc_deny(413);
$input=json_decode($raw,true);
if(!is_array($input))fc_deny();
$account=json_decode(file_get_contents(__DIR__.'/account.json'),true);
$root=$account['root'];$input['host']=$account['host'];$input['key']=$account['key'];
$method=$input['method']??'GET';$resource=$input['resource']??'';
$scope=['GET'=>['products','stock_availables','orders','order_states','specific_prices'],'PATCH'=>['products','stock_availables','specific_prices'],'POST'=>['specific_prices','order_histories']];
if(!in_array($resource,$scope[$method]??[],true))fc_deny(403);
if($method==='PATCH' && (!isset($input['id']) || !is_int($input['id']) || $input['id']<1))fc_deny();
if($method==='POST' && isset($input['id']))fc_deny();
if(!is_array($input['params']??null))fc_deny();
foreach(['ws_key','ps_method','url','id_shop'] as $forbidden)if(array_key_exists($forbidden,$input['params']))fc_deny(403);
// Order reads expose only the fields used by the MCP tools, never customer data.
if($resource==='orders'){
 $display=$input['params']['display']??'';
 if(!preg_match('/^\[[a-z_,]+\]$/',$display))fc_deny(403);
 foreach(explode(',',trim($display,'[]')) as $field)if(!in_array($field,['id','reference','total_paid_tax_incl','current_state','date_add','date_upd','valid'],true))fc_deny(403);
}
if($method!=='GET'){
 $body=$input['body']??null;
 if(!is_string($body)||preg_match('/<!DOCTYPE|<!ENTITY/i',$body))fc_deny();
 $nonce=$input['nonce']??'';$expires=(int)($input['expires']??0);$now=(int)(microtime(true)*1000);
 if(!preg_match('/^[a-f0-9-]{36}$/',$nonce)||$expires<$now||$expires>$now+600000)fc_deny(409);
 // Atomic exclusive create persists consumption before any business write.
 $handle=@fopen(__DIR__.'/used/'.hash('sha256',$nonce),'x');
 if(!$handle)fc_deny(409);
 fwrite($handle,(string)$expires);fclose($handle);chmod(__DIR__.'/used/'.hash('sha256',$nonce),0600);
}

chdir($root);
$_SERVER['HTTP_HOST'] = $input['host'];
$_SERVER['REQUEST_METHOD'] = $input['method'] ?? 'GET';
$_SERVER['REMOTE_ADDR'] = '127.0.0.1';
$_SERVER['SERVER_PORT'] = 443;
$_SERVER['HTTPS'] = 'on';
$_SERVER['SERVER_PROTOCOL'] = 'HTTP/1.1';
$_SERVER['SCRIPT_NAME'] = '/webservice/dispatcher.php';
$_SERVER['SCRIPT_FILENAME'] = $root.'/webservice/dispatcher.php';
$route = $input['resource'].(isset($input['id']) ? '/'.(int)$input['id'] : '');
$_SERVER['REQUEST_URI'] = '/api/'.$route;
$_SERVER['PHP_AUTH_USER'] = $input['key'];
$_SERVER['QUERY_STRING'] = http_build_query($input['params']);
parse_str($_SERVER['QUERY_STRING'], $_GET);
$_GET = array_merge($_GET,['url'=>$route,'output_format'=>'JSON']);
$_REQUEST = $_GET;
define('_PS_API_IN_USE_',true);
ob_start();
require_once $root.'/config/config.inc.php';
Context::getContext()->cart = new Cart();
Context::getContext()->container = \PrestaShop\PrestaShop\Adapter\ContainerBuilder::getContainer('webservice', _PS_MODE_DEV_);
Context::getContext()->currency = Context::getContext()->currency ?? Currency::getDefaultCurrency();
$class = WebserviceKey::getClassFromKey($input['key']);
$badClass = false;
if (!class_exists($class)) { $badClass=$class; $class='WebserviceRequest'; }
WebserviceRequest::$ws_current_classname = $class;
$request = call_user_func([$class,'getInstance']);
$params = $_GET;
unset($params['url']);
$result = $request->fetch($input['key'],$_SERVER['REQUEST_METHOD'],$route,$params,$badClass,$input['body'] ?? null);
ob_end_clean();
$status = 200;
foreach (($result['headers'] ?? []) as $header) {
    if (preg_match('/^HTTP\/\S+\s+(\d{3})/', $header, $matches)) $status=(int)$matches[1];
}
$body = isset($result['type']) ? ($result['content'] ?? '') : '';
if ($body==='' && $status===200) $status=204;
echo json_encode(['status'=>$status,'body'=>$body]);

