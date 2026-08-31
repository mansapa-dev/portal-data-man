<?php

namespace App\Services;

use App\Models\Teacher;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

class TeacherPhotoService
{
    public function store(Teacher $teacher, UploadedFile $file): array
    {
        abort_if($file->getSize() > 2 * 1024 * 1024, 422, 'Foto maksimal 2 MB.');
        $kind = $this->detect((string) file_get_contents($file->getRealPath()));
        abort_unless($kind, 422, 'Isi file harus JPEG, PNG, atau WebP.');
        $name = Str::uuid().'.'.$kind['extension'];
        $path = 'teacher-photos/'.$name;
        abort_unless(Storage::disk('local')->put($path, file_get_contents($file->getRealPath())), 500, 'Foto gagal disimpan.');
        $old = $teacher->photoPath;
        try {
            $teacher->update(['photoPath' => $name]);
        } catch (\Throwable $error) {
            Storage::disk('local')->delete($path);
            throw $error;
        }
        if ($old && basename($old) === $old) {
            Storage::disk('local')->delete('teacher-photos/'.$old);
        }

        return ['url' => "/api/v1/teachers/{$teacher->publicId}/photo", 'mimeType' => $kind['mime']];
    }

    public function delete(Teacher $teacher): void
    {
        $old = $teacher->photoPath;
        $teacher->update(['photoPath' => null]);
        if ($old && basename($old) === $old) {
            Storage::disk('local')->delete('teacher-photos/'.$old);
        }
    }

    public function response(Teacher $teacher): StreamedResponse
    {
        $name = $teacher->photoPath;
        abort_unless($name && basename($name) === $name, 404, 'Foto guru tidak ditemukan.');
        $path = 'teacher-photos/'.$name;
        abort_unless(Storage::disk('local')->exists($path), 404, 'Foto guru tidak ditemukan.');
        $contents = Storage::disk('local')->get($path);
        $kind = $this->detect($contents);
        abort_unless($kind, 404, 'Foto guru tidak valid.');

        return response()->stream(fn () => print $contents, 200, ['Content-Type' => $kind['mime'], 'Content-Length' => (string) strlen($contents), 'Cache-Control' => 'private, max-age=300', 'X-Content-Type-Options' => 'nosniff']);
    }

    private function detect(string $contents): ?array
    {
        if (str_starts_with($contents, "\xFF\xD8\xFF")) {
            return ['extension' => 'jpg', 'mime' => 'image/jpeg'];
        }
        if (str_starts_with($contents, "\x89PNG\r\n\x1A\n")) {
            return ['extension' => 'png', 'mime' => 'image/png'];
        }
        if (strlen($contents) >= 12 && substr($contents, 0, 4) === 'RIFF' && substr($contents, 8, 4) === 'WEBP') {
            return ['extension' => 'webp', 'mime' => 'image/webp'];
        }

        return null;
    }
}
