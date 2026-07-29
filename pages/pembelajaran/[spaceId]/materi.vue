<script setup lang="ts">
import type { LearningMaterial, SignedDownloadResult } from '~/shared/contracts/lms'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Materi kelas' })
const route = useRoute()
const spaceId = computed(() => String(route.params.spaceId || ''))
const { $api } = useNuxtApp()
const { detail, loading, error } = useLearningSpace(spaceId)
const actionError = ref('')

const materialsFor = (moduleId: string) => detail.value?.materials.filter(item => item.moduleId === moduleId && item.status !== 'ARCHIVED') || []

async function download(item: LearningMaterial) {
  if (!item.file) return
  try {
    const { data } = await $api.post<SignedDownloadResult>(`/files/${item.file.fileId}/download`, { version: item.file.fileVersion })
    if (import.meta.client) window.location.assign(data.url)
  } catch (cause) { actionError.value = learningErrorMessage(cause) }
}
</script>

<template>
  <div class="page-stack">
    <div v-if="error || actionError" class="alert alert-danger" role="alert">{{ error || actionError }}</div>
    <div v-if="loading" class="loading-state"><span class="spinner-border spinner-border-sm" />Memuat materi…</div>
    <LearningSpaceFrame v-else-if="detail" :detail="detail">
      <div class="module-stack">
        <section v-for="(module, index) in detail.modules.filter(item => item.status !== 'ARCHIVED')" :key="module.id" class="module-card">
          <header><span>{{ index + 1 }}</span><div><small>{{ module.status }}</small><h2>{{ module.title }}</h2><p>{{ learningPlainText(module.description) }}</p></div></header>
          <article v-for="material in materialsFor(module.id)" :key="material.id" class="material-row">
            <i class="uil" :class="material.kind === 'FILE' ? 'uil-file-download' : material.kind === 'EXTERNAL_LINK' ? 'uil-external-link-alt' : 'uil-file-alt'" />
            <div class="material-copy">
              <small>{{ material.kind.replaceAll('_', ' ') }} · {{ material.status }}</small>
              <strong>{{ material.title }}</strong>
              <p v-if="material.summary" class="material-summary">{{ material.summary }}</p>
              <SafeRichContent
                v-if="material.content"
                :content="material.content"
                :label="`Isi materi ${material.title}`"
              />
            </div>
            <button v-if="material.file" class="btn btn-sm btn-outline-primary" @click="download(material)">Unduh</button>
            <a v-else-if="material.externalUrl" class="btn btn-sm btn-outline-primary" :href="material.externalUrl" target="_blank" rel="noopener noreferrer">Buka</a>
          </article>
          <p v-if="!materialsFor(module.id).length" class="empty">Belum ada materi pada modul ini.</p>
        </section>
        <section v-if="!detail.modules.filter(item => item.status !== 'ARCHIVED').length" class="empty-card">Belum ada modul yang dapat dilihat.</section>
      </div>
      <NuxtLink v-if="detail.canManage" class="btn btn-primary manage-link" :to="`/pembelajaran/${spaceId}/kelola#materi`"><i class="uil uil-edit me-2" />Kelola materi</NuxtLink>
    </LearningSpaceFrame>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.loading-state{display:flex;gap:.5rem;justify-content:center;padding:4rem}.module-stack{display:grid;gap:.85rem}.module-card,.empty-card{overflow:hidden;border:1px solid #e0e8e3;border-radius:.9rem;background:#fff}.module-card>header{display:flex;gap:.75rem;padding:1rem}.module-card>header>span{display:grid;place-items:center;flex:0 0 auto;width:2rem;height:2rem;border-radius:.6rem;color:#31674f;background:#edf5f0;font-size:.62rem;font-weight:800}.module-card h2{margin:.1rem 0;color:#315145;font-size:.82rem}.module-card header small,.module-card header p{margin:0;color:#778a81;font-size:.57rem}.material-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:.75rem;align-items:start;padding:1rem;border-top:1px solid #edf1ee}.material-row>i{display:grid;place-items:center;width:2.2rem;height:2.2rem;border-radius:.6rem;color:#39715a;background:#edf5f0}.material-row small,.material-row strong{display:block}.material-row small{color:#668078;font-size:.49rem;font-weight:800}.material-row strong{color:#36564a;font-size:.66rem}.material-copy{min-width:0}.material-copy>.material-summary{margin:.2rem 0 .45rem;color:#71847b;font-size:.58rem}.empty,.empty-card{padding:1rem;color:#82918b;font-size:.6rem;text-align:center}.manage-link{justify-self:end}@media(max-width:575.98px){.material-row{grid-template-columns:auto 1fr}.material-row>.btn{grid-column:2;justify-self:start}}
</style>
