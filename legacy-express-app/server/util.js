import { z } from 'zod'
import { q } from './db.js'

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra }
}
export const bad = (m, extra) => new HttpError(400, m, extra)
export const forbidden = (m = 'You don\'t have access to that.') => new HttpError(403, m)
export const notFound = (m = 'Not found.') => new HttpError(404, m)

// Wrap async route handlers so thrown errors reach the error handler.
export const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

// Validate input against a zod schema; a failure becomes a 400 with a readable message.
export function parse(schema, data) {
  const r = schema.safeParse(data)
  if (!r.success) {
    const i = r.error.issues[0]
    throw bad(`${i.path.join('.') || 'input'}: ${i.message}`)
  }
  return r.data
}

export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD').refine((s) => !Number.isNaN(Date.parse(s + 'T00:00:00Z')), 'not a real date')
export const zTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:00)?$/, 'use HH:MM')
export const zId = z.coerce.number().int().positive()
export const zText = (max = 500) => z.string().trim().max(max)

// ---------- Dates as plain 'YYYY-MM-DD' strings ----------
export function todayIn(tz = 'Europe/London') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}
export function mondayOf(iso) {
  const d = new Date(iso + 'T00:00:00Z'); const dow = (d.getUTCDay() + 6) % 7; return addDays(iso, -dow)
}
export function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000) }
export const isoWeekday = (iso) => ((new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1
export const hhmm = (t) => (t ? String(t).slice(0, 5) : t)

export async function audit(req, action, targetType, targetId, detail) {
  await q('INSERT INTO audit_log(venue_id, actor_user_id, action, target_type, target_id, detail, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [req.venue?.id ?? null, req.user?.id ?? null, action, targetType ?? null, targetId ?? null, detail ? JSON.stringify(detail) : null, req.ip])
}

// In-app notifications. Web push / email are a later step; this is what the bell shows.
export async function notify(db, venueId, membershipIds, kind, body, link = null) {
  const ids = [...new Set(membershipIds.filter(Boolean))]
  for (const id of ids) {
    await db.q('INSERT INTO notifications(venue_id, membership_id, kind, body, link) VALUES ($1,$2,$3,$4,$5)', [venueId, id, kind, body, link])
  }
}
export async function managerIds(db, venueId, includeSupervisors = false) {
  const roles = includeSupervisors ? ['owner', 'manager', 'supervisor'] : ['owner', 'manager']
  return (await db.q('SELECT id FROM memberships WHERE venue_id=$1 AND is_active AND role = ANY($2)', [venueId, roles])).map((r) => r.id)
}

export const firstName = (full) => String(full || '').trim().split(/\s+/)[0]
export function fmtShift(s) {
  const d = new Date(s.shift_date + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
  return `${d} ${hhmm(s.start_time)}–${hhmm(s.end_time)}${s.position ? ' ' + s.position : ''}`
}
