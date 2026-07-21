<script setup lang="ts">
import type { AuditEntry } from '~/shared/contracts/lms'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Audit & operasi LMS' })

interface HealthPayload { status: string; timestamp: string; version?: string }

const { $api } = useNuxtApp()
const entries = ref<AuditEntry[]>([])
const nextCursor = ref<string>()
const health = ref<HealthPayload>()
const readiness = ref<HealthPayload>()
const loading = ref(true)
const loadingMore = ref(false)
const errorMessage = ref('')

function formatDate(value: string) {
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Jakarta' }).format(new Date(value))
}

async function loadAudit(reset = true) {
  if (reset) loading.value = true
  else loadingMore.value = true
  errorMessage.value = ''
  try {
    const { data } = await $api.get<{ entries: AuditEntry[]; nextCursor?: string }>('/audit', {
      params: { limit: 50, ...(reset || !nextCursor.value ? {} : { cursor: nextCursor.value }) },
    })
    entries.value = reset ? data.entries : [...entries.value, ...data.entries]
    nextCursor.value = data.nextCursor
  } catch {
    errorMessage.value = 'Audit log belum dapat dimuat. Pastikan akun memiliki izin audit.'
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

async function loadStatus() {
  const [live, ready] = await Promise.allSettled([
    $api.get<HealthPayload>('/health'),
    $api.get<HealthPayload>('/ready'),
  ])
  health.value = live.status === 'fulfilled' ? live.value.data : { status: 'unavailable', timestamp: new Date().toISOString() }
  readiness.value = ready.status === 'fulfilled' ? ready.value.data : { status: 'not_ready', timestamp: new Date().toISOString() }
}

onMounted(() => Promise.all([loadAudit(), loadStatus()]))
</script>

<template>
  <div class="page-stack operations-page">
    <AppPageHeader eyebrow="Operasi LMS" title="Audit & backup" description="Pantau kesehatan rilis dan jejak mutasi. Backup serta restore tetap dijalankan dari runbook oleh operator berwenang." />
    <div v-if="errorMessage" class="alert alert-danger" role="alert">{{ errorMessage }}</div>

    <section class="status-grid" aria-label="Status sistem">
      <article><span>Liveness</span><strong :class="health?.status === 'ok' ? 'ok' : 'bad'">{{ health?.status || 'memuat' }}</strong><small>{{ health?.version || 'versi belum tersedia' }}</small></article>
      <article><span>Readiness</span><strong :class="readiness?.status === 'ready' ? 'ok' : 'bad'">{{ readiness?.status || 'memuat' }}</strong><small>{{ readiness ? formatDate(readiness.timestamp) : 'Memeriksa dependensi…' }}</small></article>
      <article><span>Backup & restore</span><strong class="manual">Gate manual</strong><small>Wajib lulus isolated restore drill sebelum promosi produksi.</small></article>
    </section>

    <section class="audit-card">
      <header><div><span>Jejak append-only</span><h2>Mutasi terbaru</h2><p>UI hanya menampilkan metadata minimum; payload sensitif tidak dirender.</p></div><button class="btn btn-sm btn-outline-secondary" type="button" :disabled="loading" @click="loadAudit()">Muat ulang</button></header>
      <div v-if="loading" class="state"><span class="spinner-border spinner-border-sm" aria-hidden="true" /> Memuat audit…</div>
      <div v-else-if="entries.length" class="table-responsive">
        <table>
          <thead><tr><th>Waktu</th><th>Aksi</th><th>Resource</th><th>Pelaku</th><th>Hasil</th></tr></thead>
          <tbody><tr v-for="entry in entries" :key="entry.id"><td>{{ formatDate(entry.occurredAt) }}</td><td><strong>{{ entry.action }}</strong></td><td>{{ entry.resource.type }}<small>{{ entry.resource.id }}</small></td><td>{{ entry.actor.uid }}<small>{{ entry.actor.roles.join(', ') }}</small></td><td><StatusBadge :status="entry.outcome === 'SUCCESS' ? 'success' : 'failed'" :label="entry.outcome" /></td></tr></tbody>
        </table>
      </div>
      <EmptyState v-else title="Belum ada audit" description="Mutasi kelas, enrolment, konten, nilai, file, dan presensi akan muncul di sini." />
      <footer v-if="nextCursor"><button class="btn btn-sm btn-outline-primary" type="button" :disabled="loadingMore" @click="loadAudit(false)">{{ loadingMore ? 'Memuat…' : 'Muat audit berikutnya' }}</button></footer>
    </section>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.status-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}.status-grid article,.audit-card{border:1px solid #dfe8e3;border-radius:1rem;background:#fff;box-shadow:0 10px 30px rgba(24,62,49,.05)}.status-grid article{display:grid;gap:.25rem;padding:1rem}.status-grid span{color:#7b8d85;font-size:.58rem}.status-grid strong{font-size:.9rem;text-transform:uppercase}.status-grid strong.ok{color:#287151}.status-grid strong.bad{color:#a04646}.status-grid strong.manual{color:#8a692d}.status-grid small{color:#7d8e87;font-size:.55rem;line-height:1.5}.audit-card{overflow:hidden}.audit-card>header{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem;border-bottom:1px solid #e8eeeb}.audit-card header span{color:#34705a;font-size:.55rem;font-weight:700;text-transform:uppercase}.audit-card h2{margin:.1rem 0;color:#2c5143;font-size:.9rem}.audit-card header p{margin:0;color:#819089;font-size:.58rem}.audit-card table{width:100%;min-width:780px;border-collapse:collapse}.audit-card th,.audit-card td{padding:.72rem 1rem;border-bottom:1px solid #edf1ef;color:#526a60;font-size:.58rem;text-align:left;vertical-align:top}.audit-card th{color:#788981;background:#f8faf9;font-size:.52rem;text-transform:uppercase}.audit-card td strong,.audit-card td small{display:block}.audit-card td small{margin-top:.15rem;color:#88968f;font-size:.5rem}.audit-card footer,.state{display:flex;justify-content:center;gap:.5rem;padding:1rem}@media(max-width:767.98px){.status-grid{grid-template-columns:1fr}.audit-card>header{align-items:flex-start;flex-direction:column}}
</style>
