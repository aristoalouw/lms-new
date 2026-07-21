<script setup lang="ts">
import type { LearningAnnouncement, LearningAssignment, LearningMaterial, LearningMaterialKind, LearningModule, SafeRichContent } from '~/shared/contracts/lms'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Kelola pembelajaran' })
const route = useRoute()
const spaceId = computed(() => String(route.params.spaceId || ''))
const { $api } = useNuxtApp()
const { detail, loading, error, refresh } = useLearningSpace(spaceId)
const busy = ref(false)
const actionError = ref('')
const notice = ref('')

const moduleDraft = reactive({ title: '', description: '', status: 'DRAFT' as LearningModule['status'] })
const materialEditing = ref<LearningMaterial | null>(null)
const materialDraft = reactive({ moduleId: '', title: '', summary: '', kind: 'RICH_TEXT' as LearningMaterialKind, fileId: '', externalUrl: '', status: 'DRAFT' as LearningMaterial['status'] })
const materialContent = ref<SafeRichContent>({ format: 'QUILL_DELTA', ops: [{ insert: '\n' }] })
const assignmentEditing = ref<LearningAssignment | null>(null)
const announcementEditing = ref<LearningAnnouncement | null>(null)
const announcementDraft = reactive({ title: '', body: '', pinned: false })

interface AssignmentPayload {
  moduleId?: string
  title: string
  instructions: SafeRichContent
  opensAt: string
  dueAt: string
  closesAt: string
  maximumPoints: number
  maximumAttempts: number
  maximumFiles: number
  status: LearningAssignment['status']
  expectedVersion?: number
}

watch(detail, value => {
  if (!materialDraft.moduleId) materialDraft.moduleId = value?.modules.find(item => item.status !== 'ARCHIVED')?.id || ''
})

function resetMaterial() {
  materialEditing.value = null
  Object.assign(materialDraft, { moduleId: detail.value?.modules.find(item => item.status !== 'ARCHIVED')?.id || '', title: '', summary: '', kind: 'RICH_TEXT', fileId: '', externalUrl: '', status: 'DRAFT' })
  materialContent.value = { format: 'QUILL_DELTA', ops: [{ insert: '\n' }] }
}

function editMaterial(item: LearningMaterial) {
  materialEditing.value = item
  Object.assign(materialDraft, { moduleId: item.moduleId, title: item.title, summary: item.summary || '', kind: item.kind, fileId: item.file?.fileId || '', externalUrl: item.externalUrl || '', status: item.status })
  materialContent.value = item.content || { format: 'QUILL_DELTA', ops: [{ insert: '\n' }] }
  if (import.meta.client) document.getElementById('material-editor')?.scrollIntoView({ behavior: 'smooth' })
}

function editAnnouncement(item: LearningAnnouncement) {
  announcementEditing.value = item
  Object.assign(announcementDraft, { title: item.title, body: learningPlainText(item.body), pinned: item.pinned })
}

async function execute(action: () => Promise<unknown>, success: string) {
  busy.value = true; actionError.value = ''; notice.value = ''
  try { await action(); await refresh(); notice.value = success } catch (cause) { actionError.value = learningErrorMessage(cause) } finally { busy.value = false }
}

async function createModule() {
  await execute(async () => {
    await $api.post(`/learning/spaces/${spaceId.value}/modules`, { title: moduleDraft.title, description: moduleDraft.description.trim() ? { format: 'PLAIN_TEXT', text: moduleDraft.description } : undefined, order: (detail.value?.modules.length || 0) + 1, status: moduleDraft.status }, { headers: { 'Idempotency-Key': learningRequestKey('learning-module') } })
    Object.assign(moduleDraft, { title: '', description: '', status: 'DRAFT' })
  }, 'Modul dibuat dan versi pertama disimpan.')
}

async function updateModule(item: LearningModule, changes: Partial<Pick<LearningModule, 'status' | 'order'>>) {
  await execute(() => $api.put(`/learning/modules/${item.id}`, { title: item.title, description: item.description, order: changes.order ?? item.order, status: changes.status || item.status, expectedVersion: item.version }), 'Modul dan snapshot versi diperbarui.')
}

async function saveMaterial() {
  const conditional = materialDraft.kind === 'RICH_TEXT' ? { content: materialContent.value } : materialDraft.kind === 'FILE' ? { fileId: materialDraft.fileId } : { externalUrl: materialDraft.externalUrl }
  const payload = { title: materialDraft.title, summary: materialDraft.summary, kind: materialDraft.kind, ...conditional, order: materialEditing.value?.order || (detail.value?.materials.length || 0) + 1, status: materialDraft.status }
  await execute(async () => {
    if (materialEditing.value) await $api.put(`/learning/materials/${materialEditing.value.id}`, { ...payload, expectedVersion: materialEditing.value.version })
    else await $api.post(`/learning/spaces/${spaceId.value}/materials`, { ...payload, moduleId: materialDraft.moduleId }, { headers: { 'Idempotency-Key': learningRequestKey('learning-material') } })
    resetMaterial()
  }, materialEditing.value ? 'Materi dan snapshot versi diperbarui.' : 'Materi dibuat.')
}

function materialUpdatePayload(item: LearningMaterial, changes: Partial<Pick<LearningMaterial, 'status' | 'order'>>) {
  return { expectedVersion: item.version, kind: item.kind, title: item.title, summary: item.summary, content: item.content, fileId: item.file?.fileId, externalUrl: item.externalUrl, order: changes.order ?? item.order, status: changes.status || item.status }
}

async function updateMaterial(item: LearningMaterial, changes: Partial<Pick<LearningMaterial, 'status' | 'order'>>) {
  await execute(() => $api.put(`/learning/materials/${item.id}`, materialUpdatePayload(item, changes)), 'Materi dan snapshot versi diperbarui.')
}

async function saveAssignment(payload: AssignmentPayload) {
  await execute(async () => {
    if (assignmentEditing.value) {
      const { moduleId: _moduleId, ...update } = payload
      await $api.put(`/learning/assignments/${assignmentEditing.value.id}`, update)
    } else await $api.post(`/learning/spaces/${spaceId.value}/assignments`, payload, { headers: { 'Idempotency-Key': learningRequestKey('learning-assignment') } })
    assignmentEditing.value = null
  }, assignmentEditing.value ? 'Tugas diperbarui.' : 'Tugas dibuat.')
}

async function saveAnnouncement() {
  await execute(async () => {
    if (announcementEditing.value) await $api.patch(`/learning/announcements/${announcementEditing.value.id}`, { ...announcementDraft, body: { format: 'PLAIN_TEXT', text: announcementDraft.body }, status: announcementEditing.value.status, expectedVersion: announcementEditing.value.version })
    else await $api.post(`/learning/spaces/${spaceId.value}/announcements`, { ...announcementDraft, body: { format: 'PLAIN_TEXT', text: announcementDraft.body } }, { headers: { 'Idempotency-Key': learningRequestKey('learning-announcement') } })
    announcementEditing.value = null; Object.assign(announcementDraft, { title: '', body: '', pinned: false })
  }, announcementEditing.value ? 'Pengumuman diperbarui.' : 'Pengumuman diterbitkan dan notifikasi dibuat.')
}

async function archiveAnnouncement(item: LearningAnnouncement) {
  await execute(() => $api.patch(`/learning/announcements/${item.id}`, { title: item.title, body: item.body, pinned: false, status: 'ARCHIVED', expectedVersion: item.version }), 'Pengumuman diarsipkan.')
}
</script>

<template>
  <div class="page-stack">
    <div v-if="error || actionError" class="alert alert-danger" role="alert">{{ error || actionError }}</div>
    <div v-if="notice" class="alert alert-success" role="status">{{ notice }}</div>
    <div v-if="loading" class="loading-state"><span class="spinner-border spinner-border-sm" />Memuat pengelolaan…</div>
    <LearningSpaceFrame v-else-if="detail" :detail="detail">
      <section v-if="!detail.canManage" class="alert alert-danger">Hanya dosen yang ditugaskan pada kelas ini dapat mengelola konten dan nilai.</section>
      <template v-else>
        <section id="modul" class="manage-section"><header><div><small>Struktur</small><h2>Modul</h2></div></header><form class="compact-form" @submit.prevent="createModule"><input v-model="moduleDraft.title" class="form-control" maxlength="160" placeholder="Judul modul" required><input v-model="moduleDraft.description" class="form-control" maxlength="5000" placeholder="Deskripsi"><select v-model="moduleDraft.status" class="form-select"><option value="DRAFT">Draf</option><option value="PUBLISHED">Terbit</option></select><button class="btn btn-primary" :disabled="busy">Tambah</button></form><article v-for="module in detail.modules" :key="module.id" class="record-row"><div><small>#{{ module.order }} · {{ module.status }} · v{{ module.version }}</small><strong>{{ module.title }}</strong></div><div class="row-actions"><button v-if="module.status === 'DRAFT'" class="btn btn-sm btn-outline-success" :disabled="busy" @click="updateModule(module, { status: 'PUBLISHED' })">Terbitkan</button><button class="btn btn-sm btn-outline-secondary" :disabled="busy || module.order <= 1" @click="updateModule(module, { order: module.order - 1 })">↑</button><button v-if="module.status !== 'ARCHIVED'" class="btn btn-sm btn-outline-danger" :disabled="busy" @click="updateModule(module, { status: 'ARCHIVED' })">Arsip</button></div></article></section>

        <section id="material-editor" class="manage-section"><header><div><small>Konten berversi</small><h2>{{ materialEditing ? 'Ubah materi' : 'Materi baru' }}</h2></div><button v-if="materialEditing" class="btn btn-sm btn-link" @click="resetMaterial">Batal edit</button></header><form class="full-form" @submit.prevent="saveMaterial"><select v-model="materialDraft.moduleId" class="form-select" :disabled="Boolean(materialEditing)" required><option value="">Pilih modul</option><option v-for="module in detail.modules.filter(item => item.status !== 'ARCHIVED')" :key="module.id" :value="module.id">{{ module.title }}</option></select><input v-model="materialDraft.title" class="form-control" maxlength="180" placeholder="Judul materi" required><input v-model="materialDraft.summary" class="form-control" maxlength="500" placeholder="Ringkasan"><select v-model="materialDraft.kind" class="form-select"><option value="RICH_TEXT">Rich text aman</option><option value="FILE">File privat</option><option value="EXTERNAL_LINK">Tautan HTTPS</option></select><ClientOnly v-if="materialDraft.kind === 'RICH_TEXT'"><MaterialEditor v-model="materialContent" aria-label="Isi materi" /></ClientOnly><FilePicker v-else-if="materialDraft.kind === 'FILE'" v-model="materialDraft.fileId" :space-id="spaceId" /><input v-else v-model="materialDraft.externalUrl" class="form-control" type="url" pattern="https://.*" placeholder="https://…" required><select v-model="materialDraft.status" class="form-select"><option value="DRAFT">Draf</option><option value="PUBLISHED">Terbit</option><option v-if="materialEditing" value="ARCHIVED">Arsip</option></select><button class="btn btn-primary" :disabled="busy">{{ materialEditing ? 'Simpan perubahan' : 'Buat materi' }}</button></form><article v-for="material in detail.materials" :key="material.id" class="record-row"><div><small>#{{ material.order }} · {{ material.kind }} · {{ material.status }} · v{{ material.version }}</small><strong>{{ material.title }}</strong></div><div class="row-actions"><button class="btn btn-sm btn-outline-primary" @click="editMaterial(material)">Ubah</button><button class="btn btn-sm btn-outline-secondary" :disabled="busy || material.order <= 1" @click="updateMaterial(material, { order: material.order - 1 })">↑</button><button v-if="material.status === 'DRAFT'" class="btn btn-sm btn-outline-success" :disabled="busy" @click="updateMaterial(material, { status: 'PUBLISHED' })">Terbitkan</button><button v-if="material.status !== 'ARCHIVED'" class="btn btn-sm btn-outline-danger" :disabled="busy" @click="updateMaterial(material, { status: 'ARCHIVED' })">Arsip</button></div></article></section>

        <section id="tugas" class="manage-section"><header><div><small>Jendela & attempt</small><h2>{{ assignmentEditing ? 'Ubah tugas' : 'Tugas baru' }}</h2></div><button v-if="assignmentEditing" class="btn btn-sm btn-link" @click="assignmentEditing = null">Batal edit</button></header><div class="full-form"><AssignmentEditor :modules="detail.modules.filter(item => item.status !== 'ARCHIVED')" :assignment="assignmentEditing || undefined" :busy="busy" @save="saveAssignment" /></div><article v-for="assignment in detail.assignments" :key="assignment.id" class="record-row"><div><small>{{ assignment.status }} · {{ new Date(assignment.dueAt).toLocaleString('id-ID') }} · v{{ assignment.version }}</small><strong>{{ assignment.title }}</strong></div><div class="row-actions"><button class="btn btn-sm btn-outline-primary" @click="assignmentEditing = assignment">Ubah</button><NuxtLink class="btn btn-sm btn-outline-secondary" :to="`/pembelajaran/${spaceId}/tugas/${assignment.id}`">Nilai</NuxtLink></div></article></section>

        <section id="pengumuman" class="manage-section"><header><div><small>Notifikasi kelas</small><h2>{{ announcementEditing ? 'Ubah pengumuman' : 'Pengumuman baru' }}</h2></div></header><form class="full-form" @submit.prevent="saveAnnouncement"><input v-model="announcementDraft.title" class="form-control" maxlength="180" placeholder="Judul" required><textarea v-model="announcementDraft.body" class="form-control" rows="4" maxlength="10000" placeholder="Isi pengumuman" required /><label class="form-check"><input v-model="announcementDraft.pinned" class="form-check-input" type="checkbox"> Sematkan</label><button class="btn btn-primary" :disabled="busy">{{ announcementEditing ? 'Simpan perubahan' : 'Terbitkan' }}</button></form><article v-for="announcement in detail.announcements" :key="announcement.id" class="record-row"><div><small>{{ announcement.status }} · v{{ announcement.version }}</small><strong>{{ announcement.title }}</strong></div><div class="row-actions"><button class="btn btn-sm btn-outline-primary" @click="editAnnouncement(announcement)">Ubah</button><button v-if="announcement.status !== 'ARCHIVED'" class="btn btn-sm btn-outline-danger" :disabled="busy" @click="archiveAnnouncement(announcement)">Arsip</button></div></article></section>
      </template>
    </LearningSpaceFrame>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.loading-state{display:flex;gap:.5rem;justify-content:center;padding:4rem}.manage-section{overflow:hidden;border:1px solid #e0e8e3;border-radius:.9rem;background:#fff}.manage-section>header{display:flex;justify-content:space-between;align-items:center;padding:.9rem 1rem;border-bottom:1px solid #edf1ee}.manage-section header small{color:#56806e;font-size:.54rem;font-weight:800;text-transform:uppercase}.manage-section h2{margin:.12rem 0;color:#315145;font-size:.84rem}.compact-form{display:grid;grid-template-columns:1fr 1fr 140px auto;gap:.55rem;padding:.8rem 1rem;background:#fafcfb}.full-form{display:grid;gap:.7rem;padding:1rem;background:#fafcfb}.full-form>button{justify-self:start}.record-row{display:flex;justify-content:space-between;gap:1rem;align-items:center;padding:.75rem 1rem;border-top:1px solid #edf1ee}.record-row small,.record-row strong{display:block;color:#3b594d;font-size:.64rem}.record-row small{margin-bottom:.12rem;color:#7c8d85;font-size:.52rem}.row-actions{display:flex;gap:.35rem;flex-wrap:wrap;justify-content:flex-end}@media(max-width:991.98px){.compact-form{grid-template-columns:1fr 1fr}}@media(max-width:575.98px){.compact-form{grid-template-columns:1fr}.record-row{align-items:flex-start;flex-direction:column}.row-actions{justify-content:flex-start}}
</style>
