import { spawnSync } from 'node:child_process'
import { existsSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(process.cwd())

function argument(name) {
  const prefix = `--${name}=`
  const inline = process.argv.find(value => value.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)

  const index = process.argv.indexOf(`--${name}`)
  if (index >= 0) return process.argv[index + 1]
  return undefined
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = `${result.stdout || ''}\n${result.stderr || ''}`.trim()
    throw new Error(`${command} failed with exit code ${result.status}.${detail ? `\n${detail}` : ''}`)
  }
  return result.stdout || ''
}

function defaultReleaseId() {
  const configured = process.env.APP_VERSION?.trim()
  if (configured) return configured
  return run('git', ['rev-parse', '--short=7', 'HEAD']).trim()
}

export function validateArchiveListings(namesListing, verboseListing) {
  const names = namesListing.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
  if (names.length === 0) throw new Error('The archive is empty.')

  for (const name of names) {
    const normalized = name.replaceAll('\\', '/')
    if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
      throw new Error(`Archive entry uses an absolute path: ${name}`)
    }
    if (normalized.split('/').includes('..')) {
      throw new Error(`Archive entry escapes the release root: ${name}`)
    }
    if (normalized !== '.output' && !normalized.startsWith('.output/')) {
      throw new Error(`Archive entry is outside .output: ${name}`)
    }
  }

  const verboseLines = verboseListing.split(/\r?\n/).filter(Boolean)
  const linkEntry = verboseLines.find(line => /^[lh]/.test(line.trimStart()))
  if (linkEntry) throw new Error('Archive contains a symbolic or hard-link entry.')

  const localAbsoluteTarget = verboseLines.find(line => (
    /\s(?:->|link to)\s+[A-Za-z]:[\\/]/i.test(line)
    || /\s(?:->|link to)\s+\/(?:Users|home)\//i.test(line)
  ))
  if (localAbsoluteTarget) throw new Error('Archive contains an absolute local link target.')

  return { entries: names.length }
}

function main() {
  const outputDirectory = argument('output-dir')
  const explicitOutput = argument('output')
  if (outputDirectory && explicitOutput) {
    throw new Error('Use either --output or --output-dir, not both.')
  }

  const sourceDirectory = resolve(repositoryRoot, '.output')
  if (!existsSync(sourceDirectory) || !statSync(sourceDirectory).isDirectory()) {
    throw new Error('Missing .output directory. Run npm run build first.')
  }

  const releaseId = defaultReleaseId().replace(/[^A-Za-z0-9._-]/g, '-')
  if (!releaseId) throw new Error('APP_VERSION or Git release ID is invalid.')

  const defaultName = `lms-output-${releaseId}-production-portable.tar.gz`
  const artifactPath = resolve(
    repositoryRoot,
    explicitOutput || (outputDirectory ? `${outputDirectory}/${defaultName}` : defaultName),
  )
  const relativeToSource = relative(sourceDirectory, artifactPath)
  if (relativeToSource === '' || (!relativeToSource.startsWith('..') && !isAbsolute(relativeToSource))) {
    throw new Error('The artifact must be written outside .output.')
  }
  if (existsSync(artifactPath)) {
    throw new Error(`Refusing to overwrite existing artifact: ${artifactPath}`)
  }
  if (!existsSync(dirname(artifactPath))) {
    throw new Error(`Output directory does not exist: ${dirname(artifactPath)}`)
  }

  const partialPath = resolve(dirname(artifactPath), `.${basename(artifactPath)}.partial-${process.pid}`)
  try {
    // -h is mandatory: Nitro may emit Windows directory links that are invalid on Linux hosting.
    run('tar', ['-c', '-z', '-h', '-f', partialPath, '.output'])
    const namesListing = run('tar', ['-t', '-z', '-f', partialPath])
    const verboseListing = run('tar', ['-t', '-v', '-z', '-f', partialPath])
    const validation = validateArchiveListings(namesListing, verboseListing)
    renameSync(partialPath, artifactPath)
    process.stdout.write(`Portable Hostinger artifact created: ${artifactPath}\n`)
    process.stdout.write(`Validated entries: ${validation.entries}; link entries: 0.\n`)
  }
  finally {
    if (existsSync(partialPath)) rmSync(partialPath, { force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    main()
  }
  catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
