<script setup lang="ts">
import { pmbApplicants, pmbFunnel, pmbStats, pmbWaves } from '~/data/workflows'
import type { Tone } from '~/data/dashboard'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Penerimaan Mahasiswa Baru' })

const selectedWave = ref('Gelombang 3')
const selectedProgram = ref('Semua program studi')
const selectedApplicantId = ref(pmbApplicants[0]?.id ?? '')

const applicantColumns = [
  { key: 'id', label: 'Nomor pendaftaran', sortable: true },
  { key: 'name', label: 'Calon mahasiswa', sortable: true },
  { key: 'program', label: 'Pilihan program studi', sortable: true },
  { key: 'path', label: 'Jalur' },
  { key: 'submitted', label: 'Dikirim' },
  { key: 'completeness', label: 'Kelengkapan', align: 'end' as const },
  { key: 'status', label: 'Status' },
]

const filteredApplicants = computed(() => pmbApplicants.filter((applicant) => (
  selectedProgram.value === 'Semua program studi' || applicant.program === selectedProgram.value
)))

const selectedApplicant = computed(() => pmbApplicants.find(item => item.id === selectedApplicantId.value) ?? pmbApplicants[0])

const statTone = (tone: Tone): 'forest' | 'amber' | 'blue' | 'coral' | 'slate' => ({
  primary: 'forest', success: 'forest', warning: 'amber', danger: 'coral', info: 'blue', neutral: 'slate',
})[tone] as 'forest' | 'amber' | 'blue' | 'coral' | 'slate'

const badgeStatus = (status: string) => {
  if (['Terverifikasi', 'Lulus seleksi', 'Selesai'].includes(status)) return 'verified'
  if (['Berkas kurang'].includes(status)) return 'blocked'
  if (['Siap verifikasi', 'Perlu tinjau'].includes(status)) return 'review'
  return 'pending'
}
</script>

<template>
  <div class="page-stack">
    <AppPageHeader
      eyebrow="Akuisisi mahasiswa"
      title="Penerimaan Mahasiswa Baru"
      description="Pantau funnel pendaftaran, verifikasi berkas, hasil seleksi, dan proses daftar ulang tahun akademik 2026/2027."
      status="active"
      status-label="Gelombang 3 aktif"
    >
      <template #actions>
        <NuxtLink class="btn btn-outline-secondary" to="/pmb/status"><i class="uil uil-search me-2" aria-hidden="true" />Status saya</NuxtLink>
        <NuxtLink class="btn btn-outline-secondary" to="/pmb/dokumen"><i class="uil uil-file-check-alt me-2" aria-hidden="true" />Dokumen saya</NuxtLink>
        <NuxtLink class="btn btn-outline-primary" to="/pmb/seleksi"><i class="uil uil-calendar-alt me-2" aria-hidden="true" />Seleksi & LoA</NuxtLink>
        <NuxtLink class="btn btn-primary" to="/pmb/kelola"><i class="uil uil-user-check me-2" aria-hidden="true" />Kelola workflow</NuxtLink>
      </template>
    </AppPageHeader>

    <section class="workflow-toolbar" aria-label="Filter PMB">
      <div class="workflow-toolbar__meta">
        <i class="uil uil-graduation-cap" aria-hidden="true" />
        <div><strong>PMB Tahun Akademik 2026/2027</strong><small>Data diperbarui 21 Juli 2026, 10.18 WIB</small></div>
      </div>
      <div class="workflow-toolbar__filters">
        <label><span>Gelombang</span>
          <select v-model="selectedWave" class="form-select form-select-sm">
            <option v-for="wave in pmbWaves" :key="wave.wave">{{ wave.wave }}</option>
          </select>
        </label>
        <label><span>Program studi</span>
          <select v-model="selectedProgram" class="form-select form-select-sm">
            <option>Semua program studi</option><option>S1 Manajemen</option><option>S1 Akuntansi</option><option>S1 Informatika</option><option>S1 Sistem Informasi</option><option>S1 Ilmu Komunikasi</option>
          </select>
        </label>
      </div>
    </section>

    <section class="row g-3" aria-label="Ringkasan PMB">
      <div v-for="stat in pmbStats" :key="stat.label" class="col-sm-6 col-xl-3">
        <StatCard :label="stat.label" :value="stat.value" :detail="stat.detail" :trend="stat.trend" :tone="statTone(stat.tone)" />
      </div>
    </section>

    <section class="context-banner">
      <div class="context-banner__copy">
        <span class="context-banner__icon"><i class="uil uil-calendar-alt" aria-hidden="true" /></span>
        <div>
          <span class="section-kicker">Periode berjalan</span>
          <h2>{{ selectedWave }} ditutup pada 31 Agustus 2026</h2>
          <p>158 pendaftar masuk, 43 berkas menunggu verifikasi, dan 56 calon mahasiswa sudah lulus seleksi.</p>
        </div>
      </div>
      <div class="context-banner__aside">
        <strong>41 hari</strong><small>menuju penutupan gelombang</small>
      </div>
    </section>

    <section class="row g-4">
      <div class="col-12 col-xl-7">
        <article class="workflow-surface h-100">
          <header class="workflow-surface__header workflow-surface__header--plain">
            <div><span class="section-kicker">Konversi PMB</span><h2>Funnel pendaftaran</h2><p>Perjalanan calon mahasiswa sejak membuat akun hingga daftar ulang.</p></div>
            <button class="compact-link" type="button">Lihat laporan <i class="uil uil-arrow-up-right" aria-hidden="true" /></button>
          </header>
          <div class="workflow-surface__body">
            <div class="funnel-stack">
              <div v-for="step in pmbFunnel" :key="step.label" class="funnel-step">
                <div class="funnel-step__label"><span>{{ step.label }}</span><strong>{{ step.value }}</strong></div>
                <div class="funnel-step__bar" aria-hidden="true"><span :style="{ width: `${step.percent}%` }" /></div>
                <small>{{ step.percent }}%</small>
              </div>
            </div>
            <div class="note-box mt-4">
              <i class="uil uil-chart-growth" aria-hidden="true" />
              <p><strong>Konversi daftar ulang naik 3,2%</strong> dibanding periode yang sama tahun lalu. Penurunan terbesar masih terjadi pada tahap kelengkapan berkas.</p>
            </div>
          </div>
        </article>
      </div>

      <div class="col-12 col-xl-5">
        <article class="workflow-surface h-100">
          <header class="workflow-surface__header workflow-surface__header--plain">
            <div><span class="section-kicker">Periode penerimaan</span><h2>Kinerja per gelombang</h2><p>Ringkasan pendaftar dan kelulusan yang sudah ditetapkan.</p></div>
          </header>
          <div class="workflow-surface__body pt-2">
            <div class="wave-list">
              <button v-for="wave in pmbWaves" :key="wave.wave" type="button" :class="{ active: wave.wave === selectedWave }" @click="selectedWave = wave.wave">
                <span class="wave-list__marker" aria-hidden="true" />
                <span><strong>{{ wave.wave }}</strong><small>{{ wave.period }}</small></span>
                <span><strong>{{ wave.applicants }}</strong><small>pendaftar</small></span>
                <StatusBadge :status="wave.status === 'Aktif' ? 'active' : 'verified'" :label="wave.status" />
              </button>
            </div>
            <div class="mini-summary-grid mt-3">
              <div class="mini-summary"><span>Rasio kelulusan</span><strong>55,8%</strong><small>406 dari 728 pendaftar</small></div>
              <div class="mini-summary"><span>Daftar ulang</span><strong>78,3%</strong><small>318 dari 406 lulus</small></div>
            </div>
          </div>
        </article>
      </div>
    </section>

    <section class="row g-4 align-items-stretch">
      <div class="col-12 col-xl-9">
        <article class="workflow-surface h-100">
          <header class="workflow-surface__header">
            <div><span class="section-kicker">Antrean verifikasi</span><h2>Pendaftar terbaru</h2><p>Pilih nomor pendaftaran untuk melihat ringkasan berkas di panel sebelah.</p></div>
            <button class="btn btn-sm btn-outline-secondary" type="button"><i class="uil uil-filter me-1" aria-hidden="true" />Filter lanjutan</button>
          </header>
          <DataTable
            :columns="applicantColumns"
            :rows="filteredApplicants"
            :page-size="6"
            search-placeholder="Cari nama atau nomor pendaftaran…"
            empty-title="Tidak ada pendaftar"
            empty-description="Tidak ada pendaftar yang cocok dengan filter saat ini."
          >
            <template #cell-id="{ value }">
              <button class="table-id-button" type="button" @click="selectedApplicantId = String(value)">{{ value }}</button>
            </template>
            <template #cell-status="{ value }">
              <StatusBadge :status="badgeStatus(String(value))" :label="String(value)" />
            </template>
          </DataTable>
        </article>
      </div>

      <div class="col-12 col-xl-3">
        <aside v-if="selectedApplicant" class="workflow-surface applicant-panel h-100" aria-label="Ringkasan pendaftar terpilih">
          <div class="applicant-panel__hero">
            <span class="applicant-avatar" aria-hidden="true">{{ selectedApplicant.name.split(' ').map(part => part[0]).slice(0, 2).join('') }}</span>
            <h2>{{ selectedApplicant.name }}</h2>
            <p>{{ selectedApplicant.id }}</p>
            <StatusBadge :status="badgeStatus(selectedApplicant.status)" :label="selectedApplicant.status" />
          </div>
          <div class="workflow-surface__body pt-3">
            <dl class="detail-list">
              <div><dt>Program studi</dt><dd>{{ selectedApplicant.program }}</dd></div>
              <div><dt>Jalur masuk</dt><dd>{{ selectedApplicant.path }}</dd></div>
              <div><dt>Kelengkapan</dt><dd>{{ selectedApplicant.completeness }}</dd></div>
              <div><dt>Dikirim</dt><dd>{{ selectedApplicant.submitted.split(',')[0] }}</dd></div>
            </dl>
            <div class="progress-block mt-3">
              <div class="progress-block__heading"><span>Kelengkapan berkas</span><strong>{{ selectedApplicant.completeness }}</strong></div>
              <div class="progress"><div class="progress-bar" :style="{ width: selectedApplicant.completeness }" /></div>
            </div>
            <button class="btn btn-primary w-100 mt-4" type="button">Tinjau pendaftar</button>
            <button class="btn btn-link compact-link w-100 justify-content-center mt-2" type="button">Buka riwayat</button>
          </div>
        </aside>
      </div>
    </section>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.wave-list { display: grid; gap: .55rem; }
.wave-list button { display: grid; grid-template-columns: .55rem minmax(120px, 1fr) auto auto; gap: .65rem; align-items: center; width: 100%; padding: .75rem; border: 1px solid #e5ebe7; border-radius: .8rem; background: #fff; text-align: left; }
.wave-list button:hover,
.wave-list button.active { border-color: #8eaf9f; background: #f5f9f6; }
.wave-list__marker { width: .45rem; height: .45rem; border-radius: 50%; background: #aebbb6; }
.wave-list button.active .wave-list__marker { background: #3b7b64; box-shadow: 0 0 0 .25rem #e2f0e8; }
.wave-list strong,
.wave-list small { display: block; }
.wave-list strong { color: #2e4b42; font-size: .72rem; }
.wave-list small { margin-top: .16rem; color: #8b9893; font-size: .62rem; }
.table-id-button { padding: 0; border: 0; color: #2f6e58; background: transparent; font-size: inherit; font-weight: 800; text-decoration: underline; text-decoration-color: #b8d0c4; text-underline-offset: .2rem; }
.applicant-panel__hero { display: grid; justify-items: center; padding: 1.4rem 1rem 1.2rem; border-bottom: 1px solid #e9efeb; text-align: center; background: linear-gradient(180deg, #edf5ef, #fff); }
.applicant-avatar { display: grid; place-items: center; width: 3.2rem; height: 3.2rem; border: 3px solid #fff; border-radius: 50%; color: #285d4a; background: #cee5d4; font-size: .9rem; font-weight: 800; box-shadow: 0 5px 16px rgba(35,76,60,.12); }
.applicant-panel__hero h2 { margin: .8rem 0 .18rem; color: #29473e; font-size: .88rem; }
.applicant-panel__hero p { margin: 0 0 .55rem; color: #87948f; font-size: .67rem; }
@media (max-width: 575px) { .wave-list button { grid-template-columns: .55rem 1fr auto; } .wave-list button > :nth-child(3) { display: none; } }
</style>
