<script setup lang="ts">
import UserManagement from '~/components/admin/UserManagement.vue'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Manajemen Pengguna' })
</script>

<template>
  <UserManagement />
</template>
