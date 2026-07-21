# PDDIKTI worker and reconciliation

The PDDIKTI module uses a version-pinned **campus gateway contract**. It does not embed or claim a Neo Feeder vendor action schema. Before production use, the institution must verify its deployed gateway against the authorized PDDIKTI/Neo Feeder documentation and place the resulting opaque operation keys in configuration.

## Configuration

Required production variables:

- `PDDIKTI_CONTRACT_VERSION`: immutable identifier for the deployed campus gateway contract.
- `PDDIKTI_OPERATION_MAP_JSON`: JSON object mapping supported internal entity types to operator-verified, opaque gateway operation keys. Example shape only: `{"grade":"<verified-operation-key>"}`.
- `PDDIKTI_ADAPTER_BASE_URL`: HTTPS base URL of the institution-managed gateway.
- `PDDIKTI_ADAPTER_BEARER_TOKEN`: server-only gateway credential.
- `PDDIKTI_ADAPTER_TIMEOUT_MS`: 1,000-120,000 ms; default 20,000 ms.
- `PDDIKTI_MAX_BATCH_SIZE`: 1-100 records; default 50.
- `NEO_FEEDER_MAX_ATTEMPTS`: 1-10 worker attempts; default 5.
- `PDDIKTI_WORKER_SECRET`: independent random secret of at least 32 bytes. Do not reuse the session, Firebase, email-worker, or payment secret.

The older `NEO_FEEDER_*` credential variables are not interpreted as proof of an API contract. A verified gateway adapter must exist before the worker reports itself as configured.

## Adapter contract

The application sends neutral, versioned records to the campus gateway:

- contract version and opaque operation key;
- internal entity type and reporting scope;
- stable batch idempotency key;
- immutable record IDs, source versions, mapping versions, fingerprints, and scalar fields.

The gateway returns exactly one `ACCEPTED` or `REJECTED` result per internal record. Accepted results must include a remote identifier. The adapter validates response cardinality and identifiers and sanitizes all errors. Vendor credentials, raw response bodies, and unverified action names are never stored in job history.

Any contract change requires:

1. a new `PDDIKTI_CONTRACT_VERSION`;
2. versioned mapping definitions compatible with it;
3. mock contract tests using verified fixtures;
4. an operator-reviewed deployment of operation keys.

## Queue and worker lifecycle

1. Queueing validates role and program scope, source existence, eligibility blockers, mapping requirements, and contract compatibility.
2. Mapped records are frozen in a private payload snapshot. The job stores only its fingerprint and metadata, so list APIs do not expose academic payloads.
3. Workers claim due jobs transactionally with an owner, random lease token, and expiry. An expired `PROCESSING` lease can be recovered atomically and records a `LEASE_RECOVERED` event.
4. Payloads are split into bounded batches. Each batch uses `${payloadFingerprint}:${batchIndex}` as a stable idempotency key across every retry.
5. Adapter calls have an abort timeout. Failures use exponential backoff starting at 30 seconds, capped at one hour, and end in `DEAD_LETTER` at the configured attempt bound.
6. Batch results and internal-to-remote mappings are persisted with history. Final job updates require the same lease token, preventing a stale worker from overwriting a recovered job.
7. Manual retry is scoped, audited, optimistic through current job state, and idempotent at the API boundary.

The internal endpoint is `POST /api/pddikti/worker/run`. It does not use a browser session. A scheduler must send `X-PDDIKTI-Worker-Secret` or `Authorization: Bearer ...`; comparison is constant-time after enforcing the 32-byte minimum. Restrict this route further at Nginx by source network and rate limit.

## Reconciliation

Reconciliation creates a read-only comparison snapshot with one of four states:

- `MATCH`
- `DIFFERENT`
- `MISSING_REMOTE`
- `MISSING_INTERNAL`

Rows expose IDs, fingerprints, and differing field names—not full before/after values. Comparing never modifies the internal source or remote snapshot. A staff member must explicitly choose:

- `QUEUE_INTERNAL`: queue eligible internal truth through the normal idempotent worker; or
- `ACKNOWLEDGE_REMOTE`: record a reviewed decision without copying remote values into internal data.

Decisions use optimistic versions and audit logs. Leaders can read scoped reconciliation and worker status but cannot queue or decide changes.

## Firestore shapes

| Collection | Purpose | Important keys |
|---|---|---|
| `pddiktiSourceRecords` | Validated internal reporting projection | document ID `${entityType}:${internalId}`; `programStudyId`, `periodId`, `eligible`, `version` |
| `pddiktiMappingDefinitions` | Immutable mapping versions | document ID `${entityType}:${version}` |
| `pddiktiMappingPointers` | Active version pointer | document ID `entityType` |
| `pddiktiSyncJobs` | Queue, lease, progress, bounded retry state | `status`, `nextAttemptAt`, `leaseExpiresAt`, `programStudyId`, `updatedAt` |
| `pddiktiJobPayloads` | Private immutable mapped payload | document ID `jobId`; `records`, `payloadFingerprint` |
| `pddiktiBatchResults` | Per-attempt/batch result history | `jobId`, `attempt`, `batchIndex` |
| `pddiktiEntityMappings` | Internal-to-remote IDs and history | `entityType`, `internalId`, `programStudyId`, `status` |
| `pddiktiReconciliations` | Comparison snapshots and explicit decisions | `programStudyId`, `periodId`, `entityType`, `status`, `updatedAt` |
| `pddiktiWorkerRuns` | Worker execution summaries | `startedAt`, counts, contract version |
| `pddiktiStudentDataChanges` | Perubahan Data Mahasiswa dan keputusan operator | `studentId`, `programStudyId`, `status`, `version`, `updatedAt` |
| `pddiktiStudentDataChangeKeys` | Satu workflow PDM terbuka per mahasiswa | document ID opaque dari student ID; `requestId`, `status` |
| `idempotencyKeys` | Queue/retry/reconciliation replay records | opaque hashed document ID |
| `auditLogs` | Business audit events | existing append-only audit model |

Required compound query shapes:

- `pddiktiSyncJobs(status ASC, nextAttemptAt ASC)` for due claims.
- `pddiktiSyncJobs(status ASC, leaseExpiresAt ASC)` for abandoned lease recovery.
- Existing job-list combinations: `programStudyId/status/updatedAt DESC`.
- `pddiktiReconciliations(programStudyId ASC, updatedAt DESC)` for scoped lists.
- `pddiktiSourceRecords(programStudyId ASC, periodId ASC)` for readiness.
- `pddiktiStudentDataChanges(programStudyId ASC, status ASC, updatedAt DESC)` untuk antrean PDM.

Single-field equality/index merging covers batch history by `jobId`, mappings by entity/program, verification pointers, and worker-run ordering. Exempt large server-only fields from indexing: payload `records`, source `data` and `blockers`, job `history`, batch `itemResults`, reconciliation `rows`, mapping `history`, and idempotency `response`.

All collections above must remain server-only in Firestore Rules. The Nuxt server performs role, program-scope, contract, transaction, and audit enforcement; direct client reads and writes should be denied.

## Perubahan Data Mahasiswa dan kelayakan ijazah

Halaman `/pddikti/data-mahasiswa` menyediakan workflow PDM `SUBMITTED → VALIDATED → QUEUED → COMPLETED` dengan cabang `REJECTED`. Setiap transisi memakai optimistic version dan audit. Penyelesaian wajib menyertakan tiket remote yang diverifikasi operator. Bukti PDM berupa 1–10 referensi file privat; audit hanya menyimpan nama field yang berubah, bukan nilai identitas lama/baru.

Pemeriksaan kelayakan penomoran ijazah tidak menerbitkan nomor. Ia membentuk snapshot hash dari enam pemeriksaan: sumber mahasiswa lengkap/eligible, sumber kelulusan lengkap/eligible, mapping aktif mahasiswa, mapping aktif kelulusan, tidak ada PDM terbuka, dan tidak ada perbedaan rekonsiliasi terbuka untuk mahasiswa/kelulusan. Hasil snapshot menjadi bukti masukan bagi modul kelulusan; alokasi nomor resmi tetap dilakukan oleh transaksi modul dokumen kelulusan.

Endpoint terkait:

- `GET/POST /api/pddikti/student-data-changes`
- `POST /api/pddikti/student-data-changes/:id/transition`
- `GET /api/pddikti/diploma-eligibility?studentId=&programStudyId=&periodId=`

## Operations

- Monitor `/api/pddikti/worker/status` through an authenticated staff/leader session. `configured: false` means no connection claim is made.
- Alert on growing `DEAD_LETTER`, expired `PROCESSING` leases, repeated `LEASE_RECOVERED`, adapter health failure, and contract-version mismatch.
- Retry only after correcting the source, mapping, or gateway cause. Manual retry of a dead letter starts a new bounded attempt budget and remains auditable.
- Never edit a job payload snapshot. Queue a new job after source correction so it receives a new fingerprint.
- Do not resolve `DIFFERENT` rows by copying remote values automatically. Use the explicit decision flow and the institution's data-correction procedure.
