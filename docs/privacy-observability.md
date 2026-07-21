# Privasi, analytics, logging, dan Sentry

Observability harus menjawab “layanan apa yang gagal dan sejak release mana” tanpa menyalin isi data kampus. Audit bisnis menjawab “siapa melakukan apa terhadap record mana”. Keduanya dipisahkan dalam akses, retention, dan tujuan.

## Klasifikasi area

| Area | Contoh | Analytics/Clarity | Sentry | Cache |
|---|---|---|---|---|
| Publik | landing PMB, informasi prodi/biaya publik | boleh setelah consent | error teknis tersanitasi | boleh jika eksplisit |
| Autentikasi | login/reset | dilarang merekam input; page-view minimal bila disahkan | error teknis tanpa identifier/credential | no-store |
| Privat | dashboard, KRS, nilai, tagihan, kelas, dokumen | off secara default; Clarity dilarang | tersanitasi, sample minimum | no-store |
| Admin/sangat sensitif | role, audit, pembayaran, PDDIKTI, upload | dilarang | hanya error metadata tersaring | no-store |

`NUXT_PUBLIC_ANALYTICS_PRIVATE_ENABLED` harus selalu `false` pada baseline. Flag publik bukan satu-satunya kontrol: plugin analytics juga harus memakai allowlist route publik dan consent gate. Nginx CSP mengizinkan domain vendor yang disetujui agar feature dapat diaktifkan, tetapi script tidak dimuat saat flag/consent off.

## Data yang dilarang keluar

Jangan kirim ke access log, Sentry, Google Analytics, GTM, Microsoft Clarity, CDN, atau email operasional:

- password, reset code, Firebase ID/session/refresh token, cookie, authorization header, API/service key;
- NIK, NIM bila dapat dihindari, nomor telepon, email personal, alamat, tanggal lahir, guardian identity;
- isi KRS, nilai, presensi individu, tugas/submission/feedback, evaluasi dosen mentah;
- nominal/tagihan/transaksi/reference pembayaran per mahasiswa dan bukti bayar;
- dokumen PMB, ijazah, transkrip, surat, file upload, signed URL;
- request/response body Neo Feeder/payment gateway dan query string yang dapat mengandung identifier;
- stack local variable, DOM text, screenshot, keystroke, atau replay halaman privat.

Gunakan internal random request/event ID. Jika korelasi user mutlak perlu untuk security log, gunakan pseudonymous keyed hash yang dikelola internal, bukan raw UID/email, dan batasi akses/retention.

## Consent dan analytics

Sebelum consent, default seluruh storage/tag analytics “denied”. Banner menjelaskan kategori, vendor, tujuan, retention, serta cara menarik consent. Penolakan harus semudah persetujuan dan aplikasi akademik tetap berfungsi tanpa analytics.

Implementasi minimum:

1. hanya load GTM/GA/Clarity pada allowlist route publik setelah consent analytics;
2. saat pindah ke route privat, hentikan page view/event dan pastikan Clarity tidak aktif;
3. data layer memakai allowlist event generik, misalnya `public_program_view` atau `admission_cta_click`;
4. jangan mengirim path dinamis yang berisi ID; normalisasi ke template seperti `/pmb/program/:slug`;
5. jangan set `user_id`, email, NIM, role gabungan sensitif, custom dimension PII, atau event form value;
6. jangan memberi GTM Custom HTML bebas tanpa review keamanan/privasi; publish container memerlukan dual approval;
7. uji browser network requests dengan consent deny/accept/revoke pada staging.

Untuk Microsoft Clarity, aktifkan hanya domain/route publik dan mask seluruh input/teks yang berpotensi personal. Jangan memakai session replay pada login, form PMB, portal, dashboard, atau halaman authenticated. Jika vendor tidak dapat menjamin route-level stop dan masking, jangan aktifkan Clarity.

Google Fonts eksternal default off (`NUXT_PUBLIC_GOOGLE_FONTS_ENABLED=false`). Self-host font berlisensi bila privasi/ketersediaan lebih penting. jsDelivr hanya untuk aset non-kritis dengan fallback/self-host; jangan memuat data atau identifier melalui URL CDN.

## Sentry

Sentry off ketika DSN kosong. Gunakan project/DSN terpisah per environment, set `environment` dan immutable `release`, matikan `sendDefaultPii`, session replay, screenshot, attachment, dan source context sensitif. Upload source map dari CI menggunakan token secret, lalu hapus/cegah public `.map`; token upload tidak pernah berada di runtime/browser.

Scrubber konseptual yang harus diterapkan di client dan server sebelum enable:

```ts
const blocked = /authorization|cookie|token|password|secret|private.?key|document|attachment/i

function beforeSend(event) {
  delete event.user
  if (event.request) {
    delete event.request.data
    delete event.request.cookies
    event.request.headers = Object.fromEntries(
      Object.entries(event.request.headers ?? {}).filter(([key]) => !blocked.test(key)),
    )
    if (event.request.url) event.request.url = new URL(event.request.url).origin + new URL(event.request.url).pathname
  }
  event.breadcrumbs = (event.breadcrumbs ?? []).map(({ data, ...safe }) => safe)
  return event
}
```

Kode nyata harus tahan URL relatif/malformed dan juga membersihkan `extra`, `contexts`, tags, exception mechanism, serta nested keys secara rekursif. Jangan mengandalkan denylist saja; buat allowlist field. Filter 401/403/404/validation yang expected agar tidak menjadi noise, namun security anomaly dihitung di metric internal.

Sebelum enable:

- kirim synthetic error dari route publik dan privat dengan fake password/token/PII di berbagai lokasi;
- pastikan event vendor hanya berisi release, environment, error class/message aman, stack, route template, request ID, duration;
- periksa breadcrumb Axios/router/console dan matikan body/params/header capture;
- lakukan sampling dan rate limit agar error loop tidak mengirim data/biaya berlebihan;
- beri akses Sentry melalui SSO/MFA/least privilege dan tetapkan retention minimum.

## Logging teknis

Nginx mencatat timestamp, request ID, remote address sesuai kebijakan, method, normalized `$uri` tanpa query, status, bytes, duration, upstream time, dan user agent. Ia tidak mencatat body, query, cookie, atau authorization. Nitro menggunakan structured log dengan route template/error code, bukan message vendor mentah.

Aturan:

- production log level `info/warn/error`; debug off;
- stack trace hanya di sink teknis restricted, tidak pada response pengguna;
- mask/hash IP bila tidak diperlukan untuk keamanan dan terapkan retention;
- newline/control character pada input disanitasi untuk mencegah log injection;
- payment/Feeder log hanya job/reference internal dan status, tanpa payload/header;
- akses log dan audit log tidak dapat diubah pengguna biasa; deletion mengikuti retention/hold resmi.

## Audit bisnis

Audit event memuat `occurredAt`, actor UID/role, action, resource type/ID, outcome, request ID, reason/approval ID, serta before/after yang di-allowlist. Jangan menyalin entire document. Event minimum: login/revocation berisiko, role/scope, KRS approval, grade publish/correction, payment/reversal, scholarship/override, document issuance/cancel, PDDIKTI queue/retry/result, file quarantine/delete, dan backup/restore approval.

Dashboard/Sentry bukan audit system of record. Error event boleh dihapus berdasarkan retention tanpa menghapus bukti bisnis.

## Retention dan akses

Tetapkan per vendor setelah data protection review. Baseline: analytics sesingkat kebutuhan tren publik, Clarity lebih singkat atau off, Sentry 30–90 hari, technical log 30–90 hari, security log sesuai risk, dan audit bisnis sesuai kebijakan akademik/keuangan/legal. Angka final harus disahkan, dikonfigurasi pada vendor, dan diuji deletion/export.

Akses analytics untuk tim komunikasi/produk publik; Sentry/log untuk engineering/on-call; audit bisnis untuk role berwenang/compliance. Semua memakai SSO/MFA dan review berkala. Export vendor disimpan terenkripsi dan tidak dibagikan lewat email/chat umum.

## Checklist privasi rilis

- [ ] Data inventory, tujuan, dasar pemrosesan, retention, vendor, dan owner disahkan.
- [ ] Consent deny/accept/revoke diuji; tanpa consent tidak ada request vendor.
- [ ] Route privat/login/admin tidak memuat analytics/Clarity dan tidak mengirim event saat navigasi SPA.
- [ ] GTM container/tag baru di-review dan dipublish dua pihak.
- [ ] Synthetic secret/PII tidak muncul di Sentry, log, analytics, atau network request.
- [ ] Sentry `sendDefaultPii`, replay, screenshot, attachment, dan body/header capture off.
- [ ] CSP/domain allowlist hanya memuat vendor yang disetujui; fallback aset kritis tersedia.
- [ ] Vendor access, MFA, retention, deletion, DPA, dan incident contact diverifikasi.
