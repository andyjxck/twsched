// One approval inbox for managers: time off, shift swaps and shift problems, oldest first.
// Supervisors can answer swaps and problems; only managers and owners decide time off.
import express from 'express'
import { z } from 'zod'
import { q, one, tx } from '../db.js'
import { need, isManager } from '../access.js'
import { h, parse, bad, notFound, forbidden, zId, zText, zTime, todayIn, notify, fmtShift, audit } from '../util.js'

export const inbox = express.Router({ mergeParams: true })
inbox.use(need('supervisor'))

async function expireStale(venue) {
  const today = todayIn(venue.timezone)
  await q(`UPDATE time_off_requests SET status='expired' WHERE venue_id=$1 AND status='pending' AND start_date < $2`, [venue.id, today])
  await q(`UPDATE swap_requests x SET status='void' FROM shifts s WHERE s.id=x.from_shift_id AND x.venue_id=$1 AND x.status IN ('sent','awaiting_manager') AND s.shift_date < $2`, [venue.id, today])
}

inbox.get('/', h(async (req, res) => {
  await expireStale(req.venue)
  const mgr = isManager(req)
  const items = await q(`SELECT i.kind, i.id, i.status, i.created_at, i.first_date, u.full_name AS raised_by_name, i.raised_by
      FROM approval_inbox i JOIN memberships m ON m.id=i.raised_by JOIN users u ON u.id=m.user_id
     WHERE i.venue_id=$1 ${mgr ? '' : "AND i.kind <> 'time_off'"} ORDER BY i.created_at`, [req.venue.id])
  const out = []
  for (const it of items) {
    if (it.kind === 'time_off') {
      const t = await one('SELECT id, kind, start_date, end_date, hours, note, status FROM time_off_requests WHERE id=$1', [it.id])
      // Clashes: who else is off, and the person's own shifts in those dates.
      const othersOff = await q(`SELECT split_part(u.full_name,' ',1) AS name, t.start_date, t.end_date FROM time_off_requests t JOIN memberships m ON m.id=t.membership_id JOIN users u ON u.id=m.user_id
          WHERE t.venue_id=$1 AND t.membership_id<>$2 AND t.status IN ('approved','cancel_pending') AND t.start_date <= $4 AND t.end_date >= $3`, [req.venue.id, it.raised_by, t.start_date, t.end_date])
      const shifts = await q(`SELECT shift_date, to_char(start_time,'HH24:MI') AS start_time, to_char(end_time,'HH24:MI') AS end_time, position FROM shifts WHERE membership_id=$1 AND shift_date BETWEEN $2 AND $3 ORDER BY shift_date`, [it.raised_by, t.start_date, t.end_date])
      out.push({ ...it, detail: t, clashes: { others_off: othersOff, own_shifts: shifts } })
    } else if (it.kind === 'swap') {
      const x = await one(`SELECT x.id, x.kind, x.note, split_part(tu.full_name,' ',1) AS to_name, tu.full_name AS to_full_name,
          json_build_object('shift_date',fs.shift_date,'start_time',to_char(fs.start_time,'HH24:MI'),'end_time',to_char(fs.end_time,'HH24:MI'),'position',fs.position) AS from_shift,
          CASE WHEN os.id IS NULL THEN NULL ELSE json_build_object('shift_date',os.shift_date,'start_time',to_char(os.start_time,'HH24:MI'),'end_time',to_char(os.end_time,'HH24:MI'),'position',os.position) END AS offered_shift
        FROM swap_requests x JOIN memberships tm ON tm.id=x.to_membership_id JOIN users tu ON tu.id=tm.user_id
        JOIN shifts fs ON fs.id=x.from_shift_id LEFT JOIN shifts os ON os.id=x.offered_shift_id WHERE x.id=$1`, [it.id])
      out.push({ ...it, detail: x })
    } else {
      const p = await one(`SELECT id, type, note, shift_snapshot, shift_id FROM shift_problems WHERE id=$1`, [it.id])
      const messages = await q(`SELECT pm.body, pm.created_at AS at, split_part(u.full_name,' ',1) AS name FROM problem_messages pm JOIN memberships m ON m.id=pm.author_membership_id JOIN users u ON u.id=m.user_id WHERE pm.problem_id=$1 ORDER BY pm.id`, [it.id])
      out.push({ ...it, detail: { ...p, messages } })
    }
  }
  res.json(out)
}))

inbox.get('/history', h(async (req, res) => {
  const rows = await q(`
    SELECT 'time_off' AS kind, t.id, t.status, t.decided_at, t.decision_reason, u.full_name AS name, t.start_date::text || ' to ' || t.end_date::text AS summary
      FROM time_off_requests t JOIN memberships m ON m.id=t.membership_id JOIN users u ON u.id=m.user_id WHERE t.venue_id=$1 AND t.decided_at IS NOT NULL
    UNION ALL
    SELECT 'swap', x.id, x.status, x.decided_at, x.decision_reason, u.full_name, x.kind FROM swap_requests x JOIN memberships m ON m.id=x.from_membership_id JOIN users u ON u.id=m.user_id WHERE x.venue_id=$1 AND x.decided_at IS NOT NULL
    UNION ALL
    SELECT 'problem', p.id, p.status, p.decided_at, p.decision_reason, u.full_name, p.note FROM shift_problems p JOIN memberships m ON m.id=p.raised_by JOIN users u ON u.id=m.user_id WHERE p.venue_id=$1 AND p.decided_at IS NOT NULL
    ORDER BY decided_at DESC LIMIT 40`, [req.venue.id])
  res.json(isManager(req) ? rows : rows.filter((r) => r.kind !== 'time_off'))
}))

const decision = z.object({
  decision: z.enum(['approve', 'decline']),
  reason: zText(500).nullable().optional(),
})
function needReason(b) { if (b.decision === 'decline' && !(b.reason && b.reason.trim().length >= 2)) throw bad('Give a short reason when declining. It goes back to the staff member.') }

inbox.post('/time_off/:id', need('manager'), h(async (req, res) => {
  const id = parse(zId, req.params.id)
  const b = parse(decision, req.body); needReason(b)
  await tx(async (db) => {
    const t = await db.one(`SELECT * FROM time_off_requests WHERE id=$1 AND venue_id=$2 AND status IN ('pending','cancel_pending') FOR UPDATE`, [id, req.venue.id])
    if (!t) throw notFound('That request has already been dealt with.')
    let status
    if (t.status === 'pending') status = b.decision === 'approve' ? 'approved' : 'declined'
    else status = b.decision === 'approve' ? 'cancelled' : 'approved' // cancelling approved leave
    await db.q('UPDATE time_off_requests SET status=$2, decided_by=$3, decided_at=now(), decision_reason=$4 WHERE id=$1', [id, status, req.m.id, b.reason ?? null])
    const what = t.status === 'pending' ? `Your time off ${t.start_date}${t.end_date !== t.start_date ? ' to ' + t.end_date : ''} was ${status}` : `Your request to cancel time off from ${t.start_date} was ${b.decision === 'approve' ? 'approved' : 'declined'}`
    await notify(db, req.venue.id, [t.membership_id], 'decision', what + (b.reason ? `: ${b.reason}` : '.'), '/requests')
  })
  await audit(req, 'time_off_' + b.decision, 'time_off_request', id)
  res.json({ ok: true })
}))

inbox.post('/swap/:id', h(async (req, res) => {
  const id = parse(zId, req.params.id)
  const b = parse(decision, req.body); needReason(b)
  await tx(async (db) => {
    const x = await db.one(`SELECT * FROM swap_requests WHERE id=$1 AND venue_id=$2 AND status='awaiting_manager' FOR UPDATE`, [id, req.venue.id])
    if (!x) throw notFound('That swap has already been dealt with.')
    const fs = await db.one(`SELECT id, membership_id, shift_date, to_char(start_time,'HH24:MI') AS start_time, to_char(end_time,'HH24:MI') AS end_time, position FROM shifts WHERE id=$1 FOR UPDATE`, [x.from_shift_id])
    if (b.decision === 'approve') {
      // Both shifts move in one step, and only if nothing changed since the request.
      if (fs.membership_id !== x.from_membership_id) throw bad('The shift has changed since this was requested.')
      await db.q('UPDATE shifts SET membership_id=$2, updated_at=now() WHERE id=$1', [fs.id, x.to_membership_id])
      if (x.kind === 'exchange' && x.offered_shift_id) {
        const os = await db.one('SELECT membership_id FROM shifts WHERE id=$1 FOR UPDATE', [x.offered_shift_id])
        if (!os || os.membership_id !== x.to_membership_id) throw bad('The offered shift has changed since this was requested.')
        await db.q('UPDATE shifts SET membership_id=$2, updated_at=now() WHERE id=$1', [x.offered_shift_id, x.from_membership_id])
      }
    }
    await db.q(`UPDATE swap_requests SET status=$2, decided_by=$3, decided_at=now(), decision_reason=$4 WHERE id=$1`, [id, b.decision === 'approve' ? 'approved' : 'declined', req.m.id, b.reason ?? null])
    await notify(db, req.venue.id, [x.from_membership_id, x.to_membership_id], 'decision',
      `The swap for ${fmtShift(fs)} was ${b.decision === 'approve' ? 'approved' : 'declined'}${b.reason ? ': ' + b.reason : '.'}`, '/')
  })
  await audit(req, 'swap_' + b.decision, 'swap_request', id)
  res.json({ ok: true })
}))

inbox.post('/problem/:id', h(async (req, res) => {
  const id = parse(zId, req.params.id)
  const b = parse(decision.extend({
    resolution: z.enum(['none', 'drop', 'edit']).default('none'),
    start_time: zTime.optional(), end_time: zTime.optional(),
  }), req.body); needReason(b)
  if (b.decision === 'approve' && b.resolution !== 'none' && !isManager(req)) throw forbidden('Only a manager can change the rota.')
  await tx(async (db) => {
    const p = await db.one(`SELECT * FROM shift_problems WHERE id=$1 AND venue_id=$2 AND status='open' FOR UPDATE`, [id, req.venue.id])
    if (!p) throw notFound('That problem has already been dealt with.')
    if (b.decision === 'approve' && p.shift_id) {
      if (b.resolution === 'drop') await db.q('UPDATE shifts SET membership_id=NULL, edited_after_publish=true, updated_at=now() WHERE id=$1', [p.shift_id])
      if (b.resolution === 'edit') {
        if (!b.start_time || !b.end_time) throw bad('Give the new start and end times.')
        await db.q('UPDATE shifts SET start_time=$2, end_time=$3, edited_after_publish=true, updated_at=now() WHERE id=$1', [p.shift_id, b.start_time, b.end_time])
      }
      if (b.resolution !== 'none') await db.q(`UPDATE swap_requests SET status='void' WHERE (from_shift_id=$1 OR offered_shift_id=$1) AND status IN ('sent','awaiting_manager')`, [p.shift_id])
    }
    await db.q(`UPDATE shift_problems SET status=$2, resolution=$3, decided_by=$4, decided_at=now(), decision_reason=$5 WHERE id=$1`,
      [id, b.decision === 'approve' ? 'approved' : 'declined', b.decision === 'approve' ? b.resolution : null, req.m.id, b.reason ?? null])
    const extra = b.decision === 'approve' ? { none: '', drop: ' You\'ve been taken off the shift.', edit: ` New times: ${b.start_time}–${b.end_time}.` }[b.resolution] : ''
    await notify(db, req.venue.id, [p.raised_by], 'decision', `Your problem on ${fmtShift(p.shift_snapshot)} was ${b.decision === 'approve' ? 'approved' : 'declined'}${b.reason ? ': ' + b.reason : '.'}${extra}`, '/requests')
  })
  res.json({ ok: true })
}))

// Short thread on a problem: the manager can ask a question before deciding.
export const problemThread = h(async (req, res) => {
  const id = parse(zId, req.params.id)
  const { body } = parse(z.object({ body: zText(1000).min(1) }), req.body)
  const p = await one('SELECT id, raised_by, status, shift_snapshot FROM shift_problems WHERE id=$1 AND venue_id=$2', [id, req.venue.id])
  if (!p) throw notFound()
  const lead = ['owner', 'manager', 'supervisor'].includes(req.m.role)
  if (!lead && p.raised_by !== req.m.id) throw notFound()
  if (p.status !== 'open') throw bad('This problem is closed.')
  await tx(async (db) => {
    await db.q('INSERT INTO problem_messages(problem_id, author_membership_id, body) VALUES ($1,$2,$3)', [id, req.m.id, body])
    const to = lead ? [p.raised_by] : (await db.q(`SELECT id FROM memberships WHERE venue_id=$1 AND is_active AND role IN ('owner','manager','supervisor')`, [req.venue.id])).map((r) => r.id)
    await notify(db, req.venue.id, to.filter((x) => x !== req.m.id), 'problem_message', `New message about ${fmtShift(p.shift_snapshot)}: "${body.slice(0, 80)}"`, lead ? '/requests' : '/inbox')
  })
  res.json({ ok: true })
})
