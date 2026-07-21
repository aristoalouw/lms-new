<template>
  <article class="stat-card" :class="`stat-card--${tone || 'forest'}`">
    <div class="stat-card__top">
      <span class="stat-card__icon"><i class="uil" :class="icon || 'uil-chart'" aria-hidden="true" /></span>
      <span v-if="trend" class="stat-card__trend" :class="{ 'stat-card__trend--down': trend.startsWith('-') }">
        <i class="uil" :class="trend.startsWith('-') ? 'uil-arrow-down' : 'uil-arrow-up'" /> {{ trend }}
      </span>
    </div>
    <p class="stat-card__label">{{ label }}</p>
    <strong class="stat-card__value">{{ value }}</strong>
    <p v-if="detail" class="stat-card__detail">{{ detail }}</p>
    <div v-if="progress !== undefined" class="stat-card__progress" role="progressbar" :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100">
      <span :style="{ width: `${Math.min(100, Math.max(0, progress))}%` }" />
    </div>
  </article>
</template>

<script setup lang="ts">
defineProps<{
  label: string
  value: string | number
  detail?: string
  trend?: string
  tone?: 'forest' | 'amber' | 'blue' | 'coral' | 'slate' | 'primary' | 'success' | 'warning' | 'info' | 'danger' | 'neutral'
  icon?: string
  progress?: number
}>()
</script>
