<script setup lang="ts">
import type { LearningForumPost, LearningForumThread } from '~/shared/contracts/lms'

defineProps<{
  thread: LearningForumThread
  posts: LearningForumPost[]
  canParticipate?: boolean
  canManage?: boolean
  busy?: boolean
  postsLoading?: boolean
  postsLoadingMore?: boolean
  hasMorePosts?: boolean
  postsError?: string
}>()
const emit = defineEmits<{
  reply: [payload: { body: string; parentPostId?: string }]
  loadMorePosts: []
  retryPosts: []
  moderateThread: [payload: { status: 'OPEN' | 'LOCKED' | 'HIDDEN'; reason: string }]
  moderatePost: [payload: { post: LearningForumPost; hidden: boolean; reason: string }]
}>()
const reply = ref('')
const parentPostId = ref<string>()
const moderationReason = ref('')

function sendReply() {
  if (!reply.value.trim()) return
  emit('reply', { body: reply.value, ...(parentPostId.value ? { parentPostId: parentPostId.value } : {}) })
  reply.value = ''
  parentPostId.value = undefined
}
</script>

<template>
  <section class="forum-thread">
    <header><div><small>{{ thread.status }}</small><h2>{{ thread.title }}</h2><p>{{ learningPlainText(thread.body) }}</p></div></header>
    <div v-if="canManage" class="moderation-bar">
      <label class="visually-hidden" :for="`forum-moderation-reason-${thread.id}`">Alasan moderasi</label>
      <input :id="`forum-moderation-reason-${thread.id}`" v-model="moderationReason" class="form-control" maxlength="500" placeholder="Alasan moderasi (wajib)">
      <button class="btn btn-sm btn-outline-secondary" type="button" :disabled="busy || moderationReason.trim().length < 10" @click="emit('moderateThread', { status: thread.status === 'OPEN' ? 'LOCKED' : 'OPEN', reason: moderationReason })">{{ thread.status === 'OPEN' ? 'Kunci' : 'Buka' }}</button>
      <button class="btn btn-sm btn-outline-danger" type="button" :disabled="busy || moderationReason.trim().length < 10" @click="emit('moderateThread', { status: 'HIDDEN', reason: moderationReason })">Sembunyikan</button>
    </div>
    <div :id="`forum-post-list-${thread.id}`" class="posts" :aria-busy="postsLoading || postsLoadingMore">
      <p v-if="postsLoading" class="posts-state" role="status"><span class="spinner-border spinner-border-sm" aria-hidden="true" /> Memuat balasan…</p>
      <div v-else-if="postsError && !posts.length" class="posts-error" role="alert">
        <span>{{ postsError }}</span>
        <button class="btn btn-sm btn-outline-danger" type="button" @click="emit('retryPosts')">Coba lagi</button>
      </div>
      <template v-else>
        <article v-for="post in posts" :key="post.id" :class="{ nested: post.depth === 1, hidden: post.status === 'HIDDEN' }">
          <span class="avatar">{{ post.authorUid.slice(0, 2).toUpperCase() }}</span>
          <div><strong>{{ post.authorUid }}</strong><p>{{ post.status === 'HIDDEN' ? 'Konten disembunyikan oleh moderator.' : learningPlainText(post.body) }}</p><small>{{ new Date(post.createdAt).toLocaleString('id-ID') }} · {{ post.editHistory.length }} edit</small></div>
          <div class="post-actions"><button v-if="canParticipate && thread.status === 'OPEN' && post.depth === 0 && post.status === 'VISIBLE'" class="btn btn-sm btn-link" type="button" @click="parentPostId = post.id">Balas</button><button v-if="canManage" class="btn btn-sm btn-link text-danger" type="button" :disabled="busy || moderationReason.trim().length < 10" @click="emit('moderatePost', { post, hidden: post.status !== 'HIDDEN', reason: moderationReason })">{{ post.status === 'HIDDEN' ? 'Tampilkan' : 'Sembunyikan' }}</button></div>
        </article>
      </template>
      <p v-if="!postsLoading && !postsError && !posts.length" class="empty">Belum ada balasan.</p>
      <div v-if="!postsLoading && postsError && posts.length" class="posts-error" role="alert">
        <span>{{ postsError }}</span>
        <button class="btn btn-sm btn-outline-danger" type="button" @click="emit('retryPosts')">Coba lagi</button>
      </div>
      <div v-else-if="!postsLoading && hasMorePosts" class="posts-load-more">
        <button class="btn btn-sm btn-outline-secondary" type="button" :disabled="postsLoadingMore" :aria-controls="`forum-post-list-${thread.id}`" @click="emit('loadMorePosts')">
          <span v-if="postsLoadingMore" class="spinner-border spinner-border-sm me-1" aria-hidden="true" />
          {{ postsLoadingMore ? 'Memuat balasan…' : 'Muat balasan berikutnya' }}
        </button>
        <span v-if="postsLoadingMore" class="visually-hidden" role="status">Memuat halaman balasan berikutnya.</span>
      </div>
    </div>
    <form v-if="canParticipate && thread.status === 'OPEN'" class="reply" @submit.prevent="sendReply"><span v-if="parentPostId">Membalas kiriman · <button type="button" class="btn btn-sm btn-link" @click="parentPostId = undefined">batal</button></span><label class="visually-hidden" :for="`forum-reply-${thread.id}`">Tulis balasan</label><textarea :id="`forum-reply-${thread.id}`" v-model="reply" class="form-control" rows="3" maxlength="10000" placeholder="Tulis balasan…" required /><button class="btn btn-primary" :disabled="busy">Kirim balasan</button></form>
  </section>
</template>

<style scoped>
.forum-thread{overflow:hidden;border:1px solid #e0e8e3;border-radius:.9rem;background:#fff}.forum-thread>header,.reply{padding:1rem}.forum-thread h2{margin:.15rem 0;color:#315145;font-size:.86rem}.forum-thread header small,.forum-thread header p,.empty{color:#788b82;font-size:.6rem}.moderation-bar{display:grid;grid-template-columns:minmax(180px,1fr) auto auto;gap:.5rem;padding:.7rem 1rem;border-top:1px solid #edf1ee;background:#fbfcfb}.posts{padding:0 1rem}.posts article{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:.65rem;padding:.8rem 0;border-top:1px solid #edf1ee}.posts article.nested{margin-left:2rem}.posts article.hidden{opacity:.7}.posts-state{display:flex;align-items:center;gap:.45rem;margin:0;padding:1rem 0;color:#72867d;font-size:.6rem}.posts-error{display:grid;gap:.55rem;padding:1rem 0;color:#9b2f3f;font-size:.6rem}.posts-error .btn{justify-self:start}.posts-load-more{display:flex;justify-content:center;padding:.8rem 0;border-top:1px solid #edf1ee}.avatar{display:grid;place-items:center;width:2rem;height:2rem;border-radius:50%;color:#fff;background:#4b7967;font-size:.52rem;font-weight:800}.posts strong,.posts small{display:block;color:#3b594d;font-size:.61rem}.posts p{margin:.15rem 0;color:#687e74;font-size:.6rem;white-space:pre-wrap}.posts small{color:#8c9993;font-size:.52rem}.post-actions{display:flex;align-items:flex-start}.reply{display:grid;gap:.5rem;border-top:1px solid #edf1ee}.reply>span{font-size:.58rem}.reply>button{justify-self:end}@media(max-width:767.98px){.moderation-bar{grid-template-columns:1fr}.posts article{grid-template-columns:auto 1fr}.post-actions{grid-column:2}.posts article.nested{margin-left:1rem}}
</style>
