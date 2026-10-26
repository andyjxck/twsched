import express from 'express'
import { z } from 'zod'
import { config } from './config.js'
import { q, one, tx } from './db.js'
import { hashPassword, verifyPassword, passwordProblem, newToken, sha256, rateLimit } from './security.js'
import { h, parse, bad, HttpError, audit } from './util.js'

const COOKIE = config.cookieSecure ? '__Host-swan_session' : 'swan_session'

function setSessionCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true, // JavaScript in the page can never read it
    secure: config.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: config.sessionDays * 86400000,
  })
}

// Loads the signed-in user from the session cookie, if any. Sliding expiry.
export const loadSession = h(async (req, res, next) => {
  const token = req.cookies?.[COOKIE]
  if (token && token.length < 100) {
    const s = await one(
      `SELECT s.token_hash, s.expires_at, u.id, u.email, u.full_name, u.phone, u.is_active
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`, [sha256(token)])
    if (s && s.is_active) {
      req.user = { id: s.id, email: s.email, full_name: s.full_name, phone: s.phone }
      req.sessionHash = s.token_hash
      if (Date.parse(s.expires_at) - Date.now() < (config.sessionDays - 1) * 86400000) {
        await q(`UPDATE sessions SET last_seen = now(), expires_at = now() + make_interval(days => $2) WHERE token_hash = $1`, [s.token_hash, config.sessionDays])
        setSessionCookie(res, token)
      }
    }
  }
  next()
})

export function requireUser(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in.'))
  next()
}

async function startSession(req, res, userId) {
  const token = newToken()
  await q(`INSERT INTO sessions(token_hash, user_id, expires_at, user_agent) VALUES ($1,$2, now() + make_interval(days => $3), $4)`,
    [sha256(token), userId, config.sessionDays, String(req.get('user-agent') || '').slice(0, 200)])
  setSessionCookie(res, token)
}

export const authRouter = express.Router()

authRouter.post('/login', h(async (req, res) => {
  const { email, password } = parse(z.object({ email: z.string().trim().toLowerCase().max(200), password: z.string().max(200) }), req.body)
  // Rate limits: per email+IP and per IP.
  const a = rateLimit(`login:${req.ip}:${email}`, 5, 15 * 60_000)
  const b = rateLimit(`login-ip:${req.ip}`, 30, 15 * 60_000)
  if (!a.ok || !b.ok) {
    res.set('Retry-After', String(Math.max(a.retryAfter, b.retryAfter)))
    throw new HttpError(429, 'Too many sign-in attempts. Wait a few minutes and try again.')
  }
  const u = await one('SELECT id, password_hash, is_active, locked_until FROM users WHERE email = $1', [email])
  const okPw = verifyPassword(password, u?.password_hash)
  if (u && u.locked_until && Date.parse(u.locked_until) > Date.now()) {
    throw new HttpError(429, 'This account is locked for a few minutes after too many wrong passwords.')
  }
  if (!u || !u.is_active || !okPw) {
    if (u) {
      await q(`UPDATE users SET failed_logins = failed_logins + 1,
                 locked_until = CASE WHEN failed_logins + 1 >= 10 THEN now() + interval '15 minutes' ELSE locked_until END
               WHERE id = $1`, [u.id])
      await q('INSERT INTO audit_log(actor_user_id, action, ip) VALUES ($1, $2, $3)', [u.id, 'login_failed', req.ip])
    }
    throw new HttpError(401, 'That email and password don\'t match.')
  }
  await q('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [u.id])
  await startSession(req, res, u.id)
  await q('INSERT INTO audit_log(actor_user_id, action, ip) VALUES ($1, $2, $3)', [u.id, 'login', req.ip])
  res.json({ ok: true })
}))

authRouter.post('/logout', h(async (req, res) => {
  if (req.sessionHash) await q('DELETE FROM sessions WHERE token_hash = $1', [req.sessionHash])
  res.clearCookie(COOKIE, { path: '/', secure: config.cookieSecure, httpOnly: true, sameSite: 'lax' })
  res.json({ ok: true })
}))

// Who am I, and which venues am I part of (with my role at each).
authRouter.get('/me', requireUser, h(async (req, res) => {
  const venues = await q(
    `SELECT m.id AS membership_id, m.role, m.can_view_documents, m.position, v.id, v.slug, v.name, v.positions
       FROM memberships m JOIN venues v ON v.id = m.venue_id
      WHERE m.user_id = $1 AND m.is_active ORDER BY v.id`, [req.user.id])
  res.json({ user: req.user, venues })
}))

authRouter.post('/password', requireUser, h(async (req, res) => {
  const { current, next } = parse(z.object({ current: z.string().max(200), next: z.string().max(200) }), req.body)
  const lim = rateLimit(`pw:${req.user.id}`, 5, 15 * 60_000)
  if (!lim.ok) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.')
  const u = await one('SELECT password_hash FROM users WHERE id = $1', [req.user.id])
  if (!verifyPassword(current, u.password_hash)) throw bad('Your current password isn\'t right.')
  const p = passwordProblem(next); if (p) throw bad(p)
  await q('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user.id, hashPassword(next)])
  // Sign out every other device.
  await q('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [req.user.id, req.sessionHash])
  await audit(req, 'password_changed', 'user', req.user.id)
  res.json({ ok: true })
}))

// Invite / reset links: a manager creates one, the person opens it and sets a password.
authRouter.get('/invite/:token', h(async (req, res) => {
  const lim = rateLimit(`invite:${req.ip}`, 30, 15 * 60_000)
  if (!lim.ok) throw new HttpError(429, 'Too many attempts.')
  const inv = await one(
    `SELECT i.purpose, u.full_name, u.email FROM invites i JOIN users u ON u.id = i.user_id
      WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.expires_at > now()`, [sha256(String(req.params.token))])
  if (!inv) throw new HttpError(404, 'This link has expired or was already used. Ask your manager for a new one.')
  res.json({ purpose: inv.purpose, full_name: inv.full_name, email: inv.email })
}))

authRouter.post('/invite/:token', h(async (req, res) => {
  const lim = rateLimit(`invite:${req.ip}`, 30, 15 * 60_000)
  if (!lim.ok) throw new HttpError(429, 'Too many attempts.')
  const { password } = parse(z.object({ password: z.string().max(200) }), req.body)
  const p = passwordProblem(password); if (p) throw bad(p)
  const userId = await tx(async (db) => {
    const inv = await db.one(
      `UPDATE invites SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id`,
      [sha256(String(req.params.token))])
    if (!inv) throw new HttpError(404, 'This link has expired or was already used. Ask your manager for a new one.')
    await db.q('UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL WHERE id = $1', [inv.user_id, hashPassword(password)])
    await db.q('DELETE FROM sessions WHERE user_id = $1', [inv.user_id])
    return inv.user_id
  })
  await startSession(req, res, userId)
  res.json({ ok: true })
}))

export async function createInviteLink(db, userId, purpose, createdBy) {
  const token = newToken()
  await db.q(`UPDATE invites SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [userId])
  await db.q(`INSERT INTO invites(user_id, token_hash, purpose, expires_at, created_by) VALUES ($1,$2,$3, now() + interval '7 days', $4)`,
    [userId, sha256(token), purpose, createdBy])
  return `/invite/${token}`
}
