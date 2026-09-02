-- CBT MAN 1 Palembang - template seed akun administrator.
-- Jangan jalankan sebelum REPLACE_WITH_PASSWORD_HASH diganti dengan hash password.
-- Buat hash menggunakan PHP 8.2+:
-- php -r "echo password_hash('PASSWORD_KUAT_UNIK_MINIMAL_12', PASSWORD_DEFAULT), PHP_EOL;"
--
-- Pilih database CBT di phpMyAdmin, sesuaikan username/nama, lalu jalankan.
-- Hapus salinan SQL yang sudah berisi hash setelah akun berhasil diverifikasi.

INSERT INTO users (teacher_id, username, password_hash, name, role, status)
VALUES (
    NULL,
    'adminsekolah',
    'REPLACE_WITH_PASSWORD_HASH',
    'Administrator CBT',
    'ADMIN',
    'ACTIVE'
)
ON DUPLICATE KEY UPDATE
    password_hash = VALUES(password_hash),
    name = VALUES(name),
    role = 'ADMIN',
    status = 'ACTIVE',
    teacher_id = NULL;
