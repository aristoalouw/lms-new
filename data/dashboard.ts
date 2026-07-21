export type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'

export interface DashboardStat {
  label: string
  value: string
  detail: string
  trend: string
  tone: Tone
}

export const dashboardStats: DashboardStat[] = [
  {
    label: 'Mahasiswa aktif',
    value: '1.842',
    detail: 'Semester Genap 2025/2026',
    trend: '+4,8% dari semester lalu',
    tone: 'primary',
  },
  {
    label: 'Realisasi perkuliahan',
    value: '87,4%',
    detail: '2.146 dari 2.456 pertemuan',
    trend: 'Sesuai target minggu ke-12',
    tone: 'success',
  },
  {
    label: 'Tagihan tertagih',
    value: 'Rp 4,82 M',
    detail: '92,1% dari total semester',
    trend: 'Rp 414 jt masih berjalan',
    tone: 'info',
  },
  {
    label: 'Kelengkapan PDDIKTI',
    value: '96,8%',
    detail: '31 data perlu validasi',
    trend: 'Batas sinkronisasi 30 Jul 2026',
    tone: 'warning',
  },
]

export const unitPerformance = [
  { program: 'S1 Manajemen', students: 512, attendance: 91, reporting: 98, finance: 94 },
  { program: 'S1 Akuntansi', students: 386, attendance: 89, reporting: 97, finance: 93 },
  { program: 'S1 Informatika', students: 448, attendance: 87, reporting: 95, finance: 91 },
  { program: 'S1 Sistem Informasi', students: 312, attendance: 85, reporting: 94, finance: 90 },
  { program: 'S1 Ilmu Komunikasi', students: 184, attendance: 88, reporting: 96, finance: 92 },
]

export const dashboardAttention = [
  {
    id: 'ALT-026',
    category: 'PDDIKTI',
    issue: 'Nilai kelas belum lengkap',
    unit: 'S1 Informatika',
    owner: 'Biro Akademik',
    due: '24 Jul 2026',
    status: 'Perlu tindakan',
  },
  {
    id: 'ALT-025',
    category: 'Keuangan',
    issue: 'Rekonsiliasi kanal VA tertunda',
    unit: 'Semua program studi',
    owner: 'Biro Keuangan',
    due: '22 Jul 2026',
    status: 'Hari ini',
  },
  {
    id: 'ALT-024',
    category: 'Pembelajaran',
    issue: '12 jurnal mengajar belum diisi',
    unit: 'Fakultas Ekonomi',
    owner: 'Kaprodi',
    due: '25 Jul 2026',
    status: 'Dipantau',
  },
  {
    id: 'ALT-023',
    category: 'PMB',
    issue: '43 berkas menunggu verifikasi',
    unit: 'Gelombang 3',
    owner: 'Panitia PMB',
    due: '23 Jul 2026',
    status: 'Perlu tindakan',
  },
]

export const todayAgenda = [
  { time: '08.30', title: 'Rapat evaluasi pelaporan semester', location: 'Ruang Senat', type: 'Rapat' },
  { time: '10.00', title: 'Batas persetujuan perubahan KRS', location: 'Sistem akademik', type: 'Akademik' },
  { time: '13.30', title: 'Verifikasi penerima beasiswa internal', location: 'Biro Kemahasiswaan', type: 'Layanan' },
  { time: '15.00', title: 'Rekonsiliasi pembayaran harian', location: 'Daring', type: 'Keuangan' },
]

export const enrollmentFunnel = [
  { label: 'Pendaftar', value: 728, percent: 100 },
  { label: 'Pembayaran formulir', value: 615, percent: 84 },
  { label: 'Berkas terverifikasi', value: 542, percent: 74 },
  { label: 'Lulus seleksi', value: 406, percent: 56 },
  { label: 'Daftar ulang', value: 318, percent: 44 },
]

export const quickActions = [
  { label: 'Validasi KRS', description: '18 pengajuan menunggu', to: '/akademik/krs', tone: 'primary' },
  { label: 'Verifikasi PMB', description: '43 berkas baru', to: '/pmb', tone: 'info' },
  { label: 'Rekonsiliasi', description: '12 transaksi belum cocok', to: '/keuangan', tone: 'success' },
  { label: 'Sinkronisasi', description: '31 data perlu validasi', to: '/pddikti', tone: 'warning' },
]
