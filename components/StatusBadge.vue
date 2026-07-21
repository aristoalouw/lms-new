<template>
  <span class="status-badge" :class="`status-badge--${tone}`">
    <span class="status-badge__dot" aria-hidden="true" />
    {{ label || normalizedLabel }}
  </span>
</template>

<script setup lang="ts">
const props = defineProps<{ status: string; label?: string }>()

const statusMap: Record<string, { tone: string; label: string }> = {
  active: { tone: 'success', label: 'Aktif' },
  aktif: { tone: 'success', label: 'Aktif' },
  verified: { tone: 'success', label: 'Terverifikasi' },
  paid: { tone: 'success', label: 'Lunas' },
  success: { tone: 'success', label: 'Berhasil' },
  synced: { tone: 'success', label: 'Tersinkron' },
  pending: { tone: 'warning', label: 'Menunggu' },
  review: { tone: 'warning', label: 'Perlu ditinjau' },
  partial: { tone: 'warning', label: 'Sebagian' },
  draft: { tone: 'neutral', label: 'Draf' },
  inactive: { tone: 'neutral', label: 'Nonaktif' },
  scheduled: { tone: 'info', label: 'Terjadwal' },
  processing: { tone: 'info', label: 'Diproses' },
  overdue: { tone: 'danger', label: 'Jatuh tempo' },
  failed: { tone: 'danger', label: 'Gagal' },
  blocked: { tone: 'danger', label: 'Dicekal' },
}

const normalizedStatus = computed(() => props.status.toLowerCase().replaceAll(' ', '_'))
const tone = computed(() => statusMap[normalizedStatus.value]?.tone || 'neutral')
const normalizedLabel = computed(() => statusMap[normalizedStatus.value]?.label || props.status)
</script>
