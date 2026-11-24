# DESIGN.md — Sistem Desain LMS STT Saint Paul Bandung

Dokumen ini menetapkan arah visual, tipografi, komponen, layout, dan nada bahasa untuk **LMS STT Saint Paul Bandung** (`lms.sttsaintpaul.ac.id`), diturunkan langsung dari identitas resmi [sttsaintpaul.ac.id](https://sttsaintpaul.ac.id/) dan disesuaikan untuk aplikasi kerja akademik berdensitas data tinggi.

Gunakan dokumen ini bersama **`antislop`** agar setiap pembaruan UI bersih dari pola generik AI sambil tetap setia pada jati diri kampus.

---

## 1. Identitas & Karakter Merek

- **Nama Resmi:** Sekolah Tinggi Teologi Saint Paul Bandung (**STT Saint Paul Bandung**)
- **Semboyan:** *Dimuridkan Untuk Memuridkan*
- **Karakter Visual:** Tenang, akademik, pastoral, dan berwibawa — terinspirasi dari warna ungu plum almamater STT Saint Paul Bandung dipadukan dengan permukaan kertas hangat (*warm parchment*) dan tipografi geometris bersih.
- **Logo:** Lambang perisai/salib/alkitab terbuka dalam segel lingkaran ganda + *wordmark* `STT Saint Paul Bandung`. Gunakan versi putih (`#FFFFFF`) pada sidebar/header ungu gelap (`#593660`) dan versi ungu plum (`#593660`) pada latar terang (`#FFFFFF` / `#FAF6EF`).

---

## 2. Palet Warna (Diadaptasi dari `sttsaintpaul.ac.id`)

Seluruh warna utama berasal dari token global Elementor `sttsaintpaul.ac.id`, diperluas secara terukur agar memenuhi kontras **WCAG AA (≥ 4,5:1)** untuk tabel, formulir, dan status operasional LMS.

### Warna Merek (Brand)
| Token | Hex | Peran | Sumber Referensi |
| :--- | :--- | :--- | :--- |
| `--brand-plum-950` | `#3E2344` | Hover tombol primer, aksen sidebar terdalam | Turunan gelap `#593660` |
| `--brand-plum-900` | `#593660` | **Warna Primer Utama:** sidebar/header identitas, tombol primer, tautan aktif, heading penekanan | `--e-global-color-primary` |
| `--brand-plum-700` | `#775A83` | **Warna Sekunder:** hover kartu/navigasi, aksen sekunder, ikon sorotan | `--e-global-color-secondary` |
| `--brand-plum-100` | `#EFE9F2` | Latar badge aktif, item navigasi terpilih, *pill* peran | Tint halus `#593660` |
| `--brand-plum-50` | `#F7F3F9` | Hover baris tabel & kartu interaktif | Tint paling halus |

### Warna Netral & Permukaan (Warm Parchment + Crisp Paper)
| Token | Hex | Peran | Sumber Referensi |
| :--- | :--- | :--- | :--- |
| `--surface-page` | `#FAF6EF` | Kanvas latar belakang halaman aplikasi (versi lembut dari `#FBF0DE` agar nyaman dipakai berjam-jam) | Adaptasi `#FBF0DE` |
| `--surface-cream` | `#FBF0DE` | Blok sorotan hangat, banner pengumuman kampus, panel cerita halaman login | `--e-global-color-6e3cc138` |
| `--surface-card` | `#FFFFFF` | Permukaan kartu, tabel, modal, dan form input | `#FFFFFF` |
| `--surface-dark` | `#272727` | Footer atau blok kontras gelap (teks wajib `#F5F3F0` / `#D8D4CE`, **jangan** pakai `#737365` karena kontras rendah) | Footer `#colophon` |
| `--ink-primary` | `#1E1E1E` | Teks utama & angka tabel | `--e-global-color-text` |
| `--ink-secondary` | `#4E5462` | Subjudul, label form, teks deskripsi | `--e-global-color-5eb03dc6` |
| `--ink-muted` | `#6C6865` | Metadata, timestamp, keterangan pendukung (kontras ≥ 4,8:1 di atas `#FFFFFF`) | `--e-global-color-6de48a6b` |
| `--border-subtle` | `#E6DFD6` | Garis pemisah kartu, tabel, dan input (hangat, selaras dengan `#ADA098`) | Tint `#ADA098` |
| `--border-strong` | `#ADA098` | Border fokus/hover input, garis aksen halus | `--e-global-color-accent` |

### Warna Semantik Operasional LMS
- **Sukses / Aktif / Lulus:** Teks `#1E6247`, latar `#E7F4EE`, border `#BFE0D1`
- **Peringatan / Menunggu Tinjauan:** Teks `#8A5A12`, latar `#FDF3DF`, border `#EED4A2`
- **Bahaya / Ditolak / Gagal:** Teks `#9E2F3B`, latar `#FCEBEC`, border `#EBC2C6`
- **Informasi / Akademik:** Teks `#2B5B84`, latar `#EAF2F9`, border `#C2DAEE`

### Aturan Penggunaan Warna
- **Dilarang** gradasi neon/ungu-biru generik AI (*SaaS purple glow*), efek *glassmorphism* berlebihan, atau teks abu-abu pudar yang melanggar WCAG AA.
- Gunakan **blok warna datar (*flat color-block*)** sebagaimana di `sttsaintpaul.ac.id`: kontras dibentuk oleh perubahan permukaan (`#FAF6EF` vs `#FFFFFF` vs `#593660`) dan garis `1px solid #E6DFD6`, bukan bayangan tebal.

---

## 3. Tipografi

- **Font Utama:** `Montserrat` (mengikuti `sttsaintpaul.ac.id`) untuk heading, judul modul, navigasi, dan tombol; fallback sistem `"Plus Jakarta Sans", "Segoe UI", system-ui, sans-serif`.
- **Kebijakan Privasi Font:** Karena `NUXT_PUBLIC_GOOGLE_FONTS_ENABLED=false` pada produksi Spark pilot, prioritaskan *self-hosted* `Montserrat` (subset Latin woff2 di `public/fonts/`) jika font eksternal nonaktif, tanpa memanggil CDN pihak ketiga tanpa izin.
- **Angka & Tabel:** Wajib gunakan `font-variant-numeric: tabular-nums` untuk NIM, SKS, IPK, nilai, nominal Rupiah, dan tanggal agar kolom sejajar rapi.

### Skala Tipografi LMS
| Elemen | Ukuran | Weight | Line-Height | Catatan |
| :--- | :--- | :--- | :--- | :--- |
| Hero / Login `h1` | `2rem–2.4rem` (32–38px) | `700` | `1.18` | Ringkas, tidak lebih dari 2 baris |
| Judul Halaman `h1` | `1.45rem` (23px) | `700` | `1.25` | Tepat satu `<h1>` per halaman |
| Judul Bagian `h2` | `1.05rem` (17px) | `600` | `1.35` | — |
| Eyebrow / Kicker | `0.72rem` (11.5px) | `700` | `1.2` | Uppercase, `letter-spacing: 0.06em`, warna `#775A83` |
| Navigasi Sidebar | `0.8125rem` (13px) | `600` | `1.35` | Mengadopsi gaya navigasi `13px` `sttsaintpaul.ac.id` tanpa memaksa all-caps panjang |
| Teks Isi & Tabel | `0.875rem` (14px) | `400` | `1.55` | Nyaman dibaca pada layar desktop & mobile |
| Metadata / Caption | `0.75rem` (12px) | `500` | `1.4` | Warna `#6C6865`, tidak pernah di bawah `11.5px` |

---

## 4. Bentuk, Spasi & Komponen

Mengadaptasi bahasa visual *flat & tegas* dari `sttsaintpaul.ac.id` (blok tegas tanpa bayangan berat + tombol CTA pill/tegas) agar terasa rapi untuk aplikasi akademik:

- **Border Radius:**
  - Kartu & panel data: `6px–8px` (lebih tegas dari kartu 22px generik AI, terinspirasi ketegasan blok `0px` di `sttsaintpaul.ac.id`).
  - Input & tombol kerja (form, tabel, filter): `6px`.
  - Tombol CTA utama di halaman publik/login/hero (seperti *Masuk*, *Daftar PMB*): boleh memakai gaya **pill `999px`** atau border tegas `2px` mengacu langsung pada tombol CTA `50px` `sttsaintpaul.ac.id`.
- **Elevasi (Shadow):**
  - Default kartu: **tanpa bayangan berat** — cukup `border: 1px solid #E6DFD6` (atau bayangan sangat halus `0 1px 2px rgba(30, 30, 30, 0.04)`).
  - Popover, dropdown, dan modal: `0 12px 28px rgba(30, 30, 30, 0.12)` dengan `border: 1px solid #E6DFD6`.
- **Fokus Keyboard (Aksesibilitas):**
  - Ring fokus jelas: `outline: 2px solid #593660; outline-offset: 2px;` pada semua tombol, link, input, dan switch.
- **Tombol:**
  - Primer: latar `#593660`, teks `#FFFFFF`, hover `#3E2344`.
  - Sekunder: latar `#FFFFFF`, teks `#593660`, border `1px solid #775A83`, hover latar `#F7F3F9`.
  - Netral/Batal: latar `#FFFFFF`, teks `#4E5462`, border `1px solid #E6DFD6`.
- **State Wajib di Setiap Halaman Data:**
  - *Loading* (skeleton atau spinner tenang, tidak melompat layout), *Empty state* (bahasa jelas + 1 aksi relevan bila ada), *Error state* (pesan spesifik + tombol muat ulang), dan *Success feedback* (banner konfirmasi jelas).

---

## 5. Layout & Responsivitas

- **Shell Aplikasi:** Sidebar tetap `264px` (latar `#593660` dengan teks putih & item aktif beraksen lembut `rgba(255,255,255,0.14)`, atau sidebar putih bersih dengan garis vertikal aksen `#593660`), Topbar `68px` berlatar `#FFFFFF` dengan garis bawah `1px solid #E6DFD6`.
- **Lebar Konten:** Maksimal `1200px` untuk keterbacaan optimal (selaras dengan kontainer `1140px` di `sttsaintpaul.ac.id`).
- **Mobile (`≤ 768px` dan `360px`):**
  - Tidak boleh ada *horizontal overflow* halaman (`scrollWidth <= clientWidth`).
  - Tabel lebar dibungkus container scroll horizontal atau diubah ke tampilan kartu bertumpuk.
  - Target sentuh minimal `40px × 40px`.
  - Banner privasi bawah tidak boleh menutupi tombol aksi penting (beri *bottom clearance* atau tampilkan kompak).

---

## 6. Nada Bahasa & Copywriting (Bahasa Indonesia)

Mengikuti suara editorial `sttsaintpaul.ac.id`:
- **Resmi, hangat, pastoral-akademik**, menyapa pengguna sebagai **Anda**.
- **Faktual dan langsung pada inti pekerjaan** — tanpa jargon pemasaran AI (*"Revolusioner"*, *"Next-Gen"*, *"Supercharge"*, *"Tingkatkan produktivitas 10x"*).
- **Tanpa angka contoh/palsu** pada layar produksi: jika data belum ada, tampilkan `0` atau *empty state* yang jujur.
- **Contoh label yang tepat:**
  - Gunakan: `Masuk ke LMS STT Saint Paul`, `Ajukan KRS`, `Simpan preferensi`, `Belum ada kelas aktif pada periode ini.`
  - Hindari: `Mulai perjalanan luar biasa Anda!`, `Dashboard pintar berbasis masa depan`, emoji berlebihan pada judul atau tombol.

---

## 7. Peta Migrasi CSS Saat Ini (`assets/css/main.css`)

Saat menerapkan tema ini ke LMS, cukup perbarui token `:root` di `assets/css/main.css` dan `theme-color` di `nuxt.config.ts`:
- `--campus-forest-950` → `#3E2344` (Deep Plum 950)
- `--campus-forest-900` / `theme-color` → `#593660` (Primary Plum STT Saint Paul)
- `--campus-forest-800` / `--bs-primary` → `#593660` (`--bs-primary-rgb: 89, 54, 96`)
- `--campus-forest-700` → `#775A83` (Secondary Lavender-Plum)
- `--campus-forest-100` → `#EFE9F2`
- `--campus-forest-50` → `#F7F3F9`
- `--campus-canvas` / `--bs-body-bg` → `#FAF6EF` (Warm Parchment)
- `--campus-ink` / `--bs-body-color` → `#1E1E1E`
- `--campus-muted` → `#6C6865`
- `--campus-border` → `#E6DFD6`
- `--campus-border-strong` → `#ADA098`
