import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'

const root = process.cwd()
const manifests = ['package.json']
const sourceRoots = ['components', 'composables', 'middleware', 'pages', 'plugins', 'server', 'shared', 'types']
const extensions = new Set(['.ts', '.js', '.mjs', '.vue'])
const forbiddenDependencies = /^(openai|@anthropic-ai\/sdk|@google\/generative-ai|cohere-ai|langchain|@langchain\/|ollama|replicate)$/i
const forbiddenImports = /(?:from\s+|import\s*\(|require\s*\()\s*['"](?:openai|@anthropic-ai\/sdk|@google\/generative-ai|cohere-ai|langchain|@langchain\/[^'"]*|ollama|replicate)['"]/i

const violations = []
for (const manifest of manifests) {
  const data = JSON.parse(await readFile(join(root, manifest), 'utf8'))
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(data[section] || {})) if (forbiddenDependencies.test(name)) violations.push(`${manifest}: ${section}.${name}`)
  }
}

async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await scan(path)
    else if (extensions.has(extname(entry.name)) && forbiddenImports.test(await readFile(path, 'utf8'))) violations.push(relative(root, path))
  }
}
for (const directory of sourceRoots) await scan(join(root, directory))

if (violations.length) {
  console.error(`Integrasi AI/ML terlarang ditemukan:\n${violations.map(item => `- ${item}`).join('\n')}`)
  process.exit(1)
}
console.log('No-AI gate lulus: tidak ada dependency atau import runtime AI/ML.')
