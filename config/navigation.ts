export type NavigationItem = {
  label: string
  to: string
  icon: string
  permission?: string
  badge?: string
}

export type NavigationGroup = {
  label: string
  items: NavigationItem[]
}

export const navigation: NavigationGroup[] = [
  {
    label: 'Ruang kerja',
    items: [
      { label: 'Ikhtisar', to: '/', icon: 'uil-grid', permission: 'dashboard.read' },
      { label: 'Penerimaan', to: '/pmb', icon: 'uil-user-plus', permission: 'pmb.read', badge: '128' },
      { label: 'Administrasi akademik', to: '/akademik/administrasi', icon: 'uil-book-open', permission: 'academic.read' },
      { label: 'KRS', to: '/akademik/krs', icon: 'uil-clipboard-alt', permission: 'academic.read' },
      { label: 'Pelaksanaan kelas', to: '/akademik/kelas', icon: 'uil-presentation-check', permission: 'academic.read' },
      { label: 'Pembelajaran', to: '/pembelajaran', icon: 'uil-presentation-play', permission: 'learning.read' },
      { label: 'Keuangan', to: '/keuangan', icon: 'uil-receipt', permission: 'finance.read' },
      { label: 'Rekonsiliasi', to: '/keuangan/rekonsiliasi', icon: 'uil-exchange', permission: 'finance.write' },
      { label: 'PDDIKTI', to: '/pddikti', icon: 'uil-sync', permission: 'pddikti.read', badge: '12' },
    ],
  },
  {
    label: 'Layanan kampus',
    items: [
      { label: 'Kemahasiswaan', to: '/kemahasiswaan', icon: 'uil-award', permission: 'student_affairs.read' },
      { label: 'Evaluasi dosen', to: '/evaluasi', icon: 'uil-favorite', permission: 'evaluation.read' },
      { label: 'Kelulusan', to: '/kelulusan', icon: 'uil-graduation-cap', permission: 'graduation.read' },
      { label: 'Tracer study', to: '/tracer-study', icon: 'uil-chart-growth', permission: 'tracer.read' },
      { label: 'Tata usaha', to: '/layanan', icon: 'uil-file-check-alt', permission: 'service.read', badge: '8' },
    ],
  },
  {
    label: 'Sistem',
    items: [
      { label: 'Notifikasi', to: '/notifikasi', icon: 'uil-bell', permission: 'notification.read' },
      { label: 'Berkas', to: '/berkas', icon: 'uil-folder-open', permission: 'file.read' },
      { label: 'Impor data', to: '/impor', icon: 'uil-import', permission: 'academic.write' },
      { label: 'Pengguna & akses', to: '/pengguna', icon: 'uil-users-alt', permission: 'settings.read' },
      { label: 'Audit & backup', to: '/modul/audit-backup', icon: 'uil-shield-check', permission: 'audit.read' },
      { label: 'Pengaturan', to: '/modul/pengaturan', icon: 'uil-setting', permission: 'settings.read' },
    ],
  },
]

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
