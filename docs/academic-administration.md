# Administrasi akademik

Modul administrasi akademik melengkapi alur KRS dan pelaksanaan kelas dengan data master berversi, status studi mahasiswa, hasil belajar terbit, cuti, perwalian, RPS manual, tugas akhir, dan MBKM. Seluruh endpoint berada di bawah `/api/academic/**`, membutuhkan sesi, mengirim respons privat `no-store`, serta melakukan pemeriksaan role dan lingkup pada server.

## Model dan invariants

- Versi mata kuliah, kurikulum, RPS, nilai terbit, catatan bimbingan, dan entri logbook yang telah dibuat bersifat imutabel.
- Profil mahasiswa menyimpan status terkini sekaligus histori status append-only. Persetujuan cuti memperbarui permohonan dan profil dalam satu transaksi Firestore.
- KHS dan transkrip provisional hanya dihitung dari `academicGradeRecords` yang menunjuk publikasi nilai. Draf gradebook tidak menjadi sumber hasil belajar.
- Catatan privat dosen wali dihapus dari respons mahasiswa dan wali pada service layer; koleksi akademik tetap ditolak untuk akses langsung oleh klien melalui Firestore Rules.
- Mutasi yang dapat dikirim ulang memakai `Idempotency-Key`. Perubahan state memakai `expectedVersion` untuk mencegah lost update.
- RPS manual terbit wajib mempunyai total bobot tepat 100 persen. Tidak ada generator AI atau dependensi AI.
- Tugas akhir dan MBKM memakai state machine eksplisit. Aktivitas MBKM tidak dapat diselesaikan sebelum evaluasi tersimpan, dan konversi dibatasi maksimal 24 SKS dengan kode mata kuliah unik.
- Berkas pendukung harus merupakan file privat yang dapat dibaca oleh pemohon sebelum referensinya disimpan.

## Akses

| Peran | Akses utama |
|---|---|
| Mahasiswa | Profil sendiri, KHS/transkrip, pengajuan cuti/perwalian/tugas akhir/MBKM, logbook MBKM sendiri |
| Orang tua/wali | Profil dan hasil mahasiswa dalam `scope.studentIds`; tanpa catatan privat pembimbing |
| Dosen wali | Mahasiswa bimbingan, penjadwalan perwalian, tugas akhir dan MBKM yang dibimbing |
| Dosen | RPS yang diampu serta tugas akhir/MBKM yang ditugaskan |
| Staf akademik | Data pada program studi dalam scope, peninjauan cuti dan workflow akademik |
| Pimpinan | Read-only lintas lingkup yang diberikan |
| Administrator | Pengelolaan lintas program studi dan operasi korektif teraudit |

Daftar lengkap permission dan scope ada di [matriks role](./role-matrix.md). Menyembunyikan tombol pada halaman bukan kontrol keamanan; endpoint selalu mengulangi pemeriksaan tersebut.

## Endpoint

- `GET /api/academic/administration?studentId=`: workspace yang sudah difilter berdasarkan role, prodi, pembimbing, dan mahasiswa.
- `GET /api/academic/results/:studentId?periodId=` dan `GET /api/academic/transcripts/:studentId`: hasil belajar dari nilai terbit.
- `POST /api/academic/leave` dan `POST /api/academic/leave/:id/review`: pengajuan serta keputusan cuti.
- `POST /api/academic/advising` dan `PUT /api/academic/advising/:id`: permintaan, penjadwalan, penyelesaian, atau pembatalan perwalian.
- `POST /api/academic/rps`: versi RPS manual baru.
- `POST /api/academic/theses`, `POST /api/academic/theses/:id/transition`, dan `POST /api/academic/theses/:id/guidance`: proposal, state transition, dan bimbingan tugas akhir.
- `POST /api/academic/mbkm`, `POST /api/academic/mbkm/:id/transition`, `POST /api/academic/mbkm/:id/log`, dan `POST /api/academic/mbkm/:id/evaluation`: seluruh siklus MBKM.
- `POST /api/academic/master/programs` dan `/periods`: master mutable dengan optimistic version.
- `POST /api/academic/master/courses` dan `/curricula`: pembuatan snapshot versi imutabel melalui head atomik.
- `POST /api/academic/master/calendar`: agenda/deadline berversi dan scoped.

Halaman `/akademik/administrasi` menggunakan endpoint tersebut dan menyesuaikan aksi dengan peran aktif. Staf mengelola program, status akreditasi, periode, mata kuliah, prasyarat, ekuivalensi, kurikulum, serta kalender melalui `/akademik/master`. `/akademik/krs` dan `/akademik/kelas` tetap menjadi ruang kerja terpisah untuk enrollment dan delivery kelas.

## Firestore dan operasi

Koleksi `academicProgramStudies`, `academicPeriodDefinitions`, `academicCourseHeads`, `academicCourseVersions`, `academicCurriculumHeads`, `academicCurriculumVersions`, `academicStudentProfiles`, `academicCalendarEvents`, `academicLeaveRequests`, `academicAdvisingSessions`, `academicRpsHeads`, `academicRpsVersions`, `academicTheses`, `academicMbkmActivities`, dan `academicGradeRecords` hanya dapat diakses Firebase Admin. Composite index untuk antrean tinjauan, pembimbing, mahasiswa/periode, status, dan nilai didefinisikan pada `firebase/firestore.indexes.json`.

Sebelum deploy perubahan schema, jalankan:

```powershell
npm run typecheck
npm test -- tests/server/academic-administration.test.ts tests/server/firestore-rules.test.ts
npm run build
```

Deploy Rules dan index terlebih dahulu ke staging, lalu lakukan uji role-by-role dengan akun Firebase nyata. Audit log harus dipantau untuk pengajuan, keputusan, perubahan state, penerbitan RPS, bimbingan, evaluasi, dan konversi.

## Batas dokumen hasil belajar

KHS dan transkrip pada modul ini bersifat tampilan/provisional. Penerbitan dokumen resmi, penomoran, hash, verifikasi, pencabutan, dan penerbitan ulang ditangani modul kelulusan/dokumen agar tidak ada dua sumber nomor resmi.
