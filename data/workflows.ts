import type { Tone } from './dashboard'

export interface WorkflowStat {
  label: string
  value: string
  detail: string
  trend?: string
  tone: Tone
}

export const pmbStats: WorkflowStat[] = [
  { label: 'Total pendaftar', value: '728', detail: 'Gelombang 1–3', trend: '+12,6% YoY', tone: 'primary' },
  { label: 'Menunggu verifikasi', value: '43', detail: 'Berkas masuk 7 hari terakhir', trend: '9 prioritas hari ini', tone: 'warning' },
  { label: 'Lulus seleksi', value: '406', detail: '55,8% dari pendaftar', trend: '318 sudah daftar ulang', tone: 'success' },
  { label: 'Penerimaan bersih', value: 'Rp 364 jt', detail: 'Formulir dan daftar ulang', trend: '94,2% terverifikasi', tone: 'info' },
]

export const pmbFunnel = [
  { label: 'Akun dibuat', value: 812, percent: 100 },
  { label: 'Formulir lengkap', value: 728, percent: 90 },
  { label: 'Pembayaran terverifikasi', value: 615, percent: 76 },
  { label: 'Berkas lolos', value: 542, percent: 67 },
  { label: 'Lulus seleksi', value: 406, percent: 50 },
  { label: 'Daftar ulang', value: 318, percent: 39 },
]

export const pmbApplicants = [
  { id: 'PMB-260728', name: 'Nadya Safitri', program: 'S1 Manajemen', path: 'Reguler', submitted: '21 Jul 2026, 09.42', completeness: '100%', status: 'Siap verifikasi' },
  { id: 'PMB-260727', name: 'Rizky Maulana', program: 'S1 Informatika', path: 'KIP Kuliah', submitted: '21 Jul 2026, 09.18', completeness: '86%', status: 'Berkas kurang' },
  { id: 'PMB-260726', name: 'Dinda Maharani', program: 'S1 Akuntansi', path: 'Reguler', submitted: '20 Jul 2026, 16.20', completeness: '100%', status: 'Terverifikasi' },
  { id: 'PMB-260725', name: 'Fajar Ramadhan', program: 'S1 Sistem Informasi', path: 'RPL', submitted: '20 Jul 2026, 14.05', completeness: '94%', status: 'Perlu tinjau' },
  { id: 'PMB-260724', name: 'Tasya Anindita', program: 'S1 Ilmu Komunikasi', path: 'Reguler', submitted: '20 Jul 2026, 11.37', completeness: '100%', status: 'Lulus seleksi' },
  { id: 'PMB-260723', name: 'Alif Pratama', program: 'S1 Informatika', path: 'Pindahan', submitted: '19 Jul 2026, 15.12', completeness: '78%', status: 'Berkas kurang' },
]

export const pmbWaves = [
  { wave: 'Gelombang 1', period: '2 Jan – 31 Mar 2026', applicants: 216, accepted: 132, status: 'Selesai' },
  { wave: 'Gelombang 2', period: '1 Apr – 30 Jun 2026', applicants: 354, accepted: 218, status: 'Selesai' },
  { wave: 'Gelombang 3', period: '1 Jul – 31 Agu 2026', applicants: 158, accepted: 56, status: 'Aktif' },
]

export const krsStats: WorkflowStat[] = [
  { label: 'SKS dipilih', value: '21 / 24', detail: 'Batas berdasarkan IPS 3,62', trend: '7 mata kuliah', tone: 'primary' },
  { label: 'Status KRS', value: 'Draf', detail: 'Belum diajukan ke dosen wali', trend: 'Batas 25 Jul 2026', tone: 'warning' },
  { label: 'Kapasitas kelas', value: 'Aman', detail: 'Semua kelas masih tersedia', trend: 'Terakhir dicek 10.15 WIB', tone: 'success' },
  { label: 'Status administrasi', value: 'Lolos', detail: 'Tidak ada pencekalan', trend: 'Keuangan dan akademik valid', tone: 'info' },
]

export const krsCourses = [
  { code: 'IF601', name: 'Rekayasa Perangkat Lunak', class: 'IF-6A', schedule: 'Senin, 08.00–10.30', lecturer: 'Dr. Rina Wulandari', credits: 3, capacity: '28 / 35', status: 'Terpilih' },
  { code: 'IF602', name: 'Keamanan Informasi', class: 'IF-6A', schedule: 'Selasa, 10.30–13.00', lecturer: 'Budi Santoso, M.Kom.', credits: 3, capacity: '31 / 35', status: 'Terpilih' },
  { code: 'IF603', name: 'Manajemen Proyek TI', class: 'IF-6B', schedule: 'Rabu, 13.00–15.30', lecturer: 'Dewi Lestari, M.T.', credits: 3, capacity: '24 / 35', status: 'Terpilih' },
  { code: 'IF604', name: 'Analisis Data', class: 'IF-6A', schedule: 'Kamis, 08.00–10.30', lecturer: 'Arif Nugroho, M.Cs.', credits: 3, capacity: '34 / 35', status: 'Terpilih' },
  { code: 'IF605', name: 'Etika Profesi', class: 'IF-6C', schedule: 'Jumat, 08.00–09.40', lecturer: 'Sari Puspita, M.Kom.', credits: 2, capacity: '20 / 40', status: 'Terpilih' },
  { code: 'UNI601', name: 'Kewirausahaan', class: 'UNI-6D', schedule: 'Sabtu, 09.00–11.30', lecturer: 'Hendra Gunawan, M.M.', credits: 3, capacity: '38 / 40', status: 'Terpilih' },
  { code: 'IF606', name: 'Proyek Perangkat Lunak', class: 'IF-6A', schedule: 'Sabtu, 13.00–16.20', lecturer: 'Tim Dosen Informatika', credits: 4, capacity: '29 / 35', status: 'Terpilih' },
  { code: 'IF607', name: 'Komputasi Awan', class: 'IF-6B', schedule: 'Rabu, 08.00–10.30', lecturer: 'Rahmat Hidayat, M.Kom.', credits: 3, capacity: '35 / 35', status: 'Kelas penuh' },
]

export const krsTimeline = [
  { label: 'Pengisian KRS', date: '15–25 Jul 2026', state: 'Berlangsung', detail: 'Mahasiswa memilih kelas dan mengajukan KRS.' },
  { label: 'Persetujuan dosen wali', date: '15–27 Jul 2026', state: 'Berlangsung', detail: 'Dosen wali meninjau beban dan rencana studi.' },
  { label: 'Perubahan KRS', date: '3–8 Agu 2026', state: 'Berikutnya', detail: 'Penyesuaian kelas setelah perkuliahan dimulai.' },
]

export const learningStats: WorkflowStat[] = [
  { label: 'Kelas aktif', value: '6', detail: 'Semester Genap 2025/2026', trend: '22 SKS terdaftar', tone: 'primary' },
  { label: 'Tugas berjalan', value: '4', detail: '2 tenggat dalam 7 hari', trend: '1 belum dikumpulkan', tone: 'warning' },
  { label: 'Kehadiran', value: '91,7%', detail: '66 dari 72 pertemuan', trend: '+2,4% dari semester lalu', tone: 'success' },
  { label: 'Materi baru', value: '9', detail: 'Ditambahkan minggu ini', trend: '3 belum dibaca', tone: 'info' },
]

export const learningClasses = [
  { code: 'IF601', name: 'Rekayasa Perangkat Lunak', lecturer: 'Dr. Rina Wulandari', progress: 83, next: 'Senin, 08.00', room: 'Lab 3', activity: 'Tugas sprint 3', status: 'Aktif' },
  { code: 'IF602', name: 'Keamanan Informasi', lecturer: 'Budi Santoso, M.Kom.', progress: 78, next: 'Selasa, 10.30', room: 'R. 401', activity: 'Kuis kontrol akses', status: 'Aktif' },
  { code: 'IF603', name: 'Manajemen Proyek TI', lecturer: 'Dewi Lestari, M.T.', progress: 86, next: 'Rabu, 13.00', room: 'R. 305', activity: 'Forum risiko proyek', status: 'Aktif' },
  { code: 'IF604', name: 'Analisis Data', lecturer: 'Arif Nugroho, M.Cs.', progress: 72, next: 'Kamis, 08.00', room: 'Lab 2', activity: 'Praktikum visualisasi', status: 'Materi baru' },
  { code: 'IF605', name: 'Etika Profesi', lecturer: 'Sari Puspita, M.Kom.', progress: 91, next: 'Jumat, 08.00', room: 'Daring', activity: 'Refleksi studi kasus', status: 'Aktif' },
  { code: 'UNI601', name: 'Kewirausahaan', lecturer: 'Hendra Gunawan, M.M.', progress: 80, next: 'Sabtu, 09.00', room: 'Aula B', activity: 'Pitch deck kelompok', status: 'Tugas baru' },
]

export const assignments = [
  { id: 'TSK-114', title: 'Sprint review dan retrospektif', course: 'Rekayasa Perangkat Lunak', due: '23 Jul 2026, 23.59', weight: '15%', submission: 'Belum dikumpulkan', status: '2 hari lagi' },
  { id: 'TSK-113', title: 'Analisis kontrol akses', course: 'Keamanan Informasi', due: '26 Jul 2026, 23.59', weight: '10%', submission: 'Draf tersimpan', status: '5 hari lagi' },
  { id: 'TSK-110', title: 'Register risiko proyek', course: 'Manajemen Proyek TI', due: '29 Jul 2026, 20.00', weight: '10%', submission: 'Belum dimulai', status: '8 hari lagi' },
  { id: 'TSK-108', title: 'Notebook eksplorasi data', course: 'Analisis Data', due: '2 Agu 2026, 23.59', weight: '20%', submission: 'Sudah dikumpulkan', status: 'Terkirim' },
]

export const financeStats: WorkflowStat[] = [
  { label: 'Total tagihan', value: 'Rp 12,45 jt', detail: 'Semester Genap 2025/2026', trend: '4 komponen tagihan', tone: 'primary' },
  { label: 'Sudah dibayar', value: 'Rp 8,30 jt', detail: '66,7% dari total tagihan', trend: 'Terakhir 18 Jul 2026', tone: 'success' },
  { label: 'Sisa tagihan', value: 'Rp 4,15 jt', detail: 'Jatuh tempo 31 Jul 2026', trend: 'Cicilan 2 dari 3', tone: 'warning' },
  { label: 'Potongan', value: 'Rp 1,25 jt', detail: 'Beasiswa prestasi akademik', trend: 'Sudah diterapkan', tone: 'info' },
]

export const bills = [
  { id: 'INV-2026-07182', item: 'UKT Semester Genap', period: '2025/2026 Genap', amount: 'Rp 7.500.000', paid: 'Rp 5.000.000', due: '31 Jul 2026', status: 'Cicilan berjalan' },
  { id: 'INV-2026-07191', item: 'Praktikum Laboratorium', period: '2025/2026 Genap', amount: 'Rp 1.250.000', paid: 'Rp 1.250.000', due: '15 Jul 2026', status: 'Lunas' },
  { id: 'INV-2026-07203', item: 'Sertifikasi Kompetensi', period: '2025/2026 Genap', amount: 'Rp 2.500.000', paid: 'Rp 1.000.000', due: '10 Agu 2026', status: 'Sebagian' },
  { id: 'INV-2026-07217', item: 'Kegiatan Kemahasiswaan', period: '2025/2026 Genap', amount: 'Rp 1.200.000', paid: 'Rp 1.050.000', due: '31 Jul 2026', status: 'Sebagian' },
]

export const transactions = [
  { id: 'TRX-260718-4821', date: '18 Jul 2026, 14.32', channel: 'Virtual Account BNI', reference: '9882102607184821', amount: 'Rp 2.500.000', status: 'Berhasil' },
  { id: 'TRX-260712-4196', date: '12 Jul 2026, 09.05', channel: 'QRIS', reference: 'QR26071209054196', amount: 'Rp 1.250.000', status: 'Berhasil' },
  { id: 'TRX-260701-3610', date: '1 Jul 2026, 11.48', channel: 'Virtual Account Mandiri', reference: '8962202607013610', amount: 'Rp 3.500.000', status: 'Berhasil' },
  { id: 'TRX-260628-3424', date: '28 Jun 2026, 16.22', channel: 'Transfer bank', reference: 'MANUAL-0628-3424', amount: 'Rp 1.050.000', status: 'Terverifikasi' },
]

export const pddiktiStats: WorkflowStat[] = [
  { label: 'Kelengkapan data', value: '96,8%', detail: '31 dari 982 record bermasalah', trend: '+1,9% minggu ini', tone: 'primary' },
  { label: 'Siap sinkron', value: '951', detail: 'Record lolos validasi', trend: '8 entitas data', tone: 'success' },
  { label: 'Perlu perbaikan', value: '31', detail: '18 error, 13 peringatan', trend: 'Tertinggi pada nilai kelas', tone: 'warning' },
  { label: 'Sinkron terakhir', value: '20 Jul', detail: 'Pukul 22.14 WIB', trend: '948 record berhasil', tone: 'info' },
]

export const pddiktiEntities = [
  { entity: 'Mahasiswa', internal: 1842, feeder: 1842, valid: 1840, errors: 2, completeness: '99,9%', status: 'Hampir lengkap' },
  { entity: 'Dosen', internal: 126, feeder: 126, valid: 126, errors: 0, completeness: '100%', status: 'Siap sinkron' },
  { entity: 'Mata kuliah', internal: 248, feeder: 248, valid: 248, errors: 0, completeness: '100%', status: 'Siap sinkron' },
  { entity: 'Kelas kuliah', internal: 186, feeder: 181, valid: 179, errors: 7, completeness: '96,2%', status: 'Perlu perbaikan' },
  { entity: 'Peserta kelas', internal: 4286, feeder: 4262, valid: 4275, errors: 11, completeness: '99,7%', status: 'Perlu perbaikan' },
  { entity: 'Nilai kelas', internal: 4286, feeder: 4221, valid: 4275, errors: 11, completeness: '98,5%', status: 'Perlu perbaikan' },
]

export const syncHistory = [
  { id: 'SYNC-260720-2214', started: '20 Jul 2026, 22.14', scope: 'Perubahan sejak sinkron terakhir', sent: 951, success: 948, failed: 3, duration: '4m 18d', status: 'Selesai dengan catatan' },
  { id: 'SYNC-260718-2200', started: '18 Jul 2026, 22.00', scope: 'Mahasiswa, KRS, kelas', sent: 426, success: 426, failed: 0, duration: '2m 41d', status: 'Berhasil' },
  { id: 'SYNC-260715-2145', started: '15 Jul 2026, 21.45', scope: 'Nilai dan aktivitas kuliah', sent: 684, success: 677, failed: 7, duration: '5m 02d', status: 'Selesai dengan catatan' },
  { id: 'SYNC-260710-2205', started: '10 Jul 2026, 22.05', scope: 'Sinkronisasi penuh', sent: 5924, success: 5924, failed: 0, duration: '18m 36d', status: 'Berhasil' },
]
