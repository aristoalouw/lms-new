<script setup lang="ts">
import type { AxiosError } from 'axios'
import type { DashboardSnapshot } from '~/server/types/domain'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Dashboard' })

type DashboardSections = Partial<Pick<DashboardSnapshot, 'academic' | 'finance' | 'admissions' | 'pddikti' | 'outcomes' | 'accreditation'>>
interface Summary { periodId: string; updatedAt: string; filter: { programStudyId?: string }; sections: DashboardSections }

const { user } = useAuth()
const { can } = useAuth()
const { isLmsMvp } = useFeatureFlags()
const { $api } = useNuxtApp()
const summary = ref<Summary | null>(null)
const filters = reactive({ periodId: '2025-2026-2', programStudyId: '' })
const loading = ref(true)
const exporting = ref(false)
const errorMessage = ref('')
const rupiah = (value: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value)
const percent = (value: number) => `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(value)}%`
const updatedLabel = computed(() => summary.value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(summary.value.updatedAt)) : '')
const errorText = (error: unknown) => {
  const data = (error as AxiosError<{ statusMessage?: string; message?: string }>).response?.data
  return data?.statusMessage || data?.message || (error instanceof Error ? error.message : 'Dashboard gagal dimuat.')
}

const cards = computed(() => {
  const sections = summary.value?.sections
  if (!sections) return []
  return [
    ...(sections.academic ? [
      { label: 'Mahasiswa aktif', value: sections.academic.activeStudents.toLocaleString('id-ID'), detail: `${sections.academic.classesRunning} kelas berjalan`, tone: 'forest' as const },
      { label: 'Kehadiran', value: percent(sections.academic.averageAttendancePercent), detail: `${percent(sections.academic.lecturesRealizedPercent)} realisasi kuliah`, tone: 'blue' as const },
    ] : []),
    ...(sections.finance ? [{ label: 'Penerimaan', value: rupiah(sections.finance.collectedAmount), detail: `${sections.finance.overdueInvoices} tagihan lewat tempo`, tone: 'amber' as const }] : []),
    ...(sections.admissions ? [{ label: 'Daftar ulang PMB', value: sections.admissions.enrolledApplicants.toLocaleString('id-ID'), detail: `${sections.admissions.applicants.toLocaleString('id-ID')} pendaftar`, tone: 'forest' as const }] : []),
    ...(sections.pddikti ? [{ label: 'Kelengkapan PDDIKTI', value: percent(sections.pddikti.completenessPercent), detail: `${sections.pddikti.queuedRecords} antre · ${sections.pddikti.failedRecords} gagal`, tone: sections.pddikti.failedRecords ? 'amber' as const : 'forest' as const }] : []),
    ...(sections.outcomes ? [{ label: 'Respons tracer', value: percent(sections.outcomes.tracerResponseRatePercent), detail: `${sections.outcomes.respondents} responden`, tone: 'blue' as const }] : []),
    ...(sections.accreditation ? [{ label: 'Akreditasi institusi', value: sections.accreditation.institutionStatus, detail: `${sections.accreditation.programStudyAtRisk} prodi perlu perhatian`, tone: sections.accreditation.programStudyAtRisk ? 'amber' as const : 'forest' as const }] : []),
  ]
})

const links = computed(() => isLmsMvp.value ? [
  ...(can('classes:manage') ? [{ to: '/admin/kelas', label: 'Kelas & enrolment', detail: 'Kelola kelas, dosen, dan roster kanonik', icon: 'uil-presentation-check' }] : []),
  { to: '/pembelajaran', label: 'Pembelajaran', detail: 'Materi, tugas, diskusi, dan feedback', icon: 'uil-presentation-play' },
  { to: '/notifikasi', label: 'Notifikasi', detail: 'Pembaruan aktivitas kelas', icon: 'uil-bell' },
  { to: '/berkas', label: 'Berkas privat', detail: 'File pembelajaran yang telah dipindai', icon: 'uil-folder-open' },
] : [
  { to: '/akademik/kelas', label: 'Pelaksanaan kelas', detail: 'Presensi, jurnal, dan nilai', icon: 'uil-presentation-check' },
  { to: '/akademik/krs', label: 'KRS', detail: 'Pengisian dan persetujuan', icon: 'uil-clipboard-alt' },
  { to: '/pddikti', label: 'PDDIKTI', detail: 'Readiness dan rekonsiliasi', icon: 'uil-sync' },
  { to: '/keuangan', label: 'Keuangan', detail: 'Tagihan dan piutang', icon: 'uil-receipt' },
  { to: '/pmb', label: 'PMB', detail: 'Pendaftar dan seleksi', icon: 'uil-user-plus' },
  { to: '/tracer-study', label: 'Tracer study', detail: 'Outcome lulusan', icon: 'uil-chart-growth' },
])

async function load() {
  loading.value = true; errorMessage.value = ''
  if (isLmsMvp.value) {
    loading.value = false
    return
  }
  try {
    const { data } = await $api.get<Summary>('/dashboard/summary', { params: { periodId: filters.periodId || undefined, programStudyId: filters.programStudyId || undefined } })
    summary.value = data
  } catch (error) { errorMessage.value = errorText(error) } finally { loading.value = false }
}

async function download(format: 'csv' | 'pdf') {
  exporting.value = true; errorMessage.value = ''
  try {
    const response = await $api.get<Blob>('/dashboard/export', { params: { format, periodId: filters.periodId || undefined, programStudyId: filters.programStudyId || undefined }, responseType: 'blob' })
    const url = URL.createObjectURL(response.data); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `dashboard-${summary.value?.periodId || 'export'}.${format}`; anchor.click(); URL.revokeObjectURL(url)
  } catch (error) { errorMessage.value = errorText(error) } finally { exporting.value = false }
}

onMounted(load)
</script>

<template>
  <div class="page-stack dashboard-page" data-clarity-mask="true">
    <AppPageHeader eyebrow="Ringkasan terotorisasi" :title="`Selamat datang, ${user?.name || 'Pengguna'}`" :description="isLmsMvp ? 'Akses kelas, materi, tugas, diskusi, presensi, dan administrasi LMS sesuai role Anda.' : 'Indikator hanya menampilkan bagian yang diizinkan role dan lingkup data Anda.'">
      <template v-if="!isLmsMvp" #actions><button class="btn btn-outline-secondary" :disabled="exporting || !summary" @click="download('csv')"><i class="uil uil-file-spreadsheet me-2" />Spreadsheet</button><button class="btn btn-primary" :disabled="exporting || !summary" @click="download('pdf')"><i class="uil uil-file-graph me-2" />PDF</button></template>
    </AppPageHeader>

    <div v-if="errorMessage && !isLmsMvp" class="alert alert-danger mb-0">{{ errorMessage }}</div>
    <section v-if="!isLmsMvp" class="filter-bar"><div class="filter-context"><span><i class="uil uil-filter" /></span><div><strong>Sudut pandang laporan</strong><small>{{ summary ? `Diperbarui ${updatedLabel}` : 'Memuat snapshot…' }}</small></div></div><div class="filter-controls"><label><span>Periode stabil</span><input v-model="filters.periodId" class="form-control form-control-sm" placeholder="2025-2026-2"></label><label><span>Program studi (opsional)</span><input v-model="filters.programStudyId" class="form-control form-control-sm" placeholder="management-s1"></label><button class="btn btn-sm btn-outline-secondary" :disabled="loading" @click="load">Terapkan</button></div></section>

    <div v-if="loading && !isLmsMvp" class="loading-state"><span class="spinner-border spinner-border-sm" /> Memuat snapshot dashboard…</div>
    <template v-else-if="summary && !isLmsMvp">
      <section v-if="cards.length" class="metric-grid"><StatCard v-for="card in cards" :key="card.label" :label="card.label" :value="card.value" :detail="card.detail" :trend="summary.periodId" :tone="card.tone" /></section>
      <section v-else class="empty-dashboard"><i class="uil uil-shield-check" /><h2>Dashboard institusi dibatasi</h2><p>Role Anda tetap dapat membuka pekerjaan pribadi melalui pintasan di bawah. Ringkasan lintas mahasiswa tidak ditampilkan.</p></section>

      <section class="detail-grid">
        <article v-if="summary.sections.academic" class="surface-card"><header><span class="section-kicker">Akademik</span><h2>Realisasi perkuliahan</h2></header><div class="progress-metric"><div><span>Kehadiran rata-rata</span><strong>{{ percent(summary.sections.academic.averageAttendancePercent) }}</strong></div><div class="progress"><div class="progress-bar bg-success" :style="{ width: `${summary.sections.academic.averageAttendancePercent}%` }" /></div></div><div class="progress-metric"><div><span>Realisasi pertemuan</span><strong>{{ percent(summary.sections.academic.lecturesRealizedPercent) }}</strong></div><div class="progress"><div class="progress-bar" :style="{ width: `${summary.sections.academic.lecturesRealizedPercent}%` }" /></div></div></article>
        <article v-if="summary.sections.pddikti" class="surface-card"><header><span class="section-kicker">PDDIKTI</span><h2>Status pelaporan</h2></header><dl><div><dt>Kelengkapan</dt><dd>{{ percent(summary.sections.pddikti.completenessPercent) }}</dd></div><div><dt>Antrean</dt><dd>{{ summary.sections.pddikti.queuedRecords }}</dd></div><div><dt>Gagal</dt><dd>{{ summary.sections.pddikti.failedRecords }}</dd></div><div><dt>Sinkron terakhir</dt><dd>{{ summary.sections.pddikti.lastSuccessfulSyncAt ? new Date(summary.sections.pddikti.lastSuccessfulSyncAt).toLocaleString('id-ID') : 'Belum ada' }}</dd></div></dl></article>
        <article v-if="summary.sections.outcomes" class="surface-card"><header><span class="section-kicker">Outcome lulusan</span><h2>Tracer study</h2></header><dl><div><dt>Respons</dt><dd>{{ percent(summary.sections.outcomes.tracerResponseRatePercent) }}</dd></div><div><dt>Bekerja ≤ 6 bulan</dt><dd>{{ percent(summary.sections.outcomes.employedWithinSixMonthsPercent) }}</dd></div><div><dt>Responden</dt><dd>{{ summary.sections.outcomes.respondents }}</dd></div></dl></article>
        <article v-if="summary.sections.accreditation" class="surface-card"><header><span class="section-kicker">Monitoring administratif</span><h2>Akreditasi</h2></header><dl><div><dt>Status institusi</dt><dd>{{ summary.sections.accreditation.institutionStatus }}</dd></div><div><dt>Prodi perlu perhatian</dt><dd>{{ summary.sections.accreditation.programStudyAtRisk }}</dd></div><div><dt>Kedaluwarsa terdekat</dt><dd>{{ summary.sections.accreditation.nearestExpiryDate }}</dd></div></dl></article>
      </section>

      <section><div class="section-heading"><span class="section-kicker">Pintasan</span><h2>Lanjutkan pekerjaan utama</h2></div><div class="quick-grid"><NuxtLink v-for="item in links" :key="item.to" :to="item.to"><span><i class="uil" :class="item.icon" /></span><div><strong>{{ item.label }}</strong><small>{{ item.detail }}</small></div><i class="uil uil-angle-right-b" /></NuxtLink></div></section>
    </template>
    <section v-if="isLmsMvp"><div class="section-heading"><span class="section-kicker">Pintasan LMS</span><h2>Lanjutkan pekerjaan utama</h2></div><div class="quick-grid"><NuxtLink v-for="item in links" :key="item.to" :to="item.to"><span><i class="uil" :class="item.icon" /></span><div><strong>{{ item.label }}</strong><small>{{ item.detail }}</small></div><i class="uil uil-angle-right-b" /></NuxtLink></div></section>
  </div>
</template>

<style scoped>
.page-stack{display:grid;gap:1.35rem}.filter-bar{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.8rem 1rem;border:1px solid #e2e9e5;border-radius:.9rem;background:#fff}.filter-context,.filter-controls,.filter-controls label{display:flex;align-items:center}.filter-context{gap:.7rem}.filter-context>span{display:grid;place-items:center;width:2.2rem;height:2.2rem;border-radius:.65rem;color:#346a59;background:#edf5f0}.filter-context strong,.filter-context small,.filter-controls label>span{display:block}.filter-context strong{color:#28483f;font-size:.72rem}.filter-context small{color:#7d8b86;font-size:.58rem}.filter-controls{gap:.65rem}.filter-controls label{gap:.4rem}.filter-controls label>span{color:#71817a;font-size:.55rem;font-weight:750}.filter-controls .form-control{min-width:145px;border-color:#dce5e0;font-size:.63rem}.metric-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:.8rem}.detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1rem}.surface-card{padding:1rem;border:1px solid #e0e8e3;border-radius:.9rem;background:#fff}.surface-card header{margin-bottom:.8rem}.surface-card h2,.section-heading h2{margin:.15rem 0;color:#304f43;font-size:.8rem}.surface-card dl{display:grid;gap:.5rem;margin:0}.surface-card dl div{display:flex;justify-content:space-between;gap:1rem;padding:.45rem 0;border-top:1px solid #edf1ee}.surface-card dt,.surface-card dd{color:#788880;font-size:.6rem}.surface-card dd{margin:0;color:#35564a;font-weight:800;text-align:right}.progress-metric+.progress-metric{margin-top:.8rem}.progress-metric>div:first-child{display:flex;justify-content:space-between;margin-bottom:.35rem;color:#657970;font-size:.59rem}.progress-metric .progress{height:.38rem}.quick-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.7rem;margin-top:.7rem}.quick-grid>a{display:grid;grid-template-columns:auto 1fr auto;gap:.65rem;align-items:center;padding:.8rem;border:1px solid #e0e8e3;border-radius:.8rem;color:inherit;background:#fff;text-decoration:none}.quick-grid>a>span{display:grid;place-items:center;width:2rem;height:2rem;border-radius:.55rem;color:#3f735d;background:#edf5ef}.quick-grid strong,.quick-grid small{display:block;color:#38554a;font-size:.64rem}.quick-grid small{margin-top:.12rem;color:#84918c;font-size:.53rem}.loading-state,.empty-dashboard{display:grid;place-items:center;align-content:center;min-height:220px;border:1px solid #e0e8e3;border-radius:.9rem;color:#7c8c85;background:#fff;text-align:center}.loading-state{display:flex;gap:.5rem;font-size:.65rem}.empty-dashboard i{color:#477762;font-size:2rem}.empty-dashboard h2{margin:.5rem 0 .2rem;color:#36564a;font-size:.85rem}.empty-dashboard p{max-width:520px;color:#788982;font-size:.62rem}.section-heading{margin-bottom:.3rem}.section-kicker{color:#638275;font-size:.53rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
@media(max-width:991.98px){.filter-bar{align-items:stretch;flex-direction:column}.filter-controls{flex-wrap:wrap}.quick-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:575.98px){.filter-controls,.filter-controls label{align-items:stretch;flex-direction:column}.filter-controls .form-control{width:100%}.quick-grid{grid-template-columns:1fr}}
</style>
