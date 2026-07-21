<script setup lang="ts">
import type { LearningProgressDashboard } from '~/shared/contracts/lms'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Ringkasan kelas' })

const route = useRoute()
const spaceId = computed(() => String(route.params.spaceId || ''))
const { $api } = useNuxtApp()
const { detail, loading, error, refresh } = useLearningSpace(spaceId)
const dashboard = ref<LearningProgressDashboard | null>(null)
const dashboardError = ref('')

async function loadDashboard() {
  if (!spaceId.value) return
  try {
    const { data } = await $api.get<LearningProgressDashboard>(`/learning/spaces/${spaceId.value}/dashboard`)
    dashboard.value = data
  } catch (cause) { dashboardError.value = learningErrorMessage(cause) }
}

onMounted(loadDashboard)

function formatDate(value: string) {
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value))
}
</script>

<template>
  <div class="page-stack">
    <div v-if="error || dashboardError" class="alert alert-danger" role="alert">{{ error || dashboardError }} <button class="btn btn-sm btn-outline-danger ms-2" @click="refresh(); loadDashboard()">Coba lagi</button></div>
    <div v-if="loading" class="loading-state"><span class="spinner-border spinner-border-sm" />Memuat ringkasan…</div>
    <LearningSpaceFrame v-else-if="detail" :detail="detail">
      <section v-if="dashboard" class="metrics"><article><span>Modul terbit</span><strong>{{ dashboard.modulesPublished }}</strong></article><article><span>Materi terbit</span><strong>{{ dashboard.materialsPublished }}</strong></article><article><span>Tugas terbit</span><strong>{{ dashboard.assignmentsPublished }}</strong></article><article><span>Progres</span><strong>{{ dashboard.completionPercent }}%</strong></article></section>
      <div class="summary-grid">
        <section class="surface"><header><div><small>Pengumuman</small><h2>Pembaruan kelas</h2></div></header><article v-for="item in detail.announcements" :key="item.id" class="announcement" :class="{ pinned: item.pinned }"><i class="uil" :class="item.pinned ? 'uil-thumbtack' : 'uil-megaphone'" /><div><strong>{{ item.title }}</strong><p>{{ learningPlainText(item.body) }}</p><small>{{ formatDate(item.updatedAt) }}</small></div></article><p v-if="!detail.announcements.length" class="empty">Belum ada pengumuman.</p></section>
        <section class="surface"><header><div><small>Aktivitas</small><h2>Terbaru</h2></div></header><ol v-if="dashboard?.recentActivity.length" class="activity"><li v-for="item in dashboard.recentActivity" :key="item.id"><i class="uil uil-check-circle" /><div><strong>{{ item.label }}</strong><small>{{ item.kind.replaceAll('_', ' ') }} · {{ formatDate(item.occurredAt) }}</small></div></li></ol><p v-else class="empty">Belum ada aktivitas.</p></section>
      </div>
    </LearningSpaceFrame>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.loading-state{display:flex;gap:.5rem;justify-content:center;padding:4rem;color:#71847b}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:.75rem}.metrics article{padding:1rem;border:1px solid #e0e8e3;border-radius:.8rem;background:#fff}.metrics span,.metrics strong{display:block}.metrics span{color:#778980;font-size:.56rem;text-transform:uppercase}.metrics strong{margin-top:.25rem;color:#315747;font-size:1.2rem}.summary-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.surface{overflow:hidden;border:1px solid #e0e8e3;border-radius:.9rem;background:#fff}.surface>header{padding:.9rem 1rem;border-bottom:1px solid #edf1ee}.surface header small{color:#56806e;font-size:.55rem;font-weight:800;text-transform:uppercase}.surface h2{margin:.12rem 0;color:#315145;font-size:.82rem}.announcement{display:flex;gap:.65rem;padding:.8rem 1rem;border-top:1px solid #edf1ee}.announcement.pinned{background:#fffbef}.announcement strong,.announcement small{display:block;color:#36564a;font-size:.64rem}.announcement p{margin:.15rem 0;color:#71847b;font-size:.59rem}.announcement small{color:#8b9993;font-size:.51rem}.activity{margin:0;padding:0 1rem;list-style:none}.activity li{display:flex;gap:.6rem;padding:.75rem 0;border-top:1px solid #edf1ee}.activity strong,.activity small{display:block;color:#3b594e;font-size:.63rem}.activity small{margin-top:.15rem;color:#89968f;font-size:.52rem}.empty{padding:1rem;color:#82918b;font-size:.6rem;text-align:center}@media(max-width:767.98px){.metrics{grid-template-columns:repeat(2,1fr)}.summary-grid{grid-template-columns:1fr}}@media(max-width:420px){.metrics{grid-template-columns:1fr}}
</style>
