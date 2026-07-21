<template>
  <NuxtLoadingIndicator color="#d39b2a" :height="3" />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>

<script setup lang="ts">
useHead({
  bodyAttrs: {
    class: 'app-body',
  },
})
</script>
