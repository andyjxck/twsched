import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'

// ---------- Passwords: scrypt with a random salt per password ----------
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 }
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16)
  const key = crypto.scryptSync(pw, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p })
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`
}
export function verifyPassword(pw, stored) {
  // Always do the work, even with no stored hash, so timing doesn't reveal which emails exist.
  const parts = (stored || 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==').split('$')
  const [, N, r, p, saltB64, keyB64] = parts
  const key = Buffer.from(keyB64, 'base64')
  const test = crypto.scryptSync(pw, Buffer.from(saltB64, 'base64'), key.length, { N: +N, r: +r, p: +p })
  return Boolean(stored) && crypto.timingSafeEqual(key, test)
}

const COMMON = new Set(['password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwertyuiop', 'whiteswan', 'whiteswan1', 'letmein123', 'iloveyou1', 'football1'])
export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Use at least 10 characters.'
  if (pw.length > 200) return 'That password is too long.'
  if (COMMON.has(pw.toLowerCase())) return 'That password is too common. Pick something less guessable.'
  return null
}

// ---------- Tokens: random, and only their SHA-256 is stored ----------
export const newToken = () => crypto.randomBytes(32).toString('base64url')
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')

// ---------- Simple in-memory rate limiter (one server process) ----------
const buckets = new Map()
export function rateLimit(key, limit, windowMs) {
  const now = Date.now()
  let b = buckets.get(key)
  if (!b || b.reset < now) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b) }
  b.count += 1
  return { ok: b.count <= limit, retryAfter: Math.ceil((b.reset - now) / 1000) }
}
setInterval(() => { const n = Date.now(); for (const [k, b] of buckets) if (b.reset < n) buckets.delete(k) }, 60_000).unref()

// ---------- Private file storage, encrypted at rest with AES-256-GCM ----------
fs.mkdirSync(config.storageDir, { recursive: true, mode: 0o700 })
export function storeEncrypted(buffer) {
  const fileKey = crypto.randomBytes(18).toString('hex')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', config.fileKey, iv)
  const enc = Buffer.concat([cipher.update(buffer), cipher.final()])
  const out = Buffer.concat([iv, cipher.getAuthTag(), enc])
  fs.writeFileSync(path.join(config.storageDir, fileKey + '.bin'), out, { mode: 0o600 })
  return fileKey
}
export function readEncrypted(fileKey) {
  if (!/^[a-f0-9]{36}$/.test(fileKey)) throw new Error('bad file key')
  const raw = fs.readFileSync(path.join(config.storageDir, fileKey + '.bin'))
  const decipher = crypto.createDecipheriv('aes-256-gcm', config.fileKey, raw.subarray(0, 12))
  decipher.setAuthTag(raw.subarray(12, 28))
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()])
}
export function deleteStored(fileKey) {
  if (!/^[a-f0-9]{36}$/.test(fileKey)) return
  try { fs.unlinkSync(path.join(config.storageDir, fileKey + '.bin')) } catch { /* already gone */ }
}

// Check the real file type from its first bytes, not the name or what the browser claims.
export function sniffType(buf) {
  if (buf.subarray(0, 5).toString() === '%PDF-') return 'application/pdf'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  return null
}

export const safeFileName = (n) => String(n || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 120)
