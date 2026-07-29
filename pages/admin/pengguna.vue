<script setup lang="ts">
import UserManagement from '~/components/admin/UserManagement.vue'

definePageMeta({ middleware: ['auth', 'admin-mvp'] })
useHead({ title: 'Manajemen Pengguna' })
</script>

<template>
  <UserManagement />
</template>
