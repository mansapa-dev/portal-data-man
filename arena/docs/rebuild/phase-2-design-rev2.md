# Arena CBT — Phase 2 Design Review, Revision 2

**Status:** design review proposal; not approved for implementation. Documentation only. No application code, migration, database, configuration, service, Nginx, or deployment was changed. Existing local changes remain untouched.

Related: [Revision 2 ERD](./erd-rev2.mmd), [Revision 1 design](./phase-2-design.md), [architecture proposal](./architecture-proposal.md).

## Executive findings by risk

| Risk | Finding | Revision 2 treatment / remaining gate |
|---|---|---|
| **Critical** | Revision 1 used independent FKs for attempt, question snapshot, answer, result, and selected-result IDs. A valid attempt ID and valid snapshot ID could still refer to different attempts; a result could refer to a different assignment/student. | Add candidate composite keys and composite FKs carrying `assignment_id`, `student_id`, `attempt_id`, and snapshot IDs through the entire relation chain. Cross-row state rules (for example only select a GRADED result) are enforced in locked transactions and tested because a simple FK/CHECK cannot express them. |
| **Critical** | Submit, save, expiry, and grading worker could race. The design named transactions but did not define a single lock order, commit boundary, or ambiguous-commit recovery. | All answer/submit/expiry operations lock the same attempt row first. Store mutation receipts, submission receipt, result, and grading job in transactional boundaries. Retry unknown commit outcomes by querying the same idempotency key before reapplying. |
| **High** | Eligibility time was unspecified; a current class join could silently change which class qualified after sync. | Publish materializes an immutable per-student eligibility row including student, NISN/name, class, grade, academic year/semester, source IDs, basis, and timestamp. Attempt FK must point to that exact row. Publication snapshot time is the eligibility cut-off (proposal; approval needed). |
| **High** | `EXAMS` and `EXAM_ASSIGNMENTS` each had overlapping availability/status concepts. | `EXAMS` becomes an authoring blueprint (`DRAFT`, `READY`, `ARCHIVED`). Only `EXAM_ASSIGNMENTS` controls delivery (`DRAFT`, `PUBLISHED`, `PAUSED`, `CLOSED`, `CANCELLED`, `ARCHIVED`). `OPEN`/`SCHEDULED` are derived from PUBLISHED + server UTC window, not separately stored. |
| **High** | Revision 1 result pointer could point to another student's/assignment's attempt; grading/manual edits and publication were not separated. | `exam_results` is per attempt; `selected_exam_results` points to a result plus the same attempt/assignment/student using composite FKs; only GRADED results may be selected/published in a transaction. Each attempt result remains preserved. Selection/publication rules require school approval. |
| **High** | A missing answer row, a cleared answer, and an uninitialized mutation ID were ambiguous. | No `answers` row means never saved. Text answers use `NULL` only for choice types; an explicitly cleared text answer is `''`. A flagged unanswered question is a durable row with no selected options or empty text. Every persisted answer has a non-null mutation UUID and revision, backed by a receipt. |
| **High** | `UNIQUE(students.nisn)` could make otherwise valid source records impossible to sync if Portal Data contains duplicate/missing NISN. | External identity remains `UNIQUE(source_id,source_student_id)`. A separate login identity binds one unique, non-null NISN to one student. Duplicate NISN source records are retained but quarantined from login until resolved; never merge by NISN. Confirm school data-quality policy. |
| **High** | Current class enrollment endpoint does not expose authoritative history or enrollment effective dates. | Preserve observed enrollment history by student/class/semester, but label observations as observations. Assignment snapshot is the exam's authoritative academic context. Full historical reconstruction requires Portal Data contract support. |
| **High** | Target MySQL server version is unknown; the draft used `CHECK`, JSON, and generated-column uniqueness. | Local repository's demo setup pins `mysql:8.4`; README also says MySQL 8/MariaDB. Local command reports a MariaDB client, not the production server. No production connection was made. Design uses MySQL 8.4-compatible InnoDB features; production compatibility remains **unverified**. Do not proceed until version/engine are confirmed read-only. |
| **Medium** | Revision 1 put order in JSON while also needing stable option identity, and did not enforce selected options belong to the question being answered. | Add normalized per-attempt question/option snapshots and a selected-option junction with composite FKs to the same question snapshot. Randomization is fixed when an attempt starts. |
| **Medium** | Proposed indexes and a 20-connection pool/500-queue inherited assumptions without a measured shared-VPS budget. | Derive indexes from listed queries; start with one bounded API pool and one low-concurrency worker, and size only after measuring MySQL max connections and PHP peak. Reject/back-pressure when bounded queue is full. |
| **Medium** | Scoring, tie-breaks, partial credit, rounding, and termination disposition were suggestions but not approved school rules. | Preserve raw points and each attempt result. Mark formula, rounding, score selection, and terminated-attempt treatment as owner decisions; no school rule is inferred. |
| **Low** | Some catalog indexes were duplicate or not tied to a named workload; duplicate `actor` relations and vague nullable declarations reduced reviewability. | Revision 2 identifies each query-backed index and gives nullability and delete behavior per table. |

## 1. Scope, decisions retained, and assumptions

### Retained foundation

Fastify, strict TypeScript, React, Vite, MySQL, a modular monolith, a new isolated database, a replaceable Portal Data academic adapter, student NISN + local PIN, teacher/employee Portal Data OIDC, immutable attempt history, server-authoritative exam behavior, and no capacity claim before representative tests.

### Proposed semantics—not yet approved

1. Eligibility is frozen when an assignment is published. A student must also have an active local account when starting. A later class move does not add/remove eligibility for that published assignment; an administrator must cancel/reissue or create a new assignment if the roster should change.
2. Main attempt is unique per `(assignment_id, student_id)`. Any additional attempt requires a one-use authorization row and is never a mutation/reopen of an old attempt.
3. `PUBLISHED` plus `starts_at <= UTC_TIMESTAMP(3) < ends_at` means starts are open. `PAUSED/CLOSED/CANCELLED` always blocks new attempts.
4. All state that must be consistent across related rows is changed in one InnoDB transaction. All attempt writers/finalizers lock rows in the order: assignment (only when changing assignment policy/extra count), attempt, answer, then receipt/result/job rows. A grading job is claimed in a separate short transaction and committed before grading; its completion transaction locks attempt, result, then job.
5. An EXPIRED/TERMINATED/CANCELLED attempt keeps answers. No new answer writes are accepted. Whether its stored answers are graded or count in selected results is a separate approved policy.
6. Manual grading changes append immutable `exam_result_revisions` snapshots/events. Do not discard the earlier score.
7. API user IDs are opaque public IDs; internal BIGINT keys remain private.

### Academic source verified from repository

The Portal Data CBT routes use OAuth client credentials and scope `portal_data.read`, have a `120/minute` throttle, and expose `/api/v1/integration/cbt/{revisions,academic-years,semesters,students,teachers,employees,classes}`. Paginated Laravel responses serialize their paginator inside `data` with `data.data[]`, `data.current_page`, `data.last_page`, `data.per_page`, and `data.total`. The student API returns current enrollment and active rows; it does not establish a complete effective-dated enrollment history. No SIPADU API contract is inferred.

### MySQL compatibility verification (non-production)

Repository inspection found `arena/scripts/setup-local-demo.sh` uses `mysql:8.4`; `arena/README.md` also permits “MySQL 8/MariaDB”. The local `mysql --version` command identifies a MariaDB client and says nothing conclusive about the server used by production. No production host/database was queried or changed.

MySQL 8.4 documentation supports native JSON columns, enforced CHECK constraints, generated columns, unique indexes involving generated columns, and InnoDB locking reads. MySQL CHECK enforcement starts at 8.0.16. However, the actual target server/version/engine and SQL mode are unknown; MariaDB compatibility is not assumed. Before schema approval, the owner/operator must provide the output of read-only `SELECT VERSION(), @@version_comment, @@default_storage_engine, @@sql_mode` from the intended **new/staging** target, or approve an equivalent non-production verification. Minimum proposal: Oracle MySQL 8.4.x, InnoDB, CHECK constraints enforced. If target differs, redesign/re-test affected generated-column/CHECK features rather than silently lowering guarantees. [MySQL CHECK constraints](https://dev.mysql.com/doc/refman/8.4/en/create-table-check-constraints.html), [generated-column indexes](https://dev.mysql.com/doc/refman/8.4/en/create-table-secondary-indexes.html), [JSON type](https://dev.mysql.com/doc/refman/8.4/en/data-types.html), [locking reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html), [CHECK enforcement introduced in 8.0.16](https://dev.mysql.com/doc/refman/8.0/en/check-constraints.html).

## 2. Revised ERD

The complete module ERD is [erd-rev2.mmd](./erd-rev2.mmd). Composite-key requirements are called out below; the diagram's entity arrows show logical relationships while this catalog defines the exact candidate keys/FKs. All relationships default to `ON DELETE RESTRICT`; only diagnostic sync issue rows may cascade with their parent run. History is not hard-deleted.

## 3. Revised table catalog and relational integrity

Notation: `NN` = `NOT NULL`; `NULL` = nullable; `PK` = primary key; `UK` = unique constraint; `IX` = non-unique index. Unless stated otherwise: InnoDB, `utf8mb4`, internal `BIGINT UNSIGNED` PK, and `created_at DATETIME(3) NN DEFAULT CURRENT_TIMESTAMP(3)`. Mutable tables also have `updated_at DATETIME(3) NN`. `CHECK` constraints listed are required to be enforced. Composite FK column order must exactly match the referenced candidate key.

### Academic provider and sync

| Table | Columns (type + nullability) | PK / UK / indexes | Foreign keys and rules |
|---|---|---|---|
| `academic_sources` | `id BIGINT UNSIGNED NN`; `provider_key VARCHAR(64) NN`; `display_name VARCHAR(120) NN`; `status ENUM('ACTIVE','DISABLED') NN`; timestamps | PK(id); UK(provider_key) | Provider key is configuration identity, not a secret. |
| `academic_sync_runs` | `id BIGINT UNSIGNED NN`; `source_id BIGINT UNSIGNED NN`; `entity_type ENUM('STUDENTS','TEACHERS','EMPLOYEES','CLASSES','ACADEMIC_YEARS','SEMESTERS') NN`; `status ENUM('RUNNING','SUCCESS','PARTIAL','ABORTED','FAILED') NN`; generated stored `active_guard VARCHAR(110) NULL = CASE WHEN status='RUNNING' THEN CONCAT(source_id,':',entity_type) ELSE NULL END`; `revision_before CHAR(64) NULL`; `revision_after CHAR(64) NULL`; page/seen/inserted/updated/deactivated/rejected counters `INT UNSIGNED NN DEFAULT 0`; `initiated_by_user_id BIGINT UNSIGNED NULL`; `started_at DATETIME(3) NN`; `finished_at DATETIME(3) NULL`; `error_summary VARCHAR(500) NULL`; created_at | PK(id); UK(active_guard); IX(source_id,entity_type,started_at); IX(status,started_at) | FK(source_id)→academic_sources(id) RESTRICT; FK(actor)→users(id) SET NULL. Unique non-null active_guard prevents overlap without holding a DB connection while calling Portal Data. Never store access token or source body. |
| `academic_sync_issues` | `id BIGINT UNSIGNED NN`; `sync_run_id BIGINT UNSIGNED NN`; `source_record_key VARCHAR(128) NULL`; `field_name VARCHAR(100) NULL`; `severity ENUM('WARNING','ERROR') NN`; `safe_message VARCHAR(500) NN`; created_at | PK(id); IX(sync_run_id,id); IX(source_record_key) | FK(sync_run_id)→academic_sync_runs(id) CASCADE. Message must not contain PIN/token/answer. |

**Sync commit/reconciliation rule:** adapter fetches and validates the complete pagination set outside a DB transaction, checks page continuity/counts and source revision before/after, then applies the validated delta in one bounded database transaction (chunking statements inside that same transaction if needed). Mark the run SUCCESS and reconcile/deactivate missing records only in that commit, and only when rejected rows=0 and the source contract defines completeness. Any incomplete fetch, revision drift, validation error, or transaction failure marks the run PARTIAL/ABORTED and performs no deactivation; retry replays idempotent provider-key upserts. `UK(active_guard)` serializes one RUNNING job per source/entity across processes; expired worker leases need a watchdog transition to ABORTED before another run starts.

### Academic reference and identity

| Table | Columns (type + nullability) | PK / UK / indexes | Foreign keys and rules |
|---|---|---|---|
| `students` | `id BIGINT UNSIGNED NN`; `source_id BIGINT UNSIGNED NN`; `source_student_id VARCHAR(64) NN`; `nisn_source VARCHAR(20) NULL`; `full_name VARCHAR(191) NN`; `source_status VARCHAR(32) NN`; `is_active BOOLEAN NN`; `last_seen_sync_id BIGINT UNSIGNED NULL`; timestamps | PK(id); UK(source_id,source_student_id); IX(nisn_source); IX(is_active,id) | FK(source_id)→academic_sources RESTRICT; FK(last_seen_sync_id)→academic_sync_runs SET NULL. NISN deliberately not unique here: retain conflicting source identities without merging. |
| `student_login_identities` | `student_id BIGINT UNSIGNED NN`; `nisn VARCHAR(20) NN`; `pin_hash VARCHAR(255) NN`; `hash_algorithm ENUM('ARGON2ID','BCRYPT') NN`; `status ENUM('ACTIVE','SUSPENDED','RESET_REQUIRED') NN`; `failed_count SMALLINT UNSIGNED NN DEFAULT 0`; `throttled_until DATETIME(3) NULL`; `changed_at DATETIME(3) NN`; `changed_by_user_id BIGINT UNSIGNED NULL`; timestamps | PK(student_id); UK(nisn); IX(status,throttled_until) | FK(student_id)→students RESTRICT; FK(changed_by_user_id)→users SET NULL. Exactly one login NISN per student; duplicate current source NISN is quarantined and not auto-bound. No plaintext PIN. |
| `teachers` | `id BIGINT UNSIGNED NN`; `source_id BIGINT UNSIGNED NN`; `source_teacher_id VARCHAR(64) NN`; `nip VARCHAR(32) NULL`; `nuptk VARCHAR(32) NULL`; `full_name VARCHAR(191) NN`; `source_status VARCHAR(32) NN`; `is_active BOOLEAN NN`; `last_seen_sync_id BIGINT UNSIGNED NULL`; timestamps | PK(id); UK(source_id,source_teacher_id); IX(nip); IX(nuptk); IX(is_active,full_name) | Source/sync FKs as above. Do not assume NIP/NUPTK globally unique absent source guarantee. |
| `employees` | `id BIGINT UNSIGNED NN`; `source_id BIGINT UNSIGNED NN`; `source_employee_id VARCHAR(64) NN`; `nip VARCHAR(32) NULL`; `employee_number VARCHAR(64) NULL`; `full_name VARCHAR(191) NN`; `position VARCHAR(120) NULL`; `source_status VARCHAR(32) NN`; `is_active BOOLEAN NN`; `last_seen_sync_id BIGINT UNSIGNED NULL`; timestamps | PK(id); UK(source_id,source_employee_id); IX(nip); IX(employee_number); IX(is_active,full_name) | Source/sync FKs as above. |
| `academic_years` | `id BIGINT UNSIGNED NN`; `source_id BIGINT UNSIGNED NN`; `source_year_id VARCHAR(64) NN`; `name VARCHAR(40) NN`; `is_active BOOLEAN NN`; `last_seen_sync_id BIGINT UNSIGNED NULL`; timestamps | PK(id); UK(source_id,source_year_id); IX(is_active,name) | Source/sync FKs. |
| `semesters` | `id BIGINT UNSIGNED NN`; `source_id BIGINT UNSIGNED NN`; `source_semester_id VARCHAR(64) NN`; `academic_year_id BIGINT UNSIGNED NN`; `semester_type ENUM('ODD','EVEN') NN`; `name VARCHAR(80) NULL`; `is_active BOOLEAN NN`; `last_seen_sync_id BIGINT UNSIGNED NULL`; timestamps | PK(id); UK(source_id,source_semester_id); UK(academic_year_id,semester_type); UK(id,academic_year_id); IX(is_active,academic_year_id) | FK(academic_year_id)→academic_years RESTRICT; source/sync FKs. Revisit year/type UK if Portal Data permits multiple same-type semester records. |
| `classes` | `id BIGINT UNSIGNED NN`; `source_id BIGINT UNSIGNED NN`; `source_class_id VARCHAR(64) NN`; `academic_year_id BIGINT UNSIGNED NULL`; `code VARCHAR(64) NULL`; `name VARCHAR(120) NN`; `grade VARCHAR(12) NULL`; `source_status VARCHAR(32) NN`; `is_active BOOLEAN NN`; `last_seen_sync_id BIGINT UNSIGNED NULL`; timestamps | PK(id); UK(source_id,source_class_id); IX(academic_year_id,grade,is_active); IX(name,id) | FK(year)→academic_years SET NULL; source/sync FKs. |
| `student_class_enrollments` | `id BIGINT UNSIGNED NN`; `source_id BIGINT UNSIGNED NN`; `source_enrollment_id VARCHAR(64) NULL`; `student_id BIGINT UNSIGNED NN`; `class_id BIGINT UNSIGNED NN`; `academic_year_id BIGINT UNSIGNED NN`; `semester_id BIGINT UNSIGNED NN`; `status ENUM('ACTIVE','INACTIVE','UNKNOWN') NN`; `first_observed_at DATETIME(3) NN`; `last_observed_at DATETIME(3) NN`; `valid_from DATE NULL`; `valid_to DATE NULL`; timestamps | PK(id); UK(student_id,class_id,semester_id); UK(source_id,source_enrollment_id) (multiple NULL allowed); UK(id,student_id,class_id,academic_year_id,semester_id); IX(class_id,semester_id,status,student_id); IX(student_id,academic_year_id,semester_id,status) | FK(source_id)→academic_sources; FK(student_id)→students; FK(class_id)→classes; FK(year)→academic_years; FK(semester_id,academic_year_id)→semesters(id,academic_year_id); all RESTRICT. Enforce `valid_to IS NULL OR valid_from IS NULL OR valid_to>=valid_from`. This table records observed membership, not authoritative effective-dated history; absent source dates remain NULL. |
| `users` | `id BIGINT UNSIGNED NN`; `username VARCHAR(100) NULL`; `display_name VARCHAR(191) NN`; `password_hash VARCHAR(255) NULL`; `oidc_issuer VARCHAR(255) NULL`; `oidc_subject VARCHAR(255) NULL`; `teacher_id BIGINT UNSIGNED NULL`; `employee_id BIGINT UNSIGNED NULL`; `status ENUM('ACTIVE','DISABLED') NN`; `last_login_at DATETIME(3) NULL`; timestamps | PK(id); UK(username); UK(oidc_issuer,oidc_subject); UK(teacher_id); UK(employee_id); UK(id,teacher_id); UK(id,employee_id); IX(status,display_name) | Teacher/employee FKs RESTRICT. CHECK: issuer/subject both NULL or both NN; teacher_id and employee_id are not both NN. Local admin has password hash + no staff link; OIDC staff account has source link. Exact admin login policy awaits approval. |
| `roles` | `id SMALLINT UNSIGNED NN`; `role_key VARCHAR(32) NN`; `description VARCHAR(160) NN` | PK(id); UK(role_key) | Controlled seed values only. |
| `user_roles` | `user_id BIGINT UNSIGNED NN`; `role_id SMALLINT UNSIGNED NN`; `granted_by BIGINT UNSIGNED NULL`; `created_at DATETIME(3) NN` | PK(user_id,role_id); IX(role_id,user_id) | FK user/role RESTRICT; FK(granted_by)→users SET NULL. |
| `student_sessions` | `id BIGINT UNSIGNED NN`; `student_id BIGINT UNSIGNED NN`; `token_hash BINARY(32) NN`; `csrf_hash BINARY(32) NN`; `created_at DATETIME(3) NN`; `last_seen_at DATETIME(3) NN`; `expires_at DATETIME(3) NN`; `revoked_at DATETIME(3) NULL`; `revoke_reason VARCHAR(80) NULL`; `ua_hash BINARY(32) NULL` | PK(id); UK(token_hash); UK(id,student_id); IX(student_id,revoked_at,expires_at); IX(expires_at) | FK(student_id)→students RESTRICT. Cookie contains random opaque token; DB stores SHA-256 hash. |
| `user_sessions` | Same fields as `student_sessions`, replacing student_id with `user_id BIGINT UNSIGNED NN` | PK(id); UK(token_hash); UK(id,user_id); IX(user_id,revoked_at,expires_at); IX(expires_at) | FK(user_id)→users RESTRICT. |

### Question authoring and exam delivery

| Table | Columns (type + nullability) | PK / UK / indexes | Foreign keys and rules |
|---|---|---|---|
| `subjects` | `id BIGINT UNSIGNED NN`; `code VARCHAR(40) NULL`; `name VARCHAR(120) NN`; `status ENUM('ACTIVE','INACTIVE') NN`; timestamps | PK(id); UK(code); IX(status,name) | Code uniqueness policy must be confirmed; MySQL allows multiple NULL code values. |
| `question_banks` | `id BIGINT UNSIGNED NN`; `subject_id BIGINT UNSIGNED NN`; `name VARCHAR(160) NN`; `description TEXT NULL`; `owner_user_id BIGINT UNSIGNED NN`; `status ENUM('ACTIVE','ARCHIVED') NN`; timestamps | PK(id); IX(subject_id,status,name); IX(owner_user_id,status) | FK(subject_id)→subjects RESTRICT; FK(owner_user_id)→users RESTRICT. Service checks scope. |
| `questions` | `id BIGINT UNSIGNED NN`; `question_bank_id BIGINT UNSIGNED NN`; `question_type ENUM('SINGLE_CHOICE','MULTI_SELECT','SHORT_ANSWER','ESSAY') NN`; `status ENUM('ACTIVE','ARCHIVED') NN`; `created_by BIGINT UNSIGNED NN`; timestamps | PK(id); UK(id,question_bank_id); IX(question_bank_id,status,id) | FK(bank)→question_banks RESTRICT; FK(creator)→users RESTRICT. |
| `question_versions` | `id BIGINT UNSIGNED NN`; `question_id BIGINT UNSIGNED NN`; `version_no INT UNSIGNED NN`; `prompt_json JSON NN`; `grading_config_json JSON NN`; `explanation_json JSON NULL`; `created_by BIGINT UNSIGNED NN`; `created_at DATETIME(3) NN` | PK(id); UK(question_id,version_no); UK(id,question_id); IX(question_id,created_at) | FK(question_id)→questions RESTRICT; FK(created_by)→users RESTRICT. Immutable after use by a published assignment. |
| `question_options` | `id BIGINT UNSIGNED NN`; `question_version_id BIGINT UNSIGNED NN`; `option_key VARCHAR(8) NN`; `content_json JSON NN`; `is_correct BOOLEAN NN`; `display_order SMALLINT UNSIGNED NN`; `created_at DATETIME(3) NN` | PK(id); UK(question_version_id,option_key); UK(id,question_version_id); IX(question_version_id,display_order) | FK(question_version_id)→question_versions RESTRICT. Student projection never selects `is_correct`. |
| `exams` | `id BIGINT UNSIGNED NN`; `public_id BINARY(16) NN`; `title VARCHAR(191) NN`; `subject_id BIGINT UNSIGNED NN`; `instructions_json JSON NULL`; `created_by BIGINT UNSIGNED NN`; `status ENUM('DRAFT','READY','ARCHIVED') NN`; `content_revision INT UNSIGNED NN`; timestamps | PK(id); UK(public_id); UK(id,subject_id); IX(subject_id,status,updated_at); IX(created_by,status) | FK(subject_id)→subjects RESTRICT; FK(created_by)→users RESTRICT. This is an authoring blueprint only; it has no time-window/availability state. |
| `exam_policies` | `exam_id BIGINT UNSIGNED NN`; `result_selection ENUM('PRIMARY_ONLY','LATEST_APPROVED','HIGHEST_APPROVED') NN`; `allow_makeup BOOLEAN NN`; `allow_remedial BOOLEAN NN`; `allow_retake BOOLEAN NN`; `max_extra_attempts SMALLINT UNSIGNED NN`; `randomize_questions BOOLEAN NN`; `randomize_options BOOLEAN NN`; `grade_terminated BOOLEAN NN`; `score_scale DECIMAL(6,2) NN`; `rounding_mode ENUM('HALF_UP','HALF_EVEN','TRUNCATE') NN`; `updated_by BIGINT UNSIGNED NN`; `updated_at DATETIME(3) NN` | PK(exam_id) | FK(exam_id)→exams RESTRICT; FK(updated_by)→users RESTRICT. Values are copied into assignment columns at publication; no JSON duplicate. Semantics require approval. |
| `exam_assignments` | `id BIGINT UNSIGNED NN`; `public_id BINARY(16) NN`; `exam_id BIGINT UNSIGNED NN`; `exam_content_revision INT UNSIGNED NN`; `academic_year_id BIGINT UNSIGNED NN`; `semester_id BIGINT UNSIGNED NN`; `title_snapshot VARCHAR(191) NN`; `subject_id BIGINT UNSIGNED NN`; `starts_at DATETIME(3) NN`; `ends_at DATETIME(3) NN`; `duration_seconds INT UNSIGNED NN`; `result_selection ENUM('PRIMARY_ONLY','LATEST_APPROVED','HIGHEST_APPROVED') NN`; `allow_makeup BOOLEAN NN`; `allow_remedial BOOLEAN NN`; `allow_retake BOOLEAN NN`; `max_extra_attempts SMALLINT UNSIGNED NN`; `randomize_questions BOOLEAN NN`; `randomize_options BOOLEAN NN`; `grade_terminated BOOLEAN NN`; `score_scale DECIMAL(6,2) NN`; `rounding_mode ENUM('HALF_UP','HALF_EVEN','TRUNCATE') NN`; `late_policy ENUM('DB_LOCK_TIME_BEFORE_DEADLINE','SERVER_RECEIPT_BEFORE_DEADLINE') NN`; `status ENUM('DRAFT','PUBLISHED','PAUSED','CLOSED','CANCELLED','ARCHIVED') NN`; `published_at DATETIME(3) NULL`; `published_by BIGINT UNSIGNED NULL`; timestamps | PK(id); UK(public_id); UK(id,exam_id); UK(id,academic_year_id,semester_id); UK(id,exam_id,subject_id); IX(status,starts_at,ends_at); IX(exam_id,semester_id,status) | FK(exam_id,subject_id)→exams(id,subject_id) RESTRICT; FK(academic_year_id)→academic_years; FK(semester_id,academic_year_id)→semesters(id,academic_year_id); FK(published_by)→users SET NULL. CHECK end>start, duration>0, score_scale>0. All delivery policies immutable once PUBLISHED. `OPEN` and `SCHEDULED` are derived, not stored. |
| `exam_assignment_classes` | `assignment_id BIGINT UNSIGNED NN`; `class_id BIGINT UNSIGNED NN`; `created_at DATETIME(3) NN` | PK(assignment_id,class_id); IX(class_id,assignment_id) | FK assignment/class RESTRICT. Draft target criteria; not the final historical roster. |
| `exam_assignment_students` | `id BIGINT UNSIGNED NN`; `assignment_id BIGINT UNSIGNED NN`; `student_id BIGINT UNSIGNED NN`; `academic_year_id BIGINT UNSIGNED NN`; `semester_id BIGINT UNSIGNED NN`; `enrollment_id BIGINT UNSIGNED NULL`; `class_id BIGINT UNSIGNED NULL`; `source_student_id_snapshot VARCHAR(64) NN`; `nisn_snapshot VARCHAR(20) NN`; `student_name_snapshot VARCHAR(191) NN`; `source_class_id_snapshot VARCHAR(64) NULL`; `class_name_snapshot VARCHAR(120) NULL`; `grade_snapshot VARCHAR(12) NULL`; `eligibility_basis ENUM('CLASS','DIRECT','CLASS_AND_DIRECT') NN`; `snapshotted_at DATETIME(3) NN` | PK(id); UK(assignment_id,student_id); UK(id,assignment_id,student_id); IX(student_id,assignment_id); IX(assignment_id,class_id,student_id) | FK(assignment_id,academic_year_id,semester_id)→exam_assignments(id,academic_year_id,semester_id) RESTRICT; FK(student_id)→students RESTRICT; if enrollment_id non-null, class_id/year/semester are NN and composite FK(enrollment_id,student_id,class_id,academic_year_id,semester_id)→student_class_enrollments(id,student_id,class_id,academic_year_id,semester_id); if enrollment_id is NULL, class_id/source-class/class-name/grade snapshot fields are NULL for a direct-only eligibility row. Immutable after assignment publish. |
| `exam_assignment_staff` | `assignment_id BIGINT UNSIGNED NN`; `user_id BIGINT UNSIGNED NN`; `duty_role ENUM('AUTHOR','GRADER','INVIGILATOR') NN`; `created_at DATETIME(3) NN` | PK(assignment_id,user_id,duty_role); IX(user_id,duty_role,assignment_id) | FK assignment/user RESTRICT. Duty scope does not grant platform admin rights. |
| `exam_questions` | `id BIGINT UNSIGNED NN`; `assignment_id BIGINT UNSIGNED NN`; `question_version_id BIGINT UNSIGNED NN`; `points DECIMAL(10,4) NN`; `display_order INT UNSIGNED NN`; `created_at DATETIME(3) NN` | PK(id); UK(assignment_id,display_order); UK(assignment_id,question_version_id); UK(id,assignment_id); IX(question_version_id,assignment_id) | FK(assignment_id)→exam_assignments RESTRICT; FK(question_version_id)→question_versions RESTRICT; CHECK points>0. Immutable after publish. |

### Attempts, answers, grading, and publication

| Table | Columns (type + nullability) | PK / UK / indexes | Foreign keys and rules |
|---|---|---|---|
| `attempt_authorizations` | `id BIGINT UNSIGNED NN`; `public_id BINARY(16) NN`; `assignment_student_id BIGINT UNSIGNED NN`; `assignment_id BIGINT UNSIGNED NN`; `student_id BIGINT UNSIGNED NN`; `parent_attempt_id BIGINT UNSIGNED NULL`; `attempt_kind ENUM('MAKEUP','REMEDIAL','RETAKE') NN`; `reason VARCHAR(1000) NN`; `valid_from DATETIME(3) NN`; `valid_until DATETIME(3) NN`; `deadline_at DATETIME(3) NN`; `approved_by_user_id BIGINT UNSIGNED NN`; `revoked_at DATETIME(3) NULL`; `created_at DATETIME(3) NN` | PK(id); UK(public_id); UK(id,assignment_id,student_id,attempt_kind); IX(assignment_id,student_id,revoked_at,valid_from); IX(approved_by_user_id,created_at) | FK(assignment_student_id,assignment_id,student_id)→exam_assignment_students(id,assignment_id,student_id) RESTRICT; FK(parent_attempt_id,assignment_id,student_id)→exam_attempts(id,assignment_id,student_id) RESTRICT; FK(approved_by_user_id)→users RESTRICT; CHECK valid_from<valid_until and deadline_at<=valid_until. Service verifies approver's role/scope and policy. |
| `exam_attempts` | `id BIGINT UNSIGNED NN`; `public_id BINARY(16) NN`; `assignment_student_id BIGINT UNSIGNED NN`; `assignment_id BIGINT UNSIGNED NN`; `student_id BIGINT UNSIGNED NN`; `attempt_kind ENUM('MAIN','MAKEUP','REMEDIAL','RETAKE') NN`; `authorization_id BIGINT UNSIGNED NULL`; `parent_attempt_id BIGINT UNSIGNED NULL`; `status ENUM('IN_PROGRESS','SUBMITTED','EXPIRED','TERMINATED','CANCELLED') NN`; `started_at DATETIME(3) NN`; `deadline_at DATETIME(3) NN`; `terminal_at DATETIME(3) NULL`; `terminal_reason VARCHAR(500) NULL`; `created_at DATETIME(3) NN`; `updated_at DATETIME(3) NN`; generated stored `main_student_guard BIGINT UNSIGNED NULL = CASE WHEN attempt_kind='MAIN' THEN student_id ELSE NULL END` | PK(id); UK(public_id); UK(id,assignment_id); UK(id,assignment_id,student_id); UK(assignment_id,main_student_guard); UK(authorization_id); IX(student_id,assignment_id,status); IX(assignment_id,status,deadline_at); IX(status,deadline_at) | FK(assignment_student_id,assignment_id,student_id)→exam_assignment_students; FK(authorization_id,assignment_id,student_id,attempt_kind)→attempt_authorizations(id,assignment_id,student_id,attempt_kind); FK(parent_attempt_id,assignment_id,student_id)→exam_attempts(id,assignment_id,student_id); all RESTRICT. CHECK MAIN iff authorization NULL; extra kind iff authorization NN; deadline>started_at. Generated unique permits one MAIN and multiple NULL extra guards; extras are separately unique by authorization. |
| `attempt_question_snapshots` | `id BIGINT UNSIGNED NN`; `attempt_id BIGINT UNSIGNED NN`; `assignment_id BIGINT UNSIGNED NN`; `exam_question_id BIGINT UNSIGNED NN`; `display_order INT UNSIGNED NN`; `question_type ENUM('SINGLE_CHOICE','MULTI_SELECT','SHORT_ANSWER','ESSAY') NN`; `prompt_json JSON NN`; `private_grading_json JSON NN`; `points DECIMAL(10,4) NN`; `created_at DATETIME(3) NN` | PK(id); UK(attempt_id,exam_question_id); UK(attempt_id,id); UK(id,attempt_id,assignment_id); IX(attempt_id,display_order) | FK(attempt_id,assignment_id)→exam_attempts(id,assignment_id); FK(exam_question_id,assignment_id)→exam_questions(id,assignment_id); RESTRICT. Ensures source question is from that same attempt assignment. No answer key in prompt_json. |
| `attempt_question_options` | `id BIGINT UNSIGNED NN`; `public_id BINARY(16) NN`; `attempt_question_id BIGINT UNSIGNED NN`; `display_key VARCHAR(8) NN`; `content_json JSON NN`; `is_correct BOOLEAN NN`; `display_order SMALLINT UNSIGNED NN`; `created_at DATETIME(3) NN` | PK(id); UK(public_id); UK(id,attempt_question_id); UK(attempt_question_id,id); UK(attempt_question_id,display_key); UK(attempt_question_id,display_order) | FK(attempt_question_id)→attempt_question_snapshots RESTRICT. `is_correct` is private; clients post opaque option public IDs and server maps them to the same snapshot. |
| `answers` | `id BIGINT UNSIGNED NN`; `attempt_id BIGINT UNSIGNED NN`; `attempt_question_id BIGINT UNSIGNED NN`; `answer_text LONGTEXT NULL`; `is_flagged BOOLEAN NN`; `revision BIGINT UNSIGNED NN`; `last_mutation_id BINARY(16) NN`; `saved_at DATETIME(3) NN`; `updated_at DATETIME(3) NN` | PK(id); UK(attempt_question_id); UK(id,attempt_id,attempt_question_id); UK(attempt_id,attempt_question_id,last_mutation_id); IX(attempt_id,saved_at) | FK(attempt_id,attempt_question_id)→attempt_question_snapshots(attempt_id,id); FK(attempt_id,attempt_question_id,last_mutation_id)→answer_write_receipts(attempt_id,attempt_question_id,mutation_id); RESTRICT. Absence of row=never saved. Choice type has NULL text + zero/more selected-option rows; text type uses non-NULL text (empty string=blank). A saved flag may create a blank answer row. |
| `answer_selected_options` | `answer_id BIGINT UNSIGNED NN`; `attempt_id BIGINT UNSIGNED NN`; `attempt_question_id BIGINT UNSIGNED NN`; `attempt_option_id BIGINT UNSIGNED NN`; `created_at DATETIME(3) NN` | PK(answer_id,attempt_option_id); IX(attempt_id,attempt_question_id,attempt_option_id) | FK(answer_id,attempt_id,attempt_question_id)→answers(id,attempt_id,attempt_question_id) RESTRICT; FK(attempt_option_id,attempt_question_id)→attempt_question_options(id,attempt_question_id) RESTRICT. Enforces selected option belongs to same answer/question. Used only for choice types; type validation is application-level. |
| `answer_write_receipts` | `id BIGINT UNSIGNED NN`; `attempt_id BIGINT UNSIGNED NN`; `attempt_question_id BIGINT UNSIGNED NN`; `mutation_id BINARY(16) NN`; `request_hash BINARY(32) NN`; `result_revision BIGINT UNSIGNED NN`; `created_at DATETIME(3) NN` | PK(id); UK(attempt_id,mutation_id); UK(attempt_id,attempt_question_id,mutation_id); IX(attempt_id,attempt_question_id,created_at) | FK(attempt_id,attempt_question_id)→attempt_question_snapshots(attempt_id,id) RESTRICT. Answer row's last mutation FK ensures it references a receipt for the same answer. Retry retention must cover exam recovery and audit period. |
| `submission_receipts` | `id BIGINT UNSIGNED NN`; `attempt_id BIGINT UNSIGNED NN`; `idempotency_key BINARY(16) NN`; `final_manifest_hash BINARY(32) NN`; `submitted_at DATETIME(3) NN`; `receipt_payload_json JSON NN`; `created_at DATETIME(3) NN` | PK(id); UK(attempt_id); UK(idempotency_key); UK(id,attempt_id) | FK(attempt_id)→exam_attempts RESTRICT. Created atomically with SUBMITTED status, result row, and grading job. No receipt means submission did not commit. |
| `grading_jobs` | `id BIGINT UNSIGNED NN`; `attempt_id BIGINT UNSIGNED NN`; `status ENUM('PENDING','CLAIMED','RETRY','DONE','FAILED') NN`; `attempt_count SMALLINT UNSIGNED NN DEFAULT 0`; `available_at DATETIME(3) NN`; `lease_until DATETIME(3) NULL`; `worker_id VARCHAR(80) NULL`; `last_error_safe VARCHAR(500) NULL`; timestamps | PK(id); UK(attempt_id); IX(status,available_at,id); IX(status,lease_until) | FK(attempt_id)→exam_attempts RESTRICT. Internal delivery state only; one bounded worker claim at a time. |
| `exam_results` | `id BIGINT UNSIGNED NN`; `attempt_id BIGINT UNSIGNED NN`; `assignment_id BIGINT UNSIGNED NN`; `student_id BIGINT UNSIGNED NN`; `grading_status ENUM('QUEUED','AUTO_GRADING','NEEDS_MANUAL','GRADED','FAILED') NN`; `earned_points DECIMAL(12,4) NULL`; `maximum_points DECIMAL(12,4) NN`; `score DECIMAL(8,4) NULL`; `revision INT UNSIGNED NN DEFAULT 1`; `graded_at DATETIME(3) NULL`; `created_at DATETIME(3) NN`; `updated_at DATETIME(3) NN` | PK(id); UK(attempt_id); UK(id,attempt_id); UK(id,attempt_id,assignment_id,student_id); IX(assignment_id,student_id,grading_status); IX(grading_status,updated_at) | FK(attempt_id,assignment_id,student_id)→exam_attempts(id,assignment_id,student_id) RESTRICT; CHECK maximum_points>0; score/earned points nullable until grading completes. Each result row is the current grading projection for an attempt; every human regrade appends a separate immutable `exam_result_revisions` row and audit event before updating this projection. |
| `exam_result_items` | `id BIGINT UNSIGNED NN`; `result_id BIGINT UNSIGNED NN`; `attempt_id BIGINT UNSIGNED NN`; `attempt_question_id BIGINT UNSIGNED NN`; `answer_id BIGINT UNSIGNED NULL`; `earned_points DECIMAL(10,4) NULL`; `grading_status ENUM('AUTO_GRADED','NEEDS_MANUAL','MANUALLY_GRADED') NN`; `feedback_json JSON NULL`; `graded_by_user_id BIGINT UNSIGNED NULL`; `graded_at DATETIME(3) NULL`; `created_at DATETIME(3) NN` | PK(id); UK(result_id,attempt_question_id); IX(grading_status,graded_at); UK(id,result_id) | FK(result_id,attempt_id)→exam_results(id,attempt_id); FK(attempt_id,attempt_question_id)→attempt_question_snapshots(attempt_id,id); FK(answer_id,attempt_id,attempt_question_id)→answers(id,attempt_id,attempt_question_id) when answer_id non-null; FK(grader)→users SET NULL. This forbids result item/snapshot/answer cross-attempt mismatch. Manual changes append a result revision and item-level audit data; do not overwrite the historical revision. |
| `exam_result_revisions` | `id BIGINT UNSIGNED NN`; `result_id BIGINT UNSIGNED NN`; `revision_no INT UNSIGNED NN`; `earned_points DECIMAL(12,4) NN`; `maximum_points DECIMAL(12,4) NN`; `score DECIMAL(8,4) NN`; `reason VARCHAR(1000) NN`; `changed_by_user_id BIGINT UNSIGNED NN`; `created_at DATETIME(3) NN` | PK(id); UK(result_id,revision_no); IX(changed_by_user_id,created_at) | FK(result_id)→exam_results RESTRICT; FK(changed_by_user_id)→users RESTRICT. Immutable score snapshots; item-level before/after detail belongs in audit metadata subject to data-retention/privacy approval. |
| `selected_exam_results` | `assignment_id BIGINT UNSIGNED NN`; `student_id BIGINT UNSIGNED NN`; `attempt_id BIGINT UNSIGNED NN`; `result_id BIGINT UNSIGNED NN`; `selected_at DATETIME(3) NN`; `selected_by_user_id BIGINT UNSIGNED NULL`; `published_at DATETIME(3) NULL`; `published_by_user_id BIGINT UNSIGNED NULL`; `selection_revision INT UNSIGNED NN`; `updated_at DATETIME(3) NN` | PK(assignment_id,student_id); UK(attempt_id); IX(assignment_id,published_at,student_id) | FK(attempt_id,assignment_id,student_id)→exam_attempts(id,assignment_id,student_id); FK(result_id,attempt_id,assignment_id,student_id)→exam_results(id,attempt_id,assignment_id,student_id); FK(assignment_id,student_id)→exam_assignment_students(assignment_id,student_id); actors→users. CHECK published_at and published_by_user_id are both NULL or both NN. Automatic selection may leave selected_by_user_id NULL. Selection policy is read from immutable assignment; state GRADED and approved eligibility checked under lock before selection/publication; students see only rows where published_at IS NOT NULL. |
| `audit_logs` | `id BIGINT UNSIGNED NN`; `actor_user_id BIGINT UNSIGNED NULL`; `actor_student_id BIGINT UNSIGNED NULL`; `action VARCHAR(80) NN`; `entity_type VARCHAR(60) NN`; `entity_id VARCHAR(80) NN`; `request_id BINARY(16) NULL`; `safe_metadata_json JSON NULL`; `created_at DATETIME(3) NN` | PK(id); IX(created_at,id); IX(entity_type,entity_id,created_at); IX(actor_user_id,created_at); IX(actor_student_id,created_at) | Actor FKs SET NULL; CHECK at most one actor. Append-only. Never include PIN, session token, answer body, or answer key. |

### Required candidate keys for composite FKs

The catalog intentionally requires these additional candidate keys even when a leading ID is already globally unique: `student_class_enrollments(id,student_id,class_id,academic_year_id,semester_id)`; `semesters(id,academic_year_id)`; `exams(id,subject_id)`; `exam_assignments(id,academic_year_id,semester_id)`, `(id,exam_id)`, and `(id,exam_id,subject_id)`; `exam_assignment_students(id,assignment_id,student_id)` and `(assignment_id,student_id)`; `exam_attempts(id,assignment_id)` and `(id,assignment_id,student_id)`; `attempt_authorizations(id,assignment_id,student_id,attempt_kind)`; `exam_questions(id,assignment_id)`; `attempt_question_snapshots(attempt_id,id)` and `(id,attempt_id,assignment_id)`; `attempt_question_options(id,attempt_question_id)`; `answers(id,attempt_id,attempt_question_id)`; `answer_write_receipts(attempt_id,attempt_question_id,mutation_id)`; `submission_receipts(id,attempt_id)`; `exam_results(id,attempt_id)` and `(id,attempt_id,assignment_id,student_id)`; `users(id,teacher_id)` and `(id,employee_id)`. The complete candidate-key list also includes the UKs explicitly listed in each table row. Some FKs need key variants in different column orders; exact column order must match final FK declarations.

**Business checks not expressible as ordinary FKs:** result status must be GRADED before selected/published; role must authorize action; attempt authorization must be unused and within validity/deadline; exam must have at least one question and an eligible roster; answer payload must match question type; submitted attempt must have exactly one submission receipt, result, and grading job. These are guarded by transaction/service code plus integration tests. No trigger is proposed until reviewed.

## 4. Eligibility snapshot and enrollment policy

1. Teachers/admin edit target class and direct-student rules while assignment is DRAFT.
2. Publishing runs in a transaction: lock assignment; validate it and the blueprint revision; read active students/enrollments from Arena's local academic replica; resolve class/direct eligibility; reject duplicate/ambiguous login identity or missing required academic context; insert one immutable `exam_assignment_students` snapshot per eligible student.
3. Store source student ID, NISN, name, class source ID/name, grade, academic year, semester, eligibility basis, and `snapshotted_at`. When a class-based eligibility row has authoritative local enrollment, composite FK ties it to the same student/class/year/semester. Direct assignment may have a null enrollment/class snapshot, but retains student/source identity and period snapshot.
4. Commit roster, exam question version rows, assignment policy, status=PUBLISHED, and `published_at` together. If any validation/insert fails, no partial publication.
5. Attempt start checks the frozen roster FK, active student/account, assignment status/time, attempt limits, and approved authorization. It does not re-evaluate current class membership. A user moved after publish retains that assignment's historical context; the owner must explicitly cancel/reissue if school policy instead requires live eligibility. The frozen row stores source student ID as snapshot metadata; the student FK ensures it still refers to that source student and provider identity cannot silently change.
6. Later syncs append/update current academic state, never edit assignment snapshots, attempt snapshots, answers, or result history. If an upstream revision changes during sync, that run cannot deactivate records or trigger roster changes.

Enrollment rows are observations because Portal Data's verified student endpoint supplies current enrollment but not effective dates/history. `source_id + source_student_id` is the stable student source key. Enrollment uniqueness on `(student_id,class_id,semester_id)` treats a repeated sync observation as the same relationship; if the provider supplies a stable enrollment ID, its unique source key is used as well. Do not infer a class move's effective date from when sync observed it. NISN is an authentication identifier with a unique constraint on `student_login_identities`, not the source primary key. On NISN collision, preserve both students, quarantine login mapping, and require authorized manual resolution/audit; never merge/delete records automatically.

## 5. State machines and attempt rules

The table below gives the proposed lifecycle for exams, assignments, attempts, submission, grading, and publication. Status columns and the publication pointer are authoritative; time-window labels such as OPEN are derived.

### Exam blueprint (`exams`)

| From | To | Actor/condition |
|---|---|---|
| DRAFT | READY | Authorized author validates required subject/content/policy. |
| READY | DRAFT | Authorized author edits blueprint; increments `content_revision`; published assignments remain unchanged. |
| DRAFT/READY | ARCHIVED | Admin/owner; prevents new assignments, does not alter existing assignments. |
| ARCHIVED | — | Terminal in proposal; restore policy requires approval. |

Blueprint state never means “currently available to students.”

### Assignment (`exam_assignments`)

| From | To | Actor/condition |
|---|---|---|
| DRAFT | PUBLISHED | Author/admin publishes complete roster, question/version snapshot, schedule, and policy atomically. |
| PUBLISHED | PAUSED | Admin/authorized owner; blocks new starts. Running attempts continue at their existing deadlines in this proposal. |
| PAUSED | PUBLISHED | Admin/authorized owner; only before `ends_at`; does not extend existing deadlines. |
| PUBLISHED/PAUSED | CLOSED | Admin/authorized owner or final close policy; blocks new starts; running attempts continue until own deadline unless explicitly terminated. |
| DRAFT/PUBLISHED/PAUSED | CANCELLED | Admin only with reason; blocks starts. Existing attempts remain and follow termination/grading policy. |
| CLOSED/CANCELLED | ARCHIVED | Admin; read-only history. |

Availability is derived: assignment status is PUBLISHED **and** `starts_at <= DB_UTC_NOW < ends_at`. No stored SCHEDULED or OPEN statuses. Scheduler may notify/aggregate but cannot be availability authority.

### Attempt rules

| Kind | Creation rule | Deadline | Prior attempt/result | Counts as selected? |
|---|---|---|---|---|
| MAIN | At most one per assignment/student, enforced by generated nullable guard unique key. Started only from frozen roster. | `min(started_at + duration_seconds, assignment.ends_at)` | Immutable. | According to assignment result policy; proposed default PRIMARY_ONLY. |
| MAKEUP | Single-use authorization created by assigned teacher/admin with reason and valid window. | Authorization hard deadline and assignment window, whichever is earlier; duration semantics require approval. | Parent link optional/required by school policy; never reopens main. | Only if selection policy permits and attempt is approved/included. |
| REMEDIAL | Single-use authorization after criteria are verified by assigned teacher/admin; reason required. | Authorization deadline; must not exceed explicit schedule limit. | Main score retained. | Per assignment policy; no automatic cap/rule assumed. |
| RETAKE | Single-use authorization; reason and parent attempt required in proposal. | Authorization deadline/window. | All previous attempts retained. | Per assignment policy. |

For all extras, lock assignment/student scope, check policy and current count, insert authorization + audit in one transaction. On start, lock authorization, ensure not revoked/expired/used, then insert attempt referencing the exact assignment/student/kind authorization and commit together. Unique authorization FK prevents reuse. Max-extra count must also be transactionally checked; user approval needed for its value and whether failed/cancelled attempts consume the count.

### Attempt and submission states

| From | To | Trigger / result |
|---|---|---|
| (none) | IN_PROGRESS | Eligible start creates one attempt and immutable question/option snapshots in one transaction. Duplicate start returns same MAIN attempt. |
| IN_PROGRESS | SUBMITTED | Valid student/admin force-submit transaction commits submission receipt, result placeholder, grading job; answer writes thereafter rejected. |
| IN_PROGRESS | EXPIRED | Request detects DB time >= deadline or finalizer claims expired attempt; no resume/write; stored answers preserved. |
| IN_PROGRESS | TERMINATED | Explicit approved integrity/authorized action; reason and actor audited; no further writes. Grade/include policy remains owner decision. |
| IN_PROGRESS | CANCELLED | Admin-only, reason required; terminal; does not delete rows or free MAIN guard/authorization. Any replacement must use a new explicit authorization. |
| SUBMITTED/EXPIRED/TERMINATED/CANCELLED | — | Terminal; never reopened or overwritten. A new approved extra creates a new row. |

`submission_receipts` exist only for a committed SUBMITTED transition. EXPIRED/TERMINATED/CANCELLED outcomes use audit/terminal fields, not a fake student submission receipt. Expired attempts may receive a grading result from stored answers only if approved policy allows it.

### Grading and publication states

`exam_results.grading_status`: `QUEUED → AUTO_GRADING → GRADED`; `AUTO_GRADING → NEEDS_MANUAL → GRADED`; recoverable failures set job `RETRY` while result remains non-published; permanent failure sets `FAILED`. Manual grading updates append an `exam_result_revisions` snapshot/event and finalize only when required items are complete. `grading_jobs.status` is worker delivery state (`PENDING → CLAIMED → DONE`, or `CLAIMED → RETRY → CLAIMED`, terminal FAILED after bounded retries), not the user-facing grading truth. `selected_exam_results` is the only visibility pointer; publication is `published_at IS NOT NULL` and requires GRADED result under transaction. Revocation/unpublication is a separate audited admin action; no deletion.

## 6. Scoring, randomization, and permissions

- Store question weights as exact `DECIMAL(10,4)` and aggregate earned/maximum points as exact `DECIMAL(12,4)`. No JS binary floating-point accumulation; use decimal-safe server code or integer scaled units.
- Candidate normalized score: `score_scale × earned_points / maximum_points`, bounded to `[0, score_scale]`. However partial credit, negative marking, blank handling, `score_scale` value, rounding mode, and score cap are **not approved**. Do not hard-code the proposed enum values as school policy.
- `PRIMARY_ONLY`, `LATEST_APPROVED`, and `HIGHEST_APPROVED` are candidate assignment policies. Candidate deterministic tie-break for highest score: earliest submitted timestamp, then lowest internal attempt ID. Owner must approve policy and tie-break; never infer from row update time.
- Question points are copied into immutable `exam_questions` and attempt snapshots. Editing question version or exam policy cannot affect active/history snapshots.
- Question and option order is generated once per attempt, stored by `display_order` rows; stable random seed may be retained as a hash for reproducibility. Do not randomize again on refresh. Option answer uses attempt-option opaque ID, not display letter, so randomization cannot corrupt key mapping.
- Teacher can author/grade only assigned subjects/assignments and their duty scope. Admin can manage platform and override with reason/audit. Invigilator can view roster/status and (if approved) terminate assigned active attempts; cannot see keys, edit answers, grade, or publish results by default. Student sees own content/answers and published selected result only.

## 7. Autosave, submit, expiry, and worker race audit

All these flows lock `exam_attempts(id)` first and use the same server-side deadline comparison; no path locks answer then attempt. Set a bounded lock wait; retry deadlocks a small finite number of times with the same idempotency key. On connection loss during COMMIT, outcome is unknown: reconnect and query the mutation/submission receipt before retry.

### Autosave transaction

1. Client debounces changes, queues per-question last state, retains one stable UUID mutation ID until acknowledged, and sends `base_revision` plus answer/flag. A reset/new logical edit gets a new mutation ID only after the previous mutation is resolved.
2. Begin transaction; lock attempt row `FOR UPDATE`; verify owner, status IN_PROGRESS, assignment, and DB time. At the locked adjudication time, accept only if policy says allowed (proposal: DB lock/check time strictly before deadline). `SERVER_RECEIPT_BEFORE_DEADLINE` is a different trusted ingress-timestamp policy and cannot be treated as interchangeable; owner must pick one before schema/API freeze.
3. Check receipt `(attempt_id,mutation_id)`. Same request hash => return prior committed revision, no write. Different hash or question => 409. Then lock answer row; compare `base_revision` (0 if absent); validate type/options and limits; calculate next revision; insert the receipt first, then insert/update answer pointing to that receipt, replace selected-option rows, and commit. The receipt and answer change are atomic; rollback removes both.
4. Any validation/conflict/error rolls back all rows. Return durable revision/time only after commit. Newer write cannot be overwritten by older base revision. UI remains unsaved on network failure, retries with bounded exponential backoff+jitter, and reports conflict explicitly.
5. If an answer has never been saved, no `answers` row exists. Clearing a text answer stores the empty string; clearing a choice answer leaves zero selected-option rows. `last_mutation_id` is NN whenever a row exists; a flagged blank likewise has a row.

### Submit transaction and race outcomes

1. Client freezes edits and drains all pending mutation requests, then sends final revision manifest and stable `Idempotency-Key`.
2. Server begins transaction, locks attempt row. If a submission receipt already exists, return it (including if a different key retries after response loss; don't create a second submission). If state/deadline fails, no transition.
3. Compare every manifest revision with durable answer rows (absent=0). If client is ahead/missing, rollback and return 409 with mismatches. Never claim submit success while an acknowledged client mutation is absent.
4. Insert `submission_receipts`; transition attempt IN_PROGRESS→SUBMITTED; insert unique `exam_results` row in QUEUED state and `grading_jobs` row in PENDING state in the same transaction; commit. Invariant: after commit all four facts exist; before commit none exists. Submit response is sent only after commit.
5. Concurrent save that locks first either commits before submit and appears in manifest check, or submit locks first and changes state so save later rejects. Concurrent expiry follows same lock: whichever locks first evaluates DB time/status under the approved policy; only one terminal transition commits.

### Expiry finalizer

Claim bounded rows with `SELECT ... FOR UPDATE SKIP LOCKED` on `(status,deadline_at)`; MySQL 8.0 supports this queue pattern, but target version must be confirmed. For each row, lock/update attempt under common lock order; if still IN_PROGRESS and deadline passed, set EXPIRED, preserve answers, and create grading job/result only under approved `grade_expired` policy. Commit in small batches. If worker crashes, transaction rollback leaves row eligible. Request-time checks still reject after deadline even if worker is down.

### Grading worker

Claim a bounded job set under a short transaction with lease and `FOR UPDATE SKIP LOCKED`, then commit the claim before grading immutable attempt snapshots and frozen answers. In the completion transaction lock the attempt, then result, then job; verify the lease owner, write item rows with unique `(result_id,attempt_question_id)`, update aggregate result revision/status, mark job DONE, and commit. This follows the attempt-first order used by submit/expiry and avoids a job→attempt inversion. If crash before final commit, no partial grade persists; lease expires/retry. If crash after commit before acknowledgement, job is DONE and unique keys prevent duplicate score. Manual grading has independent authorization/revision checks; publication locks selected pointer and result and requires GRADED plus policy eligibility. No score is accepted from browser.

## 8. Index audit against planned queries

| Planned query | Required leading index / constraint |
|---|---|
| Student login by NISN | `student_login_identities UK(nisn)` then PK/FK student lookup. |
| Staff OIDC subject lookup | `users UK(oidc_issuer,oidc_subject)`; active status checked after unique lookup. |
| Sync upsert by provider identity | `students/teachers/employees/classes/years/semesters UK(source_id,source_*_id)`; enrollments UK by source external ID when present + natural observed tuple. |
| Student's assignment listing / target check | `exam_assignment_students IX(student_id,assignment_id)`; `exam_assignments IX(status,starts_at,ends_at)`; assignment roster FK/UK. |
| Class eligibility expansion during publish | `student_class_enrollments IX(class_id,semester_id,status,student_id)` and class status/year indexes. |
| Idempotent start / find MAIN | generated `UK(assignment_id,main_student_guard)` plus `IX(student_id,assignment_id,status)`. |
| Resume attempt | `IX(student_id,assignment_id,status)`; public ID unique only after authenticated ownership query. |
| Load attempt questions in order | `attempt_question_snapshots IX(attempt_id,display_order)`, `attempt_question_options UK(attempt_question_id,display_order)`. |
| Save one answer | `answers UK(attempt_question_id)`; snapshot pair candidate key; receipts `UK(attempt_id,mutation_id)`. |
| Submit status/receipt | `submission_receipts UK(attempt_id)`; `UK(idempotency_key)`; attempt PK lock. |
| Expiry finalizer | `exam_attempts IX(status,deadline_at)`; bounded `SKIP LOCKED` page. |
| Grade queue | `grading_jobs IX(status,available_at,id)` and `(status,lease_until)`; `UK(attempt_id)`. |
| Teacher dashboard/roster | `exam_assignment_staff IX(user_id,duty_role,assignment_id)`; attempts `IX(assignment_id,status,deadline_at)`; roster `UK(assignment_id,student_id)`. |
| Results by student/assignment | selected-result PK `(assignment_id,student_id)`; result `IX(assignment_id,student_id,grading_status)`. |
| Audit timeline/entity | `(created_at,id)`, `(entity_type,entity_id,created_at)`, actor/time indexes. |

No index is justified solely because a column is an FK; avoid duplicates when a composite index already begins with the same columns. Confirm each with `EXPLAIN ANALYZE` on representative non-production data. JSON is not directly indexed; keep transactional query keys relational, not embedded in JSON.

## 9. Shared VPS connection and worker bounds

Target environment estimate in the request is 4 vCPU / 16 GB RAM with existing PHP, MySQL, Redis, and other services. Actual MySQL `max_connections`, PHP peak connections, workload, service users, and free memory are unknown. Do not alter shared MySQL settings as part of design.

Proposal for first staging measurement: one API process; one shared MySQL pool with initial `connectionLimit=8`, bounded `queueLimit=40`; one expiry worker concurrency 1; one grading worker concurrency 1 (batch 10); one sync job at a time with page upserts bounded to 100–200 records and no long-held DB connection during HTTP calls. These are conservative test starting values, not final capacity values. Bound by `min(8, max_connections - measured_existing_peak - DBA/maintenance reserve)`; if budget <=0, block rollout. When pool queue full, fail fast with 503/Retry-After rather than accumulate unbounded work. Sync retries respect Portal Data's 120/minute limit and pause during exam windows. Scale only after pool wait/query/CPU measurements. Do not claim 1,200 support until full workflow load tests pass.

Redis is optional for shared rate limiting/coordination only if required by multiple API instances; MySQL remains correctness source. A second API process multiplies its connection pool, so replicas cannot be added without recomputing the total budget.

## 10. Test cases required for integrity approval

| ID | Test case | Expected invariant |
|---|---|---|
| FK-01 | Insert answer with attempt A and snapshot from attempt B. | Composite FK rejects. |
| FK-02 | Link snapshot question to exam question from another assignment. | Composite FK rejects. |
| FK-03 | Create extra attempt using authorization for another student/assignment/kind. | Composite FK/CHECK rejects. |
| FK-04 | Attach parent attempt from another assignment/student. | Composite FK rejects. |
| FK-05 | Insert result with attempt ID but mismatched assignment/student. | Composite FK rejects. |
| FK-06 | Select result/attempt for another assignment or student. | Composite FKs reject. |
| FK-07 | Add result item with snapshot/answer from another attempt. | Composite FK rejects. |
| FK-08 | Select option belonging to another attempt-question snapshot. | Composite FK rejects. |
| FK-09 | Delete a student/class/question/attempt with historical references. | RESTRICT rejects; history remains. |
| ELIG-01 | Publish assignment for a student/class, then sync/move student. | Frozen roster/context unchanged; start behavior follows approved snapshot rule. |
| ELIG-02 | Fail midway through roster publication. | Entire publish rolls back; no partial roster or PUBLISHED state. |
| ELIG-03 | Duplicate/ambiguous NISN source values. | Both source identities retained; no auto-merge/login ambiguity. |
| ATT-01 | 100 concurrent starts for same assignment/student. | Exactly one MAIN attempt; all successful retries return same attempt. |
| ATT-02 | Reuse one extra-attempt authorization concurrently. | Exactly one attempt created; other request returns same/rejected idempotently. |
| ATT-03 | Exceed max extra-attempt count concurrently. | Transactional counter/lock allows no over-limit creation. |
| SAVE-01 | Retry same mutation ID and same body before/after later mutations. | No second write; stable receipt/result revision. |
| SAVE-02 | Reuse mutation ID with different question/body. | 409; answer unchanged. |
| SAVE-03 | Two concurrent writes with same base revision. | At most one commits; loser receives current revision conflict. |
| SAVE-04 | Old retry arrives after newer answer. | Old mutation cannot restore stale value. |
| SAVE-05 | Never-saved vs explicit clear vs flagged blank. | No row vs JSON-null row semantics preserved; mutation ID NN on any row. |
| SAVE-06 | Crash/connection loss before commit. | No partial answer/receipt; same mutation may safely retry. |
| SAVE-07 | Connection loss during commit response. | Receipt lookup resolves outcome; no duplicate effect. |
| RACE-01 | Save and submit concurrently; save obtains lock first. | Save commits; submit manifest sees durable revision and then commits. |
| RACE-02 | Submit obtains lock first. | Submit commits; later save is rejected; receipt stable. |
| RACE-03 | Save/submit and expiry finalizer race at deadline. | One lock order winner; exactly one valid state transition under approved time rule. |
| SUB-01 | Submission response lost, retry same/different key. | Existing receipt returned; one result/job only. |
| SUB-02 | Client manifest claims revision not durable. | 409; attempt remains IN_PROGRESS; no receipt/job/result. |
| SUB-03 | Duplicate submission after terminal expiry. | No fake submission; terminal status returned. |
| EXP-01 | Finalizer crashes before commit. | Attempt remains eligible for next claim. |
| EXP-02 | Finalizer crashes after commit before ack. | Attempt EXPIRED once; no duplicate grading job/result. |
| GRADE-01 | Two workers claim same job. | Lease/row lock yields one active claim. |
| GRADE-02 | Worker crashes before grading commit. | No partial result items; retry recomputes. |
| GRADE-03 | Worker commits then crashes before ack. | Job remains DONE/result unique; retry cannot duplicate score. |
| GRADE-04 | Select/publish result while grading still running. | Rejected; only GRADED result can be selected/published. |
| GRADE-05 | Change manual grade with stale revision. | 409; append-only revision/event, no silent overwrite. |
| STATE-01 | Try answer after submit/expire/terminate/cancel. | Rejected; stored answer/result unchanged. |
| STATE-02 | Pause/close assignment with active attempts. | New start blocked; running-attempt policy follows approved decision. |
| RAND-01 | Refresh/retrieve questions repeatedly. | Same persisted question and option order for attempt. |
| SCORE-01 | Boundary points, partial credit, tie, rounding, over-max score. | Exact decimal rule and configured policy applied identically across retries. |
| AUTH-01 | Student A accesses B attempt/result; teacher outside assignment; invigilator reads keys. | Object-level checks deny all. |
| SYNC-01 | Repeat same successful source snapshot. | Idempotent upserts, no duplicate academic rows. |
| SYNC-02 | Pagination gap, duplicate ID, rejected row, before/after revision mismatch, suspicious mass absence. | No deactivation/reconciliation; run marked partial/aborted. |
| SYNC-03 | Crash after some upsert pages. | Retry is safe; no incomplete snapshot is marked authoritative. |
| MYSQL-01 | Run schema and concurrency suite on pinned MySQL version and enforced SQL mode. | CHECKs enforced, generated unique guard works, composite FKs build, SKIP LOCKED works. |

Security/E2E/load test matrix from Revision 1 remains required; capacity tests must run against staging from a separate load generator. Proposed SLOs remain provisional: <1% errors, p95 <500 ms lightweight endpoints, zero acknowledged-answer loss. User approval of the profile and SLOs is required.

## 11. Changelog from Revision 1

- Replaced overlapping `EXAMS`/`EXAM_ASSIGNMENTS` live states with blueprint lifecycle vs assignment delivery lifecycle; OPEN is derived from status + DB time.
- Added immutable `exam_assignment_students` roster/academic context snapshot and defined publish-time eligibility cut-off.
- Separated source NISN from unique NISN login identity; documented collision quarantine instead of sync failure/merge.
- Added composite candidate keys and FKs linking assignment→eligible student→attempt→question snapshot→answer/mutation receipt→result/item→selected published result.
- Added normalized attempt option snapshots and answer-selected-option relationship; no JSON order/key ambiguity.
- Defined absent answer row vs explicit empty text/empty choice selection and made mutation IDs non-null for persisted answer/mutation rows.
- Added explicit main-attempt generated unique guard and composite authorization binding; additional attempts are one-use and scoped to same student/assignment/kind.
- Separated job-delivery state from result-grading state and result publication pointer; added immutable score revision snapshots for manual regrades.
- Defined a shared attempt-first lock order, ambiguous commit retry resolution, atomic submission writes, expiry claim behavior, grading leases, and race outcomes.
- Added explicit pending score/rounding/randomization/termination policies for owner approval; no school scoring rule is presumed.
- Mapped indexes to concrete read/write/worker queries and proposed conservative bounded pool/worker settings for staging only.
- Verified repository demo uses MySQL 8.4; explicitly recorded production version as unknown and added non-production compatibility gate.

## 12. Owner decisions required before schema freeze

1. **Eligibility cut-off:** approve roster snapshot at assignment publish and active-account recheck at start, including how to correct a published roster.
2. **Attempt policy:** approve `PRIMARY_ONLY` as default result selection or choose another; approve extra attempt kinds, parent requirement, allowed roles, max count, whether canceled/failed starts consume a slot, and whether expired/terminated attempts can count.
3. **Deadline race:** choose DB lock/adjudication time strictly before deadline (proposal) or trusted server ingress-time/grace policy; define what happens to requests in flight at cutoff.
4. **Assignment pause/close:** approve that current attempts continue to their existing deadline, or specify forced termination behavior.
5. **Grading:** confirm first-release question types; partial credit/negative marking; score scale/cap; rounding mode; blank scoring; highest-score tie-break; manual regrade and audit policy.
6. **Termination/cancellation:** decide which violation events terminate, whether current “three violations” behavior remains, who can terminate/cancel, and whether stored answers are graded/eligible.
7. **PIN/NISN conflicts:** confirm manual resolution authority, reset/one-time delivery process, account throttling behavior, and whether source NISN changes require manual rebind.
8. **Enrollment history:** accept observed-current enrollment until source adds effective-dated history, or require an API change before launch.
9. **Sessions/data retention:** session idle and absolute lifetime; revocation on reset/disable; answer, mutation receipt, result, audit, and academic snapshot retention periods.
10. **Roles:** approve admin local password model and exact teacher/invigilator actions, especially terminate, inspect answers, grade, and publish.
11. **MySQL target:** approve MySQL 8.4.x/InnoDB as minimum, after read-only confirmation on the actual staging/new target; current production server remains unknown.
12. **Capacity envelope:** approve initial SLOs and staging load test profile; 1,200 capacity remains unverified until evidence is produced.
13. **Database identity:** choose actual new database name only after read-only availability inspection; `arena_cbt_next` remains a placeholder.

No implementation/schema migration should start until decisions 1–6 and 11 are approved, the ERD/catalog reviewed, and the actual new DB is confirmed isolated.
