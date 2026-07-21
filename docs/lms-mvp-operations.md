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

1. Deploy Firestore Rules, Storage Rules, and indexes to the staging Firebase project.
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

## Backup and isolated restore

Follow `docs/backup-restore.md` and `scripts/backup-firebase.ps1`. Restore into a separate recovery project, deploy the same Rules/indexes, compare collection/object counts, and sample LMS records (`academicClasses`, `classEnrollments`, `learning*`, `files`, `fileVersions`, and attendance subcollections). Record observed RPO and RTO in the pilot sign-off. Never point the recovery drill at production clients.

## Production promotion

Production promotion is allowed only when CI, HTTPS smoke, 200-session load test, isolated restore drill, Sentry test event, and three-role UAT all refer to the same release. Roll back by immutable image tag; do not roll back Firestore data destructively.
