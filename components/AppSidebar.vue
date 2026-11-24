<template>
  <div class="sidebar-fragment">
    <div v-if="sidebarOpen" class="sidebar-backdrop" aria-hidden="true" @click="closeSidebar" />
    <aside class="app-sidebar" :class="{ 'app-sidebar--open': sidebarOpen }" aria-label="Navigasi utama">
      <div class="app-sidebar__brand">
        <NuxtLink to="/" class="brand-lockup" :aria-label="`${appName} — beranda`" @click="closeSidebar">
          <span class="brand-mark" aria-hidden="true">{{ appInitial }}</span>
          <span class="brand-copy">
            <strong>{{ appName }}</strong>
            <small>Sistem terpadu</small>
          </span>
        </NuxtLink>
        <button class="sidebar-close d-lg-none" type="button" aria-label="Tutup navigasi" @click="closeSidebar">
          <i class="uil uil-times" aria-hidden="true" />
        </button>
      </div>

      <div class="semester-context">
        <span class="semester-context__icon"><i class="uil uil-calendar-alt" aria-hidden="true" /></span>
        <span class="semester-context__copy">
          <small>Periode aktif</small>
          <strong>{{ isLmsMvp ? 'Per kelas' : 'Sesuai konfigurasi' }}</strong>
        </span>
        <i class="uil uil-angle-down semester-context__chevron" aria-hidden="true" />
      </div>

      <nav class="app-sidebar__nav">
        <section v-for="group in visibleNavigation" :key="group.label" class="nav-group">
          <p class="nav-group__label">{{ group.label }}</p>
          <NuxtLink
            v-for="item in group.items"
            :key="item.to"
            :to="item.to"
            class="nav-item"
            :title="sidebarCompact ? item.label : undefined"
            @click="closeSidebar"
          >
            <i class="uil nav-item__icon" :class="item.icon" aria-hidden="true" />
            <span class="nav-item__label">{{ item.label }}</span>
            <span v-if="item.badge" class="nav-item__badge">{{ item.badge }}</span>
          </NuxtLink>
        </section>
      </nav>

      <div class="app-sidebar__footer">
        <div class="system-status">
          <span class="system-status__dot" aria-hidden="true" />
          <span>
            <strong>Status layanan</strong>
            <small>Pantau melalui audit &amp; health</small>
          </span>
        </div>
        <button class="compact-toggle d-none d-lg-flex" type="button" :aria-label="sidebarCompact ? 'Perluas navigasi' : 'Ringkas navigasi'" @click="toggleCompact">
          <i class="uil" :class="sidebarCompact ? 'uil-angle-double-right' : 'uil-angle-double-left'" aria-hidden="true" />
          <span>Ringkas menu</span>
        </button>
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { navigation, navigationPermissionAllowed } from '~/config/navigation'

const { sidebarOpen, sidebarCompact, closeSidebar, toggleCompact } = useAppShell()
const { user, can } = useAuth()
const { enabled, pageEnabled, isLmsMvp } = useFeatureFlags()
const config = useRuntimeConfig()
const appName = computed(() => String(config.public.appName || 'Nusa Campus').trim())
const appInitial = computed(() => appName.value.charAt(0).toUpperCase() || 'N')

const visibleNavigation = computed(() => {
  const activeRole = user.value?.activeRole || user.value?.roles[0] || ''
  const hideStudentKrs = activeRole !== 'student' && can('krs:approve')
  return navigation
    .map(group => ({
      ...group,
      items: group.items.filter(item => {
        if (hideStudentKrs && item.to === '/akademik/krs') return false
        return enabled(item.feature) && pageEnabled(item.to) && navigationPermissionAllowed(item.permission, can)
      }),
    }))
    .filter(group => group.items.length)
})
</script>
