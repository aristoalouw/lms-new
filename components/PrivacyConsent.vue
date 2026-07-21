<template>
  <aside v-if="!preferences.decided" class="privacy-banner" aria-label="Preferensi privasi">
    <span class="privacy-banner__icon"><i class="uil uil-shield-check" aria-hidden="true" /></span>
    <div class="privacy-banner__copy">
      <strong>Privasi Anda kami jaga</strong>
      <p>Kami hanya memakai analitik opsional setelah Anda menyetujuinya. Halaman akademik privat tidak dilacak secara bawaan.</p>
    </div>
    <div class="privacy-banner__actions">
      <button class="btn btn-light btn-sm" type="button" @click="rejectOptional">Hanya esensial</button>
      <button class="btn btn-primary btn-sm" type="button" @click="acceptAll">Setujui opsional</button>
    </div>
  </aside>
</template>

<script setup lang="ts">
const { preferences, acceptAll, rejectOptional } = usePrivacyConsent()
</script>
