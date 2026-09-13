<?php
declare(strict_types=1);
namespace Sipintar;
use PDO;
use RuntimeException;

final class Identity
{
    private array $permissionCache = [];
    public const APP = 'multimedia';
    public const PERMISSIONS = ['borrowings.read', 'borrowings.create', 'borrowings.manage'];
    public function __construct(public readonly PDO $db) {}
    public function query(string $sql, array $params = []): \PDOStatement
    {
        $s = $this->db->prepare($sql); $s->execute($params); return $s;
    }
    public function user(int $id): ?array
    {
        $u = $this->query('SELECT a.*, e.active employee_active, e.name employee_name FROM accounts a LEFT JOIN employees e ON e.public_id=a.employee_id WHERE a.id=? AND a.active=1', [$id])->fetch(PDO::FETCH_ASSOC);
        if (!$u || ($u['employee_id'] !== null && (int)$u['employee_active'] !== 1)) return null;
        $u['name'] = $u['employee_name'] ?? $u['name'];
        unset($u['password_hash']); return $u;
    }
    public function login(string $username, string $password, string $ip): ?array
    {
        $key = hash('sha256', strtolower($username).'|'.$ip);
        $attempt = $this->query('SELECT * FROM login_attempts WHERE attempt_key=?', [$key])->fetch(PDO::FETCH_ASSOC);
        if ($attempt && (int)$attempt['blocked_until'] > time()) throw new RuntimeException('Terlalu banyak percobaan. Tunggu 15 menit.');
        $u = $this->query('SELECT * FROM accounts WHERE username=?', [$username])->fetch(PDO::FETCH_ASSOC);
        $valid = password_verify($password, $u['password_hash'] ?? '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.');
        if (!$u || !$valid || !($user = $this->user((int)$u['id']))) {
            $failures = $attempt && (int)$attempt['failures'] < 5 && (int)$attempt['blocked_until'] > time()-900 ? (int)$attempt['failures'] + 1 : 1;
            $this->query('DELETE FROM login_attempts WHERE attempt_key=?', [$key]);
            $this->query('INSERT INTO login_attempts VALUES (?,?,?)', [$key, $failures, $failures >= 5 ? time()+900 : time()]);
            return null;
        }
        $this->query('DELETE FROM login_attempts WHERE attempt_key=?', [$key]);
        return $user;
    }
    public function allows(?array $user, string $app, string $permission): bool
    {
        if (!$user || $app !== self::APP || !in_array($permission, self::PERMISSIONS, true)) return false;
        if ((int)($user['superadmin_slot'] ?? 0) === 1) return true;
        $key = $user['id'].':'.$app;
        if (isset($this->permissionCache[$key])) return in_array($permission, $this->permissionCache[$key], true);
        $raw = $this->query('SELECT r.permissions FROM grants g JOIN roles r ON r.id=g.role_id WHERE g.account_id=?', [$user['id']])->fetchColumn();
        $this->permissionCache[$key] = $raw ? json_decode($raw, true, 512, JSON_THROW_ON_ERROR) : [];
        return in_array($permission, $this->permissionCache[$key], true);
    }
    public function saveRole(string $name, array $permissions, int $id = 0): void
    {
        if (trim($name) === '' || strlen($name) > 100 || array_diff($permissions, self::PERMISSIONS)) throw new RuntimeException('Nama atau izin role tidak valid.');
        $this->permissionCache = [];
        $json = json_encode(array_values(array_unique($permissions)), JSON_THROW_ON_ERROR);
        if ($id) $this->query('UPDATE roles SET name=?, permissions=? WHERE id=?', [$name, $json, $id]);
        else $this->query('INSERT INTO roles (name, permissions) VALUES (?,?)', [$name, $json]);
    }
    public function saveAccount(array $input): void
    {
        $this->permissionCache = [];
        $id = (int)($input['id'] ?? 0);
        $username = trim($input['username'] ?? ''); $employee = $input['employee_id'] ?? '';
        if (!preg_match('/^[a-zA-Z0-9_.@-]{3,100}$/', $username)) throw new RuntimeException('Username harus 3–100 karakter.');
        $e = $this->query('SELECT * FROM employees WHERE public_id=? AND active=1', [$employee])->fetch(PDO::FETCH_ASSOC);
        if (!$e) throw new RuntimeException('Pilih pegawai aktif dari Portal Data.');
        $password = $input['password'] ?? '';
        if ((!$id || $password !== '') && strlen($password) < 12) throw new RuntimeException('Password minimal 12 karakter.');
        if ($id && !$this->query('SELECT id FROM accounts WHERE id=? AND superadmin_slot IS NULL', [$id])->fetchColumn()) throw new RuntimeException('Akun superadmin tidak dapat diubah melalui form ini.');
        $this->db->beginTransaction();
        try {
            if ($id) {
                $this->query('UPDATE accounts SET username=?, employee_id=?, name=?, active=? WHERE id=? AND superadmin_slot IS NULL', [$username, $employee, $e['name'], (int)!empty($input['active']), $id]);
                if ($password !== '') $this->query('UPDATE accounts SET password_hash=? WHERE id=?', [password_hash($password, PASSWORD_DEFAULT), $id]);
            } else {
                $this->query('INSERT INTO accounts (username,password_hash,name,employee_id,active) VALUES (?,?,?,?,?)', [$username,password_hash($password,PASSWORD_DEFAULT),$e['name'],$employee,(int)!empty($input['active'])]);
                $id = (int)$this->db->lastInsertId();
            }
            $this->query('DELETE FROM grants WHERE account_id=?', [$id]);
            $role = (int)($input['role_id'] ?? 0);
            if ($role) $this->query('INSERT INTO grants (account_id,role_id) VALUES (?,?)', [$id,$role]);
            $this->db->commit();
        } catch (\Throwable $e) { $this->db->rollBack(); throw $e; }
    }
}
