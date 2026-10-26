// Everything a team member does for themselves. Every query is filtered by req.m.id (their own
// membership at this venue), so nobody can read or act on someone else's records from here.
import express from 'express'
import { z } from 'zod'
import { q, one, tx } from '../db.js'
import { h, parse, bad, notFound, forbidden, zDate, zId, zText, todayIn, addDays, daysBetween, isoWeekday, notify, managerIds, firstName, fmtShift, HttpError } from '../util.js'
import { myShifts, PUBLISHED } from './rota.js'
import { computeBalance, noticeWarning } from '../holiday.js'
import { readEncrypted } from '../security.js'

export const my = express.Router({ mergeParams: true })

my.get('/shifts', h(async (req, res) => {
  const today = todayIn(req.venue.timezone)
  const from = req.query.from ? parse(zDate, req.query.from) : addDays(today, -7)
  const to = req.query.to ? parse(zDate, req.query.to) : addDays(today, 42)
  if (daysBetween(from, to) > 120 || daysBetween(from, to) < 0) throw bad('Pick a shorter date range.')
  res.json({ today, shifts: await myShifts(req, from, to) })
}))

// ---------- Holiday balance ----------
export async function balanceFor(venue, membershipId) {
  const today = todayIn(venue.timezone)
  const profile = (await one('SELECT * FROM staff_profiles WHERE membership_id=$1', [membershipId])) || { holiday_type: 'regular', days_per_week: 5, hours_per_day: 8 }
  const confirmed = await q(`SELECT shift_date, shift_hours(shift_date, actual_start, actual_end, coalesce(actual_break_minutes,0), $2) AS hours
      FROM shifts WHERE membership_id=$1 AND confirmed_at IS NOT NULL`, [membershipId, venue.timezone])
  const ledger = await q('SELECT kind, hours, note, entry_date FROM holiday_ledger WHERE membership_id=$1 ORDER BY entry_date, id', [membershipId])
  const requests = await q(`SELECT start_date, end_date, hours, status, kind FROM time_off_requests WHERE membership_id=$1 AND status IN ('approved','pending','cancel_pending')`, [membershipId])
  return computeBalance(profile, { today, leaveYearStartMonth: venue.leaveYearStartMonth }, confirmed, ledger, requests)
}

my.get('/holiday', h(async (req, res) => res.json(await balanceFor(req.venue, req.m.id))))

// ---------- Time off ----------
const timeOffBody = z.object({
  kind: z.enum(['holiday', 'unpaid']).default('holiday'),
  start_date: zDate,
  end_date: zDate,
  hours: z.coerce.number().min(0).max(1000).nullable().optional(),
  note: zText(500).nullable().optional(),
})

async function timeOffCheck(req, b) {
  const today = todayIn(req.venue.timezone)
  if (b.end_date < b.start_date) throw bad('The end date is before the start date.')
  if (b.start_date < today) throw bad('Time off has to start today or later.')
  if (daysBetween(b.start_date, b.end_date) > 60) throw bad('That\'s over two months. Ask a manager directly for long leave.')
  const prof = await one('SELECT hours_per_day FROM staff_profiles WHERE membership_id=$1', [req.m.id])
  const days = daysBetween(b.start_date, b.end_date) + 1
  const hours = b.hours ?? days * Number(prof?.hours_per_day || 8)
  const warnings = []
  const n = noticeWarning(today, b.start_date, b.end_date); if (n) warnings.push(n)
  const bl = await q('SELECT label, start_date, end_date FROM blackout_dates WHERE venue_id=$1 AND start_date <= $3 AND end_date >= $2', [req.venue.id, b.start_date, b.end_date])
  for (const x of bl) warnings.push(`${x.label} (${x.start_date} to ${x.end_date}) is a blackout period, so this is likely to be declined.`)
  const clash = await q(`SELECT 1 FROM time_off_requests WHERE membership_id=$1 AND status IN ('pending','approved','cancel_pending') AND start_date <= $3 AND end_date >= $2`, [req.m.id, b.start_date, b.end_date])
  if (clash.length) throw bad('You already have time off requested for some of those days.')
  const bal = await balanceFor(req.venue, req.m.id)
  if (b.kind === 'holiday' && hours > bal.remaining + 0.001) warnings.push(`This is ${hours}h but you have ${Math.round(bal.remaining * 10) / 10}h left.`)
  const rostered = await q(`SELECT shift_date FROM shifts s WHERE s.membership_id=$1 AND s.shift_date BETWEEN $2 AND $3 AND ${PUBLISHED('s')}`, [req.m.id, b.start_date, b.end_date])
  if (rostered.length) warnings.push(`You're already on the rota for ${rostered.length} shift${rostered.length > 1 ? 's' : ''} in those dates. If approved, a manager will sort cover.`)
  return { hours, warnings, balance: bal }
}

my.get('/time-off', h(async (req, res) => {
  res.json(await q(`SELECT id, kind, start_date, end_date, hours, note, status, decision_reason, decided_at, created_at FROM time_off_requests WHERE membership_id=$1 ORDER BY start_date DESC LIMIT 100`, [req.m.id]))
}))

my.post('/time-off/preview', h(async (req, res) => {
  const b = parse(timeOffBody, req.body)
  const r = await timeOffCheck(req, b)
  res.json({ hours: r.hours, warnings: r.warnings, remaining: r.balance.remaining, remaining_after: b.kind === 'holiday' ? r.balance.remaining - r.hours : r.balance.remaining })
}))

my.post('/time-off', h(async (req, res) => {
  const b = parse(timeOffBody, req.body)
  const r = await timeOffCheck(req, b)
  const row = await tx(async (db) => {
    const row = await db.one(`INSERT INTO time_off_requests(venue_id, membership_id, kind, start_date, end_date, hours, note) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [req.venue.id, req.m.id, b.kind, b.start_date, b.end_date, r.hours, b.note ?? null])
    await notify(db, req.venue.id, await managerIds(db, req.venue.id), 'request', `${firstName(req.user.full_name)} asked for time off ${b.start_date}${b.end_date !== b.start_date ? ' to ' + b.end_date : ''}.`, '/inbox')
    return row
  })
  res.json({ id: row.id, warnings: r.warnings })
}))

my.post('/time-off/:id/withdraw', h(async (req, res) => {
  const r = await q(`UPDATE time_off_requests SET status='withdrawn' WHERE id=$1 AND membership_id=$2 AND status='pending' RETURNING id`, [parse(zId, req.params.id), req.m.id])
  if (!r.length) throw bad('Only a pending request can be withdrawn.')
  res.json({ ok: true })
}))

// Cancelling approved leave changes the rota, so it goes back to a manager.
my.post('/time-off/:id/cancel', h(async (req, res) => {
  const id = parse(zId, req.params.id)
  const r = await tx(async (db) => {
    const r = await db.q(`UPDATE time_off_requests SET status='cancel_pending' WHERE id=$1 AND membership_id=$2 AND status='approved' AND end_date >= $3 RETURNING start_date`, [id, req.m.id, todayIn(req.venue.timezone)])
    if (r.length) await notify(db, req.venue.id, await managerIds(db, req.venue.id), 'request', `${firstName(req.user.full_name)} wants to cancel their approved time off from ${r[0].start_date}.`, '/inbox')
    return r
  })
  if (!r.length) throw bad('Only approved time off that hasn\'t finished can be cancelled.')
  res.json({ ok: true })
}))

// ---------- Unavailability: no approval needed ----------
my.get('/unavailability', h(async (req, res) => {
  res.json(await q(`SELECT id, start_date, end_date, weekday, note FROM unavailability WHERE membership_id=$1 AND status='active' AND end_date >= $2 ORDER BY start_date`, [req.m.id, todayIn(req.venue.timezone)]))
}))

my.post('/unavailability', h(async (req, res) => {
  const b = parse(z.object({ start_date: zDate, end_date: zDate, weekday: z.coerce.number().int().min(1).max(7).nullable().optional(), note: zText(300).nullable().optional() }), req.body)
  if (b.end_date < b.start_date) throw bad('The end date is before the start date.')
  if (b.start_date < todayIn(req.venue.timezone)) throw bad('Pick today or a later date.')
  if (daysBetween(b.start_date, b.end_date) > 366) throw bad('Keep it to a year or less.')
  const rostered = (await q(`SELECT s.shift_date, to_char(s.start_time,'HH24:MI') AS start_time, to_char(s.end_time,'HH24:MI') AS end_time, s.position FROM shifts s WHERE s.membership_id=$1 AND s.shift_date BETWEEN $2 AND $3 AND ${PUBLISHED('s')}`, [req.m.id, b.start_date, b.end_date]))
    .filter((s) => !b.weekday || isoWeekday(s.shift_date) === b.weekday)
  if (rostered.length) {
    throw new HttpError(409, `You're already on the rota then (${rostered.map(fmtShift).join(', ')}). Ask for time off or raise a problem on that shift instead.`)
  }
  const r = await one('INSERT INTO unavailability(venue_id, membership_id, start_date, end_date, weekday, note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [req.venue.id, req.m.id, b.start_date, b.end_date, b.weekday ?? null, b.note ?? null])
  res.json(r)
}))

my.delete('/unavailability/:id', h(async (req, res) => {
  const r = await q(`UPDATE unavailability SET status='removed' WHERE id=$1 AND membership_id=$2 RETURNING id`, [parse(zId, req.params.id), req.m.id])
  if (!r.length) throw notFound()
  res.json({ ok: true })
}))

// ---------- Shift swaps: A asks B, B accepts, a manager approves ----------
async function ownShift(req, shiftId, db = { one }) {
  const s = await db.one(`SELECT s.id, s.shift_date, to_char(s.start_time,'HH24:MI') AS start_time, to_char(s.end_time,'HH24:MI') AS end_time, s.position, s.membership_id
      FROM shifts s WHERE s.id=$1 AND s.venue_id=$2 AND s.membership_id=$3 AND ${PUBLISHED('s')}`, [shiftId, req.venue.id, req.m.id])
  if (!s) throw notFound('That isn\'t one of your published shifts.')
  return s
}

// Is person X free for shift S? Not working, not off, not unavailable. Only a yes/no leaves the server.
async function isFree(venue, membershipId, s, ignoreShiftId = null) {
  const busy = await one(`SELECT 1 FROM shifts o, shift_bounds(o.shift_date,o.start_time,o.end_time,$5) ob, shift_bounds($2::date,$3::time,$4::time,$5) nb
      WHERE o.membership_id=$1 AND o.id <> coalesce($6,0) AND o.shift_date BETWEEN $2::date - 1 AND $2::date + 1 AND tstzrange(ob.starts,ob.ends) && tstzrange(nb.starts,nb.ends) LIMIT 1`,
    [membershipId, s.shift_date, s.start_time, s.end_time, venue.timezone, ignoreShiftId])
  if (busy) return false
  const off = await one(`SELECT 1 FROM time_off_requests WHERE membership_id=$1 AND status IN ('approved','cancel_pending') AND $2::date BETWEEN start_date AND end_date LIMIT 1`, [membershipId, s.shift_date])
  if (off) return false
  const un = await one(`SELECT 1 FROM unavailability WHERE membership_id=$1 AND status='active' AND $2::date BETWEEN start_date AND end_date AND (weekday IS NULL OR weekday=$3) LIMIT 1`, [membershipId, s.shift_date, isoWeekday(s.shift_date)])
  return !un
}

my.get('/swaps/colleagues', h(async (req, res) => {
  const s = await ownShift(req, parse(zId, req.query.shift_id))
  const people = await q(`SELECT m.id, u.full_name FROM memberships m JOIN users u ON u.id=m.user_id
      WHERE m.venue_id=$1 AND m.is_active AND m.id <> $2 AND m.role IN ('staff','supervisor') ORDER BY u.full_name`, [req.venue.id, req.m.id])
  const out = []
  for (const p of people) {
    const parts = p.full_name.trim().split(/\s+/)
    out.push({ id: p.id, name: parts[0] + (parts[1] ? ' ' + parts[1][0] + '.' : ''), free: await isFree(req.venue, p.id, s) })
  }
  res.json(out)
}))

const SWAP_VIEW = `SELECT x.id, x.kind, x.status, x.note, x.created_at, x.decision_reason,
    x.from_membership_id, x.to_membership_id,
    split_part(fu.full_name,' ',1) AS from_name, split_part(tu.full_name,' ',1) AS to_name,
    json_build_object('id',fs.id,'shift_date',fs.shift_date,'start_time',to_char(fs.start_time,'HH24:MI'),'end_time',to_char(fs.end_time,'HH24:MI'),'position',fs.position) AS from_shift,
    CASE WHEN os.id IS NULL THEN NULL ELSE json_build_object('id',os.id,'shift_date',os.shift_date,'start_time',to_char(os.start_time,'HH24:MI'),'end_time',to_char(os.end_time,'HH24:MI'),'position',os.position) END AS offered_shift
  FROM swap_requests x
  JOIN memberships fm ON fm.id=x.from_membership_id JOIN users fu ON fu.id=fm.user_id
  JOIN memberships tm ON tm.id=x.to_membership_id JOIN users tu ON tu.id=tm.user_id
  JOIN shifts fs ON fs.id=x.from_shift_id LEFT JOIN shifts os ON os.id=x.offered_shift_id`

my.get('/swaps', h(async (req, res) => {
  await q(`UPDATE swap_requests x SET status='void' FROM shifts s WHERE s.id=x.from_shift_id AND x.status IN ('sent','awaiting_manager') AND s.shift_date < $2 AND x.venue_id=$1`, [req.venue.id, todayIn(req.venue.timezone)])
  res.json(await q(`${SWAP_VIEW} WHERE x.venue_id=$1 AND (x.from_membership_id=$2 OR x.to_membership_id=$2) ORDER BY x.created_at DESC LIMIT 50`, [req.venue.id, req.m.id]))
}))

my.post('/swaps', h(async (req, res) => {
  const b = parse(z.object({ shift_id: zId, to_membership_id: zId, kind: z.enum(['give', 'exchange']), note: zText(300).nullable().optional() }), req.body)
  const s = await ownShift(req, b.shift_id)
  if (s.shift_date < todayIn(req.venue.timezone)) throw bad('That shift has already happened.')
  const to = await one(`SELECT m.id FROM memberships m WHERE m.id=$1 AND m.venue_id=$2 AND m.is_active AND m.id <> $3`, [b.to_membership_id, req.venue.id, req.m.id])
  if (!to) throw bad('Pick a colleague at this venue.')
  const open = await one(`SELECT 1 FROM swap_requests WHERE from_shift_id=$1 AND status IN ('sent','awaiting_manager')`, [s.id])
  if (open) throw bad('There\'s already a swap request open for this shift.')
  if (b.kind === 'give' && !(await isFree(req.venue, to.id, s))) throw bad('They aren\'t free for that shift.')
  const r = await tx(async (db) => {
    const r = await db.one('INSERT INTO swap_requests(venue_id, kind, from_membership_id, to_membership_id, from_shift_id, note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [req.venue.id, b.kind, req.m.id, to.id, s.id, b.note ?? null])
    await notify(db, req.venue.id, [to.id], 'swap', `${firstName(req.user.full_name)} asked you to ${b.kind === 'give' ? 'take' : 'swap for'} their shift: ${fmtShift(s)}.`, '/requests')
    return r
  })
  res.json(r)
}))

my.post('/swaps/:id/accept', h(async (req, res) => {
  const id = parse(zId, req.params.id)
  const b = parse(z.object({ offered_shift_id: zId.nullable().optional() }), req.body || {})
  const x = await one(`SELECT x.*, s.shift_date, to_char(s.start_time,'HH24:MI') AS start_time, to_char(s.end_time,'HH24:MI') AS end_time, s.position FROM swap_requests x JOIN shifts s ON s.id=x.from_shift_id WHERE x.id=$1 AND x.to_membership_id=$2 AND x.status='sent'`, [id, req.m.id])
  if (!x) throw notFound('That request isn\'t waiting for you.')
  let offered = null
  if (x.kind === 'exchange') {
    if (!b.offered_shift_id) throw bad('Pick one of your shifts to offer back.')
    offered = await ownShift(req, b.offered_shift_id)
    if (offered.shift_date < todayIn(req.venue.timezone)) throw bad('Pick a shift that hasn\'t happened yet.')
    if (!(await isFree(req.venue, x.from_membership_id, offered, x.from_shift_id))) throw bad('They aren\'t free for the shift you offered.')
  }
  if (!(await isFree(req.venue, req.m.id, x, offered?.id))) throw bad('You aren\'t free for that shift (you\'re working, off or unavailable then).')
  await tx(async (db) => {
    await db.q(`UPDATE swap_requests SET status='awaiting_manager', offered_shift_id=$2, colleague_responded_at=now() WHERE id=$1`, [id, offered?.id ?? null])
    await notify(db, req.venue.id, [x.from_membership_id], 'swap', `${firstName(req.user.full_name)} accepted your swap. It's now with a manager.`, '/requests')
    await notify(db, req.venue.id, await managerIds(db, req.venue.id, true), 'request', `Shift swap to approve: ${fmtShift(x)}.`, '/inbox')
  })
  res.json({ ok: true })
}))

my.post('/swaps/:id/decline', h(async (req, res) => {
  const r = await tx(async (db) => {
    const r = await db.one(`UPDATE swap_requests SET status='declined_by_colleague', colleague_responded_at=now() WHERE id=$1 AND to_membership_id=$2 AND status='sent' RETURNING from_membership_id`, [parse(zId, req.params.id), req.m.id])
    if (r) await notify(db, req.venue.id, [r.from_membership_id], 'swap', `${firstName(req.user.full_name)} can't take your shift.`, '/requests')
    return r
  })
  if (!r) throw notFound()
  res.json({ ok: true })
}))

my.post('/swaps/:id/withdraw', h(async (req, res) => {
  const r = await q(`UPDATE swap_requests SET status='withdrawn' WHERE id=$1 AND from_membership_id=$2 AND status IN ('sent','awaiting_manager') RETURNING id`, [parse(zId, req.params.id), req.m.id])
  if (!r.length) throw bad('That request can no longer be withdrawn.')
  res.json({ ok: true })
}))

// ---------- Raise a problem on a shift ----------
my.get('/problems', h(async (req, res) => {
  res.json(await q(`SELECT p.id, p.type, p.note, p.status, p.resolution, p.decision_reason, p.shift_snapshot, p.created_at,
      (SELECT coalesce(json_agg(json_build_object('body',pm.body,'at',pm.created_at,'mine',pm.author_membership_id=$2,'name',split_part(u.full_name,' ',1)) ORDER BY pm.id),'[]')
         FROM problem_messages pm JOIN memberships am ON am.id=pm.author_membership_id JOIN users u ON u.id=am.user_id WHERE pm.problem_id=p.id) AS messages
      FROM shift_problems p WHERE p.venue_id=$1 AND p.raised_by=$2 ORDER BY p.created_at DESC LIMIT 50`, [req.venue.id, req.m.id]))
}))

my.post('/problems', h(async (req, res) => {
  const b = parse(z.object({ shift_id: zId, type: z.enum(['cant_make_it', 'wrong_times', 'wrong_role', 'other']), note: zText(1000).min(3, 'say a little about the problem') }), req.body)
  const s = await ownShift(req, b.shift_id)
  const open = await one(`SELECT 1 FROM shift_problems WHERE shift_id=$1 AND status='open'`, [s.id])
  if (open) throw bad('You already have a problem open on this shift. Add to its thread instead.')
  const r = await tx(async (db) => {
    const r = await db.one(`INSERT INTO shift_problems(venue_id, shift_id, shift_snapshot, raised_by, type, note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [req.venue.id, s.id, JSON.stringify(s), req.m.id, b.type, b.note])
    await notify(db, req.venue.id, await managerIds(db, req.venue.id, true), 'request', `${firstName(req.user.full_name)} raised a problem on ${fmtShift(s)}: "${b.note.slice(0, 80)}"`, '/inbox')
    return r
  })
  res.json(r)
}))

my.post('/problems/:id/withdraw', h(async (req, res) => {
  const r = await q(`UPDATE shift_problems SET status='withdrawn' WHERE id=$1 AND raised_by=$2 AND status='open' RETURNING id`, [parse(zId, req.params.id), req.m.id])
  if (!r.length) throw bad('That problem is no longer open.')
  res.json({ ok: true })
}))

// ---------- Payslips and documents: own only ----------
my.get('/payslips', h(async (req, res) => {
  res.json(await q(`SELECT id, period_label, status, released_at, viewed_at FROM payslips WHERE membership_id=$1 AND status IN ('released','viewed') ORDER BY released_at DESC`, [req.m.id]))
}))

my.get('/payslips/:id/file', h(async (req, res) => {
  const p = await one(`SELECT id, file_key, file_name FROM payslips WHERE id=$1 AND membership_id=$2 AND status IN ('released','viewed')`, [parse(zId, req.params.id), req.m.id])
  if (!p) throw notFound()
  await q(`UPDATE payslips SET status='viewed', viewed_at=coalesce(viewed_at, now()) WHERE id=$1`, [p.id])
  sendFile(res, readEncrypted(p.file_key), 'application/pdf', p.file_name)
}))

my.get('/documents', h(async (req, res) => {
  res.json(await q(`SELECT id, doc_type, check_date, check_method, expiry_date, file_name, created_at FROM rtw_documents WHERE membership_id=$1 AND deleted_at IS NULL AND replaced_by IS NULL ORDER BY created_at DESC`, [req.m.id]))
}))

my.get('/documents/:id/file', h(async (req, res) => {
  const d = await one(`SELECT id, file_key, file_name, mime FROM rtw_documents WHERE id=$1 AND membership_id=$2 AND deleted_at IS NULL`, [parse(zId, req.params.id), req.m.id])
  if (!d) throw notFound()
  await q('INSERT INTO audit_log(venue_id, actor_user_id, action, target_type, target_id, ip) VALUES ($1,$2,$3,$4,$5,$6)', [req.venue.id, req.user.id, 'rtw_viewed_own', 'rtw_document', d.id, req.ip])
  sendFile(res, readEncrypted(d.file_key), d.mime, d.file_name)
}))

export function sendFile(res, buf, mime, name) {
  res.set({
    'Content-Type': mime,
    'Content-Disposition': `inline; filename="${String(name).replace(/[^\w.\- ]/g, '_')}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
  })
  res.send(buf)
}

// ---------- Notifications (the bell) ----------
my.get('/notifications', h(async (req, res) => {
  res.json(await q('SELECT id, kind, body, link, read_at, created_at FROM notifications WHERE membership_id=$1 ORDER BY created_at DESC LIMIT 50', [req.m.id]))
}))
my.post('/notifications/read', h(async (req, res) => {
  await q('UPDATE notifications SET read_at=now() WHERE membership_id=$1 AND read_at IS NULL', [req.m.id])
  res.json({ ok: true })
}))

// Colleagues list for staff: first names only (used by announcements author names etc.). Managers get the full team elsewhere.
my.get('/summary', h(async (req, res) => {
  const unread = await one('SELECT count(*)::int AS n FROM notifications WHERE membership_id=$1 AND read_at IS NULL', [req.m.id])
  const swapsWaiting = await one(`SELECT count(*)::int AS n FROM swap_requests WHERE to_membership_id=$1 AND status='sent'`, [req.m.id])
  res.json({ unread: unread.n, swaps_waiting: swapsWaiting.n })
}))

export { forbidden }
