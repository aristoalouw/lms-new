import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateArchiveListings } from '../../scripts/package-hostinger-release.mjs'

const repositoryRoot = resolve(process.cwd())

describe('Hostinger portable release packaging', () => {
  it('accepts a self-contained .output archive', () => {
    expect(validateArchiveListings(
      '.output/\n.output/server/\n.output/server/index.mjs\n',
      'drwxr-xr-x user/group 0 date .output/\n-rw-r--r-- user/group 1 date .output/server/index.mjs\n',
    )).toEqual({ entries: 3 })
  })

  it('rejects link entries left by a Windows Nitro build', () => {
    expect(() => validateArchiveListings(
      '.output/\n.output/server/node_modules/gaxios\n',
      'drwxr-xr-x user/group 0 date .output/\nlrwxrwxrwx user/group 0 date .output/server/node_modules/gaxios -> C:/Users/operator/project/node_modules/gaxios\n',
    )).toThrow('symbolic or hard-link')
  })

  it('rejects absolute, traversal, and out-of-scope entries', () => {
    expect(() => validateArchiveListings('/home/operator/.output/server/index.mjs\n', '')).toThrow('absolute path')
    expect(() => validateArchiveListings('.output/../secret.env\n', '')).toThrow('escapes')
    expect(() => validateArchiveListings('package.json\n', '')).toThrow('outside .output')
  })

  it('pins the reviewed packager in scripts and the deployment runbook', () => {
    const packageJson = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    const script = readFileSync(resolve(repositoryRoot, 'scripts', 'package-hostinger-release.mjs'), 'utf8')
    const runbook = readFileSync(resolve(repositoryRoot, 'docs', 'hostinger-node-deployment.md'), 'utf8')

    expect(packageJson.scripts['package:hostinger']).toBe('node scripts/package-hostinger-release.mjs')
    expect(script).toContain("['-c', '-z', '-h', '-f'")
    expect(runbook).toContain('production-portable.tar.gz')
    expect(runbook).toContain('link entries: 0')
  })
})
