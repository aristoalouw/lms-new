<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
useHead({ title: 'Pengaturan Sistem' })

interface HealthPayload { status: string; timestamp: string; version?: string }

const config = useRuntimeConfig()
const { can, user } = useAuth()
const { $api } = useNuxtApp()
const health = ref<HealthPayload>()
const readiness = ref<HealthPayload>()
const loading = ref(true)
const errorMessage = ref('')

const capabilities = computed(() => [
  { label: 'Profil fitur', value: String(config.public.featureProfile), active: config.public.featureProfile === 'full-campus', detail: 'Mengendalikan route, navigasi, dan API server.' },
  { label: 'Upload file', value: config.public.fileUploadsEnabled ? 'Aktif' : 'Nonaktif', active: config.public.fileUploadsEnabled, detail: 'Memerlukan Storage privat dan malware scanner.' },
  { label: 'Email', value: config.public.emailDeliveryEnabled ? 'Aktif' : 'Nonaktif', active: config.public.emailDeliveryEnabled, detail: 'Pengiriman melalui outbox server.' },
  { label: 'Sentry', value: config.public.sentryEnabled ? 'Aktif' : 'Nonaktif', active: config.public.sentryEnabled, detail: 'Telemetry client/server dengan penyaringan PII.' },
])

const links = computed(() => [
  ...(can('accounts:manage') ? [{ to: '/admin/pengguna', label: 'Pengguna & akses', detail: 'Akun, role, scope, status, dan revocation', icon: 'uil-users-alt' }] : []),
  ...(can('academic.write') || can('academic.configure') ? [{ to: '/akademik/master', label: 'Master akademik', detail: 'Program studi, periode, mata kuliah, kurikulum, dan kalender', icon: 'uil-book-open' }] : []),
  ...(can('pmb.configure') ? [{ to: '/pmb/pengaturan', label: 'Konfigurasi PMB', detail: 'Gelombang, jadwal, biaya, kapasitas, dan program', icon: 'uil-user-plus' }] : []),
  ...(can('evaluation.configure') ? [{ to: '/evaluasi', label: 'Konfigurasi evaluasi', detail: 'Form, periode evaluasi dosen, dan ambang anonimitas', icon: 'uil-favorite' }] : []),
  ...(can('graduation.configure') ? [{ to: '/kelulusan', label: 'Konfigurasi kelulusan', detail: 'Periode, persyaratan, dan template dokumen', icon: 'uil-graduation-cap' }] : []),
  ...(can('tracer.configure') ? [{ to: '/tracer-study', label: 'Konfigurasi tracer study', detail: 'Kuesioner dan periode distribusi tanpa data responden', icon: 'uil-chart-growth' }] : []),
  ...(can('pddikti:view') ? [{ to: '/pddikti', label: 'Operasi PDDIKTI', detail: 'Status worker, antrean, dan kesehatan adapter tanpa approval bisnis', icon: 'uil-sync' }] : []),
  ...(can('audit.read') ? [{ to: '/modul/audit-backup', label: 'Audit & operasi', detail: 'Audit append-only, liveness, readiness, dan runbook backup', icon: 'uil-shield-check' }] : []),
  { to: '/notifikasi', label: 'Notifikasi', detail: 'Preferensi, template, outbox, dan delivery', icon: 'uil-bell' },
])

async function loadStatus() {
  loading.value = true
  errorMessage.value = ''
  const [live, ready] = await Promise.allSettled([$api.get<HealthPayload>('/health'), $api.get<HealthPayload>('/ready')])
  if (live.status === 'fulfilled') health.value = live.value.data
  if (ready.status === 'fulfilled') readiness.value = ready.value.data
  if (!health.value || !readiness.value) errorMessage.value = 'Sebagian status sistem belum dapat dimuat.'
  loading.value = false
}

onMounted(loadStatus)
</script>

<template>
  <div class="page-stack settings-page">
    <AppPageHeader eyebrow="Administrasi sistem" title="Pengaturan" description="Status dan pintasan konfigurasi aktual. Halaman ini tidak menampilkan angka atau integrasi contoh.">
      <template #actions><button class="btn btn-outline-secondary" type="button" :disabled="loading" @click="loadStatus"><i class="uil uil-refresh me-2" />Muat ulang status</button></template>
    </AppPageHeader>
    <div v-if="errorMessage" class="alert alert-warning">{{ errorMessage }}</div>
    <section class="status-grid" aria-label="Status rilis">
      <article><span>Lingkungan</span><strong>{{ config.public.appEnvironment }}</strong><small>{{ config.public.appName }}</small></article>
      <article><span>Liveness</span><strong :class="{ good: health?.status === 'ok' }">{{ health?.status || 'memuat' }}</strong><small>Release {{ health?.version || 'belum tersedia' }}</small></article>
      <article><span>Readiness</span><strong :class="{ good: readiness?.status === 'ready' }">{{ readiness?.status || 'memuat' }}</strong><small>Firebase dan dependensi inti</small></article>
      <article><span>Akses aktif</span><strong>{{ user?.activeRole || '—' }}</strong><small>{{ user?.permissions.length || 0 }} permission pada role ini</small></article>
    </section>
    <section class="capability-grid" aria-label="Kapabilitas lingkungan"><article v-for="item in capabilities" :key="item.label"><span :class="item.active ? 'capability-dot active' : 'capability-dot'" /><div><small>{{ item.label }}</small><strong>{{ item.value }}</strong><p>{{ item.detail }}</p></div></article></section>
    <section class="surface-card"><header><span>Konfigurasi terotorisasi</span><h2>Ruang kerja pengaturan</h2><p>Pilih modul. Setiap perubahan tetap divalidasi oleh API, scope, optimistic version, dan audit.</p></header><div class="link-grid"><NuxtLink v-for="item in links" :key="item.to" :to="item.to"><span><i class="uil" :class="item.icon" /></span><div><strong>{{ item.label }}</strong><small>{{ item.detail }}</small></div><i class="uil uil-angle-right" /></NuxtLink></div></section>
  </div>
</template>

<style scoped>
.settings-page{display:grid;gap:1rem}.status-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem}.status-grid article,.surface-card,.capability-grid article{border:1px solid #e6dfd6;border-radius:.9rem;background:#fff;box-shadow:0 8px 24px rgba(30,30,30,.04)}.status-grid article{display:grid;gap:.22rem;padding:1rem}.status-grid span,.status-grid small,.capability-grid small{color:#6c6865;font-size:.56rem}.status-grid strong{color:#946b2b;font-size:.82rem;text-transform:capitalize}.status-grid strong.good{color:#287151}.capability-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem}.capability-grid article{display:flex;gap:.65rem;padding:.9rem}.capability-dot{width:.55rem;height:.55rem;margin-top:.2rem;border-radius:50%;background:#b58035}.capability-dot.active{background:#593660}.capability-grid strong{display:block;color:#3e2344;font-size:.7rem}.capability-grid p{margin:.25rem 0 0;color:#6c6865;font-size:.54rem;line-height:1.45}.surface-card{padding:1rem}.surface-card>header span{color:#775a83;font-size:.54rem;font-weight:800;text-transform:uppercase}.surface-card h2{margin:.15rem 0;color:#3e2344;font-size:.92rem}.surface-card header p{margin:0;color:#6c6865;font-size:.58rem}.link-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.6rem;margin-top:1rem}.link-grid>a{display:grid;grid-template-columns:auto 1fr auto;gap:.7rem;align-items:center;padding:.8rem;border:1px solid #e6dfd6;border-radius:.75rem;color:inherit;text-decoration:none}.link-grid>a>span{display:grid;width:2.2rem;height:2.2rem;place-items:center;border-radius:.65rem;color:#593660;background:#efe9f2}.link-grid strong,.link-grid small{display:block;color:#3e2344;font-size:.64rem}.link-grid small{margin-top:.15rem;color:#6c6865;font-size:.54rem}@media(max-width:991.98px){.status-grid,.capability-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:575.98px){.status-grid,.capability-grid,.link-grid{grid-template-columns:1fr}}
</style>
