import { useState } from 'react'
import { api, v, pageUrl } from '../api.js'
import { useLoad, Loader, Field, Modal, useAction, useApp, r1 } from '../ui.jsx'
import { BalanceView } from './Holiday.jsx'

export default function Team() {
  const state = useLoad(() => api.get(v('/team')))
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [link, setLink] = useState(null)
  return (
    <>
      <div className="row between" style={{ marginBottom: 10 }}>
        <span className="small muted">Only managers can see this page.</span>
        <button className="btn sm" onClick={() => setAdding(true)}>Add person</button>
      </div>
      <Loader state={state}>{(rows) => (
        <div className="card tight"><ul className="list">{rows.map((p) => (
          <li key={p.id} className="row between" style={{ opacity: p.is_active ? 1 : .5, cursor: 'pointer' }} onClick={() => setEditing(p)}>
            <div className="grow">
              <b>{p.full_name}</b> {!p.has_password && <span className="pill amber">Invite not used</span>} {!p.is_active && <span className="pill">Left</span>}
              <div className="tiny muted">{p.role}{p.position ? ' · ' + p.position : ''}{p.holiday_type ? ` · ${p.holiday_type} hours` : ''}{p.pay_rate ? ` · £${p.pay_rate}/h` : ''}</div>
            </div>
            <span className="muted">›</span>
          </li>
        ))}</ul></div>
      )}</Loader>
      {adding && <AddPerson onClose={() => setAdding(false)} onDone={(l) => { setAdding(false); setLink(l); state.reload() }} />}
      {editing && <EditPerson p={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); state.reload() }} onLink={setLink} />}
      {link && <LinkModal link={link} onClose={() => setLink(null)} />}
    </>
  )
}

function LinkModal({ link, onClose }) {
  const url = pageUrl(link)
  const [copied, setCopied] = useState(false)
  return (
    <Modal title="Send them this link" onClose={onClose}>
      <p className="small">Send it by text or WhatsApp. They open it, pick a password, and they're in. It works once and expires in 7 days.</p>
      <div className="linkbox">{url}</div>
      <button className="btn block" style={{ marginTop: 10 }} onClick={() => navigator.clipboard?.writeText(url).then(() => setCopied(true))}>{copied ? 'Copied' : 'Copy link'}</button>
    </Modal>
  )
}

function ProfileFields({ f, setF }) {
  const { venue } = useApp()
  return (
    <>
      <div className="grid2">
        <Field label="Role in the app"><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="staff">Staff</option><option value="supervisor">Supervisor</option><option value="manager">Manager (owner only)</option></select></Field>
        <Field label="Position"><select value={f.position || ''} onChange={(e) => setF({ ...f, position: e.target.value })}><option value="">–</option>{venue.positions.map((p) => <option key={p}>{p}</option>)}</select></Field>
      </div>
      <Field label="Holiday type" hint="Irregular: zero-hours or varying shifts, holiday builds up at 12.07% of hours worked. Regular: fixed days each week.">
        <select value={f.holiday_type} onChange={(e) => setF({ ...f, holiday_type: e.target.value })}><option value="regular">Regular hours</option><option value="irregular">Irregular hours / zero hours</option></select>
      </Field>
      <div className="grid2">
        {f.holiday_type === 'regular' && <Field label="Days a week"><input type="number" min="0" max="7" step="0.5" value={f.days_per_week ?? ''} onChange={(e) => setF({ ...f, days_per_week: e.target.value })} /></Field>}
        <Field label="Hours in a holiday day"><input type="number" min="1" max="24" step="0.5" value={f.hours_per_day ?? ''} onChange={(e) => setF({ ...f, hours_per_day: e.target.value })} /></Field>
        <Field label="Contracted hours/week"><input type="number" min="0" max="80" value={f.contracted_hours ?? ''} onChange={(e) => setF({ ...f, contracted_hours: e.target.value })} placeholder="none" /></Field>
        <Field label="Pay rate (£/hour)"><input type="number" min="0" step="0.01" value={f.pay_rate ?? ''} onChange={(e) => setF({ ...f, pay_rate: e.target.value })} /></Field>
        <Field label="Start date"><input type="date" value={f.start_date || ''} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
        <Field label="Leaving date"><input type="date" value={f.leave_date || ''} onChange={(e) => setF({ ...f, leave_date: e.target.value })} /></Field>
      </div>
    </>
  )
}
const num = (x) => (x === '' || x == null ? null : Number(x))
const profileBody = (f) => ({ role: f.role, position: f.position || null, holiday_type: f.holiday_type, days_per_week: num(f.days_per_week) ?? undefined, hours_per_day: num(f.hours_per_day) ?? undefined, contracted_hours: num(f.contracted_hours), pay_rate: num(f.pay_rate), start_date: f.start_date || null, leave_date: f.leave_date || null })

function AddPerson({ onClose, onDone }) {
  const [f, setF] = useState({ full_name: '', email: '', phone: '', role: 'staff', position: '', holiday_type: 'irregular', days_per_week: 5, hours_per_day: 8, contracted_hours: '', pay_rate: '', start_date: '', leave_date: '', opening: '' })
  const [busy, run] = useAction()
  const save = () => run(async () => { const r = await api.post(v('/team'), { ...profileBody(f), full_name: f.full_name, email: f.email, phone: f.phone || null, opening_balance_hours: f.opening === '' ? undefined : Number(f.opening) }); onDone(r.invite_link) })
  return (
    <Modal title="Add someone" onClose={onClose}>
      <div className="stack">
        <Field label="Full name"><input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <div className="grid2">
          <Field label="Email (they sign in with it)"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Phone"><input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        </div>
        <ProfileFields f={f} setF={setF} />
        <Field label="Starting holiday balance (hours, optional)" hint="For people moving from cash in hand onto the books, leave this blank (zero) until your accountant confirms the right figure. You can add it later.">
          <input type="number" step="0.5" value={f.opening} onChange={(e) => setF({ ...f, opening: e.target.value })} />
        </Field>
        <button className="btn block" disabled={busy || f.full_name.length < 2 || !f.email.includes('@')} onClick={save}>Add and get invite link</button>
      </div>
    </Modal>
  )
}

function EditPerson({ p, onClose, onDone, onLink }) {
  const { isOwner } = useApp()
  const [tab, setTab] = useState('details')
  const [f, setF] = useState({ ...p })
  const [busy, run] = useAction()
  const save = () => run(async () => { await api.patch(v(`/team/${p.id}`), { ...profileBody(f), ...(f.role === p.role ? { role: undefined } : {}), full_name: f.full_name, phone: f.phone || null, ...(isOwner ? { can_view_documents: !!f.can_view_documents } : {}) }); onDone() }, 'Saved.')
  const toggleActive = () => run(async () => { await api.patch(v(`/team/${p.id}`), { is_active: !p.is_active }); onDone() }, p.is_active ? 'Marked as left. They can no longer sign in here.' : 'Reactivated.')
  const reset = () => run(async () => { const r = await api.post(v(`/team/${p.id}/reset-link`)); onLink(r.link) })
  return (
    <Modal title={p.full_name} onClose={onClose}>
      <div className="segment">
        <button className={tab === 'details' ? 'on' : ''} onClick={() => setTab('details')}>Details</button>
        <button className={tab === 'holiday' ? 'on' : ''} onClick={() => setTab('holiday')}>Holiday</button>
      </div>
      {tab === 'details' ? (
        <div className="stack">
          <div className="small muted">{p.email}</div>
          <div className="grid2">
            <Field label="Full name"><input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
            <Field label="Phone"><input type="tel" value={f.phone || ''} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          </div>
          <ProfileFields f={f} setF={setF} />
          {isOwner && f.role === 'manager' && <label className="check"><input type="checkbox" checked={!!f.can_view_documents} onChange={(e) => setF({ ...f, can_view_documents: e.target.checked })} /> Can open right to work documents</label>}
          <button className="btn block" disabled={busy} onClick={save}>Save</button>
          <div className="row">
            <button className="btn secondary grow" disabled={busy} onClick={reset}>{p.has_password ? 'Password reset link' : 'New invite link'}</button>
            <button className="btn secondary grow" disabled={busy} onClick={toggleActive}>{p.is_active ? 'Mark as left' : 'Reactivate'}</button>
          </div>
        </div>
      ) : <HolidayTab p={p} />}
    </Modal>
  )
}

function HolidayTab({ p }) {
  const state = useLoad(() => api.get(v(`/team/${p.id}/holiday`)))
  const [e, setE] = useState({ kind: 'adjustment', hours: '', note: '' })
  const [busy, run] = useAction()
  const add = () => run(async () => { await api.post(v(`/team/${p.id}/ledger`), { ...e, hours: Number(e.hours) }); setE({ kind: 'adjustment', hours: '', note: '' }); state.reload() }, 'Added to the holiday record.')
  return (
    <>
      <Loader state={state}>{(b) => <BalanceView b={b} />}</Loader>
      <div className="card stack">
        <h3>Add a correction or starting balance</h3>
        <p className="tiny muted">Entries can't be edited or deleted (holiday records must be kept for 6 years). To fix a mistake, add another entry that cancels it.</p>
        <div className="grid2">
          <Field label="Type"><select value={e.kind} onChange={(x) => setE({ ...e, kind: x.target.value })}><option value="opening">Starting balance</option><option value="carry_over">Carried over</option><option value="adjustment">Adjustment</option></select></Field>
          <Field label="Hours (+ or −)"><input type="number" step="0.5" value={e.hours} onChange={(x) => setE({ ...e, hours: x.target.value })} /></Field>
        </div>
        <Field label="Why"><input value={e.note} maxLength={300} onChange={(x) => setE({ ...e, note: x.target.value })} placeholder="e.g. Accountant confirmed 22.4h owed from cash in hand period" /></Field>
        <button className="btn secondary block" disabled={busy || e.hours === '' || e.note.trim().length < 3} onClick={add}>Add entry</button>
      </div>
    </>
  )
}
