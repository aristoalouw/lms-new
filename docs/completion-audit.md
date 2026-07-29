# Audit penyelesaian LMS MVP

Audit ini memetakan scope `lms-mvp` ke bukti worktree per 29 Juli 2026. Status
terverifikasi lokal tidak menggantikan UAT tiga role, deploy Firebase, load test,
atau restore drill pada environment nyata.

## Terverifikasi pada source dan test lokal

- Login Firebase, session cookie delapan jam, logout, reset password, revocation,
  serta tepat satu role LMS: mahasiswa, dosen, atau administrator.
- RBAC profil LMS terpusat. Administrator tidak memiliki permission submit,
  grading, authoring konten, atau check-in; dosen hanya mengelola kelas yang
  ditugaskan; mahasiswa hanya mengakses enrolment aktifnya.
- CRUD kelas, katalog akademik, dosen pengampu dari akun aktif, ruang LMS satu
  banding satu, enrolment kanonik, capacity, withdraw/reactivate, audit,
  idempotency, dan optimistic version.
- Identitas enrolment diambil dari akun mahasiswa aktif. `studentUid`,
  `studentId`, program studi, dan role harus cocok; nama tidak dipercaya dari
  request administrator.
- Materi rich text Quill/plain text dirender tanpa `v-html`, tautan hanya HTTPS,
  file privat memvalidasi membership setiap kali download, dan upload tidak
  dapat menargetkan ruang di luar akses uploader.
- Tugas, draft, attempt final immutable, lateness, lampiran, grading draft atau
  published, feedback, serta tampilan jawaban/lampiran untuk dosen.
- Pengumuman, forum, QR attendance, replay protection, koreksi manual beralasan,
  notifikasi dalam aplikasi, dan UI capability untuk email/file yang belum aktif.
- Halaman file dan audit memiliki page middleware; halaman audit hanya untuk
  permission audit. Halaman admin support bersifat baca-saja untuk tugas dan
  presensi.
- Firestore dan Storage Rules khusus LMS deny-by-default. Browser hanya dapat
  membaca dan memperbarui field profil minimumnya sendiri; seluruh data LMS,
  audit, file privat, serta koleksi non-MVP harus melalui Nitro API.
- Composite indexes mencakup daftar kelas terfilter dan enrolment terindeks.
  Spark preparation memakai Rules LMS dan menghapus TTL policy berbayar.
- Load profile menguji kontrak 200 sesi bersamaan dengan target error di bawah
  1%, read p95 di bawah 1 detik, dan mutation p95 di bawah 2 detik.
- Tidak ada fitur atau dependency AI/ML.

## Bukti otomatis terakhir

- `npm run lint -- --quiet`: lulus.
- `npm run typecheck`: lulus.
- `npm test`: 56 file lulus, 1 file dilewati; 339 test lulus, 13 dilewati.
- `npm run test:rules`: 13 Firebase Emulator Rules test lulus.
- `npm run test:e2e`: 8 Playwright test lulus, termasuk journey penuh admin,
  dosen, dan mahasiswa serta negative authorization.
- `npm run check:no-ai`: lulus.
- `npm run check:dependencies`: lulus sesuai exception yang ditinjau dan
  memiliki tanggal kedaluwarsa.
- `npm run build`: lulus, menghasilkan Nitro `node-server`.
- `scripts/validate-env.ps1 -Path .env.hostinger.production`: lulus tanpa
  mencetak secret.

## Bukti environment yang masih wajib

1. Deploy Rules dan indexes LMS ke project Firebase yang benar, lalu simpan
   output deploy dan project ID. Firebase CLI lokal belum memiliki sesi login.
2. UAT nyata dengan masing-masing satu akun administrator, dosen, dan mahasiswa.
3. Jalankan load test 200 sesi pada staging; simpan p95 dan error rate.
4. Aktifkan dan verifikasi Sentry client/server bila DSN disediakan, termasuk
   alert 5xx dan pemeriksaan bahwa payload PII tetap tersaring.
5. Jalankan backup Firestore/Storage dan isolated restore drill; catat RPO/RTO.
6. File upload memerlukan Storage dan malware scanner produksi. Pengiriman email
   memerlukan provider; keduanya sengaja nonaktif pada paket Spark awal.
7. Deploy artefak final ke Hostinger Node.js Web App hanya setelah approval
   produksi, lalu smoke HTTPS, header/cache, readiness, dan negative API.

Production sign-off baru boleh diberikan setelah seluruh bukti environment di
atas dilampirkan pada commit release yang sama.
