# Migration Feature Matrix

Status values are evidence-based: no row is marked PASS before execution.

| Feature | Existing frontend | Code.gs | New component | Status |
|---|---|---|---|---|
| Student NISN login | `formLoginSiswa` | `loginSiswaAPI` | AuthController/AuthService | IN PROGRESS |
| Student portal & eligibility | `renderDaftarJadwal` | `loginSiswaAPI` | StudentController/ExamService | IN PROGRESS |
| Start/resume/timer | `persiapkanUjian` | `getServerSoal` | ExamSessionService | IN PROGRESS |
| Autosave/restore/ragu | CBT functions | `simpanJawabanServer` | AnswerService | IN PROGRESS |
| Anti-cheat/terminate | `visibilitychange` | `catatPelanggaranServer` | ViolationService | IN PROGRESS |
| Submit/scoring/review | result views | `submitUjian`, review | ScoringService | IN PROGRESS |
| Admin dashboard | admin overview | stats | AdminController | IMPLEMENTED / NOT VERIFIED |
| Student CBT state/sync | student tab | student functions | SyncController | IN PROGRESS |
| Exam/question CRUD/import | admin tabs | CRUD/import functions | AdminController/AdminService | IMPLEMENTED / NOT VERIFIED |
| Results/violations/reports/cards | admin tabs/print | result/log functions | AdminController/AdminRepository | IMPLEMENTED / NOT VERIFIED |
| Staff account/password | account modal | account functions | AuthController/AdminController | IMPLEMENTED / NOT VERIFIED |
| Teacher assignment | admin tab | assignment functions | AdminController | IMPLEMENTED / NOT VERIFIED |
| Teacher login by Portal NIP | separate `/guru` page | new HTTP API | AuthController/AuthService | IMPLEMENTED / NOT VERIFIED |
| Separate teacher dashboard | separate `/guru/dashboard` page | teacher result mapping | TeacherController | IMPLEMENTED / NOT VERIFIED |
| Portal Data sync/fallback | none | none | PortalDataSyncService | IN PROGRESS |
