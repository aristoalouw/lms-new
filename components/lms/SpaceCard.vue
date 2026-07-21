<script setup lang="ts">
import type { LearningSpace } from '~/shared/contracts/lms'

defineProps<{ space: LearningSpace }>()
</script>

<template>
  <NuxtLink class="space-card" :to="`/pembelajaran/${space.id}`">
    <span class="space-card__icon"><i class="uil uil-book-open" /></span>
    <span class="space-card__body">
      <small>{{ space.courseCode || 'RUANG' }} · {{ space.section || space.periodId || 'Pembelajaran' }}</small>
      <strong>{{ space.title }}</strong>
      <span>{{ space.description || 'Buka materi, tugas, diskusi, dan presensi kelas.' }}</span>
    </span>
    <i class="uil uil-angle-right-b space-card__arrow" />
  </NuxtLink>
</template>

<style scoped>
.space-card{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:.85rem;align-items:center;padding:1rem;border:1px solid #dfe8e3;border-radius:.9rem;color:inherit;background:#fff;text-decoration:none;transition:.16s ease}.space-card:hover,.space-card:focus-visible{border-color:#7ba18f;box-shadow:0 8px 24px rgba(26,65,50,.08);transform:translateY(-1px)}.space-card__icon{display:grid;place-items:center;width:2.7rem;height:2.7rem;border-radius:.75rem;color:#356c56;background:#edf6f1;font-size:1.2rem}.space-card__body{min-width:0}.space-card__body small,.space-card__body strong,.space-card__body span{display:block}.space-card__body small{color:#70837a;font-size:.58rem;font-weight:750;letter-spacing:.04em}.space-card__body strong{margin:.15rem 0;color:#294c3e;font-size:.78rem}.space-card__body span{overflow:hidden;color:#75867f;font-size:.61rem;text-overflow:ellipsis;white-space:nowrap}.space-card__arrow{color:#779087;font-size:1.1rem}
</style>
