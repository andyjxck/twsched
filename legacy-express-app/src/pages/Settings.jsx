import { useEffect, useState } from 'react'
import { api, v } from '../api.js'
import { useLoad, Loader, Field, useAction, useApp, fmtRange } from '../ui.jsx'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// Venue settings (managers and owner). Everything here belongs to this venue only,
// so a second pub gets its own roles, VAT choice, overtime limit and blackout dates.
export default function Settings() {
  const { reloadMe } = useApp()
  const state = useLoad(() => api.get(v('/business/settings')))
  return <Loader state={state}>{(s) => <SettingsForm s={s} reload={state.reload} reloadMe={reloadMe} />}</Loader>
}

function SettingsForm({ s, reload, reloadMe }) {
  const [f, setF] = useState(null)
  const [newPos, setNewPos] = useState('')
  const [b, setB] = useState({ start_date: '', end_date: '', label: '' })
  const [busy, run] = useAction()
  useEffect(() => {
    setF({ leave_year_start_month: s.leave_year_start_month, weekly_hours_limit: s.weekly_hours_limit, vat_rate: s.vat_rate, labour_on_ex_vat: !!s.labour_on_ex_vat, positions: [...(s.positions || [])] })
  }, [s])
  if (!f) return null

  const save = () => run(async () => {
    await api.patch(v('/business/settings'), { ...f, weekly_hours_limit: Number(f.weekly_hours_limit), vat_rate: Number(f.vat_rate), leave_year_start_month: Number(f.leave_year_start_month) })
    await reloadMe() // roles list is used across the app
    reload()
  }, 'Settings saved.')
  const addPos = () => { const p = newPos.trim(); if (p && !f.positions.includes(p)) setF({ ...f, positions: [...f.positions, p] }); setNewPos('') }
  const removePos = (p) => setF({ ...f, positions: f.positions.filter((x) => x !== p) })
  const addBlackout = () => run(async () => { await api.post(v('/business/blackouts'), b); setB({ start_date: '', end_date: '', label: '' }); reload() }, 'Blackout dates added.')
  const delBlackout = (id) => run(async () => { await api.del(v(`/business/blackouts/${id}`)); reload() }, 'Removed.')

  return (
    <>
      <div className="card">
        <b>{s.name}</b>
        <div className="tiny muted">Time zone {s.timezone}</div>
      </div>

      <div className="card stack">
        <h3>Holiday and hours</h3>
        <Field label="Holiday year starts in" hint="Accrued, taken, booked and left are worked out from this month.">
          <select value={f.leave_year_start_month} onChange={(e) => setF({ ...f, leave_year_start_month: e.target.value })}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
        </Field>
        <Field label="Overtime alert above (hours a week)" hint="The rota and the labour page flag anyone over this. The legal default is 48 on average unless they've opted out.">
          <input type="number" min="1" max="100" step="0.5" value={f.weekly_hours_limit} onChange={(e) => setF({ ...f, weekly_hours_limit: e.target.value })} />
        </Field>
      </div>

      <div className="card stack">
        <h3>Sales figures</h3>
        <Field label="VAT rate (%)"><input type="number" min="0" max="50" step="0.5" value={f.vat_rate} onChange={(e) => setF({ ...f, vat_rate: e.target.value })} /></Field>
        <label className="check"><input type="checkbox" checked={f.labour_on_ex_vat} onChange={(e) => setF({ ...f, labour_on_ex_vat: e.target.checked })} /> Work out labour % on sales without VAT</label>
        <p className="tiny muted">Epos Now's End of Day report gives sales including VAT. Tick this to take VAT off before comparing with wages.</p>
      </div>

      <div className="card stack">
        <h3>Roles</h3>
        <p className="tiny muted">Used on the rota, for shift positions and for who an announcement is for.</p>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {f.positions.map((p) => <span key={p} className="pill">{p} <button className="btn ghost sm" style={{ minHeight: 0, padding: '0 4px' }} aria-label={`Remove ${p}`} disabled={f.positions.length <= 1} onClick={() => removePos(p)}>×</button></span>)}
        </div>
        <div className="row">
          <input className="grow" value={newPos} maxLength={60} placeholder="e.g. Kitchen porter" onChange={(e) => setNewPos(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addPos()} />
          <button className="btn secondary" disabled={!newPos.trim()} onClick={addPos}>Add</button>
        </div>
      </div>

      <button className="btn block" disabled={busy || f.positions.length === 0} onClick={save}>Save settings</button>

      <h2>Blackout dates</h2>
      <div className="card stack">
        <p className="tiny muted">Busy days to keep clear, like Christmas or a big wedding. Anyone asking for time off over these dates is warned it's likely to be declined, and you still decide.</p>
        {s.blackouts.length === 0 ? <p className="muted small">None set.</p> : (
          <ul className="list">{s.blackouts.map((x) => (
            <li key={x.id} className="row between"><span><b>{x.label}</b> <span className="tiny muted">{fmtRange(x.start_date, x.end_date)}</span></span><button className="btn ghost sm" disabled={busy} onClick={() => delBlackout(x.id)}>Remove</button></li>
          ))}</ul>
        )}
        <Field label="What for"><input value={b.label} maxLength={80} placeholder="e.g. Christmas week" onChange={(e) => setB({ ...b, label: e.target.value })} /></Field>
        <div className="grid2">
          <Field label="From"><input type="date" value={b.start_date} onChange={(e) => setB({ ...b, start_date: e.target.value })} /></Field>
          <Field label="To"><input type="date" value={b.end_date} min={b.start_date || undefined} onChange={(e) => setB({ ...b, end_date: e.target.value })} /></Field>
        </div>
        <button className="btn secondary block" disabled={busy || b.label.trim().length < 2 || !b.start_date || !b.end_date || b.end_date < b.start_date} onClick={addBlackout}>Add blackout dates</button>
      </div>
    </>
  )
}
