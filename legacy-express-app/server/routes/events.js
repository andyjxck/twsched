// Events for the public website. Managers add and edit them here; the public site only ever reads
// published events through /api/public/:slug/events, which exposes nothing else.
import express from 'express'
import { z } from 'zod'
import { config } from '../config.js'
import { q, one } from '../db.js'
import { need } from '../access.js'
import { h, parse, notFound, zDate, zTime, zId, zText, todayIn, addDays, audit, hhmm } from '../util.js'

export const events = express.Router({ mergeParams: true })
events.use(need('manager'))

const COLS = `id, title, description, event_date, to_char(start_time,'HH24:MI') AS start_time, to_char(end_time,'HH24:MI') AS end_time, is_published, updated_at`

events.get('/', h(async (req, res) => {
  res.json(await q(`SELECT ${COLS} FROM events WHERE venue_id=$1 AND event_date >= $2 ORDER BY event_date, start_time NULLS FIRST`, [req.venue.id, addDays(todayIn(req.venue.timezone), -30)]))
}))

const body = z.object({
  title: zText(120).min(2),
  description: zText(1000).nullable().optional(),
  event_date: zDate,
  start_time: zTime.nullable().optional(),
  end_time: zTime.nullable().optional(),
  is_published: z.boolean().default(false),
})

events.post('/', h(async (req, res) => {
  const b = parse(body, req.body)
  const r = await one(`INSERT INTO events(venue_id, title, description, event_date, start_time, end_time, is_published, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [req.venue.id, b.title, b.description ?? null, b.event_date, b.start_time ?? null, b.end_time ?? null, b.is_published, req.m.id])
  await audit(req, 'event_created', 'event', r.id)
  res.json(r)
}))

events.patch('/:id', h(async (req, res) => {
  const id = parse(zId, req.params.id)
  const cur = await one(`SELECT ${COLS} FROM events WHERE id=$1 AND venue_id=$2`, [id, req.venue.id])
  if (!cur) throw notFound()
  const b = { ...cur, ...parse(body.partial(), req.body) }
  await q(`UPDATE events SET title=$3, description=$4, event_date=$5, start_time=$6, end_time=$7, is_published=$8, updated_at=now() WHERE id=$1 AND venue_id=$2`,
    [id, req.venue.id, b.title, b.description ?? null, b.event_date, b.start_time ?? null, b.end_time ?? null, b.is_published])
  res.json({ ok: true })
}))

events.delete('/:id', h(async (req, res) => {
  await q('DELETE FROM events WHERE id=$1 AND venue_id=$2', [parse(zId, req.params.id), req.venue.id])
  res.json({ ok: true })
}))

// ---------- Public, read-only, no login ----------
export const publicApi = express.Router()
publicApi.use((req, res, next) => {
  const origin = req.get('origin')
  const allowed = config.publicSiteOrigins
  if (allowed.includes('*')) res.set('Access-Control-Allow-Origin', '*')
  else if (origin && allowed.includes(origin)) { res.set('Access-Control-Allow-Origin', origin); res.set('Vary', 'Origin') }
  res.set('Access-Control-Allow-Methods', 'GET')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  if (req.method !== 'GET') return res.sendStatus(405)
  next()
})

// Shape matches the website's calendar: { date, title, time, note }.
publicApi.get('/:slug/events', h(async (req, res) => {
  const slug = parse(z.string().regex(/^[a-z0-9-]{2,40}$/), req.params.slug)
  const v = await one('SELECT id, timezone FROM venues WHERE slug=$1', [slug])
  if (!v) throw notFound()
  const today = todayIn(v.timezone)
  const from = req.query.from ? parse(zDate, req.query.from) : addDays(today, -7)
  const to = req.query.to ? parse(zDate, req.query.to) : addDays(today, 120)
  const rows = await q(`SELECT event_date, title, description, start_time, end_time FROM events
      WHERE venue_id=$1 AND is_published AND event_date BETWEEN $2 AND $3 ORDER BY event_date, start_time NULLS FIRST LIMIT 200`, [v.id, from, to])
  res.set('Cache-Control', 'public, max-age=60')
  res.json(rows.map((r) => ({
    date: r.event_date,
    title: r.title,
    time: r.start_time ? hhmm(r.start_time) + (r.end_time ? '–' + hhmm(r.end_time) : '') : '',
    note: r.description || '',
  })))
}))
