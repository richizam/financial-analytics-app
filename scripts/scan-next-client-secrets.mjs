import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const scanRoots = [
  join(root, '.next', 'static'),
  join(root, '.next', 'server', 'app'),
]

const allowedExtensions = new Set([
  '.js',
  '.mjs',
  '.css',
  '.html',
  '.rsc',
  '.txt',
  '.json',
])

const forbidden = [
  { name: 'backend api key env', pattern: /\bBACKEND_API_KEY\b/ },
  { name: 'database url env', pattern: /\bDATABASE_URL(?:_DIRECT)?\b/ },
  { name: 'xai api key env', pattern: /\bXAI_API_KEY\b/ },
  { name: 'supabase service role env', pattern: /\b(?:SUPABASE_)?SERVICE_ROLE\b/i },
  { name: 'postgres connection string', pattern: /postgres(?:ql)?:\/\/[^\s"'`<>)]+/i },
  { name: 'xai secret key', pattern: /\bxai-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'supabase secret key', pattern: /\bsb_secret_[A-Za-z0-9_-]+\b/ },
]

function extensionOf(path) {
  const match = path.match(/(\.[^.\\/]+)$/)
  return match ? match[1] : ''
}

function walk(dir) {
  const files = []
  if (!existsSync(dir)) return files
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      files.push(...walk(path))
    } else if (stat.isFile() && allowedExtensions.has(extensionOf(path))) {
      files.push(path)
    }
  }
  return files
}

const findings = []
for (const scanRoot of scanRoots) {
  for (const file of walk(scanRoot)) {
    const content = readFileSync(file, 'utf8')
    for (const rule of forbidden) {
      if (rule.pattern.test(content)) {
        findings.push({ rule: rule.name, file: relative(root, file) })
      }
    }
  }
}

if (findings.length > 0) {
  console.error('Potential server-only secret exposure in client-delivered build artifacts:')
  for (const finding of findings) {
    console.error(`- ${finding.rule}: ${finding.file}`)
  }
  process.exit(1)
}

console.log('No server-only secrets found in client-delivered Next.js build artifacts.')
