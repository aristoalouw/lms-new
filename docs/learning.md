# Learning spaces

Learning spaces are attached to academic-class rosters or explicit general-space participants. Access is derived on every request; the browser cannot read LMS collections directly.

## Content model

- Modules, materials, and assignments use immutable definition-version snapshots plus optimistic head versions.
- Rich content accepts plain text or a constrained Quill Delta. Raw HTML, unsafe attributes, and non-HTTPS external links are rejected.
- File material and submission attachments reference a specific `CLEAN` version from private file management; file bytes are not duplicated into Firestore.
- Assignment windows explicitly separate open, due, and close times. Final attempts are immutable and marked `ON_TIME` or `LATE`.
- Grades point to a specific final attempt. Learners see only published grades; teachers can keep drafts.
- Forum threads and posts retain bounded edit history, allow two nesting levels, and support audited moderation.
- Activity points are optional, explain their fixed rules, and use `DESCRIPTIVE_ONLY`; they are never used as AI/ML scoring.

## API surface

The `/api/learning` routes cover spaces, modules, materials, duplication, assignments, announcements, drafts, final attempts, grading, forums, moderation, dashboard progress, and gamification preference. The page at `/pembelajaran` is API-backed for learner and teacher workflows.

## Security and scaling

All LMS collections, including idempotency, attempts, grades, forum state, activity events, and preferences, are server-only in Firestore Rules. Server reads are bounded. High-cardinality nested content fields have automatic indexing disabled, and private file access is re-authorized before a signed download is issued.

## Evidence

Focused tests cover roster-derived access, immutable content versions, safe links/rich content, assignment windows, mutable drafts versus immutable attempts, grade publication, forum depth/moderation, and opt-in descriptive points.

