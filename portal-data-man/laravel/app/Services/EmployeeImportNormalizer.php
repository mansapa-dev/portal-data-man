<?php

namespace App\Services;

use InvalidArgumentException;

class EmployeeImportNormalizer
{
    public const HEADERS = ['Jenis Pegawai', 'Nama', 'NIP', 'NUPTK', 'Jabatan', 'Golongan', 'Jenis Kelamin', 'Pendidikan', 'Grade'];

    public function normalize(array $values): array
    {
        $warnings = [];
        $employmentType = strtoupper(trim($this->text($values['Jenis Pegawai'] ?? null)));
        $employmentType = match ($employmentType) {
            'PNS' => 'PNS',
            'PPPK', 'P3K' => 'PPPK',
            'HONOR', 'HONORER', 'HONORER SEKOLAH' => 'HONORER',
            default => throw new InvalidArgumentException('Jenis pegawai wajib PNS, PPPK, atau HONORER.'),
        };

        $fullName = $this->clean($values['Nama'] ?? null);
        if (mb_strlen($fullName) < 2 || mb_strlen($fullName) > 191) {
            throw new InvalidArgumentException('Nama pegawai wajib diisi 2 sampai 191 karakter.');
        }

        $position = $this->clean($values['Jabatan'] ?? null);
        if ($position === '' || mb_strlen($position) > 191) {
            throw new InvalidArgumentException('Jabatan wajib diisi dan maksimal 191 karakter.');
        }

        $nip = $this->nullable($values['NIP'] ?? null, 50, 'NIP');
        if ($nip === null) {
            throw new InvalidArgumentException('NIP pegawai wajib diisi.');
        }
        $nuptk = $this->nullable($values['NUPTK'] ?? null, 50, 'NUPTK');
        $rank = $this->nullable($values['Golongan'] ?? null, 100, 'Golongan');
        $education = $this->nullable($values['Pendidikan'] ?? null, 191, 'Pendidikan');
        $grade = $this->nullable($values['Grade'] ?? null, 100, 'Grade');
        $gender = $this->gender($values['Jenis Kelamin'] ?? null, $warnings);

        return compact('employmentType', 'fullName', 'nip', 'nuptk', 'position', 'rank', 'gender', 'education', 'grade') + [
            'status' => 'ACTIVE',
            'warnings' => $warnings,
        ];
    }

    private function gender(mixed $value, array &$warnings): ?string
    {
        $raw = strtoupper(str_replace(['-', ' '], '_', $this->clean($value)));
        if ($raw === '') {
            return null;
        }

        $map = ['L' => 'MALE', 'LAKI_LAKI' => 'MALE', 'MALE' => 'MALE', 'P' => 'FEMALE', 'PEREMPUAN' => 'FEMALE', 'FEMALE' => 'FEMALE'];
        if (! isset($map[$raw])) {
            $warnings[] = 'Jenis kelamin tidak dikenal dan dikosongkan.';

            return null;
        }

        return $map[$raw];
    }

    private function nullable(mixed $value, int $max, string $label): ?string
    {
        $clean = $this->clean($value);
        if (mb_strlen($clean) > $max) {
            throw new InvalidArgumentException("{$label} maksimal {$max} karakter.");
        }

        return $clean === '' ? null : $clean;
    }

    private function clean(mixed $value): string
    {
        return preg_replace('/\s+/u', ' ', trim($this->text($value)));
    }

    private function text(mixed $value): string
    {
        if ($value === null) {
            return '';
        }
        if ($value instanceof \DateTimeInterface) {
            return $value->format('Y-m-d');
        }

        return is_bool($value) ? ($value ? '1' : '0') : (string) $value;
    }
}
