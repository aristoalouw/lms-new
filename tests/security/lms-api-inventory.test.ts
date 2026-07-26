import { readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  featureForApiPath,
  isFeatureEnabled,
  mvpApiDecision,
  MVP_ALLOWED_API_ROUTES,
  MVP_DENIED_API_ROUTES,
} from '../../shared/features'

interface ApiFile {
  file: string
  key: string
  path: string
}

const apiRoot = resolve(process.cwd(), 'server/api')

function apiFiles(directory = apiRoot): ApiFile[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(directory, entry.name)
    if (entry.isDirectory()) return apiFiles(absolute)
    const match = entry.name.match(/\.(get|post|put|patch|delete)\.ts$/)
    if (!match) return []
    const file = relative(apiRoot, absolute).replaceAll('\\', '/')
    const withoutMethod = file.replace(/\.(get|post|put|patch|delete)\.ts$/, '')
    const template = `/api/${withoutMethod.replace(/\/index$/, '').replace(/\[([^\]]+)\]/g, ':$1')}`
    return [{
      file,
      key: `${match[1]!.toUpperCase()} ${template}`,
      path: template.replace(/:[^/]+/g, 'inventory-id'),
    }]
  })
}

describe('LMS MVP API registry inventory', () => {
  it('classifies every API file in an enabled MVP namespace explicitly', () => {
    const policies = new Set<string>([...MVP_ALLOWED_API_ROUTES, ...MVP_DENIED_API_ROUTES])
    const inventory = apiFiles()
    const unclassified = inventory
      .filter(({ path }) => {
        const feature = featureForApiPath(path)
        return !feature || isFeatureEnabled('lms-mvp', feature)
      })
      .filter(({ key }) => !policies.has(key))
      .map(({ file, key }) => `${file} -> ${key}`)
    expect(unclassified).toEqual([])
  })

  it('keeps the explicit policy free from duplicates and disabled feature routes', () => {
    const policies = [...MVP_ALLOWED_API_ROUTES, ...MVP_DENIED_API_ROUTES]
    expect(new Set(policies).size).toBe(policies.length)
    for (const key of policies) {
      const path = key.slice(key.indexOf(' ') + 1).replace(/:[^/]+/g, 'inventory-id')
      const feature = featureForApiPath(path)
      expect(feature, key).toBeDefined()
      expect(isFeatureEnabled('lms-mvp', feature!), key).toBe(true)
    }
  })

  it('evaluates every declared allow and deny decision as written', () => {
    for (const [expected, policies] of [
      ['allowed', MVP_ALLOWED_API_ROUTES],
      ['denied', MVP_DENIED_API_ROUTES],
    ] as const) {
      for (const key of policies) {
        const separator = key.indexOf(' ')
        const method = key.slice(0, separator)
        const path = key.slice(separator + 1).replace(/:[^/]+/g, 'inventory-id')
        expect(mvpApiDecision(path, method), key).toBe(expected)
      }
    }
  })
})
