<script setup lang="ts">
import {
  LMS_MVP_NOTIFICATION_CATEGORIES,
  type EmailOutboxSummary,
  type InAppNotification,
  type NotificationCategory,
  type NotificationPreferences,
  type NotificationTemplate,
} from '~/server/types/communications'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Pusat Notifikasi' })

const config = useRuntimeConfig()
const { $api } = useNuxtApp()
const { can } = useAuth()
const { isLmsMvp } = useFeatureFlags()
const activeTab = ref<'inbox' | 'preferences' | 'operations'>('inbox')
const filter = ref<'ALL' | 'UNREAD' | NotificationCategory>('ALL')
const selectedId = ref(config.public.demoMode ? 'notification-demo-001' : '')
const notificationCursor = ref<string>()
const loadingMore = ref(false)
const saving = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')
const route = useRoute()
const isAdmin = computed(() => can('notifications:manage'))
const emailAvailable = computed(() => config.public.emailDeliveryEnabled)
const lmsCategorySet = new Set<NotificationCategory>(LMS_MVP_NOTIFICATION_CATEGORIES)

const demoNotifications: InAppNotification[] = [
  { id: 'notification-demo-001', recipientUid: 'student-001', templateKey: 'ticket-status-updated', category: 'SERVICE', title: 'Status LYN-202607-1042 diperbarui', body: 'Tiket sedang ditinjau oleh Biro Akademik.', actionPath: '/layanan/ticket-demo-001', createdAt: '2026-07-21T04:10:00.000Z' },
  { id: 'notification-demo-002', recipientUid: 'student-001', templateKey: 'payment-received', category: 'FINANCE', title: 'Pembayaran INV/2026/02/0001 diterima', body: 'Pembayaran sebesar Rp2.500.000 telah tercatat.', actionPath: '/keuangan', createdAt: '2026-07-20T08:30:00.000Z', readAt: '2026-07-20T09:00:00.000Z' },
  { id: 'notification-demo-003', recipientUid: 'student-001', templateKey: 'course-announcement', category: 'LEARNING', title: 'Materi baru tersedia', body: 'Materi Analisis Strategi sudah ditambahkan ke kelas MGT401.', actionPath: '/pembelajaran', createdAt: '2026-07-20T03:20:00.000Z' },
  { id: 'notification-demo-004', recipientUid: 'student-001', templateKey: 'academic-deadline', category: 'ACADEMIC', title: 'Batas pengisian KRS mendekat', body: 'Pengisian KRS ditutup pada 25 Juli 2026 pukul 23.59 WIB.', actionPath: '/akademik/krs', createdAt: '2026-07-19T11:00:00.000Z', readAt: '2026-07-19T12:00:00.000Z' },
]
const notifications = ref<InAppNotification[]>(config.public.demoMode ? demoNotifications : [])

const preferences = reactive<NotificationPreferences>({
  uid: '',
  inAppEnabled: true,
  emailEnabled: false,
  categoryEmail: { ACADEMIC: false, FINANCE: false, LEARNING: false, SERVICE: false, SYSTEM: false },
  quietHours: { start: '21:00', end: '06:00', timezone: 'Asia/Jakarta' },
  updatedAt: '',
})
const demoTemplates: NotificationTemplate[] = [
  { key: 'ticket-created', name: 'Tiket layanan dibuat', category: 'SERVICE', titleTemplate: 'Tiket {{ticketNumber}} berhasil dibuat', bodyTemplate: 'Permintaan sudah diterima.', emailSubjectTemplate: 'Tiket {{ticketNumber}}', emailBodyTemplate: 'Permintaan Anda sudah diterima.', channels: ['IN_APP', 'EMAIL'], active: true, version: 1, updatedAt: '2026-07-21T00:00:00.000Z', updatedBy: 'admin-001' },
  { key: 'payment-received', name: 'Pembayaran diterima', category: 'FINANCE', titleTemplate: 'Pembayaran diterima', bodyTemplate: 'Pembayaran telah tercatat.', emailSubjectTemplate: 'Konfirmasi pembayaran', emailBodyTemplate: 'Pembayaran Anda telah tercatat.', channels: ['IN_APP', 'EMAIL'], active: true, version: 1, updatedAt: '2026-07-21T00:00:00.000Z', updatedBy: 'admin-001' },
  { key: 'learning-announcement-published', name: 'Pengumuman kelas diterbitkan', category: 'LEARNING', titleTemplate: 'Pengumuman kelas baru', bodyTemplate: 'Buka ruang pembelajaran untuk melihat pengumuman.', emailSubjectTemplate: 'Pengumuman kelas baru', emailBodyTemplate: 'Pengumuman kelas baru tersedia di portal.', channels: ['IN_APP', 'EMAIL'], active: true, version: 1, updatedAt: '2026-07-21T00:00:00.000Z', updatedBy: 'admin-001' },
  { key: 'password-reset', name: 'Pemulihan akun', category: 'SYSTEM', titleTemplate: 'Petunjuk pemulihan akun', bodyTemplate: 'Permintaan pemulihan akun diterima.', emailSubjectTemplate: 'Petunjuk pemulihan akun', emailBodyTemplate: 'Ikuti petunjuk aman yang dikirim oleh sistem.', channels: ['EMAIL'], active: true, version: 1, updatedAt: '2026-07-21T00:00:00.000Z', updatedBy: 'system' },
]
const templates = ref<NotificationTemplate[]>(config.public.demoMode ? demoTemplates : [])
const demoOutbox: EmailOutboxSummary[] = [
  { id: 'email-demo-001', deliveryKind: 'RENDERED_TEMPLATE', templateKey: 'learning-announcement-published', category: 'LEARNING', status: 'SENT', attempts: 1, maxAttempts: 5, nextAttemptAt: '2026-07-21T03:15:00.000Z', createdAt: '2026-07-21T03:15:00.000Z', updatedAt: '2026-07-21T03:15:08.000Z', sentAt: '2026-07-21T03:15:08.000Z' },
  { id: 'email-demo-002', deliveryKind: 'PASSWORD_RESET', templateKey: 'password-reset', category: 'SYSTEM', status: 'RETRY_SCHEDULED', attempts: 2, maxAttempts: 5, nextAttemptAt: '2026-07-21T07:30:00.000Z', createdAt: '2026-07-21T07:00:00.000Z', updatedAt: '2026-07-21T07:15:00.000Z', lastError: { code: 'TIMEOUT', occurredAt: '2026-07-21T07:15:00.000Z' } },
]
const outbox = ref<EmailOutboxSummary[]>(config.public.demoMode ? demoOutbox : [])

const categoryMeta: Record<NotificationCategory, { label: string; icon: string; tone: string }> = {
  ACADEMIC: { label: 'Akademik', icon: 'uil-graduation-cap', tone: 'blue' }, FINANCE: { label: 'Keuangan', icon: 'uil-wallet', tone: 'amber' }, LEARNING: { label: 'Pembelajaran', icon: 'uil-book-open', tone: 'forest' }, SERVICE: { label: 'Layanan', icon: 'uil-comment-alt-check', tone: 'coral' }, SYSTEM: { label: 'Sistem', icon: 'uil-shield', tone: 'slate' },
}
const categoryEntries = computed(() => (Object.entries(categoryMeta) as Array<[NotificationCategory, (typeof categoryMeta)[NotificationCategory]]>)
  .filter(([category]) => !isLmsMvp.value || lmsCategorySet.has(category)))
const profileNotifications = computed(() => isLmsMvp.value ? notifications.value.filter(item => lmsCategorySet.has(item.category)) : notifications.value)
const profileTemplates = computed(() => isLmsMvp.value ? templates.value.filter(item => lmsCategorySet.has(item.category)) : templates.value)
const profileOutbox = computed(() => isLmsMvp.value ? outbox.value.filter(item => item.category && lmsCategorySet.has(item.category)) : outbox.value)
const unreadCount = computed(() => profileNotifications.value.filter(item => !item.readAt).length)
const filtered = computed(() => profileNotifications.value.filter(item => filter.value === 'ALL' || (filter.value === 'UNREAD' ? !item.readAt : item.category === filter.value)))
const selected = computed(() => profileNotifications.value.find(item => item.id === selectedId.value) ?? filtered.value[0])
const dateTime = (value: string) => new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value))

const load = async () => {
  if (config.public.demoMode) return
  try {
    const [notificationsResponse, preferencesResponse] = await Promise.all([
      $api.get<{ notifications: InAppNotification[]; nextCursor?: string }>('/notifications'),
      $api.get<{ preferences: NotificationPreferences }>('/notifications/preferences'),
    ])
    notifications.value = notificationsResponse.data.notifications
    notificationCursor.value = notificationsResponse.data.nextCursor
    Object.assign(preferences, preferencesResponse.data.preferences)
    if (!emailAvailable.value) {
      preferences.emailEnabled = false
      for (const category of Object.keys(preferences.categoryEmail) as NotificationCategory[]) {
        preferences.categoryEmail[category] = false
      }
    }
    selectedId.value = notifications.value[0]?.id ?? ''
    if (isAdmin.value) {
      const [templateResponse, outboxResponse] = await Promise.all([
        $api.get<{ templates: NotificationTemplate[] }>('/notifications/templates'),
        $api.get<{ outbox: EmailOutboxSummary[] }>('/notifications/outbox'),
      ])
      templates.value = templateResponse.data.templates
      outbox.value = outboxResponse.data.outbox
    }
  } catch {
    errorMessage.value = 'Sebagian data notifikasi belum dapat dimuat.'
  }
}

const loadMoreNotifications = async () => {
  if (!notificationCursor.value || loadingMore.value) return
  loadingMore.value = true
  try {
    const { data } = await $api.get<{ notifications: InAppNotification[]; nextCursor?: string }>('/notifications', {
      params: { limit: 50, cursor: notificationCursor.value },
    })
    notifications.value = [...notifications.value, ...data.notifications]
    notificationCursor.value = data.nextCursor
  } catch {
    errorMessage.value = 'Notifikasi berikutnya belum dapat dimuat.'
  } finally {
    loadingMore.value = false
  }
}

const openNotification = async (item: InAppNotification) => {
  selectedId.value = item.id
  if (item.readAt) return
  const readAt = new Date().toISOString()
  notifications.value = notifications.value.map(record => record.id === item.id ? { ...record, readAt } : record)
  if (!config.public.demoMode) {
    try { await $api.post(`/notifications/${encodeURIComponent(item.id)}/read`) } catch { errorMessage.value = 'Status baca belum tersinkron.' }
  }
}

const savePreferences = async () => {
  saving.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    if (!config.public.demoMode) await $api.put('/notifications/preferences', {
      inAppEnabled: preferences.inAppEnabled,
      emailEnabled: emailAvailable.value && preferences.emailEnabled,
      categoryEmail: emailAvailable.value
        ? preferences.categoryEmail
        : Object.fromEntries(Object.keys(preferences.categoryEmail).map(category => [category, false])),
      quietHours: preferences.quietHours,
    })
    noticeMessage.value = 'Preferensi notifikasi berhasil disimpan.'
  } catch { errorMessage.value = 'Preferensi belum berhasil disimpan.' } finally { saving.value = false }
}

const toggleTemplate = async (template: NotificationTemplate) => {
  if (isLmsMvp.value) return
  const next = { ...template, active: !template.active, expectedVersion: template.version }
  if (config.public.demoMode) { template.active = next.active; template.version += 1; return }
  try {
    const { data } = await $api.put<{ template: NotificationTemplate }>(`/notifications/templates/${template.key}`, next)
    templates.value = templates.value.map(item => item.key === template.key ? data.template : item)
  } catch { errorMessage.value = 'Status template belum berhasil diperbarui.' }
}

const retryOutbox = async (record: EmailOutboxSummary) => {
  if (config.public.demoMode) { record.status = 'QUEUED'; record.nextAttemptAt = new Date().toISOString(); return }
  try {
    const { data } = await $api.post<{ outbox: EmailOutboxSummary }>(`/notifications/outbox/${record.id}/retry`)
    outbox.value = outbox.value.map(item => item.id === record.id ? data.outbox : item)
  } catch { errorMessage.value = 'Email belum dapat dijadwalkan ulang.' }
}

onMounted(() => {
  if (route.query.tab === 'preferences') activeTab.value = 'preferences'
  void load()
})
</script>

<template>
  <div class="page-stack notification-page">
    <AppPageHeader eyebrow="Komunikasi kampus" title="Pusat Notifikasi" :description="isLmsMvp ? 'Pembaruan pembelajaran dan sistem dalam satu kotak masuk.' : 'Satu kotak masuk untuk pembaruan akademik, keuangan, pembelajaran, dan layanan administratif.'">
      <template #actions><button class="btn btn-outline-secondary" type="button" @click="activeTab = 'preferences'"><i class="uil uil-sliders-v-alt me-2" />Atur preferensi</button></template>
    </AppPageHeader>
    <div v-if="noticeMessage" class="alert alert-success" role="status">{{ noticeMessage }}</div>
    <div v-if="errorMessage" class="alert alert-warning">{{ errorMessage }}</div>

    <nav class="notification-tabs" aria-label="Bagian pusat notifikasi">
      <button type="button" :class="{ active: activeTab === 'inbox' }" @click="activeTab = 'inbox'"><i class="uil uil-inbox" />Kotak masuk<span>{{ unreadCount }}</span></button>
      <button type="button" :class="{ active: activeTab === 'preferences' }" @click="activeTab = 'preferences'"><i class="uil uil-setting" />Preferensi</button>
      <button v-if="isAdmin" type="button" :class="{ active: activeTab === 'operations' }" @click="activeTab = 'operations'"><i class="uil uil-server-network" />Operasional</button>
    </nav>

    <section v-if="activeTab === 'inbox'" class="inbox-shell">
      <aside class="inbox-list">
        <header><div><span class="section-kicker">Kotak masuk</span><h2>{{ unreadCount }} belum dibaca</h2></div><select v-model="filter" class="form-select form-select-sm" aria-label="Filter notifikasi"><option value="ALL">Semua</option><option value="UNREAD">Belum dibaca</option><option v-for="[key,meta] in categoryEntries" :key="key" :value="key">{{ meta.label }}</option></select></header>
        <div v-if="filtered.length" class="notification-list">
          <button v-for="item in filtered" :key="item.id" type="button" :class="{ active: selected?.id === item.id, unread: !item.readAt }" @click="openNotification(item)"><span class="notification-icon" :class="`notification-icon--${categoryMeta[item.category].tone}`"><i class="uil" :class="categoryMeta[item.category].icon" /></span><span class="notification-copy"><span><strong>{{ item.title }}</strong><time :datetime="item.createdAt">{{ dateTime(item.createdAt) }}</time></span><small>{{ item.body }}</small></span><span v-if="!item.readAt" class="unread-dot" aria-label="Belum dibaca" /></button>
          <button v-if="notificationCursor" class="load-more" type="button" :disabled="loadingMore" @click="loadMoreNotifications">{{ loadingMore ? 'Memuat…' : 'Muat notifikasi berikutnya' }}</button>
        </div>
        <EmptyState v-else title="Tidak ada notifikasi" description="Notifikasi pada filter ini akan tampil di sini." />
      </aside>
      <article v-if="selected" class="notification-detail"><div class="detail-symbol" :class="`notification-icon--${categoryMeta[selected.category].tone}`"><i class="uil" :class="categoryMeta[selected.category].icon" /></div><span class="section-kicker">{{ categoryMeta[selected.category].label }}</span><h2>{{ selected.title }}</h2><time :datetime="selected.createdAt">{{ dateTime(selected.createdAt) }}</time><p>{{ selected.body }}</p><NuxtLink v-if="selected.actionPath" class="btn btn-primary btn-sm" :to="selected.actionPath">Buka detail <i class="uil uil-arrow-right ms-1" /></NuxtLink><div class="privacy-strip"><i class="uil uil-shield-check" /><span>Konten notifikasi tidak memuat kata sandi, token, atau dokumen privat.</span></div></article>
    </section>

    <section v-else-if="activeTab === 'preferences'" class="preferences-layout">
      <div v-if="!emailAvailable" class="alert alert-info email-capability" role="status">Pengiriman email belum diaktifkan pada paket awal. Notifikasi dalam aplikasi tetap berfungsi; administrator dapat mengaktifkan email setelah provider SMTP tersedia.</div>
      <article class="settings-card"><header><span class="settings-icon"><i class="uil uil-bell" /></span><div><span class="section-kicker">Kanal pengiriman</span><h2>Pilih cara menerima pembaruan</h2><p>Notifikasi sistem yang kritis tetap tersedia di portal.</p></div></header><label class="setting-row"><span><strong>Notifikasi dalam aplikasi</strong><small>Tampilkan pembaruan di pusat notifikasi.</small></span><input v-model="preferences.inAppEnabled" class="form-check-input" type="checkbox" role="switch"></label><label class="setting-row"><span><strong>Ringkasan melalui email</strong><small>{{ emailAvailable ? 'Kirim ke alamat email akun yang sudah diverifikasi.' : 'Belum tersedia sampai provider email diaktifkan.' }}</small></span><input v-model="preferences.emailEnabled" class="form-check-input" type="checkbox" role="switch" :disabled="!emailAvailable"></label></article>
      <article class="settings-card"><header><span class="settings-icon"><i class="uil uil-filter" /></span><div><span class="section-kicker">Kategori email</span><h2>Atur topik yang dikirim lewat email</h2></div></header><label v-for="[key,meta] in categoryEntries" :key="key" class="setting-row"><span><strong>{{ meta.label }}</strong><small>Pembaruan {{ meta.label.toLowerCase() }} yang relevan dengan akun Anda.</small></span><input v-model="preferences.categoryEmail[key]" class="form-check-input" type="checkbox" role="switch" :disabled="!emailAvailable || !preferences.emailEnabled"></label></article>
      <article class="settings-card quiet-card"><header><span class="settings-icon"><i class="uil uil-moon" /></span><div><span class="section-kicker">Jam tenang</span><h2>Tunda email non-kritis</h2><p>Zona waktu dikunci ke Asia/Jakarta agar jadwal konsisten.</p></div></header><div class="quiet-fields"><label>Mulai<input v-model="preferences.quietHours!.start" class="form-control" type="time"></label><label>Selesai<input v-model="preferences.quietHours!.end" class="form-control" type="time"></label></div><button class="btn btn-primary btn-sm mt-3" type="button" :disabled="saving" @click="savePreferences"><span v-if="saving" class="spinner-border spinner-border-sm me-2" />Simpan preferensi</button></article>
    </section>

    <section v-else class="operations-layout">
      <article class="operations-card"><header><div><span class="section-kicker">Template terkelola</span><h2>{{ profileTemplates.length }} template notifikasi</h2><p>{{ isLmsMvp ? 'Profil MVP menampilkan template pembelajaran dan sistem dalam mode baca-saja.' : 'Template menggunakan variabel terkontrol dan teks biasa untuk mencegah konten aktif.' }}</p></div><StatusBadge status="active" :label="isLmsMvp ? 'Baca-saja' : 'Server-side'" /></header><div class="template-list"><div v-for="template in profileTemplates" :key="template.key"><span class="notification-icon" :class="`notification-icon--${categoryMeta[template.category].tone}`"><i class="uil" :class="categoryMeta[template.category].icon" /></span><span><strong>{{ template.name }}</strong><small>{{ template.key }} - v{{ template.version }} - {{ template.channels.join(' + ') }}</small></span><StatusBadge v-if="isLmsMvp" :status="template.active ? 'active' : 'pending'" :label="template.active ? 'Aktif' : 'Nonaktif'" /><button v-else class="form-check form-switch" type="button" @click="toggleTemplate(template)"><input class="form-check-input" type="checkbox" :checked="template.active" tabindex="-1"><span class="visually-hidden">Ubah status template</span></button></div></div></article>
      <article class="operations-card"><header><div><span class="section-kicker">Email outbox</span><h2>Antrean pengiriman</h2><p>Panel hanya menampilkan metadata pengiriman; penerima, subjek, isi, dan detail provider tetap disembunyikan.</p></div><StatusBadge :status="profileOutbox.some(item => item.status === 'DEAD_LETTER') ? 'failed' : 'active'" /></header><div class="outbox-list"><div v-for="record in profileOutbox" :key="record.id"><span class="outbox-state"><i class="uil" :class="record.status === 'SENT' ? 'uil-check' : record.status === 'DEAD_LETTER' ? 'uil-times' : 'uil-clock'" /></span><span><strong>{{ record.templateKey }}</strong><small>{{ record.category ? categoryMeta[record.category].label : 'Kategori tidak tersedia' }} - {{ record.attempts }}/{{ record.maxAttempts }} percobaan - {{ dateTime(record.updatedAt) }}</small></span><StatusBadge :status="record.status === 'SENT' ? 'success' : record.status === 'DEAD_LETTER' ? 'failed' : 'pending'" :label="record.status.replaceAll('_',' ')" /><button v-if="['RETRY_SCHEDULED','DEAD_LETTER'].includes(record.status)" class="btn btn-sm btn-outline-secondary" type="button" aria-label="Jadwalkan ulang email" @click="retryOutbox(record)"><i class="uil uil-redo" /></button></div></div></article>
    </section>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.notification-tabs { display:flex; gap:.35rem; padding:.35rem; border:1px solid #e1e9e5; border-radius:.8rem; background:#fff; width:max-content; }.notification-tabs button { display:flex; align-items:center; gap:.45rem; padding:.55rem .75rem; border:0; border-radius:.55rem; color:#71857c; background:transparent; font-size:.65rem; }.notification-tabs button.active { color:#255f4c; background:#eaf4ef; font-weight:600; }.notification-tabs button span { display:grid; place-items:center; min-width:1.2rem; height:1.2rem; padding:0 .25rem; border-radius:999px; color:#fff; background:#377a61; font-size:.5rem; }.inbox-shell { display:grid; grid-template-columns:minmax(0,1fr) minmax(300px,.7fr); min-height:560px; overflow:hidden; border:1px solid #e0e8e4; border-radius:1rem; background:#fff; box-shadow:0 12px 34px rgba(24,62,49,.06); }.inbox-list { border-right:1px solid #e5ebe8; }.inbox-list>header { display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:1rem; border-bottom:1px solid #e8eeeb; }.inbox-list h2 { margin:.15rem 0 0; color:#2d5043; font-size:.85rem; }.inbox-list select { width:145px; }.notification-list { display:grid; }.notification-list>button { display:grid; grid-template-columns:auto minmax(0,1fr) auto; gap:.7rem; align-items:center; width:100%; padding:.85rem 1rem; border:0; border-bottom:1px solid #edf1ef; text-align:left; background:#fff; }.notification-list>button:hover,.notification-list>button.active { background:#f5f9f7; }.notification-list>button.unread { background:#fbfdfc; }.notification-icon,.detail-symbol { display:grid; place-items:center; border-radius:.7rem; }.notification-icon { width:2.25rem; height:2.25rem; }.detail-symbol { width:3.2rem; height:3.2rem; margin-bottom:1rem; font-size:1.25rem; }.notification-icon--forest { color:#2e7358; background:#e6f2eb; }.notification-icon--blue { color:#336f9c; background:#e8f1f8; }.notification-icon--amber { color:#9a6a22; background:#fbf0da; }.notification-icon--coral { color:#a75748; background:#f8e9e6; }.notification-icon--slate { color:#65756f; background:#edf0ef; }.notification-copy { min-width:0; }.notification-copy>span { display:flex; gap:.6rem; justify-content:space-between; }.notification-copy strong { overflow:hidden; color:#345449; font-size:.65rem; text-overflow:ellipsis; white-space:nowrap; }.notification-copy time { flex:0 0 auto; color:#8d9a95; font-size:.5rem; }.notification-copy small { display:block; margin-top:.2rem; overflow:hidden; color:#778981; font-size:.58rem; text-overflow:ellipsis; white-space:nowrap; }.unread-dot { width:.42rem; height:.42rem; border-radius:50%; background:#2e7b5b; box-shadow:0 0 0 3px #e5f3eb; }.notification-detail { display:flex; align-items:flex-start; flex-direction:column; padding:2rem; background:linear-gradient(155deg,#fff,#f8fbf9); }.notification-detail h2 { margin:.3rem 0; color:#274d3f; font-size:1.2rem; }.notification-detail time { color:#899791; font-size:.58rem; }.notification-detail>p { max-width:540px; margin:1.1rem 0; color:#5f756c; font-size:.72rem; line-height:1.75; }.privacy-strip { display:flex; gap:.5rem; width:100%; margin-top:auto; padding:.7rem; border-radius:.7rem; color:#688078; background:#edf4f0; font-size:.58rem; }
.preferences-layout,.operations-layout { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1rem; align-items:start; }.email-capability{grid-column:1/-1;margin:0}.settings-card,.operations-card { overflow:hidden; border:1px solid #e0e8e4; border-radius:1rem; background:#fff; box-shadow:0 10px 28px rgba(24,62,49,.05); }.settings-card>header,.operations-card>header { display:flex; align-items:center; gap:.7rem; padding:1rem; border-bottom:1px solid #e8eeeb; }.settings-card h2,.operations-card h2 { margin:.12rem 0; color:#2d5144; font-size:.8rem; }.settings-card header p,.operations-card header p { margin:0; color:#82918b; font-size:.56rem; }.settings-icon { display:grid; place-items:center; flex:0 0 auto; width:2.5rem; height:2.5rem; border-radius:.7rem; color:#34745b; background:#e7f3ec; }.setting-row { display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:.8rem 1rem; border-bottom:1px solid #eef1ef; }.setting-row strong,.setting-row small { display:block; }.setting-row strong { color:#456359; font-size:.63rem; }.setting-row small { margin-top:.15rem; color:#87958f; font-size:.54rem; }.setting-row .form-check-input { width:2rem; height:1.05rem; }.quiet-card { padding-bottom:1rem; }.quiet-fields { display:grid; grid-template-columns:1fr 1fr; gap:.75rem; padding:1rem 1rem 0; }.quiet-fields label { color:#60766d; font-size:.58rem; }.quiet-fields input { margin-top:.25rem; font-size:.65rem; }.quiet-card>.btn { margin-left:1rem; }.operations-layout { grid-template-columns:1fr; }.operations-card>header { justify-content:space-between; }.template-list,.outbox-list { display:grid; }.template-list>div,.outbox-list>div { display:flex; align-items:center; gap:.7rem; padding:.75rem 1rem; border-bottom:1px solid #edf1ef; }.template-list>div>span:nth-child(2),.outbox-list>div>span:nth-child(2) { min-width:0; flex:1; }.template-list strong,.template-list small,.outbox-list strong,.outbox-list small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.template-list strong,.outbox-list strong { color:#405f54; font-size:.63rem; }.template-list small,.outbox-list small { margin-top:.17rem; color:#899790; font-size:.53rem; }.template-list button { border:0; background:transparent; }.outbox-state { display:grid; place-items:center; width:2rem; height:2rem; border-radius:.6rem; color:#39735c; background:#eaf3ee; }.outbox-list .status-badge { flex:0 0 auto; }
.notification-list>button.load-more{display:block;color:#356b57;text-align:center;font-size:.58rem;font-weight:700}
@media(max-width:991.98px){.inbox-shell{grid-template-columns:1fr}.inbox-list{border-right:0}.notification-detail{min-height:350px;border-top:1px solid #e5ebe8}.preferences-layout{grid-template-columns:1fr}}
@media(max-width:575.98px){.notification-tabs{width:100%;overflow:auto}.notification-tabs button{flex:1;justify-content:center;white-space:nowrap}.inbox-list>header{align-items:flex-start;flex-direction:column}.inbox-list select{width:100%}.notification-detail{padding:1.2rem}.notification-copy time{display:none}.template-list>div,.outbox-list>div{align-items:flex-start;flex-wrap:wrap}.outbox-list>div>span:nth-child(2){flex-basis:calc(100% - 3rem)}.outbox-list .status-badge{margin-left:2.7rem}}
</style>
