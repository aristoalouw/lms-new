import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const allowlistPath = resolve(process.cwd(), 'config/dependency-audit-allowlist.json')
const allowlistDocument = JSON.parse(await readFile(allowlistPath, 'utf8'))
const allowlist = new Map(Object.entries(allowlistDocument.advisories || {}))
const npmCli = process.env.npm_execpath
if (!npmCli) {
  console.error('Lokasi npm CLI tidak tersedia pada environment proses.')
  process.exit(1)
}
const result = spawnSync(process.execPath, [npmCli, 'audit', '--json'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
})

if (!result.stdout?.trim()) {
  console.error('Dependency audit gagal dijalankan.')
  if (result.stderr?.trim()) console.error(result.stderr.trim())
  process.exit(1)
}

let report
try {
  report = JSON.parse(result.stdout)
} catch {
  console.error('Dependency audit mengembalikan laporan yang tidak valid.')
  process.exit(1)
}

const severityRank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 }
const directAdvisories = new Map()
for (const vulnerability of Object.values(report.vulnerabilities || {})) {
  for (const item of vulnerability.via || []) {
    if (!item || typeof item !== 'object' || !item.url) continue
    const id = String(item.url).split('/').at(-1)
    if (id) directAdvisories.set(id, item)
  }
}

const today = new Date().toISOString().slice(0, 10)
const blocking = []
const accepted = []
for (const [id, advisory] of directAdvisories) {
  if ((severityRank[advisory.severity] || 0) < severityRank.high) continue
  const exception = allowlist.get(id)
  if (!exception) {
    blocking.push(`${id} (${advisory.severity}): ${advisory.title}`)
    continue
  }
  if (exception.severity !== advisory.severity || !exception.expiresOn || exception.expiresOn < today) {
    blocking.push(`${id}: exception tidak cocok atau sudah kedaluwarsa.`)
    continue
  }
  accepted.push(`${id} sampai ${exception.expiresOn}`)
}

const totals = report.metadata?.vulnerabilities || {}
if ((totals.critical || 0) > 0 && ![...directAdvisories.values()].some(item => item.severity === 'critical')) {
  blocking.push('Laporan memuat critical vulnerability tanpa advisory sumber yang dapat diverifikasi.')
}

console.log(`Dependency audit: ${totals.total || 0} temuan (${totals.critical || 0} critical, ${totals.high || 0} high, ${totals.moderate || 0} moderate).`)
if (accepted.length) console.warn(`Exception aktif: ${accepted.join(', ')}.`)
if (blocking.length) {
  console.error(`Dependency gate gagal:\n${blocking.map(item => `- ${item}`).join('\n')}`)
  process.exit(1)
}
console.log('Dependency gate lulus: tidak ada high/critical advisory di luar exception yang ditinjau.')
