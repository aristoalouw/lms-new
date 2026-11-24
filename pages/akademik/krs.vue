<script setup lang="ts">
import { krsCourses as demoKrsCourses } from '~/data/workflows'
import type { KrsRecord, KrsStatus } from '~/server/types/domain'
import type { KrsCatalogEntry, KrsPeriodPolicy, KrsStudentAcademicState, KrsWriteResult } from '~/server/types/krs-enrollment'
import type { AcademicAdministrationWorkspace, AcademicPeriodDefinition, AcademicProgramStudy } from '~/server/types/academic-administration'

interface CatalogRow {
  id: string
  code: string
  name: string
  class: string
  schedule: string
  dayName: string
  startMinutes: number | null
  endMinutes: number | null
  lecturer: string
  credits: number
  capacity: string
  status: string
}

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Kartu Rencana Studi' })

const selectedPeriodId = ref('2026-2027-1')
const courseFilter = ref<'ALL' | 'SELECTED' | 'AVAILABLE'>('ALL')
const showScheduleView = ref(false)
const config = useRuntimeConfig()
const { $api } = useNuxtApp()
const { user, can } = useAuth()

const courseCatalog = ref<CatalogRow[]>(config.public.demoMode
  ? demoKrsCourses.map(course => ({ ...course, id: course.code, dayName: 'Senin', startMinutes: null, endMinutes: null }))
  : [])
const selectedClassIdList = ref<string[]>(courseCatalog.value.filter(course => course.status === 'Terpilih').map(course => course.id))
const recordStatus = ref<KrsStatus>('DRAFT')
const reviewNotes = ref('')
const showConfirmation = ref(false)
const acceptedDeclaration = ref(false)
const mutating = ref(false)
const loading = ref(!config.public.demoMode)
const errorMessage = ref('')
const noticeMessage = ref('')
const currentPlanId = ref('')
const currentVersion = ref(0)
const studentState = ref<KrsStudentAcademicState | null>(null)
const periodPolicy = ref<KrsPeriodPolicy | null>(null)
const periods = ref<AcademicPeriodDefinition[]>([])
const programs = ref<AcademicProgramStudy[]>([])
const setupMessage = ref('')

const courseColumns = [
  { key: 'selection', label: 'Pilih', sortable: false, align: 'center' as const, width: '68px' },
  { key: 'name', label: 'Mata kuliah', sortable: true },
  { key: 'schedule', label: 'Jadwal' },
  { key: 'lecturer', label: 'Dosen pengampu' },
  { key: 'credits', label: 'SKS', align: 'center' as const, width: '68px' },
  { key: 'capacity', label: 'Kursi', align: 'center' as const, width: '88px' },
  { key: 'status', label: 'Status', width: '130px' },
]

const selectedCourses = computed(() => courseCatalog.value.filter(course => selectedClassIdList.value.includes(course.id)))
const selectedCredits = computed(() => selectedCourses.value.reduce((total, course) => total + course.credits, 0))
const selectedCount = computed(() => selectedCourses.value.length)
const maximumCredits = computed(() => studentState.value?.maximumCredits ?? 24)
const remainingCredits = computed(() => Math.max(0, maximumCredits.value - selectedCredits.value))
const activeHolds = computed(() => studentState.value?.holds.filter(item => item.active) ?? [])
const isEditable = computed(() => recordStatus.value === 'DRAFT' || recordStatus.value === 'REJECTED')
const krsReady = computed(() => config.public.demoMode || Boolean(studentState.value && periodPolicy.value))
const canSubmit = computed(() => krsReady.value
  && isEditable.value
  && selectedCount.value > 0
  && (config.public.demoMode || (periodPolicy.value?.status === 'KRS_OPEN' && activeHolds.value.length === 0)))

const courseRows = computed(() => courseCatalog.value
  .filter(course =>
    courseFilter.value === 'ALL'
    || (courseFilter.value === 'SELECTED' ? selectedClassIdList.value.includes(course.id) : !selectedClassIdList.value.includes(course.id)),
  )
  .map(course => ({
    ...course,
    selection: course.id,
    status: selectedClassIdList.value.includes(course.id) ? 'Terpilih' : course.status,
  })))

const dayOrder = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']
const scheduleConflicts = computed(() => {
  const conflicts = new Set<string>()
  const items = selectedCourses.value
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i]!
      const b = items[j]!
      if (a.dayName && a.dayName === b.dayName && a.startMinutes !== null && a.endMinutes !== null && b.startMinutes !== null && b.endMinutes !== null) {
        if (a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes) {
          conflicts.add(a.id)
          conflicts.add(b.id)
        }
      }
    }
  }
  return conflicts
})

const weeklySchedule = computed(() => {
  const groups = new Map<string, CatalogRow[]>()
  for (const item of selectedCourses.value) {
    const day = item.dayName || 'Jadwal fleksibel'
    const list = groups.get(day) || []
    list.push(item)
    groups.set(day, list)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      const ia = dayOrder.indexOf(a)
      const ib = dayOrder.indexOf(b)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    })
    .map(([day, items]) => ({
      day,
      items: items.sort((a, b) => (a.startMinutes ?? 9999) - (b.startMinutes ?? 9999)),
    }))
})

const termLabel = (term: AcademicPeriodDefinition['term']) => ({ ODD: 'Gasal', EVEN: 'Genap', SHORT: 'Pendek' })[term]
const programLabel = computed(() => {
  const id = studentState.value?.programStudyId
  if (!id) return ''
  return programs.value.find(item => item.id === id)?.name || id
})
const deadlineLabel = computed(() => periodPolicy.value
  ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(periodPolicy.value.krsClosesAt))
  : 'Belum ditetapkan')
const daysToDeadline = computed(() => periodPolicy.value
  ? Math.max(0, Math.ceil((Date.parse(periodPolicy.value.krsClosesAt) - Date.now()) / 86_400_000))
  : 0)
const statusMeta = computed(() => {
  if (recordStatus.value === 'APPROVED') return { tone: 'success', label: 'KRS disetujui' }
  if (recordStatus.value === 'SUBMITTED') return { tone: 'pending', label: 'Menunggu dosen wali' }
  if (recordStatus.value === 'REJECTED') return { tone: 'review', label: 'Perlu revisi' }
  return { tone: 'draft', label: 'Draf KRS' }
})
const studentIdentity = computed(() => studentState.value || (config.public.demoMode ? {
  id: 'student-demo', studentUid: 'student-demo', studentNumber: '23011010', studentName: 'Mahasiswa Demo',
  programStudyId: 'management-s1', advisorId: 'advisor-demo', active: true, maximumCredits: 24,
  completedCourseCodes: [], holds: [], version: 1, updatedAt: '2026-07-20T00:00:00.000Z',
} satisfies KrsStudentAcademicState : null))

const toggleCourse = (classId: string) => {
  const course = courseCatalog.value.find(item => item.id === classId)
  if (!course || !isEditable.value) return
  if (selectedClassIdList.value.includes(classId)) {
    selectedClassIdList.value = selectedClassIdList.value.filter(id => id !== classId)
    return
  }
  if (['Kelas penuh', 'Prasyarat belum terpenuhi'].includes(course.status)) return
  const withoutSameCourse = selectedClassIdList.value.filter(id => {
    const existing = courseCatalog.value.find(item => item.id === id)
    return existing?.code !== course.code
  })
  const baseCredits = courseCatalog.value
    .filter(item => withoutSameCourse.includes(item.id))
    .reduce((sum, item) => sum + item.credits, 0)
  if (baseCredits + course.credits > maximumCredits.value) {
    errorMessage.value = `Total SKS tidak dapat melebihi batas maksimum ${maximumCredits.value} SKS.`
    return
  }
  errorMessage.value = ''
  selectedClassIdList.value = [...withoutSameCourse, classId]
}

const openConfirmation = () => {
  acceptedDeclaration.value = false
  showConfirmation.value = true
}

const printDraft = () => {
  if (import.meta.client) window.print()
}

const requestKey = (prefix: string) => `${prefix}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
const apiError = (error: unknown) => {
  const value = error as { response?: { data?: { statusMessage?: string; message?: string } }; message?: string }
  return value.response?.data?.statusMessage || value.response?.data?.message || value.message || 'Permintaan KRS tidak dapat diproses.'
}
const apiStatus = (error: unknown) => Number((error as { response?: { status?: number } }).response?.status || 0)

const persistDraft = async () => {
  const { data } = await $api.put<KrsWriteResult>('/krs/draft', {
    periodId: selectedPeriodId.value,
    classIds: selectedClassIdList.value,
    expectedVersion: currentVersion.value,
  }, { headers: { 'Idempotency-Key': requestKey('krs-draft') } })
  currentPlanId.value = data.record.id
  currentVersion.value = data.record.version
  recordStatus.value = data.record.status
  return data.record
}

const saveDraft = async () => {
  if (config.public.demoMode) {
    noticeMessage.value = 'Draf KRS berhasil disimpan.'
    return
  }
  mutating.value = true
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    await persistDraft()
    noticeMessage.value = 'Draf KRS berhasil disimpan.'
  } catch (error) {
    errorMessage.value = apiError(error)
  } finally {
    mutating.value = false
  }
}

const submitKrs = async () => {
  if (!acceptedDeclaration.value) return
  if (config.public.demoMode) {
    recordStatus.value = 'SUBMITTED'
    showConfirmation.value = false
    return
  }
  mutating.value = true
  errorMessage.value = ''
  try {
    const draft = await persistDraft()
    const { data } = await $api.post<KrsWriteResult>(`/krs/${draft.id}/submit`, {
      expectedVersion: draft.version,
    }, { headers: { 'Idempotency-Key': requestKey('krs-submit') } })
    currentVersion.value = data.record.version
    recordStatus.value = data.record.status
    showConfirmation.value = false
    noticeMessage.value = 'KRS berhasil diajukan ke dosen wali. Kursi kelas Anda sudah dipesan.'
  } catch (error) {
    errorMessage.value = apiError(error)
  } finally {
    mutating.value = false
  }
}

const parseMeeting = (entry: KrsCatalogEntry) => {
  const meeting = entry.classRecord.schedule[0]
  if (!meeting) return { label: 'Jadwal belum tersedia', dayName: '', startMinutes: null, endMinutes: null }
  const start = new Date(meeting.scheduledStartAt)
  const end = new Date(meeting.scheduledEndAt)
  const dayRaw = new Intl.DateTimeFormat('id-ID', { weekday: 'long', timeZone: 'Asia/Jakarta' }).format(start)
  const dayName = dayRaw.charAt(0).toUpperCase() + dayRaw.slice(1)
  const toMinutes = (date: Date) => {
    const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' }).formatToParts(date)
    return Number(parts.find(p => p.type === 'hour')?.value || 0) * 60 + Number(parts.find(p => p.type === 'minute')?.value || 0)
  }
  const clock = (date: Date) => new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' }).format(date)
  return { label: `${dayName}, ${clock(start)}–${clock(end)}`, dayName, startMinutes: toMinutes(start), endMinutes: toMinutes(end) }
}

async function loadPeriod(periodId: string) {
  loading.value = true
  errorMessage.value = ''
  setupMessage.value = ''
  try {
    const [catalogResponse, planResponse] = await Promise.all([
      $api.get<{ period: KrsPeriodPolicy; student: KrsStudentAcademicState; classes: KrsCatalogEntry[] }>('/krs/catalog', { params: { periodId } }),
      $api.get<{ record: KrsRecord | null }>('/krs/me', { params: { periodId } }),
    ])
    studentState.value = catalogResponse.data.student
    periodPolicy.value = catalogResponse.data.period
    courseCatalog.value = catalogResponse.data.classes.map(entry => {
      const schedule = parseMeeting(entry)
      return {
        id: entry.classRecord.id,
        code: entry.classRecord.courseCode,
        name: entry.classRecord.courseName,
        class: `Kelas ${entry.classRecord.section}`,
        schedule: schedule.label,
        dayName: schedule.dayName,
        startMinutes: schedule.startMinutes,
        endMinutes: schedule.endMinutes,
        lecturer: entry.classRecord.lecturerNames.join(', ') || 'Belum ditetapkan',
        credits: entry.classRecord.credits,
        capacity: `${(entry.classRecord.capacity || 0) - entry.availableSeats}/${entry.classRecord.capacity || 0}`,
        status: entry.availableSeats > 0 && entry.eligibleByPrerequisite ? 'Tersedia' : entry.availableSeats === 0 ? 'Kelas penuh' : 'Prasyarat belum terpenuhi',
      }
    })
    const record = planResponse.data.record
    if (record) {
      currentPlanId.value = record.id
      currentVersion.value = record.version
      recordStatus.value = record.status
      reviewNotes.value = record.reviewNotes || ''
      if (record.classIds?.length) {
        selectedClassIdList.value = [...record.classIds]
      } else {
        selectedClassIdList.value = courseCatalog.value
          .filter(item => record.courseCodes.includes(item.code))
          .map(item => item.id)
      }
    } else {
      currentPlanId.value = ''
      currentVersion.value = 0
      recordStatus.value = 'DRAFT'
      reviewNotes.value = ''
      selectedClassIdList.value = []
    }
  } catch (error) {
    studentState.value = null
    periodPolicy.value = null
    courseCatalog.value = []
    if ([403, 404, 409].includes(apiStatus(error))) {
      setupMessage.value = 'Profil akademik mahasiswa dan jadwal KRS untuk periode aktif belum lengkap. Hubungi bagian akademik untuk aktivasi.'
    } else errorMessage.value = apiError(error)
  } finally {
    loading.value = false
  }
}

const activeRole = computed(() => user.value?.activeRole || user.value?.roles[0] || '')

const initializeKrs = async () => {
  loading.value = true
  setupMessage.value = ''
  errorMessage.value = ''
  if (config.public.demoMode) {
    loading.value = false
    return
  }
  if (activeRole.value !== 'student') {
    setupMessage.value = 'Halaman ini khusus pengisian KRS mahasiswa. Untuk menyetujui KRS atau mengelola kelas, gunakan menu Administrasi Akademik atau Kelas & Peserta.'
    loading.value = false
    return
  }
  try {
    const { data } = await $api.get<AcademicAdministrationWorkspace>('/academic/administration')
    if (!data.profile) throw new Error('Profil akademik mahasiswa belum tersedia.')
    periods.value = data.periods.filter(item => item.active && !item.deletedAt)
    programs.value = data.programs.filter(item => !item.deletedAt)
    const periodId = data.profile.currentPeriodId || periods.value[0]?.id
    if (!periodId) throw new Error('Periode akademik aktif belum tersedia.')
    selectedPeriodId.value = periodId
    await loadPeriod(periodId)
  } catch (error) {
    const localSetupError = error instanceof Error && !(error as { response?: unknown }).response
    if ([403, 404, 409].includes(apiStatus(error)) || localSetupError) {
      setupMessage.value = 'Profil akademik mahasiswa dan periode aktif belum lengkap. Hubungi bagian akademik untuk aktivasi KRS.'
    } else errorMessage.value = apiError(error)
  } finally {
    loading.value = false
  }
}

watch(activeRole, () => { initializeKrs() })
onMounted(initializeKrs)
</script>

<template>
  <div class="page-stack krs-page">
    <AppPageHeader
      eyebrow="Akademik mahasiswa"
      title="Kartu Rencana Studi"
      description="Pilih kelas perkuliahan semester ini, periksa jadwal mingguan, lalu ajukan kepada dosen wali."
      :status="statusMeta.tone"
      :status-label="statusMeta.label"
    >
      <template #actions>
        <button class="btn btn-outline-secondary" type="button" :disabled="!krsReady" @click="printDraft"><i class="uil uil-print me-1" aria-hidden="true" />Cetak</button>
        <NuxtLink v-if="recordStatus === 'APPROVED'" class="btn btn-primary" to="/pembelajaran"><i class="uil uil-book-open me-1" />Buka ruang belajar</NuxtLink>
        <button v-else class="btn btn-primary" type="button" :disabled="!canSubmit" @click="openConfirmation">
          <i class="uil uil-message me-1" aria-hidden="true" />Ajukan KRS
        </button>
      </template>
    </AppPageHeader>

    <div v-if="errorMessage" class="alert alert-danger" role="alert">{{ errorMessage }}</div>
    <div v-if="noticeMessage" class="alert alert-success" role="status">{{ noticeMessage }}</div>
    <div v-if="loading" class="alert alert-info" role="status">Memuat daftar kelas dan rencana studi...</div>

    <div v-else-if="setupMessage" class="setup-box">
      <EmptyState icon="uil-clipboard-notes" title="Ruang pengisian KRS mahasiswa" :description="setupMessage" />
      <div class="setup-actions">
        <NuxtLink v-if="can('academic.read')" class="btn btn-primary" to="/akademik/administrasi"><i class="uil uil-check-square me-1" />Buka Persetujuan KRS</NuxtLink>
        <NuxtLink v-if="can('classes:manage')" class="btn btn-outline-primary" to="/admin/kelas"><i class="uil uil-presentation-check me-1" />Kelola Kelas &amp; Peserta</NuxtLink>
      </div>
    </div>

    <template v-if="!loading && krsReady">
      <section class="krs-overview">
        <div class="krs-overview__top">
          <div class="student-badge">
            <span class="student-badge__icon"><i class="uil uil-user-square" aria-hidden="true" /></span>
            <div>
              <strong>{{ studentIdentity?.studentName }} · {{ studentIdentity?.studentNumber }}</strong>
              <small>{{ programLabel || studentIdentity?.programStudyId }} · Batas pengajuan {{ deadlineLabel }} ({{ daysToDeadline }} hari lagi)</small>
            </div>
          </div>
          <div class="krs-filters">
            <label><span>Semester</span>
              <select v-model="selectedPeriodId" class="form-select form-select-sm" :disabled="config.public.demoMode || periods.length < 2" @change="loadPeriod(selectedPeriodId)">
                <option v-if="config.public.demoMode" value="2026-2027-1">2026/2027 Gasal</option>
                <option v-for="period in periods" :key="period.id" :value="period.id">{{ period.academicYear }} {{ termLabel(period.term) }}</option>
              </select>
            </label>
          </div>
        </div>

        <div class="krs-overview__bar">
          <div class="credit-meter">
            <div class="credit-meter__number"><strong>{{ selectedCredits }}</strong><span>/ {{ maximumCredits }} SKS</span></div>
            <div class="credit-meter__track" role="progressbar" aria-label="SKS terpilih" :aria-valuenow="selectedCredits" aria-valuemin="0" :aria-valuemax="maximumCredits">
              <span :style="{ width: `${maximumCredits ? Math.min(100, (selectedCredits / maximumCredits) * 100) : 0}%` }" />
            </div>
            <small>{{ selectedCount }} mata kuliah · sisa {{ remainingCredits }} SKS</small>
          </div>
          <div class="status-pills">
            <span class="info-pill" :class="{ warn: activeHolds.length > 0 }">
              <i class="uil" :class="activeHolds.length ? 'uil-exclamation-triangle' : 'uil-check-circle'" />
              {{ activeHolds.length ? `${activeHolds.length} pencekalan aktif` : 'Bebas pencekalan' }}
            </span>
            <span v-if="scheduleConflicts.size > 0" class="info-pill warn">
              <i class="uil uil-clock-nine" /> Ada bentrok jadwal
            </span>
          </div>
        </div>

        <div v-if="recordStatus === 'APPROVED'" class="krs-banner krs-banner--success" role="status">
          <i class="uil uil-check-circle" />
          <div><strong>KRS Anda sudah disetujui dosen wali.</strong><span>Seluruh kelas terpilih otomatis masuk ke menu Ruang Pembelajaran.</span><span v-if="reviewNotes">Catatan: {{ reviewNotes }}</span></div>
        </div>
        <div v-else-if="recordStatus === 'SUBMITTED'" class="krs-banner krs-banner--info" role="status">
          <i class="uil uil-hourglass" />
          <div><strong>KRS sedang menunggu persetujuan dosen wali.</strong><span>Anda akan menerima notifikasi setelah dosen wali memberikan keputusan.</span></div>
        </div>
        <div v-else-if="recordStatus === 'REJECTED'" class="krs-banner krs-banner--warn" role="status">
          <i class="uil uil-redo" />
          <div><strong>KRS dikembalikan untuk perbaikan.</strong><span>{{ reviewNotes || 'Silakan perbaiki pilihan kelas Anda lalu ajukan kembali.' }}</span></div>
        </div>
      </section>

      <section class="workflow-surface">
        <header class="workflow-surface__header">
          <div>
            <span class="section-kicker">Daftar kelas semester</span>
            <h2>{{ showScheduleView ? 'Jadwal mingguan terpilih' : 'Pilih mata kuliah & kelas' }}</h2>
          </div>
          <div class="catalog-tools">
            <select v-if="!showScheduleView" v-model="courseFilter" class="form-select form-select-sm" aria-label="Filter tampilan">
              <option value="ALL">Semua kelas ({{ courseCatalog.length }})</option>
              <option value="SELECTED">Terpilih ({{ selectedCount }})</option>
              <option value="AVAILABLE">Belum dipilih</option>
            </select>
            <button class="btn btn-sm" :class="showScheduleView ? 'btn-primary' : 'btn-outline-secondary'" type="button" @click="showScheduleView = !showScheduleView">
              <i class="uil me-1" :class="showScheduleView ? 'uil-list-ul' : 'uil-calendar-alt'" aria-hidden="true" />
              {{ showScheduleView ? 'Kembali ke daftar kelas' : 'Lihat jadwal mingguan' }}
            </button>
          </div>
        </header>

        <div v-if="showScheduleView" class="schedule-grid">
          <EmptyState v-if="!weeklySchedule.length" icon="uil-calendar-slash" title="Belum ada kelas terpilih" description="Pilih minimal satu mata kuliah untuk melihat susunan jadwal mingguan Anda." />
          <article v-for="group in weeklySchedule" :key="group.day" class="schedule-day">
            <h3>{{ group.day }}</h3>
            <ul>
              <li v-for="item in group.items" :key="item.id" :class="{ conflict: scheduleConflicts.has(item.id) }">
                <strong>{{ item.code }} · {{ item.name }}</strong>
                <small>{{ item.class }} · {{ item.schedule }} · {{ item.credits }} SKS</small>
                <small>{{ item.lecturer }}</small>
                <span v-if="scheduleConflicts.has(item.id)" class="conflict-tag">Bentrok waktu</span>
              </li>
            </ul>
          </article>
        </div>

        <DataTable
          v-else
          :columns="courseColumns"
          :rows="courseRows"
          :page-size="10"
          search-placeholder="Cari kode, mata kuliah, atau dosen…"
          empty-title="Kelas tidak ditemukan"
          empty-description="Ubah filter atau kata kunci pencarian."
        >
          <template #cell-selection="{ row }">
            <input
              class="form-check-input course-checkbox"
              type="checkbox"
              :checked="selectedClassIdList.includes(String(row.id))"
              :disabled="(['Kelas penuh', 'Prasyarat belum terpenuhi'].includes(String(row.status)) && !selectedClassIdList.includes(String(row.id))) || !isEditable"
              :aria-label="`Pilih ${String(row.name)}`"
              @change="toggleCourse(String(row.id))"
            >
          </template>
          <template #cell-name="{ row, value }">
            <div class="course-name">
              <strong>{{ value }}</strong>
              <small>{{ row.code }} · {{ row.class }}</small>
            </div>
          </template>
          <template #cell-status="{ value }">
            <StatusBadge :status="String(value) === 'Terpilih' ? 'active' : String(value) === 'Tersedia' ? 'verified' : 'blocked'" :label="String(value)" />
          </template>
        </DataTable>

        <div v-if="isEditable" class="action-dock">
          <div class="action-dock__summary">
            <strong>{{ selectedCount }} mata kuliah · {{ selectedCredits }} / {{ maximumCredits }} SKS</strong>
            <small>{{ currentVersion ? 'Draf tersimpan di sistem' : 'Belum disimpan sebagai draf' }}</small>
          </div>
          <div class="action-dock__buttons">
            <button class="btn btn-outline-secondary" type="button" :disabled="mutating || !krsReady" @click="saveDraft">Simpan draf</button>
            <button class="btn btn-primary" type="button" :disabled="mutating || !canSubmit" @click="openConfirmation">Ajukan ke dosen wali</button>
          </div>
        </div>
      </section>

      <section v-if="showConfirmation" class="submission-overlay" role="dialog" aria-modal="true" aria-labelledby="submission-title" @click.self="showConfirmation = false">
        <div class="submission-dialog">
          <button class="submission-dialog__close" type="button" aria-label="Tutup konfirmasi" @click="showConfirmation = false"><i class="uil uil-times" aria-hidden="true" /></button>
          <span class="submission-dialog__icon"><i class="uil uil-message" aria-hidden="true" /></span>
          <span class="section-kicker">Konfirmasi pengajuan</span>
          <h2 id="submission-title">Ajukan {{ selectedCredits }} SKS kepada dosen wali?</h2>
          <p>Setelah diajukan, pilihan kelas tidak dapat diubah sampai dosen wali menyetujui atau mengembalikannya untuk revisi.</p>
          <div v-if="scheduleConflicts.size > 0" class="alert alert-warning py-2 small my-2">Perhatian: terdeteksi jadwal kelas yang bertumpuk pada pilihan Anda.</div>
          <dl class="detail-list my-3">
            <div><dt>Mahasiswa</dt><dd>{{ studentIdentity?.studentName }}</dd></div>
            <div><dt>Jumlah kelas</dt><dd>{{ selectedCount }} mata kuliah</dd></div>
            <div><dt>Total beban</dt><dd>{{ selectedCredits }} SKS</dd></div>
          </dl>
          <label class="declaration-check"><input v-model="acceptedDeclaration" class="form-check-input" type="checkbox"><span>Saya telah memeriksa pilihan kelas dan jadwal perkuliahan saya.</span></label>
          <div class="confirm-actions mt-4">
            <button class="btn btn-outline-secondary" type="button" :disabled="mutating" @click="showConfirmation = false">Kembali periksa</button>
            <button class="btn btn-primary" type="button" :disabled="!acceptedDeclaration || mutating" @click="submitKrs">{{ mutating ? 'Memproses...' : 'Ya, ajukan KRS' }}</button>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.setup-box{display:grid;gap:1rem;padding:1.25rem;border:1px solid #e6dfd6;border-radius:1rem;background:#fff}
.setup-actions{display:flex;justify-content:center;gap:.65rem;flex-wrap:wrap}
.krs-overview{display:grid;gap:.9rem;padding:1.1rem 1.2rem;border:1px solid #e6dfd6;border-radius:1rem;background:#fff;box-shadow:0 6px 20px rgba(30,30,30,.04)}
.krs-overview__top{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.85rem}
.student-badge{display:flex;align-items:center;gap:.75rem}
.student-badge__icon{display:grid;place-items:center;width:2.5rem;height:2.5rem;border-radius:.75rem;color:#593660;background:#f5eff7;font-size:1.2rem}
.student-badge strong,.student-badge small{display:block}
.student-badge strong{color:#1e1e1e;font-size:.86rem}
.student-badge small{color:#6c6865;font-size:.7rem;margin-top:.15rem}
.krs-filters label{display:grid;gap:.2rem;color:#6c6865;font-size:.66rem;font-weight:700}
.krs-overview__bar{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;padding-top:.85rem;border-top:1px solid #ece6dd}
.credit-meter{display:grid;grid-template-columns:auto minmax(140px,260px) auto;gap:.85rem;align-items:center;flex:1}
.credit-meter__number{display:flex;align-items:baseline;gap:.25rem;white-space:nowrap}
.credit-meter__number strong{color:#593660;font-size:1.5rem;letter-spacing:-.03em}
.credit-meter__number span,.credit-meter>small{color:#6c6865;font-size:.72rem}
.credit-meter__track{height:.5rem;overflow:hidden;border-radius:999px;background:#ece4d8}
.credit-meter__track span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#593660,#775a83)}
.status-pills{display:flex;gap:.5rem;flex-wrap:wrap}
.info-pill{display:inline-flex;align-items:center;gap:.35rem;padding:.32rem .65rem;border-radius:999px;background:#f5eff7;color:#593660;font-size:.68rem;font-weight:700}
.info-pill.warn{background:#fff3e0;color:#9a5b13}
.krs-banner{display:flex;gap:.65rem;align-items:flex-start;padding:.8rem .95rem;border-radius:.75rem;font-size:.76rem}
.krs-banner i{font-size:1.1rem;margin-top:.1rem}
.krs-banner strong,.krs-banner span{display:block}
.krs-banner span{margin-top:.15rem;font-size:.72rem;opacity:.92}
.krs-banner--success{background:#eef6f0;color:#27533b;border:1px solid #cde2d3}
.krs-banner--info{background:#f5eff7;color:#3e2344;border:1px solid #dfd3e4}
.krs-banner--warn{background:#fff5e6;color:#7a4a0c;border:1px solid #f0d7b4}
.catalog-tools{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
.catalog-tools select{min-width:165px}
.schedule-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:.85rem;padding:1rem}
.schedule-day{padding:.9rem;border:1px solid #e6dfd6;border-radius:.85rem;background:#faf6ef}
.schedule-day h3{margin:0 0 .65rem;color:#593660;font-size:.84rem;font-weight:800}
.schedule-day ul{display:grid;gap:.5rem;margin:0;padding:0;list-style:none}
.schedule-day li{padding:.65rem .75rem;border:1px solid #e6dfd6;border-radius:.65rem;background:#fff}
.schedule-day li.conflict{border-color:#dc3545;background:#fff5f5}
.schedule-day strong,.schedule-day small{display:block}
.schedule-day strong{color:#1e1e1e;font-size:.76rem}
.schedule-day small{color:#6c6865;font-size:.66rem;margin-top:.15rem}
.conflict-tag{display:inline-block;margin-top:.3rem;padding:.12rem .45rem;border-radius:999px;background:#dc3545;color:#fff;font-size:.6rem;font-weight:700}
.course-checkbox{width:1.05rem;height:1.05rem;border-color:#b8a7be}
.course-name strong,.course-name small{display:block}
.course-name strong{color:#1e1e1e;font-size:.78rem}
.course-name small{margin-top:.12rem;color:#6c6865;font-size:.66rem}
.submission-overlay{position:fixed;z-index:1080;inset:0;display:grid;place-items:center;padding:1rem;background:rgba(30,20,34,.58);backdrop-filter:blur(4px)}
.submission-dialog{position:relative;width:min(100%,480px);padding:1.5rem;border-radius:1rem;background:#fff;box-shadow:0 28px 80px rgba(30,20,34,.28)}
.submission-dialog__close{position:absolute;right:.8rem;top:.8rem;display:grid;place-items:center;width:2rem;height:2rem;border:0;border-radius:.55rem;color:#4e5462;background:#f5eff7}
.submission-dialog__icon{display:grid;place-items:center;width:3rem;height:3rem;margin-bottom:1rem;border-radius:.85rem;color:#593660;background:#f5eff7;font-size:1.25rem}
.submission-dialog h2{margin:0;color:#1e1e1e;font-size:1.18rem}
.submission-dialog>p{margin:.5rem 0 0;color:#4e5462;font-size:.76rem;line-height:1.6}
.declaration-check{display:flex;align-items:flex-start;gap:.6rem;padding:.75rem;border-radius:.7rem;color:#4e5462;background:#faf6ef;font-size:.72rem;line-height:1.45}
.confirm-actions{display:grid;grid-template-columns:1fr 1fr;gap:.65rem}
@media(max-width:767.98px){.credit-meter{grid-template-columns:auto 1fr}.credit-meter>small{grid-column:1/-1}}
</style>
