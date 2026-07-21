# Payment gateway dan rekonsiliasi

Integrasi gateway menggunakan satu provider aktif per environment dengan beberapa channel (`bank_transfer`, `virtual_account`, `card`, dan `ewallet`). Provider ditentukan oleh `PAYMENT_GATEWAY_PROVIDER_ID`; secret HMAC hanya tersedia di server melalui `PAYMENT_GATEWAY_WEBHOOK_SECRET`.

Implementasi ini menyediakan kontrak webhook generik yang harus dipetakan dan diuji terhadap provider kampus yang dipilih. Ia bukan bukti bahwa sandbox/production vendor tertentu telah disetujui atau diuji.

## Kontrak webhook

Endpoint:

```text
POST /api/payments/gateway/{provider}/callback
```

Header wajib:

```text
Content-Type: application/json
X-Payment-Timestamp: <Unix epoch seconds>
X-Payment-Event-ID: <eventId yang sama dengan payload>
X-Payment-Signature: sha256=<hex HMAC>
```

String yang ditandatangani adalah `${timestamp}.${rawBody}` menggunakan HMAC-SHA256. Signature dibandingkan secara constant-time. Timestamp di luar toleransi lima menit ditolak untuk membatasi replay, body dibatasi 64 KiB, dan provider/event ID harus cocok. Nginx hanya meneruskan HTTPS pada produksi.

Settlement:

```json
{
  "eventId": "evt-settlement-0001",
  "eventType": "payment.settled",
  "transactionId": "VA/2026/000001",
  "invoiceId": "invoice-2026-0001",
  "amount": 2500000,
  "currency": "IDR",
  "channel": "virtual_account",
  "occurredAt": "2026-07-21T01:00:00.000Z"
}
```

Reversal menambahkan referensi pembayaran awal dan alasan:

```json
{
  "eventId": "evt-reversal-0001",
  "eventType": "payment.reversed",
  "transactionId": "REV/2026/000001",
  "originalExternalReference": "VA/2026/000001",
  "invoiceId": "invoice-2026-0001",
  "amount": 2500000,
  "currency": "IDR",
  "channel": "virtual_account",
  "reason": "Transaksi dibatalkan bank penerbit.",
  "occurredAt": "2026-07-21T02:00:00.000Z"
}
```

## Konsistensi dan idempotency

- `eventId` dan payload hash mencegah event ID digunakan kembali dengan isi berbeda.
- `transactionId` settlement unik melalui `paymentReferences`.
- Invoice, payment, referensi eksternal, dan idempotency record ditulis dalam Firestore transaction.
- Reversal memeriksa invoice ID, nominal, dan pembayaran awal sebelum mengurangi saldo invoice.
- Pengulangan event identik mengembalikan hasil tersimpan tanpa mutasi atau audit bisnis ganda.
- Event gagal menyimpan metadata aman dengan failure code agar dapat direkonsiliasi; raw payload, signature, credential, dan identitas lengkap tidak disimpan.
- Manual reversal oleh staf menggunakan endpoint privat, CSRF, RBAC/scope, business invariant, dan idempotency key.

## Rekonsiliasi

UI privat `/keuangan/rekonsiliasi` menerima CSV maksimal 2.000 baris dengan header:

```csv
event_id,transaction_id,amount,occurred_at
```

Preview mengklasifikasikan `MATCHED`, `MISSING_INTERNAL`, `MISSING_PROVIDER`, dan `MISMATCH`. Preview tidak mengubah invoice/payment. Sign-off hanya dilakukan setelah seluruh selisih ditelusuri terhadap portal atau laporan resmi provider.

## Operasi

1. Buat secret acak minimal 32 byte dan distribusikan melalui secret manager, bukan repository atau chat.
2. Konfigurasikan HTTPS callback dan header kontrak pada sandbox provider.
3. Uji settlement identik, duplicate delivery, timeout setelah commit, amount mismatch, event ID reuse, stale signature, invalid signature, reversal, serta provider outage.
4. Verifikasi log Nginx/Sentry tidak memuat query, authorization, signature, raw body, atau data finansial.
5. Rotasi secret dengan change window. Kontrak saat ini memakai satu secret aktif; overlapping dual-secret rotation belum diimplementasikan dan harus ditambahkan bila provider tidak mendukung cutover atomik.
6. Jalankan rekonsiliasi harian dan sebelum penutupan periode. Selisih tidak boleh diperbaiki dengan edit langsung melalui Firebase console.

## Bukti yang masih dibutuhkan untuk go-live

- contract test dan callback nyata pada sandbox provider terpilih;
- simulasi timeout setelah Firestore commit dan retry dari provider;
- approval finance/security atas payload, IP policy bila tersedia, SLA, retensi, refund/dispute, dan proses rekonsiliasi;
- load test callback serta monitoring 429/5xx;
- runbook rotasi secret dan incident dengan bukti latihan.
