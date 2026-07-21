<script setup lang="ts">
import QRCode from 'qrcode'

const props = defineProps<{
  challengeToken: string
  label?: string
}>()

const imageUrl = ref('')
const errorMessage = ref('')

const renderQr = async () => {
  imageUrl.value = ''
  errorMessage.value = ''
  if (!props.challengeToken || !import.meta.client) return
  try {
    const deepLink = `${window.location.origin}/presensi#${props.challengeToken}`
    imageUrl.value = await QRCode.toDataURL(deepLink, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 360,
      color: { dark: '#143f33', light: '#ffffff' },
    })
  } catch {
    errorMessage.value = 'QR belum dapat dirender. Buat challenge baru dan coba lagi.'
  }
}

watch(() => props.challengeToken, renderQr, { immediate: true })
</script>

<template>
  <figure class="attendance-qr" data-clarity-mask="true">
    <div v-if="imageUrl" class="attendance-qr__frame">
      <img :src="imageUrl" :alt="label || 'QR presensi kelas'" width="360" height="360">
    </div>
    <div v-else-if="errorMessage" class="alert alert-danger mb-0" role="alert">{{ errorMessage }}</div>
    <div v-else class="attendance-qr__loading" role="status">
      <span class="spinner-border spinner-border-sm" aria-hidden="true" /> Menyiapkan QR…
    </div>
    <figcaption>Pindai dengan kamera bawaan ponsel. Token tidak dikirim melalui URL server atau referrer.</figcaption>
  </figure>
</template>

<style scoped>
.attendance-qr{display:grid;justify-items:center;gap:.75rem;margin:0}.attendance-qr__frame{width:min(100%,380px);padding:.65rem;border:1px solid #dce7e1;border-radius:1rem;background:#fff;box-shadow:0 12px 32px rgba(26,73,59,.08)}.attendance-qr img{display:block;width:100%;height:auto}.attendance-qr__loading{display:flex;align-items:center;gap:.55rem;min-height:220px;color:#61766e}.attendance-qr figcaption{max-width:430px;color:#6f817a;font-size:.75rem;line-height:1.55;text-align:center}
</style>
