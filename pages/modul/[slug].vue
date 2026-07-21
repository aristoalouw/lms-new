<script setup lang="ts">
import { moduleAliases, moduleCatalog } from '~/data/moduleCatalog'
import type { Tone } from '~/data/dashboard'

definePageMeta({ middleware: 'auth' })

const route = useRoute()
const selectedStatus = ref('Semua status')
const actionNotice = ref('')

const requestedSlug = computed(() => Array.isArray(route.params.slug) ? route.params.slug[0] || '' : String(route.params.slug || ''))
const resolvedSlug = computed(() => moduleAliases[requestedSlug.value] || requestedSlug.value)
const config = computed(() => {
  const found = moduleCatalog[resolvedSlug.value]
  if (!found) throw createError({ statusCode: 404, statusMessage: 'Modul tidak ditemukan' })
  return found
})

useHead(() => ({ title: config.value.title }))

const statusOptions = computed(() => [
  'Semua status',
  ...Array.from(new Set(config.value.rows.map(row => String(row.status || '')).filter(Boolean))),
])

const filteredRows = computed(() => selectedStatus.value === 'Semua status'
  ? config.value.rows
  : config.value.rows.filter(row => String(row.status) === selectedStatus.value))

const statTone = (tone: Tone): 'forest' | 'amber' | 'blue' | 'coral' | 'slate' => ({
  primary: 'forest', success: 'forest', warning: 'amber', danger: 'coral', info: 'blue', neutral: 'slate',
})[tone] as 'forest' | 'amber' | 'blue' | 'coral' | 'slate'

const badgeStatus = (status: string) => {
  const normalized = status.toLowerCase()
  if (['selesai', 'aktif', 'layak', 'memenuhi', 'terkirim', 'berhasil', 'siap diterbitkan', 'siap diambil', 'di atas target', 'lengkap'].some(term => normalized.includes(term))) return 'success'
  if (['cekal', 'gagal', 'dibatasi', 'kurang', 'rendah'].some(term => normalized.includes(term))) return 'blocked'
  if (['jadwal', 'otomatis', 'berjalan', 'diproses', 'ditinjau', 'pemeliharaan'].some(term => normalized.includes(term))) return 'processing'
  if (['perlu', 'verifikasi', 'draf', 'baru', 'menunggu', 'catatan', 'prioritas'].some(term => normalized.includes(term))) return 'review'
  return 'draft'
}

const triggerAction = (action: string) => {
  actionNotice.value = `${action} siap digunakan pada mode demonstrasi. Perubahan data belum disimpan.`
}
</script>

<template>
  <div class="page-stack module-page">
    <AppPageHeader :eyebrow="config.eyebrow" :title="config.title" :description="config.description">
      <template #actions>
        <button class="btn btn-outline-secondary" type="button" @click="triggerAction(config.secondaryAction)">
          <i class="uil uil-export me-2" aria-hidden="true" />{{ config.secondaryAction }}
        </button>
        <button class="btn btn-primary" type="button" @click="triggerAction(config.primaryAction)">
          <i class="uil uil-plus me-2" aria-hidden="true" />{{ config.primaryAction }}
        </button>
      </template>
    </AppPageHeader>

    <div v-if="actionNotice" class="alert alert-info alert-dismissible d-flex align-items-start gap-2 mb-0" role="status">
      <i class="uil uil-info-circle" aria-hidden="true" /><span class="flex-grow-1">{{ actionNotice }}</span>
      <button class="btn-close" type="button" aria-label="Tutup" @click="actionNotice = ''" />
    </div>

    <section class="module-toolbar" aria-label="Filter modul">
      <div class="module-toolbar__context">
        <span><i class="uil uil-layer-group" aria-hidden="true" /></span>
        <div><strong>{{ config.periodLabel }}</strong><small>Data diperbarui 21 Juli 2026, 10.24 WIB</small></div>
      </div>
      <div class="module-toolbar__filters">
        <label><span>Status</span><select v-model="selectedStatus" class="form-select form-select-sm"><option v-for="status in statusOptions" :key="status">{{ status }}</option></select></label>
        <button class="btn btn-sm btn-outline-secondary" type="button"><i class="uil uil-filter me-1" aria-hidden="true" />Filter lanjutan</button>
      </div>
    </section>

    <section class="row g-3" :aria-label="`Ringkasan ${config.title}`">
      <div v-for="stat in config.stats" :key="stat.label" class="col-sm-6 col-xl-3">
        <StatCard :label="stat.label" :value="stat.value" :detail="stat.detail" :trend="stat.trend" :tone="statTone(stat.tone)" />
      </div>
    </section>

    <section class="module-alert" :class="`module-alert--${config.alert.tone}`">
      <span class="module-alert__icon"><i :class="config.alert.tone === 'warning' ? 'uil uil-exclamation-triangle' : 'uil uil-info-circle'" aria-hidden="true" /></span>
      <div><span class="module-kicker">Fokus hari ini</span><h2>{{ config.alert.title }}</h2><p>{{ config.alert.description }}</p></div>
      <StatusBadge :status="badgeStatus(config.alert.status)" :label="config.alert.status" />
    </section>

    <section class="row g-4 align-items-stretch">
      <div class="col-12 col-xl-9">
        <article class="module-surface h-100">
          <header class="module-surface__header">
            <div><span class="module-kicker">Ruang kerja utama</span><h2>Daftar pekerjaan & data</h2><p>Gunakan pencarian, pengurutan, dan filter status untuk mempersempit tampilan.</p></div>
            <span class="record-count">{{ filteredRows.length }} data tampil</span>
          </header>
          <DataTable
            v-if="filteredRows.length"
            :columns="config.columns"
            :rows="filteredRows"
            :page-size="8"
            :search-placeholder="`Cari data ${config.title.toLowerCase()}…`"
            :empty-title="config.emptyTitle"
            :empty-description="config.emptyDescription"
          >
            <template #cell-status="{ value }"><StatusBadge :status="badgeStatus(String(value))" :label="String(value)" /></template>
          </DataTable>
          <EmptyState v-else :title="config.emptyTitle" :description="config.emptyDescription" icon="uil-filter-slash">
            <button class="btn btn-sm btn-outline-secondary mt-2" type="button" @click="selectedStatus = 'Semua status'">Hapus filter</button>
          </EmptyState>
        </article>
      </div>

      <div class="col-12 col-xl-3">
        <div class="d-grid gap-4 h-100 module-aside">
          <article class="module-surface">
            <header class="module-surface__header module-surface__header--compact"><div><span class="module-kicker">Indikator</span><h2>Ringkasan cepat</h2></div></header>
            <div class="insight-list">
              <div v-for="insight in config.insights" :key="insight.label">
                <span class="insight-list__icon" :class="`insight-list__icon--${insight.tone}`"><i class="uil uil-chart" aria-hidden="true" /></span>
                <span><small>{{ insight.label }}</small><strong>{{ insight.value }}</strong><em>{{ insight.detail }}</em></span>
              </div>
            </div>
          </article>

          <article class="module-surface flex-grow-1">
            <header class="module-surface__header module-surface__header--compact"><div><span class="module-kicker">Tindak lanjut</span><h2>Daftar kerja</h2></div><button class="icon-button" type="button" aria-label="Buka seluruh tindak lanjut"><i class="uil uil-arrow-up-right" aria-hidden="true" /></button></header>
            <ol class="checklist">
              <li v-for="(item, index) in config.checklist" :key="item.label"><span>{{ index + 1 }}</span><div><strong>{{ item.label }}</strong><small>{{ item.detail }}</small></div><StatusBadge :status="badgeStatus(item.status)" :label="item.status" /></li>
            </ol>
          </article>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page-stack { display: grid; gap: 1.5rem; }
.module-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .85rem 1rem; border: 1px solid var(--border-subtle, #e1e8e4); border-radius: .95rem; background: var(--surface, #fff); }
.module-toolbar__context,
.module-toolbar__filters,
.module-toolbar__filters label { display: flex; align-items: center; }
.module-toolbar__context { gap: .7rem; }
.module-toolbar__context > span { display: grid; place-items: center; width: 2.2rem; height: 2.2rem; border-radius: .65rem; color: #376d5b; background: #edf5f0; }
.module-toolbar__context strong,
.module-toolbar__context small { display: block; }
.module-toolbar__context strong { color: #2d4a41; font-size: .78rem; }
.module-toolbar__context small { margin-top: .12rem; color: #899691; font-size: .65rem; }
.module-toolbar__filters { gap: .6rem; }
.module-toolbar__filters label { gap: .4rem; }
.module-toolbar__filters label > span { color: #7e8c87; font-size: .67rem; font-weight: 700; }
.module-toolbar .form-select { min-width: 155px; border-color: #dbe4df; border-radius: .6rem; font-size: .7rem; }
.module-alert { display: grid; grid-template-columns: auto 1fr auto; gap: .9rem; align-items: center; padding: 1rem 1.1rem; border: 1px solid #d5e3da; border-radius: .95rem; background: #f1f7f2; }
.module-alert--warning { border-color: #eadbb9; background: #fffaf0; }
.module-alert--danger { border-color: #ebd2ca; background: #fff7f5; }
.module-alert--info { border-color: #cfe1e7; background: #f2f8fa; }
.module-alert__icon { display: grid; place-items: center; width: 2.5rem; height: 2.5rem; border-radius: .75rem; color: #447562; background: #fff; box-shadow: 0 4px 12px rgba(38,73,59,.07); }
.module-alert--warning .module-alert__icon { color: #966e2e; }
.module-alert h2 { margin: 0; color: #2a4a3f; font-size: .85rem; }
.module-alert p { margin: .22rem 0 0; color: #788981; font-size: .67rem; line-height: 1.45; }
.module-kicker { display: block; margin-bottom: .32rem; color: #608175; font-size: .62rem; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; }
.module-surface { overflow: hidden; border: 1px solid var(--border-subtle, #e1e8e4); border-radius: 1rem; background: var(--surface, #fff); box-shadow: 0 3px 16px rgba(27,59,49,.035); }
.module-surface__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; padding: 1.15rem 1.25rem .95rem; border-bottom: 1px solid #edf1ee; }
.module-surface__header--compact { padding-bottom: .75rem; border-bottom: 0; }
.module-surface__header h2 { margin: 0; color: #28483e; font-size: .92rem; }
.module-surface__header p { margin: .3rem 0 0; color: #899690; font-size: .67rem; }
.record-count { padding: .3rem .55rem; border-radius: 999px; color: #567166; background: #eef4f0; font-size: .62rem; font-weight: 800; white-space: nowrap; }
.insight-list { display: grid; padding: 0 .95rem .95rem; }
.insight-list > div { display: flex; align-items: center; gap: .65rem; padding: .72rem 0; border-bottom: 1px solid #edf1ee; }
.insight-list > div:last-child { border-bottom: 0; }
.insight-list__icon { display: grid; place-items: center; flex: 0 0 auto; width: 2rem; height: 2rem; border-radius: .6rem; color: #39705d; background: #eaf4ed; }
.insight-list__icon--warning { color: #8d672c; background: #fbf0dc; }
.insight-list__icon--info { color: #3e7482; background: #e8f3f5; }
.insight-list > div > span:last-child { min-width: 0; }
.insight-list small,
.insight-list strong,
.insight-list em { display: block; }
.insight-list small { color: #82908b; font-size: .61rem; }
.insight-list strong { margin-top: .08rem; color: #2e4c42; font-size: .84rem; }
.insight-list em { overflow: hidden; margin-top: .06rem; color: #929e99; font-size: .58rem; font-style: normal; text-overflow: ellipsis; white-space: nowrap; }
.checklist { display: grid; margin: 0; padding: 0 .95rem .95rem; list-style: none; }
.checklist li { display: grid; grid-template-columns: 1.45rem 1fr auto; gap: .55rem; align-items: center; padding: .75rem 0; border-bottom: 1px solid #edf1ee; }
.checklist li:last-child { border-bottom: 0; }
.checklist li > span { display: grid; place-items: center; width: 1.35rem; height: 1.35rem; border-radius: 50%; color: #527166; background: #edf4ef; font-size: .58rem; font-weight: 800; }
.checklist strong,
.checklist small { display: block; }
.checklist strong { color: #314e45; font-size: .65rem; line-height: 1.35; }
.checklist small { margin-top: .1rem; color: #8d9994; font-size: .58rem; }
.icon-button { display: grid; place-items: center; width: 2rem; height: 2rem; border: 1px solid #e0e7e3; border-radius: .6rem; color: #557268; background: #fff; }
@media (max-width: 767.98px) { .module-toolbar { align-items: stretch; flex-direction: column; } .module-toolbar__filters { justify-content: space-between; } .module-alert { grid-template-columns: auto 1fr; } .module-alert > :last-child { grid-column: 2; justify-self: start; } }
@media (max-width: 480px) { .module-toolbar__filters { align-items: stretch; flex-direction: column; } .module-toolbar__filters label { align-items: flex-start; flex-direction: column; } .module-toolbar .form-select { width: 100%; } }
</style>
