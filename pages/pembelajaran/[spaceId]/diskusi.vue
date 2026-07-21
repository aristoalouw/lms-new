<script setup lang="ts">
import type { LearningForumPost, LearningForumThread } from '~/shared/contracts/lms'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Diskusi kelas' })
const route = useRoute()
const spaceId = computed(() => String(route.params.spaceId || ''))
const { $api } = useNuxtApp()
const { detail, loading, error } = useLearningSpace(spaceId)
const threads = ref<LearningForumThread[]>([])
const nextCursor = ref<string>()
const selected = ref<LearningForumThread | null>(null)
const posts = ref<LearningForumPost[]>([])
const threadTitle = ref('')
const threadBody = ref('')
const busy = ref(false)
const actionError = ref('')
const notice = ref('')

async function loadThreads(reset = true) {
  try {
    const { data } = await $api.get<{ items: LearningForumThread[]; nextCursor?: string }>(`/learning/spaces/${spaceId.value}/forum/threads`, { params: { limit: 30, ...(!reset && nextCursor.value ? { cursor: nextCursor.value } : {}) } })
    threads.value = reset ? data.items : [...threads.value, ...data.items]
    nextCursor.value = data.nextCursor
  } catch (cause) { actionError.value = learningErrorMessage(cause) }
}

async function openThread(thread: LearningForumThread) {
  selected.value = thread
  try {
    const { data } = await $api.get<{ items: LearningForumPost[] }>(`/learning/forum/threads/${thread.id}/posts`, { params: { limit: 50 } })
    posts.value = data.items
  } catch (cause) { actionError.value = learningErrorMessage(cause) }
}

async function createThread() {
  if (!threadTitle.value.trim() || !threadBody.value.trim()) return
  busy.value = true; actionError.value = ''
  try {
    await $api.post(`/learning/spaces/${spaceId.value}/forum/threads`, { title: threadTitle.value, body: { format: 'PLAIN_TEXT', text: threadBody.value } }, { headers: { 'Idempotency-Key': learningRequestKey('forum-thread') } })
    threadTitle.value = ''; threadBody.value = ''; await loadThreads(); notice.value = 'Topik diskusi dibuat.'
  } catch (cause) { actionError.value = learningErrorMessage(cause) } finally { busy.value = false }
}

async function reply(payload: { body: string; parentPostId?: string }) {
  if (!selected.value) return
  busy.value = true; actionError.value = ''
  try {
    await $api.post(`/learning/forum/threads/${selected.value.id}/posts`, { body: { format: 'PLAIN_TEXT', text: payload.body }, ...(payload.parentPostId ? { parentPostId: payload.parentPostId } : {}) }, { headers: { 'Idempotency-Key': learningRequestKey('forum-post') } })
    await openThread(selected.value); await loadThreads(); notice.value = 'Balasan ditambahkan.'
  } catch (cause) { actionError.value = learningErrorMessage(cause) } finally { busy.value = false }
}

async function moderateThread(payload: { status: 'OPEN' | 'LOCKED' | 'HIDDEN'; reason: string }) {
  if (!selected.value) return
  busy.value = true
  try {
    const { data } = await $api.post<{ thread: LearningForumThread }>(`/learning/forum/threads/${selected.value.id}/moderate`, { ...payload, expectedVersion: selected.value.version })
    selected.value = data.thread; await loadThreads(); notice.value = 'Status topik diperbarui dengan audit.'
  } catch (cause) { actionError.value = learningErrorMessage(cause) } finally { busy.value = false }
}

async function moderatePost(payload: { post: LearningForumPost; hidden: boolean; reason: string }) {
  busy.value = true
  try {
    await $api.post(`/learning/forum/posts/${payload.post.id}/moderate`, { hidden: payload.hidden, reason: payload.reason, expectedVersion: payload.post.version })
    if (selected.value) await openThread(selected.value); notice.value = 'Kiriman dimoderasi dengan audit.'
  } catch (cause) { actionError.value = learningErrorMessage(cause) } finally { busy.value = false }
}

onMounted(() => loadThreads())
</script>

<template>
  <div class="page-stack">
    <div v-if="error || actionError" class="alert alert-danger" role="alert">{{ error || actionError }}</div>
    <div v-if="notice" class="alert alert-success" role="status">{{ notice }}</div>
    <div v-if="loading" class="loading-state"><span class="spinner-border spinner-border-sm" />Memuat diskusi…</div>
    <LearningSpaceFrame v-else-if="detail" :detail="detail">
      <div class="forum-layout">
        <aside class="thread-panel">
          <header><small>Forum kelas</small><h2>Topik diskusi</h2></header>
          <button v-for="thread in threads" :key="thread.id" :class="{ active: selected?.id === thread.id }" @click="openThread(thread)"><i class="uil uil-comment-alt-lines" /><span><strong>{{ thread.title }}</strong><small>{{ thread.replyCount }} balasan · {{ thread.status }}</small></span></button>
          <button v-if="nextCursor" class="btn btn-sm btn-link" @click="loadThreads(false)">Muat lebih banyak</button>
          <form @submit.prevent="createThread"><input v-model="threadTitle" class="form-control" maxlength="180" placeholder="Judul topik" required><textarea v-model="threadBody" class="form-control" rows="3" maxlength="10000" placeholder="Isi topik" required /><button class="btn btn-sm btn-primary" :disabled="busy">Buat topik</button></form>
        </aside>
        <ForumThread v-if="selected" :thread="selected" :posts="posts" :can-manage="detail.canManage" :busy="busy" @reply="reply" @moderate-thread="moderateThread" @moderate-post="moderatePost" />
        <section v-else class="empty-discussion"><i class="uil uil-comments-alt" /><strong>Pilih topik</strong><p>Balasan dibatasi maksimal dua tingkat.</p></section>
      </div>
    </LearningSpaceFrame>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.loading-state{display:flex;gap:.5rem;justify-content:center;padding:4rem}.forum-layout{display:grid;grid-template-columns:minmax(250px,.7fr) minmax(0,1.4fr);gap:1rem}.thread-panel,.empty-discussion{overflow:hidden;border:1px solid #e0e8e3;border-radius:.9rem;background:#fff}.thread-panel>header{padding:.9rem 1rem}.thread-panel header small{color:#56806e;font-size:.54rem;font-weight:800;text-transform:uppercase}.thread-panel h2{margin:.12rem 0;color:#315145;font-size:.82rem}.thread-panel>button:not(.btn){display:flex;gap:.6rem;width:100%;padding:.75rem 1rem;border:0;border-top:1px solid #edf1ee;color:inherit;background:#fff;text-align:left}.thread-panel>button.active{background:#eef7f2;box-shadow:inset 3px 0 #3b745c}.thread-panel>button>i{color:#43735f}.thread-panel button strong,.thread-panel button small{display:block;color:#37564a;font-size:.62rem}.thread-panel button small{margin-top:.12rem;color:#819089;font-size:.52rem}.thread-panel form{display:grid;gap:.5rem;padding:.8rem;border-top:1px solid #edf1ee}.thread-panel form button{justify-self:end}.empty-discussion{display:grid;place-items:center;align-content:center;min-height:280px;color:#819089;text-align:center}.empty-discussion i{font-size:1.6rem}.empty-discussion strong{color:#3b5a4e}.empty-discussion p{font-size:.6rem}@media(max-width:767.98px){.forum-layout{grid-template-columns:1fr}}
</style>
