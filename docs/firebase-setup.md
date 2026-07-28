# Penyiapan Firebase

## 1. Pisahkan environment

Buat project Firebase/GCP terpisah untuk `development`, `staging`, `production`, dan `recovery`. Jangan memakai project produksi untuk emulator, test otomatis, atau recovery drill. Tetapkan billing budget, alert, owner, dan grup IAM; hindari grant langsung ke akun personal.

Pilih lokasi Firestore dan Storage bersama pemilik data sebelum membuat database. Lokasi sulit/tidak dapat diubah setelah dibuat; pertimbangkan residensi data, latensi pengguna Indonesia, dukungan layanan, Neo Feeder, serta strategi disaster recovery. Catat keputusan dalam change record.

## 2. Aktifkan layanan

Di setiap project:

1. Daftarkan web app Firebase dan catat browser config untuk variable `NUXT_PUBLIC_FIREBASE_*`.
2. Aktifkan Authentication provider yang disetujui. Email/password cukup untuk baseline; staf berprivilege tinggi sebaiknya memakai MFA/Identity Platform sesuai kebijakan.
3. Buat Cloud Firestore dalam Native mode.
4. Buat Cloud Storage bucket dan CORS hanya untuk origin resmi. File privat tetap memerlukan Rules/API authorization.
5. Aktifkan App Check untuk web setelah staging enforcement teruji.
6. Aktifkan audit logs GCP yang relevan, budget alerts, quota alerts, dan backup terjadwal.

Firebase browser API key bukan private credential, tetapi harus dibatasi ke API/origin yang perlu. Security Rules, App Check, Authentication, dan server authorization tetap menjadi kontrol utama.

## 3. Kredensial server

Produksi memakai service account khusus runtime dengan least privilege. Pisahkan service account runtime, deployment Rules/indexes, backup export, dan recovery import. Jangan memberikan `Owner` atau `Editor`.

Compose memasang key runtime sebagai file read-only dan mengatur:

```dotenv
FIREBASE_PROJECT_ID=campus-production
GCLOUD_PROJECT=campus-production
FIREBASE_USE_APPLICATION_DEFAULT=true
FIREBASE_ADMIN_CREDENTIALS_FILE=C:\secure\campus-runtime.json
```

Di container, file tersedia sebagai `/run/secrets/firebase-admin.json` melalui `GOOGLE_APPLICATION_CREDENTIALS`. Pada platform GCP, utamakan attached service account/Workload Identity tanpa key file. Alternatif `FIREBASE_SERVICE_ACCOUNT_JSON` dan `FIREBASE_SERVICE_ACCOUNT_BASE64` didukung kode untuk lingkungan terbatas, tetapi lebih mudah bocor melalui environment inspection dan tidak direkomendasikan untuk Compose.

Input kompatibilitas `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY` juga didukung, tetapi private key multiline dalam environment rawan salah escape/terekspose. Utamakan ADC file/Workload Identity. Rotasi key: buat key baru, pasang melalui secret manager/deployment, restart instance satu per satu, pastikan `/api/ready` 200 dan audit akses normal, lalu revoke key lama. Jangan menempel JSON key ke chat, issue, CI log, atau Sentry.

## 4. Konfigurasi browser

Isi public runtime config untuk environment terkait:

```dotenv
NUXT_PUBLIC_FIREBASE_API_KEY=
NUXT_PUBLIC_FIREBASE_AUTH_DOMAIN=campus-production.firebaseapp.com
NUXT_PUBLIC_FIREBASE_PROJECT_ID=campus-production
NUXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NUXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NUXT_PUBLIC_FIREBASE_APP_ID=
```

Daftarkan hanya origin resmi di Authentication authorized domains. Jangan mendaftarkan wildcard. Pisahkan Firebase app untuk staging agar analytics/auth state tidak bercampur.

## 5. Claims, profil, dan session

Custom claims ringkas:

```json
{
  "roles": ["academic_staff"],
  "scope": {
    "unitIds": ["unit-fst"],
    "programStudyIds": ["prodi-if"],
    "cohortYears": [],
    "studentIds": []
  }
}
```

Jangan memasukkan nama, NIM, nomor identitas, atau daftar scope yang sangat besar ke token. Gunakan stable IDs. Server memverifikasi Firebase ID token saat login, lalu menerbitkan cookie sesi aplikasi bertanda tangan HMAC yang hanya memuat UID, versi akun, waktu terbit, dan waktu kedaluwarsa. Setiap request memuat ulang `accounts/{uid}` dan menolak akun nonaktif atau versi yang berubah; role dan scope selalu berasal dari dokumen kanonik, bukan cookie. `sessionValidAfter` menolak ID token yang dibuat sebelum pencabutan seluruh sesi. Session produksi berumur maksimal delapan jam dan cookie harus `HttpOnly`, `Secure`, `SameSite=Strict`, path `/`.

## 6. Security Rules

Rules harus default-deny dan memverifikasi tipe, field yang boleh berubah, ownership, role, scope, serta state. Admin SDK melewati Rules, sehingga setiap endpoint server wajib melakukan pemeriksaan RBAC sendiri. Jangan menulis rule `allow read, write: if request.auth != null` untuk koleksi kampus.

Pola minimum:

- profil pengguna: pemilik membaca subset aman; hanya proses admin memperbarui role/status;
- KRS: mahasiswa membuat/mengubah draf sendiri pada periode terbuka; approval dilakukan server;
- nilai/tagihan/pembayaran/audit: client tidak pernah menulis langsung;
- evaluasi anonim: eligibility dan respons dipisah; client tidak dapat melakukan query semua respons;
- file: object path berisi ID acak, ukuran/content type dibatasi, metadata ownership cocok;
- audit: tidak ada update/delete dari client.

Uji Rules melalui Emulator Suite untuk anonymous, setiap role, owner/non-owner, same/cross program, malformed fields, over-size upload, dan revoked/disabled account. Test API terpisah tetap diperlukan karena Admin SDK bypass Rules.

Deployment konfigurasi Firebase hanya dari pipeline terotorisasi:

```powershell
firebase use campus-staging
firebase emulators:exec "npm test"
firebase deploy --only firestore:rules,firestore:indexes,storage
```

Gunakan `--project`/alias eksplisit; periksa target sebelum deploy produksi. Simpan output pipeline sebagai bukti release.

## 7. Indeks dan TTL

Semua query aplikasi harus direpresentasikan di `firebase/firestore.indexes.json`. Jalankan test integrasi terhadap emulator, kemudian staging dengan dataset representatif. Review biaya/read count dan hindari listener real-time pada dashboard besar.

TTL hanya untuk data sementara yang disahkan, seperti idempotency key kedaluwarsa, token unduhan, atau notification delivery detail. TTL bersifat asynchronous dan bukan kontrol akses; aplikasi tetap menolak record expired saat dibaca.

## 8. Storage privat

Gunakan prefix berbasis environment/module/owner/random ID, bukan nama asli file. Metadata Firestore menyimpan original display name tersanitasi, MIME hasil inspeksi, size, checksum, owner, classification, scan status, version, dan retention class.

Alur upload aman:

1. API memverifikasi permission, scope, quota, ekstensi, dan expected size.
2. Buat upload session/object ID acak; status `PENDING_SCAN`.
3. Validasi MIME aktual/checksum dan jalankan pemeriksaan malware di lingkungan yang disetujui.
4. Hanya objek `CLEAN` dapat diakses; objek mencurigakan dipindah ke quarantine.
5. Download memerlukan authorization baru dan signed URL berumur singkat; respons tidak boleh di-cache.

Jangan membuat bucket publik. Lifecycle deletion mengikuti kebijakan setiap modul dan legal hold.

## 9. Emulator lokal

Contoh `.env` lokal:

```dotenv
NODE_ENV=development
FIREBASE_PROJECT_ID=campus-local
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
CAMPUS_DATA_MODE=mock
ENABLE_DEMO_AUTH=true
```

Jangan pernah mengatur `FIRESTORE_EMULATOR_HOST` atau `CAMPUS_DATA_MODE=mock` di produksi. `scripts/validate-env.ps1` menolak keduanya untuk konfigurasi produksi.

## 10. Checklist go-live

- [ ] Project/environment, billing, quota, IAM, dan owner diverifikasi.
- [ ] Runtime/deploy/backup/recovery service account terpisah dan least privilege.
- [ ] Authorized domains, password policy, MFA privileged staff, App Check, dan revocation diuji.
- [ ] Rules dan indexes dideploy dari commit release serta test negatif lulus.
- [ ] Storage CORS, Rules, validation, quarantine, signed URL, quota, dan lifecycle diuji.
- [ ] Tidak ada emulator/mock/credential JSON di image, repo, log, atau bundle.
- [ ] `/api/ready` 200 menggunakan Firebase produksi dan menjadi 503 bila akses dicabut.
- [ ] Backup terjadwal dan restore terisolasi telah berhasil sebelum menerima data nyata.
