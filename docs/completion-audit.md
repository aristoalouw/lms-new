# Audit penyelesaian platform kampus dan LMS

Audit ini memetakan scope `full-campus` dan kontrak kompatibilitas `lms-mvp` ke
bukti worktree per 1 Agustus 2026. Status terverifikasi lokal tidak menggantikan
UAT seluruh role, deploy Firebase Rules/index, load test, atau restore drill pada
environment nyata.

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
- Seluruh modul full-campus tetap tersedia: PMB, administrasi akademik, KRS/KHS,
  kelas dan LMS, keuangan, PDDIKTI, evaluasi, kemahasiswaan, kelulusan/dokumen,
  tracer study, layanan, notifikasi, file, import, audit, dan pengaturan.
- Onboarding mahasiswa kanonik menulis profil akademik, state KRS, dan profil
  billing secara atomik setelah akun, scope, dosen wali, prodi, periode, serta
  kurikulum nyata tervalidasi. Import enam kolom tidak lagi dipresentasikan
  sebagai aktivasi operasional lengkap.
- Master periode menulis definisi semester dan kebijakan KRS bersamaan, termasuk
  status serta batas revisi; layanan KRS tidak lagi bergantung pada koleksi yang
  tidak pernah diisi UI master.

## Bukti otomatis terakhir

- `npm ci`: lulus dari lockfile yang sama.
- `npm run lint`: lulus.
- `npm run typecheck`: lulus.
- `npm test`: 57 file lulus, 1 file dilewati; 348 test lulus, 13 dilewati.
- `npm run test:rules`: 13 Firebase Emulator Rules test lulus.
- `npm run test:e2e`: 9 Playwright test lulus, termasuk journey penuh admin,
  dosen, dan mahasiswa serta negative authorization.
- `npm run test:e2e:full-campus`: 3 suite lulus; 28 route publik/privat lintas
  delapan profil role tidak menghasilkan hydration mismatch, browser runtime
  error, atau respons 5xx; layout mahasiswa 360 px juga lulus.
- `npm run check:no-ai`: lulus.
- `npm run check:dependencies`: lulus dengan 0 critical dan 0 high; tersisa 9
  moderate pada seluruh dependency tree (6 pada production tree) dari rantai
  Firebase/Google Cloud yang tidak memiliki upgrade kompatibel.
- `npm run build`: lulus, menghasilkan Nitro `node-server`.
- `scripts/validate-env.ps1 -Path .env.hostinger.production`: lulus tanpa
  mencetak secret.

## Bukti environment yang masih wajib

1. Deploy Rules dan indexes dari release yang sama ke project Firebase yang
   benar, lalu simpan output deploy dan project ID. Login Firebase CLI tersedia,
   tetapi bukti deploy Rules/index release ini belum dilampirkan.
2. Lengkapi data nyata minimum: akun dosen wali, kurikulum aktif, kebijakan KRS,
   onboarding mahasiswa, kelas/enrolment, dan profil/tagihan billing. Jangan
   menggantinya dengan seed atau dashboard dummy pada production.
3. UAT nyata dengan akun applicant, mahasiswa, dosen/dosen wali, staf akademik,
   keuangan, PMB, kemahasiswaan, pimpinan, serta administrator.
4. Jalankan load test 200 sesi pada staging; simpan p95 dan error rate.
5. Aktifkan dan verifikasi Sentry client/server bila DSN disediakan, termasuk
   alert 5xx dan pemeriksaan bahwa payload PII tetap tersaring.
6. Jalankan backup Firestore/Storage dan isolated restore drill; catat RPO/RTO.
7. File upload memerlukan Storage dan malware scanner produksi. Pengiriman email
   memerlukan provider; keduanya sengaja nonaktif pada paket Spark awal.
8. Release `5b194fe` sudah aktif hanya pada `lms.sttsaintpaul.ac.id`; artefak
   onboarding pada audit ini belum menjadi release production. Deploy berikutnya
   wajib tetap hanya ke domain tersebut, lalu ulangi smoke HTTPS, header/cache,
   readiness, login Firebase nyata, dan negative API.

Production sign-off baru boleh diberikan setelah seluruh bukti environment di
atas dilampirkan pada commit release yang sama.
