import { useState } from 'react'
import { api, v } from '../api.js'
import { useLoad, Loader, Field, useAction, useApp, fmtDate, todayISO, addDays, mondayOf, money, r1 } from '../ui.jsx'

// Manager-only: labour vs sales, overtime alerts, and getting the day's takings in.
// No Epos Now API: takings are typed in at close, or the End of Day report is uploaded as CSV.
export default function Business() {
  const [tab, setTab] = useState('labour')
  return (
    <>
      <div className="segment" style={{ marginBottom: 12 }}>
        <button className={tab === 'labour' ? 'on' : ''} onClick={() => setTab('labour')}>Labour vs sales</button>
        <button className={tab === 'takings' ? 'on' : ''} onClick={() => setTab('takings')}>Takings</button>
      </div>
      {tab === 'labour' ? <Labour onAddTakings={() => setTab('takings')} /> : <Takings />}
    </>
  )
}

// ---------- Labour vs sales, and overtime ----------
function Labour({ onAddTakings }) {
  const [week, setWeek] = useState(() => mondayOf(addDays(todayISO(), -7)))
  const state = useLoad(() => api.get(v(`/business/labour?week=${week}`)), [week])
  const thisWeek = mondayOf(todayISO())
  return (
    <>
      <div className="row between" style={{ marginBottom: 10 }}>
        <button className="btn secondary sm" onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week">‹ Prev</button>
        <b>Week of {fmtDate(week, { day: 'numeric', month: 'short', year: 'numeric' })}</b>
        <button className="btn secondary sm" disabled={week >= thisWeek} onClick={() => setWeek(addDays(week, 7))} aria-label="Next week">Next ›</button>
      </div>
      <Loader state={state}>{(d) => {
        const missingSales = d.days.filter((x) => x.sales_entered == null && x.date <= todayISO() && x.hours > 0)
        const unconfirmed = d.days.reduce((a, x) => a + x.unconfirmed_shifts, 0)
        return (
          <>
            <div className="grid4" style={{ marginBottom: 12 }}>
              <div className="stat"><div className="big">{d.totals.labour_pct == null ? '–' : r1(d.totals.labour_pct) + '%'}</div><div className="label">Labour %</div></div>
              <div className="stat"><div className="big">{money(d.totals.labour_cost)}</div><div className="label">Labour cost</div></div>
              <div className="stat"><div className="big">{money(d.totals.sales_base)}</div><div className="label">Sales</div></div>
              <div className="stat"><div className="big">{d.overtime.length}</div><div className="label">Overtime alerts</div></div>
            </div>

            {d.overtime.length > 0 && (
              <div className="warn" style={{ marginBottom: 12 }}>
                <b>Overtime this week</b>
                <ul className="list">{d.overtime.map((o) => (
                  <li key={o.name}>{o.name}: {r1(o.hours)} hours rostered{o.over_limit ? `, over the venue limit of ${o.limit}` : ''}{o.contracted && o.hours > Number(o.contracted) ? `, contracted for ${r1(o.contracted)}` : ''}</li>
                ))}</ul>
              </div>
            )}
            {d.missing_pay_rates.length > 0 && <div className="warn small" style={{ marginBottom: 12 }}>No pay rate set for {d.missing_pay_rates.join(', ')}, so their hours count as £0. Add rates on the Team page.</div>}
            {missingSales.length > 0 && (
              <div className="warn small row between" style={{ marginBottom: 12 }}>
                <span>No takings for {missingSales.map((x) => fmtDate(x.date, { weekday: 'short' })).join(', ')}, so labour % for those days is missing.</span>
                <button className="btn sm" onClick={onAddTakings}>Add takings</button>
              </div>
            )}

            <div className="card tight" style={{ overflowX: 'auto' }}>
              <table className="simple">
                <thead><tr><th>Day</th><th className="num">Hours</th><th className="num">Labour</th><th className="num">Sales</th><th className="num">Labour %</th></tr></thead>
                <tbody>{d.days.map((x) => (
                  <tr key={x.date}>
                    <td>{fmtDate(x.date)}{x.sales_clash && <span className="pill amber" style={{ marginLeft: 6 }} title="Typed and uploaded figures differ; the uploaded one is used">2 figures</span>}</td>
                    <td className="num">{r1(x.hours)}{x.unconfirmed_shifts > 0 && <span className="muted">*</span>}</td>
                    <td className="num">{money(x.labour_cost)}</td>
                    <td className="num">{x.sales_base == null ? '–' : money(x.sales_base)}</td>
                    <td className="num">{x.labour_pct == null ? '–' : r1(x.labour_pct) + '%'}</td>
                  </tr>
                ))}</tbody>
              </table>
              <p className="tiny muted">Worked out on {d.basis}.{unconfirmed > 0 ? ` * ${unconfirmed} shift${unconfirmed === 1 ? '' : 's'} not confirmed yet, so rostered hours are used.` : ''}</p>
            </div>
            <HoursExport />
          </>
        )
      }}</Loader>
    </>
  )
}

function HoursExport() {
  const [from, setFrom] = useState(() => addDays(mondayOf(todayISO()), -14))
  const [to, setTo] = useState(() => addDays(mondayOf(todayISO()), -1))
  return (
    <div className="card stack">
      <h3>Hours for payroll</h3>
      <p className="small muted">Confirmed hours per person as a spreadsheet, for whoever runs payroll. It doesn't work out pay or tax.</p>
      <div className="grid2">
        <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <a className="btn secondary block" style={{ textAlign: 'center', textDecoration: 'none' }} href={v(`/business/exports/hours.csv?from=${from}&to=${to}`)} download>Download hours (CSV)</a>
    </div>
  )
}

// ---------- Takings: typed in, or uploaded from Epos Now ----------
function Takings() {
  const list = useLoad(() => api.get(v('/business/sales')))
  return (
    <>
      <TypeIn onSaved={list.reload} />
      <Upload onDone={list.reload} />
      <div className="card tight">
        <h3 style={{ margin: '4px 0 6px' }}>Last 4 weeks</h3>
        <Loader state={list}>{(rows) => rows.length === 0 ? <p className="muted small">No takings entered yet.</p> : (
          <table className="simple">
            <thead><tr><th>Day</th><th>From</th><th className="num">Sales</th><th className="num">Covers</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td>{fmtDate(r.sales_date)}</td>
                <td><span className={`pill ${r.source === 'upload' ? 'blue' : ''}`}>{r.source === 'upload' ? 'Report' : 'Typed'}</span></td>
                <td className="num">{money(r.net_sales)}<div className="tiny muted">{r.includes_vat ? 'inc VAT' : 'ex VAT'}</div></td>
                <td className="num">{r.covers ?? '–'}</td>
              </tr>
            ))}</tbody>
          </table>
        )}</Loader>
        <p className="tiny muted">If a day has both a typed figure and a report, the report is used.</p>
      </div>
    </>
  )
}

function TypeIn({ onSaved }) {
  const { toast } = useApp()
  const blank = { sales_date: todayISO(), net_sales: '', includes_vat: true, wet_sales: '', dry_sales: '', covers: '' }
  const [f, setF] = useState(blank)
  const [busy, run] = useAction()
  const n = (x) => (x === '' ? null : Number(x))
  const save = () => run(async () => {
    const r = await api.post(v('/business/sales'), { sales_date: f.sales_date, net_sales: Number(f.net_sales), includes_vat: f.includes_vat, wet_sales: n(f.wet_sales), dry_sales: n(f.dry_sales), covers: n(f.covers) })
    toast(r.clash ? `Saved. ${r.clash} The report figure is the one used.` : 'Takings saved.', r.clash ? 'warn' : '')
    setF({ ...blank, sales_date: f.sales_date }); onSaved()
  })
  return (
    <div className="card stack">
      <h3>Type in the day's takings</h3>
      <p className="small muted">At close, copy the net sales figure from the Epos Now End of Day report.</p>
      <div className="grid2">
        <Field label="Day"><input type="date" value={f.sales_date} max={todayISO()} onChange={(e) => setF({ ...f, sales_date: e.target.value })} /></Field>
        <Field label="Net sales (£)"><input type="number" inputMode="decimal" min="0" step="0.01" value={f.net_sales} onChange={(e) => setF({ ...f, net_sales: e.target.value })} /></Field>
        <Field label="Drinks (optional)"><input type="number" inputMode="decimal" min="0" step="0.01" value={f.wet_sales} onChange={(e) => setF({ ...f, wet_sales: e.target.value })} /></Field>
        <Field label="Food (optional)"><input type="number" inputMode="decimal" min="0" step="0.01" value={f.dry_sales} onChange={(e) => setF({ ...f, dry_sales: e.target.value })} /></Field>
        <Field label="Covers (optional)"><input type="number" inputMode="numeric" min="0" step="1" value={f.covers} onChange={(e) => setF({ ...f, covers: e.target.value })} /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={f.includes_vat} onChange={(e) => setF({ ...f, includes_vat: e.target.checked })} /> This figure includes VAT (the End of Day report's net sales do)</label>
      <button className="btn block" disabled={busy || f.net_sales === '' || !f.sales_date || f.sales_date > todayISO()} onClick={save}>Save takings</button>
    </div>
  )
}

const MAP_FIELDS = [['date', 'Date', true], ['sales', 'Net sales', true], ['wet', 'Drinks', false], ['dry', 'Food', false], ['covers', 'Covers', false]]

function Upload({ onDone }) {
  const { toast } = useApp()
  const [file, setFile] = useState(null)
  const [includesVat, setIncludesVat] = useState(true)
  const [preview, setPreview] = useState(null)
  const [map, setMap] = useState(null)
  const [busy, run] = useAction()

  const send = (commit, useMap) => {
    const form = new FormData()
    form.append('file', file)
    form.append('includes_vat', String(includesVat))
    form.append('commit', String(commit))
    if (useMap) form.append('map', JSON.stringify(useMap))
    return api.upload(v('/business/sales/upload'), form)
  }
  const check = (useMap) => run(async () => { const r = await send(false, useMap); setPreview(r); setMap(r.map) })
  const commit = () => run(async () => {
    const r = await send(true, map)
    toast(`Imported ${r.imported} day${r.imported === 1 ? '' : 's'}${r.replaced ? `, ${r.replaced} updated` : ''}${r.skipped ? `, ${r.skipped} rows skipped` : ''}.`)
    setFile(null); setPreview(null); setMap(null); onDone()
  })
  const pickFile = (e) => { setFile(e.target.files[0] || null); setPreview(null); setMap(null) }
  const setCol = (k, val) => { const m = { ...map, [k]: Number(val) }; setMap(m); check(m) }

  return (
    <div className="card stack">
      <h3>Or upload the Epos Now report</h3>
      <p className="small muted">In Epos Now Back Office, open the End of Day (or sales summary) report, export it as CSV, and choose it here. You'll see what was read before anything is saved.</p>
      <input type="file" accept=".csv,text/csv" onChange={pickFile} />
      <label className="check"><input type="checkbox" checked={includesVat} onChange={(e) => setIncludesVat(e.target.checked)} /> Sales in this report include VAT</label>
      {!preview && <button className="btn secondary block" disabled={busy || !file} onClick={() => check(null)}>Check the file</button>}
      {preview && (
        <>
          <div className="small"><b>Which column is which?</b> These are remembered for next time.</div>
          <div className="grid2">{MAP_FIELDS.map(([k, label, req]) => (
            <Field key={k} label={label + (req ? '' : ' (optional)')}>
              <select value={map?.[k] ?? -1} disabled={busy} onChange={(e) => setCol(k, e.target.value)}>
                {!req && <option value={-1}>Not in this file</option>}
                {req && (map?.[k] ?? -1) < 0 && <option value={-1}>Choose…</option>}
                {preview.headers.map((hd, i) => <option key={i} value={i}>{hd || `Column ${i + 1}`}</option>)}
              </select>
            </Field>
          ))}</div>
          {preview.rows === 0 ? <div className="err small">No rows had a date and a sales figure with these columns. Try different columns.</div> : (
            <div className="okbox small">
              Found {preview.rows} day{preview.rows === 1 ? '' : 's'}:
              <ul className="list">{preview.preview.map((p, i) => <li key={i}>{fmtDate(p.sales_date)}: {money(p.net_sales)}{p.covers != null ? ` · ${p.covers} covers` : ''}</li>)}</ul>
              {preview.rows > preview.preview.length && <div className="tiny">and {preview.rows - preview.preview.length} more.</div>}
            </div>
          )}
          {preview.skipped.length > 0 && <div className="warn tiny">Skipped rows without a date or amount, for example: {preview.skipped[0]}</div>}
          <div className="row">
            <button className="btn grow" disabled={busy || preview.rows === 0} onClick={commit}>Import {preview.rows} day{preview.rows === 1 ? '' : 's'}</button>
            <button className="btn ghost" disabled={busy} onClick={() => { setPreview(null); setMap(null) }}>Cancel</button>
          </div>
          <p className="tiny muted">Days already uploaded are replaced by this report. Typed figures are kept, but the report is used.</p>
        </>
      )}
    </div>
  )
}
