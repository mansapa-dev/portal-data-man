# Arena CBT — Critical Design Remediation (Schema Revision 3)

**Status: proposal for review; schema freeze is still blocked.** This is documentation only. It does not approve a schema, migration, implementation, database access, deployment, or a school policy. Revision 2 remains unchanged as the historical review. The accompanying [ERD Revision 3](./erd-rev3.mmd) is a conceptual relationship diagram; the constraint catalog below is normative for this proposal.

## Critical findings before revision

1. Revision 2 declared USER_SESSIONS twice. Revision 3 removes the duplicate in its new ERD.
2. Several single-column foreign keys did not prove that related rows belonged to the same source, academic period, class offering, subject, assignment, student, or attempt. Revision 3 proposes candidate keys and composite foreign keys for those scopes.
3. Result revisions recorded aggregate totals but could not reconstruct old per-question scores. Revision 3 proposes append-only revision headers and a complete item snapshot for every revision.
4. Answer state did not distinguish clearly between no persisted answer and a persisted empty answer; retrying an old mutation could also be misread as current state. Revision 3 makes those semantics explicit.
5. Question prompt and private grading material shared storage rows. Revision 3 separates the proposed public attempt snapshot from private grading snapshot/keys, while noting that application authorization is still required.
6. The deployed MySQL target remains unknown. The repository's mysql:8.4 local demo image is not evidence about the production or future staging server.

## Scope, evidence, and assumptions

- Confirmed project foundation remains Fastify, strict TypeScript, React, Vite, MySQL, modular monolith, isolated new database, Portal Data adapter, student NISN + local PIN, and staff OIDC.
- The school has not approved eligibility correction rules, class-to-subject crossing, attempt-kind/parent semantics, grading rules, official result selection, role rights, retention, or other items shown as blocked in [Business Rules Closure](./business-rules-closure.md).
- The prior [Schema Freeze Readiness](./schema-freeze-readiness.md) remains NOT READY. This revision proposes responses to technical findings; it does not close school decisions or staging gates.
- Portal Data enrollment is treated as observed membership, not proven effective-dated history. Proposed composite constraints establish internal consistency, not historical truth.
- IDs are assumed to be BIGINT UNSIGNED internally. Every referenced FK must exactly match parent type, width, sign, and column order. Final DDL must specify that explicitly.
- ON DELETE behavior is proposed as RESTRICT for academic and exam-history relationships; no cascade may remove published exam evidence. Soft deactivation is preferred. This remains a technical default for review, subject to retention approval.
- The diagram includes an ATTEMPT_OPTION_KEYS table to keep correct-option data out of the public option snapshot. It is an alternative storage boundary, not proof that database access is restricted.

## Revision 3 relationship and constraint catalog

All candidate keys below are UNIQUE and NOT NULL unless explicitly described otherwise. Composite FK columns use the same order as their referenced candidate key. Optional composite relationships must be all NULL or all populated, enforced by CHECK where the selected MySQL target enforces it, with equivalent service validation and tests.

### Academic source identity and enrollment

| Entity | Proposed candidate keys and foreign keys | Integrity purpose |
|---|---|---|
| ACADEMIC_SOURCES | UK(provider_key) | Provider namespace is stable and explicit. |
| STUDENTS | FK(source_id) → ACADEMIC_SOURCES(id); UK(id, source_id, source_student_id); UK(source_id, source_student_id) | A student's source key cannot be confused with another provider or student. source_student_id is NOT NULL for provider-managed rows. |
| STUDENT_LOGIN_IDENTITIES | PK/FK(student_id) → STUDENTS(id); UK(normalized_nisn) | Login NISN remains unique independently of potentially changed source NISN. A collision is quarantined; never auto-merge by name. |
| CLASSES | FK(source_id); UK(id, source_id, source_class_id); UK(source_id, source_class_id) | Provider identity of a class is stable. Remove nullable year ownership from CLASSES as the membership period is represented by CLASS_OFFERINGS. |
| CLASS_OFFERINGS (new) | FK(class_id, source_id) → CLASSES(id, source_id); FK(academic_year_id) → ACADEMIC_YEARS(id); UK(class_id, academic_year_id); UK(id, academic_year_id); optional UK(source_id, source_offering_id) when provider supplies a stable offering key | Defines a class in a specific academic year. This avoids separately linking an enrollment to a class and unrelated year. |
| STUDENT_CLASS_ENROLLMENTS | FK(student_id, source_id) → STUDENTS(id, source_id); FK(class_offering_id, academic_year_id) → CLASS_OFFERINGS(id, academic_year_id); FK(semester_id, academic_year_id) → SEMESTERS(id, academic_year_id); UK(id, student_id, class_offering_id, academic_year_id, semester_id); provider UK(source_id, source_enrollment_id) only when that source key is present and stable | Student, class offering, year, and semester must describe one coherent membership. Do not invent UK(year, semester_type) or a single-enrollment-per-student rule without provider evidence. If provider enrollment IDs can be absent, use an explicit nullable source key strategy rather than a fake value. |
| ACADEMIC_YEARS / SEMESTERS | SEMESTERS UK(id, academic_year_id); enrollment's composite FK to it | Prevents a semester from another academic year being used. External IDs remain namespaced by source. |

Snapshot binding: add source_id_snapshot and source_student_id_snapshot to EXAM_ASSIGNMENT_STUDENTS, then FK(source_id_snapshot, source_student_id_snapshot) to the student's UK(source_id, source_student_id), and FK(student_id, source_id_snapshot, source_student_id_snapshot) to STUDENTS UK(id, source_id, source_student_id). Keep NISN/name/class labels as historical values captured at roster freeze; validate them against the roster source transaction. A future corrected source key must not rewrite old snapshots. Alternative: a normalized immutable student-source-identity history table; choose it if the provider permits source-key changes.

### Assignment, class targeting, and roster

| Entity | Proposed candidate keys and foreign keys | Integrity purpose |
|---|---|---|
| EXAM_ASSIGNMENTS | UK(id, academic_year_id, semester_id, subject_id); FK(semester_id, academic_year_id) → SEMESTERS(id, academic_year_id); FK(exam_id, subject_id) → EXAMS(id, subject_id) | Assignment period and subject cannot diverge from the exam snapshot. If an assignment deliberately changes subject from the blueprint, that needs an explicit versioned rule. |
| EXAM_ASSIGNMENT_CLASSES | PK(assignment_id, class_offering_id); FK(assignment_id, academic_year_id) → assignment candidate; FK(class_offering_id, academic_year_id) → CLASS_OFFERINGS(id, academic_year_id) | Class target must be an offering in the assignment year. Require assignment semester compatibility at roster generation because offering is year-level unless source proves semester-level offering. |
| EXAM_ASSIGNMENT_STUDENTS | UK(id, assignment_id, student_id); FK(assignment_id, academic_year_id, semester_id) → assignment; FK(student_id, source_id_snapshot, source_student_id_snapshot) → student identity candidate; optional all-or-none enrollment/class-offering FK `(enrollment_id, student_id, class_offering_id, academic_year_id, semester_id)` → enrollment candidate; FK(class_offering_id, academic_year_id) → offering | Frozen roster is bound to one assignment/student and a coherent period. Directly assigned students can omit enrollment and class-offering context only if school policy permits; use CHECK that the entire optional tuple is NULL or populated. Snapshot names/labels are not keys. |

Eligibility cutoff remains proposed at assignment publication with an active-account check at start. This is not approved school policy. Published roster amendment must be append-only/versioned or handled by cancel/reissue; never silently mutate the eligibility snapshot.

### Question, bank, subject, and exam content

| Entity | Proposed candidate keys and foreign keys | Integrity purpose |
|---|---|---|
| QUESTION_BANKS | UK(id, subject_id); FK(subject_id) → SUBJECTS(id) | Bank has a single declared subject. |
| QUESTIONS | carry question_bank_id and subject_id; FK(question_bank_id, subject_id) → QUESTION_BANKS(id, subject_id); UK(id, question_bank_id, subject_id) | A question cannot be placed in a bank under a different subject. |
| QUESTION_VERSIONS | carry question_id, question_bank_id, subject_id; FK(question_id, question_bank_id, subject_id) → QUESTIONS(id, question_bank_id, subject_id); UK(id, subject_id); UK(question_id, version_no) | Version keeps immutable lineage to question, bank, and subject. |
| EXAMS / EXAM_ASSIGNMENTS | candidate UK(id, subject_id); assignments reference that candidate | Assignment blueprint subject is explicit and can be frozen. |
| EXAM_QUESTIONS | carry subject_id; FK(assignment_id, subject_id) → EXAM_ASSIGNMENTS(id, subject_id); FK(question_version_id, subject_id) → QUESTION_VERSIONS(id, subject_id); UK(id, assignment_id); UK(assignment_id, display_order) | Prevents cross-assignment question reuse and enforces same-subject content if school confirms that rule. |

**Owner decision:** whether an exam may intentionally include questions from a different subject. Composite subject FKs above assume “no”. If the school allows cross-subject content, remove the same-subject constraint and preserve explicit subject attribution per question; do not let implementation choose silently.

### Attempt, snapshot, answer, receipt, and result chain

Use scoped candidate keys so references cannot cross attempts or assignments:

- EXAM_ASSIGNMENT_STUDENTS: UK(id, assignment_id, student_id).
- EXAM_ATTEMPTS: UK(id, assignment_id, student_id); FK(assignment_student_id, assignment_id, student_id) → roster; UK(id, assignment_id, student_id, authorization_id) only if nullable authorization semantics and target engine support are explicit. MAIN requires no authorization; extra attempts require one. A service transaction locks the roster and authorization to enforce one-use and matching attempt_kind. A CHECK cannot validate equality against another row's kind, so store authorization attempt_kind as the source of truth or run an explicit matching composite FK with a versioned kind lookup if strict DB enforcement is wanted.
- EXAM_QUESTIONS: UK(id, assignment_id); ATTEMPT_QUESTION_SNAPSHOTS has UK(id, attempt_id), UK(attempt_id, exam_question_id), and FK(exam_question_id, assignment_id) plus FK(attempt_id, assignment_id) so question and attempt share assignment.
- ATTEMPT_QUESTION_OPTIONS: UK(id, attempt_question_id), UK(public_id), public option key/content/order only. Correctness is moved to ATTEMPT_OPTION_KEYS or private grading JSON; student query credentials must not read it.
- ANSWERS: UK(id, attempt_id, attempt_question_id), UK(attempt_question_id) for one current state per snapshot question, FK(attempt_id, attempt_question_id) → snapshot; row absence means never persisted. answer_text is nullable for choice answers; empty string is a persisted blank text answer. revision is NOT NULL and positive for persisted rows. last_mutation_id is NOT NULL for every persisted answer row.
- ANSWER_WRITE_RECEIPTS: UK(attempt_id, mutation_id); UK(id, attempt_id, attempt_question_id, result_revision); FK(attempt_id, attempt_question_id) → snapshot. A request hash is NOT NULL and fixed length. Mutation IDs are scoped per attempt, not global.
- Answer receipt linkage: the answer's last_mutation_id points to a receipt in the same attempt/question. Add a candidate key on receipt `(attempt_id, attempt_question_id, mutation_id, result_revision)` and a stored answer `last_mutation_revision` so FK can bind all four fields if the selected engine supports the necessary parent candidate key. Then CHECK answer.revision = last_mutation_revision. Otherwise enforce equality atomically in the write transaction and run reconciliation; do not claim a simple FK proves revision equality.
- SUBMISSION_RECEIPTS: UK(attempt_id), UK(attempt_id, idempotency_key); one durable submission receipt per attempt. If clients can retry with different keys, return the existing receipt and do not create a second one. Store immutable final manifest hash and submitted_at.
- GRADING_JOBS: UK(attempt_id), idempotent state/lease; job delivery state is separate from result grading state.
- EXAM_RESULTS: UK(attempt_id), UK(id, attempt_id, assignment_id, student_id); composite FK back to attempt scope. Initial ungraded result may have NULL current revision/totals only if the exact lifecycle requires it; otherwise create result only when grading starts and keep status in grading job. Do not mix NULL score with numeric zero.
- EXAM_RESULT_ITEMS: UK(result_id, attempt_question_id); FK(attempt_id, attempt_question_id) to snapshot and FK(answer_id, attempt_id, attempt_question_id) to answer. answer_id nullable means there was no persisted answer at submission; a persisted blank answer has an answer_id.
- SELECTED_EXAM_RESULTS: PK(assignment_id, student_id); FK(attempt_id, assignment_id, student_id) to attempt scope; FK(result_id, attempt_id, assignment_id, student_id) to result; FK(result_revision_id, result_id) to immutable revision. This prevents publishing a result from another student's attempt or a revision not belonging to the result. Publish only a completed/approved grade under an owner-approved result-selection policy.

All historical records use RESTRICT/no cascade deletion. Exact FK columns, index order, and nullable tuple constraints must be captured in a DDL matrix before freeze.

### Immutable regrade history

Replace the prior aggregate-only history with:

**EXAM_RESULT_REVISIONS** header: `id`, `result_id`, `attempt_id`, `assignment_id`, `student_id`, `revision_no`, previous aggregate earned/max/score, new aggregate earned/max/score, reason, actor kind, nullable user actor for system-generated initial grading, created_at. Use UK(result_id, revision_no) and UK(id, result_id, attempt_id, assignment_id, student_id). Composite FK `(result_id, attempt_id, assignment_id, student_id)` → EXAM_RESULTS same-scope candidate. Actor rule: USER requires changed_by_user_id; SYSTEM requires it NULL, enforced by CHECK and app validation. Store rounding/scoring algorithm version with revision if algorithm changes can affect reproducibility.

**EXAM_RESULT_REVISION_ITEMS** stores a complete item state for every result revision, not just changed questions: `result_revision_id`, `result_id`, `attempt_id`, `attempt_question_id`, nullable answer_id, previous earned points/status, new earned points/status, feedback snapshot, grader actor and timestamp. UK(result_revision_id, attempt_question_id); FK `(result_revision_id, result_id, attempt_id)` → revision header candidate; FK `(attempt_id, attempt_question_id)` → snapshot; nullable answer FK `(answer_id, attempt_id, attempt_question_id)` → answer. The first revision has previous fields NULL; subsequent revisions must match the preceding revision's new values. The latter cross-row comparison is a transaction invariant and reconciliation check.

EXAM_RESULTS and current EXAM_RESULT_ITEMS may remain a fast current projection, updated in the same transaction that appends a revision. The revision header plus full item rows are the immutable audit record; never update/delete a revision. Selected result pins the exact revision published. Regrade creates a new revision and an explicit republish action if school policy allows it. Actor, reason, before/after item values, totals, and timestamp are durable.

### Public and private question snapshot boundary

ATTEMPT_QUESTION_SNAPSHOTS contains prompt, type, points/order and stable public content only. ATTEMPT_QUESTION_OPTIONS contains option public ID, display key/content/order. ATTEMPT_QUESTION_GRADING_SNAPSHOTS stores private grading rules; ATTEMPT_OPTION_KEYS stores correctness mapping when needed. Composite FKs bind each private row to its exact snapshot. This helps separate query projections but is not a complete security boundary if the API's database user can SELECT both. Student routes must use explicit allowlist projections; staff grading routes must perform role/object authorization; tests must assert that answer keys and grading configs never appear in response or logs.

## Answer persistence and retry semantics

| State | Persisted representation | Meaning |
|---|---|---|
| Never saved | No ANSWERS row; no accepted write receipt for a current answer state | No user answer has been durably acknowledged. A submission manifest records this snapshot as absent/revision 0. |
| Deliberately blank text | ANSWERS row exists with answer_text = empty string, revision >= 1, last_mutation_id set; no option rows | Student explicitly saved an empty text response. It is distinct from never saved. |
| Text with content | ANSWERS row exists with non-empty answer_text; option rows absent | Persisted text response. |
| Choice selected | ANSWERS row exists; answer_text NULL; one or more selected-option rows; each option FK belongs to the same snapshot | Persisted choice response. |
| Choice deliberately cleared | ANSWERS row exists; answer_text NULL; zero selected-option rows; revision and mutation receipt exist | Explicitly saved empty choice response, distinct from never saved. |
| Flagged but blank | Same blank representation plus is_flagged = true | Flag metadata does not make an absent answer appear saved. |
| Retry same mutation ID and same request hash | Existing receipt returned, with its accepted result revision and the current answer revision reported separately | Do not reapply the old body. If a newer mutation is already current, the response must not imply the retried mutation is current. |
| Same mutation ID, different question/body/hash | No write; conflict response | A client bug or ID collision must not silently change an accepted mutation. |

Every answer write is a single transaction: lock attempt; validate owner/state/deadline; look up mutation receipt; if found compare request hash and return receipt/current revision; otherwise compare base revision; insert receipt and update answer/selected-option rows atomically; set answer.last_mutation_id and last_mutation_revision; commit. A stale base revision returns conflict with current revision. Unknown commit outcome is resolved by receipt lookup using the same mutation ID. Never claim durability before commit acknowledgement or successful receipt lookup.

### Updated SAVE-05 and related integrity tests

| Test ID | Scenario | Required result |
|---|---|---|
| SAVE-05A | Question has never been saved | No ANSWERS row, revision 0 in read/submission manifest, and no fabricated empty answer. |
| SAVE-05B | Save an explicit empty text response | ANSWERS row with answer_text empty string, revision >= 1, non-null mutation ID; it differs from SAVE-05A. |
| SAVE-05C | Save a choice answer, then deliberately clear all choices | ANSWERS row remains, answer_text NULL, zero selected-option rows, revision advances; not equivalent to no row. |
| SAVE-05D | Save flagged blank response | Blank state is persisted as above and flag true; flag alone does not create selected choices or text. |
| SAVE-05E | Repeat identical mutation ID/body | Return original receipt and accepted revision; no extra revision or duplicate option rows. |
| SAVE-05F | Retry old mutation after newer mutation committed | Return old receipt plus current newer revision; current answer remains newer. |
| SAVE-05G | Reuse mutation ID with changed payload or question | Conflict; answer, receipt, and revision remain unchanged. |
| SAVE-05H | Answer points to receipt from another question/attempt or mismatched result revision | Composite FK/check rejects, or transaction validation rejects; reconciliation detects any impossible stored mismatch. |
| INT-01 | Roster row references student source ID from another provider/student | Composite FK rejects. |
| INT-02 | Enrollment pairs class offering from year A with semester/year B | Composite FK rejects. |
| INT-03 | Assignment targets offering from a different year | Composite FK rejects. |
| INT-04 | Exam question uses version from a different subject (if same-subject rule approved) | Composite FK rejects. |
| INT-05 | Attempt snapshot points to question in another assignment | Composite FK rejects. |
| INT-06 | Answer option points to option in another question snapshot | Composite FK rejects. |
| INT-07 | Result item points to another attempt's answer/question | Composite FK rejects. |
| INT-08 | Selected result points to another student's result or unrelated revision | Composite FK rejects. |
| INT-09 | Regrade writes new total but omits/changes unrelated item snapshot | Revision completeness check rejects; old revision remains unchanged. |
| INT-10 | Selected publication uses stale revision after regrade | Pointer remains pinned to prior revision until explicit approved republish. |
| INT-11 | Delete a student, attempt, snapshot, answer, result, or audit parent with history | RESTRICT blocks destructive delete; deactivation/archive policy applies instead. |

Existing RACE/SUB/EXP/GRADE tests in Revision 2 remain, with two additions: concurrent retry of a previously accepted mutation must not revert newer state; and selected-result publication racing with regrade must pin one complete revision, never a mixed projection.

## Transaction boundaries and idempotency additions

1. **Autosave:** attempt-first lock order; receipt lookup before base-revision conflict for exact retry; matching hash required; receipt+answer+selected options commit atomically. Retry never reapplies content.
2. **Submit:** lock attempt and validate status/deadline; verify the submitted manifest against persisted answer revisions (including absent revision 0); atomically create one submission receipt, transition attempt, and enqueue one grading job. A lost response is resolved by receipt. The school still must approve cutoff/in-flight fairness.
3. **Expiry:** worker claims eligible attempt with a bounded lease/locking read; it uses same attempt-first lock and rechecks server time/status in the transaction. It records one terminal transition and queues grading according to an owner-approved rule. SKIP LOCKED is only a worker queue technique, not a general read strategy.
4. **Grading:** one job lease; compute from immutable attempt snapshot and frozen answers; append result header and full item revision; update current projection and complete job in one transaction. A retry sees a completed revision/job and does not duplicate. Regrade is a new append-only revision with a reason and actor.
5. **Publication:** transaction locks assignment/student pointer and result revision; verifies policy, grading completion, and actor permission; upserts the selected pointer to exact revision with audit event. Regrade does not silently change published result.

Use deterministic lock order attempt → result → job/pointer. Retry only deadlock/serialization failures using bounded backoff and the same idempotency key. Unknown commit result is resolved from durable receipt/revision rows. Add periodic invariant reconciliation for state combinations that FKs cannot express.

## MySQL compatibility evidence and limits

Repository evidence reviewed: local demo script uses `mysql:8.4`; README refers to MySQL 8/MariaDB; API uses mysql2. No production or staging connection was made, no server environment was read, and no server was changed. Therefore the target version, engine, SQL mode, collation, CHECK enforcement, and resource limits are **unverified**. The demo image is not a target-version guarantee.

The proposal uses composite InnoDB foreign keys to candidate keys, CHECK/all-or-none nullable tuples, fixed DECIMAL values, JSON snapshots, transactions, and queue row locking. Before DDL freeze, verify on a pinned, disposable staging target that:

- Parent keys are PRIMARY/UNIQUE with exact referenced column order, and FK types/width/sign/collation match.
- All CHECK constraints are enforced; do not depend on versions that parse but ignore them.
- Composite nullable FKs behave as expected; all-or-none checks reject partial tuples.
- JSON, DECIMAL precision, timestamp precision, generated or functional keys (if any), and indexes build as designed.
- InnoDB locking reads, deadlock/lock wait behavior, and SKIP LOCKED work as expected for worker claims.
- Clean DDL install, rollback/restore, and concurrency/integrity tests run only on a disposable isolated database.

MySQL's official 8.4 documentation requires compatible FK column types and indexed referenced keys and deprecates non-unique referenced keys; verify exact target behavior rather than assuming version parity ([foreign key constraints](https://dev.mysql.com/doc/refman/8.4/en/create-table-foreign-keys.html)). `SKIP LOCKED` can return an inconsistent view and is intended for queue-like workloads ([locking reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html)). These references describe MySQL 8.4; they do not prove the deployed server uses 8.4.

No load test was run. Capacity for 1,200 simultaneous students remains unproven.

## Change matrix

| Initial issue | Revision 3 proposal | Constraint or test | Risk / decision still needed |
|---|---|---|---|
| USER_SESSIONS duplicated | Remove duplicate from new ERD | Diagram parse/render review; exactly one declaration | Low; no school decision. |
| Student/source snapshot could mismatch | Add source identity candidate keys and roster composite FK | `STUDENTS(source_id,source_student_id)` and roster identity FK; INT-01 | Source-key change behavior needs Portal Data owner; consider identity history if key mutable. |
| Class/year/semester relations could diverge | Add CLASS_OFFERINGS and composite enrollment FK chain | Offering/year, enrollment/student/offering/year/semester candidates; INT-02 | Provider's offering identity and effective history remain unverified. |
| Assignment class target lacked period binding | Target class offering and assignment year in composite FK | `assignment_id+year` and `offering_id+year`; INT-03 | Assignment semester compatibility semantics need academic owner. |
| Question bank/subject/version scope unbound | Carry subject through question and version lineage | Composite subject FK through bank/question/version/assignment; INT-04 | School must decide if cross-subject questions are allowed. |
| Snapshot/answer/result cross-scope links possible | Add scoped candidate keys/FKs at each chain edge | INT-05 through INT-08 | Final DDL needs complete exact-key matrix and target-engine proof. |
| Regrade only retained aggregate values | Append revision header and complete per-question before/after snapshots | UK(result,revision); scoped FKs; INT-09/10 | School must approve regrade rights, republish, reason, and retention rules. |
| Never-saved vs blank semantics unclear | No row vs empty row vs no options defined; receipt retry contract clarified | SAVE-05A–H; transactional receipt + answer update | Product must choose whether blank counts as unanswered; raw state is retained either way. |
| Private grading stored with public snapshot | Separate private grading snapshot/options keys | API projection/security tests | Table split alone is not an authorization boundary. |
| Target MySQL inferred from demo image | Explicitly mark target unknown | Staging version/DDL/locking validation | Requires infrastructure owner and approved isolated staging. |

## Decisions still blocking schema freeze

These are owner decisions, not recommendations converted to policy:

1. Eligibility cutoff and process for correcting a published roster; whether direct assignments without a class enrollment are permitted.
2. Attempt kinds, parent-attempt rules, approval roles/counts/deadlines, consumption after cancellation/expiry, and authoritative result selection/tie-break.
3. Deadline adjudication, pause/close behavior, expiry/termination/cancellation grading and selection.
4. Question types, scoring/blank/partial/negative rules, maximum/cap, rounding, manual regrade, publication and republish rights.
5. Whether cross-subject questions are allowed.
6. Exact teacher/admin/invigilator permission matrix; PIN issuance/reset, NISN conflict handling, session lifetime, retention periods.
7. Portal Data authority/completeness, source-key stability, enrollment cardinality/history, missing-record treatment, and reconciliation authorization.

Technical review still required: exact candidate/FK/index matrix; nullability and CHECK definitions; authorization-kind database enforcement; result/current-projection lifecycle; migration DDL portability; privacy boundary for grading data; and reconciliation queries for invariants not expressible as FKs.

Staging required: actual target version/engine/SQL mode and resource limits on an isolated target; DDL/check/FK behavior; transactions, locks and failure recovery; representative query plans; security tests; and staged load testing. 1,200-user capacity remains unclaimed until measured evidence exists.

## Changelog from Revision 2

- Removed the duplicate USER_SESSIONS block in the new ERD; Revision 2 remains intact.
- Added CLASS_OFFERINGS to bind class membership and assignment targeting to academic year.
- Added composite identity, enrollment, assignment, question-subject, attempt-snapshot, answer, result-item, and selected-result relationship proposals.
- Replaced aggregate-only regrade history with append-only revision header plus complete per-question before/after snapshots; selected result pins a revision.
- Clarified absent answer, persisted blank, explicit cleared choice, exact retry, stale retry, and mutation ID reuse semantics; replaced SAVE-05 with SAVE-05A–H.
- Proposed separating public question snapshot from private grading material.
- Distinguished repository demo MySQL image from unknown server target and listed staging proof required.
- Kept school decisions open and readiness status NOT READY; no capacity claim.
