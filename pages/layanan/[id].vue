<script setup lang="ts">
import type { AttachmentReference, ServiceTicket, TicketDetail, TicketMessage, TicketStatus } from '~/server/types/communications'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Detail Tiket Layanan' })

const route = useRoute()
const config = useRuntimeConfig()
const { $api } = useNuxtApp()
const loading = ref(!config.public.demoMode)
const sending = ref(false)
const updatingStatus = ref<TicketStatus | null>(null)
const errorMessage = ref('')
const noticeMessage = ref('')
const reply = ref('')

const demoTicket: ServiceTicket = { id: String(route.params.id), ticketNumber: 'LYN-202607-1042', requesterId: 'student-001', requesterName: 'Nabila Putri', programStudyId: 'management-s1', category: 'ACADEMIC', priority: 'NORMAL', subject: 'Permohonan koreksi data KHS semester ganjil', status: 'IN_REVIEW', assignedUnit: 'Biro Akademik', slaHours: 24, dueAt: '2026-07-22T03:15:00.000Z', createdAt: '2026-07-21T03:15:00.000Z', updatedAt: '2026-07-21T04:10:00.000Z', version: 2, messageCount: 2 }
const demoMessages: TicketMessage[] = [
  { id: 'message-1', ticketId: String(route.params.id), authorId: 'student-001', authorName: 'Nabila Putri', authorKind: 'REQUESTER', body: 'Nilai mata kuliah MGT301 pada KHS berbeda dengan hasil akhir yang diumumkan dosen. Mohon dibantu melakukan pemeriksaan.', attachments: [{ fileId: 'private-file-001', fileName: 'khs-semester-ganjil.pdf', contentType: 'application/pdf', sizeBytes: 842_000 }], createdAt: '2026-07-21T03:15:00.000Z' },
  { id: 'message-2', ticketId: String(route.params.id), authorId: 'academic-001', authorName: 'Rina Wijaya', authorKind: 'STAFF', body: 'Laporan sudah diterima dan sedang kami cocokkan dengan berita acara nilai dari dosen pengampu.', attachments: [], createdAt: '2026-07-21T04:10:00.000Z' },
]
const ticket = ref<ServiceTicket | null>(config.public.demoMode ? demoTicket : null)
const messages = ref<TicketMessage[]>(config.public.demoMode ? demoMessages : [])
const canManage = ref(false)
const allowedTransitions = ref<TicketStatus[]>(config.public.demoMode ? ['CANCELLED'] : [])

const statusLabels: Record<TicketStatus, string> = {
  OPEN: 'Baru',
  IN_REVIEW: 'Sedang ditinjau',
  WAITING_FOR_REQUESTER: 'Menunggu jawaban pemohon',
  RESOLVED: 'Selesai',
  CLOSED: 'Ditutup',
  CANCELLED: 'Dibatalkan',
}

const categoryLabels: Record<ServiceTicket['category'], string> = {
  ACADEMIC: 'Akademik',
  FINANCE: 'Keuangan',
  STUDENT_AFFAIRS: 'Kemahasiswaan',
  ADMISSIONS: 'Penerimaan',
  GENERAL: 'Layanan umum',
}

const priorityLabels: Record<ServiceTicket['priority'], string> = {
  LOW: 'Rendah',
  NORMAL: 'Normal',
  HIGH: 'Tinggi',
  URGENT: 'Mendesak',
}

const statusLabel = computed(() => ticket.value ? statusLabels[ticket.value.status] : '')
const statusTone = computed(() => ticket.value ? ({ OPEN: 'pending', IN_REVIEW: 'processing', WAITING_FOR_REQUESTER: 'review', RESOLVED: 'success', CLOSED: 'inactive', CANCELLED: 'blocked' })[ticket.value.status] : 'inactive')
const canReply = computed(() => Boolean(ticket.value && !['CLOSED', 'CANCELLED'].includes(ticket.value.status)))
const slaPercent = computed(() => {
  if (!ticket.value) return 0
  const start = new Date(ticket.value.createdAt).getTime()
  const due = new Date(ticket.value.dueAt).getTime()
  const now = Math.min(Date.now(), due)
  return Math.max(6, Math.min(100, ((now - start) / Math.max(1, due - start)) * 100))
})
const dateTime = (value: string) => new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value))
const fileSize = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`

const transitionMeta = (next: TicketStatus) => {
  const current = ticket.value?.status
  if (next === 'IN_REVIEW') {
    if (current === 'OPEN') return { label: 'Mulai tinjau', icon: 'uil-play', primary: true }
    if (current === 'WAITING_FOR_REQUESTER') return { label: 'Lanjutkan tinjauan', icon: 'uil-sync', primary: true }
    return { label: canManage.value ? 'Buka kembali' : 'Ajukan tinjau ulang', icon: 'uil-redo', primary: false }
  }
  if (next === 'WAITING_FOR_REQUESTER') return { label: 'Minta jawaban pemohon', icon: 'uil-comment-question', primary: false }
  if (next === 'RESOLVED') return { label: 'Tandai selesai', icon: 'uil-check-circle', primary: true }
  if (next === 'CLOSED') return { label: canManage.value ? 'Tutup tiket' : 'Konfirmasi selesai & tutup', icon: 'uil-lock-alt', primary: true }
  return { label: 'Batalkan tiket', icon: 'uil-times-circle', primary: false, danger: true }
}

const extractApiError = (error: unknown, fallback: string) => {
  const candidate = error as { response?: { data?: { message?: string; statusMessage?: string; code?: string } } }
  return {
    code: candidate?.response?.data?.code,
    message: candidate?.response?.data?.message || candidate?.response?.data?.statusMessage || fallback,
  }
}

const loadDetail = async () => {
  if (config.public.demoMode) return
  loading.value = true
  errorMessage.value = ''
  try {
    const { data } = await $api.get<TicketDetail>(`/tickets/${encodeURIComponent(String(route.params.id))}`)
    ticket.value = data.ticket
    messages.value = data.messages
    canManage.value = Boolean(data.canManage)
    allowedTransitions.value = Array.isArray(data.allowedTransitions) ? data.allowedTransitions : []
  } catch (error) {
    errorMessage.value = extractApiError(error, 'Detail tiket belum dapat dimuat.').message
  } finally {
    loading.value = false
  }
}

const updateStatus = async (nextStatus: TicketStatus) => {
  if (!ticket.value || updatingStatus.value) return
  updatingStatus.value = nextStatus
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    if (config.public.demoMode) {
      ticket.value = { ...ticket.value, status: nextStatus, version: ticket.value.version + 1, updatedAt: new Date().toISOString() }
      allowedTransitions.value = []
    } else {
      const { data } = await $api.post<{ ticket: ServiceTicket; canManage?: boolean; allowedTransitions?: TicketStatus[] }>(
        `/tickets/${encodeURIComponent(ticket.value.id)}/status`,
        { status: nextStatus, expectedVersion: ticket.value.version },
      )
      ticket.value = data.ticket
      if (typeof data.canManage === 'boolean') canManage.value = data.canManage
      allowedTransitions.value = Array.isArray(data.allowedTransitions) ? data.allowedTransitions : []
    }
    noticeMessage.value = `Status tiket berhasil diperbarui menjadi "${statusLabels[nextStatus]}".`
  } catch (error) {
    const parsed = extractApiError(error, 'Status tiket belum berhasil diperbarui.')
    errorMessage.value = parsed.message
    if (parsed.code === 'VERSION_CONFLICT') await loadDetail()
  } finally {
    updatingStatus.value = null
  }
}

const sendReply = async () => {
  if (!reply.value.trim() || !canReply.value || !ticket.value) return
  sending.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    if (config.public.demoMode) {
      const now = new Date().toISOString()
      messages.value.push({ id: `demo-message-${Date.now()}`, ticketId: ticket.value.id, authorId: ticket.value.requesterId, authorName: ticket.value.requesterName, authorKind: 'REQUESTER', body: reply.value.trim(), attachments: [], createdAt: now })
      ticket.value = { ...ticket.value, status: ticket.value.status === 'WAITING_FOR_REQUESTER' ? 'IN_REVIEW' : ticket.value.status, messageCount: ticket.value.messageCount + 1, version: ticket.value.version + 1, updatedAt: now }
    } else {
      const { data } = await $api.post<{ ticket: ServiceTicket; message: TicketMessage; canManage?: boolean; allowedTransitions?: TicketStatus[] }>(
        `/tickets/${encodeURIComponent(ticket.value.id)}/messages`,
        { message: reply.value, attachments: [] },
      )
      ticket.value = data.ticket
      messages.value.push(data.message)
      if (typeof data.canManage === 'boolean') canManage.value = data.canManage
      if (Array.isArray(data.allowedTransitions)) allowedTransitions.value = data.allowedTransitions
    }
    reply.value = ''
    noticeMessage.value = 'Balasan berhasil dikirim.'
  } catch (error) {
    const parsed = extractApiError(error, 'Balasan belum berhasil dikirim.')
    errorMessage.value = parsed.message
    if (parsed.code === 'VERSION_CONFLICT') await loadDetail()
  } finally {
    sending.value = false
  }
}

const printSummary = () => {
  if (import.meta.client) window.print()
}

const openAttachment = (attachment: AttachmentReference) => {
  if (!import.meta.client) return
  if (config.public.demoMode) {
    noticeMessage.value = `Lampiran "${attachment.fileName}" hanya tersedia pada mode layanan aktif.`
    return
  }
  window.open(`/api/files/${encodeURIComponent(attachment.fileId)}/download`, '_blank', 'noopener,noreferrer')
}

onMounted(loadDetail)
</script>

<template>
  <div class="page-stack ticket-detail-page">
    <nav class="detail-breadcrumb no-print" aria-label="Breadcrumb"><NuxtLink to="/layanan"><i class="uil uil-arrow-left" /> Pusat layanan</NuxtLink><span v-if="ticket">/</span><span v-if="ticket">{{ ticket.ticketNumber }}</span></nav>
    <AppPageHeader eyebrow="Detail permintaan" :title="ticket?.subject || 'Detail tiket layanan'" :description="ticket ? `${ticket.ticketNumber} · ${ticket.assignedUnit}` : 'Memuat data tiket dari sistem kampus.'" :status="statusTone" :status-label="statusLabel">
      <template #actions><button class="btn btn-outline-secondary no-print" type="button" :disabled="!ticket" @click="printSummary"><i class="uil uil-print me-2" />Cetak ringkasan</button></template>
    </AppPageHeader>

    <div v-if="noticeMessage" class="alert alert-success d-flex align-items-center gap-2 no-print" role="status"><i class="uil uil-check-circle" /><span>{{ noticeMessage }}</span><button class="btn-close ms-auto" type="button" aria-label="Tutup" @click="noticeMessage = ''" /></div>
    <div v-if="errorMessage" class="alert alert-warning d-flex align-items-center gap-2 no-print" role="alert"><i class="uil uil-exclamation-triangle" /><span>{{ errorMessage }}</span><button class="btn btn-sm btn-link ms-auto" type="button" @click="loadDetail">Muat ulang</button></div>
    <div v-if="loading" class="detail-loading"><span class="spinner-border spinner-border-sm" /> Memuat percakapan...</div>
    <section v-else-if="ticket" class="detail-layout">
      <div class="conversation-panel">
        <header><div><span class="section-kicker">Percakapan</span><h2>{{ messages.length }} pesan dalam tiket ini</h2></div><span class="secure-label"><i class="uil uil-lock" /> Privat</span></header>
        <div class="conversation-stream" aria-live="polite">
          <article v-for="message in messages" :key="message.id" class="message" :class="{ 'message--staff': message.authorKind === 'STAFF' }">
            <div class="message__avatar">{{ message.authorName.split(' ').map(item => item[0]).slice(0,2).join('') }}</div>
            <div class="message__content"><div class="message__meta"><strong>{{ message.authorName }}</strong><span>{{ message.authorKind === 'STAFF' ? ticket.assignedUnit : 'Pemohon' }}</span><time :datetime="message.createdAt">{{ dateTime(message.createdAt) }}</time></div><p>{{ message.body }}</p><div v-if="message.attachments.length" class="attachments"><div v-for="attachment in message.attachments" :key="attachment.fileId"><i class="uil uil-file-shield-alt" /><span><strong>{{ attachment.fileName }}</strong><small>{{ attachment.contentType }} - {{ fileSize(attachment.sizeBytes) }}</small></span><button type="button" aria-label="Buka lampiran" @click="openAttachment(attachment)"><i class="uil uil-external-link-alt" /></button></div></div></div>
          </article>
        </div>
        <form v-if="canReply" class="reply-box no-print" @submit.prevent="sendReply"><label for="ticket-reply">Balas percakapan</label><textarea id="ticket-reply" v-model="reply" rows="4" maxlength="4000" :placeholder="canManage ? 'Tuliskan tanggapan atau arahan tindak lanjut untuk pemohon.' : 'Tambahkan informasi yang membantu petugas menyelesaikan tiket.'" /><div><span><i class="uil uil-shield-check" /> Hindari data rahasia pada pesan.</span><button class="btn btn-primary btn-sm" type="submit" :disabled="sending || !reply.trim()"><span v-if="sending" class="spinner-border spinner-border-sm me-2" />Kirim balasan</button></div></form>
        <div v-else class="reply-closed"><i class="uil uil-lock-alt" /><span><strong>Percakapan telah ditutup</strong><small>Buat tiket baru jika masih memerlukan bantuan.</small></span></div>
      </div>

      <aside class="ticket-facts">
        <article v-if="allowedTransitions.length" class="fact-card actions-card no-print">
          <span class="section-kicker">{{ canManage ? 'Tindakan petugas' : 'Tindakan pemohon' }}</span>
          <h3>Perbarui status tiket</h3>
          <div class="status-actions">
            <button
              v-for="nextStatus in allowedTransitions"
              :key="nextStatus"
              type="button"
              class="btn btn-sm"
              :class="transitionMeta(nextStatus).primary ? 'btn-primary' : transitionMeta(nextStatus).danger ? 'btn-outline-danger' : 'btn-outline-secondary'"
              :disabled="Boolean(updatingStatus)"
              @click="updateStatus(nextStatus)"
            >
              <span v-if="updatingStatus === nextStatus" class="spinner-border spinner-border-sm me-1" />
              <i v-else class="uil me-1" :class="transitionMeta(nextStatus).icon" />
              {{ transitionMeta(nextStatus).label }}
            </button>
          </div>
        </article>
        <article class="sla-card"><div class="sla-card__top"><span class="section-kicker">Target penyelesaian</span><StatusBadge :status="new Date(ticket.dueAt) < new Date() && !['RESOLVED','CLOSED'].includes(ticket.status) ? 'overdue' : 'active'" :label="`${ticket.slaHours} jam`" /></div><h2>{{ dateTime(ticket.dueAt) }}</h2><p>Target dihitung sejak tiket diterima oleh sistem.</p><div class="sla-meter"><span :style="{ width: `${slaPercent}%` }" /></div><small>{{ Math.round(slaPercent) }}% waktu penanganan berjalan</small></article>
        <article class="fact-card"><span class="section-kicker">Informasi tiket</span><dl><div><dt>Nomor tiket</dt><dd>{{ ticket.ticketNumber }}</dd></div><div><dt>Pemohon</dt><dd>{{ ticket.requesterName }}</dd></div><div><dt>Kategori</dt><dd>{{ categoryLabels[ticket.category] || ticket.category }}</dd></div><div><dt>Prioritas</dt><dd>{{ priorityLabels[ticket.priority] || ticket.priority }}</dd></div><div><dt>Program studi</dt><dd>{{ ticket.programStudyId || '-' }}</dd></div><div><dt>Dibuat</dt><dd>{{ dateTime(ticket.createdAt) }}</dd></div></dl></article>
        <article class="fact-card handler-card"><span class="handler-card__icon"><i class="uil uil-building" /></span><div><span class="section-kicker">Unit penanggung jawab</span><h3>{{ ticket.assignedUnit }}</h3><p>Balasan dan pembaruan status tercatat pada percakapan dan pusat notifikasi.</p></div></article>
      </aside>
    </section>
    <EmptyState v-else title="Tiket tidak tersedia" description="Data tiket tidak ditemukan atau tidak dapat Anda akses." />
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.detail-breadcrumb { display:flex; align-items:center; gap:.5rem; color:#6c6865; font-size:.68rem; }.detail-breadcrumb a { color:#593660; text-decoration:none; font-weight:600; }.detail-layout { display:grid; grid-template-columns:minmax(0,1fr) 310px; gap:1rem; align-items:start; }.conversation-panel,.sla-card,.fact-card { border:1px solid #e6dfd6; border-radius:1rem; background:#fff; box-shadow:0 8px 24px rgba(30,30,30,.04); }.conversation-panel>header { display:flex; align-items:center; justify-content:space-between; padding:1rem 1.2rem; border-bottom:1px solid #ece6dd; }.conversation-panel h2 { margin:.15rem 0 0; color:#1e1e1e; font-size:.95rem; }.secure-label { display:inline-flex; align-items:center; gap:.35rem; padding:.35rem .6rem; border-radius:999px; color:#593660; background:#f5eff7; font-size:.64rem; font-weight:600; }.conversation-stream { display:grid; gap:1.1rem; padding:1.2rem; }.message { display:grid; grid-template-columns:auto minmax(0,1fr); gap:.7rem; }.message__avatar { display:grid; place-items:center; width:2.2rem; height:2.2rem; border-radius:.65rem; color:#593660; background:#f5eff7; font-size:.68rem; font-weight:700; }.message--staff .message__avatar { color:#fff; background:#593660; }.message__content { padding:.85rem 1rem; border:1px solid #e6dfd6; border-radius:.2rem .85rem .85rem .85rem; background:#faf6ef; }.message--staff .message__content { border-color:#dfd3e4; background:#f9f5fb; }.message__meta { display:flex; align-items:center; flex-wrap:wrap; gap:.35rem .6rem; }.message__meta strong { color:#1e1e1e; font-size:.74rem; }.message__meta span { padding:.15rem .4rem; border-radius:.3rem; color:#593660; background:#efe7f2; font-size:.58rem; font-weight:600; }.message__meta time { margin-left:auto; color:#6c6865; font-size:.6rem; }.message__content>p { margin:.55rem 0 0; color:#333; font-size:.76rem; line-height:1.65; white-space:pre-wrap; }.attachments { display:grid; gap:.4rem; margin-top:.7rem; }.attachments>div { display:flex; align-items:center; gap:.55rem; padding:.55rem .65rem; border:1px solid #e6dfd6; border-radius:.6rem; background:#fff; }.attachments>div>i { color:#593660; font-size:1.1rem; }.attachments span { min-width:0; }.attachments strong,.attachments small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.attachments strong { color:#1e1e1e; font-size:.65rem; }.attachments small { color:#6c6865; font-size:.58rem; }.attachments button { margin-left:auto; border:0; color:#593660; background:transparent; }.reply-box { margin:0 1.2rem 1.2rem; padding:.9rem; border:1px solid #e6dfd6; border-radius:.8rem; background:#faf6ef; }.reply-box label { display:block; margin-bottom:.45rem; color:#4e5462; font-size:.72rem; font-weight:600; }.reply-box textarea { width:100%; padding:.7rem; resize:vertical; border:1px solid #d9d0c5; border-radius:.6rem; outline:none; color:#1e1e1e; background:#fff; font-size:.76rem; }.reply-box textarea:focus { border-color:#593660; box-shadow:0 0 0 3px rgba(89,54,96,.12); }.reply-box>div { display:flex; justify-content:space-between; align-items:center; gap:1rem; margin-top:.55rem; }.reply-box>div>span { color:#6c6865; font-size:.62rem; }.reply-closed { display:flex; gap:.6rem; margin:0 1.2rem 1.2rem; padding:.8rem; border-radius:.7rem; color:#4e5462; background:#f4efe8; }.reply-closed strong,.reply-closed small { display:block; }.reply-closed strong { font-size:.72rem; color:#1e1e1e; }.reply-closed small { margin-top:.15rem; font-size:.62rem; }.ticket-facts { display:grid; gap:1rem; }.sla-card,.fact-card { padding:1rem; }.actions-card h3 { margin:.2rem 0 .7rem; color:#1e1e1e; font-size:.86rem; }.status-actions { display:grid; gap:.5rem; }.status-actions .btn { text-align:left; font-size:.74rem; }.sla-card__top { display:flex; justify-content:space-between; align-items:center; }.sla-card h2 { margin:.65rem 0 .2rem; color:#3e2344; font-size:.92rem; }.sla-card p,.sla-card small { color:#6c6865; font-size:.62rem; }.sla-meter { height:.4rem; margin:.8rem 0 .35rem; overflow:hidden; border-radius:999px; background:#ece4d8; }.sla-meter span { display:block; height:100%; border-radius:inherit; background:linear-gradient(90deg,#593660,#775a83); }.fact-card dl { margin:.65rem 0 0; }.fact-card dl>div { display:flex; justify-content:space-between; gap:1rem; padding:.55rem 0; border-top:1px solid #ece6dd; }.fact-card dt { color:#6c6865; font-size:.64rem; font-weight:500; }.fact-card dd { margin:0; color:#1e1e1e; font-size:.66rem; font-weight:600; text-align:right; }.handler-card { display:flex; gap:.7rem; }.handler-card__icon { display:grid; place-items:center; flex:0 0 auto; width:2.5rem; height:2.5rem; border-radius:.7rem; color:#593660; background:#f5eff7; }.handler-card h3 { margin:.2rem 0; color:#1e1e1e; font-size:.78rem; }.handler-card p { margin:0; color:#6c6865; font-size:.62rem; line-height:1.45; }.detail-loading { display:flex; justify-content:center; gap:.6rem; padding:4rem; color:#6c6865; font-size:.76rem; }
@media print { .no-print { display:none !important; } .detail-layout { grid-template-columns:1fr; } }
@media(max-width:991.98px){.detail-layout{grid-template-columns:1fr}.ticket-facts{grid-template-columns:repeat(2,1fr)}.handler-card,.actions-card{grid-column:1/-1}}
@media(max-width:575.98px){.ticket-facts{grid-template-columns:1fr}.message__meta time{width:100%;margin-left:0}.conversation-stream{padding:.85rem}.conversation-panel>header{padding:.85rem}.reply-box{margin:0 .85rem .85rem}.reply-box>div{align-items:flex-end;flex-direction:column}.ticket-detail-page :deep(.page-header__actions){width:100%}.ticket-detail-page :deep(.page-header__actions .btn){width:100%}}
</style>
