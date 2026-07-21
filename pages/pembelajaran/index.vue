<script setup lang="ts">
import type { AxiosError } from 'axios'
import type {
  LearningAssignment,
  LearningForumPost,
  LearningForumThread,
  LearningGrade,
  LearningMaterial,
  LearningModule,
  LearningProgressDashboard,
  LearningSpace,
  LearningSpaceDetail,
  LearningSubmission,
  LearningSubmissionAttempt,
  SafeRichContent,
} from '~/server/types/learning'
import type { SignedDownloadResult } from '~/server/types/files'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Pembelajaran' })

interface ReviewRow {
  submission: LearningSubmission
  attempts: LearningSubmissionAttempt[]
  grade?: LearningGrade
}

const { user } = useAuth()
const { $api } = useNuxtApp()
const spaces = ref<LearningSpace[]>([])
const selectedSpaceId = ref('')
const detail = ref<LearningSpaceDetail | null>(null)
const dashboard = ref<LearningProgressDashboard | null>(null)
const threads = ref<LearningForumThread[]>([])
const selectedThread = ref<LearningForumThread | null>(null)
const posts = ref<LearningForumPost[]>([])
const reviewRows = ref<ReviewRow[]>([])
const activeView = ref<'overview' | 'materials' | 'assignments' | 'forum' | 'manage'>('overview')
const loading = ref(true)
const busy = ref(false)
const errorMessage = ref('')
const notice = ref('')

const selectedAssignment = ref<LearningAssignment | null>(null)
const draftText = ref('')
const draftFileIds = ref('')
const selectedReviewAssignment = ref<LearningAssignment | null>(null)
const gradeDrafts = reactive<Record<string, { score: number; feedback: string; status: 'DRAFT' | 'PUBLISHED' }>>({})

const forumDraft = reactive({ title: '', body: '' })
const replyDraft = ref('')
const moduleDraft = reactive({ title: '', description: '', status: 'DRAFT' as 'DRAFT' | 'PUBLISHED' })
const materialDraft = reactive({ moduleId: '', title: '', summary: '', kind: 'RICH_TEXT' as 'RICH_TEXT' | 'FILE' | 'EXTERNAL_LINK', value: '', status: 'DRAFT' as 'DRAFT' | 'PUBLISHED' })
const assignmentDraft = reactive({ moduleId: '', title: '', instructions: '', opensAt: '', dueAt: '', closesAt: '', maximumPoints: 100, maximumAttempts: 2, maximumFiles: 2, status: 'DRAFT' as 'DRAFT' | 'PUBLISHED' })
const announcementDraft = reactive({ title: '', body: '', pinned: false })
const spaceDraft = reactive({ academicClassId: '', title: '', gamificationAvailable: false })

const canManage = computed(() => Boolean(detail.value?.canManage))
const ownSubmission = computed(() => detail.value?.ownSubmissions.find(item => item.assignmentId === selectedAssignment.value?.id))
const selectedSpace = computed(() => spaces.value.find(item => item.id === selectedSpaceId.value))
const upcomingAssignments = computed(() => detail.value?.assignments.filter(item => item.status === 'PUBLISHED').sort((a, b) => a.dueAt.localeCompare(b.dueAt)) || [])
const publishedModules = computed(() => detail.value?.modules.filter(item => item.status === 'PUBLISHED') || [])
const moduleMaterials = (moduleId: string) => detail.value?.materials.filter(item => item.moduleId === moduleId) || []

function requestKey(prefix: string) {
  return `${prefix}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
}

function plain(content?: SafeRichContent): string {
  if (!content) return ''
  return content.format === 'PLAIN_TEXT' ? content.text : content.ops.map(operation => operation.insert).join('')
}

function errorText(error: unknown): string {
  const data = (error as AxiosError<{ statusMessage?: string; message?: string }>).response?.data
  return data?.statusMessage || data?.message || (error instanceof Error ? error.message : 'Permintaan pembelajaran gagal diproses.')
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value))
}

function toLocal(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function initializeAssignmentWindow() {
  const opens = new Date(), due = new Date(opens.getTime() + 7 * 86_400_000), close = new Date(opens.getTime() + 10 * 86_400_000)
  assignmentDraft.opensAt = toLocal(opens); assignmentDraft.dueAt = toLocal(due); assignmentDraft.closesAt = toLocal(close)
}

function assignmentState(item: LearningAssignment) {
  const now = Date.now()
  if (item.status !== 'PUBLISHED' || now < Date.parse(item.opensAt)) return { label: 'Belum dibuka', tone: 'scheduled' }
  if (now >= Date.parse(item.closesAt)) return { label: 'Ditutup', tone: 'draft' }
  if (now > Date.parse(item.dueAt)) return { label: 'Masa terlambat', tone: 'pending' }
  return { label: 'Berjalan', tone: 'active' }
}

async function loadSpaces() {
  const { data } = await $api.get<{ spaces: LearningSpace[] }>('/learning/spaces', { params: { limit: 100 } })
  spaces.value = data.spaces
  if (!spaces.value.some(item => item.id === selectedSpaceId.value)) selectedSpaceId.value = spaces.value[0]?.id || ''
}

async function loadSelectedSpace() {
  if (!selectedSpaceId.value) { detail.value = null; dashboard.value = null; threads.value = []; return }
  const [detailResponse, dashboardResponse, threadResponse] = await Promise.all([
    $api.get<LearningSpaceDetail>(`/learning/spaces/${selectedSpaceId.value}`),
    $api.get<LearningProgressDashboard>(`/learning/spaces/${selectedSpaceId.value}/dashboard`),
    $api.get<{ items: LearningForumThread[] }>(`/learning/spaces/${selectedSpaceId.value}/forum/threads`, { params: { limit: 50 } }),
  ])
  detail.value = detailResponse.data
  dashboard.value = dashboardResponse.data
  threads.value = threadResponse.data.items
  selectedThread.value = null; posts.value = []; reviewRows.value = []
  if (!detail.value.modules.some(item => item.id === materialDraft.moduleId)) materialDraft.moduleId = detail.value.modules[0]?.id || ''
  if (!detail.value.modules.some(item => item.id === assignmentDraft.moduleId)) assignmentDraft.moduleId = detail.value.modules[0]?.id || ''
}

async function initialize() {
  loading.value = true; errorMessage.value = ''
  try { await loadSpaces(); await loadSelectedSpace() } catch (error) { errorMessage.value = errorText(error) } finally { loading.value = false }
}

async function reload(message?: string) {
  await loadSelectedSpace()
  if (message) notice.value = message
}

function openAssignment(item: LearningAssignment) {
  selectedAssignment.value = item
  const existing = detail.value?.ownSubmissions.find(submission => submission.assignmentId === item.id)
  draftText.value = plain(existing?.draftContent)
  draftFileIds.value = existing?.draftFiles.map(file => file.fileId).join(', ') || ''
}

async function saveDraft() {
  if (!selectedAssignment.value || busy.value) return
  busy.value = true; errorMessage.value = ''
  try {
    const { data } = await $api.put<{ submission: LearningSubmission }>(`/learning/assignments/${selectedAssignment.value.id}/draft`, {
      expectedVersion: ownSubmission.value?.version || 0,
      content: draftText.value.trim() ? { format: 'PLAIN_TEXT', text: draftText.value } : undefined,
      fileIds: draftFileIds.value.split(',').map(item => item.trim()).filter(Boolean),
    }, { headers: { 'Idempotency-Key': requestKey('learning-draft') } })
    if (detail.value) detail.value.ownSubmissions = [...detail.value.ownSubmissions.filter(item => item.id !== data.submission.id), data.submission]
    notice.value = 'Draf tersimpan. Draf belum dianggap sebagai pengumpulan final.'
  } catch (error) { errorMessage.value = errorText(error) } finally { busy.value = false }
}

async function submitFinal() {
  if (!selectedAssignment.value || !ownSubmission.value || busy.value) return
  busy.value = true
  try {
    await $api.post(`/learning/assignments/${selectedAssignment.value.id}/submit`, { expectedVersion: ownSubmission.value.version }, { headers: { 'Idempotency-Key': requestKey('learning-final') } })
    selectedAssignment.value = null
    await reload('Pengumpulan final tercatat sebagai percobaan immutable.')
  } catch (error) { errorMessage.value = errorText(error) } finally { busy.value = false }
}

async function reviewAssignment(item: LearningAssignment) {
  selectedReviewAssignment.value = item
  const { data } = await $api.get<{ submissions: ReviewRow[] }>(`/learning/assignments/${item.id}/submissions`)
  reviewRows.value = data.submissions
  for (const row of reviewRows.value) {
    gradeDrafts[row.submission.studentId] = { score: row.grade?.score || 0, feedback: plain(row.grade?.feedback), status: row.grade?.status || 'DRAFT' }
  }
}

async function saveGrade(row: ReviewRow) {
  const attempt = row.attempts.at(-1), draft = gradeDrafts[row.submission.studentId]
  if (!attempt || !draft || busy.value) return
  busy.value = true
  try {
    const { data } = await $api.put<{ grade: LearningGrade }>(`/learning/attempts/${attempt.id}/grade`, {
      expectedVersion: row.grade?.version || 0, score: draft.score, feedback: { format: 'PLAIN_TEXT', text: draft.feedback }, status: draft.status,
    })
    row.grade = data.grade
    notice.value = draft.status === 'PUBLISHED' ? 'Nilai dan umpan balik dipublikasikan.' : 'Draf nilai tersimpan.'
  } catch (error) { errorMessage.value = errorText(error) } finally { busy.value = false }
}

async function downloadMaterial(item: LearningMaterial) {
  if (!item.file) return
  try {
    const { data } = await $api.post<SignedDownloadResult>(`/files/${item.file.fileId}/download`, { version: item.file.fileVersion })
    if (import.meta.client) window.location.assign(data.url)
  } catch (error) { errorMessage.value = errorText(error) }
}

async function openThread(thread: LearningForumThread) {
  selectedThread.value = thread
  const { data } = await $api.get<{ items: LearningForumPost[] }>(`/learning/forum/threads/${thread.id}/posts`, { params: { limit: 50 } })
  posts.value = data.items
}

async function createThread() {
  if (!forumDraft.title.trim() || !forumDraft.body.trim() || busy.value || !selectedSpaceId.value) return
  busy.value = true
  try {
    await $api.post(`/learning/spaces/${selectedSpaceId.value}/forum/threads`, { title: forumDraft.title, body: { format: 'PLAIN_TEXT', text: forumDraft.body } }, { headers: { 'Idempotency-Key': requestKey('learning-thread') } })
    forumDraft.title = ''; forumDraft.body = ''; await reload('Topik forum dipublikasikan.')
  } catch (error) { errorMessage.value = errorText(error) } finally { busy.value = false }
}

async function replyThread(parentPostId?: string) {
  if (!selectedThread.value || !replyDraft.value.trim() || busy.value) return
  busy.value = true
  try {
    await $api.post(`/learning/forum/threads/${selectedThread.value.id}/posts`, { parentPostId, body: { format: 'PLAIN_TEXT', text: replyDraft.value } }, { headers: { 'Idempotency-Key': requestKey('learning-reply') } })
    replyDraft.value = ''; await openThread(selectedThread.value); notice.value = 'Balasan forum ditambahkan.'
  } catch (error) { errorMessage.value = errorText(error) } finally { busy.value = false }
}

async function toggleGamification() {
  if (!dashboard.value || busy.value) return
  busy.value = true
  try {
    await $api.put(`/learning/spaces/${dashboard.value.spaceId}/gamification`, { optedIn: !dashboard.value.gamification.optedIn, expectedVersion: dashboard.value.gamification.preferenceVersion }, { headers: { 'Idempotency-Key': requestKey('learning-game') } })
    await reload('Preferensi poin sukarela diperbarui.')
  } catch (error) { errorMessage.value = errorText(error) } finally { busy.value = false }
}

async function createModule() {
  if (!moduleDraft.title.trim() || busy.value) return
  busy.value = true
  try { await $api.post(`/learning/spaces/${selectedSpaceId.value}/modules`, { title: moduleDraft.title, description: moduleDraft.description.trim() ? { format: 'PLAIN_TEXT', text: moduleDraft.description } : undefined, order: (detail.value?.modules.length || 0) + 1, status: moduleDraft.status }, { headers: { 'Idempotency-Key': requestKey('learning-module') } }); moduleDraft.title = ''; moduleDraft.description = ''; await reload('Modul versi pertama dibuat.') } catch (error) { errorMessage.value = errorText(error) } finally { busy.value = false }
}

async function createMaterial() {
  if (!materialDraft.moduleId || !materialDraft.title.trim() || !materialDraft.value.trim() || busy.value) return
  busy.value = true
  const conditional = materialDraft.kind === 'RICH_TEXT' ? { content: { format: 'PLAIN_TEXT', text: materialDraft.value } } : materialDraft.kind === 'FILE' ? { fileId: materialDraft.value } : { externalUrl: materialDraft.value }
  try { await $api.post(`/learning/spaces/${selectedSpaceId.value}/materials`, { moduleId: materialDraft.moduleId, title: materialDraft.title, summary: materialDraft.summary, kind: materialDraft.kind, ...conditional, order: (detail.value?.materials.length || 0) + 1, status: materialDraft.status }, { headers: { 'Idempotency-Key': requestKey('learning-material') } }); materialDraft.title = ''; materialDraft.summary = ''; materialDraft.value = ''; await reload('Materi tersimpan dengan referensi file atau konten terstruktur yang aman.') } catch (error) { errorMessage.value = errorText(error) } finally { busy.value = false }
}

async function createAssignment() {
  if (!assignmentDraft.title.trim() || !assignmentDraft.instructions.trim() || busy.value) return
  busy.value = true
  try { await $api.post(`/learning/spaces/${selectedSpaceId.value}/assignments`, { ...assignmentDraft, moduleId: assignmentDraft.moduleId || undefined, instructions: { format: 'PLAIN_TEXT', text: assignmentDraft.instructions }, opensAt: new Date(assignmentDraft.opensAt).toISOString(), dueAt: new Date(assignmentDraft.dueAt).toISOString(), closesAt: new Date(assignmentDraft.closesAt).toISOString() }, { headers: { 'Idempotency-Key': requestKey('learning-assignment') } }); assignmentDraft.title = ''; assignmentDraft.instructions = ''; await reload('Tugas tersimpan dengan jendela pengumpulan yang eksplisit.') } catch (error) { errorMessage.value = errorText(error) } finally { busy.value = false }
}

async function createAnnouncement() {
  if (!announcementDraft.title.trim() || !announcementDraft.body.trim() || busy.value) return
  busy.value = true
  try { await $api.post(`/learning/spaces/${selectedSpaceId.value}/announcements`, { title: announcementDraft.title, body: { format: 'PLAIN_TEXT', text: announcementDraft.body }, pinned: announcementDraft.pinned }, { headers: { 'Idempotency-Key': requestKey('learning-announcement') } }); announcementDraft.title = ''; announcementDraft.body = ''; announcementDraft.pinned = false; await reload('Pengumuman kelas dipublikasikan.') } catch (error) { errorMessage.value = errorText(error) } finally { busy.value = false }
}

async function createClassSpace() {
  if (!spaceDraft.academicClassId.trim() || !spaceDraft.title.trim() || busy.value) return
  busy.value = true
  try { await $api.post('/learning/spaces', { kind: 'ACADEMIC_CLASS', academicClassId: spaceDraft.academicClassId, title: spaceDraft.title, gamificationAvailable: spaceDraft.gamificationAvailable }, { headers: { 'Idempotency-Key': requestKey('learning-space') } }); await loadSpaces(); await loadSelectedSpace(); notice.value = 'Ruang terhubung ke roster dan dosen kelas akademik.' } catch (error) { errorMessage.value = errorText(error) } finally { busy.value = false }
}

watch(selectedSpaceId, () => { if (!loading.value) loadSelectedSpace().catch(error => { errorMessage.value = errorText(error) }) })
initializeAssignmentWindow()
onMounted(initialize)
</script>

<template>
  <div class="learning-page page-stack">
    <AppPageHeader eyebrow="Ruang belajar" title="Pembelajaran" description="Materi aman, tugas dengan jendela waktu jelas, diskusi kelas, pengumpulan final, dan umpan balik dosen dalam satu alur.">
      <template #actions><button v-if="canManage" class="btn btn-outline-secondary" type="button" @click="activeView = 'manage'"><i class="uil uil-setting me-2" />Kelola ruang</button><button class="btn btn-primary" type="button" @click="activeView = 'assignments'"><i class="uil uil-clipboard-notes me-2" />Buka tugas</button></template>
    </AppPageHeader>
    <div v-if="errorMessage" class="alert alert-danger" role="alert">{{ errorMessage }}</div>
    <div v-if="notice" class="alert alert-success" role="status">{{ notice }}</div>
    <div v-if="loading" class="learning-loading"><span class="spinner-border spinner-border-sm" />Memuat ruang pembelajaran…</div>

    <template v-else>
      <section class="learning-toolbar">
        <label><span>Ruang</span><select v-model="selectedSpaceId" class="form-select"><option v-for="space in spaces" :key="space.id" :value="space.id">{{ space.courseCode ? `${space.courseCode} · ` : '' }}{{ space.title }}</option></select></label>
        <nav aria-label="Bagian pembelajaran"><button v-for="tab in [{id:'overview',label:'Ringkasan',icon:'uil-chart-pie'},{id:'materials',label:'Materi',icon:'uil-books'},{id:'assignments',label:'Tugas',icon:'uil-clipboard-notes'},{id:'forum',label:'Forum',icon:'uil-comments-alt'}]" :key="tab.id" :class="{ active: activeView === tab.id }" @click="activeView = tab.id as typeof activeView"><i class="uil" :class="tab.icon" />{{ tab.label }}</button></nav>
      </section>

      <section v-if="!spaces.length" class="empty-learning"><i class="uil uil-books" /><h2>Belum ada ruang yang dapat diakses</h2><p>Ruang kelas muncul setelah ditautkan ke kelas akademik atau Anda ditambahkan ke ruang GENERAL/MOOC.</p><form v-if="['administrator','academic_staff'].includes(user?.activeRole || '')" @submit.prevent="createClassSpace"><input v-model="spaceDraft.academicClassId" class="form-control" placeholder="ID kelas akademik"><input v-model="spaceDraft.title" class="form-control" placeholder="Judul ruang"><button class="btn btn-primary" :disabled="busy">Hubungkan kelas</button></form></section>

      <template v-else-if="detail && dashboard">
        <section class="space-hero"><div><span>{{ detail.space.kind.replace('_',' ') }} · {{ detail.space.periodId || 'lintas periode' }}</span><h2>{{ detail.space.title }}</h2><p>{{ detail.space.description || 'Ruang pembelajaran aktif.' }}</p></div><aside><strong>{{ detail.space.courseCode || 'OPEN' }}</strong><small>{{ detail.space.section ? `Kelas ${detail.space.section}` : detail.space.kind }}</small></aside></section>

        <template v-if="activeView === 'overview'">
          <section class="learning-metrics"><article><i class="uil uil-layer-group" /><span>Modul terbit</span><strong>{{ dashboard.modulesPublished }}</strong></article><article><i class="uil uil-file-check-alt" /><span>Materi terbit</span><strong>{{ dashboard.materialsPublished }}</strong></article><article><i class="uil uil-clipboard-check" /><span>Progres</span><strong>{{ dashboard.completionPercent }}%</strong></article><article><i class="uil uil-clock" /><span>Terlambat</span><strong>{{ dashboard.lateSubmissions }}</strong></article></section>
          <div class="overview-grid"><section class="surface announcements"><header><div><span class="section-kicker">Pengumuman kelas</span><h2>Pembaruan penting</h2></div></header><article v-for="item in detail.announcements" :key="item.id" :class="{ pinned: item.pinned }"><i class="uil" :class="item.pinned ? 'uil-thumbtack' : 'uil-megaphone'" /><div><strong>{{ item.title }}</strong><p>{{ plain(item.body) }}</p><small>{{ dateTime(item.createdAt) }}</small></div></article><div v-if="!detail.announcements.length" class="mini-empty">Belum ada pengumuman.</div></section>
          <section class="surface activity"><header><div><span class="section-kicker">Aktivitas terbaru</span><h2>Yang baru di ruang</h2></div></header><ol><li v-for="item in dashboard.recentActivity" :key="item.id"><span><i class="uil uil-bolt-alt" /></span><div><strong>{{ item.label }}</strong><p>{{ item.kind.replaceAll('_',' ') }}</p><small>{{ dateTime(item.occurredAt) }}</small></div></li></ol></section></div>
          <section v-if="dashboard.gamification.available" class="gamification-card"><i class="uil uil-trophy" /><div><strong>Poin aktivitas sukarela</strong><p>{{ dashboard.gamification.explanation }}</p><ul><li v-for="rule in dashboard.gamification.rules" :key="rule.id">{{ rule.label }} · {{ rule.points }} poin, maksimum {{ rule.maximumPerSpace }}</li></ul></div><aside><strong>{{ dashboard.gamification.points }}</strong><small>poin transparan</small><button class="btn btn-sm" :class="dashboard.gamification.optedIn ? 'btn-outline-secondary' : 'btn-primary'" :disabled="busy" @click="toggleGamification">{{ dashboard.gamification.optedIn ? 'Nonaktifkan' : 'Ikut serta' }}</button></aside></section>
        </template>

        <section v-else-if="activeView === 'materials'" class="module-stack"><article v-for="module in publishedModules" :key="module.id" class="surface module-card"><header><span>{{ module.order.toString().padStart(2,'0') }}</span><div><h2>{{ module.title }}</h2><p>{{ plain(module.description) }}</p></div></header><div class="material-list"><article v-for="item in moduleMaterials(module.id)" :key="item.id"><span class="material-icon"><i class="uil" :class="item.kind === 'FILE' ? 'uil-file-download' : item.kind === 'EXTERNAL_LINK' ? 'uil-external-link-alt' : 'uil-file-alt'" /></span><div><small>{{ item.kind.replace('_',' ') }}</small><strong>{{ item.title }}</strong><p>{{ item.summary || plain(item.content).slice(0,180) }}</p><span v-if="item.file">{{ item.file.fileName }} · v{{ item.file.fileVersion }}</span></div><button v-if="item.file" class="btn btn-sm btn-outline-secondary" @click="downloadMaterial(item)">Unduh</button><a v-else-if="item.externalUrl" class="btn btn-sm btn-outline-secondary" :href="item.externalUrl" target="_blank" rel="noopener noreferrer">Buka</a></article><div v-if="!moduleMaterials(module.id).length" class="mini-empty">Belum ada materi terbit.</div></div></article></section>

        <section v-else-if="activeView === 'assignments'" class="assignment-shell"><div class="assignment-list surface"><header><div><span class="section-kicker">Jendela pengumpulan</span><h2>Tugas ruang ini</h2></div></header><button v-for="item in upcomingAssignments" :key="item.id" :class="{ active: selectedAssignment?.id === item.id || selectedReviewAssignment?.id === item.id }" @click="canManage ? reviewAssignment(item) : openAssignment(item)"><span class="assignment-state" :class="`state-${assignmentState(item).tone}`">{{ assignmentState(item).label }}</span><strong>{{ item.title }}</strong><small>Dibuka {{ dateTime(item.opensAt) }}</small><small>Tenggat {{ dateTime(item.dueAt) }}</small><span>{{ item.maximumAttempts }} percobaan · {{ item.maximumPoints }} poin</span></button><div v-if="!upcomingAssignments.length" class="mini-empty">Belum ada tugas terbit.</div></div>
          <section v-if="!canManage && selectedAssignment" class="surface submission-editor"><header><div><span class="section-kicker">Draf daring</span><h2>{{ selectedAssignment.title }}</h2><p>{{ plain(selectedAssignment.instructions) }}</p></div></header><div class="editor-body"><label><span>Jawaban</span><textarea v-model="draftText" class="form-control" rows="8" maxlength="20000" placeholder="Tulis jawaban sebagai teks aman…" /></label><label><span>ID file privat CLEAN (pisahkan koma)</span><input v-model="draftFileIds" class="form-control" placeholder="file_abcd…"><small>Unggah dan pindai file terlebih dahulu melalui menu Berkas.</small></label><div class="window-note"><i class="uil uil-clock" /><p>Final setelah tenggat tetapi sebelum {{ dateTime(selectedAssignment.closesAt) }} ditandai terlambat. Percobaan final tidak dapat diubah.</p></div></div><footer><button class="btn btn-outline-secondary" :disabled="busy" @click="saveDraft">Simpan draf</button><button class="btn btn-primary" :disabled="busy || !ownSubmission || ownSubmission.status !== 'DRAFT'" @click="submitFinal">Kirim final</button></footer></section>
          <section v-else-if="canManage && selectedReviewAssignment" class="surface grading-panel"><header><div><span class="section-kicker">Penilaian & umpan balik</span><h2>{{ selectedReviewAssignment.title }}</h2><p>Nilai selalu merujuk percobaan final tertentu.</p></div></header><article v-for="row in reviewRows" :key="row.submission.id"><div class="review-meta"><strong>{{ row.submission.studentId }}</strong><span>{{ row.attempts.length }} percobaan · {{ row.attempts.at(-1)?.timeliness }}</span></div><label><span>Nilai</span><input v-model.number="gradeDrafts[row.submission.studentId]!.score" class="form-control" type="number" min="0" :max="selectedReviewAssignment.maximumPoints"></label><label><span>Umpan balik</span><textarea v-model="gradeDrafts[row.submission.studentId]!.feedback" class="form-control" rows="2" /></label><select v-model="gradeDrafts[row.submission.studentId]!.status" class="form-select"><option value="DRAFT">Draf</option><option value="PUBLISHED">Publikasikan</option></select><button class="btn btn-sm btn-primary" :disabled="busy" @click="saveGrade(row)">Simpan</button></article><div v-if="!reviewRows.length" class="mini-empty">Belum ada pengumpulan final.</div></section>
          <section v-else class="surface assignment-placeholder"><i class="uil uil-mouse-alt" /><strong>Pilih tugas</strong><p>{{ canManage ? 'Tinjau percobaan dan berikan nilai.' : 'Simpan draf lalu kirim percobaan final.' }}</p></section></section>

        <section v-else-if="activeView === 'forum'" class="forum-shell"><div class="surface thread-list"><header><div><span class="section-kicker">Diskusi terstruktur</span><h2>Topik forum</h2></div></header><button v-for="thread in threads" :key="thread.id" :class="{ active: selectedThread?.id === thread.id }" @click="openThread(thread)"><span><i class="uil uil-comment-alt-lines" /></span><div><strong>{{ thread.title }}</strong><small>{{ thread.replyCount }} balasan · {{ thread.status }}</small></div></button><form @submit.prevent="createThread"><input v-model="forumDraft.title" class="form-control" maxlength="180" placeholder="Judul topik"><textarea v-model="forumDraft.body" class="form-control" rows="3" maxlength="10000" placeholder="Isi topik tanpa HTML…" /><button class="btn btn-sm btn-primary" :disabled="busy">Buat topik</button></form></div><section v-if="selectedThread" class="surface discussion"><header><div><span class="section-kicker">Topik dipilih</span><h2>{{ selectedThread.title }}</h2><p>{{ plain(selectedThread.body) }}</p></div><span>{{ selectedThread.status }}</span></header><div class="post-list"><article v-for="post in posts" :key="post.id" :class="{ nested: post.depth === 1 }"><span>{{ post.authorUid.slice(0,2).toUpperCase() }}</span><div><strong>{{ post.authorUid }}</strong><p>{{ plain(post.body) }}</p><small>{{ dateTime(post.createdAt) }}<template v-if="post.editHistory.length"> · diedit {{ post.editHistory.length }}×</template></small></div></article></div><form v-if="selectedThread.status === 'OPEN'" @submit.prevent="replyThread()"><textarea v-model="replyDraft" class="form-control" rows="3" maxlength="10000" placeholder="Tulis balasan aman…" /><button class="btn btn-primary" :disabled="busy">Kirim balasan</button></form></section><section v-else class="surface assignment-placeholder"><i class="uil uil-comments-alt" /><strong>Pilih topik</strong><p>Balasan dibatasi dua tingkat dan 200 kiriman per topik.</p></section></section>

        <section v-else-if="activeView === 'manage' && canManage" class="manage-grid"><form class="surface manage-card" @submit.prevent="createModule"><header><span class="section-kicker">Struktur versi</span><h2>Modul baru</h2></header><label><span>Judul</span><input v-model="moduleDraft.title" class="form-control" required></label><label><span>Deskripsi</span><textarea v-model="moduleDraft.description" class="form-control" rows="2" /></label><select v-model="moduleDraft.status" class="form-select"><option value="DRAFT">Draf</option><option value="PUBLISHED">Terbit</option></select><button class="btn btn-primary" :disabled="busy">Simpan modul</button></form>
          <form class="surface manage-card" @submit.prevent="createMaterial"><header><span class="section-kicker">File & konten aman</span><h2>Materi baru</h2></header><select v-model="materialDraft.moduleId" class="form-select"><option v-for="module in detail.modules" :key="module.id" :value="module.id">{{ module.title }}</option></select><input v-model="materialDraft.title" class="form-control" placeholder="Judul" required><input v-model="materialDraft.summary" class="form-control" placeholder="Ringkasan"><select v-model="materialDraft.kind" class="form-select"><option value="RICH_TEXT">Teks terstruktur</option><option value="FILE">File privat CLEAN</option><option value="EXTERNAL_LINK">Tautan HTTPS</option></select><textarea v-if="materialDraft.kind === 'RICH_TEXT'" v-model="materialDraft.value" class="form-control" rows="3" placeholder="Isi tanpa HTML" /><input v-else v-model="materialDraft.value" class="form-control" :placeholder="materialDraft.kind === 'FILE' ? 'file_abcd…' : 'https://…'"><select v-model="materialDraft.status" class="form-select"><option value="DRAFT">Draf</option><option value="PUBLISHED">Terbit</option></select><button class="btn btn-primary" :disabled="busy">Simpan materi</button></form>
          <form class="surface manage-card" @submit.prevent="createAssignment"><header><span class="section-kicker">Jendela eksplisit</span><h2>Tugas baru</h2></header><input v-model="assignmentDraft.title" class="form-control" placeholder="Judul" required><textarea v-model="assignmentDraft.instructions" class="form-control" rows="3" placeholder="Instruksi tanpa HTML" required></textarea><select v-model="assignmentDraft.moduleId" class="form-select"><option value="">Tanpa modul</option><option v-for="assignmentModule in detail.modules" :key="assignmentModule.id" :value="assignmentModule.id">{{ assignmentModule.title }}</option></select><div class="date-grid"><label><span>Buka</span><input v-model="assignmentDraft.opensAt" class="form-control" type="datetime-local"></label><label><span>Tenggat</span><input v-model="assignmentDraft.dueAt" class="form-control" type="datetime-local"></label><label><span>Tutup</span><input v-model="assignmentDraft.closesAt" class="form-control" type="datetime-local"></label></div><select v-model="assignmentDraft.status" class="form-select"><option value="DRAFT">Draf</option><option value="PUBLISHED">Terbit</option></select><button class="btn btn-primary" :disabled="busy">Simpan tugas</button></form>
          <form class="surface manage-card" @submit.prevent="createAnnouncement"><header><span class="section-kicker">Komunikasi kelas</span><h2>Pengumuman</h2></header><input v-model="announcementDraft.title" class="form-control" placeholder="Judul" required><textarea v-model="announcementDraft.body" class="form-control" rows="4" placeholder="Isi tanpa HTML" required></textarea><label class="form-check"><input v-model="announcementDraft.pinned" class="form-check-input" type="checkbox">Sematkan</label><button class="btn btn-primary" :disabled="busy">Publikasikan</button></form></section>
      </template>
    </template>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.learning-page { gap: 1.2rem; }.learning-loading { display:flex;gap:.6rem;align-items:center;justify-content:center;min-height:280px;color:#71827b }.learning-toolbar { display:flex;gap:1rem;align-items:flex-end;justify-content:space-between;padding:.75rem;border:1px solid #e0e8e3;border-radius:.9rem;background:#fff }.learning-toolbar label span,.manage-card label>span,.submission-editor label>span,.grading-panel label>span { display:block;margin-bottom:.25rem;color:#788780;font-size:.58rem;font-weight:750 }.learning-toolbar .form-select { min-width:250px;border-color:#dbe4df;font-size:.67rem }.learning-toolbar nav { display:flex;gap:.25rem;padding:.3rem;border-radius:.7rem;background:#f4f7f5 }.learning-toolbar nav button { display:flex;gap:.35rem;align-items:center;padding:.5rem .65rem;border:0;border-radius:.5rem;color:#6e8078;background:transparent;font-size:.62rem;font-weight:750 }.learning-toolbar nav button.active { color:#2c5d49;background:#fff;box-shadow:0 2px 8px rgba(28,63,50,.08) }.space-hero { display:grid;grid-template-columns:1fr auto;gap:1rem;align-items:end;padding:1.2rem 1.3rem;border-radius:1rem;color:#fff;background:linear-gradient(120deg,#133f33,#34775f) }.space-hero span,.space-hero p,.space-hero small { color:rgba(255,255,255,.68);font-size:.62rem }.space-hero h2 { margin:.15rem 0;color:#fff;font-size:1.05rem }.space-hero p { margin:0 }.space-hero aside { text-align:right }.space-hero aside strong,.space-hero aside small { display:block }.space-hero aside strong { font-size:1rem }.learning-metrics { display:grid;grid-template-columns:repeat(4,1fr);gap:.75rem }.learning-metrics article { padding:.9rem;border:1px solid #e1e8e4;border-radius:.8rem;background:#fff }.learning-metrics i { color:#477963 }.learning-metrics span,.learning-metrics strong { display:block }.learning-metrics span { margin-top:.45rem;color:#7c8b85;font-size:.55rem;text-transform:uppercase }.learning-metrics strong { color:#2f5144;font-size:1.2rem }.surface { overflow:hidden;border:1px solid #e0e8e3;border-radius:.9rem;background:#fff }.surface>header { display:flex;justify-content:space-between;gap:1rem;padding:.9rem 1rem;border-bottom:1px solid #edf1ee }.surface h2 { margin:.12rem 0 0;color:#2f4d42;font-size:.82rem }.surface header p { margin:.18rem 0 0;color:#82918b;font-size:.61rem;line-height:1.5 }.section-kicker { display:block;color:#5e8174;font-size:.54rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase }.overview-grid { display:grid;grid-template-columns:1fr 1fr;gap:1rem }.announcements>article { display:flex;gap:.65rem;padding:.8rem 1rem;border-top:1px solid #edf1ee }.announcements>article:first-of-type { border-top:0 }.announcements>article>i { color:#4c7867 }.announcements article strong,.announcements article small { display:block;color:#38564a;font-size:.66rem }.announcements article p { margin:.15rem 0;color:#75877f;font-size:.59rem }.announcements article small { color:#919d98;font-size:.52rem }.announcements article.pinned { background:#fbf8ee }.activity ol { margin:0;padding:0 1rem;list-style:none }.activity li { display:flex;gap:.65rem;padding:.7rem 0;border-top:1px solid #edf1ee }.activity li:first-child { border-top:0 }.activity li>span { display:grid;place-items:center;width:1.9rem;height:1.9rem;border-radius:.55rem;color:#41735e;background:#edf5ef }.activity li strong,.activity li p,.activity li small { display:block }.activity li strong { color:#38544a;font-size:.64rem }.activity li p { margin:.12rem 0;color:#71837b;font-size:.54rem }.activity li small { color:#929d99;font-size:.51rem }.gamification-card { display:grid;grid-template-columns:auto 1fr auto;gap:.8rem;align-items:start;padding:1rem;border:1px solid #e7ddba;border-radius:.9rem;background:#fffbf1 }.gamification-card>i { color:#9a772f;font-size:1.25rem }.gamification-card strong { color:#5f4d26;font-size:.7rem }.gamification-card p,.gamification-card li,.gamification-card small { color:#806f4c;font-size:.57rem }.gamification-card p { margin:.18rem 0 }.gamification-card ul { margin:.3rem 0 0;padding-left:1rem }.gamification-card aside { text-align:right }.gamification-card aside strong,.gamification-card aside small { display:block }.gamification-card aside strong { font-size:1.2rem }.gamification-card aside button { margin-top:.45rem }.module-stack { display:grid;gap:.8rem }.module-card>header { display:flex;gap:.7rem;justify-content:flex-start }.module-card>header>span { display:grid;place-items:center;width:2rem;height:2rem;border-radius:.55rem;color:#3f705c;background:#edf5ef;font-size:.58rem;font-weight:800 }.material-list { display:grid }.material-list>article { display:grid;grid-template-columns:auto 1fr auto;gap:.7rem;align-items:center;padding:.75rem 1rem;border-top:1px solid #edf1ee }.material-list>article:first-child { border-top:0 }.material-icon { display:grid;place-items:center;width:2.2rem;height:2.2rem;border-radius:.6rem;color:#3f745f;background:#edf5ef }.material-list small,.material-list strong,.material-list p,.material-list div>span { display:block }.material-list small { color:#668078;font-size:.49rem;font-weight:800;text-transform:uppercase }.material-list strong { color:#38544a;font-size:.66rem }.material-list p,.material-list div>span { margin:.12rem 0 0;color:#83918b;font-size:.55rem }.assignment-shell,.forum-shell { display:grid;grid-template-columns:minmax(250px,.75fr) minmax(0,1.5fr);gap:1rem }.assignment-list>button,.thread-list>button { width:100%;padding:.75rem 1rem;border:0;border-top:1px solid #edf1ee;color:inherit;background:#fff;text-align:left }.assignment-list>button.active,.thread-list>button.active { background:#f1f7f3;box-shadow:inset 3px 0 #3e765e }.assignment-list button strong,.assignment-list button small,.assignment-list button>span { display:block }.assignment-list button strong { margin:.25rem 0;color:#375449;font-size:.65rem }.assignment-list button small,.assignment-list button>span { color:#81908a;font-size:.53rem }.assignment-state { display:inline-block!important;width:max-content;padding:.2rem .35rem;border-radius:999px;color:#416b59!important;background:#edf5ef;font-size:.48rem!important;font-weight:800 }.state-pending { color:#8b6a2e!important;background:#fff5df }.submission-editor .editor-body { display:grid;gap:.8rem;padding:1rem }.submission-editor .form-control,.grading-panel .form-control,.grading-panel .form-select,.manage-card .form-control,.manage-card .form-select,.thread-list .form-control,.discussion .form-control { border-color:#dbe4df;font-size:.64rem }.submission-editor label small { display:block;margin-top:.25rem;color:#87958f;font-size:.52rem }.window-note { display:flex;gap:.5rem;padding:.7rem;border-radius:.6rem;color:#765e2f;background:#fff8e9 }.window-note p { margin:0;font-size:.57rem }.submission-editor footer { display:flex;justify-content:flex-end;gap:.5rem;padding:.8rem 1rem;border-top:1px solid #edf1ee }.assignment-placeholder { display:grid;place-items:center;align-content:center;min-height:300px;color:#82918b;text-align:center }.assignment-placeholder i { font-size:1.6rem }.assignment-placeholder strong { margin-top:.4rem;color:#4a6258;font-size:.7rem }.assignment-placeholder p { font-size:.59rem }.grading-panel>article { display:grid;grid-template-columns:1fr 100px minmax(180px,1fr) 120px auto;gap:.55rem;align-items:end;padding:.75rem 1rem;border-top:1px solid #edf1ee }.review-meta strong,.review-meta span { display:block }.review-meta strong { color:#3a574c;font-size:.65rem }.review-meta span { color:#84918c;font-size:.53rem }.thread-list>button { display:flex;gap:.6rem }.thread-list>button>span { display:grid;place-items:center;width:2rem;height:2rem;border-radius:.55rem;color:#41705d;background:#edf5ef }.thread-list button strong,.thread-list button small { display:block }.thread-list button strong { color:#375449;font-size:.64rem }.thread-list button small { margin-top:.14rem;color:#83918b;font-size:.52rem }.thread-list form { display:grid;gap:.45rem;padding:.8rem;border-top:1px solid #edf1ee }.discussion>header>span { align-self:flex-start;padding:.25rem .4rem;border-radius:999px;color:#416c59;background:#edf5ef;font-size:.5rem;font-weight:800 }.post-list { display:grid;padding:0 1rem }.post-list article { display:flex;gap:.6rem;padding:.75rem 0;border-top:1px solid #edf1ee }.post-list article.nested { margin-left:2rem }.post-list article>span { display:grid;place-items:center;flex:0 0 auto;width:2rem;height:2rem;border-radius:50%;color:#fff;background:#4b7967;font-size:.52rem;font-weight:800 }.post-list strong,.post-list p,.post-list small { display:block }.post-list strong { color:#39564b;font-size:.61rem }.post-list p { margin:.15rem 0;color:#697e75;font-size:.59rem;white-space:pre-wrap }.post-list small { color:#929d99;font-size:.5rem }.discussion>form { display:grid;gap:.5rem;padding:.8rem 1rem;border-top:1px solid #edf1ee }.discussion>form button { justify-self:end }.manage-grid { display:grid;grid-template-columns:1fr 1fr;gap:1rem }.manage-card { display:grid;gap:.6rem;padding-bottom:1rem }.manage-card>header { margin-bottom:.2rem }.manage-card>label,.manage-card>input,.manage-card>textarea,.manage-card>select,.manage-card>button,.manage-card>.date-grid { margin-left:1rem;margin-right:1rem }.date-grid { display:grid;grid-template-columns:repeat(3,1fr);gap:.45rem }.manage-card>.form-check { color:#667a71;font-size:.6rem }.mini-empty { padding:1rem;color:#88958f;font-size:.59rem;text-align:center }.empty-learning { display:grid;justify-items:center;padding:2rem;border:1px solid #e0e8e3;border-radius:.9rem;background:#fff;text-align:center }.empty-learning>i { color:#4b7866;font-size:2rem }.empty-learning h2 { margin:.5rem 0 .2rem;color:#38544a;font-size:.85rem }.empty-learning p { color:#7d8c86;font-size:.62rem }.empty-learning form { display:grid;grid-template-columns:1fr 1fr auto;gap:.5rem;width:min(650px,100%);margin-top:.8rem }
@media (max-width:991.98px){.learning-metrics{grid-template-columns:repeat(2,1fr)}.overview-grid,.manage-grid{grid-template-columns:1fr}.grading-panel>article{grid-template-columns:1fr 100px}.grading-panel>article label:nth-of-type(2){grid-column:1/-1}.date-grid{grid-template-columns:1fr}}
@media (max-width:767.98px){.learning-toolbar{align-items:stretch;flex-direction:column}.learning-toolbar .form-select{width:100%}.learning-toolbar nav{overflow-x:auto}.learning-toolbar nav button{white-space:nowrap}.assignment-shell,.forum-shell{grid-template-columns:1fr}.space-hero{grid-template-columns:1fr}.space-hero aside{text-align:left}.material-list>article{grid-template-columns:auto 1fr}.material-list>article>.btn{grid-column:2;justify-self:start}.gamification-card{grid-template-columns:auto 1fr}.gamification-card aside{grid-column:2;text-align:left}.empty-learning form{grid-template-columns:1fr}}
@media (max-width:480px){.learning-metrics{grid-template-columns:1fr}.grading-panel>article{grid-template-columns:1fr}.grading-panel>article label:nth-of-type(2){grid-column:auto}.submission-editor footer{display:grid;grid-template-columns:1fr 1fr}.post-list article.nested{margin-left:1rem}}
</style>
