<template>
  <div class="empty-state">
    <span class="empty-state__icon"><i class="uil" :class="icon || 'uil-inbox'" aria-hidden="true" /></span>
    <h3>{{ title }}</h3>
    <p>{{ description }}</p>
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{ title: string; description: string; icon?: string }>()
</script>
