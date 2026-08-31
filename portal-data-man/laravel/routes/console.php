<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\File;
use Symfony\Component\Console\Command\Command;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('portal:oidc-key-generate {--force}', function (): int {
    $privatePath = config('oidc.private_key_path');
    $publicPath = config('oidc.public_key_path');
    if (! $this->option('force') && (File::exists($privatePath) || File::exists($publicPath))) {
        $this->error('OIDC key sudah tersedia. Gunakan --force hanya untuk rotasi yang direncanakan.');

        return Command::FAILURE;
    }
    $key = openssl_pkey_new(['private_key_bits' => 3072, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
    if (! $key || ! openssl_pkey_export($key, $private)) {
        $this->error('Gagal membuat OIDC private key.');

        return Command::FAILURE;
    }
    $details = openssl_pkey_get_details($key);
    File::ensureDirectoryExists(dirname($privatePath), 0700);
    File::put($privatePath, $private);
    File::put($publicPath, $details['key']);
    chmod($privatePath, 0600);
    chmod($publicPath, 0644);
    $this->info('OIDC signing key berhasil dibuat di storage privat.');

    return Command::SUCCESS;
})->purpose('Generate persistent RSA signing key for OIDC');
