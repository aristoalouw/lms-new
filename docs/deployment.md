# Deployment produksi

Panduan ini menargetkan host Linux dengan Docker Engine/Compose v2. Operator dapat menjalankan perintah dari PowerShell 7 melalui SSH/CI. Nginx container adalah satu-satunya port publik; port Nuxt 3000 tidak dipublikasikan. Untuk Hostinger Business managed Node.js Web App, gunakan [runbook Hostinger](./hostinger-node-deployment.md), bukan konfigurasi Nginx ini.

## Prasyarat

- DNS final mengarah ke load balancer/host dan perubahan firewall disetujui.
- Port 80 hanya untuk redirect/renewal certificate; 443 untuk aplikasi. SSH/admin dibatasi VPN/allowlist.
- Docker Engine dan `docker compose` terpasang; host memiliki sinkronisasi waktu, disk monitoring, log rotation, patching, dan EDR sesuai kebijakan.
- Certificate valid beserta full chain dan private key tersedia di secret store host dengan permission minimum.
- Project Firebase production, Rules/indexes, service account runtime, backup project/bucket, dan recovery project sudah disiapkan.
- Neo Feeder connectivity/VPN, payment callback origin/signature, email sender, Sentry, serta analytics consent telah diuji di staging.
- Artifact release berasal dari commit/tag yang telah lulus quality gate; jangan membangun dari worktree yang kotor pada host produksi.

## Kontrak environment

Salin template lalu isi melalui secret manager atau pipeline terlindungi:

```powershell
Copy-Item .env.example .env.production
```

Nilai produksi minimum:

```dotenv
NODE_ENV=production
DEPLOYMENT_TARGET=docker
TRUSTED_PROXY_HOPS=1
NUXT_PUBLIC_APP_ENVIRONMENT=production
NUXT_PUBLIC_API_BASE_URL=/api
NUXT_PUBLIC_DEMO_MODE=false
ENABLE_DEMO_AUTH=false
CAMPUS_DATA_MODE=firebase
ALLOW_PRODUCTION_MOCK=false
RATE_LIMIT_BACKEND=firestore
RATE_LIMIT_KEY_SECRET=<base64url-32-byte-random>
FIREBASE_USE_APPLICATION_DEFAULT=true
FIREBASE_STORAGE_BUCKET=<project-bucket>
NUXT_PUBLIC_FIREBASE_STORAGE_BUCKET=<project-bucket>
FILE_QUOTA_BYTES=262144000
FILE_CURSOR_SECRET=<base64url-32-byte-random>
CLAMAV_HOST=<private-scanner-host>
CLAMAV_PORT=3310
PMB_PII_HASH_SECRET=<base64url-32-byte-random>
PAYMENT_GATEWAY_PROVIDER_ID=<provider-id>
PAYMENT_GATEWAY_WEBHOOK_SECRET=<base64url-32-byte-random>
PASSWORD_RESET_CONTINUE_URL=https://<campus-host>/login
EMAIL_DELIVERY_ENDPOINT=https://<institution-email-gateway>/v1/messages
EMAIL_DELIVERY_BEARER_TOKEN=<base64url-32-byte-random>
EMAIL_FROM=no-reply@<campus-domain>
EMAIL_WORKER_SECRET=<base64url-32-byte-random>
NUXT_PUBLIC_ANALYTICS_PRIVATE_ENABLED=false
```

`NUXT_SESSION_SECRET`, `RATE_LIMIT_KEY_SECRET`, `FILE_CURSOR_SECRET`, `PMB_PII_HASH_SECRET`, `PAYMENT_GATEWAY_WEBHOOK_SECRET`, `EMAIL_DELIVERY_BEARER_TOKEN`, dan `EMAIL_WORKER_SECRET` harus acak minimal 32 byte serta independen per tujuan dan environment. Jangan mencetaknya ke terminal rekaman/CI log. `FIREBASE_ADMIN_CREDENTIALS_FILE`, `TLS_FULLCHAIN_FILE`, dan `TLS_PRIVATE_KEY_FILE` adalah path absolut pada host, bukan path repository. File Firebase dipasang ke `/run/secrets/firebase-admin.json` dan private key TLS ke Nginx secara read-only.

`CLAMAV_HOST` harus menunjuk scanner privat yang dapat dijangkau container aplikasi dan tidak dipublikasikan ke Internet. Produksi bersifat fail-closed: file tetap berstatus karantina dan tidak dapat diunduh bila scanner tidak tersedia atau pemindaian gagal. Bucket server dan browser harus sama; akses objek tetap melalui API dan signed URL berumur pendek, bukan Rules browser yang terbuka.

Validasi tanpa menampilkan nilai secret:

```powershell
& ./scripts/validate-env.ps1 -Path .env.production
docker compose --env-file .env.production -f infra/compose.prod.yml config --quiet
```

`docker compose config` dapat memuat environment ke output bila dijalankan tanpa `--quiet`; jangan menyimpan outputnya sebagai artefak publik.

## Preflight rilis

Jalankan dari commit release:

```powershell
npm ci
npm run typecheck
npm test
npm run build
git status --short
```

Quality gate yang setara dapat dijalankan sekaligus dan tidak menampilkan nilai secret:

```powershell
& ./scripts/verify-release.ps1 -EnvironmentFile .env.production
```

Script memeriksa file credential yang terlacak, dependency AI/out-of-scope, versi dependency yang tidak dikunci, `COPY . .`, kebocoran nilai server ke `.output`, typecheck/test/build, dan model Compose bila Docker tersedia. Jalankan dari clean release worktree; kegagalan satu gate memblokir rilis.

Kemudian:

1. Pastikan tidak ada secret pada Git/image/build log dan dependency vulnerability telah ditriase.
2. Jalankan test Firebase Rules/API via emulator dan E2E critical flow pada staging.
3. Unggah PDF/JPEG/PNG sintetis yang bersih, lalu verifikasi transisi `QUARANTINED -> CLEAN`; gunakan file uji EICAR yang disetujui pada staging dan pastikan hasilnya `REJECTED`, tidak pernah dapat diunduh, serta tidak masuk backup produksi.
4. Jalankan satu pengiriman email sintetis melalui gateway staging dan satu password reset; verifikasi outbox retry/idempotency tanpa merekam link reset, bearer token, atau body email di log.
5. Deploy Rules/indexes yang kompatibel terlebih dahulu; perubahan schema harus backward-compatible selama rolling update.
6. Ambil backup prarilis dan pastikan backup terakhir/recovery drill masih valid.
7. Catat image digest, migration ID, release owner, business approver, dan rollback image.
8. Konfirmasi maintenance window bila ada operasi non-backward-compatible atau write freeze.

## Build image

Untuk registry internal:

```powershell
$image = "registry.example.ac.id/campus/nusa-campus:2026.07.21-<sha>"
docker build --pull --file infra/Dockerfile --tag $image .
docker push $image
docker inspect --format='{{index .RepoDigests 0}}' $image
```

Pin `APP_IMAGE` ke tag immutable atau digest dalam secret/deployment configuration. Pipeline sebaiknya menghasilkan SBOM, vulnerability scan, provenance, dan signature. Base image diperbarui melalui rilis terkontrol, bukan `latest` otomatis.

Dockerfile memakai allowlist direktori build agar `.env.production`, key, cache, dan artefak operator tidak pernah masuk layer. Bila struktur source baru ditambahkan (misalnya `stores/` atau `utils/`), perbarui allowlist Dockerfile dan ulang build; jangan menggantinya dengan `COPY . .` tanpa `.dockerignore` yang telah diaudit.

## Deploy

Pada host produksi:

```powershell
docker compose --env-file .env.production -f infra/compose.prod.yml pull
docker compose --env-file .env.production -f infra/compose.prod.yml up -d --remove-orphans
docker compose --env-file .env.production -f infra/compose.prod.yml ps
```

Compose menunggu liveness app sebelum menyalakan Nginx. Liveness tidak membuktikan Firebase siap; readiness adalah gate menerima trafik. Pada load balancer, probe `/api/ready` melalui HTTPS dan keluarkan instance yang mengembalikan 503. Jangan restart loop hanya karena outage Firebase sementara.

Periksa log metadata tanpa menampilkan body/env:

```powershell
docker compose --env-file .env.production -f infra/compose.prod.yml logs --since 10m app nginx
```

## Verifikasi pascarilis

```powershell
& ./scripts/smoke-production.ps1 -BaseUrl https://kampus.example.ac.id -RequireReady
curl.exe -I http://kampus.example.ac.id/
curl.exe -I https://kampus.example.ac.id/api/health
```

Harapan:

- HTTP mengalihkan 308 ke HTTPS;
- TLS chain/hostname valid dan hanya TLS 1.2/1.3;
- `/api/health` 200 dan `/api/ready` 200;
- halaman privat/API memiliki `Cache-Control: no-store`;
- `/_nuxt/**` memakai cache immutable dan tidak memasang cookie;
- HSTS, CSP, `nosniff`, deny framing, referrer/permissions policy hadir;
- login nyata, logout/revocation, satu request scoped, dan satu negative cross-scope test lulus;
- Sentry menerima synthetic sanitized error hanya bila disetujui; analytics tidak aktif sebelum consent dan tidak aktif di halaman privat;
- antrean background tidak backlog dan tidak ada lonjakan 401/403/429/5xx.

### Kontrak worker email

Scheduler privat memanggil `POST /api/internal/notifications/outbox/process` dengan `Authorization: Bearer <EMAIL_WORKER_SECRET>`. Endpoint menerima body opsional `{ "limit": 5 }`, memproses paling banyak 10 item per panggilan, dan mengembalikan hasil tersanitasi tanpa alamat penerima, isi pesan, atau link reset. Jalankan interval lebih pendek daripada durasi lease outbox; pemanggilan paralel aman karena setiap item diklaim atomik dan provider menerima idempotency key yang stabil.

Aplikasi memanggil `EMAIL_DELIVERY_ENDPOINT` melalui HTTPS dengan bearer token server-only dan JSON berikut:

```json
{
  "from": "no-reply@kampus.ac.id",
  "to": "recipient@example.invalid",
  "subject": "Subjek",
  "text": "Isi plain-text",
  "idempotencyKey": "opaque-stable-key"
}
```

Gateway harus mengembalikan respons JSON 2xx `{ "messageId": "provider-stable-id" }`. Timeout, non-2xx, content type selain JSON, atau respons tanpa `messageId` dianggap gagal dan mengikuti retry/backoff/dead-letter outbox. Link reset Firebase dibuat di memory tepat sebelum pengiriman, tidak disimpan di Firestore, dan tidak boleh dicatat oleh gateway, reverse proxy, telemetry, atau job scheduler. Batasi route worker ke scheduler/mesh privat di Nginx atau firewall selain autentikasi bearer aplikasi.

HSTS `includeSubDomains` hanya aman bila seluruh subdomain institusi telah HTTPS. Jika domain yang sama menampung layanan legacy HTTP, gunakan hostname terpisah atau ubah kebijakan sebelum go-live; jangan mengetahui masalah ini setelah browser menerima HSTS.

## Database/schema rollout

Firestore tidak memerlukan migration DDL, tetapi field/index/state tetap memiliki compatibility contract:

1. deploy reader yang menerima field lama dan baru;
2. deploy Rules/indexes yang mengizinkan transisi aman;
3. jalankan backfill idempotent, bounded, rate-limited, dan resumable;
4. rekonsiliasi count/checksum serta exception;
5. aktifkan writer baru dengan feature flag server-side;
6. hapus compatibility path pada rilis berikutnya setelah rollback window.

Jangan menjalankan delete massal sebagai bagian startup container. Setiap migration memiliki dry-run, checkpoint, audit, backup, owner, dan rollback/compensation plan.

## Rollback

Rollback aplikasi ke digest sebelumnya hanya bila schema/Rules tetap backward-compatible:

```powershell
# Ubah APP_IMAGE ke digest release sebelumnya yang telah dicatat.
docker compose --env-file .env.production -f infra/compose.prod.yml up -d --no-build
& ./scripts/smoke-production.ps1 -BaseUrl https://kampus.example.ac.id -RequireReady
```

Jangan “rollback data” dengan mengimpor backup ke produksi untuk error aplikasi biasa; itu dapat menghapus transaksi sah setelah titik backup. Gunakan forward fix atau compensation. Full restore hanya untuk insiden kehilangan/korupsi data dengan persetujuan incident commander dan prosedur [backup/restore](./backup-restore.md).

## TLS dan rotasi secret

Certificate renewal dilakukan sebelum 30 hari tersisa. Pasang file baru secara atomik di host, validasi `nginx -t` pada staging, lalu recreate/reload Nginx dan uji chain. Private key baru tidak boleh dapat dibaca user aplikasi.

Rotasi Firebase/Neo Feeder/payment/Sentry secret satu jenis per perubahan: pasang baru, rolling restart, verifikasi readiness dan fungsi, revoke lama, lalu audit. Rotasi `NUXT_SESSION_SECRET` membatalkan sesi aktif dan harus diumumkan/direncanakan.

## Hardening host

- Gunakan user deployment non-root; Docker privilege tetap dianggap setara root dan dibatasi.
- Aktifkan patch otomatis yang terkontrol, disk encryption, backup konfigurasi, NTP, firewall egress/ingress, dan alert disk/memory.
- Container berjalan read-only, non-root (app), capability minimum, `no-new-privileges`, pids/memory/CPU limit, serta log rotation.
- Jangan mount Docker socket, source tree, home directory, atau bucket credential umum ke container.
- Nginx access log mencatat path tanpa query/body/cookie/auth header. Kirim log ke sink terenkripsi dengan retention terbatas.

## Catatan skala

Untuk beberapa instance, tempatkan Nginx/load balancer terkelola di depan dan jalankan image stateless yang sama. Session diverifikasi Firebase, bukan memory lokal. Background worker wajib memakai lease. Rate limit per-instance Nginx perlu dipindah/ditambah dengan kontrol terpusat bila IP dapat berpindah antar instance. Uji beban dengan data sintetis; jangan menggunakan akun atau nilai mahasiswa nyata.
