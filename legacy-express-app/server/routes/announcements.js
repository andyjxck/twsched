import express from 'express'
import { z } from 'zod'
import { q, one, tx } from '../db.js'
import { need, isManager } from '../access.js'
import { h, parse, notFound, zId, zText, notify } from '../util.js'

export const announcements = express.Router({ mergeParams: true })

// Staff see posts for the whole venue or their own position. Managers see everything plus read counts.
// Staff never see each other's read status.
announcements.get('/', h(async (req, res) => {
  const mgr = isManager(req)
  const rows = await q(`SELECT a.id, a.title, a.body, a.audience, a.pinned, a.expires_at, a.created_at, split_part(u.full_name,' ',1) AS author,
      EXISTS (SELECT 1 FROM announcement_reads r WHERE r.announcement_id=a.id AND r.membership_id=$2) AS read
      ${mgr ? `, (SELECT count(*)::int FROM announcement_reads r WHERE r.announcement_id=a.id) AS read_count,
               (SELECT count(*)::int FROM memberships mm WHERE mm.venue_id=a.venue_id AND mm.is_active AND (a.audience IS NULL OR mm.position=a.audience)) AS audience_count` : ''}
    FROM announcements a JOIN memberships m ON m.id=a.author_membership_id JOIN users u ON u.id=m.user_id
    WHERE a.venue_id=$1 ${mgr ? '' : 'AND (a.audience IS NULL OR a.audience=$3) AND (a.expires_at IS NULL OR a.expires_at > now())'}
    ORDER BY a.pinned DESC, a.created_at DESC LIMIT 60`, mgr ? [req.venue.id, req.m.id] : [req.venue.id, req.m.id, req.m.position || ''])
  res.json(rows)
}))

announcements.post('/', need('manager'), h(async (req, res) => {
  const b = parse(z.object({ title: zText(120).min(2), body: zText(4000).min(1), audience: zText(60).nullable().optional(), pinned: z.boolean().default(false), expires_at: z.string().datetime({ offset: true }).nullable().optional() }), req.body)
  const r = await tx(async (db) => {
    const r = await db.one('INSERT INTO announcements(venue_id, author_membership_id, title, body, audience, pinned, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [req.venue.id, req.m.id, b.title, b.body, b.audience || null, b.pinned, b.expires_at ?? null])
    const to = (await db.q('SELECT id FROM memberships WHERE venue_id=$1 AND is_active AND id<>$2 AND ($3::text IS NULL OR position=$3)', [req.venue.id, req.m.id, b.audience || null])).map((x) => x.id)
    await notify(db, req.venue.id, to, 'announcement', `New announcement: ${b.title}`, '/news')
    return r
  })
  res.json(r)
}))

announcements.delete('/:id', need('manager'), h(async (req, res) => {
  await q('DELETE FROM announcements WHERE id=$1 AND venue_id=$2', [parse(zId, req.params.id), req.venue.id])
  res.json({ ok: true })
}))

announcements.post('/:id/read', h(async (req, res) => {
  const id = parse(zId, req.params.id)
  const a = await one('SELECT id FROM announcements WHERE id=$1 AND venue_id=$2 AND (audience IS NULL OR audience=$3 OR $4)', [id, req.venue.id, req.m.position || '', isManager(req)])
  if (!a) throw notFound()
  await q('INSERT INTO announcement_reads(announcement_id, membership_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, req.m.id])
  res.json({ ok: true })
}))

announcements.get('/:id/reads', need('manager'), h(async (req, res) => {
  const id = parse(zId, req.params.id)
  res.json(await q(`SELECT u.full_name, r.read_at FROM announcement_reads r JOIN memberships m ON m.id=r.membership_id JOIN users u ON u.id=m.user_id
    JOIN announcements a ON a.id=r.announcement_id WHERE r.announcement_id=$1 AND a.venue_id=$2 ORDER BY r.read_at`, [id, req.venue.id]))
}))
