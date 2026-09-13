<?php
declare(strict_types=1);
require_once __DIR__.'/src/Identity.php';
require_once __DIR__.'/src/PortalClient.php';
function sip_config(): array {
    static $config;
    if ($config === null) {
        $path = getenv('SIPINTAR_CONFIG');
        if (!$path || !is_file($path)) throw new RuntimeException('Atur SIPINTAR_CONFIG ke file konfigurasi di luar document root.');
        $config = require $path;
    }
    return $config;
}
function sip_identity(): \Sipintar\Identity {
    static $identity;
    if (!$identity) {
        $c = sip_config()['database'];
        $address = !empty($c['socket']) ? 'unix_socket='.$c['socket'] : 'host='.$c['host'].';port='.(int)($c['port'] ?? 3306);
        $dsn = 'mysql:'.$address.';dbname='.$c['database'].';charset=utf8mb4';
        $identity = new \Sipintar\Identity(new PDO($dsn, $c['user'], $c['password'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]));
    }
    return $identity;
}
function sip_db(string $app): mysqli {
    if ($app !== \Sipintar\Identity::APP) throw new RuntimeException('Database hanya tersedia untuk proyek ini.');
    $c = sip_config()['database']; mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
    $db = new mysqli($c['host'], $c['user'], $c['password'], $c['database'], (int)($c['port'] ?? 3306), $c['socket'] ?? null); $db->set_charset('utf8mb4'); return $db;
}
function sip_base_path(): string { return rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/index.php')), '/.'); }
function sip_user(): ?array { return isset($_SESSION['sip_account']) ? sip_identity()->user((int)$_SESSION['sip_account']) : null; }
function sip_require(string $app, string $permission): array {
    $u = sip_user();
    if (!sip_identity()->allows($u, $app, $permission)) sip_fail($u ? 403 : 401, $u ? 'Anda tidak memiliki izin untuk tindakan ini.' : 'Silakan login terlebih dahulu.');
    return $u;
}
function sip_fail(int $status, string $message): never {
    http_response_code($status); header('Content-Type: application/json; charset=utf-8'); echo json_encode(['success'=>false,'message'=>$message]); exit;
}
function sip_csrf(): string { return $_SESSION['sip_csrf'] ??= bin2hex(random_bytes(32)); }
function sip_check_csrf(): void {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') sip_fail(405, 'Gunakan POST.');
    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? $_POST['_csrf'] ?? '';
    if (!is_string($token) || !hash_equals(sip_csrf(), $token)) sip_fail(419, 'Sesi formulir kedaluwarsa. Muat ulang halaman.');
}
function sip_login(string $username, string $password): ?array {
    $u = sip_identity()->login($username, $password, $_SERVER['REMOTE_ADDR'] ?? 'cli');
    if ($u) { session_regenerate_id(true); $_SESSION['sip_account'] = $u['id']; $_SESSION['sip_csrf'] = bin2hex(random_bytes(32)); }
    return $u;
}
function sip_logout(): void { unset($_SESSION['sip_account']); $_SESSION['sip_csrf'] = bin2hex(random_bytes(32)); session_regenerate_id(true); }
function sip_e(mixed $value): string { return htmlspecialchars((string)$value, ENT_QUOTES, 'UTF-8'); }
set_exception_handler(function (Throwable $e): void { error_log((string)$e); sip_fail(500, 'Layanan belum siap atau gagal memproses data. Periksa konfigurasi dan log server.'); });
if (PHP_SAPI !== 'cli' && session_status() !== PHP_SESSION_ACTIVE) {
    session_name('SIPINTAR_INVENTORY_SESSION');
    session_start(['use_strict_mode'=>1,'cookie_httponly'=>true,'cookie_secure'=>sip_config()['cookie_secure'] ?? true,'cookie_samesite'=>'Lax','cookie_path'=>sip_base_path().'/']);
    header('Cache-Control: no-store');
}
function sip_employee(array $user, string $app, array $input): array {
    $id=$user['employee_id'];
    if (sip_identity()->allows($user,$app,$app==='multimedia'?'borrowings.manage':'transactions.manage') && !empty($input['employee_id'])) $id=$input['employee_id'];
    if ($id) {
        $employee=sip_identity()->query('SELECT name,nip FROM employees WHERE public_id=? AND active=1',[$id])->fetch(PDO::FETCH_ASSOC);
        if (!$employee) throw new RuntimeException('Pegawai tidak aktif atau tidak ditemukan.');
        return $employee;
    }
    return ['name'=>$user['name'],'nip'=>null];
}
