// Demo only: replaces server/security.js. Same functions, browser-friendly:
// passwords are hashed with plain SHA-256 (fine for made-up demo accounts, never for real ones),
// and uploaded files are kept in this browser (IndexedDB), not encrypted on a server.
import { sha256 as jsSha } from 'js-sha256'
import { createStore, get, set, del, keys, clear } from 'idb-keyval'

export function hashPassword(pw) { return 'demo$' + jsSha('swan-demo-salt:' + pw) }
export function verifyPassword(pw, stored) { return Boolean(stored) && stored === hashPassword(pw) }

const COMMON = new Set(['password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwertyuiop', 'whiteswan', 'whiteswan1', 'letmein123', 'iloveyou1', 'football1'])
export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Use at least 10 characters.'
  if (pw.length > 200) return 'That password is too long.'
  if (COMMON.has(pw.toLowerCase())) return 'That password is too common. Pick something less guessable.'
  return null
}

const hex = (n) => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('')
export const newToken = () => hex(32)
export const sha256 = (s) => jsSha(typeof s === 'string' ? s : new Uint8Array(s))

const buckets = new Map()
export function rateLimit(key, limit, windowMs) {
  const now = Date.now()
  let b = buckets.get(key)
  if (!b || b.reset < now) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b) }
  b.count += 1
  return { ok: b.count <= limit, retryAfter: Math.ceil((b.reset - now) / 1000) }
}

// ---------- Files, kept in this browser ----------
let store = null
try { store = createStore('swan-staff-demo-files', 'files') } catch { store = null }
const files = new Map()
export async function loadFiles() {
  if (!store) return
  try { for (const k of await keys(store)) { const v = await get(k, store); if (v) files.set(k, Buffer.from(v)) } } catch { /* private mode etc. */ }
}
export async function clearFiles() { files.clear(); if (store) { try { await clear(store) } catch { /* ignore */ } } }

export function storeEncrypted(buffer) {
  const fileKey = hex(18)
  const b = Buffer.from(buffer)
  files.set(fileKey, b)
  if (store) set(fileKey, new Uint8Array(b), store).catch(() => {})
  return fileKey
}
export function readEncrypted(fileKey) {
  if (!/^[a-f0-9]{36}$/.test(fileKey)) throw new Error('bad file key')
  const b = files.get(fileKey)
  if (!b) throw new Error('file missing')
  return b
}
export function deleteStored(fileKey) {
  files.delete(fileKey)
  if (store) del(fileKey, store).catch(() => {})
}

export function sniffType(buf) {
  if (buf.subarray(0, 5).toString() === '%PDF-') return 'application/pdf'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  return null
}
export const safeFileName = (n) => String(n || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 120)
