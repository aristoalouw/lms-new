import type { Tone } from './dashboard'

export interface ModuleStat {
  label: string
  value: string
  detail: string
  trend: string
  tone: Tone
}

export interface ModuleColumn {
  key: string
  label: string
}

export interface ModuleConfig {
  slug: string
  eyebrow: string
  title: string
  description: string
  primaryAction: string
  secondaryAction: string
  periodLabel: string
  stats: ModuleStat[]
  alert: { title: string; description: string; status: string; tone: Tone }
  columns: ModuleColumn[]
  rows: Record<string, string | number>[]
  emptyTitle: string
  emptyDescription: string
  insights: { label: string; value: string; detail: string; tone: Tone }[]
  checklist: { label: string; detail: string; status: string }[]
}

export const moduleCatalog: Record<string, ModuleConfig> = {
  kemahasiswaan: {
    slug: 'kemahasiswaan',
    eyebrow: 'Layanan mahasiswa',
    title: 'Kemahasiswaan',
    description: 'Kelola prestasi, poin kegiatan, beasiswa, pelanggaran, dan layanan dokumen mahasiswa dalam satu antrean kerja.',
    primaryAction: 'Tambah aktivitas',
    secondaryAction: 'Ekspor rekap',
    periodLabel: 'Semester Genap 2025/2026',
    stats: [
      { label: 'Aktivitas aktif', value: '28', detail: 'UKM dan kegiatan kampus', trend: '6 kegiatan bulan ini', tone: 'primary' },
      { label: 'Prestasi tercatat', value: '146', detail: 'Tahun akademik berjalan', trend: '+18 dari semester lalu', tone: 'success' },
      { label: 'Pengajuan beasiswa', value: '37', detail: '12 menunggu verifikasi', trend: 'Batas 30 Jul 2026', tone: 'warning' },
      { label: 'Surat aktif', value: '24', detail: 'Permintaan 7 hari terakhir', trend: 'Rata-rata 1,4 hari', tone: 'info' },
    ],
    alert: { title: 'Verifikasi beasiswa prioritas', description: 'Lima pengajuan beasiswa memerlukan keputusan sebelum batas pencairan 24 Juli 2026.', status: 'Perlu tindakan', tone: 'warning' },
    columns: [
      { key: 'id', label: 'Nomor' }, { key: 'student', label: 'Mahasiswa' }, { key: 'service', label: 'Jenis layanan' },
      { key: 'submitted', label: 'Diajukan' }, { key: 'owner', label: 'Penanggung jawab' }, { key: 'status', label: 'Status' },
    ],
    rows: [
      { id: 'KMH-260721-084', student: 'Salma Azzahra · 231011024', service: 'Beasiswa prestasi', submitted: '21 Jul 2026', owner: 'R. Hartono', status: 'Verifikasi' },
      { id: 'KMH-260720-083', student: 'Bagas Prakoso · 231031017', service: 'Surat mahasiswa aktif', submitted: '20 Jul 2026', owner: 'Nita Sari', status: 'Siap diterbitkan' },
      { id: 'KMH-260720-082', student: 'Rafi Alamsyah · 221021038', service: 'Validasi prestasi nasional', submitted: '20 Jul 2026', owner: 'R. Hartono', status: 'Dokumen kurang' },
      { id: 'KMH-260719-081', student: 'Intan Permata · 241041006', service: 'Poin kegiatan UKM', submitted: '19 Jul 2026', owner: 'Nita Sari', status: 'Selesai' },
      { id: 'KMH-260718-080', student: 'Dimas Saputra · 221011052', service: 'Beasiswa internal', submitted: '18 Jul 2026', owner: 'R. Hartono', status: 'Ditinjau' },
    ],
    emptyTitle: 'Belum ada layanan mahasiswa',
    emptyDescription: 'Pengajuan mahasiswa akan muncul di sini setelah diterima sistem.',
    insights: [
      { label: 'SLA terpenuhi', value: '94%', detail: 'Target layanan ≤ 3 hari', tone: 'success' },
      { label: 'Poin rata-rata', value: '42', detail: 'Dari target kelulusan 60 poin', tone: 'primary' },
      { label: 'Dokumen tertunda', value: '8', detail: 'Memerlukan unggahan mahasiswa', tone: 'warning' },
    ],
    checklist: [
      { label: 'Validasi penerima beasiswa', detail: '12 pengajuan', status: 'Hari ini' },
      { label: 'Terbitkan surat aktif', detail: '7 dokumen siap', status: 'Diproses' },
      { label: 'Rekap poin kemahasiswaan', detail: 'Angkatan 2022', status: 'Terjadwal' },
    ],
  },
  'evaluasi-dosen': {
    slug: 'evaluasi-dosen',
    eyebrow: 'Mutu pembelajaran',
    title: 'Evaluasi Dosen',
    description: 'Pantau periode evaluasi, tingkat respons, dan rekap hasil secara agregat dengan menjaga kerahasiaan responden.',
    primaryAction: 'Buat periode evaluasi',
    secondaryAction: 'Ekspor rekap',
    periodLabel: 'Evaluasi Genap 2025/2026',
    stats: [
      { label: 'Tingkat respons', value: '78,6%', detail: '3.369 dari 4.286 peserta', trend: '+6,2% dalam 7 hari', tone: 'primary' },
      { label: 'Kelas dievaluasi', value: '174 / 186', detail: '12 kelas belum memenuhi batas', trend: 'Target minimal 60%', tone: 'success' },
      { label: 'Periode tersisa', value: '9 hari', detail: 'Berakhir 30 Jul 2026', trend: 'Reminder berikutnya 24 Jul', tone: 'warning' },
      { label: 'Skor institusi', value: '4,42', detail: 'Skala 1–5', trend: '+0,08 dari semester lalu', tone: 'info' },
    ],
    alert: { title: 'Respons rendah pada 12 kelas', description: 'Kirim pengingat tanpa menampilkan identitas responden kepada dosen atau pengelola kelas.', status: 'Pantau', tone: 'warning' },
    columns: [
      { key: 'course', label: 'Mata kuliah / kelas' }, { key: 'lecturer', label: 'Dosen' }, { key: 'respondents', label: 'Respons' },
      { key: 'score', label: 'Skor agregat' }, { key: 'period', label: 'Periode' }, { key: 'status', label: 'Status' },
    ],
    rows: [
      { course: 'IF601 · IF-6A', lecturer: 'Dr. Rina Wulandari', respondents: '31 / 35', score: '4,71', period: 'Genap 2025/2026', status: 'Memenuhi' },
      { course: 'AK402 · AK-4B', lecturer: 'Agus Setiawan, M.Ak.', respondents: '26 / 32', score: '4,38', period: 'Genap 2025/2026', status: 'Memenuhi' },
      { course: 'MN204 · MN-2C', lecturer: 'Maya Putri, M.M.', respondents: '18 / 38', score: '—', period: 'Genap 2025/2026', status: 'Respons rendah' },
      { course: 'SI604 · SI-6A', lecturer: 'Andri Firmansyah, M.Kom.', respondents: '29 / 34', score: '4,55', period: 'Genap 2025/2026', status: 'Memenuhi' },
      { course: 'IK302 · IK-3A', lecturer: 'Fitri Handayani, M.I.Kom.', respondents: '21 / 36', score: '—', period: 'Genap 2025/2026', status: 'Perlu reminder' },
    ],
    emptyTitle: 'Belum ada hasil evaluasi',
    emptyDescription: 'Rekap agregat akan tersedia setelah ambang minimum respons terpenuhi.',
    insights: [
      { label: 'Kualitas pengajaran', value: '4,51', detail: 'Indikator tertinggi', tone: 'success' },
      { label: 'Ketepatan waktu', value: '4,23', detail: 'Perlu penguatan', tone: 'warning' },
      { label: 'Komentar valid', value: '1.284', detail: 'Sudah dimoderasi', tone: 'primary' },
    ],
    checklist: [
      { label: 'Kirim reminder mahasiswa', detail: '917 belum mengisi', status: '24 Jul' },
      { label: 'Tinjau ambang anonimitas', detail: '12 kelas', status: 'Berjalan' },
      { label: 'Siapkan laporan pimpinan', detail: 'Setelah periode tutup', status: 'Terjadwal' },
    ],
  },
  'kelulusan-yudisium': {
    slug: 'kelulusan-yudisium',
    eyebrow: 'Penyelesaian studi',
    title: 'Kelulusan & Yudisium',
    description: 'Periksa kelayakan yudisium, pencekalan lintas unit, serta penerbitan dokumen kelulusan dengan riwayat yang jelas.',
    primaryAction: 'Buka periode yudisium',
    secondaryAction: 'Unduh daftar peserta',
    periodLabel: 'Yudisium Agustus 2026',
    stats: [
      { label: 'Calon peserta', value: '126', detail: '5 program studi', trend: '98 mengajukan', tone: 'primary' },
      { label: 'Lolos verifikasi', value: '82', detail: '83,7% dari pengajuan', trend: '16 masih ditinjau', tone: 'success' },
      { label: 'Terkena cekal', value: '11', detail: 'Akademik, keuangan, pustaka', trend: '7 dapat ditindaklanjuti', tone: 'warning' },
      { label: 'Dokumen siap', value: '74', detail: 'SKPI dan transkrip final', trend: 'Nomor ijazah belum diterbitkan', tone: 'info' },
    ],
    alert: { title: 'Batas verifikasi lintas unit 28 Juli', description: 'Sebelas mahasiswa masih memiliki pencekalan yang harus ditutup atau diberi keputusan resmi.', status: '7 hari lagi', tone: 'warning' },
    columns: [
      { key: 'student', label: 'Mahasiswa' }, { key: 'program', label: 'Program studi' }, { key: 'gpa', label: 'IPK / SKS' },
      { key: 'clearance', label: 'Bebas tanggungan' }, { key: 'document', label: 'Dokumen' }, { key: 'status', label: 'Kelayakan' },
    ],
    rows: [
      { student: 'Alma Salsabila · 221031012', program: 'S1 Informatika', gpa: '3,76 / 146', clearance: 'Lengkap', document: 'Terverifikasi', status: 'Layak' },
      { student: 'Rangga Pradipta · 221011033', program: 'S1 Manajemen', gpa: '3,52 / 144', clearance: 'Keuangan', document: 'Terverifikasi', status: 'Dicekal' },
      { student: 'Tiara Maharani · 221021019', program: 'S1 Akuntansi', gpa: '3,81 / 145', clearance: 'Lengkap', document: 'Perlu revisi', status: 'Ditinjau' },
      { student: 'Kevin Mahendra · 221041008', program: 'S1 Sistem Informasi', gpa: '3,43 / 146', clearance: 'Perpustakaan', document: 'Terverifikasi', status: 'Dicekal' },
      { student: 'Fina Aulia · 221051014', program: 'S1 Ilmu Komunikasi', gpa: '3,68 / 144', clearance: 'Lengkap', document: 'Terverifikasi', status: 'Layak' },
    ],
    emptyTitle: 'Belum ada peserta yudisium',
    emptyDescription: 'Calon peserta akan muncul setelah periode yudisium dibuka.',
    insights: [
      { label: 'Rata-rata IPK', value: '3,58', detail: '98 pengajuan', tone: 'success' },
      { label: 'Masa studi', value: '4,1 th', detail: 'Rata-rata kohort', tone: 'primary' },
      { label: 'Revisi dokumen', value: '9', detail: 'Mayoritas pada SKPI', tone: 'warning' },
    ],
    checklist: [
      { label: 'Tutup pencekalan keuangan', detail: '5 mahasiswa', status: 'Berjalan' },
      { label: 'Validasi data PDDIKTI', detail: '11 mahasiswa', status: 'Prioritas' },
      { label: 'Ajukan nomor ijazah', detail: 'Setelah SK yudisium', status: 'Terjadwal' },
    ],
  },
  'tracer-study': {
    slug: 'tracer-study',
    eyebrow: 'Outcome lulusan',
    title: 'Tracer Study',
    description: 'Kelola distribusi kuesioner, pantau respons alumni, dan rangkum outcome pekerjaan secara deskriptif.',
    primaryAction: 'Buat kampanye',
    secondaryAction: 'Ekspor respons',
    periodLabel: 'Tracer Study 2026',
    stats: [
      { label: 'Target alumni', value: '684', detail: 'Lulusan 2024–2025', trend: '5 program studi', tone: 'primary' },
      { label: 'Respons masuk', value: '426', detail: '62,3% dari target', trend: '+47 minggu ini', tone: 'success' },
      { label: 'Bekerja', value: '78,4%', detail: 'Dari respons valid', trend: 'Median tunggu 3,2 bulan', tone: 'info' },
      { label: 'Perlu reminder', value: '258', detail: 'Belum mengisi lengkap', trend: 'Jadwal 24 Jul 2026', tone: 'warning' },
    ],
    alert: { title: 'Kampanye reminder dijadwalkan', description: 'Pengingat hanya dikirim kepada alumni yang belum menyelesaikan kuesioner dan masih memberi persetujuan komunikasi.', status: '24 Jul 2026', tone: 'info' },
    columns: [
      { key: 'cohort', label: 'Kohort / prodi' }, { key: 'target', label: 'Target' }, { key: 'responses', label: 'Respons' },
      { key: 'rate', label: 'Tingkat respons' }, { key: 'employed', label: 'Bekerja' }, { key: 'status', label: 'Status' },
    ],
    rows: [
      { cohort: '2024 · S1 Manajemen', target: 142, responses: 101, rate: '71,1%', employed: '82,2%', status: 'Di atas target' },
      { cohort: '2024 · S1 Akuntansi', target: 106, responses: 72, rate: '67,9%', employed: '79,2%', status: 'Di atas target' },
      { cohort: '2024 · S1 Informatika', target: 128, responses: 84, rate: '65,6%', employed: '84,5%', status: 'Di atas target' },
      { cohort: '2025 · S1 Sistem Informasi', target: 137, responses: 78, rate: '56,9%', employed: '75,6%', status: 'Perlu reminder' },
      { cohort: '2025 · S1 Ilmu Komunikasi', target: 171, responses: 91, rate: '53,2%', employed: '70,3%', status: 'Perlu reminder' },
    ],
    emptyTitle: 'Belum ada respons tracer study',
    emptyDescription: 'Respons alumni akan tampil setelah kampanye kuesioner dikirim.',
    insights: [
      { label: 'Median masa tunggu', value: '3,2 bln', detail: 'Dari lulus ke pekerjaan', tone: 'success' },
      { label: 'Selaras bidang studi', value: '72,8%', detail: 'Jawaban alumni bekerja', tone: 'primary' },
      { label: 'Wirausaha', value: '8,7%', detail: 'Dari respons valid', tone: 'info' },
    ],
    checklist: [
      { label: 'Validasi alamat email', detail: '31 email memantul', status: 'Perlu tindakan' },
      { label: 'Kirim reminder kedua', detail: '258 alumni', status: '24 Jul' },
      { label: 'Tutup kampanye', detail: 'Batas 15 Agu', status: 'Terjadwal' },
    ],
  },
  'tata-usaha-layanan': {
    slug: 'tata-usaha-layanan',
    eyebrow: 'Pusat layanan kampus',
    title: 'Tata Usaha & Layanan',
    description: 'Kelola tiket, permintaan dokumen, dan layanan administrasi dengan SLA serta jejak status yang mudah dipantau.',
    primaryAction: 'Buat tiket layanan',
    secondaryAction: 'Kelola template',
    periodLabel: 'Antrean aktif',
    stats: [
      { label: 'Tiket terbuka', value: '42', detail: '18 masuk hari ini', trend: '7 prioritas tinggi', tone: 'primary' },
      { label: 'Selesai minggu ini', value: '86', detail: 'Naik 14% dari minggu lalu', trend: 'SLA terpenuhi 93%', tone: 'success' },
      { label: 'Mendekati SLA', value: '9', detail: 'Jatuh tempo < 8 jam', trend: '3 belum ditugaskan', tone: 'warning' },
      { label: 'Waktu respons', value: '38 mnt', detail: 'Median respons pertama', trend: 'Target ≤ 60 menit', tone: 'info' },
    ],
    alert: { title: 'Tiga tiket belum memiliki petugas', description: 'Tetapkan penanggung jawab agar waktu respons pertama tetap berada dalam target layanan.', status: 'Perlu tindakan', tone: 'warning' },
    columns: [
      { key: 'id', label: 'Nomor tiket' }, { key: 'requester', label: 'Pemohon' }, { key: 'category', label: 'Kategori' },
      { key: 'updated', label: 'Pembaruan' }, { key: 'assignee', label: 'Petugas' }, { key: 'status', label: 'Status' },
    ],
    rows: [
      { id: 'LKN-260721-184', requester: 'Gita Larasati · Mahasiswa', category: 'Legalisir transkrip', updated: '8 menit lalu', assignee: 'A. Prabowo', status: 'Diproses' },
      { id: 'LKN-260721-183', requester: 'Dr. Yudi Hartono · Dosen', category: 'Permintaan data kelas', updated: '21 menit lalu', assignee: 'Belum ditugaskan', status: 'Baru' },
      { id: 'LKN-260721-182', requester: 'Fikri Akbar · Mahasiswa', category: 'Perubahan data diri', updated: '34 menit lalu', assignee: 'M. Siregar', status: 'Menunggu dokumen' },
      { id: 'LKN-260721-179', requester: 'Rika Amelia · Alumni', category: 'Surat keterangan lulus', updated: '1 jam lalu', assignee: 'A. Prabowo', status: 'Siap diambil' },
      { id: 'LKN-260720-176', requester: 'Nadia Putri · Orang tua', category: 'Konfirmasi pembayaran', updated: 'Kemarin, 15.20', assignee: 'D. Rahma', status: 'Dijawab' },
    ],
    emptyTitle: 'Antrean layanan kosong',
    emptyDescription: 'Tiket dan permintaan administrasi baru akan muncul di sini.',
    insights: [
      { label: 'SLA layanan', value: '93%', detail: 'Target institusi 90%', tone: 'success' },
      { label: 'Kepuasan', value: '4,6 / 5', detail: '126 penilaian bulan ini', tone: 'primary' },
      { label: 'Tiket kembali', value: '4,1%', detail: 'Perlu penyelesaian ulang', tone: 'warning' },
    ],
    checklist: [
      { label: 'Tetapkan petugas', detail: '3 tiket baru', status: 'Sekarang' },
      { label: 'Tinjau tiket mendekati SLA', detail: '9 tiket', status: 'Hari ini' },
      { label: 'Perbarui template legalisir', detail: 'Versi 2026', status: 'Draf' },
    ],
  },
  notifikasi: {
    slug: 'notifikasi',
    eyebrow: 'Komunikasi terkelola',
    title: 'Notifikasi',
    description: 'Kelola template dan riwayat pengiriman notifikasi aplikasi serta email untuk proses akademik dan administratif.',
    primaryAction: 'Buat notifikasi',
    secondaryAction: 'Kelola template',
    periodLabel: '30 hari terakhir',
    stats: [
      { label: 'Terkirim', value: '12.486', detail: 'Aplikasi dan email', trend: '99,2% berhasil', tone: 'primary' },
      { label: 'Dibaca', value: '84,7%', detail: 'Notifikasi dalam aplikasi', trend: '+3,1% bulan ini', tone: 'success' },
      { label: 'Antrean', value: '1.284', detail: 'Mayoritas reminder KRS', trend: 'Kirim 24 Jul, 08.00', tone: 'info' },
      { label: 'Gagal', value: '37', detail: '0,3% dari pengiriman', trend: '31 alamat email tidak valid', tone: 'warning' },
    ],
    alert: { title: 'Periksa 31 alamat email tidak valid', description: 'Pengiriman gagal tidak akan dicoba ulang sebelum alamat diperbarui untuk mencegah antrean berulang.', status: 'Perlu tindakan', tone: 'warning' },
    columns: [
      { key: 'campaign', label: 'Notifikasi' }, { key: 'channel', label: 'Kanal' }, { key: 'audience', label: 'Penerima' },
      { key: 'scheduled', label: 'Jadwal' }, { key: 'delivery', label: 'Terkirim' }, { key: 'status', label: 'Status' },
    ],
    rows: [
      { campaign: 'Pengingat batas KRS', channel: 'Aplikasi + email', audience: '1.284 mahasiswa', scheduled: '24 Jul 2026, 08.00', delivery: '—', status: 'Terjadwal' },
      { campaign: 'Tagihan jatuh tempo Juli', channel: 'Aplikasi + email', audience: '416 mahasiswa', scheduled: '20 Jul 2026, 08.00', delivery: '413 / 416', status: 'Selesai dengan catatan' },
      { campaign: 'Materi pembelajaran baru', channel: 'Aplikasi', audience: '228 mahasiswa', scheduled: '19 Jul 2026, 16.30', delivery: '228 / 228', status: 'Terkirim' },
      { campaign: 'Verifikasi berkas PMB', channel: 'Email', audience: '64 pendaftar', scheduled: '18 Jul 2026, 09.00', delivery: '62 / 64', status: 'Selesai dengan catatan' },
      { campaign: 'Jadwal evaluasi dosen', channel: 'Aplikasi + email', audience: '1.842 mahasiswa', scheduled: '15 Jul 2026, 07.30', delivery: '1.836 / 1.842', status: 'Terkirim' },
    ],
    emptyTitle: 'Belum ada riwayat notifikasi',
    emptyDescription: 'Pengiriman notifikasi dan statusnya akan muncul di sini.',
    insights: [
      { label: 'Pengiriman berhasil', value: '99,2%', detail: 'Semua kanal', tone: 'success' },
      { label: 'Waktu baca median', value: '18 mnt', detail: 'Notifikasi aplikasi', tone: 'primary' },
      { label: 'Email memantul', value: '0,4%', detail: 'Perlu pembaruan data', tone: 'warning' },
    ],
    checklist: [
      { label: 'Perbarui alamat gagal', detail: '31 pengguna', status: 'Perlu tindakan' },
      { label: 'Tinjau antrean KRS', detail: '1.284 penerima', status: 'Terjadwal' },
      { label: 'Setujui template yudisium', detail: 'Versi 2', status: 'Draf' },
    ],
  },
  file: {
    slug: 'file',
    eyebrow: 'Penyimpanan kampus',
    title: 'Manajemen File',
    description: 'Kelola dokumen privat dan bersama, kuota penyimpanan, versi file, serta riwayat akses antar modul.',
    primaryAction: 'Unggah file',
    secondaryAction: 'Buat folder',
    periodLabel: 'Seluruh penyimpanan',
    stats: [
      { label: 'Terpakai', value: '682 GB', detail: 'Dari kuota 1 TB', trend: '68,2% kapasitas', tone: 'primary' },
      { label: 'File tersimpan', value: '48.216', detail: '9 modul dan file pengguna', trend: '+1.124 bulan ini', tone: 'success' },
      { label: 'Berbagi aktif', value: '286', detail: 'Tautan akses berbatas waktu', trend: '42 kedaluwarsa minggu ini', tone: 'info' },
      { label: 'Perlu tinjau', value: '18', detail: 'File ditandai pemeriksaan', trend: 'Tidak tersedia untuk publik', tone: 'warning' },
    ],
    alert: { title: 'Kuota pembelajaran mencapai 82%', description: 'Arsipkan materi versi lama atau sesuaikan kuota sebelum unggahan kelas baru meningkat.', status: 'Pantau kapasitas', tone: 'warning' },
    columns: [
      { key: 'name', label: 'Nama file' }, { key: 'module', label: 'Modul / folder' }, { key: 'owner', label: 'Pemilik' },
      { key: 'size', label: 'Ukuran' }, { key: 'updated', label: 'Diperbarui' }, { key: 'status', label: 'Akses' },
    ],
    rows: [
      { name: 'Rekap_KRS_Genap_2025-2026.xlsx', module: 'Akademik / Laporan', owner: 'Biro Akademik', size: '4,8 MB', updated: '21 Jul 2026, 09.14', status: 'Unit akademik' },
      { name: 'SK_Yudisium_Agustus_2026_Draf.pdf', module: 'Kelulusan / Yudisium', owner: 'Sekretariat', size: '2,1 MB', updated: '20 Jul 2026, 16.48', status: 'Privat' },
      { name: 'Materi_Minggu_12_RPL.pdf', module: 'Pembelajaran / IF601', owner: 'Dr. Rina Wulandari', size: '8,7 MB', updated: '20 Jul 2026, 13.02', status: 'Peserta kelas' },
      { name: 'Bukti_Bayar_PMB-260728.pdf', module: 'PMB / Pembayaran', owner: 'Nadya Safitri', size: '624 KB', updated: '20 Jul 2026, 10.37', status: 'Panitia PMB' },
      { name: 'Template_Surat_Aktif_v4.docx', module: 'Tata usaha / Template', owner: 'Nita Sari', size: '182 KB', updated: '19 Jul 2026, 14.22', status: 'Staf layanan' },
    ],
    emptyTitle: 'Folder ini masih kosong',
    emptyDescription: 'Unggah file atau pindahkan dokumen untuk mulai mengisi folder.',
    insights: [
      { label: 'Pembelajaran', value: '312 GB', detail: '82% dari kuota modul', tone: 'warning' },
      { label: 'Dokumen akademik', value: '186 GB', detail: '62% dari kuota modul', tone: 'primary' },
      { label: 'File privat', value: '71%', detail: 'Dilindungi akses terbatas', tone: 'success' },
    ],
    checklist: [
      { label: 'Tinjau file ditandai', detail: '18 file', status: 'Hari ini' },
      { label: 'Hapus tautan kedaluwarsa', detail: '42 tautan', status: 'Otomatis' },
      { label: 'Arsip materi lama', detail: 'Semester Gasal 2024', status: 'Terjadwal' },
    ],
  },
  'audit-backup': {
    slug: 'audit-backup',
    eyebrow: 'Keamanan operasional',
    title: 'Audit, Backup & Pemulihan',
    description: 'Pantau aktivitas penting, keberhasilan backup, retensi, dan uji pemulihan tanpa mengubah catatan audit asli.',
    primaryAction: 'Jalankan backup',
    secondaryAction: 'Ekspor audit',
    periodLabel: '24 jam terakhir',
    stats: [
      { label: 'Aktivitas tercatat', value: '8.426', detail: '24 jam terakhir', trend: '186 aktivitas sensitif', tone: 'primary' },
      { label: 'Backup terakhir', value: '02.10 WIB', detail: '21 Jul 2026', trend: 'Database dan file berhasil', tone: 'success' },
      { label: 'Retensi tersedia', value: '30 hari', detail: '12 snapshot terenkripsi', trend: 'Berikutnya hapus 24 Jul', tone: 'info' },
      { label: 'Peringatan', value: '3', detail: 'Login gagal berulang', trend: 'Sudah dibatasi sistem', tone: 'warning' },
    ],
    alert: { title: 'Uji pemulihan dijadwalkan 26 Juli', description: 'Simulasi dilakukan pada lingkungan terisolasi dan tidak akan menimpa data produksi.', status: 'Terjadwal', tone: 'info' },
    columns: [
      { key: 'time', label: 'Waktu' }, { key: 'actor', label: 'Pengguna' }, { key: 'action', label: 'Aktivitas' },
      { key: 'resource', label: 'Objek' }, { key: 'source', label: 'Sumber' }, { key: 'status', label: 'Status' },
    ],
    rows: [
      { time: '21 Jul 2026, 10.21', actor: 'rina.wulandari', action: 'Memperbarui nilai kelas', resource: 'IF601 · IF-6A', source: '10.24.xxx.18', status: 'Berhasil' },
      { time: '21 Jul 2026, 10.14', actor: 'system.pddikti', action: 'Validasi batch', resource: 'SYNC-260721-1014', source: 'Internal service', status: 'Selesai' },
      { time: '21 Jul 2026, 09.58', actor: 'finance.staff02', action: 'Verifikasi pembayaran', resource: 'TRX-260721-4918', source: '10.24.xxx.42', status: 'Berhasil' },
      { time: '21 Jul 2026, 09.41', actor: 'unknown', action: 'Percobaan login berulang', resource: 'admin.ops', source: '103.xxx.xxx.27', status: 'Dibatasi' },
      { time: '21 Jul 2026, 09.22', actor: 'academic.staff04', action: 'Menyetujui perubahan KRS', resource: 'KRS-231031017', source: '10.24.xxx.36', status: 'Berhasil' },
    ],
    emptyTitle: 'Tidak ada aktivitas pada filter ini',
    emptyDescription: 'Ubah rentang waktu atau jenis aktivitas untuk melihat catatan audit.',
    insights: [
      { label: 'Keberhasilan backup', value: '100%', detail: '30 hari terakhir', tone: 'success' },
      { label: 'RPO aktual', value: '24 jam', detail: 'Sesuai kebijakan', tone: 'primary' },
      { label: 'Aktivitas dibatasi', value: '3', detail: 'Login berulang', tone: 'warning' },
    ],
    checklist: [
      { label: 'Tinjau login dibatasi', detail: '3 kejadian', status: 'Hari ini' },
      { label: 'Uji checksum snapshot', detail: 'Backup 21 Jul', status: 'Berjalan' },
      { label: 'Simulasi pemulihan', detail: 'Lingkungan terisolasi', status: '26 Jul' },
    ],
  },
  settings: {
    slug: 'settings',
    eyebrow: 'Administrasi sistem',
    title: 'Pengaturan',
    description: 'Kelola periode akademik, struktur organisasi, hak akses, integrasi, dan kebijakan aplikasi secara terpusat.',
    primaryAction: 'Tambah pengguna',
    secondaryAction: 'Lihat perubahan',
    periodLabel: 'Konfigurasi aktif',
    stats: [
      { label: 'Pengguna aktif', value: '2.164', detail: '10 kelompok peran', trend: '18 sesi aktif sekarang', tone: 'primary' },
      { label: 'Unit akademik', value: '8', detail: '5 program studi aktif', trend: 'Struktur diperbarui 2 Jul', tone: 'success' },
      { label: 'Konfigurasi tertunda', value: '6', detail: 'Menunggu persetujuan admin utama', trend: '2 berdampak pada periode baru', tone: 'warning' },
      { label: 'Integrasi sehat', value: '5 / 6', detail: 'Satu layanan dalam pemeliharaan', trend: 'Neo Feeder tetap tersedia', tone: 'info' },
    ],
    alert: { title: 'Tinjau konfigurasi semester baru', description: 'Tanggal KRS dan kalender akademik perlu disetujui sebelum dipublikasikan kepada pengguna.', status: 'Perlu persetujuan', tone: 'warning' },
    columns: [
      { key: 'area', label: 'Area pengaturan' }, { key: 'description', label: 'Cakupan' }, { key: 'owner', label: 'Penanggung jawab' },
      { key: 'updated', label: 'Pembaruan terakhir' }, { key: 'version', label: 'Versi' }, { key: 'status', label: 'Status' },
    ],
    rows: [
      { area: 'Tahun akademik', description: 'Periode, KRS, dan kalender', owner: 'Biro Akademik', updated: '20 Jul 2026, 15.12', version: 'v12', status: 'Perlu persetujuan' },
      { area: 'Peran dan hak akses', description: '10 peran, 64 izin', owner: 'Admin Sistem', updated: '19 Jul 2026, 09.34', version: 'v28', status: 'Aktif' },
      { area: 'Program studi', description: '5 prodi dan 8 unit', owner: 'Biro Akademik', updated: '2 Jul 2026, 13.45', version: 'v16', status: 'Aktif' },
      { area: 'Kebijakan sesi', description: 'Timeout dan pencabutan sesi', owner: 'Admin Keamanan', updated: '28 Jun 2026, 11.02', version: 'v9', status: 'Aktif' },
      { area: 'Integrasi layanan', description: '6 koneksi internal/eksternal', owner: 'Admin Integrasi', updated: '21 Jul 2026, 08.10', version: 'v22', status: 'Pemeliharaan' },
    ],
    emptyTitle: 'Tidak ada pengaturan yang cocok',
    emptyDescription: 'Ubah kata kunci atau kategori untuk menemukan konfigurasi.',
    insights: [
      { label: 'Peran aktif', value: '10', detail: '64 izin terpetakan', tone: 'primary' },
      { label: 'Sesi aktif', value: '18', detail: 'Tidak ada sesi anomali', tone: 'success' },
      { label: 'Perubahan menunggu', value: '6', detail: 'Memerlukan persetujuan', tone: 'warning' },
    ],
    checklist: [
      { label: 'Setujui tanggal KRS', detail: 'Semester Gasal 2026/2027', status: 'Prioritas' },
      { label: 'Tinjau akses staf baru', detail: '4 pengguna', status: 'Hari ini' },
      { label: 'Uji koneksi layanan', detail: 'Payment gateway', status: 'Pemeliharaan' },
    ],
  },
}

export const moduleSlugs = Object.keys(moduleCatalog)

export const moduleAliases: Record<string, string> = {
  kelulusan: 'kelulusan-yudisium',
  'tata-usaha': 'tata-usaha-layanan',
  berkas: 'file',
  pengaturan: 'settings',
}
