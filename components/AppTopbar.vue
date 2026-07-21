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
        Sinkron terakhir 08.42 WIB
      </div>
      <button class="topbar-icon" type="button" aria-label="Bantuan">
        <i class="uil uil-question-circle" aria-hidden="true" />
      </button>
      <div class="topbar-popover-wrap">
        <button class="topbar-icon topbar-icon--notified" type="button" :aria-expanded="notificationsOpen" aria-label="3 notifikasi baru" @click="notificationsOpen = !notificationsOpen">
          <i class="uil uil-bell" aria-hidden="true" />
          <span class="notification-ping" />
        </button>
        <div v-if="notificationsOpen" class="notification-popover shadow-lg">
          <div class="notification-popover__head">
            <div><p class="eyebrow mb-1">Pusat aktivitas</p><h2>Notifikasi</h2></div>
            <button class="btn btn-link btn-sm">Tandai dibaca</button>
          </div>
          <div class="notification-list">
            <NuxtLink v-for="notice in visibleNotices" :key="notice.title" :to="notice.to" class="notification-item" @click="notificationsOpen = false">
              <span class="notification-item__icon" :class="`notification-item__icon--${notice.tone}`"><i class="uil" :class="notice.icon" /></span>
              <span><strong>{{ notice.title }}</strong><small>{{ notice.detail }}</small><time>{{ notice.time }}</time></span>
            </NuxtLink>
          </div>
          <NuxtLink to="/modul/notifikasi" class="notification-popover__all" @click="notificationsOpen = false">Lihat seluruh notifikasi <i class="uil uil-arrow-right" /></NuxtLink>
        </div>
      </div>

      <div class="dropdown">
        <button class="profile-trigger" type="button" data-bs-toggle="dropdown" aria-expanded="false">
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
            <button v-for="role in user.roles" :key="role" class="role-option" :class="{ active: role === user.activeRole }" type="button" @click="switchRole(role)">
              <span><i class="uil uil-user-square" /> {{ roleLabels[role] }}</span><i v-if="role === user.activeRole" class="uil uil-check" />
            </button>
          </div>
          <div class="dropdown-divider" />
          <NuxtLink class="dropdown-item" to="/modul/pengaturan"><i class="uil uil-user-circle" /> Profil & preferensi</NuxtLink>
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
import { navigation, roleLabels } from '~/config/navigation'
import type { Feature } from '~/shared/features'

const { toggleSidebar, commandOpen, notificationsOpen } = useAppShell()
const { user, logout, switchRole } = useAuth()
const { enabled } = useFeatureFlags()
const searchInput = ref<HTMLInputElement>()
const query = ref('')

const notices = [
  { title: '12 data perlu validasi', detail: 'Pelaporan PDDIKTI periode Genap', time: '8 menit lalu', icon: 'uil-sync', tone: 'amber', to: '/pddikti' },
  { title: 'Pembayaran berhasil direkonsiliasi', detail: 'Batch VA Bank Mandiri · 84 transaksi', time: '24 menit lalu', icon: 'uil-receipt', tone: 'green', to: '/keuangan' },
  { title: 'Batas persetujuan KRS besok', detail: '36 mahasiswa menunggu persetujuan', time: '1 jam lalu', icon: 'uil-clock', tone: 'blue', to: '/akademik/krs' },
]
const noticeFeatures: Record<string, Feature> = {
  '/pddikti': 'pddikti',
  '/keuangan': 'finance',
  '/akademik/krs': 'krs',
}
const visibleNotices = computed(() => notices.filter(notice => enabled(noticeFeatures[notice.to] || 'notifications')))

const commands = computed(() => navigation.flatMap(group => group.items
  .filter(item => enabled(item.feature))
  .map(item => ({ ...item, context: group.label }))))
const filteredCommands = computed(() => commands.value.filter(item => `${item.label} ${item.context}`.toLowerCase().includes(query.value.toLowerCase())).slice(0, 7))
const activeRoleLabel = computed(() => user.value ? roleLabels[user.value.activeRole] : '')

watch(commandOpen, async (open) => {
  if (open) {
    query.value = ''
    await nextTick()
    searchInput.value?.focus()
  }
})

const onKeydown = (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    commandOpen.value = true
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>
