<script setup lang="ts">
import type { LearningPage, LearningSpace } from '~/shared/contracts/lms'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Pembelajaran' })

const { $api } = useNuxtApp()
const { can } = useAuth()
const spaces = ref<LearningSpace[]>([])
const nextCursor = ref<string>()
const loading = ref(true)
const loadingMore = ref(false)
const errorMessage = ref('')

async function load(reset = false) {
  if (reset) {
    spaces.value = []
    nextCursor.value = undefined
    loading.value = true
  } else loadingMore.value = true
  errorMessage.value = ''
  try {
    const { data } = await $api.get<LearningPage<LearningSpace> & { spaces?: LearningSpace[] }>('/learning/spaces', {
      params: { limit: 24, ...(nextCursor.value ? { cursor: nextCursor.value } : {}) },
    })
    spaces.value = reset ? data.items : [...spaces.value, ...data.items]
    nextCursor.value = data.nextCursor
  } catch (error) {
    errorMessage.value = learningErrorMessage(error)
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

onMounted(() => load(true))
</script>

<template>
  <div class="page-stack">
    <AppPageHeader eyebrow="LMS" title="Ruang pembelajaran" description="Akses materi, tugas, diskusi, pengumuman, dan presensi dari kelas aktif Anda.">
      <template #actions><NuxtLink v-if="can('classes:manage')" class="btn btn-primary" to="/admin/kelas"><i class="uil uil-plus me-2" />Kelola kelas</NuxtLink></template>
    </AppPageHeader>

    <div v-if="errorMessage" class="alert alert-danger" role="alert"><span>{{ errorMessage }}</span><button class="btn btn-sm btn-outline-danger ms-3" @click="load(true)">Coba lagi</button></div>
    <div v-if="loading" class="loading-state" aria-live="polite"><span class="spinner-border spinner-border-sm" />Memuat kelas…</div>

    <section v-else-if="spaces.length" class="space-grid" aria-label="Daftar ruang pembelajaran">
      <SpaceCard v-for="space in spaces" :key="space.id" :space="space" />
    </section>
    <section v-else class="empty-state"><i class="uil uil-books" /><h2>Belum ada ruang aktif</h2><p>Ruang muncul otomatis ketika kelas dibuat dan Anda ditugaskan atau memiliki enrolment aktif.</p></section>

    <button v-if="nextCursor" class="btn btn-outline-secondary load-more" :disabled="loadingMore" @click="load()"><span v-if="loadingMore" class="spinner-border spinner-border-sm me-2" />Muat kelas berikutnya</button>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.space-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.85rem}.loading-state,.empty-state{display:grid;place-items:center;align-content:center;gap:.5rem;min-height:260px;padding:2rem;border:1px solid #e0e8e3;border-radius:.9rem;color:#74877e;background:#fff;text-align:center}.loading-state{display:flex;justify-content:center}.empty-state i{color:#3d745e;font-size:2rem}.empty-state h2{margin:0;color:#345347;font-size:.88rem}.empty-state p{margin:0;font-size:.64rem}.load-more{justify-self:center}@media(max-width:767.98px){.space-grid{grid-template-columns:1fr}}
</style>
