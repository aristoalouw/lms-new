# Matriks role dan akses

## Prinsip keputusan akses

Role adalah pemberi permission awal, bukan akses global. Setiap request sensitif harus memenuhi permission dan scope (`unitIds`, `programStudyIds`, `cohortYears`, `studentIds`) atau ownership. UI boleh memakai matriks untuk navigasi, tetapi API dan Firebase Security Rules adalah enforcement point.

Nama role kanonis yang dipakai backend:

| Role | Tanggung jawab | Scope normal |
|---|---|---|
| `applicant` | mengisi PMB dan melihat status sendiri | applicant sendiri |
| `student` | KRS, kelas, tugas, nilai, tagihan, layanan sendiri | student ID sendiri |
| `lecturer` | kelas, jurnal, presensi, materi, tugas, dan nilai yang diampu | class/lecturer assignment |
| `advisor` | meninjau dan menyetujui KRS mahasiswa wali | advisor assignment + prodi |
| `academic_staff` | master akademik dan proses akademik | unit/prodi yang ditugaskan |
| `finance_staff` | tarif, tagihan, pembayaran, rekonsiliasi | unit/prodi yang ditugaskan |
| `student_affairs_staff` | aktivitas, prestasi, pelanggaran, beasiswa, surat | unit/prodi yang ditugaskan |
| `admissions_staff` | gelombang, verifikasi, seleksi, dan konversi PMB | gelombang/prodi yang ditugaskan |
| `leader` | dashboard dan laporan agregat lintas unit | scope institusi; read-only default |
| `administrator` | identitas, role, konfigurasi, audit teknis | institusi; tidak otomatis pemilik proses bisnis |
| `guardian` | ringkasan terbatas mahasiswa dengan persetujuan | student ID yang ditautkan + consent |

## Matriks kemampuan

Notasi: **R** membaca, **W** membuat/mengubah, **A** menyetujui/menerbitkan, **O** data sendiri, **S** dibatasi scope. Tanda “—” berarti ditolak secara default. `administrator` tidak boleh mengubah nilai atau transaksi bisnis hanya karena memiliki role admin; gunakan break-glass yang disetujui dan diaudit bila benar-benar diperlukan.

| Area/aksi | Applicant | Student | Lecturer | Advisor | Academic | Finance | Student affairs | Admissions | Leader | Administrator | Guardian |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| PMB/formulir | W/O | R/O | — | — | R/S | — | — | W/S | R agregat | konfigurasi | — |
| Profil mahasiswa | — | R/O | R/S minimum | R/S | W/S | R/S minimum | W/S | konversi/S | R agregat | akun saja | R/O terbatas |
| Master akademik | — | R | R/S | R/S | W/S | R minimum | R/S | R | R | konfigurasi | — |
| KRS | — | W/O | R/S | A/S | A/S | status cekal | — | — | R agregat | — | R/O terbatas |
| Jadwal/presensi/jurnal | — | R/O | W/S | R/S | W/S | — | R/S | — | R agregat | — | R/O ringkas |
| Materi/tugas/feedback | — | W/O submission | W/S | R/S | R/S | — | — | — | R agregat | — | — |
| Nilai/KHS/transkrip | — | R/O terbit | W/S draf | R/S | A/S | status cekal | — | — | R agregat | — | R/O ringkas jika disetujui |
| Tagihan/pembayaran | biaya PMB/O | R/O | — | — | status cekal | W/A/S | beasiswa/S | biaya PMB/S | R agregat | — | R/O ringkas |
| Kemahasiswaan | — | W/O pengajuan | R/S minimum | R/S | R/S | beasiswa minimum | W/A/S | — | R agregat | — | R/O ringkas |
| Evaluasi dosen | — | W/O anonim | R hasil agregat | R agregat | W instrumen/S | — | — | — | R agregat | konfigurasi | — |
| Yudisium/wisuda/dokumen | — | W/O daftar | R/S | R/S | W/A/S | A cekal finansial | A cekal/S | — | R agregat | konfigurasi | R status/O |
| Tracer study | — | W/O jika alumni | — | — | R/S | — | W/S | — | R agregat | konfigurasi | — |
| Tiket/layanan | W/O PMB | W/O | W/O | W/O | W/S | W/S | W/S | W/S | R agregat | konfigurasi | W/O terbatas |
| PDDIKTI | — | — | R/S validasi | — | W/A/S | — | — | — | R | operasi platform, bukan approval | — |
| Audit log | aktivitas sendiri terbatas | aktivitas sendiri terbatas | R/S bila perlu | R/S bila perlu | R/S | R/S | R/S | R/S | R institusi | R + administrasi retensi | — |
| Pengguna/role/scope | — | — | — | — | rekomendasi | rekomendasi | rekomendasi | rekomendasi | R | W/A | — |

## Permission backend awal

Kontrak kode awal menyediakan permission berikut: `dashboard:view`, varian dashboard domain, `krs:approve`, `payments:record`, `pddikti:queue`, `pddikti:retry`, `pddikti:view`, dan `audit:view`. Modul tambahan harus memperluas permission granular; jangan memakai satu flag `isAdmin` untuk seluruh aksi.

Contoh permission yang perlu ditambahkan saat modul diaktifkan: `grades:draft`, `grades:publish`, `documents:issue`, `users:assign_role`, `files:read_private`, `files:scan_override`, dan `graduation:approve`. Setiap permission baru wajib memiliki test positif, negatif, cross-scope, inactive-account, dan revoked-session.

## Prosedur assignment dan review

1. Pemilik unit mengajukan role dan scope dengan alasan serta tanggal berakhir.
2. Administrator memverifikasi identitas; role keuangan, penerbit dokumen, PDDIKTI, dan admin memerlukan persetujuan kedua.
3. Backend memperbarui custom claims dan dokumen `users`, mencabut refresh/session token lama, lalu membuat audit event.
4. Pengguna login ulang. Akses diuji dengan akun non-produksi yang merepresentasikan scope.
5. Review akses dilakukan minimal per semester dan saat mutasi/keluar. Role sementara memiliki expiry otomatis.

Break-glass memakai akun terpisah, MFA, persetujuan insiden, durasi pendek, dan review audit setelah pemakaian. Akun service tidak boleh dipakai interaktif.

## Checklist uji akses per role

- Aksi yang diizinkan berhasil hanya di scope sendiri.
- Aksi yang sama pada program studi/unit/student ID lain menghasilkan 403, bukan data kosong yang ambigu.
- Endpoint list tidak membocorkan jumlah atau metadata di luar scope.
- Pengguna tanpa sesi mendapat 401; akun disabled/revoked juga ditolak.
- Guardian hanya melihat field yang disetujui dan hubungan wali masih aktif.
- Leader menerima agregat; drill-down ke data pribadi perlu permission tambahan.
- Administrator tidak dapat membuat pembayaran/nilai tanpa role bisnis eksplisit atau prosedur break-glass.
- Perubahan role/scope, approval, pembayaran, penerbitan nilai/dokumen, dan penolakan akses berisiko dicatat di audit log.
