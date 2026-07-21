<template>
  <div class="data-table-card">
    <div class="data-table-toolbar">
      <div class="table-search">
        <i class="uil uil-search" aria-hidden="true" />
        <input v-model="query" type="search" :placeholder="searchPlaceholder || 'Cari data…'" :aria-label="searchPlaceholder || 'Cari data'">
      </div>
      <div class="data-table-toolbar__actions">
        <span class="data-table-count">{{ filteredRows.length }} data</span>
        <slot name="toolbar" />
      </div>
    </div>

    <div v-if="filteredRows.length" class="table-responsive">
      <table class="table data-table align-middle mb-0">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column.key" :style="{ width: column.width }" :class="`text-${column.align || 'start'}`" scope="col">
              <button v-if="column.sortable !== false" class="sort-button" type="button" @click="sort(column.key)">
                {{ column.label }}
                <i v-if="sortKey === column.key" class="uil" :class="sortDirection === 'asc' ? 'uil-angle-up' : 'uil-angle-down'" aria-hidden="true" />
                <i v-else class="uil uil-sort text-muted" aria-hidden="true" />
              </button>
              <span v-else>{{ column.label }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in paginatedRows" :key="String(row.id || index)">
            <td v-for="column in columns" :key="column.key" :class="`text-${column.align || 'start'}`">
              <slot :name="`cell-${column.key}`" :row="row" :value="valueAt(row, column.key)">
                {{ valueAt(row, column.key) }}
              </slot>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <EmptyState v-else :title="emptyTitle || 'Belum ada data'" :description="emptyDescription || 'Data akan tampil di sini setelah tersedia.'" />

    <div v-if="pageCount > 1" class="data-table-pagination">
      <p>Menampilkan {{ pageStart }}–{{ pageEnd }} dari {{ filteredRows.length }}</p>
      <nav aria-label="Navigasi halaman tabel">
        <button type="button" :disabled="page === 1" aria-label="Halaman sebelumnya" @click="page--"><i class="uil uil-angle-left" /></button>
        <button v-for="pageNumber in visiblePages" :key="pageNumber" type="button" :class="{ active: pageNumber === page }" :aria-current="pageNumber === page ? 'page' : undefined" @click="page = pageNumber">{{ pageNumber }}</button>
        <button type="button" :disabled="page === pageCount" aria-label="Halaman berikutnya" @click="page++"><i class="uil uil-angle-right" /></button>
      </nav>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { TableColumn } from '~/types/domain'

const props = withDefaults(defineProps<{
  columns: TableColumn[]
  rows: Record<string, unknown>[]
  searchPlaceholder?: string
  emptyTitle?: string
  emptyDescription?: string
  pageSize?: number
}>(), { pageSize: 8 })

const { valueAt } = useFormatters()
const query = ref('')
const page = ref(1)
const sortKey = ref('')
const sortDirection = ref<'asc' | 'desc'>('asc')

const filteredRows = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase('id')
  const result = needle
    ? props.rows.filter(row => Object.values(row).some(value => String(value ?? '').toLocaleLowerCase('id').includes(needle)))
    : [...props.rows]

  if (!sortKey.value) return result
  return result.sort((first, second) => {
    const a = valueAt(first, sortKey.value, '')
    const b = valueAt(second, sortKey.value, '')
    return String(a).localeCompare(String(b), 'id', { numeric: true }) * (sortDirection.value === 'asc' ? 1 : -1)
  })
})

const pageCount = computed(() => Math.max(1, Math.ceil(filteredRows.value.length / props.pageSize)))
const paginatedRows = computed(() => filteredRows.value.slice((page.value - 1) * props.pageSize, page.value * props.pageSize))
const pageStart = computed(() => filteredRows.value.length ? (page.value - 1) * props.pageSize + 1 : 0)
const pageEnd = computed(() => Math.min(page.value * props.pageSize, filteredRows.value.length))
const visiblePages = computed(() => Array.from({ length: pageCount.value }, (_, index) => index + 1).filter(value => Math.abs(value - page.value) <= 2))

const sort = (key: string) => {
  if (sortKey.value === key) sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  else {
    sortKey.value = key
    sortDirection.value = 'asc'
  }
}

watch([query, () => props.rows], () => { page.value = 1 })
watch(pageCount, count => { if (page.value > count) page.value = count })
</script>
