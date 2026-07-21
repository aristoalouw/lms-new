<script setup lang="ts">
definePageMeta({ middleware: 'auth' })
await navigateTo('/akademik/administrasi', { replace: true })
</script>

<template>
  <div class="p-4 text-center" role="status">Membuka Kartu Rencana Studi…</div>
</template>
