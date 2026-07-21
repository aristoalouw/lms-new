<script setup lang="ts">
import UserManagement from '../pengguna/index.vue'

definePageMeta({ middleware: ['auth', 'admin-mvp'] })
</script>

<template>
  <UserManagement />
</template>
