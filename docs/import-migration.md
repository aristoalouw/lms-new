# Impor dan migrasi data

Impor adalah workflow terkontrol: ingest → validasi → preview → approval → commit → rekonsiliasi. Jangan menulis CSV/XLSX langsung ke koleksi produksi dari browser atau Firebase console. Semua batch memiliki source checksum, mapping version, actor, state, error report, idempotency key, dan audit.

## Sumber yang didukung

- spreadsheet/CSV master kampus dan data historis;
- export sistem lama yang telah disetujui pemilik data;
- data referensi atau perbandingan Neo Feeder melalui adapter server;
- file dokumen yang dipetakan ke metadata dan Storage privat.

Neo Feeder tidak boleh dijadikan alasan untuk menimpa data internal otomatis. Lakukan compare/mapping, klasifikasikan konflik, dan minta keputusan operator.

### Implementasi aplikasi saat ini

Endpoint privat `/api/imports` mengimplementasikan staging CSV/TSV untuk master mahasiswa, mata kuliah, dan nilai. XLSX harus dikonversi menjadi CSV UTF-8 atau TSV sebelum diproses; parser XLSX langsung belum dianggap selesai. UI operator tersedia di `/impor`.

Dataset `students` pada workflow ini adalah registry migrasi beserta provenance dan kompensasinya; commit tidak membuat akun Firebase atau menebak dosen wali, kurikulum, batas SKS, IPK, dan state billing. Setelah akun student serta master nyata tersedia, staf memakai `/akademik/mahasiswa` untuk materialisasi atomik ke profil akademik, state KRS, dan profil billing. Pemisahan ini mencegah CSV enam kolom menghasilkan data operasional palsu. Bulk onboarding baru boleh dilakukan dengan template operasional lengkap dan mekanisme kompensasi untuk seluruh proyeksi.

Alur yang tersedia adalah:

1. `POST /api/imports/preview` memvalidasi maksimal 5 MB/5.000 baris, menghitung SHA-256, menormalisasi header dan nilai, memeriksa scope program studi, serta mengklasifikasikan `CREATE`, `UPDATE`, `SKIP`, dan `INVALID`.
2. `POST /api/imports/{id}/approve` mengikat persetujuan pada checksum dan versi preview. Produksi selalu mewajibkan approver berbeda; flag `IMPORT_REQUIRE_DUAL_APPROVAL=true` dapat mengaktifkan aturan yang sama pada development/test.
3. `POST /api/imports/{id}/commit` memeriksa kembali fingerprint target dan memakai mutation ledger per stable ID. Firestore memproses setiap target secara transaksional dan dapat melanjutkan idempotency key yang sama setelah kegagalan parsial.
4. `POST /api/imports/{id}/compensate` memulihkan snapshot sebelumnya atau menghapus create hanya bila fingerprint target belum berubah. Konflik dilaporkan sebagai `PARTIALLY_COMPENSATED`, bukan ditimpa.

Source text tidak dipersistenkan oleh workflow ini. Staging menyimpan nilai kanonis, error aman, checksum, mapping version, actor, expiry, dan mutation ledger. Berkas original yang wajib disimpan untuk cutover harus masuk pipeline file privat/quarantine dengan kebijakan retensi terpisah.

## Zona staging

Gunakan bucket prefix quarantine dan koleksi import terpisah:

```text
importBatches/{batchId}
  sourceName, sourceChecksum, entityType, mappingVersion
  status: UPLOADED | VALIDATING | INVALID | READY | APPROVED | APPLYING | APPLIED | FAILED | COMPENSATED
  counts, createdBy, approvedBy, timestamps
importBatches/{batchId}/rows/{rowId}
  rowNumber, normalized, validationErrors, matchDecision, targetId, rowHash
```

File sumber tidak public dan tidak dapat dibaca role biasa. Batasi ukuran, MIME, retention, scan malware, serta akses operator. Error report hanya memuat row number, stable import key, field, code, dan pesan aman—jangan menyalin seluruh baris PII.

## Persiapan file

1. Dapatkan data melalui kanal terenkripsi dan catat owner, tujuan, periode, klasifikasi, serta retention.
2. Simpan copy original read-only; hitung SHA-256:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath .\incoming\students.csv
```

3. Scan malware dan konversi working copy ke CSV UTF-8 dengan header kanonis. Jangan mengubah original.
4. Normalisasi line ending, whitespace, Unicode, enum, dan empty/null secara eksplisit.
5. Tanggal input memakai format ISO `yyyy-MM-dd`; timestamp memakai ISO 8601 dengan offset. Jangan menebak `01/02/2026`.
6. Nominal IDR berupa digit integer tanpa simbol/pemisah. Nomor identitas/telepon diperlakukan sebagai string agar leading zero tidak hilang.
7. Escape cell ekspor yang dimulai `=`, `+`, `-`, atau `@` untuk mencegah spreadsheet formula injection.

Jangan meminta operator mengunggah service account atau credential sebagai “file konfigurasi impor”.

## Template dan mapping

Setiap entity type memiliki template berversi dengan:

- nama kolom, tipe, required/nullable, max length, enum/reference;
- stable import key dan aturan dedupe;
- transform yang deterministik;
- target field/collection dan default yang disetujui;
- dependency serta contoh data sintetis;
- data owner dan aturan retensi.

Contoh stable key:

| Entitas | Kunci pencocokan utama | Larangan |
|---|---|---|
| program studi | kode resmi + effective period | label/nama saja |
| mahasiswa | internal legacy ID lalu mapping ke UID/NIM | nama + tanggal lahir sebagai auto-match |
| dosen | legacy ID/NIDN mapping yang diverifikasi | nama saja |
| mata kuliah | prodi + kode + curriculum version | judul saja |
| kelas | periode + prodi + kode kelas | jadwal/ruang saja |
| invoice/payment | source system + immutable external reference | nominal + tanggal saja |
| file | source object ID + SHA-256 | nama file saja |

Potential match berdasarkan PII hanya menghasilkan `REVIEW_REQUIRED`; tidak boleh merge otomatis. Mapping keputusan disimpan agar rerun deterministik.

## Validasi

### Structural

- encoding/header/template version benar, tidak ada kolom duplikat/unknown tanpa policy;
- batas baris/ukuran, nilai tidak memuat control character berbahaya;
- tipe, panjang, regex, enum, tanggal, nominal, dan required field valid.

### Referential/domain

- unit/prodi/periode/kurikulum/reference code ada dan aktif pada effective date;
- relasi student–program/cohort, course–curriculum, class–period valid;
- state transition legal, tanggal kronologis, SKS/bobot/nominal dalam rentang;
- role/scope operator mencakup seluruh target.

### Duplicate/conflict

- duplicate intra-file, existing stable key, identifier mapped ke dua target, dan version conflict dilaporkan;
- keputusan per baris: `CREATE`, `UPDATE`, `SKIP_IDENTICAL`, `REVIEW_REQUIRED`, `REJECT`;
- update preview menampilkan field-level before/after yang di-allowlist dan alasan.

Batch tidak boleh `READY` jika ada blocking error. Warning memerlukan acknowledgment pada approval.

## Preview dan approval

Preview menampilkan checksum source, template/mapping version, count total/valid/error/warning/create/update/skip, dependency, dampak per unit/prodi/periode, dan sample tersanitasi. Untuk role, nilai, pembayaran, status kelulusan, serta mapping PDDIKTI, gunakan dual approval dan separation of duties.

Approval terikat pada source checksum dan preview fingerprint. Jika file/mapping/data target berubah sebelum commit, approval invalid dan validasi diulang.

## Commit aman

- Buat idempotency key dari batch ID + source checksum + mapping version + row stable key/hash.
- Proses chunk kecil (misalnya 100–200 mutasi) dengan checkpoint; jangan mengasumsikan seluruh file muat satu transaction.
- Gunakan Firestore transaction untuk invariant per entity (unique reference, invoice balance, capacity) dan batch untuk write independen.
- Periksa `version` target sebelum update; conflict kembali ke review, bukan last-write-wins.
- Tulis audit per batch serta per mutasi kritis, tanpa raw row.
- Worker resumable: restart melanjutkan checkpoint dan `SKIP_IDENTICAL`, bukan menggandakan record.
- Throttle untuk menjaga latency produksi dan quota; impor bulk dihentikan saat peak/payment incident.

Dokumen/file diunggah ke quarantine, checksum diverifikasi, kemudian metadata di-commit. Jangan membuat metadata `CLEAN` sebelum scan selesai.

## Rollback dan kompensasi

Sebelum commit, ambil backup dan simpan snapshot before/target version yang cukup untuk kompensasi. Preferensi:

1. **Belum commit:** batalkan batch dan hapus staging sesuai retention.
2. **Create salah, belum dipakai:** soft-delete record yang dibuat batch, dengan dependency check/audit.
3. **Update salah:** compensation mengembalikan field allowlist hanya jika target version belum berubah setelah import.
4. **Sudah dipakai transaksi/proses eksternal:** jangan delete/restore buta; buat correction bisnis dan rekonsiliasi.
5. **Kerusakan luas:** ikuti incident/recovery runbook; full restore adalah pilihan terakhir.

Setiap target menyimpan `lastImportBatchId`/provenance bila tidak membocorkan data. Kompensasi sendiri adalah batch audited dan idempotent.

## Rekonsiliasi dan sign-off

Setelah commit:

- count create/update/skip/error sesuai preview;
- stable ID unik dan tidak ada orphan reference;
- aggregate per prodi/periode, nominal invoice/payment, SKS, status, serta file checksum cocok sumber;
- sample random dan seluruh high-risk row direview dua pihak;
- query/list dengan index dan Rules tetap bekerja, serta cross-scope test ditolak;
- Neo Feeder/payment tidak dipicu kecuali batch eksplisit disetujui untuk downstream;
- owner menandatangani report dan staging/source dibuang sesuai retention.

## Strategi cutover sistem lama

1. Lakukan dry-run berulang di recovery/staging dengan copy terkontrol.
2. Bekukan mapping/template dan selesaikan error sampai threshold 100% untuk invariant kritis.
3. Tetapkan cutoff, write freeze sistem lama, export final, checksum, dan backup kedua sisi.
4. Jalankan delta import idempotent, rekonsiliasi, dan business sampling.
5. Aktifkan read-only pilot lalu production bertahap; monitor error dan support.
6. Pertahankan sistem lama read-only selama retention/cutover window; jangan hapus sampai sign-off/legal approval.

## Acceptance checklist

- [ ] File sintetis valid, invalid, duplicate, ambiguous date, formula, over-size, wrong encoding, dan cross-scope diuji.
- [ ] Rerun batch yang sama menghasilkan nol duplikasi/perubahan tak terduga.
- [ ] Concurrent target edit menghasilkan conflict, bukan overwrite.
- [ ] Crash di setiap checkpoint dapat dilanjutkan.
- [ ] Compensation diuji pada create/update dan menolak target yang sudah berubah.
- [ ] Error/export report tidak memuat PII berlebihan dan aman dibuka di spreadsheet.
- [ ] Count/checksum/invariant serta downstream isolation direkonsiliasi dan disetujui pemilik data.
