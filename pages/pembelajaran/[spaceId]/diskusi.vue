<script setup lang="ts">
import type { LearningForumPost, LearningForumThread } from '~/shared/contracts/lms'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Diskusi kelas' })
const route = useRoute()
const spaceId = computed(() => String(route.params.spaceId || ''))
const { $api } = useNuxtApp()
const { can } = useAuth()
const { detail, loading, error } = useLearningSpace(spaceId)
const threads = ref<LearningForumThread[]>([])
const threadNextCursor = ref<string>()
const selected = ref<LearningForumThread | null>(null)
const posts = ref<LearningForumPost[]>([])
const postNextCursor = ref<string>()
const threadTitle = ref('')
const threadBody = ref('')
const busy = ref(false)
const threadLoading = ref(true)
const threadLoadingMore = ref(false)
const postLoading = ref(false)
const postLoadingMore = ref(false)
const threadError = ref('')
const postError = ref('')
const threadRetryAppend = ref(false)
const postRetryAppend = ref(false)
const actionError = ref('')
const notice = ref('')
const canParticipateForum = computed(() => can('learning:participate_forum'))
const canModerateForum = computed(() => Boolean(detail.value?.canManage && can('learning:moderate_forum')))
let postRequestVersion = 0

async function loadThreads(reset = true) {
  if (!reset && (!threadNextCursor.value || threadLoadingMore.value)) return
  if (reset) {
    threadLoading.value = true
    threadNextCursor.value = undefined
  } else {
    threadLoadingMore.value = true
  }
  threadError.value = ''
  try {
    const { data } = await $api.get<{ items: LearningForumThread[]; nextCursor?: string }>(`/learning/spaces/${spaceId.value}/forum/threads`, { params: { limit: 30, ...(!reset && threadNextCursor.value ? { cursor: threadNextCursor.value } : {}) } })
    threads.value = reset ? data.items : [...threads.value, ...data.items]
    threadNextCursor.value = data.nextCursor
    threadRetryAppend.value = false
    if (selected.value) selected.value = threads.value.find(thread => thread.id === selected.value?.id) || selected.value
  } catch (cause) {
    threadError.value = learningErrorMessage(cause)
    threadRetryAppend.value = !reset
  } finally {
    threadLoading.value = false
    threadLoadingMore.value = false
  }
}

async function openThread(thread: LearningForumThread) {
  const requestVersion = ++postRequestVersion
  selected.value = thread
  posts.value = []
  postNextCursor.value = undefined
  postError.value = ''
  postRetryAppend.value = false
  postLoading.value = true
  postLoadingMore.value = false
  try {
    const { data } = await $api.get<{ items: LearningForumPost[]; nextCursor?: string }>(`/learning/forum/threads/${thread.id}/posts`, { params: { limit: 50 } })
    if (requestVersion !== postRequestVersion || selected.value?.id !== thread.id) return
    posts.value = data.items
    postNextCursor.value = data.nextCursor
  } catch (cause) {
    if (requestVersion === postRequestVersion) {
      postError.value = learningErrorMessage(cause)
      postRetryAppend.value = false
    }
  } finally {
    if (requestVersion === postRequestVersion) postLoading.value = false
  }
}

async function loadMorePosts() {
  const thread = selected.value
  const cursor = postNextCursor.value
  if (!thread || !cursor || postLoadingMore.value) return
  const requestVersion = postRequestVersion
  postLoadingMore.value = true
  postError.value = ''
  try {
    const { data } = await $api.get<{ items: LearningForumPost[]; nextCursor?: string }>(`/learning/forum/threads/${thread.id}/posts`, { params: { limit: 50, cursor } })
    if (requestVersion !== postRequestVersion || selected.value?.id !== thread.id) return
    posts.value = [...posts.value, ...data.items]
    postNextCursor.value = data.nextCursor
    postRetryAppend.value = false
  } catch (cause) {
    if (requestVersion === postRequestVersion) {
      postError.value = learningErrorMessage(cause)
      postRetryAppend.value = true
    }
  } finally {
    if (requestVersion === postRequestVersion) postLoadingMore.value = false
  }
}

function retryThreads() {
  return loadThreads(!threadRetryAppend.value)
}

function retryPosts() {
  if (postRetryAppend.value) return loadMorePosts()
  if (selected.value) return openThread(selected.value)
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
  busy.value = true; actionError.value = ''
  try {
    const { data } = await $api.post<{ thread: LearningForumThread }>(`/learning/forum/threads/${selected.value.id}/moderate`, { ...payload, expectedVersion: selected.value.version })
    selected.value = data.thread; await loadThreads(); notice.value = 'Status topik diperbarui dengan audit.'
  } catch (cause) { actionError.value = learningErrorMessage(cause) } finally { busy.value = false }
}

async function moderatePost(payload: { post: LearningForumPost; hidden: boolean; reason: string }) {
  busy.value = true; actionError.value = ''
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
    <div v-if="loading" class="loading-state" role="status"><span class="spinner-border spinner-border-sm" aria-hidden="true" />Memuat diskusi…</div>
    <LearningSpaceFrame v-else-if="detail" :detail="detail">
      <div class="forum-layout">
        <aside class="thread-panel">
          <header><small>Forum kelas</small><h2>Topik diskusi</h2></header>
          <div id="forum-thread-list" class="thread-list" :aria-busy="threadLoading || threadLoadingMore">
            <p v-if="threadLoading" class="panel-state" role="status"><span class="spinner-border spinner-border-sm" aria-hidden="true" /> Memuat topik…</p>
            <div v-else-if="threadError && !threads.length" class="panel-error" role="alert">
              <span>{{ threadError }}</span>
              <button class="btn btn-sm btn-outline-danger" type="button" @click="retryThreads">Coba lagi</button>
            </div>
            <p v-else-if="!threads.length" class="panel-state">Belum ada topik diskusi.</p>
            <template v-else>
              <button v-for="thread in threads" :key="thread.id" type="button" :class="{ active: selected?.id === thread.id }" @click="openThread(thread)"><i class="uil uil-comment-alt-lines" aria-hidden="true" /><span><strong>{{ thread.title }}</strong><small>{{ thread.replyCount }} balasan · {{ thread.status }}</small></span></button>
            </template>
          </div>
          <div v-if="threadError && threads.length" class="panel-error" role="alert">
            <span>{{ threadError }}</span>
            <button class="btn btn-sm btn-outline-danger" type="button" @click="retryThreads">Coba lagi</button>
          </div>
          <div v-else-if="threadNextCursor" class="load-more-state">
            <button class="btn btn-sm btn-link" type="button" :disabled="threadLoadingMore" aria-controls="forum-thread-list" @click="loadThreads(false)">
              <span v-if="threadLoadingMore" class="spinner-border spinner-border-sm me-1" aria-hidden="true" />
              {{ threadLoadingMore ? 'Memuat topik…' : 'Muat topik berikutnya' }}
            </button>
            <span v-if="threadLoadingMore" class="visually-hidden" role="status">Memuat halaman topik berikutnya.</span>
          </div>
          <form v-if="canParticipateForum" @submit.prevent="createThread">
            <label class="visually-hidden" for="forum-thread-title">Judul topik</label>
            <input id="forum-thread-title" v-model="threadTitle" class="form-control" maxlength="180" placeholder="Judul topik" required>
            <label class="visually-hidden" for="forum-thread-body">Isi topik</label>
            <textarea id="forum-thread-body" v-model="threadBody" class="form-control" rows="3" maxlength="10000" placeholder="Isi topik" required />
            <button class="btn btn-sm btn-primary" :disabled="busy">Buat topik</button>
          </form>
        </aside>
        <ForumThread
          v-if="selected"
          :thread="selected"
          :posts="posts"
          :can-participate="canParticipateForum"
          :can-manage="canModerateForum"
          :busy="busy"
          :posts-loading="postLoading"
          :posts-loading-more="postLoadingMore"
          :has-more-posts="Boolean(postNextCursor)"
          :posts-error="postError"
          @reply="reply"
          @load-more-posts="loadMorePosts"
          @retry-posts="retryPosts"
          @moderate-thread="moderateThread"
          @moderate-post="moderatePost"
        />
        <section v-else class="empty-discussion"><i class="uil uil-comments-alt" /><strong>Pilih topik</strong><p>Balasan dibatasi maksimal dua tingkat.</p></section>
      </div>
    </LearningSpaceFrame>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.loading-state{display:flex;gap:.5rem;justify-content:center;padding:4rem}.forum-layout{display:grid;grid-template-columns:minmax(250px,.7fr) minmax(0,1.4fr);gap:1rem}.thread-panel,.empty-discussion{overflow:hidden;border:1px solid #e0e8e3;border-radius:.9rem;background:#fff}.thread-panel>header{padding:.9rem 1rem}.thread-panel header small{color:#56806e;font-size:.54rem;font-weight:800;text-transform:uppercase}.thread-panel h2{margin:.12rem 0;color:#315145;font-size:.82rem}.thread-list>button{display:flex;gap:.6rem;width:100%;padding:.75rem 1rem;border:0;border-top:1px solid #edf1ee;color:inherit;background:#fff;text-align:left}.thread-list>button.active{background:#eef7f2;box-shadow:inset 3px 0 #3b745c}.thread-list>button>i{color:#43735f}.thread-panel button strong,.thread-panel button small{display:block;color:#37564a;font-size:.62rem}.thread-panel button small{margin-top:.12rem;color:#819089;font-size:.52rem}.thread-panel form{display:grid;gap:.5rem;padding:.8rem;border-top:1px solid #edf1ee}.thread-panel form button{justify-self:end}.panel-state{display:flex;align-items:center;gap:.45rem;margin:0;padding:.9rem 1rem;border-top:1px solid #edf1ee;color:#72867d;font-size:.62rem}.panel-error{display:grid;gap:.55rem;padding:.8rem 1rem;border-top:1px solid #edf1ee;color:#9b2f3f;font-size:.62rem}.panel-error .btn{justify-self:start}.load-more-state{display:flex;align-items:center;justify-content:center;border-top:1px solid #edf1ee}.empty-discussion{display:grid;place-items:center;align-content:center;min-height:280px;color:#819089;text-align:center}.empty-discussion i{font-size:1.6rem}.empty-discussion strong{color:#3b5a4e}.empty-discussion p{font-size:.6rem}@media(max-width:767.98px){.forum-layout{grid-template-columns:1fr}}
</style>
