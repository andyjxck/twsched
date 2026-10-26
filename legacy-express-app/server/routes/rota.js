import express from 'express'
import { z } from 'zod'
import { q, one, tx } from '../db.js'
import { need, isLead, isManager } from '../access.js'
import { h, parse, bad, notFound, zDate, zTime, zId, zText, mondayOf, addDays, isoWeekday, notify, audit, fmtShift } from '../util.js'

export const rota = express.Router({ mergeParams: true })

const SHIFT_COLS = `s.id, s.membership_id, s.shift_date, to_char(s.start_time,'HH24:MI') AS start_time, to_char(s.end_time,'HH24:MI') AS end_time,
  s.break_minutes, s.position, s.notes, to_char(s.actual_start,'HH24:MI') AS actual_start, to_char(s.actual_end,'HH24:MI') AS actual_end,
  s.actual_break_minutes, s.confirmed_at, s.edited_after_publish`

// Warnings shown while building the rota: time off, unavailability, double booking, weekly hours.
export async function shiftWarnings(venue, s, ignoreShiftId = null) {
  if (!s.membership_id) return []
  const w = []
  const off = await q(`SELECT status FROM time_off_requests WHERE membership_id=$1 AND status IN ('approved','pending','cancel_pending') AND $2::date BETWEEN start_date AND end_date`, [s.membership_id, s.shift_date])
  if (off.some((o) => o.status !== 'pending')) w.push({ type: 'time_off', text: 'Booked off on holiday that day' })
  else if (off.length) w.push({ type: 'time_off_pending', text: 'Has a time off request pending for that day' })
  const un = await q(`SELECT 1 FROM unavailability WHERE membership_id=$1 AND status='active' AND $2::date BETWEEN start_date AND end_date AND (weekday IS NULL OR weekday=$3)`, [s.membership_id, s.shift_date, isoWeekday(s.shift_date)])
  if (un.length) w.push({ type: 'unavailable', text: 'Marked unavailable that day' })
  const dbl = await q(`SELECT o.id FROM shifts o, shift_bounds(o.shift_date,o.start_time,o.end_time,$5) ob, shift_bounds($2::date,$3::time,$4::time,$5) nb
     WHERE o.membership_id=$1 AND o.id <> coalesce($6,0) AND o.shift_date BETWEEN $2::date - 1 AND $2::date + 1
       AND tstzrange(ob.starts, ob.ends) && tstzrange(nb.starts, nb.ends)`, [s.membership_id, s.shift_date, s.start_time, s.end_time, venue.timezone, ignoreShiftId])
  if (dbl.length) w.push({ type: 'double_booked', text: 'Already on another shift at that time' })
  const wk = mondayOf(s.shift_date)
  const tot = await one(`SELECT coalesce(sum(shift_hours(shift_date,start_time,end_time,break_minutes,$4)),0) AS h FROM shifts WHERE membership_id=$1 AND shift_date BETWEEN $2::date AND $3::date AND id <> coalesce($5,0)`, [s.membership_id, wk, addDays(wk, 6), venue.timezone, ignoreShiftId])
  const thisH = await one(`SELECT shift_hours($1::date,$2::time,$3::time,$4,$5) AS h`, [s.shift_date, s.start_time, s.end_time, s.break_minutes || 0, venue.timezone])
  const prof = await one('SELECT contracted_hours FROM staff_profiles WHERE membership_id=$1', [s.membership_id])
  const total = Number(tot.h) + Number(thisH.h)
  if (total > Number(venue.weeklyHoursLimit)) w.push({ type: 'overtime', text: `${total}h this week, over the ${venue.weeklyHoursLimit}h limit` })
  else if (prof?.contracted_hours && total > Number(prof.contracted_hours)) w.push({ type: 'over_contract', text: `${total}h this week, over their contracted ${prof.contracted_hours}h` })
  return w
}

// Swaps that depend on a shift are voided when the shift is edited or deleted.
async function voidSwaps(db, venueId, shiftId) {
  const v = await db.q(`UPDATE swap_requests SET status='void' WHERE (from_shift_id=$1 OR offered_shift_id=$1) AND status IN ('sent','awaiting_manager') RETURNING from_membership_id, to_membership_id`, [shiftId])
  for (const s of v) await notify(db, venueId, [s.from_membership_id, s.to_membership_id], 'swap_void', 'A swap request was cancelled because the shift changed.', '/requests')
}

const weekStatus = async (venueId, weekStart) =>
  (await one('SELECT status, published_at FROM rota_weeks WHERE venue_id=$1 AND week_start=$2', [venueId, weekStart])) || { status: 'draft', published_at: null }

// Full week view: supervisors (read-only) and managers.
rota.get('/', need('supervisor'), h(async (req, res) => {
  const week = mondayOf(parse(zDate, req.query.week || new Date().toISOString().slice(0, 10)))
  const end = addDays(week, 6)
  const v = req.venue
  const mgr = isManager(req)
  const people = await q(
    `SELECT m.id, u.full_name, m.role, m.position, p.contracted_hours ${mgr ? ', p.pay_rate' : ''}
       FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN staff_profiles p ON p.membership_id=m.id
      WHERE m.venue_id=$1 AND m.is_active AND m.role <> 'owner' ORDER BY m.role='staff', u.full_name`, [v.id])
  const shifts = await q(`SELECT ${SHIFT_COLS}, shift_hours(s.shift_date,s.start_time,s.end_time,s.break_minutes,$4) AS hours
      FROM shifts s WHERE s.venue_id=$1 AND s.shift_date BETWEEN $2 AND $3 ORDER BY s.start_time`, [v.id, week, end, v.timezone])
  const timeOff = await q(`SELECT id, membership_id, start_date, end_date, status ${mgr ? ', note' : ''} FROM time_off_requests
      WHERE venue_id=$1 AND status IN ('approved','pending','cancel_pending') AND start_date <= $3 AND end_date >= $2`, [v.id, week, end])
  const unavailable = await q(`SELECT id, membership_id, start_date, end_date, weekday ${mgr ? ', note' : ''} FROM unavailability
      WHERE venue_id=$1 AND status='active' AND start_date <= $3 AND end_date >= $2`, [v.id, week, end])
  const templates = await q(`SELECT id, name, to_char(start_time,'HH24:MI') AS start_time, to_char(end_time,'HH24:MI') AS end_time, break_minutes, position FROM shift_templates WHERE venue_id=$1 ORDER BY start_time`, [v.id])
  const blackouts = await q('SELECT id, start_date, end_date, label FROM blackout_dates WHERE venue_id=$1 AND start_date <= $3 AND end_date >= $2', [v.id, week, end])
  let costs = null
  if (mgr) {
    const rate = Object.fromEntries(people.map((p) => [p.id, Number(p.pay_rate || 0)]))
    const byDay = {}
    for (const s of shifts) if (s.membership_id) byDay[s.shift_date] = (byDay[s.shift_date] || 0) + Number(s.hours) * (rate[s.membership_id] || 0)
    costs = { byDay, total: Object.values(byDay).reduce((a, b) => a + b, 0) }
  }
  res.json({ week, ...(await weekStatus(v.id, week)), people, shifts, timeOff, unavailable, templates, blackouts, costs, weeklyHoursLimit: v.weeklyHoursLimit, positions: v.positions, canEdit: mgr })
}))

const shiftBody = z.object({
  membership_id: zId.nullable().optional(),
  shift_date: zDate,
  start_time: zTime,
  end_time: zTime,
  break_minutes: z.coerce.number().int().min(0).max(240).default(0),
  position: zText(60).nullable().optional(),
  notes: zText(300).nullable().optional(),
})

async function assertMember(venueId, membershipId) {
  if (!membershipId) return
  const m = await one('SELECT 1 FROM memberships WHERE id=$1 AND venue_id=$2 AND is_active', [membershipId, venueId])
  if (!m) throw bad('That person isn\'t on the team at this venue.')
}

async function afterPublishedChange(db, req, shift, peopleToTell, text) {
  const ws = await db.one('SELECT status FROM rota_weeks WHERE venue_id=$1 AND week_start=$2', [req.venue.id, mondayOf(shift.shift_date)])
  if (ws?.status === 'published') {
    await db.q('UPDATE shifts SET edited_after_publish=true WHERE id=$1', [shift.id]).catch(() => {})
    await notify(db, req.venue.id, peopleToTell, 'rota_changed', text, '/')
  }
}

rota.post('/shifts', need('manager'), h(async (req, res) => {
  const b = parse(shiftBody, req.body)
  await assertMember(req.venue.id, b.membership_id)
  const warnings = await shiftWarnings(req.venue, b)
  const s = await tx(async (db) => {
    const s = await db.one(`INSERT INTO shifts(venue_id, membership_id, shift_date, start_time, end_time, break_minutes, position, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, shift_date, to_char(start_time,'HH24:MI') AS start_time, to_char(end_time,'HH24:MI') AS end_time, position`,
      [req.venue.id, b.membership_id ?? null, b.shift_date, b.start_time, b.end_time, b.break_minutes, b.position ?? null, b.notes ?? null])
    await afterPublishedChange(db, req, s, [b.membership_id], `New shift added: ${fmtShift(s)}`)
    return s
  })
  res.json({ id: s.id, warnings })
}))

rota.patch('/shifts/:id', need('manager'), h(async (req, res) => {
  const id = parse(zId, req.params.id)
  const cur = await one(`SELECT ${SHIFT_COLS} FROM shifts s WHERE s.id=$1 AND s.venue_id=$2`, [id, req.venue.id])
  if (!cur) throw notFound()
  const b = parse(shiftBody.partial(), req.body)
  const next = { ...cur, ...b }
  await assertMember(req.venue.id, next.membership_id)
  const warnings = await shiftWarnings(req.venue, next, id)
  await tx(async (db) => {
    await db.q(`UPDATE shifts SET membership_id=$2, shift_date=$3, start_time=$4, end_time=$5, break_minutes=$6, position=$7, notes=$8, updated_at=now() WHERE id=$1`,
      [id, next.membership_id ?? null, next.shift_date, next.start_time, next.end_time, next.break_minutes, next.position ?? null, next.notes ?? null])
    await voidSwaps(db, req.venue.id, id)
    await afterPublishedChange(db, req, { ...next, id }, [cur.membership_id, next.membership_id], `Shift changed: now ${fmtShift(next)}`)
  })
  res.json({ ok: true, warnings })
}))

rota.delete('/shifts/:id', need('manager'), h(async (req, res) => {
  const id = parse(zId, req.params.id)
  const cur = await one(`SELECT ${SHIFT_COLS} FROM shifts s WHERE s.id=$1 AND s.venue_id=$2`, [id, req.venue.id])
  if (!cur) throw notFound()
  await tx(async (db) => {
    await voidSwaps(db, req.venue.id, id)
    const ws = await db.one('SELECT status FROM rota_weeks WHERE venue_id=$1 AND week_start=$2', [req.venue.id, mondayOf(cur.shift_date)])
    if (ws?.status === 'published') await notify(db, req.venue.id, [cur.membership_id], 'rota_changed', `Shift removed: ${fmtShift(cur)}`, '/')
    await db.q('DELETE FROM shifts WHERE id=$1', [id])
  })
  res.json({ ok: true })
}))

// After the shift: the manager confirms the real times. Feeds holiday accrual and labour cost.
rota.post('/shifts/:id/confirm', need('manager'), h(async (req, res) => {
  const id = parse(zId, req.params.id)
  const b = parse(z.object({ actual_start: zTime, actual_end: zTime, actual_break_minutes: z.coerce.number().int().min(0).max(240).default(0) }), req.body)
  const r = await q(`UPDATE shifts SET actual_start=$3, actual_end=$4, actual_break_minutes=$5, confirmed_at=now(), confirmed_by=$6 WHERE id=$1 AND venue_id=$2 AND membership_id IS NOT NULL RETURNING id`,
    [id, req.venue.id, b.actual_start, b.actual_end, b.actual_break_minutes, req.m.id])
  if (!r.length) throw notFound()
  res.json({ ok: true })
}))

rota.post('/publish', need('manager'), h(async (req, res) => {
  const week = mondayOf(parse(zDate, req.body?.week))
  const n = await tx(async (db) => {
    await db.q(`INSERT INTO rota_weeks(venue_id, week_start, status, published_at) VALUES ($1,$2,'published',now())
      ON CONFLICT (venue_id, week_start) DO UPDATE SET status='published', published_at=now()`, [req.venue.id, week])
    await db.q('UPDATE shifts SET edited_after_publish=false WHERE venue_id=$1 AND shift_date BETWEEN $2 AND $3', [req.venue.id, week, addDays(week, 6)])
    const people = (await db.q('SELECT DISTINCT membership_id FROM shifts WHERE venue_id=$1 AND shift_date BETWEEN $2 AND $3 AND membership_id IS NOT NULL', [req.venue.id, week, addDays(week, 6)])).map((r) => r.membership_id)
    const label = new Date(week + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    await notify(db, req.venue.id, people, 'rota_published', `The rota for the week of ${label} is out.`, '/')
    return people.length
  })
  await audit(req, 'rota_published', 'week', null, { week })
  res.json({ ok: true, notified: n })
}))

rota.post('/unpublish', need('manager'), h(async (req, res) => {
  const week = mondayOf(parse(zDate, req.body?.week))
  await q(`UPDATE rota_weeks SET status='draft' WHERE venue_id=$1 AND week_start=$2`, [req.venue.id, week])
  res.json({ ok: true })
}))

rota.post('/copy', need('manager'), h(async (req, res) => {
  const b = parse(z.object({ from_week: zDate, to_week: zDate }), req.body)
  const from = mondayOf(b.from_week), to = mondayOf(b.to_week)
  if (from === to) throw bad('Pick a different week to copy into.')
  const r = await q(`INSERT INTO shifts(venue_id, membership_id, shift_date, start_time, end_time, break_minutes, position, notes)
      SELECT s.venue_id, CASE WHEN m.is_active THEN s.membership_id END, s.shift_date + ($4::date - $2::date), s.start_time, s.end_time, s.break_minutes, s.position, s.notes
        FROM shifts s LEFT JOIN memberships m ON m.id = s.membership_id
       WHERE s.venue_id=$1 AND s.shift_date BETWEEN $2 AND $3 RETURNING id`, [req.venue.id, from, addDays(from, 6), to])
  res.json({ ok: true, copied: r.length })
}))

rota.post('/templates', need('manager'), h(async (req, res) => {
  const b = parse(z.object({ name: zText(60).min(1), start_time: zTime, end_time: zTime, break_minutes: z.coerce.number().int().min(0).max(240).default(0), position: zText(60).nullable().optional() }), req.body)
  const r = await one('INSERT INTO shift_templates(venue_id, name, start_time, end_time, break_minutes, position) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [req.venue.id, b.name, b.start_time, b.end_time, b.break_minutes, b.position ?? null])
  res.json(r)
}))
rota.delete('/templates/:id', need('manager'), h(async (req, res) => {
  await q('DELETE FROM shift_templates WHERE id=$1 AND venue_id=$2', [parse(zId, req.params.id), req.venue.id])
  res.json({ ok: true })
}))

// ---------- Staff: my own shifts, plus who else is on with me ----------
// Only shifts in published weeks. Coworkers = first name and role of anyone whose shift overlaps mine.
export const PUBLISHED = (alias) => `EXISTS (SELECT 1 FROM rota_weeks w WHERE w.venue_id=${alias}.venue_id AND w.week_start=date_trunc('week', ${alias}.shift_date)::date AND w.status='published')`

export async function myShifts(req, from, to) {
  return q(
    `SELECT ${SHIFT_COLS}, shift_hours(s.shift_date,s.start_time,s.end_time,s.break_minutes,$5) AS hours,
       (SELECT coalesce(json_agg(json_build_object('name', split_part(u.full_name,' ',1), 'position', o.position) ORDER BY o.start_time), '[]')
          FROM shifts o JOIN memberships om ON om.id=o.membership_id JOIN users u ON u.id=om.user_id,
               shift_bounds(o.shift_date,o.start_time,o.end_time,$5) ob, shift_bounds(s.shift_date,s.start_time,s.end_time,$5) sb
         WHERE o.venue_id=s.venue_id AND o.id<>s.id AND o.membership_id<>s.membership_id
           AND o.shift_date BETWEEN s.shift_date - 1 AND s.shift_date + 1
           AND tstzrange(ob.starts,ob.ends) && tstzrange(sb.starts,sb.ends) AND ${PUBLISHED('o')}) AS on_with_me,
       (SELECT json_build_object('id',x.id,'status',x.status,'kind',x.kind) FROM swap_requests x WHERE x.from_shift_id=s.id AND x.status IN ('sent','awaiting_manager') LIMIT 1) AS open_swap,
       (SELECT json_build_object('id',p.id,'status',p.status) FROM shift_problems p WHERE p.shift_id=s.id AND p.status='open' LIMIT 1) AS open_problem
     FROM shifts s
    WHERE s.venue_id=$1 AND s.membership_id=$2 AND s.shift_date BETWEEN $3 AND $4 AND ${PUBLISHED('s')}
    ORDER BY s.shift_date, s.start_time`, [req.venue.id, req.m.id, from, to, req.venue.timezone])
}
