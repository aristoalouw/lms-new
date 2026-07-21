<script setup lang="ts">
import type { ServiceTicket, TicketDetail, TicketMessage } from '~/server/types/communications'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Detail Tiket Layanan' })

const route = useRoute()
const config = useRuntimeConfig()
const { $api } = useNuxtApp()
const loading = ref(false)
const sending = ref(false)
const errorMessage = ref('')
const reply = ref('')

const ticket = ref<ServiceTicket>({ id: String(route.params.id), ticketNumber: 'LYN-202607-1042', requesterId: 'student-001', requesterName: 'Nabila Putri', programStudyId: 'management-s1', category: 'ACADEMIC', priority: 'NORMAL', subject: 'Permohonan koreksi data KHS semester ganjil', status: 'IN_REVIEW', assignedUnit: 'Biro Akademik', slaHours: 24, dueAt: '2026-07-22T03:15:00.000Z', createdAt: '2026-07-21T03:15:00.000Z', updatedAt: '2026-07-21T04:10:00.000Z', version: 2, messageCount: 2 })
const messages = ref<TicketMessage[]>([
  { id: 'message-1', ticketId: String(route.params.id), authorId: 'student-001', authorName: 'Nabila Putri', authorKind: 'REQUESTER', body: 'Nilai mata kuliah MGT301 pada KHS berbeda dengan hasil akhir yang diumumkan dosen. Mohon dibantu melakukan pemeriksaan.', attachments: [{ fileId: 'private-file-001', fileName: 'khs-semester-ganjil.pdf', contentType: 'application/pdf', sizeBytes: 842_000 }], createdAt: '2026-07-21T03:15:00.000Z' },
  { id: 'message-2', ticketId: String(route.params.id), authorId: 'academic-001', authorName: 'Rina Wijaya', authorKind: 'STAFF', body: 'Laporan sudah diterima dan sedang kami cocokkan dengan berita acara nilai dari dosen pengampu.', attachments: [], createdAt: '2026-07-21T04:10:00.000Z' },
])

const statusLabel = computed(() => ({ OPEN: 'Baru', IN_REVIEW: 'Sedang ditinjau', WAITING_FOR_REQUESTER: 'Menunggu jawaban Anda', RESOLVED: 'Selesai', CLOSED: 'Ditutup', CANCELLED: 'Dibatalkan' })[ticket.value.status])
const statusTone = computed(() => ({ OPEN: 'pending', IN_REVIEW: 'processing', WAITING_FOR_REQUESTER: 'review', RESOLVED: 'success', CLOSED: 'inactive', CANCELLED: 'blocked' })[ticket.value.status])
const canReply = computed(() => !['CLOSED', 'CANCELLED'].includes(ticket.value.status))
const slaPercent = computed(() => {
  const start = new Date(ticket.value.createdAt).getTime()
  const due = new Date(ticket.value.dueAt).getTime()
  const now = Math.min(Date.now(), due)
  return Math.max(6, Math.min(100, ((now - start) / Math.max(1, due - start)) * 100))
})
const dateTime = (value: string) => new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value))
const fileSize = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`

const loadDetail = async () => {
  if (config.public.demoMode) return
  loading.value = true
  try {
    const { data } = await $api.get<TicketDetail>(`/tickets/${encodeURIComponent(String(route.params.id))}`)
    ticket.value = data.ticket
    messages.value = data.messages
  } catch {
    errorMessage.value = 'Detail tiket belum dapat dimuat.'
  } finally {
    loading.value = false
  }
}

const sendReply = async () => {
  if (!reply.value.trim() || !canReply.value) return
  sending.value = true
  try {
    if (config.public.demoMode) {
      const now = new Date().toISOString()
      messages.value.push({ id: `demo-message-${Date.now()}`, ticketId: ticket.value.id, authorId: ticket.value.requesterId, authorName: ticket.value.requesterName, authorKind: 'REQUESTER', body: reply.value.trim(), attachments: [], createdAt: now })
      ticket.value = { ...ticket.value, status: ticket.value.status === 'WAITING_FOR_REQUESTER' ? 'IN_REVIEW' : ticket.value.status, messageCount: ticket.value.messageCount + 1, version: ticket.value.version + 1, updatedAt: now }
    } else {
      const { data } = await $api.post<{ ticket: ServiceTicket; message: TicketMessage }>(`/tickets/${encodeURIComponent(ticket.value.id)}/messages`, { message: reply.value, attachments: [] })
      ticket.value = data.ticket
      messages.value.push(data.message)
    }
    reply.value = ''
  } catch {
    errorMessage.value = 'Balasan belum berhasil dikirim.'
  } finally {
    sending.value = false
  }
}

onMounted(loadDetail)
</script>

<template>
  <div class="page-stack ticket-detail-page">
    <nav class="detail-breadcrumb" aria-label="Breadcrumb"><NuxtLink to="/layanan"><i class="uil uil-arrow-left" /> Pusat layanan</NuxtLink><span>/</span><span>{{ ticket.ticketNumber }}</span></nav>
    <AppPageHeader eyebrow="Detail permintaan" :title="ticket.subject" :description="`${ticket.ticketNumber} - ${ticket.assignedUnit}`" :status="statusTone" :status-label="statusLabel">
      <template #actions><button class="btn btn-outline-secondary" type="button"><i class="uil uil-print me-2" />Cetak ringkasan</button></template>
    </AppPageHeader>

    <div v-if="errorMessage" class="alert alert-warning">{{ errorMessage }}</div>
    <div v-if="loading" class="detail-loading"><span class="spinner-border spinner-border-sm" /> Memuat percakapan...</div>
    <section v-else class="detail-layout">
      <div class="conversation-panel">
        <header><div><span class="section-kicker">Percakapan</span><h2>{{ messages.length }} pesan dalam tiket ini</h2></div><span class="secure-label"><i class="uil uil-lock" /> Privat</span></header>
        <div class="conversation-stream" aria-live="polite">
          <article v-for="message in messages" :key="message.id" class="message" :class="{ 'message--staff': message.authorKind === 'STAFF' }">
            <div class="message__avatar">{{ message.authorName.split(' ').map(item => item[0]).slice(0,2).join('') }}</div>
            <div class="message__content"><div class="message__meta"><strong>{{ message.authorName }}</strong><span>{{ message.authorKind === 'STAFF' ? ticket.assignedUnit : 'Pemohon' }}</span><time :datetime="message.createdAt">{{ dateTime(message.createdAt) }}</time></div><p>{{ message.body }}</p><div v-if="message.attachments.length" class="attachments"><div v-for="attachment in message.attachments" :key="attachment.fileId"><i class="uil uil-file-shield-alt" /><span><strong>{{ attachment.fileName }}</strong><small>{{ attachment.contentType }} - {{ fileSize(attachment.sizeBytes) }}</small></span><button type="button" aria-label="Buka lampiran"><i class="uil uil-external-link-alt" /></button></div></div></div>
          </article>
        </div>
        <form v-if="canReply" class="reply-box" @submit.prevent="sendReply"><label for="ticket-reply">Balas percakapan</label><textarea id="ticket-reply" v-model="reply" rows="4" maxlength="4000" placeholder="Tambahkan informasi yang membantu petugas menyelesaikan tiket." /><div><span><i class="uil uil-shield-check" /> Hindari data rahasia pada pesan.</span><button class="btn btn-primary btn-sm" type="submit" :disabled="sending || !reply.trim()"><span v-if="sending" class="spinner-border spinner-border-sm me-2" />Kirim balasan</button></div></form>
        <div v-else class="reply-closed"><i class="uil uil-lock-alt" /><span><strong>Percakapan telah ditutup</strong><small>Buat tiket baru jika masih memerlukan bantuan.</small></span></div>
      </div>

      <aside class="ticket-facts">
        <article class="sla-card"><div class="sla-card__top"><span class="section-kicker">Target layanan</span><StatusBadge :status="new Date(ticket.dueAt) < new Date() && !['RESOLVED','CLOSED'].includes(ticket.status) ? 'overdue' : 'active'" :label="`${ticket.slaHours} jam`" /></div><h2>{{ dateTime(ticket.dueAt) }}</h2><p>Target dihitung sejak tiket diterima oleh sistem.</p><div class="sla-meter"><span :style="{ width: `${slaPercent}%` }" /></div><small>{{ Math.round(slaPercent) }}% waktu penanganan berjalan</small></article>
        <article class="fact-card"><span class="section-kicker">Informasi tiket</span><dl><div><dt>Nomor tiket</dt><dd>{{ ticket.ticketNumber }}</dd></div><div><dt>Kategori</dt><dd>{{ ticket.category.replaceAll('_',' ') }}</dd></div><div><dt>Prioritas</dt><dd>{{ ticket.priority }}</dd></div><div><dt>Program studi</dt><dd>{{ ticket.programStudyId || '-' }}</dd></div><div><dt>Dibuat</dt><dd>{{ dateTime(ticket.createdAt) }}</dd></div><div><dt>Versi</dt><dd>{{ ticket.version }}</dd></div></dl></article>
        <article class="fact-card handler-card"><span class="handler-card__icon"><i class="uil uil-building" /></span><div><span class="section-kicker">Unit penanggung jawab</span><h3>{{ ticket.assignedUnit }}</h3><p>Balasan petugas akan tercatat pada percakapan dan pusat notifikasi.</p></div></article>
      </aside>
    </section>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.detail-breadcrumb { display:flex; align-items:center; gap:.5rem; color:#8a9993; font-size:.62rem; }.detail-breadcrumb a { color:#3b705e; text-decoration:none; }.detail-layout { display:grid; grid-template-columns:minmax(0,1fr) 300px; gap:1rem; align-items:start; }.conversation-panel,.sla-card,.fact-card { border:1px solid #e0e8e4; border-radius:1rem; background:#fff; box-shadow:0 10px 28px rgba(24,62,49,.05); }.conversation-panel>header { display:flex; align-items:center; justify-content:space-between; padding:1rem 1.2rem; border-bottom:1px solid #e8eeeb; }.conversation-panel h2 { margin:.15rem 0 0; color:#2c5043; font-size:.9rem; }.secure-label { display:inline-flex; align-items:center; gap:.35rem; padding:.35rem .55rem; border-radius:999px; color:#39705d; background:#edf6f1; font-size:.58rem; }.conversation-stream { display:grid; gap:1.2rem; padding:1.2rem; }.message { display:grid; grid-template-columns:auto minmax(0,1fr); gap:.7rem; }.message__avatar { display:grid; place-items:center; width:2.2rem; height:2.2rem; border-radius:.65rem; color:#2d6753; background:#e7f2ec; font-size:.62rem; font-weight:700; }.message--staff .message__avatar { color:#315f85; background:#eaf1f7; }.message__content { padding:.85rem 1rem; border:1px solid #e5ebe8; border-radius:.2rem .85rem .85rem .85rem; background:#fbfcfb; }.message--staff .message__content { border-color:#dce7ed; background:#f7fafc; }.message__meta { display:flex; align-items:center; flex-wrap:wrap; gap:.35rem .6rem; }.message__meta strong { color:#304f44; font-size:.67rem; }.message__meta span { padding:.15rem .35rem; border-radius:.3rem; color:#698078; background:#edf2ef; font-size:.52rem; }.message__meta time { margin-left:auto; color:#8a9993; font-size:.54rem; }.message__content>p { margin:.55rem 0 0; color:#5f746b; font-size:.68rem; line-height:1.65; }.attachments { display:grid; gap:.4rem; margin-top:.7rem; }.attachments>div { display:flex; align-items:center; gap:.55rem; padding:.55rem .65rem; border:1px solid #e1e8e4; border-radius:.6rem; background:#fff; }.attachments>div>i { color:#408066; font-size:1.1rem; }.attachments span { min-width:0; }.attachments strong,.attachments small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.attachments strong { color:#486158; font-size:.59rem; }.attachments small { color:#8b9893; font-size:.52rem; }.attachments button { margin-left:auto; border:0; color:#638177; background:transparent; }.reply-box { margin:0 1.2rem 1.2rem; padding:.85rem; border:1px solid #dfe8e3; border-radius:.8rem; background:#f9fbfa; }.reply-box label { display:block; margin-bottom:.45rem; color:#405f54; font-size:.65rem; font-weight:600; }.reply-box textarea { width:100%; padding:.7rem; resize:vertical; border:1px solid #dce5e0; border-radius:.6rem; outline:none; color:#4f675e; background:#fff; font-size:.68rem; }.reply-box textarea:focus { border-color:#6fa48e; box-shadow:0 0 0 3px rgba(58,126,98,.1); }.reply-box>div { display:flex; justify-content:space-between; align-items:center; gap:1rem; margin-top:.55rem; }.reply-box>div>span { color:#819089; font-size:.55rem; }.reply-closed { display:flex; gap:.6rem; margin:0 1.2rem 1.2rem; padding:.8rem; border-radius:.7rem; color:#73857e; background:#f1f4f2; }.reply-closed strong,.reply-closed small { display:block; }.reply-closed strong { font-size:.65rem; }.reply-closed small { margin-top:.15rem; font-size:.56rem; }.ticket-facts { display:grid; gap:1rem; }.sla-card,.fact-card { padding:1rem; }.sla-card__top { display:flex; justify-content:space-between; align-items:center; }.sla-card h2 { margin:.65rem 0 .2rem; color:#2d5144; font-size:.9rem; }.sla-card p,.sla-card small { color:#84928d; font-size:.57rem; }.sla-meter { height:.4rem; margin:.8rem 0 .35rem; overflow:hidden; border-radius:999px; background:#e6ece9; }.sla-meter span { display:block; height:100%; border-radius:inherit; background:linear-gradient(90deg,#377a60,#78ad93); }.fact-card dl { margin:.65rem 0 0; }.fact-card dl>div { display:flex; justify-content:space-between; gap:1rem; padding:.55rem 0; border-top:1px solid #edf1ef; }.fact-card dt { color:#84938d; font-size:.57rem; font-weight:500; }.fact-card dd { margin:0; color:#405f54; font-size:.59rem; font-weight:600; text-align:right; text-transform:capitalize; }.handler-card { display:flex; gap:.7rem; }.handler-card__icon { display:grid; place-items:center; flex:0 0 auto; width:2.5rem; height:2.5rem; border-radius:.7rem; color:#347359; background:#e8f3ed; }.handler-card h3 { margin:.2rem 0; color:#315448; font-size:.7rem; }.handler-card p { margin:0; color:#84928d; font-size:.56rem; line-height:1.45; }.detail-loading { display:flex; justify-content:center; gap:.6rem; padding:4rem; color:#73857e; font-size:.7rem; }
@media(max-width:991.98px){.detail-layout{grid-template-columns:1fr}.ticket-facts{grid-template-columns:repeat(2,1fr)}.handler-card{grid-column:1/-1}}
@media(max-width:575.98px){.ticket-facts{grid-template-columns:1fr}.message__meta time{width:100%;margin-left:0}.conversation-stream{padding:.85rem}.conversation-panel>header{padding:.85rem}.reply-box{margin:0 .85rem .85rem}.reply-box>div{align-items:flex-end;flex-direction:column}.ticket-detail-page :deep(.page-header__actions){width:100%}.ticket-detail-page :deep(.page-header__actions .btn){width:100%}}
</style>
