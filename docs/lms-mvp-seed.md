# Seed sintetis LMS MVP

Utilitas `scripts/seed-lms-mvp.mjs` membuat akun dan data akademik sintetis yang deterministik untuk alur LMS MVP. Target default adalah Firebase Emulator Suite; utilitas tidak mendukung project production atau project ID yang tidak dikenal.

## Data yang dibuat

- Satu administrator, satu dosen, dan 1–100 mahasiswa di Firebase Auth tanpa kata sandi bawaan.
- `accounts`, profil minimum `users`, custom claims role/scope, dan indeks email.
- Satu program studi, periode akademik, versi mata kuliah, kelas, konfigurasi nilai, serta ruang pembelajaran.
- Enrolment aktif kanonik pada `classEnrollments`, satu record per mahasiswa.
- Marker kepemilikan seed dan audit log sintetis.

Semua alamat email memakai domain reservasi `example.test`. ID, timestamp, dan isi data deterministik. Rerun dengan argumen yang sama aman; utilitas menolak perubahan jumlah mahasiswa, fingerprint, dokumen target, atau UID Auth yang tidak memiliki marker seed yang sama.

## Emulator lokal (direkomendasikan)

Terminal pertama:

```powershell
npx firebase emulators:start --config firebase/firebase.json --project demo-lms-mvp --only auth,firestore
```

Terminal kedua:

```powershell
npm run seed:lms-mvp -- --dry-run --students=100
npm run seed:lms-mvp -- --students=100
```

Host emulator default adalah `127.0.0.1:8080` untuk Firestore dan `127.0.0.1:9099` untuk Auth. Override hanya menerima alamat loopback:

```powershell
npm run seed:lms-mvp -- --firestore-host=localhost:8080 --auth-host=localhost:9099 --students=25
```

## Staging eksplisit

Staging hanya menerima project allowlist `sttsp-lms-staging`, memerlukan Application Default Credentials dari lingkungan operator, dan harus dikonfirmasi dua kali melalui argumen:

```powershell
npm run seed:lms-mvp -- --target=staging --project=sttsp-lms-staging --confirm-staging=sttsp-lms-staging --students=100
```

Jalankan staging hanya setelah persetujuan eksplisit. Pastikan `FIRESTORE_EMULATOR_HOST` dan `FIREBASE_AUTH_EMULATOR_HOST` tidak terpasang. Utilitas tidak menerima path service account, secret, atau credential melalui argumen.

## Akun dan cleanup

Akun seed sengaja tidak memiliki kata sandi. Untuk pengujian login, gunakan alur reset/penetapan kredensial yang dikontrol di emulator atau staging; jangan menambahkan kata sandi default ke source, dokumentasi, atau log.

Cleanup tidak disediakan karena bersifat destruktif. Gunakan project emulator/staging yang terisolasi dan lakukan penghapusan hanya melalui prosedur yang meninjau marker `seedId=lms-mvp-synthetic-v1`.

Perintah npm `seed:lms-mvp` tersedia di `package.json`; target defaultnya tetap emulator dan semua guard di atas selalu berlaku.
