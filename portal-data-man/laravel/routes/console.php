<?php

use Illuminate\Foundation\Inspiring;
use App\Models\AcademicYear;
use App\Models\Semester;
use App\Services\SemesterRosterSyncService;
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

Artisan::command('portal:sync-semester-roster {--year= : Public ID tahun ajaran (default: tahun aktif)} {--from=EVEN : Semester sumber: ODD atau EVEN} {--to=ODD : Semester tujuan: ODD atau EVEN} {--apply : Simpan perubahan; tanpa opsi ini hanya preview}', function (SemesterRosterSyncService $sync): int {
    $year = $this->option('year')
        ? AcademicYear::query()->where('publicId', $this->option('year'))->first()
        : AcademicYear::query()->where('isActive', true)->first();
    if (! $year) {
        $this->error('Tahun ajaran tidak ditemukan.');

        return Command::FAILURE;
    }
    $from = strtoupper((string) $this->option('from'));
    $to = strtoupper((string) $this->option('to'));
    if (! in_array($from, ['ODD', 'EVEN'], true) || ! in_array($to, ['ODD', 'EVEN'], true) || $from === $to) {
        $this->error('Gunakan --from=ODD|EVEN dan --to=ODD|EVEN yang berbeda.');

        return Command::FAILURE;
    }
    $source = Semester::query()->where('academicYearId', $year->id)->where('type', $from)->first();
    $target = Semester::query()->where('academicYearId', $year->id)->where('type', $to)->first();
    if (! $source || ! $target) {
        $this->error('Semester sumber atau tujuan tidak tersedia untuk tahun ajaran ini.');

        return Command::FAILURE;
    }
    $summary = $sync->synchronize($year, $source, $target, (bool) $this->option('apply'));
    $this->table(['Kandidat', 'Ditambahkan', 'Sudah ada', 'Konflik kelas', 'Konflik nomor'], [[
        $summary['candidates'], $summary['created'], $summary['alreadyPresent'], $summary['conflicts'], $summary['attendanceNumberConflicts'],
    ]]);
    foreach ($summary['details'] as $detail) {
        $this->warn("{$detail['student']} · {$detail['class']} — {$detail['reason']}");
    }
    $this->info($this->option('apply') ? 'Sinkronisasi roster selesai.' : 'Preview selesai. Tambahkan --apply untuk menyimpan perubahan.');

    return Command::SUCCESS;
})->purpose('Sync active student roster safely between semesters in one academic year');
