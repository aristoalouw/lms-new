# Penerimaan mahasiswa baru

Modul PMB menyediakan formulir publik, penautan akun applicant, verifikasi berkas berbasis status, validasi biaya pendaftaran, penjadwalan seleksi, finalisasi nilai, Letter of Acceptance, dan konversi applicant diterima menjadi mahasiswa aktif.

## Privasi identitas

Nomor identitas 16 digit hanya diterima pada request submit. Server menormalisasi lalu menghitung HMAC-SHA256 dengan `PMB_PII_HASH_SECRET`; Firestore hanya menerima fingerprint dan empat digit terakhir. Nilai mentah tidak dikembalikan, tidak masuk audit, dan tidak disimpan pada idempotency response. Fingerprint membentuk indeks unik per gelombang agar pendaftaran ganda ditolak tanpa menjadikan hash tanpa kunci sebagai pengganti proteksi PII.

Dokumen pendaftar tidak dikirim melalui payload formulir. Setelah akun ditautkan, applicant membuka `/pmb/dokumen`; PDF/JPEG/PNG dikirim langsung ke target upload privat, divalidasi magic bytes/MIME/ukuran, dikarantina, dan dipindai. File harus `CLEAN`, dimiliki applicant, serta mempunyai access policy `SCOPED` hanya untuk `admissions_staff` pada program studi aplikasi sebelum dapat ditautkan.

Record dokumen menyimpan ID dan versi file, nama, MIME, ukuran, checksum SHA-256, jenis dokumen, status, actor, waktu, dan catatan peninjau. Konten tidak disalin ke Firestore. Jalur reguler mewajibkan identitas serta ijazah/SKL; KIP, pindahan, dan RPL menambah bukti jalur masing-masing. Penolakan tidak menghapus histori dan membuka unggah pengganti. Transisi aplikasi ke `DOCUMENTS_VERIFIED` ditolak sampai seluruh checklist jalur berstatus `VERIFIED`.

## State machine

```text
SUBMITTED -> UNDER_REVIEW -> DOCUMENTS_VERIFIED -> ACCEPTED
                              |                    |
                              +-> REJECTED         +-> ENROLLMENT_PENDING_IDENTITY -> ENROLLED
```

Transisi memakai optimistic `version`, program-study scope, CSRF, `Idempotency-Key`, dan audit. Validasi biaya hanya dapat dilakukan role keuangan/administrator, dengan reference unik. Konversi hanya menerima aplikasi `ACCEPTED`, biaya `PAID`/`WAIVED`, dan akun applicant yang telah ditautkan.

## Seleksi dan LoA

Panitia membuat sesi `WRITTEN_EXAM`, `INTERVIEW`, atau `PORTFOLIO_REVIEW` dengan waktu, lokasi, kapasitas, dan daftar UID penguji. Penempatan peserta membaca aplikasi, sesi, counter kapasitas, assignment unik, dan jadwal peserta di satu transaksi. Aplikasi harus `DOCUMENTS_VERIFIED` dan biaya sudah `PAID`/`WAIVED`; sesi yang bertabrakan atau penuh ditolak.

Penguji yang ditugaskan atau panitia scoped memfinalkan komponen nilai menjadi snapshot immutable dengan persentase total, rekomendasi, actor, waktu, dan content hash. Bila sebuah aplikasi mempunyai assignment seleksi, keputusan `ACCEPTED`/`REJECTED` ditolak sampai seluruh assignment berstatus `SCORED`. Jalur yang memang tidak memerlukan seleksi tetap dapat diputuskan melalui state machine administratif tanpa assignment buatan.

LoA hanya terbit untuk aplikasi `ACCEPTED`, biaya final, dan akun applicant tertaut. Nomor `LOA/{PRODI}/{TAHUN}/{URUTAN}` dialokasikan melalui counter transaksi, satu LoA per aplikasi, dan menyimpan verification code acak 128-bit serta hash payload immutable. Endpoint verifikasi publik bersifat rate-limited dan hanya mengembalikan field minimum.

## Konversi dan NIM

Tahap pertama transaksi Firestore mengalokasikan counter NIM per prodi/cohort, membuat record mahasiswa `PENDING_IDENTITY`, serta memindahkan aplikasi ke `ENROLLMENT_PENDING_IDENTITY`. Service akun lalu mengganti role/claims applicant menjadi student dan menambahkan student/program scope. Transaksi final mengaktifkan student dan menandai aplikasi `ENROLLED`.

Sebab Firebase Authentication tidak dapat ikut dalam transaksi Firestore, tahap tersebut adalah saga idempotent. Retry dengan key yang sama melanjutkan record pending; NIM tidak dialokasikan ulang. Identitas lama gagal tertutup setelah claims diperbarui. Operator harus memonitor record `ENROLLMENT_PENDING_IDENTITY` dan menjalankan retry/kompensasi terkontrol bila provider identity gagal.

## Endpoint utama

| Method | Path | Akses |
|---|---|---|
| `GET` | `/api/admissions/catalog` | publik |
| `POST` | `/api/admissions/applications` | publik, rate-limited, idempotent |
| `GET` | `/api/admissions/applications/me` | applicant/student pemilik |
| `POST` | `/api/admissions/applications/{id}/claim` | applicant dengan email cocok |
| `POST` | `/api/admissions/applications/{id}/review` | panitia PMB scoped |
| `GET/POST` | `/api/admissions/applications/{id}/documents` | applicant pemilik / panitia scoped |
| `POST` | `/api/admissions/applications/{id}/documents/{documentId}/review` | panitia PMB scoped |
| `POST` | `/api/admissions/applications/{id}/fee` | keuangan scoped |
| `POST` | `/api/admissions/applications/{id}/convert` | panitia PMB scoped |
| `GET/POST` | `/api/admissions/selection/sessions` | jadwal seleksi scoped |
| `POST` | `/api/admissions/selection/sessions/{id}/assignments` | penempatan peserta atomik |
| `POST` | `/api/admissions/selection/assignments/{id}/score` | finalisasi nilai oleh penguji/panitia |
| `GET/POST` | `/api/admissions/letters` | daftar/penerbitan LoA |
| `GET` | `/api/admissions/letters/verify?code=...` | verifikasi minimum, publik dan rate-limited |

Semua respons privat memakai `Cache-Control: no-store`. Tampilan aplikasi tidak pernah menyertakan `identityFingerprint`.
