<?php
declare(strict_types=1);
namespace Cbt\Integrations\PortalData;
use Cbt\Core\Config;
final class HttpPortalDataClient implements PortalDataClientInterface
{
 private string$base;private string$key;private int$timeout;private bool$verify;
 public function __construct(){ $this->base=rtrim((string)Config::get('PORTAL_DATA_BASE_URL'),'/');$this->key=(string)Config::get('PORTAL_DATA_API_KEY');$this->timeout=(int)Config::get('PORTAL_DATA_TIMEOUT',5);$this->verify=Config::bool('PORTAL_DATA_VERIFY_SSL',true);}
 public function students(int$page,int$limit):array{return$this->page('/api/v1/integration/cbt/students',$page,$limit);}
 public function teachers(int$page,int$limit):array{return$this->page('/api/v1/integration/cbt/teachers',$page,$limit);}
 public function classes(int$page,int$limit):array{return$this->page('/api/v1/integration/cbt/classes',$page,$limit);}
 private function page(string$path,int$page,int$limit):array
 {
  if($this->base===''||$this->key==='')throw new PortalDataException('Konfigurasi Portal Data belum lengkap.');
  $curl=curl_init($this->base.$path.'?'.http_build_query(['page'=>$page,'per_page'=>$limit]));
  curl_setopt_array($curl,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_TIMEOUT=>$this->timeout,CURLOPT_CONNECTTIMEOUT=>$this->timeout,CURLOPT_SSL_VERIFYPEER=>$this->verify,CURLOPT_HTTPHEADER=>['Accept: application/json','Authorization: Bearer '.$this->key,'X-API-Key: '.$this->key]]);
  $body=curl_exec($curl);$status=(int)curl_getinfo($curl,CURLINFO_HTTP_CODE);$error=curl_error($curl);curl_close($curl);
  if($body===false||$status<200||$status>=300)throw new PortalDataException('Portal Data tidak tersedia'.($error!==''?': '.$error:'.'));
  try{$json=json_decode($body,true,512,JSON_THROW_ON_ERROR);}catch(\JsonException){throw new PortalDataException('Respons Portal Data tidak valid.');}
  $container=$json['data']??[];$data=$container['data']??$container;$meta=$json['meta']??($container['meta']??$container);
  if(!is_array($data))throw new PortalDataException('Format data Portal tidak sesuai kontrak.');
  return ['items'=>array_values($data),'has_more'=>(bool)($meta['has_more']??($meta['current_page']??$page)<($meta['last_page']??$page))];
 }
}
