<script setup lang="ts">
definePageMeta({ middleware: 'auth' })

const route = useRoute()
const slug = Array.isArray(route.params.slug) ? route.params.slug[0] || '' : String(route.params.slug || '')
const redirects: Record<string, string> = {
  kemahasiswaan: '/kemahasiswaan',
  'evaluasi-dosen': '/evaluasi',
  'kelulusan-yudisium': '/kelulusan',
  kelulusan: '/kelulusan',
  'tracer-study': '/tracer-study',
  'tata-usaha-layanan': '/layanan',
  'tata-usaha': '/layanan',
  notifikasi: '/notifikasi',
  file: '/berkas',
  berkas: '/berkas',
  'audit-backup': '/modul/audit-backup',
}

const destination = redirects[slug]
if (!destination) throw createError({ statusCode: 404, statusMessage: 'Modul tidak ditemukan' })
await navigateTo(destination, { replace: true, redirectCode: 301 })
</script>

<template>
  <div class="p-4 text-center" role="status">Membuka modul operasional…</div>
</template>
