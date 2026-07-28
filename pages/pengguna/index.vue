<script setup lang="ts">
type AccountStatus = 'active' | 'disabled' | 'blocked'
type AccountRole =
  | 'applicant'
  | 'student'
  | 'lecturer'
  | 'advisor'
  | 'academic_staff'
  | 'finance_staff'
  | 'student_affairs_staff'
  | 'admissions_staff'
  | 'leader'
  | 'administrator'
  | 'guardian'

interface AccountRecord {
  id: string
  email: string
  displayName: string
  roles: AccountRole[]
  scope: {
    unitIds: string[]
    programStudyIds: string[]
    cohortYears: number[]
    studentIds: string[]
  }
  status: AccountStatus
  guardianStudentIds: string[]
  version: number
  updatedAt: string
}

interface AccountPage {
  items: AccountRecord[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

interface AccountForm {
  id?: string
  version?: number
  email: string
  displayName: string
  roles: AccountRole[]
  status: AccountStatus
  unitIds: string
  programStudyIds: string
  cohortYears: string
  studentIds: string
  guardianStudentIds: string
}

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Manajemen Pengguna' })

const { user } = useAuth()
const { isLmsMvp } = useFeatureFlags()
const {
  available: passwordResetAvailable,
  deliveryLabel: passwordResetDeliveryLabel,
  requestPasswordReset,
} = usePasswordReset()
const isAdministrator = computed(() => user.value?.roles.includes('administrator') ?? false)
const loading = ref(false)
const saving = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')
const showEditor = ref(false)
const editorMode = ref<'create' | 'edit'>('create')
const pageData = ref<AccountPage>({ items: [], page: 1, pageSize: 10, total: 0, totalPages: 1 })
const filters = reactive({ search: '', status: '', role: '', programStudyId: '' })

const emptyForm = (): AccountForm => ({
  email: '',
  displayName: '',
  roles: ['student'],
  status: 'active',
  unitIds: '',
  programStudyIds: '',
  cohortYears: '',
  studentIds: '',
  guardianStudentIds: '',
})
const form = reactive<AccountForm>(emptyForm())

const allRoleOptions: Array<{ value: AccountRole; label: string; group: string }> = [
  { value: 'student', label: 'Mahasiswa', group: 'Pengguna' },
  { value: 'applicant', label: 'Pendaftar', group: 'Pengguna' },
  { value: 'guardian', label: 'Orang tua / wali', group: 'Pengguna' },
  { value: 'lecturer', label: 'Dosen', group: 'Akademik' },
  { value: 'advisor', label: 'Dosen wali', group: 'Akademik' },
  { value: 'academic_staff', label: 'Staf akademik', group: 'Staf' },
  { value: 'finance_staff', label: 'Staf keuangan', group: 'Staf' },
  { value: 'student_affairs_staff', label: 'Staf kemahasiswaan', group: 'Staf' },
  { value: 'admissions_staff', label: 'Staf PMB', group: 'Staf' },
  { value: 'leader', label: 'Pimpinan', group: 'Pimpinan' },
  { value: 'administrator', label: 'Administrator', group: 'Pimpinan' },
]

const roleOptions = computed(() => isLmsMvp.value
  ? allRoleOptions.filter(option => ['student', 'lecturer', 'administrator'].includes(option.value))
  : allRoleOptions)
const roleLabels = Object.fromEntries(allRoleOptions.map((option) => [option.value, option.label])) as Record<AccountRole, string>
const statusLabels: Record<AccountStatus, string> = { active: 'Aktif', disabled: 'Dinonaktifkan', blocked: 'Diblokir' }
const tableColumns = [
  { key: 'identity', label: 'Pengguna', sortable: true },
  { key: 'roles', label: 'Role & akses', sortable: false },
  { key: 'scope', label: 'Lingkup', sortable: false },
  { key: 'status', label: 'Status' },
  { key: 'updatedAt', label: 'Diperbarui' },
  { key: 'actions', label: '', sortable: false, align: 'end' as const, width: '124px' },
]

const rows = computed(() => pageData.value.items.map((account) => ({
  ...account,
  identity: account.displayName,
  scope: account.roles.includes('guardian')
    ? `${account.guardianStudentIds.length} mahasiswa tertaut`
    : account.scope.programStudyIds.join(', ') || account.scope.unitIds.join(', ') || 'Seluruh kampus',
  updatedAt: new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(account.updatedAt)),
})))
const activeOnPage = computed(() => pageData.value.items.filter((account) => account.status === 'active').length)
const restrictedOnPage = computed(() => pageData.value.items.filter((account) => account.status !== 'active').length)
const guardianOnPage = computed(() => pageData.value.items.filter((account) => account.roles.includes('guardian')).length)

const splitList = (value: string) => [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))]
const errorText = (error: unknown) => {
  if (!error || typeof error !== 'object') return 'Permintaan tidak dapat diproses.'
  const candidate = error as { response?: { data?: { statusMessage?: string; message?: string }; statusText?: string }; message?: string }
  return candidate.response?.data?.statusMessage || candidate.response?.data?.message || candidate.message || 'Permintaan tidak dapat diproses.'
}
const idempotencyKey = (purpose: string) => `${purpose}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`

const loadAccounts = async (page = 1) => {
  if (!isAdministrator.value) return
  loading.value = true
  errorMessage.value = ''
  try {
    const { data } = await useNuxtApp().$api.get<AccountPage>('/accounts', {
      params: {
        page,
        pageSize: pageData.value.pageSize,
        ...(filters.search.trim() ? { search: filters.search.trim() } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.role ? { role: filters.role } : {}),
        ...(filters.programStudyId.trim() ? { programStudyId: filters.programStudyId.trim() } : {}),
      },
    })
    pageData.value = data
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    loading.value = false
  }
}

const resetForm = () => Object.assign(form, emptyForm())
const openCreate = () => {
  resetForm()
  editorMode.value = 'create'
  errorMessage.value = ''
  showEditor.value = true
}
const openEdit = (account: AccountRecord) => {
  Object.assign(form, {
    id: account.id,
    version: account.version,
    email: account.email,
    displayName: account.displayName,
    roles: [...account.roles],
    status: account.status,
    unitIds: account.scope.unitIds.join(', '),
    programStudyIds: account.scope.programStudyIds.join(', '),
    cohortYears: account.scope.cohortYears.join(', '),
    studentIds: account.scope.studentIds.join(', '),
    guardianStudentIds: account.guardianStudentIds.join(', '),
  })
  editorMode.value = 'edit'
  errorMessage.value = ''
  showEditor.value = true
}

const toggleRole = (role: AccountRole) => {
  const directRoles: AccountRole[] = ['applicant', 'student', 'guardian']
  if (!form.roles.includes(role)) {
    if (directRoles.includes(role)) form.roles = [role]
    else {
      form.roles = form.roles.filter((item) => !directRoles.includes(item))
      form.roles.push(role)
      if (role === 'advisor' && !form.roles.includes('lecturer')) form.roles.push('lecturer')
    }
    return
  }
  if (form.roles.length === 1) return
  form.roles = form.roles.filter((item) => item !== role)
  if (role === 'lecturer') form.roles = form.roles.filter((item) => item !== 'advisor')
}

const payloadFromForm = () => {
  const guardianLinks = splitList(form.guardianStudentIds)
  const guardian = form.roles.includes('guardian')
  return {
    email: form.email.trim(),
    displayName: form.displayName.trim(),
    roles: [...form.roles],
    status: form.status,
    scope: guardian
      ? { unitIds: [], programStudyIds: [], cohortYears: [], studentIds: guardianLinks }
      : {
          unitIds: splitList(form.unitIds),
          programStudyIds: splitList(form.programStudyIds),
          cohortYears: splitList(form.cohortYears).map(Number),
          studentIds: splitList(form.studentIds),
        },
    guardianStudentIds: guardian ? guardianLinks : [],
  }
}

const saveAccount = async () => {
  saving.value = true
  errorMessage.value = ''
  try {
    const payload = payloadFromForm()
    if (editorMode.value === 'create') {
      await useNuxtApp().$api.post('/accounts', payload, {
        headers: { 'Idempotency-Key': idempotencyKey('account-create') },
      })
      noticeMessage.value = `Akun ${payload.displayName} berhasil dibuat.`
      if (passwordResetAvailable.value) {
        try {
          await requestPasswordReset(payload.email, idempotencyKey('account-onboarding'))
          noticeMessage.value += ` Petunjuk pembuatan kata sandi dikirim melalui ${passwordResetDeliveryLabel.value}.`
        } catch {
          noticeMessage.value += ' Petunjuk pembuatan kata sandi belum terkirim; gunakan aksi amplop untuk mencoba kembali.'
        }
      }
    } else {
      await useNuxtApp().$api.patch(`/accounts/${encodeURIComponent(form.id || '')}`, {
        ...payload,
        expectedVersion: form.version,
      }, {
        headers: { 'Idempotency-Key': idempotencyKey('account-update') },
      })
      noticeMessage.value = `Perubahan akun ${payload.displayName} berhasil disimpan.`
    }
    showEditor.value = false
    await loadAccounts(pageData.value.page)
  } catch (error) {
    errorMessage.value = errorText(error)
  } finally {
    saving.value = false
  }
}

const sendPasswordReset = async (account: AccountRecord) => {
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    noticeMessage.value = await requestPasswordReset(account.email, idempotencyKey('password-reset'))
  } catch (error) {
    errorMessage.value = errorText(error)
  }
}

onMounted(() => loadAccounts())
</script>

<template>
  <div class="page-stack">
    <AppPageHeader
      eyebrow="Administrasi sistem"
      title="Manajemen pengguna"
      description="Kelola identitas, multi-role, lingkup akses, dan status akun dari satu tempat dengan perubahan yang dapat diaudit."
    >
      <template #actions>
        <button v-if="isAdministrator" class="btn btn-primary" type="button" @click="openCreate">
          <i class="uil uil-user-plus me-2" aria-hidden="true" />Tambah pengguna
        </button>
      </template>
    </AppPageHeader>

    <section v-if="!isAdministrator" class="access-denied" role="alert">
      <span><i class="uil uil-shield-exclamation" aria-hidden="true" /></span>
      <div><span class="section-kicker">Akses terbatas</span><h2>Halaman ini khusus administrator</h2><p>Role dan lingkup akun tidak dapat dilihat atau diubah oleh pengguna lain, termasuk staf dan orang tua/wali.</p></div>
    </section>

    <template v-else>
      <div v-if="noticeMessage" class="alert alert-success d-flex align-items-start gap-2 mb-0" role="status">
        <i class="uil uil-check-circle mt-1" aria-hidden="true" /><span>{{ noticeMessage }}</span>
        <button class="btn-close ms-auto" type="button" aria-label="Tutup pemberitahuan" @click="noticeMessage = ''" />
      </div>
      <div v-if="errorMessage && !showEditor" class="alert alert-danger d-flex align-items-start gap-2 mb-0" role="alert">
        <i class="uil uil-exclamation-triangle mt-1" aria-hidden="true" /><span>{{ errorMessage }}</span>
      </div>

      <section class="row g-3" aria-label="Ringkasan akun pada halaman">
        <div class="col-sm-6 col-xl-3"><StatCard label="Total pengguna" :value="pageData.total.toLocaleString('id-ID')" detail="Sesuai hasil filter" trend="Data server" tone="forest" /></div>
        <div class="col-sm-6 col-xl-3"><StatCard label="Aktif di halaman" :value="String(activeOnPage)" detail="Dapat membuat sesi" trend="Status aktif" tone="blue" /></div>
        <div class="col-sm-6 col-xl-3"><StatCard label="Dibatasi di halaman" :value="String(restrictedOnPage)" detail="Nonaktif atau diblokir" trend="Sesi dicabut" tone="coral" /></div>
        <div class="col-sm-6 col-xl-3"><StatCard label="Akun wali di halaman" :value="String(guardianOnPage)" detail="Akses mahasiswa tertaut" trend="Scope terbatas" tone="amber" /></div>
      </section>

      <section class="workflow-toolbar account-filter" aria-label="Filter pengguna">
        <div class="workflow-toolbar__meta">
          <i class="uil uil-shield-check" aria-hidden="true" />
          <div><strong>Kontrol akses terpusat</strong><small>Perubahan role atau scope mencabut sesi lama secara otomatis.</small></div>
        </div>
        <form class="workflow-toolbar__filters" @submit.prevent="loadAccounts(1)">
          <label><span>Pencarian</span><input v-model="filters.search" class="form-control form-control-sm" type="search" placeholder="Nama, email, atau ID"></label>
          <label><span>Status</span><select v-model="filters.status" class="form-select form-select-sm"><option value="">Semua status</option><option value="active">Aktif</option><option value="disabled">Dinonaktifkan</option><option value="blocked">Diblokir</option></select></label>
          <label><span>Role</span><select v-model="filters.role" class="form-select form-select-sm"><option value="">Semua role</option><option v-for="role in roleOptions" :key="role.value" :value="role.value">{{ role.label }}</option></select></label>
          <label><span>Program studi</span><input v-model="filters.programStudyId" class="form-control form-control-sm" placeholder="management-s1"></label>
          <button class="btn btn-sm btn-outline-secondary align-self-end" type="submit" :disabled="loading"><i class="uil uil-filter me-1" aria-hidden="true" />Terapkan</button>
        </form>
      </section>

      <section class="workflow-surface" :aria-busy="loading">
        <header class="workflow-surface__header">
          <div><span class="section-kicker">Direktori identitas</span><h2>Akun dan lingkup akses</h2><p>Data sensitif hanya tersedia di area privat dan tidak dikirim ke layanan analitik.</p></div>
          <span class="directory-count">Halaman {{ pageData.page }} dari {{ pageData.totalPages }}</span>
        </header>
        <div v-if="loading" class="loading-state" role="status"><span class="spinner-border spinner-border-sm" aria-hidden="true" />Memuat akun…</div>
        <DataTable
          v-else
          :columns="tableColumns"
          :rows="rows"
          :page-size="pageData.pageSize"
          search-placeholder="Cari pada halaman ini…"
          empty-title="Akun tidak ditemukan"
          empty-description="Ubah filter atau tambahkan pengguna baru."
        >
          <template #cell-identity="{ row }">
            <div class="identity-cell" data-clarity-mask="true"><span>{{ String(row.displayName).split(/\s+/).slice(0, 2).map(part => part[0]).join('') }}</span><div><strong>{{ row.displayName }}</strong><small>{{ row.email }}</small><code>{{ row.id }}</code></div></div>
          </template>
          <template #cell-roles="{ row }"><div class="role-stack"><span v-for="role in (row.roles as AccountRole[])" :key="role">{{ roleLabels[role] || role }}</span></div></template>
          <template #cell-scope="{ row, value }"><div class="scope-cell"><strong>{{ value }}</strong><small v-if="(row.scope as AccountRecord['scope']).unitIds.length">{{ (row.scope as AccountRecord['scope']).unitIds.join(', ') }}</small></div></template>
          <template #cell-status="{ row }"><StatusBadge :status="row.status === 'disabled' ? 'inactive' : String(row.status)" :label="statusLabels[row.status as AccountStatus]" /></template>
          <template #cell-actions="{ row }"><div class="row-actions"><button v-if="passwordResetAvailable" type="button" title="Kirim tautan reset" aria-label="Kirim tautan reset kata sandi" @click="sendPasswordReset(row as unknown as AccountRecord)"><i class="uil uil-envelope-redo" aria-hidden="true" /></button><button type="button" title="Edit akun" aria-label="Edit akun" @click="openEdit(row as unknown as AccountRecord)"><i class="uil uil-pen" aria-hidden="true" /></button></div></template>
        </DataTable>
        <footer v-if="!loading && pageData.totalPages > 1" class="server-pagination">
          <p>Menampilkan hingga {{ pageData.pageSize }} dari {{ pageData.total }} akun</p>
          <div><button class="btn btn-sm btn-outline-secondary" type="button" :disabled="pageData.page <= 1" @click="loadAccounts(pageData.page - 1)"><i class="uil uil-angle-left" aria-hidden="true" />Sebelumnya</button><button class="btn btn-sm btn-outline-secondary" type="button" :disabled="pageData.page >= pageData.totalPages" @click="loadAccounts(pageData.page + 1)">Berikutnya<i class="uil uil-angle-right" aria-hidden="true" /></button></div>
        </footer>
      </section>
    </template>

    <section v-if="showEditor" class="editor-overlay" role="dialog" aria-modal="true" aria-labelledby="account-editor-title">
      <form class="account-editor" @submit.prevent="saveAccount">
        <header><div><span class="section-kicker">{{ editorMode === 'create' ? 'Identitas baru' : 'Perbarui akses' }}</span><h2 id="account-editor-title">{{ editorMode === 'create' ? 'Tambah pengguna' : 'Edit pengguna' }}</h2><p>Role dan scope akan ditanamkan ke identitas Firebase setelah penyimpanan berhasil.</p></div><button type="button" aria-label="Tutup editor" @click="showEditor = false"><i class="uil uil-times" aria-hidden="true" /></button></header>

        <div class="account-editor__body">
          <div v-if="errorMessage" class="alert alert-danger py-2" role="alert">{{ errorMessage }}</div>
          <div class="form-grid">
            <label class="form-field"><span>Nama lengkap</span><input v-model="form.displayName" class="form-control" required minlength="2" maxlength="150" autocomplete="name"></label>
            <label class="form-field"><span>Email institusi / pribadi</span><input v-model="form.email" class="form-control" type="email" required maxlength="254" autocomplete="email" data-clarity-mask="true"></label>
            <label class="form-field"><span>Status akun</span><select v-model="form.status" class="form-select"><option value="active">Aktif</option><option value="disabled">Dinonaktifkan</option><option value="blocked">Diblokir</option></select><small>Nonaktif dan blokir langsung mencabut sesi pengguna.</small></label>
          </div>

          <fieldset class="role-picker"><legend>Role pengguna</legend><p>Pilih beberapa role staf bila diperlukan. Role mahasiswa, pendaftar, dan wali bersifat eksklusif.</p><div><label v-for="role in roleOptions" :key="role.value" :class="{ selected: form.roles.includes(role.value) }"><input type="checkbox" :checked="form.roles.includes(role.value)" @change="toggleRole(role.value)"><span><strong>{{ role.label }}</strong><small>{{ role.group }}</small></span></label></div></fieldset>

          <fieldset v-if="form.roles.includes('guardian')" class="scope-panel"><legend>Mahasiswa tertaut</legend><p>Akun wali hanya dapat membaca ringkasan mahasiswa yang tercantum. Masukkan ID akun mahasiswa, dipisahkan koma.</p><label class="form-field"><span>ID mahasiswa</span><textarea v-model="form.guardianStudentIds" class="form-control" rows="2" required placeholder="student-001, student-002" data-clarity-mask="true" /></label></fieldset>
          <fieldset v-else class="scope-panel"><legend>Lingkup akses</legend><p>Gunakan ID kanonik dan pisahkan beberapa nilai dengan koma. Scope kosong hanya sesuai untuk administrator, pimpinan, atau dosen nonwali.</p><div class="form-grid"><label class="form-field"><span>Unit</span><input v-model="form.unitIds" class="form-control" placeholder="faculty-economics"></label><label class="form-field"><span>Program studi</span><input v-model="form.programStudyIds" class="form-control" placeholder="management-s1"></label><label class="form-field"><span>Angkatan</span><input v-model="form.cohortYears" class="form-control" inputmode="numeric" placeholder="2023, 2024"></label><label class="form-field"><span>ID mahasiswa</span><input v-model="form.studentIds" class="form-control" placeholder="student-001" data-clarity-mask="true"></label></div></fieldset>

          <div class="note-box"><i class="uil uil-info-circle" aria-hidden="true" /><p v-if="passwordResetAvailable">Akun baru tidak menerima kata sandi awal. Gunakan aksi amplop pada tabel untuk mengirim petunjuk melalui {{ passwordResetDeliveryLabel }}.</p><p v-else>Pemulihan akun belum dikonfigurasi. Aktifkan jalur pemulihan sebelum menambahkan pengguna produksi.</p></div>
        </div>

        <footer><button class="btn btn-outline-secondary" type="button" :disabled="saving" @click="showEditor = false">Batal</button><button class="btn btn-primary" type="submit" :disabled="saving"><span v-if="saving" class="spinner-border spinner-border-sm me-2" aria-hidden="true" /><i v-else class="uil uil-shield-check me-2" aria-hidden="true" />{{ saving ? 'Menyimpan…' : 'Simpan akun' }}</button></footer>
      </form>
    </section>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.access-denied { display: flex; align-items: flex-start; gap: 1rem; padding: 1.35rem; border: 1px solid #e7d9ba; border-radius: 1rem; background: #fffaf0; }
.access-denied > span { display: grid; place-items: center; flex: 0 0 auto; width: 3rem; height: 3rem; border-radius: .85rem; color: #946a27; background: #fff; font-size: 1.25rem; }
.access-denied h2 { margin: 0; color: #614b27; font-size: 1rem; }
.access-denied p { margin: .35rem 0 0; color: #8c7a5d; font-size: .72rem; }
.account-filter { align-items: flex-end; }
.account-filter .workflow-toolbar__filters { display: grid; grid-template-columns: minmax(180px, 1.35fr) repeat(3, minmax(130px, 1fr)) auto; flex: 1; }
.directory-count { color: #71847c; font-size: .68rem; font-weight: 700; }
.loading-state { display: flex; align-items: center; justify-content: center; gap: .65rem; min-height: 240px; color: #6e8179; font-size: .75rem; }
.identity-cell { display: flex; align-items: center; gap: .7rem; min-width: 220px; }
.identity-cell > span { display: grid; place-items: center; flex: 0 0 auto; width: 2.25rem; height: 2.25rem; border-radius: .7rem; color: #346652; background: #eaf3ed; font-size: .7rem; font-weight: 850; }
.identity-cell strong, .identity-cell small, .identity-cell code { display: block; }
.identity-cell strong { color: #294a40; font-size: .73rem; }
.identity-cell small { margin-top: .08rem; color: #7c8c85; font-size: .63rem; }
.identity-cell code { margin-top: .12rem; color: #9aa49f; font-size: .55rem; }
.role-stack { display: flex; flex-wrap: wrap; gap: .25rem; max-width: 245px; }
.role-stack span { padding: .26rem .45rem; border-radius: 999px; color: #416a5c; background: #edf4f0; font-size: .58rem; font-weight: 750; }
.scope-cell { max-width: 210px; }
.scope-cell strong, .scope-cell small { display: block; }
.scope-cell strong { color: #455f56; font-size: .67rem; }
.scope-cell small { margin-top: .14rem; color: #8a9892; font-size: .59rem; }
.row-actions { display: inline-flex; gap: .3rem; }
.row-actions button { display: grid; place-items: center; width: 2rem; height: 2rem; border: 1px solid #dce6e0; border-radius: .55rem; color: #4b7264; background: #fff; }
.row-actions button:hover { border-color: #9bb7aa; color: #285a48; background: #f3f8f5; }
.server-pagination { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .85rem 1.25rem; border-top: 1px solid #e8eeea; background: #fafcfb; }
.server-pagination p { margin: 0; color: #7e8d87; font-size: .65rem; }
.server-pagination div { display: flex; gap: .5rem; }
.editor-overlay { position: fixed; z-index: 1080; inset: 0; display: grid; place-items: center; padding: 1rem; background: rgba(11, 34, 27, .62); backdrop-filter: blur(5px); }
.account-editor { display: flex; overflow: hidden; width: min(100%, 880px); max-height: calc(100vh - 2rem); flex-direction: column; border-radius: 1.1rem; background: #fff; box-shadow: 0 30px 90px rgba(8, 29, 22, .34); }
.account-editor > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; padding: 1.35rem 1.5rem 1.1rem; border-bottom: 1px solid #e9eeeb; }
.account-editor > header h2 { margin: 0; color: #24483a; font-size: 1.15rem; }
.account-editor > header p { margin: .35rem 0 0; color: #7f8e88; font-size: .68rem; }
.account-editor > header button { display: grid; place-items: center; flex: 0 0 auto; width: 2rem; height: 2rem; border: 0; border-radius: .55rem; color: #64776f; background: #f0f4f2; }
.account-editor__body { overflow-y: auto; display: grid; gap: 1.15rem; padding: 1.25rem 1.5rem; }
.form-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: .85rem; }
.form-field { display: grid; align-content: start; gap: .35rem; }
.form-field > span, .role-picker legend, .scope-panel legend { color: #405e54; font-size: .68rem; font-weight: 800; }
.form-field > small { color: #8b9792; font-size: .6rem; }
.form-field .form-control, .form-field .form-select { border-color: #d8e2dc; font-size: .72rem; }
.role-picker, .scope-panel { margin: 0; padding: 1rem; border: 1px solid #e0e8e3; border-radius: .85rem; }
.role-picker > p, .scope-panel > p { margin: .2rem 0 .75rem; color: #85928d; font-size: .63rem; }
.role-picker > div { display: grid; grid-template-columns: repeat(3, 1fr); gap: .45rem; }
.role-picker label { display: flex; align-items: center; gap: .55rem; padding: .6rem; border: 1px solid #e4eae7; border-radius: .65rem; cursor: pointer; }
.role-picker label.selected { border-color: #73a18c; background: #f0f7f2; box-shadow: inset 0 0 0 1px #73a18c; }
.role-picker input { accent-color: #2f7059; }
.role-picker strong, .role-picker small { display: block; }
.role-picker strong { color: #38564c; font-size: .65rem; }
.role-picker small { margin-top: .08rem; color: #8d9994; font-size: .55rem; }
.account-editor > footer { display: flex; justify-content: flex-end; gap: .6rem; padding: 1rem 1.5rem; border-top: 1px solid #e8eeea; background: #fafcfb; }
@media (max-width: 1199.98px) { .account-filter { align-items: stretch; flex-direction: column; } .account-filter .workflow-toolbar__filters { width: 100%; grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 767.98px) { .form-grid, .role-picker > div { grid-template-columns: 1fr; } .account-filter .workflow-toolbar__filters { grid-template-columns: 1fr; } .server-pagination { align-items: stretch; flex-direction: column; } .server-pagination div { display: grid; grid-template-columns: 1fr 1fr; } .account-editor { max-height: 100vh; border-radius: 0; } .editor-overlay { padding: 0; } }
</style>
