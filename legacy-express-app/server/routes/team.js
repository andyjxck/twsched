// Team management: managers and owners only. This is the only place full staff details are shown.
import express from 'express'
import { z } from 'zod'
import { q, one, tx } from '../db.js'
import { need } from '../access.js'
import { h, parse, bad, notFound, forbidden, zDate, zId, zText, todayIn, audit } from '../util.js'
import { createInviteLink } from '../auth.js'
import { balanceFor } from './my.js'

export const team = express.Router({ mergeParams: true })
team.use(need('manager'))

team.get('/', h(async (req, res) => {
  res.json(await q(`SELECT m.id, u.full_name, u.email, u.phone, m.role, m.position, m.is_active, m.can_view_documents,
      (u.password_hash IS NOT NULL) AS has_password,
      p.holiday_type, p.days_per_week, p.hours_per_day, p.contracted_hours, p.start_date, p.leave_date, p.pay_rate
    FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN staff_profiles p ON p.membership_id=m.id
    WHERE m.venue_id=$1 ORDER BY m.is_active DESC, u.full_name`, [req.venue.id]))
}))

const profile = z.object({
  holiday_type: z.enum(['regular', 'irregular']).optional(),
  days_per_week: z.coerce.number().min(0).max(7).optional(),
  hours_per_day: z.coerce.number().min(0.5).max(24).optional(),
  contracted_hours: z.coerce.number().min(0).max(80).nullable().optional(),
  start_date: zDate.nullable().optional(),
  leave_date: zDate.nullable().optional(),
  pay_rate: z.coerce.number().min(0).max(1000).nullable().optional(),
})

team.post('/', h(async (req, res) => {
  const b = parse(profile.extend({
    full_name: zText(100).min(2),
    email: z.string().trim().toLowerCase().email().max(200),
    phone: zText(30).nullable().optional(),
    role: z.enum(['staff', 'supervisor', 'manager']).default('staff'),
    position: zText(60).nullable().optional(),
    opening_balance_hours: z.coerce.number().min(-500).max(500).optional(),
  }), req.body)
  if (b.role === 'manager' && req.m.role !== 'owner') throw forbidden('Only the owner can add managers.')
  const out = await tx(async (db) => {
    let u = await db.one('SELECT id FROM users WHERE email=$1', [b.email])
    if (!u) u = await db.one('INSERT INTO users(email, full_name, phone) VALUES ($1,$2,$3) RETURNING id', [b.email, b.full_name, b.phone ?? null])
    const exists = await db.one('SELECT id FROM memberships WHERE user_id=$1 AND venue_id=$2', [u.id, req.venue.id])
    if (exists) throw bad('That email is already on the team here.')
    const m = await db.one('INSERT INTO memberships(user_id, venue_id, role, position) VALUES ($1,$2,$3,$4) RETURNING id', [u.id, req.venue.id, b.role, b.position ?? null])
    await db.q(`INSERT INTO staff_profiles(membership_id, holiday_type, days_per_week, hours_per_day, contracted_hours, start_date, leave_date, pay_rate)
      VALUES ($1, coalesce($2,'regular'), coalesce($3,5), coalesce($4,8), $5, $6, $7, $8)`,
      [m.id, b.holiday_type ?? null, b.days_per_week ?? null, b.hours_per_day ?? null, b.contracted_hours ?? null, b.start_date ?? null, b.leave_date ?? null, b.pay_rate ?? null])
    if (b.opening_balance_hours) {
      await db.q(`INSERT INTO holiday_ledger(venue_id, membership_id, entry_date, kind, hours, note, created_by) VALUES ($1,$2,$3,'opening',$4,$5,$6)`,
        [req.venue.id, m.id, todayIn(req.venue.timezone), b.opening_balance_hours, 'Opening balance entered by a manager', req.m.id])
    }
    const link = await createInviteLink(db, u.id, 'invite', req.user.id)
    return { id: m.id, invite_link: link }
  })
  await audit(req, 'member_added', 'membership', out.id, { role: b.role })
  res.json(out)
}))

team.patch('/:mid', h(async (req, res) => {
  const mid = parse(zId, req.params.mid)
  const b = parse(profile.extend({
    full_name: zText(100).min(2).optional(),
    phone: zText(30).nullable().optional(),
    role: z.enum(['staff', 'supervisor', 'manager']).optional(),
    position: zText(60).nullable().optional(),
    is_active: z.boolean().optional(),
    can_view_documents: z.boolean().optional(),
  }), req.body)
  const m = await one('SELECT m.id, m.user_id, m.role FROM memberships m WHERE m.id=$1 AND m.venue_id=$2', [mid, req.venue.id])
  if (!m) throw notFound()
  const isOwner = req.m.role === 'owner'
  if (!isOwner && mid !== req.m.id && (m.role === 'owner' || m.role === 'manager')) throw forbidden('Only the owner can change other managers.')
  if (!isOwner && (b.role === 'manager' || b.can_view_documents !== undefined)) throw forbidden('Only the owner can make managers or give document access.')
  if (mid === req.m.id && (b.is_active === false || b.role)) throw bad('You can\'t change your own role or switch yourself off.')
  await tx(async (db) => {
    if (b.full_name || b.phone !== undefined) await db.q('UPDATE users SET full_name=coalesce($2,full_name), phone=CASE WHEN $4 THEN $3 ELSE phone END WHERE id=$1', [m.user_id, b.full_name ?? null, b.phone ?? null, b.phone !== undefined])
    await db.q(`UPDATE memberships SET role=coalesce($2,role), position=CASE WHEN $6 THEN $3 ELSE position END, is_active=coalesce($4,is_active), can_view_documents=coalesce($5,can_view_documents) WHERE id=$1`,
      [mid, b.role ?? null, b.position ?? null, b.is_active ?? null, b.can_view_documents ?? null, b.position !== undefined])
    const fields = ['holiday_type', 'days_per_week', 'hours_per_day', 'contracted_hours', 'start_date', 'leave_date', 'pay_rate'].filter((f) => b[f] !== undefined)
    if (fields.length) {
      await db.q('INSERT INTO staff_profiles(membership_id) VALUES ($1) ON CONFLICT DO NOTHING', [mid])
      await db.q(`UPDATE staff_profiles SET ${fields.map((f, i) => `${f}=$${i + 2}`).join(', ')} WHERE membership_id=$1`, [mid, ...fields.map((f) => b[f])])
    }
    if (b.is_active === false) await db.q('DELETE FROM sessions WHERE user_id=$1 AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id=$1 AND is_active)', [m.user_id])
  })
  await audit(req, 'member_updated', 'membership', mid, Object.keys(b))
  res.json({ ok: true })
}))

team.post('/:mid/reset-link', h(async (req, res) => {
  const mid = parse(zId, req.params.mid)
  const m = await one('SELECT user_id, role, (SELECT password_hash IS NOT NULL FROM users WHERE id=user_id) AS has_pw FROM memberships WHERE id=$1 AND venue_id=$2', [mid, req.venue.id])
  if (!m) throw notFound()
  if ((m.role === 'manager' || m.role === 'owner') && req.m.role !== 'owner') throw forbidden('Only the owner can reset a manager\'s password.')
  const link = await tx((db) => createInviteLink(db, m.user_id, m.has_pw ? 'reset' : 'invite', req.user.id))
  await audit(req, 'reset_link_created', 'membership', mid)
  res.json({ link })
}))

team.get('/:mid/holiday', h(async (req, res) => {
  const mid = parse(zId, req.params.mid)
  if (!(await one('SELECT 1 FROM memberships WHERE id=$1 AND venue_id=$2', [mid, req.venue.id]))) throw notFound()
  res.json(await balanceFor(req.venue, mid))
}))

team.post('/:mid/ledger', h(async (req, res) => {
  const mid = parse(zId, req.params.mid)
  const b = parse(z.object({ kind: z.enum(['opening', 'carry_over', 'adjustment']), hours: z.coerce.number().min(-500).max(500), note: zText(300).min(3) }), req.body)
  if (!(await one('SELECT 1 FROM memberships WHERE id=$1 AND venue_id=$2', [mid, req.venue.id]))) throw notFound()
  await q(`INSERT INTO holiday_ledger(venue_id, membership_id, entry_date, kind, hours, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [req.venue.id, mid, todayIn(req.venue.timezone), b.kind, b.hours, b.note, req.m.id])
  await audit(req, 'holiday_ledger_entry', 'membership', mid, b)
  res.json({ ok: true })
}))
