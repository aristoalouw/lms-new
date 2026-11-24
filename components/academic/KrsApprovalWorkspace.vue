<script setup lang="ts">
import type { KrsStatus } from '~/server/types/domain'
import type { KrsReviewItem, KrsReviewListResult, ReviewKrsResult } from '~/server/services/krs'

const { $api } = useNuxtApp()
const { user, can } = useAuth()

const loading = ref(true)
const mutatingId = ref('')
const errorMessage = ref('')
const noticeMessage = ref('')
const selectedPeriodId = ref<string>('AUTO')
const selectedStatus = ref<'ALL' | KrsStatus>('SUBMITTED')
const searchQuery = ref('')

const reviewData = ref<KrsReviewListResult>({
  items: [],
  summary: { total: 0, submitted: 0, approved: 0, rejected: 0, draft: 0 },
  periods: [],
  programs: [],
})

const noteDrafts = reactive<Record<string, string>>({})

const activeRole = computed(() => user.value?.activeRole || user.value?.roles[0] || '')
const roleScopeLabel = computed(() => activeRole.value === 'advisor'
  ? 'Menampilkan pengajuan KRS mahasiswa bimbingan perwalian Anda.'
  : 'Menampilkan pengajuan KRS mahasiswa dalam lingkup program studi Anda.')

const filteredItems = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return reviewData.value.items
  return reviewData.value.items.filter(item => {
    const courseText = (item.classSelections?.map(c => `${c.courseCode} ${c.courseName}`).join(' ') || item.courseCodes.join(' ')).toLowerCase()
    return item.studentName.toLowerCase().includes(q)
      || item.studentNumber.toLowerCase().includes(q)
      || (item.programStudyName || '').toLowerCase().includes(q)
      || (item.advisorName || '').toLowerCase().includes(q)
      || courseText.includes(q)
  })
})

const requestKey = (prefix: string) => `${prefix}:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`

const apiError = (error: unknown) => {
  const value = error as { response?: { data?: { statusMessage?: string; message?: string } }; message?: string }
  return value.response?.data?.statusMessage || value.response?.data?.message || value.message || 'Permintaan evaluasi KRS tidak dapat diproses.'
}

const formatDateTime = (value?: string) => {
  if (!value) return '—'
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return value
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(parsed))
}

const statusMeta = (status: KrsStatus) => {
  if (status === 'APPROVED') return { tone: 'active', label: 'Disetujui' }
  if (status === 'SUBMITTED') return { tone: 'pending', label: 'Menunggu evaluasi' }
  if (status === 'REJECTED') return { tone: 'blocked', label: 'Perlu revisi' }
  return { tone: 'draft', label: 'Draf mahasiswa' }
}

const semesterParityText = (semester?: number) => {
  if (!semester) return ''
  return semester % 2 === 1 ? 'Ganjil' : 'Genap'
}

const loadSubmissions = async () => {
  loading.value = true
  errorMessage.value = ''
  try {
    const params: Record<string, string> = { status: selectedStatus.value }
    if (selectedPeriodId.value && selectedPeriodId.value !== 'AUTO' && selectedPeriodId.value !== 'ALL') {
      params.periodId = selectedPeriodId.value
    }
    const { data } = await $api.get<KrsReviewListResult>('/krs', { params })
    if (selectedPeriodId.value === 'AUTO') {
      const activePeriod = data.periods.find(period => period.active)
      if (activePeriod) {
        selectedPeriodId.value = activePeriod.id
        const activeResponse = await $api.get<KrsReviewListResult>('/krs', {
          params: { status: selectedStatus.value, periodId: activePeriod.id },
        })
        reviewData.value = activeResponse.data
      } else {
        selectedPeriodId.value = 'ALL'
        reviewData.value = data
      }
    } else {
      reviewData.value = data
    }
  } catch (error) {
    errorMessage.value = apiError(error)
  } finally {
    loading.value = false
  }
}

const selectStatusFilter = async (status: 'ALL' | KrsStatus) => {
  selectedStatus.value = status
  await loadSubmissions()
}

const submitDecision = async (item: KrsReviewItem, decision: 'APPROVE' | 'REJECT') => {
  const notes = (noteDrafts[item.id] || '').trim()
  if (decision === 'REJECT' && !notes) {
    errorMessage.value = `Catatan alasan revisi wajib diisi sebelum menolak KRS ${item.studentName}.`
    return
  }
  mutatingId.value = item.id
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const { data } = await $api.post<ReviewKrsResult>(`/krs/${encodeURIComponent(item.id)}/approval`, {
      decision,
      ...(notes ? { notes } : {}),
      expectedVersion: item.version,
    }, {
      headers: { 'Idempotency-Key': requestKey(`krs-${decision.toLowerCase()}`) },
    })
    noteDrafts[item.id] = ''
    noticeMessage.value = decision === 'APPROVE'
      ? `KRS ${data.record.studentName} (${data.record.totalCredits} SKS) disetujui. Mahasiswa otomatis terdaftar ke kelas dan ruang pembelajaran.`
      : `KRS ${data.record.studentName} dikembalikan untuk revisi. Reservasi kursi kelas telah dilepas.`
    await loadSubmissions()
  } catch (error) {
    errorMessage.value = apiError(error)
  } finally {
    mutatingId.value = ''
  }
}

watch(activeRole, () => {
  selectedPeriodId.value = 'AUTO'
  loadSubmissions()
})

onMounted(loadSubmissions)
</script>

<template>
  <div class="page-stack krs-review-page">
    <AppPageHeader
      eyebrow="Perwalian & persetujuan KRS"
      title="Evaluasi Pengajuan KRS"
      description="Tinjau pilihan mata kuliah, beban SKS, dan kesesuaian semester mahasiswa, lalu setujui atau kembalikan untuk revisi."
    >
      <template #actions>
        <button class="btn btn-outline-secondary" type="button" :disabled="loading" @click="loadSubmissions">
          <i class="uil uil-sync me-1" aria-hidden="true" />Muat ulang
        </button>
        <NuxtLink class="btn btn-outline-secondary" to="/akademik/administrasi">
          <i class="uil uil-book-open me-1" aria-hidden="true" />Administrasi akademik
        </NuxtLink>
        <NuxtLink v-if="can('classes:manage')" class="btn btn-primary" to="/admin/kelas">
          <i class="uil uil-presentation-check me-1" aria-hidden="true" />Kelas &amp; enrolment
        </NuxtLink>
      </template>
    </AppPageHeader>

    <div v-if="errorMessage" class="alert alert-danger" role="alert">{{ errorMessage }}</div>
    <div v-if="noticeMessage" class="alert alert-success" role="status">{{ noticeMessage }}</div>

    <section class="summary-grid" aria-label="Ringkasan pengajuan KRS">
      <button type="button" class="summary-card" :class="{ active: selectedStatus === 'SUBMITTED' }" @click="selectStatusFilter('SUBMITTED')">
        <span class="summary-card__label">Menunggu evaluasi</span>
        <strong class="summary-card__value summary-card__value--pending">{{ reviewData.summary.submitted }}</strong>
        <small>Perlu keputusan dosen wali / staf akademik</small>
      </button>
      <button type="button" class="summary-card" :class="{ active: selectedStatus === 'APPROVED' }" @click="selectStatusFilter('APPROVED')">
        <span class="summary-card__label">Disetujui</span>
        <strong class="summary-card__value summary-card__value--approved">{{ reviewData.summary.approved }}</strong>
        <small>Sudah masuk peserta kelas &amp; pembelajaran</small>
      </button>
      <button type="button" class="summary-card" :class="{ active: selectedStatus === 'REJECTED' }" @click="selectStatusFilter('REJECTED')">
        <span class="summary-card__label">Perlu revisi</span>
        <strong class="summary-card__value summary-card__value--rejected">{{ reviewData.summary.rejected }}</strong>
        <small>Dikembalikan ke mahasiswa untuk diperbaiki</small>
      </button>
      <button type="button" class="summary-card" :class="{ active: selectedStatus === 'ALL' }" @click="selectStatusFilter('ALL')">
        <span class="summary-card__label">Total catatan KRS</span>
        <strong class="summary-card__value">{{ reviewData.summary.total }}</strong>
        <small>{{ reviewData.summary.draft }} masih berstatus draf mahasiswa</small>
      </button>
    </section>

    <section class="workflow-surface">
      <header class="workflow-surface__header review-toolbar">
        <div>
          <span class="section-kicker">Daftar pengajuan mahasiswa</span>
          <h2>{{ selectedStatus === 'SUBMITTED' ? 'Pengajuan menunggu persetujuan' : selectedStatus === 'APPROVED' ? 'KRS disetujui' : selectedStatus === 'REJECTED' ? 'KRS perlu revisi' : selectedStatus === 'DRAFT' ? 'Draf KRS mahasiswa' : 'Semua catatan KRS' }}</h2>
          <p class="toolbar-hint">{{ roleScopeLabel }}</p>
        </div>
        <div class="toolbar-controls">
          <label class="filter-field">
            <span>Periode</span>
            <select v-model="selectedPeriodId" class="form-select form-select-sm" @change="loadSubmissions">
              <option value="ALL">Semua periode</option>
              <option v-for="period in reviewData.periods" :key="period.id" :value="period.id">
                {{ period.label }}{{ period.active ? ' (Aktif)' : ' (Arsip)' }}
              </option>
            </select>
          </label>
          <label class="filter-field">
            <span>Status</span>
            <select v-model="selectedStatus" class="form-select form-select-sm" @change="loadSubmissions">
              <option value="SUBMITTED">Menunggu evaluasi ({{ reviewData.summary.submitted }})</option>
              <option value="APPROVED">Disetujui ({{ reviewData.summary.approved }})</option>
              <option value="REJECTED">Perlu revisi ({{ reviewData.summary.rejected }})</option>
              <option value="DRAFT">Draf mahasiswa ({{ reviewData.summary.draft }})</option>
              <option value="ALL">Semua status ({{ reviewData.summary.total }})</option>
            </select>
          </label>
          <label class="filter-field filter-field--search">
            <span>Cari mahasiswa / mata kuliah</span>
            <input v-model="searchQuery" class="form-control form-control-sm" type="search" placeholder="Nama, NIM, kode MK…">
          </label>
        </div>
      </header>

      <div v-if="loading" class="p-4 text-center text-muted small" role="status">Memuat daftar pengajuan KRS…</div>

      <div v-else-if="!filteredItems.length" class="p-4">
        <EmptyState
          icon="uil-file-check-alt"
          title="Belum ada pengajuan KRS pada filter ini"
          :description="selectedStatus === 'SUBMITTED'
            ? 'Semua pengajuan KRS mahasiswa pada periode ini sudah ditinjau, atau mahasiswa belum menekan tombol Ajukan KRS.'
            : 'Ubah filter periode, status, atau kata kunci pencarian untuk melihat catatan KRS lainnya.'"
        />
      </div>

      <div v-else class="krs-list">
        <article v-for="item in filteredItems" :key="item.id" class="krs-card" :class="{ 'krs-card--pending': item.status === 'SUBMITTED' }">
          <div class="krs-card__head">
            <div class="student-meta">
              <span class="student-avatar" aria-hidden="true"><i class="uil uil-user-square" /></span>
              <div>
                <div class="student-meta__title">
                  <strong>{{ item.studentName }}</strong>
                  <span class="nim-pill">{{ item.studentNumber }}</span>
                  <StatusBadge :status="statusMeta(item.status).tone" :label="statusMeta(item.status).label" />
                </div>
                <small>
                  {{ item.programStudyName || item.programStudyId }}
                  <template v-if="item.studentSemester"> · Semester {{ item.studentSemester }} ({{ semesterParityText(item.studentSemester) }})</template>
                  <template v-if="item.cohortYear"> · Angkatan {{ item.cohortYear }}</template>
                  <template v-if="item.advisorName"> · Dosen wali: {{ item.advisorName }}</template>
                </small>
              </div>
            </div>
            <div class="krs-card__metrics">
              <span class="meta-chip">
                <i class="uil uil-calendar-alt" aria-hidden="true" />
                {{ item.periodLabel || item.periodId }}
              </span>
              <span class="meta-chip meta-chip--plum">
                <strong>{{ item.totalCredits }}</strong> / {{ item.maximumCredits || 24 }} SKS · {{ (item.classSelections?.length || item.courseCodes.length) }} MK
              </span>
              <small v-if="item.submittedAt">Diajukan {{ formatDateTime(item.submittedAt) }} WIB</small>
              <small v-else>Belum diajukan</small>
            </div>
          </div>

          <div class="krs-courses">
            <table class="course-mini-table">
              <thead>
                <tr>
                  <th>Kode</th>
                  <th>Mata kuliah</th>
                  <th>Kelas</th>
                  <th class="text-end">SKS</th>
                </tr>
              </thead>
              <tbody>
                <template v-if="item.classSelections?.length">
                  <tr v-for="sel in item.classSelections" :key="sel.classId">
                    <td><code>{{ sel.courseCode }}</code></td>
                    <td>{{ sel.courseName }}</td>
                    <td>Kelas {{ sel.section }}</td>
                    <td class="text-end"><strong>{{ sel.credits }}</strong></td>
                  </tr>
                </template>
                <template v-else>
                  <tr v-for="code in item.courseCodes" :key="code">
                    <td><code>{{ code }}</code></td>
                    <td colspan="2">Mata kuliah terdaftar pada KRS</td>
                    <td class="text-end">—</td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>

          <div v-if="item.status !== 'SUBMITTED' && (item.reviewNotes || item.reviewedAt)" class="review-history">
            <i class="uil" :class="item.status === 'APPROVED' ? 'uil-check-circle' : 'uil-comment-alt-notes'" aria-hidden="true" />
            <div>
              <strong>
                {{ item.status === 'APPROVED' ? 'Disetujui' : 'Catatan revisi' }}
                <template v-if="item.reviewerName"> oleh {{ item.reviewerName }}</template>
                <template v-if="item.reviewedAt"> · {{ formatDateTime(item.reviewedAt) }} WIB</template>
              </strong>
              <p v-if="item.reviewNotes">{{ item.reviewNotes }}</p>
            </div>
          </div>

          <div v-if="item.canReview && item.status === 'SUBMITTED'" class="review-form">
            <label class="review-note-field">
              <span>Catatan evaluasi (opsional saat menyetujui, wajib saat meminta revisi)</span>
              <textarea
                v-model="noteDrafts[item.id]"
                class="form-control form-control-sm"
                rows="2"
                maxlength="1000"
                placeholder="Contoh: Beban studi sesuai semester berjalan, atau sebutkan mata kuliah yang perlu diganti."
              />
            </label>
            <div class="review-actions">
              <button
                class="btn btn-outline-danger btn-sm"
                type="button"
                :disabled="mutatingId === item.id"
                @click="submitDecision(item, 'REJECT')"
              >
                <i class="uil uil-redo me-1" aria-hidden="true" />
                {{ mutatingId === item.id ? 'Memproses…' : 'Kembalikan untuk revisi' }}
              </button>
              <button
                class="btn btn-primary btn-sm"
                type="button"
                :disabled="mutatingId === item.id"
                @click="submitDecision(item, 'APPROVE')"
              >
                <i class="uil uil-check-circle me-1" aria-hidden="true" />
                {{ mutatingId === item.id ? 'Memproses…' : 'Setujui KRS' }}
              </button>
            </div>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:.8rem}
.summary-card{display:grid;gap:.2rem;text-align:left;padding:.95rem 1.05rem;border:1px solid #e6dfd6;border-radius:.95rem;background:#fff;transition:border-color .16s ease,box-shadow .16s ease}
.summary-card:hover{border-color:#c6b4cc;box-shadow:0 6px 18px rgba(89,54,96,.08)}
.summary-card.active{border-color:#593660;background:#faf6fc;box-shadow:0 6px 18px rgba(89,54,96,.12)}
.summary-card__label{font-size:.7rem;font-weight:700;color:#6c6865;text-transform:uppercase;letter-spacing:.03em}
.summary-card__value{font-size:1.65rem;line-height:1.15;color:#1e1e1e;letter-spacing:-.02em}
.summary-card__value--pending{color:#8a4f13}
.summary-card__value--approved{color:#1b6b42}
.summary-card__value--rejected{color:#9b2c2c}
.summary-card small{font-size:.68rem;color:#6c6865}
.review-toolbar{align-items:flex-end}
.toolbar-hint{margin:.2rem 0 0;font-size:.74rem;color:#6c6865}
.toolbar-controls{display:flex;gap:.65rem;flex-wrap:wrap;align-items:flex-end}
.filter-field{display:grid;gap:.2rem;font-size:.66rem;font-weight:700;color:#6c6865}
.filter-field select,.filter-field input{min-width:170px}
.filter-field--search input{min-width:210px}
.krs-list{display:grid;gap:.9rem;padding:1rem}
.krs-card{display:grid;gap:.85rem;padding:1rem 1.1rem;border:1px solid #e6dfd6;border-radius:.9rem;background:#fff}
.krs-card--pending{border-left:4px solid #593660}
.krs-card__head{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:.85rem}
.student-meta{display:flex;gap:.7rem;align-items:flex-start}
.student-avatar{display:grid;place-items:center;width:2.35rem;height:2.35rem;border-radius:.7rem;background:#f5eff7;color:#593660;font-size:1.15rem;flex-shrink:0}
.student-meta__title{display:flex;align-items:center;flex-wrap:wrap;gap:.45rem}
.student-meta__title strong{font-size:.9rem;color:#1e1e1e}
.nim-pill{padding:.1rem .48rem;border-radius:999px;background:#f3efe9;color:#4a4643;font-size:.68rem;font-weight:700}
.student-meta small{display:block;margin-top:.2rem;color:#6c6865;font-size:.72rem}
.krs-card__metrics{display:grid;justify-items:end;gap:.28rem}
.krs-card__metrics small{color:#6c6865;font-size:.68rem}
.meta-chip{display:inline-flex;align-items:center;gap:.35rem;padding:.24rem .6rem;border-radius:999px;background:#f6f2ec;color:#4e4a47;font-size:.7rem;font-weight:600}
.meta-chip--plum{background:#f5eff7;color:#593660}
.krs-courses{overflow-x:auto;border:1px solid #ece6dd;border-radius:.7rem;background:#fcfaf7}
.course-mini-table{width:100%;border-collapse:collapse;font-size:.76rem}
.course-mini-table th,.course-mini-table td{padding:.5rem .75rem;border-bottom:1px solid #ece6dd}
.course-mini-table tbody tr:last-child td{border-bottom:0}
.course-mini-table th{color:#6c6865;font-size:.66rem;font-weight:700;text-transform:uppercase;letter-spacing:.03em;background:#f7f3ec}
.course-mini-table code{color:#593660;font-weight:700}
.review-history{display:flex;gap:.55rem;align-items:flex-start;padding:.65rem .8rem;border-radius:.7rem;background:#f7f4f9;color:#43274a;font-size:.74rem}
.review-history i{font-size:1rem;margin-top:.05rem}
.review-history p{margin:.2rem 0 0;color:#4e5462}
.review-form{display:grid;gap:.65rem;padding-top:.7rem;border-top:1px dashed #e3dbd1}
.review-note-field{display:grid;gap:.25rem;font-size:.7rem;font-weight:700;color:#4e5462}
.review-actions{display:flex;justify-content:flex-end;gap:.55rem;flex-wrap:wrap}
@media(max-width:767.98px){.krs-card__metrics{justify-items:start}}
</style>
