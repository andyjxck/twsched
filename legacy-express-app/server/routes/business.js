// Manager-only numbers: takings, labour vs sales, overtime, the hours export, and venue settings.
// No till API: sales are typed in at close or uploaded from an Epos Now report exported as CSV.
import express from 'express'
import multer from 'multer'
import { z } from 'zod'
import { q, one, tx } from '../db.js'
import { need } from '../access.js'
import { h, parse, bad, zDate, zId, zText, todayIn, mondayOf, addDays, daysBetween, audit } from '../util.js'
import { safeFileName } from '../security.js'

export const business = express.Router({ mergeParams: true })
business.use(need('manager'))
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } })

// ---------- Sales ----------
business.get('/sales', h(async (req, res) => {
  const today = todayIn(req.venue.timezone)
  const from = req.query.from ? parse(zDate, req.query.from) : addDays(today, -27)
  const to = req.query.to ? parse(zDate, req.query.to) : today
  res.json(await q(`SELECT id, sales_date, source, net_sales, includes_vat, wet_sales, dry_sales, covers, updated_at FROM sales_days WHERE venue_id=$1 AND sales_date BETWEEN $2 AND $3 ORDER BY sales_date DESC, source`, [req.venue.id, from, to]))
}))

business.post('/sales', h(async (req, res) => {
  const b = parse(z.object({
    sales_date: zDate, net_sales: z.coerce.number().min(0).max(1e7), includes_vat: z.boolean().default(true),
    wet_sales: z.coerce.number().min(0).max(1e7).nullable().optional(), dry_sales: z.coerce.number().min(0).max(1e7).nullable().optional(),
    covers: z.coerce.number().int().min(0).max(100000).nullable().optional(),
  }), req.body)
  if (b.sales_date > todayIn(req.venue.timezone)) throw bad('That date is in the future.')
  await q(`INSERT INTO sales_days(venue_id, sales_date, source, net_sales, includes_vat, wet_sales, dry_sales, covers, entered_by)
      VALUES ($1,$2,'typed',$3,$4,$5,$6,$7,$8)
      ON CONFLICT (venue_id, sales_date, source) DO UPDATE SET net_sales=EXCLUDED.net_sales, includes_vat=EXCLUDED.includes_vat, wet_sales=EXCLUDED.wet_sales,
        dry_sales=EXCLUDED.dry_sales, covers=EXCLUDED.covers, entered_by=EXCLUDED.entered_by, updated_at=now()`,
    [req.venue.id, b.sales_date, b.net_sales, b.includes_vat, b.wet_sales ?? null, b.dry_sales ?? null, b.covers ?? null, req.m.id])
  const clash = await one(`SELECT net_sales FROM sales_days WHERE venue_id=$1 AND sales_date=$2 AND source='upload'`, [req.venue.id, b.sales_date])
  res.json({ ok: true, clash: clash && Number(clash.net_sales) !== b.net_sales ? `An uploaded report says £${clash.net_sales} for that day.` : null })
}))

export function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let inQ = false
  text = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') inQ = false; else cell += c
    } else if (c === '"') inQ = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = '' }
    else cell += c
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

// UK reports usually write dates as dd/mm/yyyy.
export function parseDate(s) {
  s = String(s || '').trim().split(/[ T]/)[0]
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` }
  return null
}
export const parseMoney = (s) => { const n = Number(String(s ?? '').replace(/[£,\s]/g, '').replace(/^\((.*)\)$/, '-$1')); return Number.isFinite(n) ? n : null }

function guessMap(headers) {
  const find = (...words) => headers.findIndex((hd) => words.some((w) => hd.toLowerCase().includes(w)))
  return { date: find('date', 'day'), sales: find('net sales', 'net', 'sales', 'total'), wet: find('wet', 'drink'), dry: find('dry', 'food'), covers: find('cover', 'guest') }
}

business.post('/sales/upload', upload.single('file'), h(async (req, res) => {
  if (!req.file) throw bad('Choose a CSV file exported from Epos Now.')
  const name = safeFileName(req.file.originalname)
  if (!/\.csv$/i.test(name)) throw bad('Only CSV files for now. In Epos Now, export the report as CSV.')
  const rows = parseCsv(req.file.buffer.toString('utf8'))
  if (rows.length < 2) throw bad('That file has no data rows.')
  const headers = rows[0].map((x) => x.trim())
  const mapIn = req.body.map ? parse(z.object({ date: z.coerce.number().int(), sales: z.coerce.number().int(), wet: z.coerce.number().int().optional(), dry: z.coerce.number().int().optional(), covers: z.coerce.number().int().optional() }), JSON.parse(req.body.map)) : null
  const map = mapIn || req.venue.salesColumnMap || guessMap(headers)
  const includesVat = req.body.includes_vat !== 'false'
  const parsed = []
  const skipped = []
  for (const r of rows.slice(1)) {
    const d = parseDate(r[map.date]); const s = parseMoney(r[map.sales])
    if (!d || s === null) { skipped.push(r.join(', ').slice(0, 80)); continue }
    parsed.push({ sales_date: d, net_sales: s, wet_sales: map.wet >= 0 ? parseMoney(r[map.wet]) : null, dry_sales: map.dry >= 0 ? parseMoney(r[map.dry]) : null, covers: map.covers >= 0 ? (parseInt(r[map.covers], 10) || null) : null })
  }
  if (req.body.commit !== 'true') {
    return res.json({ headers, sample: rows.slice(1, 6), map, preview: parsed.slice(0, 10), rows: parsed.length, skipped: skipped.slice(0, 5) })
  }
  if (!parsed.length) throw bad('No rows had a date and a sales figure with that column choice.')
  const out = await tx(async (db) => {
    const up = await db.one('INSERT INTO sales_uploads(venue_id, file_name, column_map, rows_imported, uploaded_by) VALUES ($1,$2,$3,$4,$5) RETURNING id', [req.venue.id, name, JSON.stringify(map), parsed.length, req.m.id])
    let replaced = 0
    for (const p of parsed) {
      const r = await db.one(`INSERT INTO sales_days(venue_id, sales_date, source, net_sales, includes_vat, wet_sales, dry_sales, covers, upload_id, entered_by)
          VALUES ($1,$2,'upload',$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT (venue_id, sales_date, source) DO UPDATE SET net_sales=EXCLUDED.net_sales, includes_vat=EXCLUDED.includes_vat, wet_sales=EXCLUDED.wet_sales, dry_sales=EXCLUDED.dry_sales,
            covers=EXCLUDED.covers, upload_id=EXCLUDED.upload_id, entered_by=EXCLUDED.entered_by, updated_at=now()
          RETURNING (xmax <> 0) AS replaced`, [req.venue.id, p.sales_date, p.net_sales, includesVat, p.wet_sales, p.dry_sales, p.covers, up.id, req.m.id])
      if (r.replaced) replaced++
    }
    await db.q('UPDATE venues SET sales_column_map=$2 WHERE id=$1', [req.venue.id, JSON.stringify(map)])
    return { imported: parsed.length, replaced, skipped: skipped.length }
  })
  await audit(req, 'sales_uploaded', 'sales_upload', null, out)
  res.json(out)
}))

// ---------- Labour vs sales, and overtime ----------
const exVat = (venue, row) => (row.includes_vat ? Number(row.net_sales) / (1 + Number(venue.vatRate) / 100) : Number(row.net_sales))

business.get('/labour', h(async (req, res) => {
  const week = mondayOf(req.query.week ? parse(zDate, req.query.week) : todayIn(req.venue.timezone))
  const end = addDays(week, 6)
  const v = req.venue
  const shifts = await q(`SELECT s.shift_date, s.membership_id, p.pay_rate, p.contracted_hours, u.full_name,
        shift_hours(s.shift_date,s.start_time,s.end_time,s.break_minutes,$4) AS rostered,
        CASE WHEN s.confirmed_at IS NOT NULL THEN shift_hours(s.shift_date,s.actual_start,s.actual_end,coalesce(s.actual_break_minutes,0),$4) END AS confirmed
      FROM shifts s JOIN memberships m ON m.id=s.membership_id JOIN users u ON u.id=m.user_id LEFT JOIN staff_profiles p ON p.membership_id=m.id
      WHERE s.venue_id=$1 AND s.shift_date BETWEEN $2 AND $3`, [v.id, week, end, v.timezone])
  const sales = await q('SELECT sales_date, source, net_sales, includes_vat FROM sales_days WHERE venue_id=$1 AND sales_date BETWEEN $2 AND $3', [v.id, week, end])
  const days = []
  let missingRates = new Set()
  for (let i = 0; i < 7; i++) {
    const d = addDays(week, i)
    const ds = shifts.filter((s) => s.shift_date === d)
    let rostered = 0, worked = 0, cost = 0, unconfirmed = 0
    for (const s of ds) {
      const hrs = s.confirmed ?? s.rostered
      rostered += Number(s.rostered); worked += Number(hrs); if (s.confirmed == null) unconfirmed++
      if (s.pay_rate == null) missingRates.add(s.full_name)
      cost += Number(hrs) * Number(s.pay_rate || 0)
    }
    const sd = sales.filter((s) => s.sales_date === d)
    const chosen = sd.find((s) => s.source === 'upload') || sd.find((s) => s.source === 'typed')
    const clash = sd.length === 2 && Number(sd[0].net_sales) !== Number(sd[1].net_sales)
    const salesBase = chosen ? (v.labourOnExVat ? exVat(v, chosen) : Number(chosen.net_sales)) : null
    days.push({ date: d, rostered_hours: round2(rostered), hours: round2(worked), unconfirmed_shifts: unconfirmed, labour_cost: round2(cost), sales_entered: chosen ? Number(chosen.net_sales) : null, sales_includes_vat: chosen?.includes_vat ?? null, sales_base: salesBase == null ? null : round2(salesBase), labour_pct: salesBase ? round2((cost / salesBase) * 100) : null, sales_clash: clash })
  }
  const people = {}
  for (const s of shifts) {
    const p = (people[s.membership_id] ||= { name: s.full_name, rostered: 0, hours: 0, contracted: s.contracted_hours })
    p.rostered += Number(s.rostered); p.hours += Number(s.confirmed ?? s.rostered)
  }
  const overtime = Object.values(people).filter((p) => p.rostered > Number(v.weeklyHoursLimit) || (p.contracted && p.rostered > Number(p.contracted)))
    .map((p) => ({ name: p.name, hours: round2(p.rostered), contracted: p.contracted, over_limit: p.rostered > Number(v.weeklyHoursLimit), limit: v.weeklyHoursLimit }))
  const tCost = days.reduce((a, d) => a + d.labour_cost, 0)
  const tSales = days.reduce((a, d) => a + (d.sales_base || 0), 0)
  res.json({ week, basis: v.labourOnExVat ? `sales without VAT (entered figures marked as including VAT are divided by ${1 + Number(v.vatRate) / 100})` : 'sales as entered', days,
    totals: { labour_cost: round2(tCost), sales_base: round2(tSales), labour_pct: tSales ? round2((tCost / tSales) * 100) : null },
    overtime, missing_pay_rates: [...missingRates] })
}))
const round2 = (n) => Math.round(n * 100) / 100

// Confirmed hours per person for a pay period, as CSV for whoever runs payroll. It doesn't work out pay or tax.
business.get('/exports/hours.csv', h(async (req, res) => {
  const from = parse(zDate, req.query.from), to = parse(zDate, req.query.to)
  if (to < from || daysBetween(from, to) > 62) throw bad('Pick a range of up to two months.')
  const rows = await q(`SELECT u.full_name, u.email, s.shift_date, to_char(s.actual_start,'HH24:MI') AS actual_start, to_char(s.actual_end,'HH24:MI') AS actual_end,
        coalesce(s.actual_break_minutes,0) AS break_minutes, shift_hours(s.shift_date,s.actual_start,s.actual_end,coalesce(s.actual_break_minutes,0),$4) AS hours, s.position
      FROM shifts s JOIN memberships m ON m.id=s.membership_id JOIN users u ON u.id=m.user_id
      WHERE s.venue_id=$1 AND s.shift_date BETWEEN $2 AND $3 AND s.confirmed_at IS NOT NULL ORDER BY u.full_name, s.shift_date`, [req.venue.id, from, to, req.venue.timezone])
  const esc = (x) => { const s = String(x ?? ''); return /^[=+\-@\t\r]/.test(s) ? `"'${s.replace(/"/g, '""')}"` : `"${s.replace(/"/g, '""')}"` }
  const lines = [['Name', 'Email', 'Date', 'Start', 'End', 'Break (min)', 'Hours', 'Role'].map(esc).join(',')]
  for (const r of rows) lines.push([r.full_name, r.email, r.shift_date, r.actual_start, r.actual_end, r.break_minutes, r.hours, r.position].map(esc).join(','))
  await audit(req, 'hours_exported', null, null, { from, to })
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="hours-${from}-to-${to}.csv"`, 'Cache-Control': 'no-store' })
  res.send(lines.join('\r\n'))
}))

// ---------- Venue settings and blackout dates ----------
business.get('/settings', h(async (req, res) => {
  const v = await one('SELECT name, slug, timezone, leave_year_start_month, weekly_hours_limit, vat_rate, labour_on_ex_vat, positions FROM venues WHERE id=$1', [req.venue.id])
  const blackouts = await q('SELECT id, start_date, end_date, label FROM blackout_dates WHERE venue_id=$1 ORDER BY start_date', [req.venue.id])
  res.json({ ...v, blackouts })
}))

business.patch('/settings', h(async (req, res) => {
  const b = parse(z.object({
    leave_year_start_month: z.coerce.number().int().min(1).max(12).optional(),
    weekly_hours_limit: z.coerce.number().min(1).max(100).optional(),
    vat_rate: z.coerce.number().min(0).max(50).optional(),
    labour_on_ex_vat: z.boolean().optional(),
    positions: z.array(zText(60).min(1)).min(1).max(20).optional(),
  }), req.body)
  await q(`UPDATE venues SET leave_year_start_month=coalesce($2,leave_year_start_month), weekly_hours_limit=coalesce($3,weekly_hours_limit), vat_rate=coalesce($4,vat_rate),
      labour_on_ex_vat=coalesce($5,labour_on_ex_vat), positions=coalesce($6,positions) WHERE id=$1`,
    [req.venue.id, b.leave_year_start_month ?? null, b.weekly_hours_limit ?? null, b.vat_rate ?? null, b.labour_on_ex_vat ?? null, b.positions ?? null])
  await audit(req, 'settings_changed', 'venue', req.venue.id, b)
  res.json({ ok: true })
}))

business.post('/blackouts', h(async (req, res) => {
  const b = parse(z.object({ start_date: zDate, end_date: zDate, label: zText(80).min(2) }), req.body)
  if (b.end_date < b.start_date) throw bad('The end date is before the start date.')
  res.json(await one('INSERT INTO blackout_dates(venue_id, start_date, end_date, label) VALUES ($1,$2,$3,$4) RETURNING id', [req.venue.id, b.start_date, b.end_date, b.label]))
}))
business.delete('/blackouts/:id', h(async (req, res) => {
  await q('DELETE FROM blackout_dates WHERE id=$1 AND venue_id=$2', [parse(zId, req.params.id), req.venue.id])
  res.json({ ok: true })
}))
