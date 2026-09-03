<?php
declare(strict_types=1);
namespace Cbt\Controllers;
use Cbt\Core\{Config,Request,Response,Session};
use PDO;

final class TeacherSsoController
{
    private ?array $discovery = null;
    public function __construct(private PDO $db) {}
    public function start(Request $request): Response
    {
        $oidc=$this->oidc();$client=$this->required('PORTAL_DATA_OIDC_CLIENT_ID');$redirect=$this->required('PORTAL_DATA_OIDC_REDIRECT_URI');$this->https($redirect);$verifier=$this->b64(random_bytes(32));$state=$this->b64(random_bytes(24));$nonce=$this->b64(random_bytes(24));$_SESSION['oidc_teacher']=['state'=>$state,'nonce'=>$nonce,'verifier'=>$verifier];header('Location: '.$oidc['authorization_endpoint'].'?'.http_build_query(['client_id'=>$client,'response_type'=>'code','redirect_uri'=>$redirect,'scope'=>'openid profile email portal_role','state'=>$state,'nonce'=>$nonce,'code_challenge'=>$this->b64(hash('sha256',$verifier,true)),'code_challenge_method'=>'S256']));exit;
    }
    public function callback(Request $request): Response
    {
        $session=$_SESSION['oidc_teacher']??[];if(!isset($session['state'])||!hash_equals((string)$session['state'],(string)($request->query['state']??'')))return Response::error('State SSO tidak valid.',400);$oidc=$this->oidc();$body=$this->post($oidc['token_endpoint'],['grant_type'=>'authorization_code','client_id'=>$this->required('PORTAL_DATA_OIDC_CLIENT_ID'),'code'=>$request->query['code']??'','redirect_uri'=>$this->required('PORTAL_DATA_OIDC_REDIRECT_URI'),'code_verifier'=>$session['verifier']]);$claims=$this->verify((string)($body['id_token']??''),(string)$session['nonce'],$oidc);if(!$claims)return Response::error('ID token Portal Data tidak valid.',401);$info=$this->userinfo($oidc['userinfo_endpoint'],(string)($body['access_token']??''));$portal=(string)($info['portal_teacher_id']??$claims['portal_teacher_id']??'');$nip=(string)($info['preferred_username']??$claims['preferred_username']??'');$teacherQuery=$this->db->prepare("SELECT * FROM teachers WHERE status='ACTIVE' AND (portal_teacher_id=:portal OR (nip=:nip AND nip<>'')) LIMIT 1");$teacherQuery->execute(['portal'=>$portal,'nip'=>$nip]);$teacher=$teacherQuery->fetch();if(!$teacher)return Response::error('Guru belum tersinkron dari Portal Data.',403);$q=$this->db->prepare('SELECT * FROM users WHERE teacher_id=:teacher LIMIT 1');$q->execute(['teacher'=>$teacher['id']]);$user=$q->fetch();if(!$user){$username=$teacher['nip']?:'portal-'.$teacher['portal_teacher_id'];$insert=$this->db->prepare("INSERT INTO users(teacher_id,username,password_hash,name,role,status) VALUES(:teacher,:username,:hash,:name,'TEACHER','ACTIVE')");$insert->execute(['teacher'=>$teacher['id'],'username'=>$username,'hash'=>password_hash(bin2hex(random_bytes(32)),PASSWORD_DEFAULT),'name'=>$teacher['name_snapshot']]);$q->execute(['teacher'=>$teacher['id']]);$user=$q->fetch();}if(!$user||$user['role']!=='TEACHER'||$user['status']!=='ACTIVE')return Response::error('Akun CBT guru tidak aktif.',403);Session::regenerate();$_SESSION['auth']=['user_id'=>(int)$user['id'],'teacher_id'=>(int)$teacher['id'],'portal_teacher_id'=>$teacher['portal_teacher_id'],'nip'=>$teacher['nip'],'role'=>'TEACHER'];unset($_SESSION['oidc_teacher']);header('Location: /guru/dashboard');exit;
    }
    public function logout(Request $request): Response { Session::destroy();header('Location: /guru');exit; }
    private function oidc(): array
    {
        if($this->discovery!==null)return$this->discovery;$configured=$this->required('PORTAL_DATA_OIDC_ISSUER');$candidates=[$configured.'/.well-known/openid-configuration',rtrim($configured,'/').'/oidc/.well-known/openid-configuration'];foreach(array_unique($candidates)as$url){$data=$this->userinfo($url,'');if(isset($data['issuer'],$data['authorization_endpoint'],$data['token_endpoint'],$data['jwks_uri']))return$this->discovery=['issuer'=>rtrim((string)$data['issuer'],'/'),'authorization_endpoint'=>(string)$data['authorization_endpoint'],'token_endpoint'=>(string)$data['token_endpoint'],'userinfo_endpoint'=>(string)($data['userinfo_endpoint']??''),'jwks_uri'=>(string)$data['jwks_uri']];}Response::error('Konfigurasi endpoint SSO Portal Data tidak dapat dibaca.',503)->send();return[];
    }
    private function verify(string $jwt, string $nonce, array $oidc): ?array
    {
        if ($jwt === '') { error_log('CBT SSO verify: id_token kosong.'); return null; }
        $parts = explode('.', $jwt);
        if (count($parts) !== 3) { error_log('CBT SSO verify: JWT bukan 3 segmen.'); return null; }
        [$headerB64, $payloadB64, $sigB64] = $parts;
        $header  = json_decode((string)base64_decode(strtr($headerB64, '-_', '+/'), true), true);
        $payload = json_decode((string)base64_decode(strtr($payloadB64, '-_', '+/'), true), true);
        if (!is_array($header) || !is_array($payload)) { error_log('CBT SSO verify: header/payload JWT tidak bisa di-decode.'); return null; }
        $kid  = (string)($header['kid'] ?? '');
        $jwks = $this->userinfo($oidc['jwks_uri'], '');
        $jwkFound = null;
        foreach ($jwks['keys'] ?? [] as $k) {
            if ($kid === '' || (string)($k['kid'] ?? '') === $kid) { $jwkFound = $k; break; }
        }
        if (!$jwkFound) { error_log('CBT SSO verify: kid "'.$kid.'" tidak ada di JWKS.'); return null; }
        $publicKey = $this->jwkToPublicKey((string)($jwkFound['n'] ?? ''), (string)($jwkFound['e'] ?? ''));
        if (!$publicKey) { error_log('CBT SSO verify: gagal rekonstruksi RSA public key dari JWK.'); return null; }
        $sig = base64_decode(strtr($sigB64, '-_', '+/'), true);
        if ($sig === false || openssl_verify($headerB64.'.'.$payloadB64, $sig, $publicKey, OPENSSL_ALGO_SHA256) !== 1) {
            error_log('CBT SSO verify: signature tidak valid. OpenSSL error: '.openssl_error_string()); return null;
        }
        $now    = time();
        $client = $this->required('PORTAL_DATA_OIDC_CLIENT_ID');
        $aud    = $payload['aud'] ?? null;
        $audOk  = is_string($aud) ? hash_equals($client, $aud) : (is_array($aud) && in_array($client, $aud, true));
        $issOk  = rtrim((string)($payload['iss'] ?? ''), '/') === $oidc['issuer'];
        $expOk  = isset($payload['exp']) && (int)$payload['exp'] > $now;
        $nbfOk  = !isset($payload['nbf']) || (int)$payload['nbf'] <= $now;
        $claimN = (string)($payload['nonce'] ?? '');
        $nonceOk = $claimN !== '' && hash_equals($nonce, $claimN);
        if (!$audOk || !$issOk || !$expOk || !$nbfOk || !$nonceOk) {
            error_log(sprintf('CBT SSO verify: claim mismatch — aud=%s iss=%s exp=%s nbf=%s nonce=%s | iss_got="%s" iss_want="%s"',
                $audOk?'ok':'FAIL', $issOk?'ok':'FAIL', $expOk?'ok':'FAIL',
                $nbfOk?'ok':'FAIL', $nonceOk?'ok':'FAIL',
                rtrim((string)($payload['iss']??''),'/'), $oidc['issuer']));
            return null;
        }
        return $payload;
    }
    /**
     * Rekonstruksi OpenSSL RSA public key dari komponen JWK base64url n dan e.
     * Menggunakan SubjectPublicKeyInfo DER encoding (format PEM PUBLIC KEY standar)
     * agar kompatibel dengan openssl_verify().
     */
    private function jwkToPublicKey(string $nB64, string $eB64): \OpenSSLAsymmetricKey|false
    {
        $n = base64_decode(strtr($nB64, '-_', '+/'), true);
        $e = base64_decode(strtr($eB64, '-_', '+/'), true);
        if (!$n || !$e) return false;
        // ASN.1 DER encode integer (unsigned big-endian)
        $encInt = static function (string $raw): string {
            if (ord($raw[0]) > 0x7f) $raw = "\x00".$raw; // prevent sign bit
            $len = strlen($raw);
            if ($len < 0x80)   return "\x02".chr($len).$raw;
            if ($len < 0x100)  return "\x02\x81".chr($len).$raw;
            return "\x02\x82".chr($len >> 8 & 0xff).chr($len & 0xff).$raw;
        };
        $encSeq = static function (string $inner): string {
            $len = strlen($inner);
            if ($len < 0x80)   return "\x30".chr($len).$inner;
            if ($len < 0x100)  return "\x30\x81".chr($len).$inner;
            return "\x30\x82".chr($len >> 8 & 0xff).chr($len & 0xff).$inner;
        };
        // RSAPublicKey ::= SEQUENCE { modulus INTEGER, publicExponent INTEGER }
        $rsaKey   = $encSeq($encInt($n).$encInt($e));
        // SubjectPublicKeyInfo header (OID 1.2.840.113549.1.1.1 rsaEncryption + NULL params)
        $oidHdr   = "\x30\x0d\x06\x09\x2a\x86\x48\x86\xf7\x0d\x01\x01\x01\x05\x00";
        $bsLen    = strlen($rsaKey) + 1;
        if ($bsLen < 0x80)        $bsHdr = "\x03".chr($bsLen);
        elseif ($bsLen < 0x100)   $bsHdr = "\x03\x81".chr($bsLen);
        else                       $bsHdr = "\x03\x82".chr($bsLen >> 8 & 0xff).chr($bsLen & 0xff);
        $spki = $encSeq($oidHdr.$bsHdr."\x00".$rsaKey);
        $pem  = "-----BEGIN PUBLIC KEY-----\n".chunk_split(base64_encode($spki), 64, "\n")."-----END PUBLIC KEY-----\n";
        return openssl_pkey_get_public($pem) ?: false;
    }
    private function post(string$url,array$data):array{$curl=curl_init($url);curl_setopt_array($curl,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>http_build_query($data),CURLOPT_HTTPHEADER=>['Accept: application/json','Content-Type: application/x-www-form-urlencoded'],CURLOPT_TIMEOUT=>10]);$body=curl_exec($curl);$status=(int)curl_getinfo($curl,CURLINFO_HTTP_CODE);curl_close($curl);$json=is_string($body)?json_decode($body,true):null;return$status>=200&&$status<300&&is_array($json)?$json:[];}
    private function userinfo(string$url,string$token):array{$curl=curl_init($url);$headers=['Accept: application/json'];if($token!=='')$headers[]='Authorization: Bearer '.$token;curl_setopt_array($curl,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_HTTPHEADER=>$headers,CURLOPT_TIMEOUT=>10]);$body=curl_exec($curl);$status=(int)curl_getinfo($curl,CURLINFO_HTTP_CODE);curl_close($curl);$json=is_string($body)?json_decode($body,true):null;return$status>=200&&$status<300&&is_array($json)?$json:[];}
    private function required(string$key):string{$value=(string)Config::get($key,'');if($value==='')Response::error('Konfigurasi SSO guru belum lengkap.',503)->send();return rtrim($value,'/');}
    private function https(string$url):void{if(parse_url($url,PHP_URL_SCHEME)!=='https'&&!in_array(parse_url($url,PHP_URL_HOST),['localhost','127.0.0.1'],true))Response::error('Redirect SSO wajib HTTPS.',503)->send();}
    private function b64(string$value):string{return rtrim(strtr(base64_encode($value),'+/','-_'),'=');}
}
