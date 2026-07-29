<script setup lang="ts">
const props = defineProps<{ spaceId: string; canManage?: boolean }>()
const route = useRoute()
const { can } = useAuth()
const items = computed(() => [
  { label: 'Ringkasan', icon: 'uil-chart-pie', to: `/pembelajaran/${props.spaceId}` },
  { label: 'Materi', icon: 'uil-books', to: `/pembelajaran/${props.spaceId}/materi` },
  { label: 'Tugas', icon: 'uil-clipboard-notes', to: `/pembelajaran/${props.spaceId}/tugas` },
  { label: 'Diskusi', icon: 'uil-comments-alt', to: `/pembelajaran/${props.spaceId}/diskusi` },
  ...(can('learning:check_in') || can('learning:manage_attendance')
    ? [{ label: 'Presensi', icon: 'uil-qrcode-scan', to: `/pembelajaran/${props.spaceId}/presensi` }]
    : []),
  ...(props.canManage ? [{ label: 'Kelola', icon: 'uil-setting', to: `/pembelajaran/${props.spaceId}/kelola` }] : []),
])

function active(to: string) {
  return route.path === to || (to.endsWith('/tugas') && route.path.startsWith(`${to}/`))
}
</script>

<template>
  <nav class="space-nav" aria-label="Navigasi ruang pembelajaran">
    <NuxtLink v-for="item in items" :key="item.to" :to="item.to" :aria-current="active(item.to) ? 'page' : undefined" :class="{ active: active(item.to) }">
      <i class="uil" :class="item.icon" />{{ item.label }}
    </NuxtLink>
  </nav>
</template>

<style scoped>
.space-nav{display:flex;gap:.25rem;overflow-x:auto;padding:.35rem;border:1px solid #e0e8e3;border-radius:.8rem;background:#f5f8f6}.space-nav a{display:flex;gap:.4rem;align-items:center;padding:.55rem .7rem;border-radius:.55rem;color:#647a70;font-size:.64rem;font-weight:750;text-decoration:none;white-space:nowrap}.space-nav a.active{color:#285c47;background:#fff;box-shadow:0 2px 8px rgba(28,63,50,.08)}
</style>
