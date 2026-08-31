<?php

namespace App\Http\Controllers;

use App\Models\Teacher;
use App\Services\AuditService;
use App\Services\TeacherPhotoService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

class TeacherPhotoController extends Controller
{
    public function __construct(private readonly TeacherPhotoService $photos, private readonly AuditService $audit) {}

    public function show(Teacher $teacher): StreamedResponse
    {
        return $this->photos->response($teacher);
    }

    public function store(Request $request, Teacher $teacher): JsonResponse
    {
        $request->validate(['file' => ['required', 'file', 'max:2048']]);
        $result = $this->photos->store($teacher, $request->file('file'));
        $this->audit->write($request, 'UPDATE_PHOTO', 'Teacher', $teacher->publicId, null, ['mimeType' => $result['mimeType'], 'size' => $request->file('file')->getSize()]);

        return ApiResponse::success($result, 'Foto guru berhasil disimpan.');
    }

    public function destroy(Request $request, Teacher $teacher): JsonResponse
    {
        $this->photos->delete($teacher);
        $this->audit->write($request, 'DELETE_PHOTO', 'Teacher', $teacher->publicId);

        return response()->json(null, 204);
    }
}
