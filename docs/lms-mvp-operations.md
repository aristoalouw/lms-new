# LMS MVP staging and production runbook

## Release gates

Use one immutable commit and release tag for every command:

```powershell
npm ci
npm run check:no-ai
npm run check:dependencies
npm run typecheck
npm run test:api
npm run test:rules
npm run build
npx playwright install chromium
npm run test:e2e
```

Rules tests require Java 21 and run Firestore plus Storage Emulator. They intentionally skip during the general Vitest run when emulator host variables are absent; `npm run test:rules` is the authoritative gate and must not be waived in CI.

Set `APP_FEATURE_PROFILE=lms-mvp`, `CAMPUS_DATA_MODE=firebase`, and `ALLOW_PRODUCTION_MOCK=false` in staging and production. Run `scripts/validate-env.ps1` before starting Compose. Use different Firebase projects and Sentry environments for staging and production.

## Staging pilot

Project staging resmi adalah `sttsp-lms-staging`. Cloud Firestore `(default)` memakai Standard edition, production-mode Rules, dan lokasi immutable `asia-southeast2` (Jakarta). Email/password Authentication aktif dan web app staging terdaftar. Google Analytics tetap nonaktif sampai ada persetujuan privasi yang terpisah.

Deploy Rules dan indexes dengan target eksplisit dari root repository:

```powershell
firebase use staging
npm run test:rules
firebase deploy --config firebase/firebase.json --project sttsp-lms-staging --only firestore:rules,firestore:indexes
```

Jangan mengandalkan project default global milik operator. Verifikasi bahwa output deploy menyebut `sttsp-lms-staging` sebelum menyetujui perubahan.

Cloud Storage for Firebase pada project baru memerlukan Blaze/billing. Hubungkan billing hanya setelah pemilik menyetujui billing account, budget, dan alert; kemudian buat bucket di `asia-southeast2`, catat nama bucket pada secret/environment staging, lalu deploy Storage Rules secara terpisah:

```powershell
firebase deploy --config firebase/firebase.json --project sttsp-lms-staging --only storage
```

Setelah layanan dasar tersedia:

1. Deploy Firestore Rules, Storage Rules, dan indexes ke project staging dari commit release yang sama.
2. Build an immutable Nitro image, place it behind `infra/nginx`, and run `scripts/smoke-production.ps1` against HTTPS.
3. Seed only synthetic or approved limited data for one program study.
4. Prepare 200 distinct synthetic student session fixtures outside Git and run:

   ```powershell
   k6 run -e LMS_BASE_URL=https://staging.example.ac.id -e LMS_SESSION_FIXTURES=C:\secure\lms-sessions.json tests/load/lms-mvp.js
   ```

   The JSON format is an array of `{ "sessionCookie": "...", "spaceId": "...", "assignmentId": "..." }`. Never commit or print it. The test fails when errors reach 1%, read p95 reaches one second, or mutation p95 reaches two seconds.
5. Obtain signed UAT from at least one administrator, assigned lecturer, and actively enrolled student. Include negative checks for cross-class access, administrator grading, withdrawn enrolment, expired/replayed QR, unpublished grades, and draft material visibility.

## Sentry and alerts

Set server `SENTRY_DSN`, restricted browser `NUXT_PUBLIC_SENTRY_DSN`, `SENTRY_ENVIRONMENT`, and immutable `SENTRY_RELEASE` plus `NUXT_PUBLIC_SENTRY_RELEASE`. Both release values must equal `APP_VERSION`. Client and server use the same scrubber. Passwords, tokens, cookies, email, NIM/NIK, student data, grades, submissions, feedback, documents, and files are removed before transport.

Create alerts for sustained HTTP 5xx, readiness failures, error-rate regression after a release, and a sudden increase in rejected file scans. Investigate using release and `X-Request-ID`; do not attach raw request bodies or user records.

## Capacity, quota, and cost guardrails

The pilot capacity assumption is approximately 100 students plus a small, bounded set of lecturers and administrators. It is not permission to scale without measuring staging traffic and revisiting quotas.

- Every list endpoint uses indexed cursor pagination with at most 50 records; a missing index is a deployment failure, not a reason to scan a collection in application memory.
- Upload sessions expire after 10 minutes and signed download URLs after 5 minutes. PDF uploads are capped at 25 MiB; JPEG/PNG uploads are capped at 10 MiB.
- The current per-owner default `FILE_QUOTA_BYTES=262144000` is 250 MiB. At 100 student owners this permits about 24.4 GiB (25 GB) before lecturer files, versions, quarantine, and backup copies. For synthetic staging, start with `FILE_QUOTA_BYTES=52428800` (50 MiB) unless the UAT dataset needs more. Production quota changes require an explicit storage forecast and owner approval.
- Bound notification fan-out and background batches, monitor retry backlog, and alert before queues create repeated reads/writes. Never place submissions, grades, or file bodies in notification payloads.
- Create project budget alerts at 50%, 75%, 90%, and 100% of the approved monthly amount. Add service quota warnings at 70%, review daily Firestore reads/writes/deletes and Storage growth during pilot, and investigate unexpected read amplification before raising a quota.
- Do not enable billing, paid backup, email delivery, or another paid service from this runbook. Record its owner, budget, alert recipients, and approval before enabling it.

Staging and production must use different Firebase project IDs, databases/buckets, credentials, budget alerts, backup destinations, domains, and Sentry environments. Staging is `sttsp-lms-staging`; the production project and bucket remain explicit release inputs and must never be inferred from the operator's Firebase default.

Firestore TTL is declared in `firebase/firestore.indexes.json` for temporary idempotency keys, communication deduplication keys, rate-limit buckets, upload sessions, and attendance challenges only. It is asynchronous and does not replace synchronous expiry checks. Monitor expired-record count and oldest expiry; investigate records that remain materially beyond the observed cleanup window. TTL is not applied to audit, outbox/inbox, attendance results, grades, submissions, files, or other durable records. Verify plan-specific TTL and delete-operation costs before approving the staging deployment.

## Backup and isolated restore

Follow `docs/backup-restore.md` and `scripts/backup-firebase.ps1`. Restore into a disposable recovery project, deploy the same release's Rules/indexes, and keep email plus every external integration disabled. Never point a recovery drill at production clients.

Before the drill, record:

- ticket, approval, operator/reviewer, source project/database/bucket, isolated target project/database/bucket, and planned window;
- immutable commit/release, Rules and indexes revision, backup URI/watermark, and requested RPO/RTO;
- expected counts and aggregate checksums for durable LMS collections and Storage objects without copying PII into the ticket.

After restore, compare durable `accounts`, `accountStudentIds`, `academicClasses`, `classEnrollments`, `learning*`, `files`, `fileVersions`, attendance records, notifications/outbox, and `auditLogs`; sample non-sensitive IDs and file checksums. Do not require count equality for the six temporary TTL collection groups because deletion is asynchronous on both sides. Instead verify the TTL allowlist, Timestamp type, application expiry behavior, and absence of premature deletion.

Run the primary journey (admin creates users/class; lecturer publishes material/assignment; student accesses, submits, and attends; lecturer grades; student sees the published result) plus anonymous, cross-class, withdrawn-enrolment, and unpublished-grade negative checks. The evidence record must contain actual start/end, observed RPO/RTO, source/target IDs, release, expected/actual counts, sample/checksum results, exceptions, reviewer, pass/fail decision, and approved recovery-project cleanup. Current external blockers are an approved production Firebase project/bucket, staging Storage/billing approval, backup credentials/destination, and an approved drill window; none is enabled or deployed by this implementation.

## Production promotion

Production promotion is allowed only when CI, HTTPS smoke, 200-session load test, isolated restore drill, Sentry test event, and three-role UAT all refer to the same release. Roll back by immutable image tag; do not roll back Firestore data destructively.
