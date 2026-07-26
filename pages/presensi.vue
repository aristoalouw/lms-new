<script setup lang="ts">
import type { AxiosError } from 'axios'
import type { AttendanceRecord } from '~/shared/contracts/lms'

definePageMeta({ layout: 'auth' })
useHead({ title: 'Konfirmasi presensi', meta: [{ name: 'referrer', content: 'no-referrer' }] })

const STORAGE_KEY = 'lms-attendance-challenge'
const { isAuthenticated, restoreSession } = useAuth()
const { $api } = useNuxtApp()
const pending = ref(true)
const errorMessage = ref('')
const attendance = ref<AttendanceRecord | null>(null)

function classIdFromToken(token: string): string | undefined {
  const parts = token.split('.')
  if (parts.length !== 4 || parts[0] !== 'qr1') return undefined
  try {
    const encoded = parts[1]!.replace(/-/g, '+').replace(/_/g, '/')
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')
    return decodeURIComponent(Array.from(atob(padded), character => `%${character.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''))
  } catch {
    return undefined
  }
}

function safeError(error: unknown): string {
  const response = (error as AxiosError<{ statusMessage?: string; message?: string }>).response
  if (response?.status === 409) return response.data?.statusMessage || 'Challenge presensi sudah dipakai, tidak valid, atau kedaluwarsa.'
  if (response?.status === 403) return 'Akun ini tidak memiliki enrolment aktif pada kelas tersebut.'
  return response?.data?.statusMessage || response?.data?.message || 'Presensi belum dapat dikonfirmasi. Periksa koneksi lalu coba lagi.'
}

async function checkIn() {
  pending.value = true
  errorMessage.value = ''
  const fragment = window.location.hash.slice(1)
  if (fragment) sessionStorage.setItem(STORAGE_KEY, fragment)
  history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
  const token = fragment || sessionStorage.getItem(STORAGE_KEY) || ''
  if (!token) {
    pending.value = false
    errorMessage.value = 'Challenge presensi tidak ditemukan. Pindai ulang QR yang ditampilkan dosen.'
    return
  }

  await restoreSession()
  if (!isAuthenticated.value) {
    pending.value = false
    await navigateTo({ path: '/login', query: { redirect: '/presensi' } })
    return
  }

  const classId = classIdFromToken(token)
  if (!classId || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(classId)) {
    sessionStorage.removeItem(STORAGE_KEY)
    pending.value = false
    errorMessage.value = 'Format challenge presensi tidak valid. Pindai ulang QR.'
    return
  }

  try {
    const key = `attendance-checkin-${globalThis.crypto.randomUUID()}`
    const { data } = await $api.post<{ value: AttendanceRecord }>(
      `/academic/classes/${encodeURIComponent(classId)}/attendance/check-in`,
      { challengeToken: token },
      { headers: { 'Idempotency-Key': key } },
    )
    attendance.value = data.value
    sessionStorage.removeItem(STORAGE_KEY)
  } catch (error) {
    errorMessage.value = safeError(error)
    if ((error as AxiosError).response && (error as AxiosError).response!.status < 500) sessionStorage.removeItem(STORAGE_KEY)
  } finally {
    pending.value = false
  }
}

onMounted(checkIn)
</script>

<template>
  <main class="attendance-confirmation" data-clarity-mask="true">
    <section class="attendance-card" aria-live="polite">
      <span class="attendance-card__icon" :class="attendance ? 'success' : errorMessage ? 'danger' : ''">
        <i class="uil" :class="attendance ? 'uil-check-circle' : errorMessage ? 'uil-exclamation-triangle' : 'uil-qrcode-scan'" aria-hidden="true" />
      </span>
      <template v-if="pending">
        <h1>Memverifikasi presensi</h1>
        <p>Enrolment, kelas, pertemuan, dan masa berlaku challenge sedang diperiksa.</p>
        <span class="spinner-border text-success" aria-hidden="true" />
      </template>
      <template v-else-if="attendance">
        <h1>Presensi berhasil dicatat</h1>
        <p>Status Anda: <strong>{{ attendance.status === 'LATE' ? 'Terlambat' : 'Hadir' }}</strong>. Catatan ini hanya berlaku untuk satu mahasiswa dan satu pertemuan.</p>
        <NuxtLink class="btn btn-primary" to="/pembelajaran">Kembali ke pembelajaran</NuxtLink>
      </template>
      <template v-else>
        <h1>Presensi belum tercatat</h1>
        <p class="text-danger">{{ errorMessage }}</p>
        <NuxtLink class="btn btn-outline-primary" to="/pembelajaran">Kembali ke pembelajaran</NuxtLink>
      </template>
    </section>
  </main>
</template>

<style scoped>
.attendance-confirmation{min-height:100vh;display:grid;place-items:center;padding:1.25rem;background:linear-gradient(145deg,#eef5f0,#f8faf8)}.attendance-card{width:min(100%,520px);display:grid;justify-items:center;gap:1rem;padding:clamp(1.5rem,5vw,3rem);border:1px solid #dbe7e0;border-radius:1.25rem;background:#fff;text-align:center;box-shadow:0 22px 60px rgba(25,68,55,.1)}.attendance-card__icon{display:grid;place-items:center;width:4rem;height:4rem;border-radius:1rem;color:#3d705e;background:#edf5f0;font-size:2rem}.attendance-card__icon.success{color:#23704e;background:#e5f5eb}.attendance-card__icon.danger{color:#a03d3d;background:#fbecec}.attendance-card h1{margin:0;color:#1e4438;font-size:clamp(1.5rem,4vw,2rem)}.attendance-card p{margin:0;color:#687c74;line-height:1.7}
</style>
