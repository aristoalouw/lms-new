# Firestore contract for the LMS MVP

This document records the deployed collection names used by the LMS code. It is intentionally narrower than the retained full-campus schema.

## Ownership and access boundary

- Browser SDK access is limited to the authenticated user's validated `users/{uid}` profile fields and explicitly public configuration.
- `accounts`, academic records, enrolments, every `learning*` collection, attendance, private-file metadata, notifications, idempotency records, and audit logs are server-only.
- Nitro verifies the Firebase session, permission, object scope, current enrolment, and optimistic version before using Firebase Admin.
- Times remain UTC ISO instants in domain objects and application expiry checks. Temporary documents additionally carry `purgeAfter` as a real Firestore `Timestamp`; only that field is configured for asynchronous TTL cleanup.

## Canonical collections

| Collection | Key and invariant |
| --- | --- |
| `accounts/{uid}` | Account status, roles, active role, scope, session revision, and version. Firebase custom claims are a compact projection, not a second source of truth. |
| `accountStudentIds/{studentId}` | Transactional one-to-one reservation from the canonical student ID/NIM to one account UID. It prevents two identities from inheriting the same enrolments, submissions, or grades. |
| `users/{uid}` | Minimum profile. A non-admin owner may update only the Rules-validated display fields. |
| `academicPeriodDefinitions/{periodId}` | Versioned academic period and KRS window; an LMS class references an active period. |
| `academicCourseHeads/{courseId}` | Pointer to the latest immutable course version. |
| `academicCourseVersions/{courseId_vN}` | Immutable code/name/credit/program snapshot used by new classes. |
| `academicClasses/{classId}` | Period/course snapshot, section, lecturer IDs, schedule, capacity, status, counts, audit fields, and optimistic version. It contains no growing roster array. |
| `academicClassKeys/{digest}` | Transactional uniqueness reservation for period + course + section. |
| `classEnrollments/{classId_studentId}` | Canonical roster row with student UID/ID, source `KRS` or `ADMIN`, status, reason, actor, timestamps, and version. Withdrawal never deletes history. |
| `learningSpaces/{classId}` | Exactly one class learning space with the same stable class ID and a class metadata snapshot. |
| `learningModules` / `learningModuleVersions` | Mutable version head and immutable published/draft snapshots. |
| `learningMaterials` / `learningMaterialVersions` | Sanitized rich text, an HTTPS URL, or a pinned `CLEAN` private-file version. |
| `learningAssignments` / `learningAssignmentVersions` | Open/due/close windows, points, attempt/file limits, status, and immutable definitions. |
| `learningSubmissions/{digest}` | Mutable per-assignment/per-student draft head and latest-attempt pointer. |
| `learningSubmissionAttempts/{digest}` | Deterministic immutable final attempt with assignment version and deterministic lateness. |
| `learningGrades/{digest}` | Per-assignment/per-student grade pointing to one final attempt; draft and published states are distinct. |
| `learningAnnouncements` | Versioned published or archived class announcements. |
| `learningForumThreads` / `learningForumPosts` | Bounded edit history, two-level nesting, status, moderation reason, and optimistic version. |
| `academicClasses/{classId}/attendanceChallenges/{id}` | Short-lived nonce hash, meeting, issue/expiry times, issuer, and TTL. No participant array. |
| `academicClasses/{classId}/attendance/{meeting_student}` | Deterministic one-row-per-meeting/per-student attendance and audited corrections. |
| `files` / `fileVersions` / `fileUploadSessions` | Owner, class/space scope, object path, MIME, checksum, scan state, quota reservation, immutable versions, and expiry. Only temporary upload sessions have TTL. |
| `inAppNotifications` / `emailOutbox` | User inbox plus retryable email delivery queue; message bodies remain bounded and contain no submission or grade payload. |
| `auditLogs` | Append-only server record. API projections omit before/after payloads containing private academic content. |
| `idempotencyKeys` / `learningIdempotency` / `communicationIdempotency` / `rateLimitBuckets` | Bounded mutation replay, queue deduplication, and abuse-control state with expiry. |

## TTL contract

TTL is a storage hygiene mechanism, not authorization, application expiry enforcement, or backup retention. Services reject expired tokens/sessions synchronously even when Firestore has not deleted the document yet. Deploying `firebase/firestore.indexes.json` enables TTL only for this allowlist:

| Collection group | `purgeAfter` policy |
| --- | --- |
| `idempotencyKeys` | 24 hours after an LMS mutation; password-reset request keys use their one-hour replay window. |
| `learningIdempotency` | 24 hours after the mutation. |
| `communicationIdempotency` | Seven days after an ordinary notification key; password-reset delivery keys use 24 hours. |
| `rateLimitBuckets` | Window reset plus 24 hours of cleanup grace. |
| `fileUploadSessions` | Upload-session expiry plus 24 hours so application cleanup can release reserved quota first. |
| `attendanceChallenges` | Challenge expiry. |

`auditLogs`, `emailOutbox`, `inAppNotifications`, attendance records, file metadata/versions, submissions, grades, and all other durable LMS records deliberately have no TTL. TTL deletion is asynchronous, so operations must monitor the count and oldest age of already-expired temporary records instead of expecting deletion at the exact timestamp.

## Required query patterns

The source-controlled indexes in `firebase/firestore.indexes.json` cover:

- active enrolments by student UID, student ID, class, status, period, and program;
- classes by lecturer, program, period, status, and deterministic update order;
- spaces by class/lecturer/program and update cursor;
- published materials by space/status/order and assignments by space/status/due time;
- submissions by assignment/student and grades by assignment/student;
- forum threads by space/status/time and posts by thread/status/time;
- private files and notifications by owner/recipient plus deterministic cursor.

List endpoints cap pages at 50 and return an opaque `nextCursor`. Do not replace a missing index with an application-side full collection scan.

## Seed and migration

`npm run seed:lms-mvp` produces deterministic synthetic data for an isolated emulator by default. See `docs/lms-mvp-seed.md`. There is no production-data migration in the MVP baseline; `classEnrollments` is canonical from first production use.
