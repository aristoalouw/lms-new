<template>
  <main class="error-page">
    <section class="error-card text-center">
      <span class="brand-mark brand-mark--large" aria-hidden="true">N</span>
      <p class="eyebrow mt-4">{{ error.statusCode === 404 ? 'Halaman tidak ditemukan' : 'Terjadi kendala' }}</p>
      <h1>{{ error.statusCode || 500 }}</h1>
      <p class="text-secondary mb-4">
        {{ error.statusCode === 404
          ? 'Alamat yang Anda tuju tidak tersedia atau telah dipindahkan.'
          : 'Layanan belum dapat memproses permintaan. Silakan coba kembali.' }}
      </p>
      <button class="btn btn-primary" type="button" @click="handleError">Kembali ke beranda</button>
    </section>
  </main>
</template>

<script setup lang="ts">
import type { NuxtError } from '#app'

defineProps<{ error: NuxtError }>()

const handleError = () => clearError({ redirect: '/' })
</script>
