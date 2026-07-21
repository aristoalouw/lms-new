import { createHash } from 'node:crypto'
import { connect } from 'node:net'
import { once } from 'node:events'
import type { AllowedFileMimeType } from '../types/files'
import { CampusError } from '../utils/errors'

export interface MalwareScanInput {
  fileId: string
  version: number
  fileName: string
  mimeType: AllowedFileMimeType
  sizeBytes: number
  stream: AsyncIterable<Uint8Array>
}

export interface MalwareScanResult {
  verdict: 'CLEAN' | 'INFECTED'
  engine: string
  message?: string
  sha256: string
}

export interface MalwareScanner {
  scan(input: MalwareScanInput): Promise<MalwareScanResult>
}

const EICAR_MARKER = 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE'

export class DevelopmentSignatureScanner implements MalwareScanner {
  async scan(input: MalwareScanInput): Promise<MalwareScanResult> {
    const digest = createHash('sha256')
    let tail = ''
    let infected = false
    for await (const chunk of input.stream) {
      digest.update(chunk)
      const text = tail + Buffer.from(chunk).toString('latin1')
      if (text.includes(EICAR_MARKER)) infected = true
      tail = text.slice(-EICAR_MARKER.length)
    }
    return {
      verdict: infected ? 'INFECTED' : 'CLEAN',
      engine: 'development-signature-scanner',
      ...(infected ? { message: 'Test signature terdeteksi.' } : {}),
      sha256: digest.digest('hex'),
    }
  }
}

export class FailClosedMalwareScanner implements MalwareScanner {
  async scan(): Promise<MalwareScanResult> {
    throw new CampusError(
      503,
      'MALWARE_SCANNER_UNAVAILABLE',
      'Pemindai malware belum tersedia; file tetap berada dalam karantina.',
    )
  }
}

export class ClamAvStreamScanner implements MalwareScanner {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs = 60_000,
  ) {}

  async scan(input: MalwareScanInput): Promise<MalwareScanResult> {
    const digest = createHash('sha256')
    const socket = connect({ host: this.host, port: this.port })
    socket.setTimeout(this.timeoutMs)
    let response = ''
    const responsePromise = new Promise<string>((resolve, reject) => {
      socket.on('data', (chunk: Buffer) => {
        response += chunk.toString('utf8')
        if (response.length > 4096) reject(new Error('Respons pemindai melebihi batas.'))
      })
      socket.once('end', () => resolve(response))
      socket.once('timeout', () => reject(new Error('Pemindai malware kehabisan waktu.')))
      socket.once('error', reject)
    })

    try {
      await once(socket, 'connect')
      socket.write('zINSTREAM\0')
      for await (const raw of input.stream) {
        const chunk = Buffer.from(raw)
        digest.update(chunk)
        const length = Buffer.allocUnsafe(4)
        length.writeUInt32BE(chunk.byteLength)
        if (!socket.write(length)) await once(socket, 'drain')
        if (!socket.write(chunk)) await once(socket, 'drain')
      }
      socket.end(Buffer.alloc(4))
      const result = await responsePromise
      if (/\bFOUND\b/i.test(result)) {
        return {
          verdict: 'INFECTED',
          engine: 'clamav',
          message: result.replace(/\s+/g, ' ').trim().slice(0, 300),
          sha256: digest.digest('hex'),
        }
      }
      if (!/\bOK\b/i.test(result)) throw new Error('Pemindai malware mengembalikan respons yang tidak dikenali.')
      return { verdict: 'CLEAN', engine: 'clamav', sha256: digest.digest('hex') }
    } catch (error) {
      socket.destroy()
      if (error instanceof CampusError) throw error
      throw new CampusError(
        503,
        'MALWARE_SCANNER_UNAVAILABLE',
        'Pemindai malware tidak dapat menyelesaikan pemeriksaan; file tetap berada dalam karantina.',
      )
    }
  }
}

let configuredScanner: MalwareScanner | undefined

export function malwareScanner(): MalwareScanner {
  if (configuredScanner) return configuredScanner
  const host = process.env.CLAMAV_HOST?.trim()
  const port = Number(process.env.CLAMAV_PORT || 3310)
  if (host && Number.isInteger(port) && port > 0 && port <= 65535) return new ClamAvStreamScanner(host, port)
  if (process.env.NODE_ENV === 'production') return new FailClosedMalwareScanner()
  return new DevelopmentSignatureScanner()
}

export function configureMalwareScanner(scanner?: MalwareScanner): void {
  configuredScanner = scanner
}
