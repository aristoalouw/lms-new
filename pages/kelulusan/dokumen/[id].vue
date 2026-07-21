<script setup lang="ts">
import type { GraduationRenderPayload, IssuedDocumentStatus } from '~/server/types/graduation'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Pratinjau Dokumen Kelulusan' })

interface RenderResponse {
  documentId: string
  status: IssuedDocumentStatus
  version: number
  contentHash: string
  renderPayload: GraduationRenderPayload
}

const route = useRoute()
const config = useRuntimeConfig()
const { $api } = useNuxtApp()
const loading = ref(true)
const errorMessage = ref('')
const render = ref<RenderResponse | null>(null)

const demoRender: RenderResponse = {
  documentId: 'grad-document-demo-001', status: 'ISSUED', version: 1,
  contentHash: '9f65d95517b7c960682b80bff4b31cb8f742640d959e5e18c07cb7808f173182',
  renderPayload: {
    documentType: 'DECREE', documentNumber: 'SK-YUD/MANAGEMENT-S1/2026/00001', verificationCode: '8A2F0C19B5549D1267CE',
    issuedAt: '2026-07-20T09:00:00.000Z', title: 'Keputusan Yudisium', subtitle: 'Universitas Siber Nusantara',
    subject: { studentName: 'Nabila Putri', studentNumber: '23011001', programStudyName: 'S1 Manajemen', periodName: 'Yudisium Semester Genap 2025/2026' },
    fields: [
      { key: 'student_name', label: 'Nama', value: 'Nabila Putri' },
      { key: 'student_number', label: 'Nomor Induk Mahasiswa', value: '23011001' },
      { key: 'program', label: 'Program Studi', value: 'S1 Manajemen' },
      { key: 'document_number', label: 'Nomor Dokumen', value: 'SK-YUD/MANAGEMENT-S1/2026/00001' },
      { key: 'verification', label: 'Kode Verifikasi', value: '8A2F0C19B5549D1267CE' },
    ],
    footerText: 'Dokumen elektronik diverifikasi melalui kode verifikasi resmi kampus.',
    limitation: 'DETERMINISTIC_RENDER_PAYLOAD_ONLY_NO_CREDENTIAL_PDF',
  },
}

const errorText = (error: unknown) => {
  const candidate = error as { response?: { data?: { statusMessage?: string; message?: string } }; message?: string }
  return candidate.response?.data?.statusMessage || candidate.response?.data?.message || candidate.message || 'Pratinjau tidak dapat dimuat.'
}
const dateTimeLabel = (value: string) => new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Jakarta',
}).format(new Date(value))
const printPreview = () => window.print()

const loadRender = async () => {
  loading.value = true
  errorMessage.value = ''
  try {
    if (config.public.demoMode) {
      render.value = demoRender
      return
    }
    const id = encodeURIComponent(String(route.params.id))
    const { data } = await $api.get<RenderResponse>(`/graduation/documents/${id}/render`)
    render.value = data
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    loading.value = false
  }
}

onMounted(loadRender)
</script>

<template>
  <div class="print-workspace">
    <header class="preview-toolbar">
      <div><span class="section-kicker">Payload render deterministik</span><h1>Pratinjau dokumen kelulusan</h1><p>Periksa nomor, data subjek, hash, dan kode verifikasi sebelum mencetak tampilan.</p></div>
      <div class="d-flex flex-wrap gap-2"><NuxtLink class="btn btn-outline-secondary" to="/kelulusan"><i class="uil uil-arrow-left me-2" />Kembali</NuxtLink><button class="btn btn-primary" type="button" :disabled="!render" @click="printPreview"><i class="uil uil-print me-2" />Cetak tampilan</button></div>
    </header>

    <div v-if="loading" class="preview-loading"><span class="spinner-border spinner-border-sm" /><span>Menyiapkan pratinjau...</span></div>
    <div v-else-if="errorMessage" class="alert alert-danger" role="alert">{{ errorMessage }}</div>
    <template v-else-if="render">
      <div class="limitation-banner"><i class="uil uil-info-circle" /><div><strong>Ini bukan berkas PDF kredensial</strong><p>Sistem fase ini hanya menyediakan payload render deterministik dan tampilan cetak. Tidak ada PDF resmi, tanda tangan digital PDF, atau URL unduhan kredensial yang dihasilkan.</p></div></div>

      <article class="credential-sheet" :class="{ revoked: render.status === 'REVOKED' }">
        <span v-if="render.status === 'REVOKED'" class="revoked-watermark">DICABUT</span>
        <header class="credential-head">
          <div class="campus-mark">N</div>
          <div><span>UNIVERSITAS SIBER NUSANTARA</span><small>Akademik · Integritas · Akuntabilitas</small></div>
        </header>
        <div class="credential-title">
          <small>{{ render.renderPayload.documentType }}</small>
          <h2>{{ render.renderPayload.title }}</h2>
          <p v-if="render.renderPayload.subtitle">{{ render.renderPayload.subtitle }}</p>
          <span>{{ render.renderPayload.documentNumber }}</span>
        </div>
        <div class="credential-subject"><p>Dokumen ini menerangkan bahwa</p><h3>{{ render.renderPayload.subject.studentName }}</h3><strong>{{ render.renderPayload.subject.studentNumber }}</strong><p>{{ render.renderPayload.subject.programStudyName }} · {{ render.renderPayload.subject.periodName }}</p></div>
        <dl class="credential-fields"><div v-for="field in render.renderPayload.fields" :key="field.key"><dt>{{ field.label }}</dt><dd>{{ field.value }}</dd></div></dl>
        <footer class="credential-footer">
          <div><span>Diterbitkan</span><strong>{{ dateTimeLabel(render.renderPayload.issuedAt) }}</strong><small>{{ render.renderPayload.footerText }}</small></div>
          <div class="verification-box"><span>Kode verifikasi</span><strong>{{ render.renderPayload.verificationCode }}</strong><small>Status: {{ render.status }} · versi {{ render.version }}</small></div>
        </footer>
      </article>

      <section class="integrity-panel">
        <div><span class="section-kicker">Sidik konten SHA-256</span><code>{{ render.contentHash }}</code></div>
        <div><span class="section-kicker">ID snapshot terbit</span><code>{{ render.documentId }}</code></div>
        <p>Hash dihitung dari snapshot template dan payload render yang disimpan saat penerbitan. Perubahan template aktif berikutnya tidak mengubah versi dokumen ini.</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.print-workspace{display:grid;gap:1rem;max-width:1060px;margin:0 auto}.preview-toolbar{display:flex;align-items:center;justify-content:space-between;gap:1.5rem}.preview-toolbar h1{margin:.15rem 0 .25rem;color:#294d40;font-size:1.2rem}.preview-toolbar p{margin:0;color:#778a82;font-size:.66rem}.preview-loading{display:flex;justify-content:center;gap:.6rem;padding:4rem;color:#74877f;font-size:.7rem}.limitation-banner{display:flex;gap:.7rem;padding:.8rem .9rem;border:1px solid #d9e6f0;border-radius:.75rem;color:#315d78;background:#f1f7fb}.limitation-banner i{font-size:1.15rem}.limitation-banner strong{display:block;font-size:.66rem}.limitation-banner p{margin:.15rem 0 0;color:#6c8594;font-size:.58rem}.credential-sheet{position:relative;min-height:760px;overflow:hidden;padding:3.2rem 4.2rem;border:1px solid #d9e2dd;color:#223b32;background:#fff;box-shadow:0 20px 55px rgba(28,58,47,.1)}.credential-sheet:before{position:absolute;inset:1rem;border:1px solid #b89d5f;content:'';pointer-events:none}.credential-sheet:after{position:absolute;inset:1.35rem;border:1px solid #e2d6b9;content:'';pointer-events:none}.credential-sheet.revoked{filter:grayscale(.25)}.revoked-watermark{position:absolute;z-index:3;top:43%;left:50%;color:rgba(154,34,34,.18);font-size:6rem;font-weight:900;letter-spacing:.12em;transform:translate(-50%,-50%) rotate(-24deg)}.credential-head{position:relative;z-index:2;display:flex;align-items:center;justify-content:center;gap:.8rem;padding-bottom:1.25rem;border-bottom:2px solid #2d604e;text-align:left}.campus-mark{display:grid;place-items:center;width:3.2rem;height:3.2rem;border-radius:50%;color:#f6f0df;background:#214e3e;font-family:Georgia,serif;font-size:1.55rem;font-weight:700}.credential-head span,.credential-head small{display:block}.credential-head span{color:#214e3e;font-family:Georgia,serif;font-size:1.05rem;font-weight:700;letter-spacing:.08em}.credential-head small{margin-top:.15rem;color:#8a7952;font-size:.56rem;letter-spacing:.12em;text-transform:uppercase}.credential-title{position:relative;z-index:2;margin:2.4rem 0 1.7rem;text-align:center}.credential-title small{color:#987d3f;font-size:.56rem;font-weight:750;letter-spacing:.16em}.credential-title h2{margin:.4rem 0 .25rem;color:#204c3c;font-family:Georgia,serif;font-size:1.8rem}.credential-title p{margin:0;color:#6c7e76;font-size:.68rem}.credential-title>span{display:inline-block;margin-top:.75rem;padding:.35rem .75rem;border-top:1px solid #ccb778;border-bottom:1px solid #ccb778;color:#4c5f57;font-size:.62rem;font-weight:700}.credential-subject{position:relative;z-index:2;text-align:center}.credential-subject p{margin:.25rem 0;color:#75877f;font-family:Georgia,serif;font-size:.73rem}.credential-subject h3{margin:.45rem 0 .15rem;color:#1f493a;font-family:Georgia,serif;font-size:1.45rem}.credential-subject strong{color:#92783c;font-size:.68rem;letter-spacing:.1em}.credential-fields{position:relative;z-index:2;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.2rem 1.5rem;max-width:720px;margin:2rem auto}.credential-fields div{display:grid;grid-template-columns:minmax(120px,.8fr) minmax(0,1.2fr);gap:.6rem;padding:.55rem 0;border-bottom:1px dotted #cbd6d1}.credential-fields dt{color:#7d8d86;font-size:.59rem}.credential-fields dd{margin:0;color:#304f44;font-size:.63rem;font-weight:700}.credential-footer{position:relative;z-index:2;display:flex;align-items:flex-end;justify-content:space-between;gap:2rem;margin-top:3rem;padding-top:1rem;border-top:1px solid #d7dfdb}.credential-footer span,.credential-footer strong,.credential-footer small{display:block}.credential-footer span{color:#88968f;font-size:.54rem;text-transform:uppercase;letter-spacing:.07em}.credential-footer strong{margin:.18rem 0;color:#36564b;font-size:.63rem}.credential-footer small{max-width:440px;color:#84928c;font-size:.52rem}.verification-box{min-width:220px;padding:.75rem;border:1px solid #d9e4df;background:#f6f9f7}.verification-box strong{color:#1e5f46;font-family:monospace;font-size:.75rem;letter-spacing:.06em}.integrity-panel{display:grid;grid-template-columns:1.4fr .8fr;gap:.75rem;padding:.9rem;border:1px solid #dfe8e4;border-radius:.8rem;background:#fff}.integrity-panel div{min-width:0}.integrity-panel span,.integrity-panel code{display:block}.integrity-panel code{overflow-wrap:anywhere;margin-top:.25rem;color:#526a60;font-size:.57rem}.integrity-panel p{grid-column:1/-1;margin:0;padding-top:.65rem;border-top:1px solid #e6ece9;color:#7a8c84;font-size:.56rem}
@media(max-width:767.98px){.preview-toolbar{align-items:flex-start;flex-direction:column}.credential-sheet{min-height:0;padding:2.4rem 2rem}.credential-head span{font-size:.82rem}.credential-title h2{font-size:1.35rem}.credential-fields{grid-template-columns:1fr}.credential-footer{align-items:stretch;flex-direction:column}.integrity-panel{grid-template-columns:1fr}}
@media print{@page{size:A4 portrait;margin:10mm}:global(.app-sidebar),:global(.app-topbar),:global(.privacy-consent),.preview-toolbar,.limitation-banner,.integrity-panel{display:none!important}:global(.app-shell__main){margin-left:0!important}:global(.app-content){padding:0!important;background:#fff!important}.print-workspace{display:block;max-width:none}.credential-sheet{min-height:270mm;padding:25mm 24mm;border:0;box-shadow:none;break-inside:avoid}.credential-sheet:before{inset:2mm}.credential-sheet:after{inset:3mm}}
</style>
