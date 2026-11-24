<script setup lang="ts">
import type { ServiceTicket, TicketCategory, TicketPriority } from '~/server/types/communications'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Pusat Layanan' })

const config = useRuntimeConfig()
const { $api } = useNuxtApp()
const loading = ref(false)
const submitting = ref(false)
const errorMessage = ref('')
const statusFilter = ref('ALL')
const categoryFilter = ref('ALL')
const showCreate = ref(false)
const form = reactive({ category: 'ACADEMIC' as TicketCategory, priority: 'NORMAL' as TicketPriority, subject: '', message: '' })

const demoTickets: ServiceTicket[] = [
  { id: 'ticket-demo-001', ticketNumber: 'LYN-202607-1042', requesterId: 'student-001', requesterName: 'Nabila Putri', programStudyId: 'management-s1', category: 'ACADEMIC', priority: 'NORMAL', subject: 'Permohonan koreksi data KHS semester ganjil', status: 'IN_REVIEW', assignedUnit: 'Biro Akademik', slaHours: 24, dueAt: '2026-07-22T03:15:00.000Z', createdAt: '2026-07-21T03:15:00.000Z', updatedAt: '2026-07-21T04:10:00.000Z', version: 2, messageCount: 2 },
  { id: 'ticket-demo-002', ticketNumber: 'LYN-202607-0988', requesterId: 'student-001', requesterName: 'Nabila Putri', programStudyId: 'management-s1', category: 'FINANCE', priority: 'HIGH', subject: 'Pembayaran virtual account belum terverifikasi', status: 'RESOLVED', assignedUnit: 'Biro Keuangan', slaHours: 8, dueAt: '2026-07-19T10:20:00.000Z', createdAt: '2026-07-19T02:20:00.000Z', updatedAt: '2026-07-19T06:45:00.000Z', resolvedAt: '2026-07-19T06:45:00.000Z', version: 3, messageCount: 2 },
  { id: 'ticket-demo-003', ticketNumber: 'LYN-202607-0914', requesterId: 'student-001', requesterName: 'Nabila Putri', programStudyId: 'management-s1', category: 'STUDENT_AFFAIRS', priority: 'LOW', subject: 'Surat keterangan mahasiswa aktif', status: 'CLOSED', assignedUnit: 'Biro Kemahasiswaan', slaHours: 48, dueAt: '2026-07-18T09:00:00.000Z', createdAt: '2026-07-16T09:00:00.000Z', updatedAt: '2026-07-17T07:30:00.000Z', closedAt: '2026-07-17T07:30:00.000Z', version: 4, messageCount: 3 },
]
const tickets = ref<ServiceTicket[]>(config.public.demoMode ? demoTickets : [])

const categories: Array<{ value: TicketCategory; label: string; icon: string }> = [
  { value: 'ACADEMIC', label: 'Akademik', icon: 'uil-graduation-cap' },
  { value: 'FINANCE', label: 'Keuangan', icon: 'uil-wallet' },
  { value: 'STUDENT_AFFAIRS', label: 'Kemahasiswaan', icon: 'uil-users-alt' },
  { value: 'ADMISSIONS', label: 'Penerimaan', icon: 'uil-user-plus' },
  { value: 'GENERAL', label: 'Layanan umum', icon: 'uil-building' },
]

const filteredTickets = computed(() => tickets.value.filter(ticket =>
  (statusFilter.value === 'ALL' || ticket.status === statusFilter.value)
  && (categoryFilter.value === 'ALL' || ticket.category === categoryFilter.value),
))
const openCount = computed(() => tickets.value.filter(ticket => !['CLOSED', 'CANCELLED', 'RESOLVED'].includes(ticket.status)).length)
const waitingCount = computed(() => tickets.value.filter(ticket => ticket.status === 'WAITING_FOR_REQUESTER').length)
const resolvedCount = computed(() => tickets.value.filter(ticket => ['RESOLVED', 'CLOSED'].includes(ticket.status)).length)

const categoryLabel = (value: TicketCategory) => categories.find(category => category.value === value)?.label ?? value
const statusLabel = (value: ServiceTicket['status']) => ({ OPEN: 'Baru', IN_REVIEW: 'Sedang ditinjau', WAITING_FOR_REQUESTER: 'Menunggu jawaban Anda', RESOLVED: 'Selesai', CLOSED: 'Ditutup', CANCELLED: 'Dibatalkan' })[value]
const statusTone = (value: ServiceTicket['status']) => ({ OPEN: 'pending', IN_REVIEW: 'processing', WAITING_FOR_REQUESTER: 'review', RESOLVED: 'success', CLOSED: 'inactive', CANCELLED: 'blocked' })[value]
const dateLabel = (value: string) => new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(value))

const loadTickets = async () => {
  if (config.public.demoMode) return
  loading.value = true
  errorMessage.value = ''
  try {
    const { data } = await $api.get<{ tickets: ServiceTicket[] }>('/tickets')
    tickets.value = data.tickets
  } catch {
    errorMessage.value = 'Daftar tiket belum dapat dimuat. Silakan coba kembali.'
  } finally {
    loading.value = false
  }
}

const submitTicket = async () => {
  if (!form.subject.trim() || !form.message.trim()) return
  submitting.value = true
  errorMessage.value = ''
  try {
    if (config.public.demoMode) {
      const now = new Date().toISOString()
      tickets.value.unshift({ id: `demo-${Date.now()}`, ticketNumber: `LYN-DEMO-${String(tickets.value.length + 1).padStart(3, '0')}`, requesterId: 'usr-demo-admin', requesterName: 'Alya Prameswari', programStudyId: 'management-s1', category: form.category, priority: form.priority, subject: form.subject.trim(), status: 'OPEN', assignedUnit: categories.find(item => item.value === form.category)?.label ?? 'Pusat Layanan', slaHours: form.priority === 'HIGH' ? 8 : 24, dueAt: new Date(Date.now() + (form.priority === 'HIGH' ? 8 : 24) * 3_600_000).toISOString(), createdAt: now, updatedAt: now, version: 1, messageCount: 1 })
    } else {
      const { data } = await $api.post<{ ticket: ServiceTicket }>('/tickets', { ...form, attachments: [] })
      tickets.value.unshift(data.ticket)
    }
    Object.assign(form, { category: 'ACADEMIC', priority: 'NORMAL', subject: '', message: '' })
    showCreate.value = false
  } catch {
    errorMessage.value = 'Tiket belum berhasil dikirim. Periksa isian dan coba kembali.'
  } finally {
    submitting.value = false
  }
}

onMounted(loadTickets)
</script>

<template>
  <div class="page-stack service-page">
    <AppPageHeader eyebrow="Tata usaha digital" title="Pusat Layanan Kampus" description="Ajukan kebutuhan administrasi, pantau SLA, dan lanjutkan percakapan dengan unit terkait dalam satu tempat.">
      <template #actions><button class="btn btn-primary" type="button" @click="showCreate = true"><i class="uil uil-plus me-2" />Buat tiket</button></template>
    </AppPageHeader>

    <div v-if="errorMessage" class="alert alert-warning d-flex align-items-center gap-2" role="alert"><i class="uil uil-exclamation-triangle" /><span>{{ errorMessage }}</span><button class="btn btn-sm btn-link ms-auto" type="button" @click="loadTickets">Coba lagi</button></div>

    <section class="service-hero">
      <div><span class="section-kicker">Layanan terpadu</span><h2>Bantuan administratif yang dapat dilacak</h2><p>Setiap permintaan memiliki nomor referensi, unit penanggung jawab, dan target penyelesaian yang jelas.</p></div>
      <div class="service-hero__metrics">
        <div><strong>{{ openCount }}</strong><span>Aktif</span></div><div><strong>{{ waitingCount }}</strong><span>Perlu jawaban</span></div><div><strong>{{ resolvedCount }}</strong><span>Selesai</span></div>
      </div>
    </section>

    <section class="service-layout">
      <aside class="service-guide">
        <span class="section-kicker">Jenis layanan</span><h2>Pilih jalur yang tepat</h2>
        <button v-for="category in categories" :key="category.value" type="button" :class="{ active: categoryFilter === category.value }" @click="categoryFilter = categoryFilter === category.value ? 'ALL' : category.value"><i class="uil" :class="category.icon" /><span>{{ category.label }}</span><i class="uil uil-angle-right ms-auto" /></button>
        <div class="service-guide__note"><i class="uil uil-shield-check" /><div><strong>Lampiran tetap privat</strong><p>Dokumen hanya direferensikan dari penyimpanan privat dan tidak pernah dikirim sebagai URL publik.</p></div></div>
      </aside>

      <div class="ticket-workspace">
        <header class="ticket-toolbar">
          <div><span class="section-kicker">Permintaan Anda</span><h2>Riwayat tiket layanan</h2></div>
          <label><span class="visually-hidden">Filter status</span><select v-model="statusFilter" class="form-select form-select-sm"><option value="ALL">Semua status</option><option value="OPEN">Baru</option><option value="IN_REVIEW">Ditinjau</option><option value="WAITING_FOR_REQUESTER">Perlu jawaban</option><option value="RESOLVED">Selesai</option><option value="CLOSED">Ditutup</option></select></label>
        </header>
        <div v-if="loading" class="ticket-loading"><span class="spinner-border spinner-border-sm" /><span>Memuat tiket...</span></div>
        <div v-else-if="filteredTickets.length" class="ticket-list">
          <NuxtLink v-for="ticket in filteredTickets" :key="ticket.id" :to="`/layanan/${ticket.id}`" class="ticket-card">
            <div class="ticket-card__icon"><i class="uil" :class="categories.find(item => item.value === ticket.category)?.icon" /></div>
            <div class="ticket-card__body"><div class="ticket-card__meta"><span>{{ ticket.ticketNumber }}</span><span>{{ categoryLabel(ticket.category) }}</span><span>Diperbarui {{ dateLabel(ticket.updatedAt) }}</span></div><h3>{{ ticket.subject }}</h3><p>{{ ticket.assignedUnit }} - {{ ticket.messageCount }} pesan</p></div>
            <div class="ticket-card__state"><StatusBadge :status="statusTone(ticket.status)" :label="statusLabel(ticket.status)" /><small>Target {{ dateLabel(ticket.dueAt) }}</small><i class="uil uil-angle-right" /></div>
          </NuxtLink>
        </div>
        <EmptyState v-else title="Belum ada tiket pada filter ini" description="Ubah filter atau buat permintaan layanan baru." />
      </div>
    </section>

    <div v-if="showCreate" class="service-modal" role="dialog" aria-modal="true" aria-labelledby="new-ticket-title" @click.self="showCreate = false">
      <form class="service-dialog" @submit.prevent="submitTicket">
        <button class="service-dialog__close" type="button" aria-label="Tutup" @click="showCreate = false"><i class="uil uil-times" /></button>
        <span class="dialog-icon"><i class="uil uil-comment-alt-plus" /></span><span class="section-kicker">Permintaan baru</span><h2 id="new-ticket-title">Buat tiket layanan</h2><p>Jelaskan kebutuhan secara spesifik agar unit tujuan dapat menanganinya lebih cepat.</p>
        <div class="row g-3 mt-1"><label class="col-md-7 form-label">Kategori<select v-model="form.category" class="form-select mt-1"><option v-for="category in categories" :key="category.value" :value="category.value">{{ category.label }}</option></select></label><label class="col-md-5 form-label">Prioritas<select v-model="form.priority" class="form-select mt-1"><option value="LOW">Rendah - 48 jam</option><option value="NORMAL">Normal - 24 jam</option><option value="HIGH">Tinggi - 8 jam</option></select></label></div>
        <label class="form-label mt-2">Subjek<input v-model="form.subject" class="form-control mt-1" maxlength="180" placeholder="Contoh: Koreksi data KHS" required></label>
        <label class="form-label mt-2">Keterangan<textarea v-model="form.message" class="form-control mt-1" rows="5" maxlength="4000" placeholder="Tuliskan kronologi, periode, dan hasil yang diharapkan." required /></label>
        <div class="privacy-note"><i class="uil uil-lock" /><span>Jangan memasukkan kata sandi, token, atau data rekening pada isi pesan.</span></div>
        <div class="d-flex justify-content-end gap-2 mt-4"><button class="btn btn-outline-secondary" type="button" @click="showCreate = false">Batal</button><button class="btn btn-primary" type="submit" :disabled="submitting"><span v-if="submitting" class="spinner-border spinner-border-sm me-2" />Kirim tiket</button></div>
      </form>
    </div>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.service-page { --service-green: #215b49; }
.service-hero { display:flex; align-items:center; justify-content:space-between; gap:2rem; padding:1.35rem 1.5rem; border:1px solid #dce8e2; border-radius:1rem; color:#fff; background:linear-gradient(125deg,#173e34,#2e715a); box-shadow:0 18px 42px rgba(26,72,57,.14); }
.service-hero h2 { margin:.2rem 0 .35rem; font-size:1.25rem; }.service-hero p { max-width:680px; margin:0; color:#d6e7df; font-size:.72rem; }.service-hero .section-kicker { color:#a8d4bf; }
.service-hero__metrics { display:grid; grid-template-columns:repeat(3,minmax(82px,1fr)); min-width:310px; border:1px solid rgba(255,255,255,.14); border-radius:.8rem; background:rgba(255,255,255,.07); }.service-hero__metrics div { padding:.8rem 1rem; text-align:center; }.service-hero__metrics div+div { border-left:1px solid rgba(255,255,255,.12); }.service-hero__metrics strong,.service-hero__metrics span { display:block; }.service-hero__metrics strong { font-size:1.2rem; }.service-hero__metrics span { color:#c6ded3; font-size:.61rem; }
.service-layout { display:grid; grid-template-columns:250px minmax(0,1fr); gap:1rem; align-items:start; }.service-guide,.ticket-workspace { border:1px solid #e6dfd6; border-radius:1rem; background:#fff; box-shadow:0 10px 28px rgba(25,62,50,.05); }.service-guide { padding:1rem; }.service-guide h2,.ticket-toolbar h2 { margin:.15rem 0 .85rem; color:#294c40; font-size:.95rem; }.service-guide>button { display:flex; align-items:center; width:100%; gap:.65rem; padding:.65rem .7rem; border:0; border-radius:.65rem; color:#60766e; background:transparent; font-size:.68rem; text-align:left; }.service-guide>button:hover,.service-guide>button.active { color:#215b49; background:#edf6f1; }.service-guide>button>i:first-child { font-size:1rem; }.service-guide__note { display:flex; gap:.6rem; margin-top:1rem; padding:.75rem; border-radius:.7rem; color:#47685d; background:#f2f7f4; }.service-guide__note i { color:#348064; }.service-guide__note strong,.service-guide__note p { display:block; margin:0; }.service-guide__note strong { font-size:.65rem; }.service-guide__note p { margin-top:.2rem; color:#789087; font-size:.58rem; line-height:1.45; }
.ticket-workspace { overflow:hidden; }.ticket-toolbar { display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:1rem 1.1rem; border-bottom:1px solid #e7ece9; }.ticket-toolbar h2 { margin-bottom:0; }.ticket-toolbar select { min-width:165px; }.ticket-list { display:grid; }.ticket-card { display:grid; grid-template-columns:auto minmax(0,1fr) auto; gap:.85rem; align-items:center; padding:1rem 1.1rem; color:inherit; text-decoration:none; transition:background .15s ease,transform .15s ease; }.ticket-card+.ticket-card { border-top:1px solid #ece6dd; }.ticket-card:hover { background:#f9fbfa; transform:translateX(2px); }.ticket-card__icon { display:grid; place-items:center; width:2.55rem; height:2.55rem; border-radius:.75rem; color:#2c745a; background:#e9f4ee; font-size:1.1rem; }.ticket-card__meta { display:flex; flex-wrap:wrap; gap:.35rem .7rem; color:#86968f; font-size:.57rem; }.ticket-card__meta span+span:before { content:'-'; margin-right:.7rem; }.ticket-card h3 { margin:.25rem 0 .2rem; overflow:hidden; color:#2a4c40; font-size:.75rem; text-overflow:ellipsis; white-space:nowrap; }.ticket-card p { margin:0; color:#74877f; font-size:.62rem; }.ticket-card__state { display:grid; grid-template-columns:auto auto; align-items:center; justify-items:end; gap:.35rem .6rem; }.ticket-card__state small { grid-column:1/2; color:#8a9892; font-size:.56rem; }.ticket-card__state>i { grid-column:2; grid-row:1/3; color:#8ba097; }.ticket-loading { display:flex; justify-content:center; gap:.6rem; padding:3rem; color:#70827a; font-size:.7rem; }
.service-modal { position:fixed; z-index:1080; inset:0; display:grid; place-items:center; padding:1rem; background:rgba(12,35,28,.62); backdrop-filter:blur(5px); }.service-dialog { position:relative; width:min(100%,620px); max-height:calc(100vh - 2rem); overflow:auto; padding:1.4rem; border-radius:1rem; background:#fff; box-shadow:0 30px 90px rgba(8,31,24,.3); }.service-dialog__close { position:absolute; top:.8rem; right:.8rem; display:grid; place-items:center; width:2rem; height:2rem; border:0; border-radius:.55rem; color:#687d74; background:#eef3f0; }.dialog-icon { display:grid; place-items:center; width:2.8rem; height:2.8rem; margin-bottom:.8rem; border-radius:.8rem; color:#27664f; background:#e5f2eb; font-size:1.2rem; }.service-dialog h2 { margin:.15rem 0 .25rem; color:#24493b; font-size:1.15rem; }.service-dialog>p { color:#75877f; font-size:.68rem; }.service-dialog .form-label { color:#4c665c; font-size:.64rem; font-weight:600; }.service-dialog .form-control,.service-dialog .form-select { font-size:.7rem; }.privacy-note { display:flex; gap:.5rem; margin-top:.8rem; padding:.65rem .75rem; border-radius:.65rem; color:#6d7f77; background:#f5f7f6; font-size:.61rem; }
@media (max-width:991.98px){.service-layout{grid-template-columns:1fr}.service-guide{display:none}.service-hero{align-items:flex-start;flex-direction:column}.service-hero__metrics{width:100%;min-width:0}}
@media (max-width:575.98px){.service-hero{padding:1rem}.service-hero__metrics div{padding:.65rem .4rem}.ticket-toolbar{align-items:flex-start;flex-direction:column}.ticket-toolbar select{width:100%}.ticket-card{grid-template-columns:auto minmax(0,1fr);padding:.85rem}.ticket-card__state{grid-column:2;grid-template-columns:auto 1fr;justify-items:start}.ticket-card__state>i{display:none}.ticket-card__state small{grid-column:2}.ticket-card__meta span:nth-child(3){display:none}}
</style>
