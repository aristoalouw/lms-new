# LMS MVP implementation baseline

Last reviewed: 2026-07-27

## Baseline

- Nuxt 3, Vue 3, Bootstrap, Axios, Quill, Firebase Admin/Client, Sentry, Nginx, Vitest, Firebase Emulator, Playwright, and k6 are already present.
- The repository is a broad campus platform. `APP_FEATURE_PROFILE=lms-mvp` is the production boundary for the LMS-only surface; retained non-MVP code must remain inaccessible in that profile.
- Authentication, eight-hour server sessions, shared RBAC, canonical class enrolment, learning spaces, materials, private files, assignments, submissions, grading, announcements, discussions, QR attendance, audit, and notification primitives already exist.
- Firebase project `sttsp-lms-staging` is configured. Firestore and Authentication are available; Cloud Storage requires a billing upgrade and is not enabled.
- Production deployment is a Hostinger Business managed Node.js Web App. Docker/Nginx remains a portable reference and CI smoke target, not a Hostinger runtime requirement.
- The source tree is free of AI/ML dependencies and endpoints. `npm run check:no-ai` is the enforced guard.

## Coordinated backlog

| Batch | Required closure |
| --- | --- |
| 1 — Foundation | Clean lint baseline; exact dependency-advisory gate; upload idempotency; permission-aware navigation; strict profile/audit Firebase Rules; deterministic Firebase seed; Sentry cause preservation; baseline documentation. |
| 2 — Academic core | LMS-visible academic period/course master; immutable course-version reference on classes; class creation selectors; searchable enrolment picker for 100+ users; canonical roster-only access; modular material/file experience. |
| 3 — Learning workflows | Remove student submission/grade query cap; expose own attempt history; enforce forum participation permission; scalable forum pagination; attendance history; connect in-app/email queues to LMS events. |
| 4 — Operations | Redacted audit API/export; TTL cleanup declarations; quotas/cost guardrails; application security headers; Hostinger start/env/runbook; backup/restore and operational evidence templates. |
| 5 — Verification | Full admin → lecturer → student → lecturer → student Playwright journey; negative authorization; axe/responsive checks; Firebase Emulator coverage; performance review; clean production build. |

## Release constraints

- No production deployment, repository push, Firebase billing upgrade, paid email provider, or paid Sentry action is performed without explicit approval.
- Staging Firebase deploy and live load/restore drills require credentials and an approved execution window.
- Every batch exits only after lint, automated tests, Firebase Security Rules tests, and a production build pass from the same worktree state.
