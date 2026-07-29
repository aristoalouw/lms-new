import type { Feature } from '~/shared/features'

export type NavigationItem = {
  label: string
  to: string
  icon: string
  permission?: string
  badge?: string
  feature: Feature
}

export type NavigationGroup = {
  label: string
  items: NavigationItem[]
}

export type NavigationCommand = NavigationItem & {
  context: string
}

export const navigation: NavigationGroup[] = [
  {
    label: 'Ruang kerja',
    items: [
      { label: 'Ikhtisar', to: '/', icon: 'uil-grid', permission: 'dashboard.read', feature: 'dashboard' },
      { label: 'Kelas & enrolment', to: '/admin/kelas', icon: 'uil-presentation-check', permission: 'classes:manage', feature: 'classes' },
      { label: 'Penerimaan', to: '/pmb', icon: 'uil-user-plus', permission: 'pmb.read', feature: 'admissions' },
      { label: 'Administrasi akademik', to: '/akademik/administrasi', icon: 'uil-book-open', permission: 'academic.read', feature: 'academic-admin' },
      { label: 'KRS', to: '/akademik/krs', icon: 'uil-clipboard-alt', permission: 'academic.read', feature: 'krs' },
      { label: 'Pelaksanaan kelas', to: '/akademik/kelas', icon: 'uil-presentation-check', permission: 'academic.read', feature: 'academic-admin' },
      { label: 'Pembelajaran', to: '/pembelajaran', icon: 'uil-presentation-play', permission: 'learning.read', feature: 'learning' },
      { label: 'Keuangan', to: '/keuangan', icon: 'uil-receipt', permission: 'finance.read', feature: 'finance' },
      { label: 'Rekonsiliasi', to: '/keuangan/rekonsiliasi', icon: 'uil-exchange', permission: 'finance.write', feature: 'finance' },
      { label: 'PDDIKTI', to: '/pddikti', icon: 'uil-sync', permission: 'pddikti.read', feature: 'pddikti' },
    ],
  },
  {
    label: 'Layanan kampus',
    items: [
      { label: 'Kemahasiswaan', to: '/kemahasiswaan', icon: 'uil-award', permission: 'student_affairs.read', feature: 'student-affairs' },
      { label: 'Evaluasi dosen', to: '/evaluasi', icon: 'uil-favorite', permission: 'evaluation.read', feature: 'evaluation' },
      { label: 'Kelulusan', to: '/kelulusan', icon: 'uil-graduation-cap', permission: 'graduation.read', feature: 'graduation' },
      { label: 'Tracer study', to: '/tracer-study', icon: 'uil-chart-growth', permission: 'tracer.read', feature: 'tracer-study' },
      { label: 'Tata usaha', to: '/layanan', icon: 'uil-file-check-alt', permission: 'service.read', feature: 'services' },
    ],
  },
  {
    label: 'Sistem',
    items: [
      { label: 'Notifikasi', to: '/notifikasi', icon: 'uil-bell', permission: 'notification.read', feature: 'notifications' },
      { label: 'Berkas', to: '/berkas', icon: 'uil-folder-open', permission: 'file.read', feature: 'files' },
      { label: 'Impor data', to: '/impor', icon: 'uil-import', permission: 'academic.write', feature: 'imports' },
      { label: 'Pengguna & akses', to: '/admin/pengguna', icon: 'uil-users-alt', permission: 'accounts:manage', feature: 'accounts' },
      { label: 'Audit & backup', to: '/modul/audit-backup', icon: 'uil-shield-check', permission: 'audit.read', feature: 'audit' },
      { label: 'Pengaturan', to: '/modul/pengaturan', icon: 'uil-setting', permission: 'settings.read', feature: 'accounts' },
    ],
  },
]

export function navigationCommandsForAccess(
  featureEnabled: (feature: Feature) => boolean,
  permissionAllowed: (permission?: string) => boolean,
  pageAllowed: (path: string) => boolean = () => true,
): NavigationCommand[] {
  return navigation.flatMap(group => group.items
    .filter(item => featureEnabled(item.feature) && pageAllowed(item.to) && permissionAllowed(item.permission))
    .map(item => ({ ...item, context: group.label })))
}

export const roleLabels: Record<string, string> = {
  administrator: 'Administrator sistem',
  leader: 'Pimpinan perguruan tinggi',
  academic_staff: 'Staf akademik',
  finance_staff: 'Staf keuangan',
  admissions_staff: 'Panitia PMB',
  student_affairs_staff: 'Staf kemahasiswaan',
  applicant: 'Pendaftar',
  lecturer: 'Dosen',
  advisor: 'Dosen wali',
  student: 'Mahasiswa',
  guardian: 'Orang tua / wali',
}
