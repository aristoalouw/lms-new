<script setup lang="ts">
import type { LearningSpaceDetail } from '~/shared/contracts/lms'
defineProps<{ detail: LearningSpaceDetail }>()
</script>

<template>
  <div class="space-frame">
    <NuxtLink class="back-link" to="/pembelajaran"><i class="uil uil-arrow-left" /> Semua kelas</NuxtLink>
    <LearningSpaceHero :space="detail.space" />
    <LearningSpaceNav :space-id="detail.space.id" :can-manage="detail.canManage" />
    <slot />
  </div>
</template>

<style scoped>
.space-frame{display:grid;gap:1rem}.back-link{display:inline-flex;gap:.35rem;align-items:center;justify-self:start;color:#4d7564;font-size:.64rem;font-weight:700;text-decoration:none}
</style>
