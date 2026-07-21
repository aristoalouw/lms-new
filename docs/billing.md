# Student billing and account receivable

The billing module uses integer rupiah amounts and immutable source snapshots. Tariff versions, invoice line items, adjustments, installment schedules, deposit transactions, voucher redemptions, payment proofs, payments, reversals, and gateway events are never edited as informal balances. Derived status such as `OVERDUE` is calculated at read time.

## Main workflow

1. Finance creates a new immutable tariff version. Optimistic concurrency on the tariff head prevents two operators from assigning the same version.
2. Finance issues up to 50 invoices atomically. A unique student-period key prevents duplicate UKT invoices, while the invoice number counter and finance hold are updated in the same transaction.
3. Scholarships, discounts, and penalties append immutable adjustment rows. A discount can never reduce the invoice below payments already settled.
4. An installment plan contains 2-12 strictly ordered dates and must total exactly the invoice amount.
5. Deposit credits and redemptions use their own account and immutable transaction ledger. Voucher redemption is scoped by program and period, capped, and unique per invoice.
6. A student can submit a reference to a `CLEAN` private file as payment proof. Review only changes proof state; it does not silently create a payment. Finance records the matched bank reference through the payment ledger or the signed gateway callback.
7. Settlements and reversals are idempotent and reconciled against provider reports. KRS finance holds must reflect the remaining payable balance.

## API surface

- `GET /api/billing/dashboard` and `GET /api/billing/invoices/:id`
- `GET|POST /api/billing/tariffs`
- `POST /api/billing/invoices/issue`
- `POST /api/billing/invoices/:id/adjustments`
- `POST /api/billing/invoices/:id/installments`
- `POST /api/billing/deposits/credit`
- `POST /api/billing/invoices/:id/deposit`
- `POST /api/billing/invoices/:id/voucher`
- `POST /api/billing/invoices/:id/proofs`
- `POST /api/billing/proofs/:id/review`
- payment and gateway routes are documented in [payment-gateway.md](./payment-gateway.md)

All mutations require authenticated same-origin requests; replay-sensitive writes also require `Idempotency-Key`. Finance staff are restricted to their `programStudyIds`; students can read and act only on their resolved student identity.

## Storage and indexes

Supporting collections are browser-denied in Firestore Rules: tariff plans/heads, invoice keys and counters, adjustments, installment keys/plans, deposit accounts/transactions/references, vouchers/redemptions, and payment-proof state. Large nested tariff components, invoice line items, and schedules have automatic indexing disabled. Composite indexes cover scoped invoice queues and proof review.

## Operational checks

- Reconcile the provider settlement report before period close.
- Investigate `FAILED` gateway events; do not resend them with a different event ID.
- Compare invoice totals, adjustments, settled payments, and deposit/voucher ledgers during restore drills.
- A verified proof still requires a separately audited payment entry.

