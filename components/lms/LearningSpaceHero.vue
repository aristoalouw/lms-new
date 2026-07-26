<script setup lang="ts">
import type { LearningSpace } from '~/shared/contracts/lms'
defineProps<{ space: LearningSpace }>()
</script>

<template>
  <section class="space-hero">
    <div><span>{{ space.kind.replace('_', ' ') }} · {{ space.periodId || 'lintas periode' }}</span><h1>{{ space.title }}</h1><p>{{ space.description || 'Ruang pembelajaran aktif.' }}</p></div>
    <aside><strong>{{ space.courseCode || 'LMS' }}</strong><small>{{ space.section ? `Kelas ${space.section}` : space.status }}</small></aside>
  </section>
</template>

<style scoped>
.space-hero{display:grid;grid-template-columns:1fr auto;gap:1rem;align-items:end;padding:1.2rem 1.3rem;border-radius:1rem;color:#fff;background:linear-gradient(120deg,#133f33,#34775f)}.space-hero span,.space-hero p,.space-hero small{color:rgba(255,255,255,.72);font-size:.63rem}.space-hero h1{margin:.18rem 0;color:#fff;font-size:1.08rem}.space-hero p{margin:0}.space-hero aside{text-align:right}.space-hero aside strong,.space-hero aside small{display:block}.space-hero aside strong{font-size:1rem}@media(max-width:575.98px){.space-hero{grid-template-columns:1fr}.space-hero aside{text-align:left}}
</style>
