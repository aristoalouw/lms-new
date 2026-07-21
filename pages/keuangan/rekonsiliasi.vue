<script setup lang="ts">
import type {
  GatewayReconciliationResult,
  GatewayReconciliationRow,
  PaymentGatewayEventRecord,
} from '~/server/types/payment-gateway'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Rekonsiliasi Payment Gateway' })

const { $api } = useNuxtApp()
const config = useRuntimeConfig()
const provider = ref('')
const signatureAlgorithm = ref('HMAC-SHA256')
const events = ref<PaymentGatewayEventRecord[]>([])
const reportText = ref([
  'event_id,transaction_id,amount,occurred_at',
  `evt-provider-example,VA/EXAMPLE/0001,2500000,${new Date().toISOString()}`,
].join('\n'))
const programStudyId = ref('management-s1')
const now = new Date()
const periodEnd = ref(now.toISOString().slice(0, 16))
const periodStart = ref(new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 16))
const result = ref<GatewayReconciliationResult | null>(null)
const busy = ref(false)
const errorMessage = ref('')
const message = ref('')
const sessionReady = ref(false)

const readableError = (error: unknown) => {
  const candidate = error as { response?: { data?: { statusMessage?: string; message?: string } }; message?: string }
  return candidate.response?.data?.statusMessage || candidate.response?.data?.message || candidate.message || 'Permintaan tidak dapat diselesaikan.'
}

const ensureSession = async () => {
  if (sessionReady.value) return
  try {
    await $api.get('/auth/session')
  } catch (error) {
    if (!config.public.demoMode) throw error
    await $api.post('/auth/demo-login', { profileId: 'admin' })
  }
  sessionReady.value = true
}

const loadEvents = async () => {
  busy.value = true
  errorMessage.value = ''
  try {
    await ensureSession()
    const gateway = await $api.get<{ provider: string; signatureAlgorithm: string }>('/payments/gateway/config')
    provider.value = gateway.data.provider
    signatureAlgorithm.value = gateway.data.signatureAlgorithm
    const response = await $api.get<PaymentGatewayEventRecord[]>('/payments/gateway-events', {
      params: { provider: provider.value, programStudyId: programStudyId.value, limit: 100 },
    })
    events.value = response.data
  } catch (error) {
    errorMessage.value = readableError(error)
  } finally {
    busy.value = false
  }
}

const parseReport = (): GatewayReconciliationRow[] => {
  const lines = reportText.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (lines.length < 2) throw new Error('Laporan harus memiliki header dan minimal satu baris.')
  const header = lines[0]!.toLowerCase().split(',').map(value => value.trim())
  if (header.join(',') !== 'event_id,transaction_id,amount,occurred_at') {
    throw new Error('Header wajib: event_id,transaction_id,amount,occurred_at')
  }
  if (lines.length > 2_001) throw new Error('Laporan melebihi 2.000 baris.')
  return lines.slice(1).map((line, index) => {
    const cells = line.split(',').map(value => value.trim())
    if (cells.length !== 4) throw new Error(`Baris ${index + 2} harus memiliki empat kolom.`)
    const amount = Number(cells[2])
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`Nominal baris ${index + 2} tidak valid.`)
    const occurredAt = new Date(cells[3]!)
    if (Number.isNaN(occurredAt.getTime())) throw new Error(`Waktu baris ${index + 2} tidak valid.`)
    return {
      eventId: cells[0]!, transactionId: cells[1]!, amount, currency: 'IDR', occurredAt: occurredAt.toISOString(),
    }
  })
}

const reconcile = async () => {
  busy.value = true
  errorMessage.value = ''
  message.value = ''
  try {
    await ensureSession()
    const rows = parseReport()
    const response = await $api.post<GatewayReconciliationResult>('/payments/reconciliation/preview', {
      provider: provider.value,
      programStudyId: programStudyId.value,
      periodStart: new Date(periodStart.value).toISOString(),
      periodEnd: new Date(periodEnd.value).toISOString(),
      rows,
    })
    result.value = response.data
    message.value = response.data.counts.missingInternal + response.data.counts.missingProvider + response.data.counts.mismatched === 0
      ? 'Seluruh baris laporan cocok dengan catatan internal.'
      : 'Rekonsiliasi selesai dengan selisih yang harus ditinjau.'
    await loadEvents()
  } catch (error) {
    errorMessage.value = readableError(error)
  } finally {
    busy.value = false
  }
}

const onFile = async (event: Event) => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (!file.name.toLowerCase().endsWith('.csv') || file.size > 2 * 1024 * 1024) {
    errorMessage.value = 'Gunakan CSV maksimal 2 MB.'
    return
  }
  reportText.value = await file.text()
  result.value = null
}

const eventRows = computed<Record<string, unknown>[]>(() => events.value.map(record => ({
  id: record.id,
  eventId: record.eventId,
  transactionId: record.transactionId,
  eventType: record.eventType,
  amount: record.amount,
  occurredAt: new Date(record.occurredAt).toLocaleString('id-ID'),
  status: record.status,
})))
const resultRows = computed<Record<string, unknown>[]>(() => (result.value?.rows || []).map((row, index) => ({ id: index, ...row })))
const eventColumns = [
  { key: 'eventId', label: 'Event ID' }, { key: 'transactionId', label: 'Referensi' }, { key: 'eventType', label: 'Jenis' },
  { key: 'amount', label: 'Nominal', align: 'end' as const }, { key: 'occurredAt', label: 'Waktu' }, { key: 'status', label: 'Status' },
]
const resultColumns = [
  { key: 'eventId', label: 'Event ID' }, { key: 'transactionId', label: 'Referensi' },
  { key: 'amount', label: 'Nominal', align: 'end' as const }, { key: 'status', label: 'Hasil' }, { key: 'note', label: 'Catatan' },
]
const eventTone = (value: string) => value === 'PROCESSED' ? 'success' : 'blocked'
const resultTone = (value: string) => value === 'MATCHED' ? 'success' : value === 'MISMATCH' ? 'blocked' : 'review'
const rupiah = (value: unknown) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(value))

onMounted(loadEvents)
</script>

<template>
  <div class="page-stack" data-clarity-mask="true">
    <AppPageHeader
      eyebrow="Keuangan mahasiswa"
      title="Rekonsiliasi Payment Gateway"
      description="Bandingkan laporan settlement provider dengan event internal bertanda tangan tanpa mencatat pembayaran ganda."
      status="active"
      :status-label="provider ? `${provider} · ${signatureAlgorithm}` : 'Memuat konfigurasi'"
    >
      <template #actions>
        <NuxtLink class="btn btn-outline-secondary" to="/keuangan"><i class="uil uil-arrow-left me-2" />Kembali</NuxtLink>
        <label class="btn btn-outline-secondary mb-0"><i class="uil uil-file-upload me-2" />Pilih laporan<input class="visually-hidden" type="file" accept=".csv,text/csv" @change="onFile"></label>
        <button class="btn btn-primary" type="button" :disabled="busy || !provider" @click="reconcile"><span v-if="busy" class="spinner-border spinner-border-sm me-2" />Rekonsiliasi</button>
      </template>
    </AppPageHeader>

    <div v-if="message" class="alert alert-success mb-0" role="status">{{ message }}</div>
    <div v-if="errorMessage" class="alert alert-danger mb-0" role="alert">{{ errorMessage }}</div>

    <section class="workflow-surface">
      <header class="workflow-surface__header"><div><span class="section-kicker">Laporan provider</span><h2>Parameter perbandingan</h2><p>Preview ini hanya membandingkan data; tidak mengubah invoice atau pembayaran.</p></div><span class="secure-chip"><i class="uil uil-shield-check" /> Payload webhook diverifikasi server</span></header>
      <div class="workflow-surface__body"><div class="row g-3"><label class="col-sm-4 form-label"><span>Program studi</span><select v-model="programStudyId" class="form-select"><option value="management-s1">S1 Manajemen</option><option value="informatics-s1">S1 Informatika</option></select></label><label class="col-sm-4 form-label"><span>Mulai</span><input v-model="periodStart" class="form-control" type="datetime-local"></label><label class="col-sm-4 form-label"><span>Selesai</span><input v-model="periodEnd" class="form-control" type="datetime-local"></label><label class="col-12 form-label"><span>CSV settlement provider</span><textarea v-model="reportText" class="form-control report-source" rows="7" spellcheck="false" /></label></div></div>
    </section>

    <template v-if="result">
      <section class="row g-3" aria-label="Ringkasan rekonsiliasi">
        <div class="col-6 col-xl-3"><StatCard label="Cocok" :value="String(result.counts.matched)" detail="Referensi dan nominal sama" trend="Siap ditutup" tone="forest" /></div>
        <div class="col-6 col-xl-3"><StatCard label="Belum internal" :value="String(result.counts.missingInternal)" detail="Ada di laporan provider" trend="Perlu investigasi" tone="amber" /></div>
        <div class="col-6 col-xl-3"><StatCard label="Belum provider" :value="String(result.counts.missingProvider)" detail="Ada di catatan internal" trend="Perlu investigasi" tone="amber" /></div>
        <div class="col-6 col-xl-3"><StatCard label="Tidak cocok" :value="String(result.counts.mismatched)" detail="Referensi/nominal/status" trend="Diblokir dari sign-off" tone="coral" /></div>
      </section>
      <section class="workflow-surface"><header class="workflow-surface__header"><div><span class="section-kicker">Hasil preview</span><h2>Selisih per event</h2><p>Baris cocok tetap ditampilkan agar jumlah laporan dapat direkonsiliasi.</p></div></header><DataTable :columns="resultColumns" :rows="resultRows" :page-size="10" search-placeholder="Cari event atau referensi…"><template #cell-amount="{ value }"><strong>{{ rupiah(value) }}</strong></template><template #cell-status="{ value }"><StatusBadge :status="resultTone(String(value))" :label="String(value)" /></template></DataTable></section>
    </template>

    <section class="workflow-surface"><header class="workflow-surface__header"><div><span class="section-kicker">Jejak webhook</span><h2>Event internal terbaru</h2><p>Raw payload dan signature tidak disimpan; hanya metadata rekonsiliasi tersanitasi.</p></div><button class="btn btn-sm btn-outline-secondary" type="button" :disabled="busy" @click="loadEvents"><i class="uil uil-refresh me-1" />Muat ulang</button></header><DataTable :columns="eventColumns" :rows="eventRows" :page-size="10" search-placeholder="Cari event atau referensi…" empty-title="Belum ada event gateway" empty-description="Event settlement atau reversal yang lolos signature akan muncul di sini."><template #cell-amount="{ value }"><strong>{{ rupiah(value) }}</strong></template><template #cell-status="{ value }"><StatusBadge :status="eventTone(String(value))" :label="String(value)" /></template></DataTable></section>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.form-label { display: grid; gap: .4rem; margin: 0; color: #526860; font-size: .72rem; font-weight: 750; }
.form-control, .form-select { border-color: #dce5e0; color: #29483e; font-size: .78rem; }
.report-source { min-height: 11rem; font: 500 .72rem/1.65 ui-monospace, SFMono-Regular, Consolas, monospace; }
.secure-chip { display: inline-flex; align-items: center; gap: .35rem; padding: .4rem .65rem; border-radius: 999px; color: #376652; background: #eaf4ed; font-size: .65rem; font-weight: 750; white-space: nowrap; }
@media (max-width: 767.98px) { .secure-chip { display: none; } }
</style>
