<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
useHead({ title: 'Tugas kelas' })
const route = useRoute()
const spaceId = computed(() => String(route.params.spaceId || ''))
const { detail, loading, error } = useLearningSpace(spaceId)

function state(item: NonNullable<typeof detail.value>['assignments'][number]) {
  const now = Date.now()
  if (item.status === 'DRAFT') return { label: 'Draf', tone: 'secondary' }
  if (item.status === 'CLOSED' || now >= Date.parse(item.closesAt)) return { label: 'Ditutup', tone: 'secondary' }
  if (now < Date.parse(item.opensAt)) return { label: 'Terjadwal', tone: 'info' }
  if (now > Date.parse(item.dueAt)) return { label: 'Terlambat', tone: 'warning' }
  return { label: 'Berjalan', tone: 'success' }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value))
}
</script>

<template>
  <div class="page-stack">
    <div v-if="error" class="alert alert-danger" role="alert">{{ error }}</div>
    <div v-if="loading" class="loading-state"><span class="spinner-border spinner-border-sm" />Memuat tugas…</div>
    <LearningSpaceFrame v-else-if="detail" :detail="detail">
      <section class="assignment-list">
        <NuxtLink v-for="item in detail.assignments" :key="item.id" :to="`/pembelajaran/${spaceId}/tugas/${item.id}`">
          <span class="assignment-icon"><i class="uil uil-clipboard-notes" /></span>
          <span class="assignment-body"><small><span class="badge" :class="`text-bg-${state(item).tone}`">{{ state(item).label }}</span> · {{ item.maximumPoints }} poin</small><strong>{{ item.title }}</strong><span>Tenggat {{ formatDate(item.dueAt) }} · {{ item.maximumAttempts }} attempt</span></span>
          <i class="uil uil-angle-right-b" />
        </NuxtLink>
        <p v-if="!detail.assignments.length" class="empty">Belum ada tugas.</p>
      </section>
      <NuxtLink v-if="detail.canManage" class="btn btn-primary manage-link" :to="`/pembelajaran/${spaceId}/kelola#tugas`"><i class="uil uil-plus me-2" />Buat tugas</NuxtLink>
    </LearningSpaceFrame>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.loading-state{display:flex;gap:.5rem;justify-content:center;padding:4rem}.assignment-list{overflow:hidden;border:1px solid #e0e8e3;border-radius:.9rem;background:#fff}.assignment-list>a{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:.8rem;align-items:center;padding:1rem;border-top:1px solid #edf1ee;color:inherit;text-decoration:none}.assignment-list>a:first-child{border-top:0}.assignment-list>a:hover{background:#f6faf7}.assignment-icon{display:grid;place-items:center;width:2.5rem;height:2.5rem;border-radius:.7rem;color:#356e56;background:#edf5f0}.assignment-body small,.assignment-body strong,.assignment-body>span{display:block}.assignment-body small{color:#72867c;font-size:.53rem}.assignment-body strong{margin:.18rem 0;color:#315145;font-size:.7rem}.assignment-body>span{color:#7b8c84;font-size:.58rem}.badge{font-size:.48rem}.empty{padding:2rem;color:#82918b;font-size:.62rem;text-align:center}.manage-link{justify-self:end}
</style>
