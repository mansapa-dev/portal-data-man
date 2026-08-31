<?php

namespace App\Services;

use InvalidArgumentException;

class StudentImportNormalizer
{
    public const HEADERS = ['No.', 'NISN', 'Nama Siswa', 'Kelas', 'No. Telepon Orang Tua', 'Alamat', 'RFID UID', 'Status'];

    public function normalize(array $values): array
    {
        $warnings = [];
        $nisn = trim($this->text($values['NISN'] ?? null));
        if (preg_match('/^\d+(?:\.0)?$/', $nisn)) {
            $nisn = str_pad((string) preg_replace('/\.0$/', '', $nisn), 10, '0', STR_PAD_LEFT);
        }
        if (! preg_match('/^\d{10}$/', $nisn)) {
            throw new InvalidArgumentException('NISN harus terdiri dari 10 digit.');
        }
        $fullName = preg_replace('/\s+/u', ' ', trim($this->text($values['Nama Siswa'] ?? null)));
        if ($fullName === '') {
            throw new InvalidArgumentException('Nama siswa wajib diisi.');
        }
        $rawClass = strtoupper((string) preg_replace('/XlI/i', 'XII', trim($this->text($values['Kelas'] ?? null))));
        if (! preg_match('/^(11|12)\s*-\s*(XI|XII)\.(\d+)$/i', $rawClass, $match)) {
            throw new InvalidArgumentException('Format kelas tidak valid.');
        }
        $phoneDigits = preg_replace('/\D/', '', $this->text($values['No. Telepon Orang Tua'] ?? null));
        $parentPhone = strlen($phoneDigits) >= 10 ? $phoneDigits : null;
        if ($phoneDigits !== '' && $parentPhone === null) {
            $warnings[] = 'Nomor telepon kurang dari 10 digit dan diabaikan.';
        }
        $rawRfid = strtoupper(trim($this->text($values['RFID UID'] ?? null)));
        $rfidUid = $rawRfid === '' ? null : (preg_match('/^[0-9A-F]+$/', $rawRfid) ? $rawRfid : null);
        if ($rawRfid !== '' && $rfidUid === null) {
            $warnings[] = 'RFID UID bukan hexadecimal dan diabaikan.';
        }
        $rawStatus = strtolower(trim($this->text($values['Status'] ?? null)));
        if ($rawStatus !== '' && ! in_array($rawStatus, ['aktif', 'active'], true)) {
            $warnings[] = 'Status tidak dikenal; digunakan ACTIVE.';
        }

        return [
            'nisn' => $nisn,
            'fullName' => $fullName,
            'classCode' => strtoupper($match[2]).'.'.$match[3],
            'gradeLevel' => (int) $match[1],
            'parentPhone' => $parentPhone,
            'address' => trim($this->text($values['Alamat'] ?? null)) ?: null,
            'rfidUid' => $rfidUid,
            'status' => 'ACTIVE',
            'warnings' => $warnings,
        ];
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
