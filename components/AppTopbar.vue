<template>
  <header class="app-topbar">
    <a class="skip-link" href="#main-content">Lewati ke konten</a>
    <button class="topbar-icon d-lg-none" type="button" aria-label="Buka navigasi" @click="toggleSidebar">
      <i class="uil uil-bars" aria-hidden="true" />
    </button>

    <button class="command-search" type="button" aria-label="Buka pencarian cepat" @click="commandOpen = true">
      <i class="uil uil-search" aria-hidden="true" />
      <span>Cari mahasiswa, kelas, atau layanan…</span>
      <kbd class="d-none d-md-inline-flex">Ctrl K</kbd>
    </button>

    <div class="topbar-actions">
      <div class="topbar-period d-none d-xl-flex">
        <span class="live-dot" aria-hidden="true" />
        {{ isLmsMvp ? 'Mode LMS aktif' : 'Platform kampus' }}
      </div>
      <div class="topbar-popover-wrap">
        <button class="topbar-icon" type="button" :aria-expanded="helpOpen" aria-label="Bantuan" @click="toggleHelp">
          <i class="uil uil-question-circle" aria-hidden="true" />
        </button>
        <div v-if="helpOpen" class="notification-popover shadow-lg">
          <div class="notification-popover__head">
            <div><p class="eyebrow mb-1">Panduan cepat</p><h2>Bantuan portal</h2></div>
            <button class="btn btn-link btn-sm" type="button" @click="helpOpen = false">Tutup</button>
          </div>
          <div class="p-3 d-grid gap-2 small">
            <p class="mb-1 text-muted">Tekan <kbd>Ctrl</kbd> + <kbd>K</kbd> kapan saja untuk mencari menu atau modul yang tersedia pada peran aktif Anda (<strong>{{ activeRoleLabel }}</strong>).</p>
            <NuxtLink class="btn btn-outline-secondary btn-sm text-start" to="/profil" @click="helpOpen = false"><i class="uil uil-user-circle me-1" /> Profil & preferensi akun</NuxtLink>
            <NuxtLink class="btn btn-outline-secondary btn-sm text-start" to="/notifikasi" @click="helpOpen = false"><i class="uil uil-bell me-1" /> Pusat notifikasi</NuxtLink>
            <NuxtLink v-if="can('service.read')" class="btn btn-outline-secondary btn-sm text-start" to="/layanan" @click="helpOpen = false"><i class="uil uil-file-check-alt me-1" /> Layanan tata usaha & tiket</NuxtLink>
            <NuxtLink v-if="can('settings.read')" class="btn btn-outline-secondary btn-sm text-start" to="/modul/pengaturan" @click="helpOpen = false"><i class="uil uil-setting me-1" /> Pengaturan sistem</NuxtLink>
          </div>
        </div>
      </div>
      <div class="topbar-popover-wrap">
        <button class="topbar-icon" :class="{ 'topbar-icon--notified': visibleNotices.length }" type="button" :aria-expanded="notificationsOpen" aria-label="Buka notifikasi" @click="notificationsOpen = !notificationsOpen">
          <i class="uil uil-bell" aria-hidden="true" />
          <span v-if="visibleNotices.length" class="notification-ping" />
        </button>
        <div v-if="notificationsOpen" class="notification-popover shadow-lg">
          <div class="notification-popover__head">
            <div><p class="eyebrow mb-1">Pusat aktivitas</p><h2>Notifikasi</h2></div>
            <button class="btn btn-link btn-sm" type="button" :disabled="markingNotices" @click="markVisibleNoticesRead">Tandai dibaca</button>
          </div>
          <div class="notification-list">
            <NuxtLink v-for="notice in visibleNotices" :key="notice.id" :to="notice.to" class="notification-item" @click="openNotice(notice.id)">
              <span class="notification-item__icon" :class="`notification-item__icon--${notice.tone}`"><i class="uil" :class="notice.icon" /></span>
              <span><strong>{{ notice.title }}</strong><small>{{ notice.detail }}</small><time>{{ notice.time }}</time></span>
            </NuxtLink>
            <p v-if="!visibleNotices.length" class="px-3 py-3 mb-0 text-muted small">Buka pusat notifikasi untuk melihat aktivitas terbaru.</p>
          </div>
          <NuxtLink to="/notifikasi" class="notification-popover__all" @click="notificationsOpen = false">Lihat seluruh notifikasi <i class="uil uil-arrow-right" /></NuxtLink>
        </div>
      </div>

      <div class="dropdown">
        <button ref="profileTrigger" class="profile-trigger" type="button" data-bs-toggle="dropdown" aria-expanded="false">
          <span class="avatar">{{ user?.initials }}</span>
          <span class="profile-trigger__copy d-none d-md-flex">
            <strong>{{ user?.name }}</strong>
            <small>{{ activeRoleLabel }}</small>
          </span>
          <i class="uil uil-angle-down d-none d-md-inline" aria-hidden="true" />
        </button>
        <div class="dropdown-menu dropdown-menu-end profile-menu shadow-lg">
          <div class="profile-menu__header">
            <span class="avatar avatar--large">{{ user?.initials }}</span>
            <span><strong>{{ user?.name }}</strong><small>{{ user?.email }}</small></span>
          </div>
          <div v-if="user && user.roles.length > 1" class="profile-menu__roles">
            <p>Ganti peran aktif</p>
            <button v-for="role in user.roles" :key="role" class="role-option" :class="{ active: role === user.activeRole }" type="button" @click="selectRole(role)">
              <span><i class="uil uil-user-square" /> {{ roleLabels[role] }}</span><i v-if="role === user.activeRole" class="uil uil-check" />
            </button>
          </div>
          <div class="dropdown-divider" />
          <NuxtLink class="dropdown-item" to="/profil"><i class="uil uil-user-circle" /> Profil & preferensi</NuxtLink>
          <NuxtLink v-if="!isLmsMvp && can('settings.read')" class="dropdown-item" to="/modul/pengaturan"><i class="uil uil-setting" /> Pengaturan sistem</NuxtLink>
          <button class="dropdown-item text-danger" type="button" @click="logout"><i class="uil uil-signout" /> Keluar</button>
        </div>
      </div>
    </div>

    <div v-if="commandOpen" class="command-overlay" role="presentation" @click.self="commandOpen = false">
      <section class="command-dialog" role="dialog" aria-modal="true" aria-labelledby="command-title">
        <div class="command-dialog__input">
          <i class="uil uil-search" aria-hidden="true" />
          <input ref="searchInput" v-model="query" type="search" placeholder="Ketik nama, NIM, kelas, atau menu…" aria-label="Pencarian cepat" @keyup.esc="commandOpen = false">
          <kbd>Esc</kbd>
        </div>
        <div class="command-dialog__body">
          <p id="command-title" class="eyebrow">Akses cepat</p>
          <NuxtLink v-for="result in filteredCommands" :key="result.to" :to="result.to" class="command-result" @click="commandOpen = false">
            <span><i class="uil" :class="result.icon" /></span>
            <span><strong>{{ result.label }}</strong><small>{{ result.context }}</small></span>
            <i class="uil uil-arrow-up-right" />
          </NuxtLink>
        </div>
      </section>
    </div>
  </header>
</template>

<script setup lang="ts">
import { navigationCommandsForAccess, roleLabels } from '~/config/navigation'
import { featureForPagePath } from '~/shared/features'
import type { InAppNotification, NotificationCategory } from '~/server/types/communications'

const { toggleSidebar, commandOpen, notificationsOpen } = useAppShell()
const { user, can, logout, switchRole } = useAuth()
const { enabled, pageEnabled, isLmsMvp } = useFeatureFlags()
const { $api } = useNuxtApp()
const searchInput = ref<HTMLInputElement>()
const profileTrigger = ref<HTMLButtonElement>()
const query = ref('')
const notices = ref<InAppNotification[]>([])
const markingNotices = ref(false)
const helpOpen = ref(false)
const toggleHelp = () => {
  helpOpen.value = !helpOpen.value
  if (helpOpen.value) notificationsOpen.value = false
}
const selectRole = async (role: Parameters<typeof switchRole>[0]) => {
  helpOpen.value = false
  if (profileTrigger.value?.getAttribute('aria-expanded') === 'true') {
    profileTrigger.value.click()
  }
  await switchRole(role)
  void loadNotices()
}

const noticeMeta: Record<NotificationCategory, { icon: string; tone: string }> = {
  ACADEMIC: { icon: 'uil-graduation-cap', tone: 'blue' },
  FINANCE: { icon: 'uil-receipt', tone: 'amber' },
  LEARNING: { icon: 'uil-book-open', tone: 'green' },
  SERVICE: { icon: 'uil-comment-alt-check', tone: 'blue' },
  SYSTEM: { icon: 'uil-shield-check', tone: 'green' },
}
const noticeTime = (value: string) => new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Jakarta',
}).format(new Date(value))
const visibleNotices = computed(() => notices.value
  .filter(notice => !notice.readAt)
  .filter((notice) => {
    const path = notice.actionPath || '/notifikasi'
    const feature = featureForPagePath(path)
    return pageEnabled(path) && (!feature || enabled(feature))
  })
  .slice(0, 5)
  .map(notice => ({
    id: notice.id,
    title: notice.title,
    detail: notice.body,
    time: noticeTime(notice.createdAt),
    icon: noticeMeta[notice.category].icon,
    tone: noticeMeta[notice.category].tone,
    to: notice.actionPath || '/notifikasi',
  })))

const loadNotices = async () => {
  try {
    const { data } = await $api.get<{ notifications: InAppNotification[] }>('/notifications', {
      params: { unreadOnly: true, limit: 5 },
    })
    notices.value = data.notifications
  } catch {
    notices.value = []
  }
}

const openNotice = async (id: string) => {
  notificationsOpen.value = false
  notices.value = notices.value.map(item => item.id === id ? { ...item, readAt: new Date().toISOString() } : item)
  try {
    await $api.post(`/notifications/${encodeURIComponent(id)}/read`)
  } catch {
    await loadNotices()
  }
}

const markVisibleNoticesRead = async () => {
  if (!visibleNotices.value.length || markingNotices.value) return
  markingNotices.value = true
  const ids = visibleNotices.value.map(notice => notice.id)
  notices.value = notices.value.map(item => ids.includes(item.id) ? { ...item, readAt: new Date().toISOString() } : item)
  try {
    await Promise.all(ids.map(id => $api.post(`/notifications/${encodeURIComponent(id)}/read`)))
  } catch {
    await loadNotices()
  } finally {
    markingNotices.value = false
  }
}

const commands = computed(() => navigationCommandsForAccess(enabled, can, pageEnabled))
const filteredCommands = computed(() => commands.value.filter(item => `${item.label} ${item.context}`.toLowerCase().includes(query.value.toLowerCase())).slice(0, 7))
const activeRoleLabel = computed(() => user.value ? roleLabels[user.value.activeRole] : '')

watch(commandOpen, async (open) => {
  if (open) {
    query.value = ''
    helpOpen.value = false
    notificationsOpen.value = false
    await nextTick()
    searchInput.value?.focus()
  }
})

watch(notificationsOpen, (open) => {
  if (open) {
    helpOpen.value = false
    void loadNotices()
  }
})

const onKeydown = (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    commandOpen.value = true
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  void loadNotices()
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>
