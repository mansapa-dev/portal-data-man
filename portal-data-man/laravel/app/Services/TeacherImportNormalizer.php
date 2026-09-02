<?php

namespace App\Services;

use InvalidArgumentException;

class TeacherImportNormalizer
{
    /** Urutan kolom sengaja sama dengan form CRUD Tambah Guru. */
    public const HEADERS = ['Nama Lengkap', 'NIP', 'NUPTK', 'Nomor Pegawai', 'Email', 'Telepon', 'Jenis Kelamin', 'Status', 'Alamat'];

    public function normalize(array $values): array
    {
        $warnings = [];

        $nip = $this->clean($values['NIP'] ?? null);
        $nuptk = $this->clean($values['NUPTK'] ?? null);
        $employeeNumber = $this->clean($values['Nomor Pegawai'] ?? null);
        $email = $this->clean($values['Email'] ?? null);
        $phone = $this->clean($values['Telepon'] ?? null);
        $address = $this->clean($values['Alamat'] ?? null);

        $fullName = preg_replace('/\s+/u', ' ', trim($this->text($values['Nama Lengkap'] ?? null)));
        if ($fullName === '') {
            throw new InvalidArgumentException('Nama guru wajib diisi.');
        }
        if (mb_strlen($fullName) < 2 || mb_strlen($fullName) > 191) {
            throw new InvalidArgumentException('Nama guru harus 2 sampai 191 karakter.');
        }

        foreach (['NIP' => $nip, 'NUPTK' => $nuptk, 'Nomor Pegawai' => $employeeNumber] as $label => $identifier) {
            if (mb_strlen($identifier) > 50) {
                throw new InvalidArgumentException("{$label} maksimal 50 karakter.");
            }
        }

        $gender = $this->normalizeGender($values['Jenis Kelamin'] ?? null, $warnings);
        $status = $this->normalizeStatus($values['Status'] ?? null, $warnings);

        if ($email !== '' && ! filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new InvalidArgumentException('Email guru tidak valid.');
        }
        if (mb_strlen($email) > 191) {
            throw new InvalidArgumentException('Email guru maksimal 191 karakter.');
        }

        if ($phone !== '') {
            $phoneDigits = preg_replace('/\D/', '', $phone);
            if (strlen($phoneDigits) < 10) {
                $warnings[] = 'Nomor telepon kurang dari 10 digit dan diabaikan.';
                $phone = null;
            } else {
                if (strlen($phoneDigits) > 30) {
                    throw new InvalidArgumentException('Nomor telepon maksimal 30 digit.');
                }
                $phone = $phoneDigits;
            }
        } else {
            $phone = null;
        }

        $identifiers = array_filter([$nip, $nuptk, $employeeNumber, $email], fn ($value) => $value !== '');
        if ($identifiers === []) {
            throw new InvalidArgumentException('Minimal satu identifier guru wajib diisi.');
        }

        return [
            'nip' => $nip !== '' ? $nip : null,
            'nuptk' => $nuptk !== '' ? $nuptk : null,
            'employeeNumber' => $employeeNumber !== '' ? $employeeNumber : null,
            'fullName' => $fullName,
            'gender' => $gender,
            'email' => $email !== '' ? strtolower($email) : null,
            'phone' => $phone,
            'address' => $address !== '' ? $address : null,
            'status' => $status,
            'warnings' => $warnings,
        ];
    }

    private function normalizeGender(mixed $value, array &$warnings): ?string
    {
        $raw = strtoupper(trim($this->text($value)));
        if ($raw === '') {
            return null;
        }

        $map = ['LAKI_LAKI' => 'MALE', 'L' => 'MALE', 'MALE' => 'MALE', 'PEREMPUAN' => 'FEMALE', 'P' => 'FEMALE', 'FEMALE' => 'FEMALE'];
        if (! array_key_exists($raw, $map)) {
            $warnings[] = 'Jenis kelamin tidak dikenal; dikosongkan.';

            return null;
        }

        return $map[$raw];
    }

    private function normalizeStatus(mixed $value, array &$warnings): string
    {
        $raw = strtoupper(trim($this->text($value)));
        $map = ['AKTIF' => 'ACTIVE', 'ACTIVE' => 'ACTIVE', 'TIDAK AKTIF' => 'INACTIVE', 'NONAKTIF' => 'INACTIVE', 'INACTIVE' => 'INACTIVE', 'PENSIUN' => 'RETIRED', 'RETIRED' => 'RETIRED', 'PINDAH' => 'TRANSFERRED', 'TRANSFERRED' => 'TRANSFERRED'];

        if ($raw === '') {
            return 'ACTIVE';
        }
        if (! array_key_exists($raw, $map)) {
            $warnings[] = 'Status tidak dikenal; digunakan ACTIVE.';

            return 'ACTIVE';
        }

        return $map[$raw];
    }

    private function clean(mixed $value): string
    {
        return trim($this->text($value));
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
