<template>
  <div class="app-shell" :class="{ 'app-shell--compact': sidebarCompact }">
    <AppSidebar />
    <div class="app-shell__main">
      <AppTopbar />
      <main id="main-content" class="app-content" tabindex="-1">
        <slot />
      </main>
    </div>
    <PrivacyConsent />
  </div>
</template>

<script setup lang="ts">
const { sidebarCompact } = useAppShell()
</script>
