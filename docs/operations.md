# Operasi platform

## Target layanan

Target awal berikut harus disahkan pemilik layanan sebelum go-live dan ditinjau setelah baseline nyata tersedia:

| Indikator | Target awal | Sumber |
|---|---:|---|
| Ketersediaan layanan kritis bulanan | 99,9% | HTTPS synthetic + readiness |
| p95 respons API interaktif | < 2 detik | server metric, tanpa body/PII |
| Error 5xx | < 1% per 5 menit | Nginx/Nitro |
| Job PDDIKTI tertua | < 30 menit normal | Firestore job metric |
| Backup age | < 7 jam untuk target 6 jam | manifest backup |
| RPO/RTO | 6 jam / 4 jam (usulan) | recovery drill |

Periode PMB, KRS, input nilai, pembayaran, dan pelaporan PDDIKTI memiliki business criticality lebih tinggi. Capacity test, staffing on-call, dan change freeze dijadwalkan sebelum periode tersebut.

## Health dan readiness

- `GET /api/health` memeriksa proses hidup dan selalu ringan. Gunakan untuk container liveness.
- `GET /api/ready` memeriksa kemampuan melayani data produksi. Mengembalikan 503 saat Firebase tidak tersedia/misconfigured. Gunakan untuk load balancer dan deployment gate.
- `GET /nginx-health` hanya membuktikan edge Nginx hidup; bukan kesehatan aplikasi.

Endpoint health tidak boleh mengungkap project ID, credential mode, stack trace, hostname internal, versi dependency, atau isi data. Response body generik; detail masuk telemetry tersanitasi.

## Dashboard dan alert minimum

Pantau per environment dan release:

- request rate, p50/p95/p99 latency, 2xx/4xx/5xx, 401/403/429, active connections;
- container restart, readiness, CPU, memory, file descriptor, disk, TLS expiry, DNS;
- Firestore read/write/error/quota/index failure dan Storage error/quota;
- login failure/revocation, privileged role change, cross-scope denial anomaly;
- PDDIKTI queue age, success/failure/dead-letter, token failure, circuit breaker;
- payment callback age, duplicate/idempotency rejection, reconciliation exception;
- email/notification backlog/failure;
- last successful backup, backup duration/size, recovery drill age;
- Sentry event rate/regression per release tanpa PII.

Alert harus actionable dan memiliki runbook/owner. Contoh page: readiness gagal >5 menit, 5xx >5% selama 5 menit, payment callback backlog >10 menit, PDDIKTI dead-letter baru pada window laporan, backup melewati RPO, atau certificate <14 hari. Warning non-page: p95 melambat, quota >70%, disk >75%, repeated 429.

## Ritme operasi

### Setiap hari

- Tinjau readiness, error/latency, restart, queue/dead letter, payment exception, dan backup terbaru.
- Triase Sentry berdasarkan dampak/release; pastikan event sample tidak mengandung PII.
- Periksa anomali login, role change, akses ditolak, dan kapasitas storage.

### Setiap minggu

- Rekonsiliasi pembayaran dan PDDIKTI exception.
- Review dependency/security alert dan image base update yang tersedia; jadwalkan rilis, jangan patch ad hoc di container.
- Periksa certificate, quota trend, Firestore read amplification, slow endpoint, dan log ingestion.
- Sampling audit completeness untuk payment, grade publish, role assignment, dan document issuance.

### Setiap bulan/semester

- Uji restore terisolasi sesuai [runbook backup](./backup-restore.md); minimal bulanan untuk baseline awal.
- Review akses privileged dan akun dormant; review semua role/scope minimal per semester.
- Review retention/deletion, analytics/tag inventory, Sentry scrubber, CSP allowlist, dan vendor DPA.
- Load/capacity test sebelum PMB/KRS/nilai/PDDIKTI peak.
- Latih incident response dan kontak vendor; review SLO/error budget.

## Menjalankan dan memeriksa layanan

```powershell
docker compose --env-file .env.production -f infra/compose.prod.yml ps
docker compose --env-file .env.production -f infra/compose.prod.yml logs --since 15m app nginx
& ./scripts/smoke-production.ps1 -BaseUrl https://kampus.example.ac.id -RequireReady
```

Jangan menjalankan `docker inspect`/`docker compose config` ke tiket karena dapat menampilkan environment. Jangan menyalin response body mahasiswa ke kanal incident umum.

Restart terkontrol:

```powershell
docker compose --env-file .env.production -f infra/compose.prod.yml up -d --no-deps --force-recreate app
```

Restart bukan solusi untuk error validasi, index, credential revoked, atau job poison. Kumpulkan request ID/metric terlebih dahulu dan pastikan retry tidak menggandakan pembayaran/sinkron.

## Rate limit dan NAT kampus

Baseline Nginx: web 30 r/s/IP, API 20 r/s/IP, mutasi auth 60 r/menit/IP, upload write 2 r/s/IP, serta 40 koneksi/IP. GET/HEAD/OPTIONS auth memakai budget API biasa sehingga polling sesi tidak menghabiskan budget login. Burst tersedia untuk interaksi normal. Firebase account protection dan backend permission tetap authoritative.

Banyak pengguna kampus dapat berbagi satu NAT IP. Jika 429 valid meningkat:

1. identifikasi route, IP hash/ASN internal, user count, dan request pattern tanpa menonaktifkan limit global;
2. perbaiki polling/retry client yang agresif;
3. gunakan rate limit berbasis authenticated principal di backend atau trusted gateway;
4. bila perlu, ubah rate/burst melalui reviewed config dan load/security test;
5. jangan mempercayai `X-Forwarded-For` dari internet langsung. Hanya proxy tepercaya boleh menentukan client IP.

## Job dan integrasi

Worker mengambil job dengan lease + expiry, increment attempt atomik, dan heartbeat untuk pekerjaan panjang. Operator boleh retry hanya setelah mengklasifikasikan error. Dead-letter tidak dihapus; buat job pengganti yang merujuk sumber dan audit.

Untuk outage vendor:

- buka circuit breaker dan hentikan retry storm;
- pertahankan outbox/job, tampilkan status tertunda, dan beri alert operator;
- setelah pulih, naikkan concurrency bertahap sesuai rate limit;
- rekonsiliasi sebelum menyatakan backlog selesai.

Payment callback selalu didahulukan dibanding pekerjaan bulk. Jangan mengubah status lunas manual tanpa bukti, separation of duties, dan reconciliation entry.

## Pengelolaan pengguna

Joiner/mover/leaver:

1. verifikasi identitas dan tiket pemilik unit;
2. assign role + scope minimum, expiry bila sementara, dan MFA untuk privileged;
3. revoke sesi setelah perubahan;
4. uji akses dalam-scope/cross-scope;
5. audit actor/approver/reason;
6. saat keluar, disable akun segera, revoke token, hentikan integrasi/service key, dan reassign pekerjaan.

Akun break-glass disimpan terpisah, dipantau, diuji berkala tanpa akses data nyata, dan setiap penggunaan memicu incident review.

## Incident response

| Severity | Contoh | Respons awal usulan |
|---|---|---:|
| SEV-1 | kebocoran/korupsi data, pembayaran ganda massal, layanan kritis total gagal | 15 menit |
| SEV-2 | satu modul kritis gagal, backlog berdampak luas, readiness flapping | 30 menit |
| SEV-3 | degradasi terbatas/workaround tersedia | hari kerja yang sama |
| SEV-4 | defect minor/permintaan | backlog terencana |

Urutan: nyatakan incident dan commander, hentikan dampak (misalnya disable integration/write path), lindungi evidence, nilai data/role/period terdampak, komunikasikan status tanpa PII, pulihkan, rekonsiliasi, lalu post-incident review. Jangan menghapus log, job, atau record “untuk membersihkan” selama incident.

Kebocoran credential: revoke/rotate segera, cari pemakaian, invalidasi sesi bila relevan, audit Git/image/log/vendor, dan ikuti prosedur notifikasi privasi kampus. Kebocoran data: batasi akses, preservasi evidence, libatkan pejabat privasi/legal, dan jangan menghubungi subjek data tanpa koordinasi resmi.

## Change management

Setiap perubahan produksi memiliki owner, risk, test evidence, backup/migration/rollback plan, window, approver, dan hasil smoke check. Emergency change tetap direkam dan direview setelah incident. Hindari perubahan Nginx, Rules, index, role permission, analytics tag, dan payment/Feeder adapter di luar pipeline.

Konfigurasi Nginx diuji dan direload melalui release container, bukan diedit manual di container read-only. Drift host/config dideteksi dengan checksum atau deployment tooling.

## Capacity planning

Gunakan data 30/90 hari untuk concurrency, request rate, p95, Firestore reads per workflow, storage growth, upload bandwidth, queue duration, memory dan CPU. Trigger scale review saat sustained CPU/memory >70%, p95 mendekati SLO, quota >70%, queue tidak habis di luar peak, atau storage forecast melewati budget dalam 90 hari.

Load test memakai user/data sintetis dan account terpisah. Skenario minimum: login burst, 2.000 dashboard users, KRS submit serentak pada kelas terakhir, grade publish, payment callback duplikat, ekspor laporan, upload batas maksimum, dan PDDIKTI backlog. Validasi integritas setelah test, bukan hanya throughput.
