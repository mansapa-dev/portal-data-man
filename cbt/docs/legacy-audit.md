# STEP 1 — Full Source Audit

Source diaudit penuh pada `index.html` (2.138 baris) dan `code.gs.txt` (715 baris).

## A. Existing Architecture

| Layer | Implementasi lama |
|---|---|
| UI | Satu `index.html`, inline CSS, inline Vanilla JS, Inter, Font Awesome |
| Backend | Google Apps Script, 28 fungsi server/public |
| Data | Supabase REST dengan publishable key hard-coded |
| State | Object JavaScript di browser; tidak ada server session nyata |
| Excel | SheetJS di browser |
| Print | CSS print untuk kartu peserta dan laporan resmi |

## B. Existing Features

- Login siswa memakai nomor ujian dan PIN; portal siswa dan daftar ujian eligible.
- Ruang CBT: randomisasi soal dan opsi stabil berbasis ID siswa/ujian, navigasi, autosave, ragu-ragu, timer, anti-cheat 3 kali, submit, nilai, review.
- Admin: overview, siswa, kenaikan kelas, ujian, bank soal, import, hasil/filter/export/print, pelanggaran, kartu, akun, penugasan guru.
- Guru: ujian ditugaskan, hasil, pelanggaran, export, perubahan password.
- UI states: loader, alert, confirm, modal, responsive baseline, print A4.

## C. Existing Database Entities

| Supabase entity | Evidence | Target MySQL |
|---|---|---|
| `siswa` | login, import, kartu, reset | `students` local reference/cache |
| `akun_pengguna` | staff login/account CRUD | `users` |
| `ujian` | jadwal/eligibility | `exams`, `exam_target_classes` |
| `soal` | bank soal/scoring | `questions` |
| `jawaban_siswa` | autosave | `student_answers` |
| `hasil_ujian` | attempt + result tercampur | `exam_attempts`, `exam_results` |
| `log_pelanggaran` | anti-cheat | `violations` |
| `guru_ujian` | assignment | `teacher_exam_assignments` |

## D. All `google.script.run` Calls

| Legacy call | PHP endpoint |
|---|---|
| `loginSiswaAPI` | `POST /api/auth/student/login` |
| `getServerSoal` | `POST /api/student/exams/{id}/start`, `GET /api/student/exams/{id}` |
| `simpanJawabanServer` | `PUT /api/student/exams/{id}/answers/{questionId}` |
| `catatPelanggaranServer` | `POST /api/student/exams/{id}/violations` |
| `submitUjian` | `POST /api/student/exams/{id}/submit` |
| `getReviewUjianServer` | `GET /api/student/exams/{id}/review` |
| `loginPenggunaAPI` | `POST /api/auth/staff/login` |
| `getAdminDashboardStats` | `GET /api/admin/dashboard` |
| `getAdminSiswaList` | `GET /api/admin/students` |
| `simpanSiswaSatuanAdmin` | CBT state: `PATCH /api/admin/students/{id}`; identity melalui sync |
| `hapusSiswaAdmin`, `hapusSiswaPertingkatAdmin` | local deactivate/archive, bukan hapus master Portal Data |
| `importSiswaBulk`, `prosesKenaikanKelasAdmin` | `POST /api/admin/portal-data/sync/students` |
| `adminBukaBlokirSiswa` | `POST /api/admin/students/{id}/reset` |
| `getAdminUjianList`, `simpanUjianAdmin` | `GET/POST/PUT /api/admin/exams` |
| `getAdminSoalList`, `simpanSoalAdmin`, `importSoalBulk` | `/api/admin/questions`, `/api/admin/questions/import` |
| `getAdminAkunList`, `simpanAkunAdmin`, `importAkunBulk` | `/api/admin/users`, `/api/admin/users/import` |
| `getAdminGuruUjianList`, `simpanGuruUjianAdmin`, `hapusGuruUjianAdmin` | `/api/admin/teacher-assignments` |
| `getAdminHasilGlobal` | `GET /api/admin/results` |
| `getAdminLogPelanggaran` | `GET /api/admin/violations` |
| `getGuruExamResults` | `/api/teacher/exams`, results, violations |
| `updatePasswordGuru` | `POST /api/account/change-password` |

## E. All Code.gs Functions

Infrastructure: `sbFetchServer`, `doGet`, `verifyAdmin`, `verifyPengelola`. Authentication: `loginSiswaAPI`, `loginPenggunaAPI`. Student exam: `getServerSoal`, `getReviewUjianServer`, `simpanJawabanServer`, `catatPelanggaranServer`, `submitUjian`. Admin/student: `getAdminDashboardStats`, `getAdminSiswaList`, `importSiswaBulk`, `prosesKenaikanKelasAdmin`, `hapusSiswaPertingkatAdmin`, `adminBukaBlokirSiswa`, `simpanSiswaSatuanAdmin`, `hapusSiswaAdmin`. Exam/question: `getAdminUjianList`, `simpanUjianAdmin`, `getAdminSoalList`, `simpanSoalAdmin`, `importSoalBulk`. Account/assignment: `getAdminAkunList`, `simpanAkunAdmin`, `importAkunBulk`, `getAdminGuruUjianList`, `simpanGuruUjianAdmin`, `hapusGuruUjianAdmin`, `updatePasswordGuru`. Reporting: `getAdminHasilGlobal`, `getAdminLogPelanggaran`, `getGuruExamResults`.

## F. Security Problems

- Supabase URL/key committed; direct REST composition; raw upstream error exposed.
- Student PIN, admin/guru password stored and compared plaintext; default password `123456`.
- Browser supplies `session.role`, `siswaId`, `guru_id`, names/classes, and is trusted.
- No server session, CSRF, rate limit, audit log, CSP, or secure cookies.
- Timer is reset from `Date.now()` every start/refresh; not authoritative.
- Answer save uses read-then-write without unique constraint; submit/scoring is not transactional/idempotent.
- Violation events have no debounce/idempotency and count rows client-triggered.
- Unsafe template `innerHTML` uses database content; stored XSS possible.
- Answer key is returned by review API without server-side completion authorization.
- N+1/manual joins and full-table fetches; no pagination.
- Destructive promotion/delete mutates student master directly.

## G. Supabase → MySQL Mapping

Supabase entities map to normalized tables documented in `database/schema.sql`. Attempt and result are separated; student identity is a local Portal Data reference; historical student/exam attributes are snapshots on the attempt.

## H. `nomor_ujian` → NISN Mapping

Every legacy use represents participant identity. New domain and API use `nisn`; display labels may remain “No Peserta”. Templates/examples change from `UG-001` to a 10-digit NISN string. No `exam_number`, `participant_number`, or `nomor_ujian` column is created.

## I. Portal Data Integration Mapping

Browser never contacts Portal Data. `HttpPortalDataClient` maps Portal responses to internal DTOs. `PortalDataSyncService` paginates and upserts students, teachers, classes, academic years, semesters, and enrollments. Runtime attempts use local references/snapshots and never synchronously call Portal Data.

## J. Proposed PHP Architecture

Front controller → Router → Middleware → Controller → Validator → Service → Repository → PDO. Portal Data resides behind an interface and DTO mapper. Shared-hosting-compatible database/file rate limiting and synchronous operations only.

## K. Migration Risks

- Supabase export/schema is not attached; import tooling can be built, but real row migration remains `NOT VERIFIED` until CSV/JSON export is provided.
- Portal Data exact production pagination/JSON contract must be verified against its API responses.
- PIN migration: plaintext legacy PIN may be accepted only by an offline one-time importer and immediately hashed.
- Stable random order must be persisted for attempts, not recalculated from mutable IDs.
- UI parity requires screenshot comparison after the PHP frontend is runnable.

