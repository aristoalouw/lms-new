<template>
  <header class="page-header">
    <div class="page-header__copy">
      <p v-if="eyebrow" class="eyebrow">{{ eyebrow }}</p>
      <div class="d-flex align-items-center gap-2">
        <h1>{{ title }}</h1>
        <StatusBadge v-if="status" :status="status" :label="statusLabel" />
      </div>
      <p v-if="description" class="page-header__description">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<script setup lang="ts">
defineProps<{
  eyebrow?: string
  title: string
  description?: string
  status?: string
  statusLabel?: string
}>()
</script>
