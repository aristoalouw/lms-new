<script setup lang="ts">
defineProps<{ title: string; eyebrow?: string; description?: string; wide?: boolean }>()
</script>

<template>
  <section class="surface-card record-list" :class="{ 'record-list--wide': wide }">
    <header class="record-list__heading">
      <span v-if="eyebrow">{{ eyebrow }}</span>
      <h2>{{ title }}</h2>
      <p v-if="description">{{ description }}</p>
    </header>
    <div class="record-list__items"><slot /></div>
  </section>
</template>

<style scoped>
.record-list { padding: 20px; }
.record-list--wide { grid-column: 1 / -1; }
.record-list__heading { margin-bottom: 16px; }
.record-list__heading span { color: var(--campus-gold-700); font-size: .57rem; font-weight: 850; letter-spacing: .09em; text-transform: uppercase; }
.record-list__heading h2 { margin: 3px 0 0; font-size: 1rem; }
.record-list__heading p { margin: 5px 0 0; color: var(--campus-muted); font-size: .65rem; }
.record-list__items { display: grid; gap: 10px; }
.record-list__items :deep(article) { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 15px; border: 1px solid var(--campus-border); border-radius: 13px; background: #fbfcfa; }
.record-list__items :deep(article > div) { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 6px; }
.record-list__items :deep(header) { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.record-list__items :deep(strong) { font-size: .74rem; }
.record-list__items :deep(p) { margin: 0; color: #53615c; font-size: .66rem; line-height: 1.55; }
.record-list__items :deep(small) { color: var(--campus-muted); font-size: .6rem; }
.record-list__items :deep(aside) { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
.record-list__items :deep(ol) { display: grid; gap: 5px; margin: 3px 0 0; padding-left: 18px; color: #53615c; font-size: .63rem; }
.record-list__items :deep(ol em) { display: block; color: var(--campus-muted); font-style: normal; }
@media (max-width: 767px) { .record-list__items :deep(article) { flex-direction: column; } .record-list__items :deep(aside) { justify-content: flex-start; } }
</style>
