# Backup, restore, dan recovery test

Backup belum dianggap berhasil sampai dapat dipulihkan dan diverifikasi. Runbook ini melindungi Cloud Firestore dan Firebase Storage; konfigurasi aplikasi, Rules/indexes, image digest, template dokumen, serta secret inventory (bukan nilai secret) juga harus dapat direkonstruksi dari source control dan secret manager.

## Target awal

Usulan baseline yang harus disahkan pemilik bisnis:

- RPO maksimum 6 jam untuk Firestore dan metadata; transaksi payment selama gap direkonsiliasi dari gateway/bank.
- RPO maksimum 24 jam untuk Storage, dengan object versioning/lifecycle sebagai lapisan tambahan bila disetujui.
- RTO maksimum 4 jam untuk layanan kritis setelah incident commander menyetujui recovery.
- Firestore export setiap 6 jam, Storage snapshot harian, recovery test terisolasi bulanan dan sebelum peak semester.
- Retensi: 14 snapshot harian, 8 mingguan, 12 bulanan sebagai baseline; sesuaikan hukum/arsip/biaya/legal hold.

Jika target ini tidak memadai untuk pembayaran atau perubahan nilai, tingkatkan frekuensi dan gunakan kemampuan backup/recovery terkelola yang tersedia pada project setelah evaluasi. Jangan mengklaim RPO/RTO sampai drill mengukurnya.

## Desain keamanan backup

- Backup bucket berada di project/account administratif terpisah dari runtime produksi.
- Runtime app tidak memiliki write/delete ke backup. Backup principal hanya dapat export/copy; retention deletion memakai principal/proses lain dengan dual approval.
- Enkripsi, retention policy/object lock, versioning, access log, budget/quota alert, dan deny public access diaktifkan sesuai kebijakan.
- Region/residensi serta KMS key availability konsisten dengan disaster plan. Key/secret tidak disimpan di bucket yang hanya dapat dipulihkan menggunakan key tersebut.
- Backup tidak masuk Git, workstation biasa, analytics, Sentry, atau tiket. Akses restore dicatat dan ditinjau.

Managed Firestore export dapat menyertakan perubahan yang terjadi selama operasi; jangan menganggapnya snapshot tepat pada waktu mulai. Storage copy juga tidak atomik dengan Firestore. Untuk cut yang konsisten, aktifkan maintenance/write freeze singkat atau rekam watermark waktu dan job upload yang masih `PENDING`. Setelah export, rekonsiliasi metadata `files` dengan object checksum/count.

## Prasyarat tooling

Operator memakai `gcloud` terautentikasi sebagai backup-only service account. Login interaktif personal hanya untuk break-glass. Pastikan Firestore service agent dapat menulis ke backup bucket dan akun operator dapat memulai export. Uji IAM di staging.

```powershell
gcloud auth list
gcloud config get-value project
gcloud storage ls gs://campus-backups-prod
```

Perintah tersebut tidak boleh menampilkan token/key. Verifikasi project secara eksplisit setiap kali.

## Membuat backup

```powershell
& ./scripts/backup-firebase.ps1 `
  -ProjectId campus-production `
  -BackupBucket gs://campus-backups-prod `
  -StorageBucket campus-production.appspot.com `
  -Label scheduled
```

Script:

1. membuat prefix unik UTC;
2. menjalankan managed Firestore export;
3. menyalin Storage ke prefix snapshot baru tanpa delete destination;
4. menulis `manifest.json` berisi source project, database, URI, start/end, label, dan operator;
5. gagal non-zero jika salah satu langkah gagal.

Jangan memakai `rsync --delete` pada bucket backup. Lifecycle retention dijalankan bucket policy yang disetujui, bukan script backup.

Setelah job:

- periksa exit code, manifest, export metadata, jumlah/size object, durasi, dan alert;
- bandingkan metadata file yang committed sebelum watermark dengan object yang tersalin;
- simpan backup URI dan status pada register operasional/audit, bukan nilai credential;
- alert bila tidak ada manifest sukses lebih lama dari target RPO.

## Recovery test terisolasi

Recovery project harus disposable, tidak terhubung payment/Neo Feeder/email produksi, tidak memiliki analytics, dan namanya berakhiran `-recovery`, `-restore`, `-dr`, atau `-sandbox`. Database tujuan harus sudah dibuat dengan lokasi/edition yang kompatibel. Runtime recovery memakai credential dan domain terpisah.

1. Pilih manifest backup dalam retention dan catat incident/drill ticket.
2. Dapatkan persetujuan recovery operator dan pemilik data.
3. Pastikan target bukan source project dan seluruh integrasi eksternal memakai stub/off.
4. Jalankan import:

```powershell
& ./scripts/test-restore.ps1 `
  -BackupUri gs://campus-backups-prod/campus-production/20260721T000000Z-scheduled `
  -RecoveryProjectId campus-quarterly-recovery `
  -RecoveryStorageBucket campus-quarterly-recovery.appspot.com `
  -ConfirmRecoveryTarget
```

5. Deploy image/Rules/indexes dari release yang tercatat, arahkan ke recovery project, lalu jalankan readiness smoke:

```powershell
& ./scripts/test-restore.ps1 `
  -BackupUri gs://campus-backups-prod/campus-production/20260721T000000Z-scheduled `
  -RecoveryProjectId campus-quarterly-recovery `
  -RecoveryStorageBucket campus-quarterly-recovery.appspot.com `
  -SmokeTestUrl https://recovery.example.ac.id/api/ready `
  -ConfirmRecoveryTarget
```

Jangan menjalankan dua contoh terhadap database target yang sama tanpa memahami bahwa Firestore import menggabungkan/menimpa document IDs dan tidak membersihkan dokumen ekstra. Biasanya jalankan perintah kedua saja setelah recovery app siap, atau gunakan project baru untuk setiap drill.

Script menolak target yang sama dengan source manifest, memerlukan nama recovery eksplisit, mengimpor Firestore, menyalin Storage ke prefix recovery unik, membandingkan object count, dan menulis `recovery-report-*.json`. Laporan berisi metadata saja dan diabaikan Git.

## Verifikasi domain

Import sukses dan count object sama belum cukup. Dengan akun uji serta data sintetis/anonymized yang telah disiapkan sebelumnya:

- hitung dokumen per koleksi/periode dan bandingkan manifest/register;
- sampling checksum/size file serta referensi metadata–object;
- login, role/scope, revoked account, dan negative cross-scope test;
- baca applicant, student, kelas, KRS, grade published, invoice/payment balance, audit chain, issued document hash, dan PDDIKTI job history;
- pastikan transaction totals, unique reference, mapping, dan state invariants konsisten;
- jalankan export laporan tanpa formula injection dan satu signed private download;
- pastikan payment/Neo Feeder/email benar-benar off di recovery;
- ukur waktu dari deklarasi recovery sampai layanan siap dan bandingkan RTO.

Catat jumlah expected/actual, sample IDs non-sensitif, checksum agregat, exception, RPO aktual, RTO aktual, image/commit, backup URI, tester, reviewer, dan keputusan pass/fail. Exception kritis membuat drill gagal dan backup chain diselidiki.

## Pemulihan bencana produksi

Full restore produksi hanya untuk kehilangan/korupsi data yang tidak dapat diperbaiki; bukan rollback kode.

1. Incident commander menyatakan disaster, menetapkan waktu cutoff, dan menghentikan writer/integrasi.
2. Preservasi evidence dan ambil export kondisi rusak bila aman.
3. Identifikasi backup sehat terakhir serta transaksi eksternal setelah watermark.
4. Restore dahulu ke project terisolasi, lakukan verifikasi domain, dan hitung data gap.
5. Pilih strategi: perbaiki project lama, promote recovery project, atau import selektif—dengan privasi/legal/business approval.
6. Deploy Rules/index/image/secret baru, rotasi credential yang mungkin terpapar, dan enable trafik bertahap.
7. Replay outbox/idempotent event dan rekonsiliasi payment, Neo Feeder, email, serta file.
8. Monitor ketat, komunikasikan RPO/data gap, kemudian post-incident review.

Jangan menghapus project rusak sebelum evidence, rekonsiliasi, legal hold, dan periode rollback selesai.

## Kegagalan umum

- **Export permission denied:** periksa IAM operator, Firestore service agent, dan bucket project; jangan memberi Owner sebagai jalan pintas.
- **Location mismatch/import rejected:** buat recovery database/bucket pada lokasi kompatibel sesuai manifest/desain.
- **Storage count berbeda:** tunggu upload in-flight/watermark, cek version/delete marker, permission, dan error rsync; drill gagal sampai dijelaskan.
- **Restore app tidak ready:** cocokkan `FIREBASE_PROJECT_ID`, ADC, Rules/indexes, image release, serta emulator/mock flags.
- **Backup terlalu lama:** hentikan operasi bulk non-kritis, periksa quota/network, split jadwal Storage, dan revisi capacity/RPO.

## Checklist audit recovery

- [ ] Backup project/bucket terpisah, non-public, immutable sesuai retention, dan akses least privilege.
- [ ] Jadwal/alert memenuhi RPO; manifest dan rekonsiliasi file tersedia.
- [ ] Restore dilakukan pada target terisolasi dengan integrasi eksternal off.
- [ ] Firestore import, Storage count/checksum, readiness, security negative test, dan domain sampling lulus.
- [ ] RPO/RTO aktual dicatat dan disahkan dua pihak.
- [ ] Recovery report tersimpan di register audit terlindungi; data sementara recovery dihapus sesuai change approval setelah review.
