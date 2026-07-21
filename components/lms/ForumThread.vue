<script setup lang="ts">
import type { LearningForumPost, LearningForumThread } from '~/shared/contracts/lms'

defineProps<{ thread: LearningForumThread; posts: LearningForumPost[]; canManage?: boolean; busy?: boolean }>()
const emit = defineEmits<{
  reply: [payload: { body: string; parentPostId?: string }]
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
      <input v-model="moderationReason" class="form-control" maxlength="500" placeholder="Alasan moderasi (wajib)">
      <button class="btn btn-sm btn-outline-secondary" :disabled="busy || moderationReason.trim().length < 10" @click="emit('moderateThread', { status: thread.status === 'OPEN' ? 'LOCKED' : 'OPEN', reason: moderationReason })">{{ thread.status === 'OPEN' ? 'Kunci' : 'Buka' }}</button>
      <button class="btn btn-sm btn-outline-danger" :disabled="busy || moderationReason.trim().length < 10" @click="emit('moderateThread', { status: 'HIDDEN', reason: moderationReason })">Sembunyikan</button>
    </div>
    <div class="posts">
      <article v-for="post in posts" :key="post.id" :class="{ nested: post.depth === 1, hidden: post.status === 'HIDDEN' }">
        <span class="avatar">{{ post.authorUid.slice(0, 2).toUpperCase() }}</span>
        <div><strong>{{ post.authorUid }}</strong><p>{{ post.status === 'HIDDEN' ? 'Konten disembunyikan oleh moderator.' : learningPlainText(post.body) }}</p><small>{{ new Date(post.createdAt).toLocaleString('id-ID') }} · {{ post.editHistory.length }} edit</small></div>
        <div class="post-actions"><button v-if="thread.status === 'OPEN' && post.depth === 0 && post.status === 'VISIBLE'" class="btn btn-sm btn-link" @click="parentPostId = post.id">Balas</button><button v-if="canManage" class="btn btn-sm btn-link text-danger" :disabled="busy || moderationReason.trim().length < 10" @click="emit('moderatePost', { post, hidden: post.status !== 'HIDDEN', reason: moderationReason })">{{ post.status === 'HIDDEN' ? 'Tampilkan' : 'Sembunyikan' }}</button></div>
      </article>
      <p v-if="!posts.length" class="empty">Belum ada balasan.</p>
    </div>
    <form v-if="thread.status === 'OPEN'" class="reply" @submit.prevent="sendReply"><span v-if="parentPostId">Membalas kiriman · <button type="button" class="btn btn-sm btn-link" @click="parentPostId = undefined">batal</button></span><textarea v-model="reply" class="form-control" rows="3" maxlength="10000" placeholder="Tulis balasan…" required /><button class="btn btn-primary" :disabled="busy">Kirim balasan</button></form>
  </section>
</template>

<style scoped>
.forum-thread{overflow:hidden;border:1px solid #e0e8e3;border-radius:.9rem;background:#fff}.forum-thread>header,.reply{padding:1rem}.forum-thread h2{margin:.15rem 0;color:#315145;font-size:.86rem}.forum-thread header small,.forum-thread header p,.empty{color:#788b82;font-size:.6rem}.moderation-bar{display:grid;grid-template-columns:minmax(180px,1fr) auto auto;gap:.5rem;padding:.7rem 1rem;border-top:1px solid #edf1ee;background:#fbfcfb}.posts{padding:0 1rem}.posts article{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:.65rem;padding:.8rem 0;border-top:1px solid #edf1ee}.posts article.nested{margin-left:2rem}.posts article.hidden{opacity:.7}.avatar{display:grid;place-items:center;width:2rem;height:2rem;border-radius:50%;color:#fff;background:#4b7967;font-size:.52rem;font-weight:800}.posts strong,.posts small{display:block;color:#3b594d;font-size:.61rem}.posts p{margin:.15rem 0;color:#687e74;font-size:.6rem;white-space:pre-wrap}.posts small{color:#8c9993;font-size:.52rem}.post-actions{display:flex;align-items:flex-start}.reply{display:grid;gap:.5rem;border-top:1px solid #edf1ee}.reply>span{font-size:.58rem}.reply>button{justify-self:end}@media(max-width:767.98px){.moderation-bar{grid-template-columns:1fr}.posts article{grid-template-columns:auto 1fr}.post-actions{grid-column:2}.posts article.nested{margin-left:1rem}}
</style>
