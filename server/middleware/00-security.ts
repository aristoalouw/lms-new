import { removeResponseHeader, setResponseHeaders } from 'h3'
import { applicationSecurityHeaders, trustedRequestId } from '../utils/security'

const PRIVATE_ROUTE_PREFIXES = [
  '/login',
  '/admin',
  '/akademik',
  '/evaluasi',
  '/impor',
  '/kelulusan',
  '/kemahasiswaan',
  '/keuangan',
  '/layanan',
  '/modul',
  '/pddikti',
  '/pembelajaran',
  '/pengguna',
  '/pmb/status',
  '/pmb/dokumen',
  '/pmb/kelola',
  '/pmb/seleksi',
  '/pmb/pengaturan',
  '/tracer-study',
  '/presensi',
  '/berkas',
  '/notifikasi',
  '/api',
]

function isPrivatePath(rawPath: string | undefined): boolean {
  if (!rawPath) return false
  const pathname = rawPath.split('?')[0] || ''
  let normalized = pathname
  try {
    normalized = decodeURIComponent(pathname)
  } catch {
    // Keep raw pathname when percent-encoding is malformed; fail closed if it matches.
  }
  const lower = normalized.toLowerCase().replace(/\/+/g, '/')
  return PRIVATE_ROUTE_PREFIXES.some(prefix => lower === prefix || lower.startsWith(`${prefix}/`))
}

export default defineEventHandler((event) => {
  const headers: Record<string, string> = {
    ...applicationSecurityHeaders(),
    'x-request-id': trustedRequestId(event),
  }
  if (isPrivatePath(event.path)) {
    headers['cache-control'] = 'no-store, private, max-age=0'
  }
  setResponseHeaders(event, headers)
  removeResponseHeader(event, 'x-powered-by')
})
