// Loads settings from environment variables (and a local .env file if present).
// Secrets live only on the server; nothing here is ever sent to the browser.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envFile = path.join(root, '.env')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
}

const isProd = process.env.NODE_ENV === 'production'

function required(name, devDefault) {
  const v = process.env[name]
  if (v) return v
  if (isProd) throw new Error(`Missing required setting ${name}`)
  return devDefault
}

export const config = {
  root,
  isProd,
  port: Number(process.env.PORT || 8790),
  databaseUrl: required('DATABASE_URL', 'postgres://swan:swan_dev_pw@127.0.0.1:5432/swan_staff'),
  // 32-byte key (64 hex chars) used to encrypt right to work files and payslips at rest.
  fileKey: Buffer.from(required('FILE_ENCRYPTION_KEY', '0'.repeat(64)), 'hex'),
  storageDir: process.env.STORAGE_DIR || path.join(root, 'storage'),
  // Behind HTTPS (any real host, or a tunnel) cookies must be Secure.
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : isProd,
  // The public website's address, allowed to read published events.
  publicSiteOrigins: (process.env.PUBLIC_SITE_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean),
  appUrl: process.env.APP_URL || '',
  sessionDays: 14,
}

if (config.fileKey.length !== 32) throw new Error('FILE_ENCRYPTION_KEY must be 64 hex characters')
if (isProd && /^0+$/.test(config.fileKey.toString('hex'))) throw new Error('Set a real FILE_ENCRYPTION_KEY in production')
