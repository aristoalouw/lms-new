import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const outputArgument = process.argv.find(argument => argument.startsWith('--out='))
const outputDirectory = resolve(repositoryRoot, outputArgument?.slice('--out='.length) || '.firebase-spark')
const sourcePath = resolve(repositoryRoot, 'firebase/firestore.indexes.json')
const rulesPath = resolve(repositoryRoot, 'firebase/firestore.lms-mvp.rules')
const source = JSON.parse(readFileSync(sourcePath, 'utf8'))

if (!Array.isArray(source.indexes) || !Array.isArray(source.fieldOverrides)) {
  throw new Error('Konfigurasi indeks Firestore sumber tidak valid.')
}

const fieldOverrides = source.fieldOverrides.map(({ ttl, ...override }) => {
  void ttl
  return override
})
const sparkIndexes = {
  indexes: source.indexes,
  fieldOverrides,
}
const sparkConfig = {
  firestore: {
    rules: 'firestore.rules',
    indexes: 'firestore.indexes.json',
  },
}

mkdirSync(outputDirectory, { recursive: true })
copyFileSync(rulesPath, resolve(outputDirectory, 'firestore.rules'))
writeFileSync(resolve(outputDirectory, 'firestore.indexes.json'), `${JSON.stringify(sparkIndexes, null, 2)}\n`, { mode: 0o600 })
writeFileSync(resolve(outputDirectory, 'firebase.json'), `${JSON.stringify(sparkConfig, null, 2)}\n`, { mode: 0o600 })

console.log(`Prepared Spark-safe Firestore configuration in ${outputDirectory}.`)
