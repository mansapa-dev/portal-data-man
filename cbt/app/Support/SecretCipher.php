<?php
declare(strict_types=1);
namespace Cbt\Support;
use Cbt\Core\Config;
final class SecretCipher
{
 private ?string$key;
 public function __construct(){ $configured=(string)Config::get('APP_KEY');$this->key=$configured===''?null:hash('sha256',$configured,true);}
 public function encrypt(string$value):string{if($this->key===null)throw new \RuntimeException('APP_KEY wajib dikonfigurasi sebelum menyimpan PIN.');$iv=random_bytes(12);$tag='';$cipher=openssl_encrypt($value,'aes-256-gcm',$this->key,OPENSSL_RAW_DATA,$iv,$tag);if($cipher===false)throw new \RuntimeException('PIN gagal dienkripsi.');return base64_encode($iv.$tag.$cipher);}
 public function decrypt(?string$value):?string{if(!$value||$this->key===null)return null;$raw=base64_decode($value,true);if($raw===false||strlen($raw)<29)return null;$plain=openssl_decrypt(substr($raw,28),'aes-256-gcm',$this->key,OPENSSL_RAW_DATA,substr($raw,0,12),substr($raw,12,16));return$plain===false?null:$plain;}
}
