# Troubleshooting

Mulai dari request ID, waktu UTC, route template, role/scope uji, release/image digest, status health/readiness, dan metric. Jangan meminta screenshot yang menampilkan nilai, tagihan, NIK, dokumen, cookie, token, atau credential. Gunakan data sintetis untuk reproduksi.

## Pemeriksaan cepat

```powershell
docker compose --env-file .env.production -f infra/compose.prod.yml ps
& ./scripts/smoke-production.ps1 -BaseUrl https://kampus.example.ac.id
docker compose --env-file .env.production -f infra/compose.prod.yml logs --since 15m app nginx
```

Hindari `docker compose config` tanpa `--quiet`, `docker inspect`, dump environment, atau logging HTTP body ke tiket. Filter log berdasarkan request ID dan bagikan metadata minimum.

## Startup dan deployment

| Gejala | Pemeriksaan aman | Tindakan |
|---|---|---|
| `npm ci` gagal lock mismatch | `git status --short`; versi Node/npm; error package | gunakan Node 20.19+/22 dan commit lock yang cocok; jangan memakai `npm install --force` di produksi |
| build kehabisan memory | metric CI, Node heap, bundle report tanpa source | tambah resource build sementara, perbaiki import/bundle; runtime limit tidak memengaruhi build stage |
| app container unhealthy | `logs --since 10m app`; probe `/api/health` di network | perbaiki startup/config; jangan mengubah health menjadi selalu sukses untuk menyembunyikan crash |
| Nginx tidak start | log Nginx, path certificate, permission, syntax | perbaiki fullchain/key mount dan config di staging; jangan copy key ke image |
| Compose variable “required” | jalankan `validate-env.ps1`; cek path file | isi `.env.production` dari secret manager dan gunakan `--env-file`; jangan commit file |
| read-only filesystem error | cari path write pada app log | pindahkan temporary write ke `/tmp` atau layanan Storage; jangan mematikan read-only tanpa review |

## HTTPS dan Nginx

| Gejala | Kemungkinan | Tindakan |
|---|---|---|
| redirect loop | upstream menganggap HTTP atau proxy berlapis salah | pastikan satu trusted edge meneruskan `X-Forwarded-Proto=https`; jangan percaya header langsung dari internet |
| certificate mismatch/chain invalid | certificate hostname/fullchain salah | pasang certificate benar, verifikasi DNS/SNI/chain, recreate Nginx |
| browser menolak subdomain setelah HSTS | `includeSubDomains` aktif sementara subdomain masih HTTP | pulihkan HTTPS subdomain; HSTS browser tidak dapat ditarik segera—review domain sebelum enable |
| 413 upload | file >25 MiB atau route bukan `/api/files/**` | cek policy file; gunakan upload session/object storage untuk file besar, jangan naikkan global limit sembarang |
| 429 login/API | brute force, retry loop, atau shared NAT kampus | identifikasi route/metric, perbaiki polling, gunakan principal limiter; tuning rate/burst melalui change review |
| 502/504 | app tidak ready, crash, atau request eksternal terlalu lama | cek `/api/health`, `/api/ready`, upstream latency dan circuit breaker; pindahkan pekerjaan berat ke job |
| header keamanan/cache hilang | location Nginx override `add_header` inheritance | uji `smoke-production.ps1`; setiap location dengan `add_header` perlu set keamanan/cache yang tepat |
| aset JS diblokir CSP | domain/runtime membutuhkan source yang belum disetujui | self-host atau tambah allowlist minimum setelah review; jangan memakai wildcard/`unsafe-eval` |

## Firebase dan autentikasi

| Gejala | Pemeriksaan aman | Tindakan |
|---|---|---|
| `/api/ready` 503 | Firebase Admin unavailable, IAM/network/quota | cek project ID, mounted ADC path, service account permission dan Firebase metrics; jangan log JSON key |
| mode mock di produksi | `CAMPUS_DATA_MODE`, `ALLOW_PRODUCTION_MOCK`, release env | hentikan rilis, set `firebase`/false, jalankan validator dan incident review bila data nyata masuk mock |
| login berhasil lalu kembali login | cookie Secure/SameSite/domain, clock, session secret/revocation | pastikan HTTPS, waktu host, cookie header, Firebase authorized domain; rotasi secret terencana |
| 401 setelah role berubah | token/session lama direvoke atau claims belum refresh | ini expected; login ulang. Pastikan admin revoke dan UI menjelaskan sesi berakhir |
| 403 hanya pada prodi tertentu | scope claims tidak memuat ID atau assignment salah | periksa stable scope ID dan audit assignment; jangan bypass scope di endpoint |
| Firestore `permission-denied` client | Rules/claim/owner mismatch | reproduksi emulator dengan claim sintetis, perbaiki Rules/flow; Admin API tetap wajib RBAC |
| query meminta index | composite index belum dideploy | tambahkan ke config ter-version, test staging, deploy pipeline; jangan fallback membaca semua dokumen |
| quota/read melonjak | listener/query unbounded atau N+1 | hentikan job penyebab, tambah pagination/agregat/index/cache server aman; review query plan/read count |
| Storage download ditolak | metadata owner/status scan/Rules/URL expiry | authorize ulang dan buat signed URL baru; jangan membuat bucket/object public |

Jangan menambahkan `Owner` ke service account untuk memperbaiki permission. Identifikasi permission minimum dan pisahkan runtime/deploy/backup/recovery principals.

## Data bisnis

| Gejala | Tindakan aman |
|---|---|
| KRS kapasitas negatif/terlampaui | hentikan submit kelas, preservasi record/version/audit, rekonsiliasi item KRS vs kapasitas, perbaiki transaction, gunakan correction audited |
| KRS approval 409 conflict | reload version terbaru dan ulang review; jangan force overwrite |
| pembayaran/callback duplikat | jangan hapus payment; cek idempotency/external reference dan gateway, blokir consumer bila perlu, buat reconciliation/compensation |
| invoice tidak berubah setelah payment | cek job/transaction/audit dan mapping invoice; retry hanya dengan idempotency key sama |
| nilai draft terlihat mahasiswa | incident privasi: tutup route/rules, preservasi evidence, koreksi permission/cache, nilai dampak |
| nomor dokumen ganda | hentikan issuance, lock allocator, audit reservation/concurrency, jangan renumber tanpa pemilik dokumen |
| dashboard berbeda dari sumber | periksa period/scope/filter dan snapshot `updatedAt`; rebuild agregat idempotent, jangan ubah transaksi sumber agar cocok dashboard |

## Neo Feeder

| Gejala | Pemeriksaan | Tindakan |
|---|---|---|
| token/auth gagal | secret rotation, clock, endpoint/VPN, 401 rate | buka circuit breaker, verifikasi account via kanal operator, rotasi; jangan log credential/response mentah |
| timeout/5xx/429 | vendor health, duration, attempt/backoff | retry exponential+jitter sesuai `nextAttemptAt`; batasi concurrency |
| job lama `PROCESSING` | lease owner/expiry dan worker restart | setelah lease expired, requeue atomik; pastikan job pertama tidak masih aktif |
| partial batch | hasil per record/mapping | tandai sukses per record, retry yang transient saja, rekonsiliasi unknown outcome sebelum insert |
| duplicate di Feeder | idempotency/mapping hilang atau timeout-after-commit | stop entity type, lookup/reconcile target, repair mapping audited; jangan terus retry insert |
| dead letter bertambah | validation/schema/reference berubah | pause queue dependent, jalankan contract test, perbaiki mapping/data lalu manual retry berizin |

## Backup, restore, dan impor

| Gejala | Tindakan |
|---|---|
| export Firestore denied | periksa backup principal, bucket IAM, Firestore service agent; gunakan permission minimum |
| import location tidak cocok | buat recovery database/bucket kompatibel; jangan mengubah source/production |
| Storage object count beda | cek watermark/upload in-flight, permission, version/delete markers dan rsync error; drill dinyatakan gagal |
| recovery ready 503 | cocokkan project/ADC/Rules/indexes/image dan pastikan mock/emulator off |
| import duplicate | hentikan worker, cek batch checksum/idempotency/row hash, lakukan compensation sesuai version |
| import conflict | data target berubah setelah preview; validasi dan approval ulang, jangan last-write-wins |

Ikuti [runbook backup](./backup-restore.md) dan [panduan import](./import-migration.md); jangan memulihkan backup produksi untuk membatalkan satu batch tanpa impact analysis.

## Sentry dan analytics

| Gejala | Tindakan |
|---|---|
| Sentry tidak menerima event | DSN/environment/egress/CSP/sampling; kirim synthetic sanitized error | biarkan off sampai scrubber lulus; jangan kirim data nyata untuk test |
| Sentry menerima PII/token | disable DSN segera, revoke secret/token terdampak, hapus event sesuai prosedur vendor, lakukan privacy incident review dan perbaiki scrubber |
| analytics tetap terkirim setelah reject | consent state/tag trigger/SPA navigation | disable flag/container, perbaiki default denied + allowlist, audit vendor data |
| Clarity muncul di portal privat | hentikan Clarity seluruh environment, review route transition/masking, nilai dampak privasi |
| GTM tag tak dikenal | unpublish/rollback container, audit user/version, rotate access bila perlu |

## Paket eskalasi aman

Sertakan:

- waktu UTC dan zona lokal, environment, release/image digest;
- request ID, route template, HTTP/error code, duration, jumlah user/record terdampak;
- status `/api/health` dan `/api/ready`, metric/alert terkait;
- langkah reproduksi dengan data sintetis serta perubahan terakhir;
- tindakan containment yang sudah dilakukan.

Jangan sertakan raw Firestore document, request/response body, query string, header/cookie, environment dump, service account, signed URL, NIK/NIM/email, nilai, transaksi, atau dokumen. Bila evidence sensitif wajib, gunakan vault/forensic channel resmi dengan akses dan retention terbatas.
