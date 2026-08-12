<script setup lang="ts">
import type { AxiosError } from 'axios'
import type {
  BatchInvoiceResult,
  BillingInvoiceView,
  BillingListResult,
  BillingSummary,
  BillingWriteResult,
  DepositAccount,
  InvoiceAdjustment,
  PaymentProof,
} from '~/server/types/billing'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Keuangan Mahasiswa' })

const { user } = useAuth()
const { $api } = useNuxtApp()
const invoices = ref<BillingInvoiceView[]>([])
const summary = ref<BillingSummary | null>(null)
const selectedId = ref('')
const loading = ref(true)
const busy = ref(false)
const errorMessage = ref('')
const notice = ref('')
const filter = reactive({ periodId: '', status: '', search: '' })
const voucherCode = ref('')
const depositAmount = ref(0)
const proofDraft = reactive({ claimedAmountIdr: 0, paidAt: '', bankReference: '', fileId: '' })
const issueDraft = reactive({ tariffPlanVersionId: 'ukt-standard_v1', studentIds: '', dueDate: '' })
const adjustmentDraft = reactive({ type: 'SCHOLARSHIP' as 'SCHOLARSHIP' | 'DISCOUNT' | 'PENALTY', amountIdr: 0, reason: '', reference: '' })
const installmentText = ref('')
const depositCredit = reactive({ studentId: '', amountIdr: 0, sourceReference: '', expectedVersion: 0 })

const isFinance = computed(() => user.value?.roles.includes('finance_staff') || false)
const selected = computed(() => invoices.value.find(item => item.id === selectedId.value) || invoices.value[0])
const rupiah = (value: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value)
const dateLabel = (value: string) => new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeZone: 'Asia/Jakarta' }).format(new Date(`${value}T00:00:00+07:00`))
const statusTone = (value: string) => value === 'PAID' ? 'success' : value === 'OVERDUE' || value === 'VOID' ? 'blocked' : value === 'PARTIALLY_PAID' ? 'review' : 'pending'
const requestKey = (prefix: string) => `${prefix}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}`
const errorText = (error: unknown) => {
  const data = (error as AxiosError<{ statusMessage?: string; message?: string }>).response?.data
  return data?.statusMessage || data?.message || (error instanceof Error ? error.message : 'Permintaan billing gagal diproses.')
}

const invoiceColumns = [
  { key: 'invoiceNumber', label: 'Nomor tagihan' }, { key: 'student', label: 'Mahasiswa' },
  { key: 'periodId', label: 'Periode' }, { key: 'total', label: 'Total', align: 'end' as const },
  { key: 'outstanding', label: 'Sisa', align: 'end' as const }, { key: 'dueDate', label: 'Jatuh tempo' },
  { key: 'status', label: 'Status' }, { key: 'action', label: '', align: 'end' as const },
]
const invoiceRows = computed<Record<string, unknown>[]>(() => invoices.value.map(item => ({
  id: item.id, invoiceNumber: item.invoiceNumber, student: `${item.studentNumber} · ${item.studentName}`,
  periodId: item.periodId, total: item.totalAmount, outstanding: item.outstandingAmountIdr,
  dueDate: item.dueDate, status: item.calculatedStatus, action: item.id,
})))

async function loadBilling(message?: string) {
  loading.value = true; errorMessage.value = ''
  try {
    const { data } = await $api.get<{ invoices: BillingListResult<BillingInvoiceView>; summary: BillingSummary }>('/billing/dashboard', {
      params: { page: 1, pageSize: 100, ...(filter.periodId ? { periodId: filter.periodId } : {}), ...(filter.status ? { status: filter.status } : {}), ...(filter.search ? { search: filter.search } : {}) },
    })
    invoices.value = data.invoices.items; summary.value = data.summary
    if (!invoices.value.some(item => item.id === selectedId.value)) selectedId.value = invoices.value[0]?.id || ''
    if (message) notice.value = message
  } catch (error) { errorMessage.value = errorText(error) } finally { loading.value = false }
}

async function execute(action: () => Promise<unknown>, message: string) {
  if (busy.value) return
  busy.value = true; errorMessage.value = ''; notice.value = ''
  try { await action(); await loadBilling(message) } catch (error) { errorMessage.value = errorText(error) } finally { busy.value = false }
}

function redeemVoucher() {
  if (!selected.value || !voucherCode.value.trim()) return
  return execute(() => $api.post(`/billing/invoices/${selected.value!.id}/voucher`, { code: voucherCode.value, expectedInvoiceVersion: selected.value!.version }, { headers: { 'Idempotency-Key': requestKey('voucher') } }), 'Voucher diterapkan dan jejak penyesuaian dicatat.')
}

function applyDeposit() {
  if (!selected.value || depositAmount.value < 1 || !summary.value) return
  return execute(() => $api.post(`/billing/invoices/${selected.value!.id}/deposit`, { amountIdr: depositAmount.value, expectedInvoiceVersion: selected.value!.version, expectedDepositVersion: 1 }, { headers: { 'Idempotency-Key': requestKey('deposit') } }), 'Saldo deposit diterapkan ke tagihan.')
}

function submitProof() {
  if (!selected.value) return
  return execute(() => $api.post(`/billing/invoices/${selected.value!.id}/proofs`, proofDraft, { headers: { 'Idempotency-Key': requestKey('proof') } }), 'Bukti pembayaran diajukan untuk verifikasi staf keuangan.')
}

function issueInvoices() {
  const studentIds = issueDraft.studentIds.split(',').map(item => item.trim()).filter(Boolean)
  return execute(() => $api.post<BatchInvoiceResult>('/billing/invoices/issue', { tariffPlanVersionId: issueDraft.tariffPlanVersionId, studentIds, dueDate: issueDraft.dueDate }, { headers: { 'Idempotency-Key': requestKey('issue') } }), 'Batch tagihan diterbitkan secara atomik.')
}

function addAdjustment() {
  if (!selected.value) return
  return execute(() => $api.post<BillingWriteResult<{ invoice: BillingInvoiceView; adjustment: InvoiceAdjustment }>>(`/billing/invoices/${selected.value!.id}/adjustments`, { ...adjustmentDraft, reference: adjustmentDraft.reference || undefined, expectedVersion: selected.value!.version }, { headers: { 'Idempotency-Key': requestKey('adjustment') } }), 'Penyesuaian immutable ditambahkan ke tagihan.')
}

function createInstallments() {
  if (!selected.value) return
  const schedules = installmentText.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const [dueDate, amount] = line.split(':')
    return { dueDate, amountIdr: Number(amount) }
  })
  return execute(() => $api.post(`/billing/invoices/${selected.value!.id}/installments`, { expectedVersion: selected.value!.version, schedules }, { headers: { 'Idempotency-Key': requestKey('installment') } }), 'Rencana cicilan immutable dibuat.')
}

function creditDeposit() {
  return execute(() => $api.post<BillingWriteResult<{ account: DepositAccount }>>('/billing/deposits/credit', depositCredit, { headers: { 'Idempotency-Key': requestKey('deposit-credit') } }), 'Saldo deposit mahasiswa dikreditkan.')
}

function reviewProof(proof: PaymentProof, status: 'VERIFIED' | 'REJECTED') {
  const reviewNote = status === 'REJECTED' ? window.prompt('Alasan penolakan bukti:') || '' : 'Bukti cocok; lanjutkan pencatatan pembayaran dengan referensi bank yang sama.'
  if (status === 'REJECTED' && !reviewNote.trim()) return
  return execute(() => $api.post(`/billing/proofs/${proof.id}/review`, { status, reviewNote, expectedVersion: proof.version }), `Bukti ditandai ${status}.`)
}

onMounted(() => {
  const now = new Date(); proofDraft.paidAt = now.toISOString().slice(0, 16); issueDraft.dueDate = new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10)
  loadBilling()
})
</script>

<template>
  <div class="page-stack" data-clarity-mask="true">
    <AppPageHeader eyebrow="Administrasi mahasiswa" title="Keuangan" description="Kelola tarif berversi, tagihan, cicilan, potongan, deposit, bukti bayar, dan saldo piutang tanpa mengubah riwayat." status="active" status-label="IDR · ledger immutable">
      <template #actions><NuxtLink v-if="isFinance" class="btn btn-outline-secondary" to="/keuangan/rekonsiliasi"><i class="uil uil-exchange me-2" />Rekonsiliasi gateway</NuxtLink><button class="btn btn-primary" :disabled="loading" @click="loadBilling()"><i class="uil uil-refresh me-2" />Muat ulang</button></template>
    </AppPageHeader>

    <div v-if="notice" class="alert alert-success mb-0">{{ notice }}</div><div v-if="errorMessage" class="alert alert-danger mb-0">{{ errorMessage }}</div>
    <section class="workflow-toolbar"><div class="workflow-toolbar__filters"><label><span>Periode</span><input v-model="filter.periodId" class="form-control form-control-sm" placeholder="2026-2027-1"></label><label><span>Status</span><select v-model="filter.status" class="form-select form-select-sm"><option value="">Semua</option><option>UNPAID</option><option>PARTIALLY_PAID</option><option>PAID</option><option>OVERDUE</option></select></label><label><span>Pencarian</span><input v-model="filter.search" class="form-control form-control-sm" placeholder="Nomor atau mahasiswa" @keyup.enter="loadBilling()"></label><button class="btn btn-sm btn-outline-secondary" @click="loadBilling()">Terapkan</button></div></section>

    <section v-if="summary" class="row g-3"><div class="col-6 col-xl-3"><StatCard label="Total tagihan" :value="rupiah(summary.billedAmountIdr)" :detail="`${summary.invoiceCount} dokumen`" trend="Snapshot tarif" tone="forest" /></div><div class="col-6 col-xl-3"><StatCard label="Terbayar" :value="rupiah(summary.paidAmountIdr)" detail="Pembayaran settled" trend="Ledger gateway/manual" tone="blue" /></div><div class="col-6 col-xl-3"><StatCard label="Piutang" :value="rupiah(summary.outstandingAmountIdr)" :detail="`${summary.overdueInvoiceCount} lewat tempo`" trend="Cekal terintegrasi" tone="amber" /></div><div class="col-6 col-xl-3"><StatCard label="Saldo deposit" :value="rupiah(summary.depositBalanceIdr)" detail="Milik mahasiswa" trend="Ledger terpisah" tone="slate" /></div></section>

    <section class="billing-grid"><article class="workflow-surface"><header class="workflow-surface__header"><div><span class="section-kicker">Account receivable</span><h2>Daftar tagihan</h2><p>Status lewat tempo dihitung pada waktu baca; nilai historis tetap immutable.</p></div></header><div v-if="loading" class="loading-box"><span class="spinner-border spinner-border-sm" /> Memuat billing…</div><DataTable v-else :columns="invoiceColumns" :rows="invoiceRows" :page-size="10" search-placeholder="Cari tagihan…" empty-title="Tidak ada tagihan" empty-description="Tidak ada tagihan pada filter ini."><template #cell-invoiceNumber="{ value }"><strong>{{ value }}</strong></template><template #cell-total="{ value }">{{ rupiah(Number(value)) }}</template><template #cell-outstanding="{ value }"><strong>{{ rupiah(Number(value)) }}</strong></template><template #cell-dueDate="{ value }">{{ dateLabel(String(value)) }}</template><template #cell-status="{ value }"><StatusBadge :status="statusTone(String(value))" :label="String(value)" /></template><template #cell-action="{ value }"><button class="btn btn-sm btn-outline-primary" @click="selectedId = String(value)">Rincian</button></template></DataTable></article>

      <aside v-if="selected" class="workflow-surface invoice-detail"><header class="workflow-surface__header"><div><span class="section-kicker">{{ selected.invoiceNumber }}</span><h2>{{ selected.studentName }}</h2><p>{{ selected.studentNumber }} · {{ selected.periodId }}</p></div><StatusBadge :status="statusTone(selected.calculatedStatus)" :label="selected.calculatedStatus" /></header><div class="workflow-surface__body"><dl class="detail-list"><div><dt>Total</dt><dd>{{ rupiah(selected.totalAmount) }}</dd></div><div><dt>Terbayar</dt><dd>{{ rupiah(selected.paidAmount) }}</dd></div><div><dt>Sisa</dt><dd>{{ rupiah(selected.outstandingAmountIdr) }}</dd></div><div><dt>Jatuh tempo</dt><dd>{{ dateLabel(selected.dueDate) }}</dd></div></dl><h3>Komponen snapshot</h3><ul class="line-items"><li v-for="item in selected.lineItems" :key="item.id"><span>{{ item.label }} <small>{{ item.quantity }} × {{ rupiah(item.unitAmountIdr) }}</small></span><strong>{{ rupiah(item.amountIdr) }}</strong></li></ul><template v-if="selected.installmentPlan"><h3>Jadwal cicilan</h3><ul class="line-items"><li v-for="item in selected.installmentPlan.schedules" :key="item.id"><span>{{ dateLabel(item.dueDate) }} <small>{{ item.status }}</small></span><strong>{{ rupiah(item.amountIdr) }}</strong></li></ul></template></div></aside>
    </section>

    <section v-if="selected && !isFinance" class="action-grid"><form class="workflow-surface action-card" @submit.prevent="redeemVoucher"><header class="workflow-surface__header"><div><span class="section-kicker">Potongan terkontrol</span><h2>Gunakan voucher</h2></div></header><input v-model="voucherCode" class="form-control" placeholder="Kode voucher" required><button class="btn btn-primary" :disabled="busy">Terapkan</button></form><form class="workflow-surface action-card" @submit.prevent="applyDeposit"><header class="workflow-surface__header"><div><span class="section-kicker">Saldo mahasiswa</span><h2>Gunakan deposit</h2></div></header><input v-model.number="depositAmount" class="form-control" type="number" min="1" :max="selected.outstandingAmountIdr" required><small>Saldo tersedia {{ rupiah(summary?.depositBalanceIdr || 0) }}</small><button class="btn btn-primary" :disabled="busy">Terapkan deposit</button></form><form class="workflow-surface action-card" @submit.prevent="submitProof"><header class="workflow-surface__header"><div><span class="section-kicker">Referensi file privat</span><h2>Ajukan bukti bayar</h2></div></header><input v-model.number="proofDraft.claimedAmountIdr" class="form-control" type="number" min="1" placeholder="Nominal" required><input v-model="proofDraft.paidAt" class="form-control" type="datetime-local" required><input v-model="proofDraft.bankReference" class="form-control" placeholder="Referensi bank" required><input v-model="proofDraft.fileId" class="form-control" placeholder="ID file CLEAN dari menu Berkas" required><button class="btn btn-primary" :disabled="busy">Ajukan bukti</button></form></section>

    <section v-if="isFinance" class="staff-grid"><form class="workflow-surface action-card" @submit.prevent="issueInvoices"><header class="workflow-surface__header"><div><span class="section-kicker">Batch atomik</span><h2>Terbitkan tagihan</h2></div></header><input v-model="issueDraft.tariffPlanVersionId" class="form-control" placeholder="Versi tarif" required><textarea v-model="issueDraft.studentIds" class="form-control" rows="3" placeholder="student-001, student-002" required></textarea><input v-model="issueDraft.dueDate" class="form-control" type="date" required><button class="btn btn-primary" :disabled="busy">Terbitkan batch</button></form><form v-if="selected" class="workflow-surface action-card" @submit.prevent="addAdjustment"><header class="workflow-surface__header"><div><span class="section-kicker">Ledger penyesuaian</span><h2>Potongan / penalti</h2></div></header><select v-model="adjustmentDraft.type" class="form-select"><option>SCHOLARSHIP</option><option>DISCOUNT</option><option>PENALTY</option></select><input v-model.number="adjustmentDraft.amountIdr" class="form-control" type="number" min="1" placeholder="Nominal" required><input v-model="adjustmentDraft.reason" class="form-control" placeholder="Alasan" required><input v-model="adjustmentDraft.reference" class="form-control" placeholder="Nomor keputusan (opsional)"><button class="btn btn-primary" :disabled="busy">Catat penyesuaian</button></form><form v-if="selected" class="workflow-surface action-card" @submit.prevent="createInstallments"><header class="workflow-surface__header"><div><span class="section-kicker">Jadwal immutable</span><h2>Buat cicilan</h2></div></header><textarea v-model="installmentText" class="form-control" rows="5" placeholder="2026-08-31:3750000&#10;2026-09-30:3750000" required></textarea><small>Total baris harus sama dengan total tagihan.</small><button class="btn btn-primary" :disabled="busy">Simpan cicilan</button></form><form class="workflow-surface action-card" @submit.prevent="creditDeposit"><header class="workflow-surface__header"><div><span class="section-kicker">Ledger deposit</span><h2>Kredit saldo</h2></div></header><input v-model="depositCredit.studentId" class="form-control" placeholder="student-001" required><input v-model.number="depositCredit.amountIdr" class="form-control" type="number" min="1" placeholder="Nominal" required><input v-model="depositCredit.sourceReference" class="form-control" placeholder="Referensi unik" required><input v-model.number="depositCredit.expectedVersion" class="form-control" type="number" min="0" placeholder="Versi saldo"><button class="btn btn-primary" :disabled="busy">Kredit deposit</button></form></section>

    <section v-if="isFinance && selected?.proofs.length" class="workflow-surface"><header class="workflow-surface__header"><div><span class="section-kicker">Dual workflow</span><h2>Bukti pembayaran menunggu review</h2><p>Verifikasi bukti tidak otomatis mencatat pembayaran; gunakan referensi bank pada ledger pembayaran setelah cocok.</p></div></header><div class="proof-list"><article v-for="proof in selected.proofs" :key="proof.id"><div><strong>{{ proof.bankReference }}</strong><small>{{ rupiah(proof.claimedAmountIdr) }} · {{ proof.status }} · file {{ proof.file.fileId }} v{{ proof.file.version }}</small></div><div v-if="proof.status === 'SUBMITTED'"><button class="btn btn-sm btn-outline-danger" @click="reviewProof(proof, 'REJECTED')">Tolak</button><button class="btn btn-sm btn-primary" @click="reviewProof(proof, 'VERIFIED')">Verifikasi</button></div></article></div></section>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.billing-grid{display:grid;grid-template-columns:minmax(0,1.8fr) minmax(280px,.7fr);gap:1rem}.invoice-detail{align-self:start;position:sticky;top:1rem}.invoice-detail h3{margin:1rem 0 .45rem;color:#39594d;font-size:.68rem}.line-items{display:grid;gap:.45rem;margin:0;padding:0;list-style:none}.line-items li{display:flex;justify-content:space-between;gap:.7rem;padding:.55rem 0;border-top:1px solid #edf1ee;color:#4b6259;font-size:.62rem}.line-items small{display:block;color:#8a9792}.action-grid,.staff-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem}.staff-grid{grid-template-columns:repeat(4,1fr)}.action-card{display:grid;gap:.55rem;padding-bottom:1rem}.action-card>input,.action-card>textarea,.action-card>select,.action-card>button,.action-card>small{margin:0 1rem}.action-card .form-control,.action-card .form-select{border-color:#dbe4df;font-size:.68rem}.action-card small{color:#82908a;font-size:.55rem}.proof-list article{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.8rem 1rem;border-top:1px solid #edf1ee}.proof-list strong,.proof-list small{display:block;color:#3c584d;font-size:.65rem}.proof-list small{margin-top:.2rem;color:#84928d;font-size:.55rem}.proof-list article>div:last-child{display:flex;gap:.4rem}.loading-box{display:flex;align-items:center;justify-content:center;gap:.5rem;min-height:180px;color:#7c8d85;font-size:.65rem}
@media(max-width:1199.98px){.billing-grid{grid-template-columns:1fr}.invoice-detail{position:static}.staff-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:767.98px){.action-grid,.staff-grid{grid-template-columns:1fr}.proof-list article{align-items:flex-start;flex-direction:column}}
</style>
