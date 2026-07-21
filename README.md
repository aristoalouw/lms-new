# Nusa Campus

Nusa Campus adalah fondasi platform informasi kampus terpadu untuk PMB, akademik, pembelajaran, keuangan mahasiswa, kemahasiswaan, kelulusan, tracer study, layanan administrasi, dashboard pimpinan, dan pelaporan PDDIKTI. Aplikasi memakai Nuxt 3/Vue 3, Bootstrap, builder Webpack, Firebase, Axios, dan Nginx sebagai satu-satunya pintu masuk produksi.

Repositori ini memisahkan mode demo lokal dari runtime produksi. Mode demo tidak boleh diaktifkan di produksi, seluruh otorisasi sensitif tetap diverifikasi pada server/Firebase Security Rules, dan tidak ada fitur berbasis AI dalam cakupan.

## Menjalankan secara lokal

Prasyarat: Node.js 20.19+ (Node 22 direkomendasikan), npm, dan PowerShell 7 atau shell setara.

```powershell
Copy-Item .env.example .env
npm ci
npm run dev
```

Buka `http://localhost:3000`. Konfigurasi bawaan `.env.example` memakai data mock dan autentikasi demo hanya untuk pengembangan. Jangan menyalin secret produksi ke `.env` pada mesin yang tidak dikelola.

Pemeriksaan sebelum perubahan digabungkan:

```powershell
npm run typecheck
npm test
npm run build
```

## Runtime produksi

Nuxt menghasilkan Nitro server di `.output/server/index.mjs` dan hanya mendengarkan port internal 3000. Nginx menangani TLS, header keamanan, pembatasan trafik, dan cache aman. Kredensial Firebase Admin dipasang sebagai file read-only; secret tidak dibangun ke image maupun dimasukkan ke bundle browser.

Urutan rilis ringkas:

```powershell
Copy-Item .env.example .env.production
# Isi secret melalui secret manager/proses deployment, bukan Git.
& ./scripts/validate-env.ps1 -Path .env.production
docker compose --env-file .env.production -f infra/compose.prod.yml config --quiet
docker compose --env-file .env.production -f infra/compose.prod.yml build
docker compose --env-file .env.production -f infra/compose.prod.yml up -d
& ./scripts/smoke-production.ps1 -BaseUrl https://kampus.example.ac.id -RequireReady
```

Untuk quality gate lengkap dari clean release worktree—termasuk typecheck, test, build, dependency/scope checks, pencarian secret di output, dan validasi Compose bila Docker tersedia—jalankan:

```powershell
& ./scripts/verify-release.ps1 -EnvironmentFile .env.production
```

Instruksi lengkap, termasuk preflight, rollback, rotasi secret, dan health check ada di [panduan deployment](./docs/deployment.md). Jangan menjalankan Compose produksi sebelum Security Rules, indeks Firestore, backup, dan recovery drill disiapkan.

## Peta dokumentasi

- [Arsitektur dan model data](./docs/architecture.md)
- [Matriks role dan ruang lingkup akses](./docs/role-matrix.md)
- [Cakupan modul dan acceptance checklist](./docs/module-scope.md)
- [Audit penyelesaian tujuan dan gap bukti](./docs/completion-audit.md)
- [Penyiapan Firebase](./docs/firebase-setup.md)
- [Integrasi PDDIKTI Neo Feeder](./docs/neo-feeder.md)
- [Worker, gateway contract, dan rekonsiliasi PDDIKTI](./docs/pddikti.md)
- [Billing mahasiswa, piutang, cicilan, deposit, dan voucher](./docs/billing.md)
- [Ruang pembelajaran, tugas, forum, dan penilaian](./docs/learning.md)
- [Administrasi akademik, perwalian, RPS, tugas akhir, dan MBKM](./docs/academic-administration.md)
- [Deployment](./docs/deployment.md) dan [operasi harian](./docs/operations.md)
- [Privasi, analytics, dan Sentry](./docs/privacy-observability.md)
- [Backup, restore, dan recovery test](./docs/backup-restore.md)
- [Payment gateway dan rekonsiliasi](./docs/payment-gateway.md)
- [Penerimaan mahasiswa baru](./docs/admissions.md)
- [Impor dan migrasi data](./docs/import-migration.md)
- [KRS dan reservasi kelas](./docs/krs.md)
- [Troubleshooting](./docs/troubleshooting.md)

## Kontrak penting

- `GET /api/health`: liveness ringan; tidak memeriksa dependensi eksternal.
- `GET /api/ready`: readiness; mengembalikan 503 ketika datastore produksi tidak tersedia.
- Semua `/api/**`, halaman privat, file privat, dan respons yang memasang sesi wajib `Cache-Control: no-store`.
- `/_nuxt/**` saja yang diberi cache publik immutable oleh Nginx.
- Waktu persisten memakai UTC; tampilan kampus memakai `Asia/Jakarta`.
- Nilai uang disimpan sebagai bilangan bulat rupiah, bukan floating point.
- Audit bisnis bersifat append-only dan terpisah dari log teknis/Sentry.

## Struktur utama

```text
app/pages/components/  antarmuka Nuxt/Vue
server/                API Nitro, autentikasi, RBAC, dan service layer
firebase/              Security Rules, indeks, dan konfigurasi emulator
infra/                 image produksi, Compose, dan Nginx
scripts/               validasi, backup, recovery test, dan smoke test
docs/                  arsitektur dan runbook operasional
```

Laporkan insiden keamanan melalui kanal internal kampus; jangan memasukkan token, data mahasiswa, bukti pembayaran, atau isi dokumen ke issue publik.
