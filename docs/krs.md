# KRS dan reservasi kelas

KRS memakai dua tahap eksplisit: mahasiswa menyimpan `DRAFT`, lalu mengajukan menjadi `SUBMITTED`. Draf tidak memesan kursi. Pengajuan membaca ulang periode, status akademik mahasiswa, cekal aktif, batas SKS, prasyarat, jadwal, kelas, kapasitas, dan versi KRS di dalam transaksi Firestore yang sama dengan reservasi kursi.

## Invarian transaksi

- Satu KRS deterministik untuk kombinasi mahasiswa dan periode; query kepemilikan memverifikasi `studentUid` dan `studentId` dari session server.
- Satu mata kuliah tidak dapat dipilih melalui dua kelas pada KRS yang sama.
- Semua kelas harus aktif, berada pada periode dan program studi mahasiswa, memiliki jadwal valid, serta tidak saling bertabrakan.
- Prasyarat menggunakan snapshot mata kuliah lulus pada `studentAcademicStates`; batas SKS dan cekal selalu dibaca ulang saat submit.
- `academicClasses.reservedSeatCount` dan subdokumen `seatReservations/{studentId}` ditulis atomik. Dua submit untuk kursi terakhir tidak dapat sama-sama berhasil.
- Persetujuan dosen wali mengubah reservasi menjadi `ENROLLED` dan menulis roster. Penolakan menghapus reservasi serta mengurangi counter tanpa berada di bawah jumlah roster aktif.
- Semua write memakai optimistic version, CSRF, `Idempotency-Key`, no-store, dan audit server-side.

## Endpoint utama

| Method | Path | Tujuan |
|---|---|---|
| `GET` | `/api/krs/catalog?periodId=...` | katalog dan fakta eligibility milik mahasiswa |
| `GET` | `/api/krs/me?periodId=...` | KRS milik session |
| `PUT` | `/api/krs/draft` | membuat/memperbarui draf terversi |
| `POST` | `/api/krs/{id}/submit` | validasi ulang dan reservasi kursi atomik |
| `POST` | `/api/krs/{id}/approval` | persetujuan/penolakan scoped dosen wali atau staf |

Respons konflik menggunakan kode stabil seperti `KRS_HELD`, `PREREQUISITE_NOT_MET`, `SCHEDULE_CONFLICT`, `CREDIT_LIMIT_EXCEEDED`, `CLASS_FULL`, dan `VERSION_CONFLICT`. UI harus memuat ulang katalog/KRS setelah konflik, bukan menimpa versi server.

## Koleksi

- `krs`: source of truth rencana studi dan snapshot pilihan saat submit.
- `studentAcademicStates`: status aktif, batas SKS, hasil prasyarat, dan cekal authoritative.
- `academicPeriods`: jendela pengisian dan revisi KRS.
- `academicClasses`: kapasitas serta jadwal kelas.
- `academicClasses/{classId}/seatReservations`: alokasi satu mahasiswa per kelas.
- `academicClasses/{classId}/roster`: peserta setelah persetujuan.
- `idempotencyKeys` dan `auditLogs`: replay protection dan jejak bisnis.

Seluruh koleksi mutasi hanya ditulis melalui Firebase Admin pada Nuxt server. Browser tidak memperoleh akses write langsung melalui Firebase Rules.
