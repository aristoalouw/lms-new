<script setup lang="ts">
import { roleLabels } from '~/config/navigation'
import {
  LMS_MVP_NOTIFICATION_CATEGORIES,
  type NotificationCategory,
  type NotificationPreferences,
} from '~/server/types/communications'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Profil & Preferensi' })

const config = useRuntimeConfig()
const { $api } = useNuxtApp()
const { user, can, switchRole } = useAuth()
const { isLmsMvp } = useFeatureFlags()
const { available: passwordResetAvailable, requestPasswordReset } = usePasswordReset()

const loading = ref(true)
const saving = ref(false)
const resetPending = ref(false)
const noticeMessage = ref('')
const errorMessage = ref('')
const rememberedEmail = ref('')
const emailAvailable = computed(() => config.public.emailDeliveryEnabled)
const lmsCategorySet = new Set<NotificationCategory>(LMS_MVP_NOTIFICATION_CATEGORIES)

const preferences = reactive<NotificationPreferences>({
  uid: '',
  inAppEnabled: true,
  emailEnabled: false,
  categoryEmail: { ACADEMIC: false, FINANCE: false, LEARNING: false, SERVICE: false, SYSTEM: false },
  quietHours: { start: '21:00', end: '06:00', timezone: 'Asia/Jakarta' },
  updatedAt: '',
})

const categoryLabels: Record<NotificationCategory, string> = {
  ACADEMIC: 'Akademik & KRS',
  FINANCE: 'Keuangan & tagihan',
  LEARNING: 'Pembelajaran & kelas',
  SERVICE: 'Layanan tata usaha',
  SYSTEM: 'Sistem & keamanan',
}

const categoryEntries = computed(() => (Object.entries(categoryLabels) as Array<[NotificationCategory, string]>)
  .filter(([category]) => !isLmsMvp.value || lmsCategorySet.has(category)))

const activeRoleLabel = computed(() => user.value ? (roleLabels[user.value.activeRole] || user.value.activeRole) : '—')

const load = async () => {
  loading.value = true
  errorMessage.value = ''
  if (import.meta.client) {
    try {
      rememberedEmail.value = window.localStorage.getItem('campus.rememberedEmail')?.trim() || ''
    } catch {
      rememberedEmail.value = ''
    }
  }
  if (!config.public.demoMode) {
    try {
      const { data } = await $api.get<{ preferences: NotificationPreferences }>('/notifications/preferences')
      Object.assign(preferences, data.preferences)
      if (!emailAvailable.value) {
        preferences.emailEnabled = false
        for (const category of Object.keys(preferences.categoryEmail) as NotificationCategory[]) {
          preferences.categoryEmail[category] = false
        }
      }
    } catch {
      errorMessage.value = 'Preferensi notifikasi belum dapat dimuat.'
    }
  }
  loading.value = false
}

const savePreferences = async () => {
  saving.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    if (!config.public.demoMode) {
      await $api.put('/notifications/preferences', {
        inAppEnabled: preferences.inAppEnabled,
        emailEnabled: emailAvailable.value && preferences.emailEnabled,
        categoryEmail: emailAvailable.value
          ? preferences.categoryEmail
          : Object.fromEntries(Object.keys(preferences.categoryEmail).map(category => [category, false])),
        quietHours: preferences.quietHours,
      })
    }
    noticeMessage.value = 'Preferensi notifikasi berhasil disimpan.'
  } catch {
    errorMessage.value = 'Preferensi notifikasi belum berhasil disimpan.'
  } finally {
    saving.value = false
  }
}

const clearRememberedEmail = () => {
  if (!import.meta.client) return
  try {
    window.localStorage.removeItem('campus.rememberedEmail')
    rememberedEmail.value = ''
    noticeMessage.value = 'Email tersimpan pada perangkat ini telah dihapus.'
  } catch {
    errorMessage.value = 'Gagal menghapus data perangkat lokal.'
  }
}

const sendPasswordReset = async () => {
  if (!user.value?.email || !passwordResetAvailable.value) return
  resetPending.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const key = `profile-reset-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
    noticeMessage.value = await requestPasswordReset(user.value.email, key)
  } catch {
    errorMessage.value = 'Permintaan reset kata sandi belum dapat diproses.'
  } finally {
    resetPending.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page-stack profile-page">
    <AppPageHeader eyebrow="Akun pengguna" title="Profil & Preferensi" description="Kelola peran aktif, preferensi notifikasi, dan keamanan perangkat pribadi Anda.">
      <template #actions>
        <NuxtLink v-if="!isLmsMvp && can('settings.read')" class="btn btn-outline-secondary" to="/modul/pengaturan">
          <i class="uil uil-setting me-2" />Pengaturan sistem
        </NuxtLink>
      </template>
    </AppPageHeader>

    <div v-if="noticeMessage" class="alert alert-success" role="status">{{ noticeMessage }}</div>
    <div v-if="errorMessage" class="alert alert-warning" role="alert">{{ errorMessage }}</div>

    <div class="profile-grid">
      <section class="surface-card">
        <header>
          <span>Identitas akun</span>
          <h2>{{ user?.name || 'Pengguna Kampus' }}</h2>
          <p>{{ user?.email || 'Email tidak tersedia' }}</p>
        </header>

        <dl class="profile-meta">
          <div>
            <dt>Peran aktif</dt>
            <dd>{{ activeRoleLabel }}</dd>
          </div>
          <div>
            <dt>Program studi</dt>
            <dd>{{ user?.programStudyId || 'Seluruh kampus / sesuai peran' }}</dd>
          </div>
          <div v-if="user?.studentId">
            <dt>ID Mahasiswa / NIM</dt>
            <dd>{{ user.studentId }}</dd>
          </div>
          <div>
            <dt>Izin aktif</dt>
            <dd>{{ user?.permissions.length || 0 }} permission</dd>
          </div>
        </dl>

        <div v-if="user && user.roles.length > 1" class="role-switcher">
          <p class="section-label">Ganti peran aktif</p>
          <div class="role-chip-row">
            <button
              v-for="role in user.roles"
              :key="role"
              type="button"
              class="btn btn-sm"
              :class="role === user.activeRole ? 'btn-primary' : 'btn-outline-secondary'"
              @click="switchRole(role)"
            >
              {{ roleLabels[role] || role }}
            </button>
          </div>
        </div>

        <div class="security-actions">
          <p class="section-label">Keamanan & perangkat ini</p>
          <div class="device-row">
            <span>
              <strong>Ingat akun di perangkat ini</strong>
              <small>{{ rememberedEmail ? `Tersimpan: ${rememberedEmail}` : 'Tidak ada email yang disimpan pada browser ini.' }}</small>
            </span>
            <button v-if="rememberedEmail" class="btn btn-outline-secondary btn-sm" type="button" @click="clearRememberedEmail">
              Hapus
            </button>
          </div>
          <div class="device-row">
            <span>
              <strong>Atur ulang kata sandi</strong>
              <small>Kirim tautan reset kata sandi ke email akun Anda.</small>
            </span>
            <button class="btn btn-outline-primary btn-sm" type="button" :disabled="resetPending || !passwordResetAvailable" @click="sendPasswordReset">
              {{ resetPending ? 'Mengirim…' : 'Kirim tautan' }}
            </button>
          </div>
        </div>
      </section>

      <section class="surface-card">
        <header>
          <span>Preferensi notifikasi</span>
          <h2>Kanal & jam tenang</h2>
          <p>Perubahan diterapkan langsung pada pusat notifikasi akun Anda.</p>
        </header>

        <div v-if="!emailAvailable" class="alert alert-info py-2 px-3 small mb-3" role="status">
          Notifikasi dalam aplikasi aktif. Pengiriman email belum diaktifkan pada paket awal.
        </div>

        <div class="pref-list">
          <label class="pref-row">
            <span>
              <strong>Notifikasi dalam aplikasi</strong>
              <small>Tampilkan pemberitahuan KRS, pembelajaran, dan layanan pada lonceng notifikasi.</small>
            </span>
            <input v-model="preferences.inAppEnabled" class="form-check-input" type="checkbox" role="switch" :disabled="loading">
          </label>

          <label class="pref-row">
            <span>
              <strong>Notifikasi melalui email</strong>
              <small>{{ emailAvailable ? 'Kirim salinan pemberitahuan ke email kampus Anda.' : 'Menunggu konfigurasi provider email kampus.' }}</small>
            </span>
            <input v-model="preferences.emailEnabled" class="form-check-input" type="checkbox" role="switch" :disabled="loading || !emailAvailable">
          </label>

          <label v-for="[key, label] in categoryEntries" :key="key" class="pref-row">
            <span>
              <strong>Email: {{ label }}</strong>
              <small>Terima pembaruan kategori {{ label.toLowerCase() }} melalui email.</small>
            </span>
            <input v-model="preferences.categoryEmail[key]" class="form-check-input" type="checkbox" role="switch" :disabled="loading || !emailAvailable || !preferences.emailEnabled">
          </label>
        </div>

        <div class="quiet-row">
          <label>
            <span>Jam tenang mulai (WIB)</span>
            <input v-model="preferences.quietHours!.start" class="form-control form-control-sm" type="time" :disabled="loading">
          </label>
          <label>
            <span>Jam tenang selesai (WIB)</span>
            <input v-model="preferences.quietHours!.end" class="form-control form-control-sm" type="time" :disabled="loading">
          </label>
        </div>

        <div class="pref-actions">
          <button class="btn btn-primary btn-sm" type="button" :disabled="loading || saving" @click="savePreferences">
            <span v-if="saving" class="spinner-border spinner-border-sm me-2" />Simpan preferensi
          </button>
          <NuxtLink class="btn btn-outline-secondary btn-sm" to="/notifikasi">Buka pusat notifikasi</NuxtLink>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.profile-page { display: grid; gap: 1rem; }
.profile-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; align-items: start; }
.surface-card { border: 1px solid #e6dfd6; border-radius: .95rem; background: #fff; padding: 1.15rem; box-shadow: 0 8px 24px rgba(30, 30, 30, .04); }
.surface-card > header { margin-bottom: 1rem; }
.surface-card > header span { color: #775a83; font-size: .56rem; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
.surface-card > header h2 { margin: .15rem 0 .2rem; color: #3e2344; font-size: 1rem; }
.surface-card > header p { margin: 0; color: #6c6865; font-size: .62rem; }
.profile-meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; margin: 0 0 1rem; padding: .8rem; border-radius: .75rem; background: #f7f3f9; }
.profile-meta dt { color: #6c6865; font-size: .54rem; font-weight: 600; }
.profile-meta dd { margin: .12rem 0 0; color: #3e2344; font-size: .66rem; font-weight: 700; word-break: break-word; }
.section-label { margin: 0 0 .5rem; color: #4e5462; font-size: .58rem; font-weight: 700; text-transform: uppercase; }
.role-switcher { margin-bottom: 1rem; }
.role-chip-row { display: flex; flex-wrap: wrap; gap: .4rem; }
.security-actions { display: grid; gap: .6rem; padding-top: .85rem; border-top: 1px solid #ece6dd; }
.device-row, .pref-row { display: flex; align-items: center; justify-content: space-between; gap: .8rem; padding: .65rem 0; border-bottom: 1px solid #ece6dd; }
.device-row strong, .device-row small, .pref-row strong, .pref-row small { display: block; }
.device-row strong, .pref-row strong { color: #3e2344; font-size: .64rem; }
.device-row small, .pref-row small { margin-top: .12rem; color: #6c6865; font-size: .54rem; }
.pref-list { display: grid; }
.quiet-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .75rem; margin-top: .85rem; }
.quiet-row label span { display: block; margin-bottom: .25rem; color: #4e5462; font-size: .58rem; }
.pref-actions { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: 1rem; }
@media (max-width: 991.98px) { .profile-grid { grid-template-columns: 1fr; } }
</style>
