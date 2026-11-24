<script setup lang="ts">
import type { AdmissionApplicationView, AdmissionStatus } from '~/server/types/admissions'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Status Pendaftaran PMB' })

const { $api } = useNuxtApp()
const applications = ref<AdmissionApplicationView[]>([])
const registrationNumber = ref('')
const loading = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')
const statusLabels: Record<AdmissionStatus, string> = {
  SUBMITTED: 'Pendaftaran diterima', UNDER_REVIEW: 'Sedang ditinjau', DOCUMENTS_VERIFIED: 'Dokumen terverifikasi',
  ACCEPTED: 'Diterima', REJECTED: 'Tidak diterima', ENROLLMENT_PENDING_IDENTITY: 'Aktivasi akun mahasiswa', ENROLLED: 'Mahasiswa aktif',
}
const statusTones: Record<AdmissionStatus, string> = {
  SUBMITTED: 'pending', UNDER_REVIEW: 'review', DOCUMENTS_VERIFIED: 'verified', ACCEPTED: 'active',
  REJECTED: 'blocked', ENROLLMENT_PENDING_IDENTITY: 'review', ENROLLED: 'verified',
}
const errorText = (error: unknown) => {
  const candidate = error as { response?: { data?: { statusMessage?: string; message?: string } }; message?: string }
  return candidate.response?.data?.statusMessage || candidate.response?.data?.message || candidate.message || 'Permintaan tidak dapat diselesaikan.'
}
const load = async () => {
  loading.value = true
  errorMessage.value = ''
  try {
    const { data } = await $api.get<{ items: AdmissionApplicationView[] }>('/admissions/applications/me')
    applications.value = data.items
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    loading.value = false
  }
}
const claim = async () => {
  if (!registrationNumber.value.trim()) return
  loading.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    await $api.post('/admissions/applications/claim', { registrationNumber: registrationNumber.value.trim().toUpperCase() })
    registrationNumber.value = ''
    noticeMessage.value = 'Nomor pendaftaran berhasil ditautkan ke akun ini.'
    await load()
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>

<template>
  <div class="page-stack" data-clarity-mask="true">
    <AppPageHeader eyebrow="Portal pendaftar" title="Status pendaftaran" description="Pantau status pendaftaran, hasil verifikasi berkas, dan tahap seleksi Anda." status="active" status-label="Data privat">
      <template #actions><NuxtLink class="btn btn-outline-secondary" to="/berkas"><i class="uil uil-folder-lock me-2" />Dokumen saya</NuxtLink><button class="btn btn-primary" type="button" :disabled="loading" @click="load"><i class="uil uil-refresh me-2" />Muat ulang</button></template>
    </AppPageHeader>
    <div v-if="noticeMessage" class="alert alert-success mb-0" role="status">{{ noticeMessage }}</div>
    <div v-if="errorMessage" class="alert alert-danger mb-0" role="alert">{{ errorMessage }}</div>

    <section class="workflow-surface">
      <header class="workflow-surface__header"><div><span class="section-kicker">Tautkan pendaftaran</span><h2>Sudah mendaftar sebelum akun aktif?</h2><p>Masukkan nomor PMB. Server hanya menautkan data bila email akun sama dengan email formulir.</p></div></header>
      <form class="workflow-surface__body claim-form" @submit.prevent="claim"><label class="form-label"><span>Nomor pendaftaran</span><input v-model.trim="registrationNumber" class="form-control" maxlength="40" placeholder="PMB-2026-XXXXXX" required></label><button class="btn btn-primary" type="submit" :disabled="loading || !registrationNumber">Tautkan</button></form>
    </section>

    <section class="application-grid" aria-live="polite">
      <article v-for="application in applications" :key="application.id" class="workflow-surface">
        <header class="workflow-surface__header"><div><span class="section-kicker">{{ application.registrationNumber }}</span><h2>{{ application.fullName }}</h2><p>{{ application.programStudyId }} · {{ application.academicYear }}</p></div><StatusBadge :status="statusTones[application.status]" :label="statusLabels[application.status]" /></header>
        <div class="workflow-surface__body"><dl class="status-details"><div><dt>Status berkas</dt><dd>{{ statusLabels[application.status] }}</dd></div><div><dt>Biaya pendaftaran</dt><dd>{{ application.registrationFeeStatus }}</dd></div><div><dt>Jalur / sistem</dt><dd>{{ application.admissionPathId }} · {{ application.studyModeId }}</dd></div><div><dt>NIM</dt><dd>{{ application.studentNumber || 'Belum dialokasikan' }}</dd></div><div><dt>Diperbarui</dt><dd>{{ new Date(application.updatedAt).toLocaleString('id-ID') }}</dd></div><div><dt>Catatan panitia</dt><dd>{{ application.reviewNotes || 'Belum ada catatan.' }}</dd></div></dl></div>
      </article>
      <div v-if="!loading && !applications.length" class="workflow-surface empty-state"><i class="uil uil-file-search-alt" /><h2>Belum ada pendaftaran tertaut</h2><p>Masukkan nomor pendaftaran di atas. Informasi tidak akan ditampilkan bila email tidak cocok.</p></div>
    </section>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.claim-form { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: .75rem; align-items: end; }.form-label { display: grid; gap: .35rem; margin: 0; }.form-label span { color: #6e8179; font-size: .65rem; }.application-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 1rem; }.status-details { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: .85rem; margin: 0; }.status-details div { padding-bottom: .65rem; border-bottom: 1px solid #e7ece9; }.status-details dt { color: #81918b; font-size: .6rem; }.status-details dd { margin: .2rem 0 0; color: #29483e; font-size: .72rem; font-weight: 750; overflow-wrap: anywhere; }.empty-state { grid-column: 1/-1; padding: 3rem; text-align: center; }.empty-state i { color: #39725f; font-size: 2rem; }.empty-state h2 { margin: .7rem 0 .35rem; font-size: 1rem; }.empty-state p { margin: 0; color: #7a8b84; font-size: .7rem; }
@media (max-width: 767.98px) { .application-grid,.status-details { grid-template-columns: 1fr; }.claim-form { grid-template-columns: 1fr; } }
</style>
