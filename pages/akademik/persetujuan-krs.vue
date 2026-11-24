<script setup lang="ts">
import type { UserRole } from '~/types/domain'
import KrsApprovalWorkspace from '~/components/academic/KrsApprovalWorkspace.vue'

definePageMeta({ middleware: 'auth' })
useHead({ title: 'Persetujuan KRS' })

const { user, can, switchRole } = useAuth()

const canApproveKrs = computed(() => can('krs:approve'))
const switchableApprovalRole = computed<UserRole | null>(() => {
  const roles = user.value?.roles || []
  if (roles.includes('advisor')) return 'advisor'
  if (roles.includes('academic_staff')) return 'academic_staff'
  return null
})
const switchableRoleLabel = computed(() => switchableApprovalRole.value === 'advisor' ? 'Dosen wali' : 'Staf akademik')

const switchToApprovalRole = async () => {
  if (!switchableApprovalRole.value) return
  await switchRole(switchableApprovalRole.value)
  await navigateTo('/akademik/persetujuan-krs', { replace: true })
}
</script>

<template>
  <KrsApprovalWorkspace v-if="canApproveKrs" />
  <div v-else class="page-stack">
    <AppPageHeader
      eyebrow="Perwalian & persetujuan KRS"
      title="Evaluasi Pengajuan KRS"
      description="Persetujuan KRS hanya tersedia untuk peran Dosen wali atau Staf akademik."
    />
    <section class="role-gate-box">
      <EmptyState
        icon="uil-file-check-alt"
        title="Beralih peran untuk mengevaluasi KRS"
        :description="switchableApprovalRole
          ? `Akun Anda memiliki peran ${switchableRoleLabel}. Beralih ke peran tersebut untuk meninjau dan menyetujui pengajuan KRS mahasiswa.`
          : 'Halaman ini khusus untuk Dosen wali atau Staf akademik dalam mengevaluasi pengajuan KRS mahasiswa.'"
      />
      <div class="role-gate-actions">
        <button v-if="switchableApprovalRole" class="btn btn-primary" type="button" @click="switchToApprovalRole">
          <i class="uil uil-exchange me-1" aria-hidden="true" />Beralih ke peran {{ switchableRoleLabel }}
        </button>
        <NuxtLink class="btn btn-outline-secondary" to="/akademik/krs">
          <i class="uil uil-clipboard-alt me-1" aria-hidden="true" />Kembali ke halaman KRS
        </NuxtLink>
      </div>
    </section>
  </div>
</template>

<style scoped src="~/pages/_workflow.css"></style>
<style scoped>
.role-gate-box{display:grid;gap:1rem;padding:1.25rem;border:1px solid #e6dfd6;border-radius:1rem;background:#fff}
.role-gate-actions{display:flex;justify-content:center;gap:.65rem;flex-wrap:wrap}
</style>
