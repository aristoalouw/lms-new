import { createHash } from 'node:crypto'
import type { EmailDeliveryAdapter, EmailDeliveryMessage } from '../types/communications'
import { invalidInput, serviceUnavailable } from '../utils/errors'
import { authAdmin } from '../utils/firebase-admin'
import { emailDeliveryEnabled } from '../utils/capabilities'

export interface PasswordResetLinkGateway {
  create(email: string, continuePath?: string): Promise<string>
}

export interface EmailGatewayConfiguration {
  endpoint: string
  bearerToken: string
  from: string
  passwordResetContinueUrl: string
  timeoutMs?: number
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function safeHttpsUrl(value: string, label: string): URL {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    invalidInput(`${label} bukan URL yang valid.`)
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
    invalidInput(`${label} wajib memakai HTTPS tanpa credential atau fragment.`)
  }
  return parsed
}

export class FirebasePasswordResetLinkGateway implements PasswordResetLinkGateway {
  constructor(private readonly continueUrl: string) {}

  async create(email: string, continuePath?: string): Promise<string> {
    const admin = authAdmin()
    if (!admin) serviceUnavailable('Firebase Auth tidak tersedia untuk reset kata sandi.')
    const configured = safeHttpsUrl(this.continueUrl, 'PASSWORD_RESET_CONTINUE_URL')
    const target = continuePath ? new URL(continuePath, configured.origin) : configured
    if (target.origin !== configured.origin) invalidInput('Tujuan reset kata sandi harus satu origin dengan aplikasi.')
    return admin.generatePasswordResetLink(email, { url: target.toString(), handleCodeInApp: false })
  }
}

export class HttpEmailDeliveryAdapter implements EmailDeliveryAdapter {
  private readonly endpoint: URL
  private readonly timeoutMs: number

  constructor(
    private readonly configuration: EmailGatewayConfiguration,
    private readonly resetLinks: PasswordResetLinkGateway,
    private readonly fetcher: FetchLike = fetch,
  ) {
    this.endpoint = safeHttpsUrl(configuration.endpoint, 'EMAIL_DELIVERY_ENDPOINT')
    if (!EMAIL_PATTERN.test(configuration.from) || configuration.from.length > 254) invalidInput('EMAIL_FROM tidak valid.')
    if (configuration.bearerToken.length < 32) invalidInput('EMAIL_DELIVERY_BEARER_TOKEN terlalu pendek.')
    this.timeoutMs = Math.min(Math.max(configuration.timeoutMs || 15_000, 1_000), 60_000)
  }

  private async renderText(message: EmailDeliveryMessage): Promise<string> {
    if (message.deliveryKind === 'RENDERED_TEMPLATE') {
      if (!message.textBody) invalidInput('Isi email template kosong.')
      return message.textBody
    }
    const link = await this.resetLinks.create(message.to, message.deliveryData?.continuePath)
    return [
      'Kami menerima permintaan untuk mengatur ulang kata sandi akun Nusa Campus.',
      '',
      `Buka tautan sekali pakai berikut: ${link}`,
      '',
      'Jika Anda tidak meminta perubahan ini, abaikan email ini dan hubungi administrator kampus.',
    ].join('\n')
  }

  async send(message: EmailDeliveryMessage): Promise<{ providerMessageId: string }> {
    if (!EMAIL_PATTERN.test(message.to) || message.to.length > 254) invalidInput('Alamat email tujuan tidak valid.')
    const text = await this.renderText(message)
    const response = await this.fetcher(this.endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${this.configuration.bearerToken}`,
        'content-type': 'application/json',
        'idempotency-key': message.outboxId,
      },
      body: JSON.stringify({
        from: this.configuration.from,
        to: message.to,
        subject: message.subject,
        text,
        metadata: { outboxId: message.outboxId, deliveryKind: message.deliveryKind },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    if (!response.ok) throw new Error(`EMAIL_GATEWAY_${response.status}`)
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.toLowerCase().includes('application/json')) throw new Error('EMAIL_GATEWAY_INVALID_RESPONSE')
    const body = await response.json() as { providerMessageId?: unknown; messageId?: unknown }
    const providerMessageId = typeof body.providerMessageId === 'string'
      ? body.providerMessageId
      : typeof body.messageId === 'string' ? body.messageId : ''
    if (!providerMessageId || providerMessageId.length > 180) throw new Error('EMAIL_GATEWAY_INVALID_MESSAGE_ID')
    return { providerMessageId }
  }
}

export function emailDeliveryAdapterFromEnvironment(): EmailDeliveryAdapter {
  if (!emailDeliveryEnabled()) serviceUnavailable('Pengiriman email belum diaktifkan.')
  const endpoint = process.env.EMAIL_DELIVERY_ENDPOINT?.trim() || ''
  const bearerToken = process.env.EMAIL_DELIVERY_BEARER_TOKEN || ''
  const from = process.env.EMAIL_FROM?.trim() || ''
  const passwordResetContinueUrl = process.env.PASSWORD_RESET_CONTINUE_URL?.trim() || ''
  if (!endpoint || !bearerToken || !from || !passwordResetContinueUrl) {
    serviceUnavailable('Konfigurasi worker email belum lengkap.')
  }
  return new HttpEmailDeliveryAdapter(
    { endpoint, bearerToken, from, passwordResetContinueUrl },
    new FirebasePasswordResetLinkGateway(passwordResetContinueUrl),
  )
}

export function emailWorkerSecretFingerprint(): string {
  if (!emailDeliveryEnabled()) serviceUnavailable('Pengiriman email belum diaktifkan.')
  const secret = process.env.EMAIL_WORKER_SECRET || ''
  if (secret.length < 32) serviceUnavailable('Secret worker email belum dikonfigurasi.')
  return createHash('sha256').update(secret).digest('hex')
}
