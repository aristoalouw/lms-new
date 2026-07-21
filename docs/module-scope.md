# Cakupan modul dan acceptance checklist

Dokumen ini adalah kontrak penerimaan, bukan klaim status implementasi. Kotak hanya boleh dicentang setelah bukti test, screenshot bila relevan, dan ID build dicatat dalam release record. Data uji harus sintetis.

## Prioritas rilis

| Prioritas | Modul | Hasil minimum |
|---|---|---|
| P0 — fondasi produksi | autentikasi/RBAC, master kampus, audit, file privat, notifikasi dasar, health/monitoring, backup | sistem dapat dioperasikan aman tanpa data mock |
| P0 — alur kampus kritis | PMB, KRS/persetujuan, jadwal/presensi, nilai, tagihan/pembayaran, PDDIKTI | alur end-to-end dan kontrol konsistensi lulus |
| P1 — Growth | pembelajaran, kemahasiswaan, evaluasi dosen, yudisium/wisuda, dokumen, layanan tata usaha | seluruh role menyelesaikan pekerjaan rutin di scope-nya |
| P1 — pelaporan | dashboard pimpinan, ekspor, tracer study, rekonsiliasi | agregat dapat ditelusuri ke sumber dan tidak membocorkan PII |
| Fase berikutnya | integrasi perpustakaan, HR/payroll, GL, akreditasi/SPMI lengkap, penelitian, native mobile, public API | tidak termasuk rilis awal |

Tidak termasuk seluruh fitur AI/ML/generative model, pengenalan wajah, prediksi, generator soal/RPS, atau chatbot. Presensi QR menggunakan token acak berumur pendek dan pemeriksaan aturan biasa, tanpa biometrik.

## Gerbang lintas modul

- [ ] Semua route privat menolak anonymous (401), role salah (403), dan akses cross-scope (403).
- [ ] Firebase Security Rules dan API memiliki test positif/negatif untuk role utama.
- [ ] Tidak ada service credential, private key, token, atau password pada Git, image layer, bundle client, log, Sentry, analytics, atau CDN.
- [ ] Operasi create/update memvalidasi tipe, panjang, format, state transition, dan ownership di server.
- [ ] Mutasi kritis memakai transaction/batch, optimistic `version`, idempotency, atau kompensasi yang diuji.
- [ ] Semua tabel besar memakai cursor pagination, filter/sort terindeks, empty/loading/error state, dan ekspor terotorisasi.
- [ ] Tanggal tersimpan UTC dan ditampilkan `Asia/Jakarta`; nominal IDR adalah integer.
- [ ] Upload memeriksa ukuran, ekstensi, MIME aktual, checksum, malware workflow, hak akses, serta object path acak.
- [ ] Perubahan penting membuat audit event dengan actor, waktu, action, resource, outcome, dan request ID tanpa menyalin secret.
- [ ] Halaman privat tidak masuk analytics/Clarity dan semua respons privat mengirim `Cache-Control: no-store`.
- [ ] Keyboard navigation, label form, kontras, mobile layout, dan pesan error berbahasa jelas diuji.
- [ ] Test unit, integrasi emulator, dan E2E kritis lulus pada build yang sama dengan artefak rilis.
- [ ] Backup terbaru berhasil dan recovery drill masih dalam periode yang disyaratkan.

## A. Autentikasi dan pengguna

- [ ] Login Firebase, logout, lupa/reset password, session cookie aman, timeout 8 jam, dan revocation bekerja.
- [ ] Demo auth tidak dapat diaktifkan di `NODE_ENV=production` tanpa guard eksplisit; release policy tetap melarang override.
- [ ] Satu akun dapat memiliki beberapa role; permission union selalu dipersempit scope.
- [ ] Admin dapat mengaktifkan, menonaktifkan, memblokir, dan memberi role/scope dengan dual approval untuk role sensitif.
- [ ] Rate limit Nginx, Firebase abuse protection/App Check, lockout, dan alert brute force diuji tanpa mengunci NAT kampus secara massal.
- [ ] Guardian hanya dapat ditautkan melalui proses persetujuan, melihat field yang diizinkan, dan aksesnya dapat dicabut.
- [ ] Perubahan role/session dan login berisiko tercatat tanpa menyimpan password/token.

## B. Dashboard dan pelaporan pimpinan

- [ ] KPI mahasiswa aktif, realisasi kuliah, presensi, PMB, keuangan, PDDIKTI, tracer, dan akreditasi menampilkan periode sumber serta `updatedAt`.
- [ ] Filter periode/fakultas/prodi/angkatan diterapkan server-side dan sesuai scope.
- [ ] Total agregat direkonsiliasi terhadap query sumber pada dataset uji.
- [ ] PDF/spreadsheet disanitasi dari formula injection, memiliki zona waktu/parameter, dan hanya memuat kolom berizin.
- [ ] Leader read-only secara default; drill-down PII membutuhkan permission terpisah.

## C. PDDIKTI Neo Feeder

- [ ] Master mapping mahasiswa, dosen, mata kuliah, kelas, peserta, nilai, aktivitas, dan kelulusan tervalidasi sebelum antre.
- [ ] Preview memperlihatkan perbedaan internal–Feeder, error blocking, warning, dan scope sinkron.
- [ ] Job memakai lease, dependency order, retry exponential+jitter, idempotency/fingerprint, dead letter, dan manual retry berizin.
- [ ] Token/credential hanya server-side; request/response log disaring.
- [ ] Partial failure dapat dilanjutkan tanpa mengirim ulang record sukses atau menggandakan data.
- [ ] Riwayat menyimpan actor, waktu, entity, hasil, Feeder reference, request ID, dan error tersanitasi.
- [ ] Rekonsiliasi pascasinkron membuktikan count serta identifier cocok.

## D. Penerimaan mahasiswa baru

- [ ] Admin mengelola jalur, gelombang, prodi, jadwal, syarat, biaya, dan kapasitas dengan tanggal efektif.
- [ ] Applicant membuat akun, mengisi bertahap, menyimpan draf, upload berkas privat, mengirim, dan melihat status sendiri.
- [ ] Verifikator melihat antrean scoped, memberi alasan berkas kurang/valid, dan semua perubahan terlacak.
- [ ] Seleksi, penguji/ruang, hasil, pengumuman, serta Letter of Acceptance hanya terbit setelah approval.
- [ ] Tagihan pendaftaran dan callback pembayaran idempotent serta dapat direkonsiliasi.
- [ ] Konversi applicant diterima menjadi student/NIM hanya sekali dan memiliki laporan kegagalan/kompensasi.
- [ ] Laporan funnel/sumber informasi tidak mengekspos dokumen atau PII berlebih.

## E. Akademik

- [ ] Master mahasiswa, dosen, unit, prodi, periode, mata kuliah, kurikulum, prasyarat, ekuivalensi, kelas, ruang, dan jadwal memiliki validasi unik/effective date.
- [ ] KRS memeriksa status aktif, periode, prasyarat, batas SKS, bentrok, kapasitas, dan cekal dalam transaction.
- [ ] Submit/persetujuan/penolakan/perubahan KRS mengikuti state machine dan optimistic version.
- [ ] Dosen wali hanya mengakses mahasiswa assignment-nya; staf hanya program studi scope-nya.
- [ ] Presensi dan jurnal mengajar dibatasi kelas/pengajar; koreksi setelah cutoff memerlukan alasan dan audit.
- [ ] Gradebook memvalidasi bobot 100%, skala, rentang, status draft/published, dan mencegah mahasiswa membaca nilai draft.
- [ ] KHS/transkrip dihitung deterministik, dapat direkonsiliasi, dan versi terbit tidak berubah diam-diam.
- [ ] Cuti, transfer, double degree, tugas akhir, MBKM, konversi, kalender, serta deadline memiliki workflow/status/approval yang terdokumentasi.

## F. Keuangan mahasiswa

- [ ] Tarif, tagihan wajib/per-SKS/lainnya, beasiswa, diskon, denda, deposit, voucher, dan cicilan memiliki effective date serta approval.
- [ ] Invoice number dan external payment reference unik; seluruh nilai IDR integer.
- [ ] Pencatatan pembayaran dan callback memakai idempotency key dalam transaction bersama saldo/status invoice dan audit.
- [ ] Overpayment, partial payment, reversal, refund, timeout callback, callback duplikat, dan out-of-order event diuji.
- [ ] Bukti transfer disimpan privat; verifikator tidak dapat memverifikasi transaksinya sendiri jika segregation-of-duties berlaku.
- [ ] Cekal akademik dihitung dari aturan/version yang dapat ditelusuri, bukan flag manual tanpa alasan.
- [ ] Rekonsiliasi channel–gateway–ledger mahasiswa menghasilkan exception list dan approval penyelesaian.

## G. Pembelajaran

- [ ] Kelas LMS berasal dari kelas akademik dan roster tersinkron tanpa menggandakan anggota.
- [ ] Dosen mengelola materi, Quill content tersanitasi, tugas, forum, pengumuman, rubrik, feedback, dan duplikasi bahan ajar.
- [ ] Mahasiswa hanya membaca kelas terdaftar dan submission sendiri; deadline memakai zona waktu kampus.
- [ ] Upload/version/kuota diterapkan; download file privat menghasilkan URL singkat setelah authorization.
- [ ] QR presensi memiliki nonce, expiry, audience kelas/sesi, proteksi replay, dan fallback manual beralasan.
- [ ] Progres/gamifikasi memakai aturan dan statistik deskriptif saja; tidak ada prediksi/profiling otomatis.

## H. Evaluasi dosen

- [ ] Instrumen berversi, periode, eligibility, dan anonymous-response policy dikunci sebelum dibuka.
- [ ] Satu mahasiswa eligible mengisi sekali tanpa identitas tampil pada hasil.
- [ ] Tabel eligibility dipisahkan dari jawaban; grup kecil di bawah threshold tidak ditampilkan.
- [ ] Dosen hanya melihat agregat setelah periode tutup; staf/pimpinan sesuai scope.
- [ ] Ekspor menerapkan minimum group size dan tidak memuat identifier responden.

## I. Kemahasiswaan

- [ ] Aktivitas, prestasi, poin, pelanggaran, beasiswa, dan dokumen memiliki bukti, status, reviewer scoped, serta audit.
- [ ] Mahasiswa mengajukan surat aktif dan memantau status; nomor/template/tanda terbit dikontrol.
- [ ] Data pelanggaran memiliki akses paling sempit dan retensi yang disahkan.
- [ ] Perubahan poin/beasiswa tidak dapat dilakukan tanpa reason dan approval yang sesuai.

## J. Yudisium, wisuda, dan dokumen

- [ ] Eligibility mengevaluasi akademik, keuangan, perpustakaan bila terintegrasi, kemahasiswaan, PDDIKTI, dan dokumen dengan snapshot aturan.
- [ ] Override cekal membutuhkan dua pihak, alasan, expiry, dan audit.
- [ ] Nomor SK/ijazah/transkrip/SKPI unik, dialokasikan atomik, dan pembatalan tidak menghapus histori.
- [ ] Template berversi; dokumen terbit menyimpan hash, issuer, timestamp, dan relasi ke versi template.
- [ ] Verifikasi publik hanya mengungkap field minimum dan memiliki rate limit.

## K. SKPI dan tracer study

- [ ] Elemen SKPI berasal dari aktivitas tervalidasi dan dipreview sebelum terbit.
- [ ] Kuesioner tracer berversi, consent jelas, tautan respon acak/expire, dan reminder dapat dihentikan.
- [ ] Outcome hanya deskriptif; filter kelompok kecil tidak mengungkap identitas.
- [ ] Ekspor aman dari formula injection dan sesuai scope/retensi.

## L. Tata usaha

- [ ] Kategori, SLA, assignment, status, komentar internal, lampiran, dan notifikasi tiket bekerja sesuai scope.
- [ ] Pemohon hanya melihat tiket sendiri; petugas hanya queue unitnya.
- [ ] Eskalasi, reopen, pembatalan, overdue, serta audit perubahan status diuji.
- [ ] Template surat berversi dan penerbitan mengikuti kontrol pada modul dokumen.

## M. Notifikasi

- [ ] Template berversi, parameter di-allowlist, dan preview tidak mengandung injection.
- [ ] In-app/email memakai outbox, retry, dedupe, preference, quiet hours bila berlaku, dan status delivery.
- [ ] Email tidak memuat nilai/tagihan/dokumen lengkap; tautkan pengguna ke halaman authenticated.
- [ ] Bulk send memiliki approval, rate limit, unsubscribe untuk pesan non-transaksional, dan laporan kegagalan.

## N. Manajemen file

- [ ] Path object tidak berasal langsung dari nama file; metadata menyimpan owner, module, MIME, size, checksum, status scan, dan version.
- [ ] Download/preview memerlukan authorization baru dan signed URL singkat; response no-store.
- [ ] File berbahaya/quarantine tidak dapat diunduh pengguna biasa.
- [ ] Hapus memakai soft-delete/retention sesuai modul dan lifecycle bucket; akses/perubahan diaudit.

## O. Audit, backup, dan pemulihan

- [ ] Audit append-only mencakup login berisiko, denial penting, mutasi, approval, pembayaran, sinkron, role, dan dokumen.
- [ ] Backup Firestore dan Storage berjalan terjadwal ke project/bucket terpisah dengan retention lock sesuai kebijakan.
- [ ] Monitoring memberi alert pada backup gagal atau backup lebih tua dari ambang.
- [ ] Restore ke project terisolasi berhasil, object count cocok, readiness/smoke/domain sampling lulus, dan report ditandatangani.
- [ ] RPO/RTO aktual pada drill tidak melampaui target yang disahkan.

## Bukti sign-off

Release record minimal mencatat commit SHA, image digest, environment, hasil typecheck/unit/integration/E2E, hasil rules test, security scan, migration ID, backup URI, recovery drill terakhir, approver teknis, pemilik bisnis, dan daftar exception dengan tanggal kedaluwarsa. Tidak ada checkbox yang dapat digantikan hanya oleh demo visual.
