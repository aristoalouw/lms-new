<script setup lang="ts">
import type { LearningSpace } from '~/shared/contracts/lms'

defineProps<{
  space: LearningSpace
  periodLabel?: string
  programLabel?: string
}>()
</script>

<template>
  <NuxtLink class="space-card" :class="{ 'space-card--archived': space.status === 'ARCHIVED' }" :to="`/pembelajaran/${space.id}`">
    <span class="space-card__icon"><i class="uil uil-book-open" /></span>
    <span class="space-card__body">
      <small>
        {{ space.courseCode || 'RUANG' }}
        <template v-if="space.section"> · Kelas {{ space.section }}</template>
        <template v-if="periodLabel || space.periodId"> · {{ periodLabel || space.periodId }}</template>
      </small>
      <strong>{{ space.title }}</strong>
      <span>{{ programLabel ? `${programLabel} · ` : '' }}{{ space.description || 'Buka materi, tugas, diskusi, dan presensi kelas.' }}</span>
    </span>
    <span class="space-card__side">
      <StatusBadge :status="space.status === 'ACTIVE' ? 'active' : 'inactive'" :label="space.status === 'ACTIVE' ? 'Aktif' : 'Arsip'" />
      <i class="uil uil-angle-right-b space-card__arrow" />
    </span>
  </NuxtLink>
</template>

<style scoped>
.space-card{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:.85rem;align-items:center;padding:1rem;border:1px solid #e6dfd6;border-radius:.9rem;color:inherit;background:#fff;text-decoration:none;transition:.16s ease}
.space-card:hover,.space-card:focus-visible{border-color:#c6b4ce;box-shadow:0 8px 24px rgba(89,54,96,.09);transform:translateY(-1px)}
.space-card--archived{background:#fdfbf8}
.space-card__icon{display:grid;place-items:center;width:2.7rem;height:2.7rem;border-radius:.75rem;color:#593660;background:#f5eff7;font-size:1.2rem}
.space-card__body{min-width:0}
.space-card__body small,.space-card__body strong,.space-card__body span{display:block}
.space-card__body small{color:#775a83;font-size:.64rem;font-weight:750;letter-spacing:.03em}
.space-card__body strong{margin:.15rem 0;color:#1e1e1e;font-size:.86rem}
.space-card__body span{overflow:hidden;color:#6c6865;font-size:.7rem;text-overflow:ellipsis;white-space:nowrap}
.space-card__side{display:flex;align-items:center;gap:.45rem}
.space-card__arrow{color:#775a83;font-size:1.15rem}
</style>
