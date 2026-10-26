import { useEffect, useState } from 'react'
import { api, v } from '../api.js'
import { useLoad, Loader, Field, useAction, useApp, Status, fmtDate, fmtDateTime } from '../ui.jsx'

export default function Me() {
  const { me, venue, go } = useApp()
  const payslips = useLoad(() => api.get(v('/my/payslips')))
  const docs = useLoad(() => api.get(v('/my/documents')))
  const [pw, setPw] = useState({ current: '', next: '' })
  const [busy, run] = useAction()
  const changePw = () => run(async () => { await api.post('/api/auth/password', pw); setPw({ current: '', next: '' }) }, 'Password changed. Other devices have been signed out.')
  const logout = async () => { await api.post('/api/auth/logout'); location.href = import.meta.env.BASE_URL }
  return (
    <>
      <div className="card">
        <b>{me.user.full_name}</b>
        <div className="small muted">{me.user.email}</div>
        <div className="small muted">{venue.position || ''} {venue.position ? '· ' : ''}{venue.role} at {venue.name}</div>
        {me.venues.length > 1 && (
          <Field label="Venue"><select value={venue.id} onChange={(e) => { localStorage.setItem('swan_venue', e.target.value); location.reload() }}>{me.venues.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        )}
      </div>

      <h2>Payslips</h2>
      <Loader state={payslips}>{(rows) => rows.length === 0 ? <p className="muted small">None yet.</p> : (
        <div className="card tight"><ul className="list">{rows.map((p) => (
          <li key={p.id} className="row between"><div><b>{p.period_label}</b><div className="tiny muted">Released {fmtDateTime(p.released_at)}</div></div><a className="btn secondary sm" href={v(`/my/payslips/${p.id}/file`)} target="_blank" rel="noreferrer" onClick={() => setTimeout(payslips.reload, 1500)}>Open</a></li>
        ))}</ul></div>
      )}</Loader>

      <h2>My right to work record</h2>
      <Loader state={docs}>{(rows) => rows.length === 0 ? <p className="muted small">Nothing on file. A manager adds this when you start.</p> : (
        <div className="card tight"><ul className="list">{rows.map((d) => (
          <li key={d.id} className="row between"><div><b>{d.doc_type}</b><div className="tiny muted">Checked {fmtDate(d.check_date)}{d.expiry_date ? ` · expires ${fmtDate(d.expiry_date)}` : ''}</div></div><a className="btn secondary sm" href={v(`/my/documents/${d.id}/file`)} target="_blank" rel="noreferrer">View</a></li>
        ))}</ul></div>
      )}</Loader>

      <InstallCard />

      <h2>Change password</h2>
      <div className="card stack">
        <Field label="Current password"><input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
        <Field label="New password (10+ characters)"><input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
        <button className="btn secondary block" disabled={busy || !pw.current || pw.next.length < 10} onClick={changePw}>Change password</button>
      </div>
      <button className="btn danger block" onClick={logout}>Sign out</button>
    </>
  )
}

export function InstallCard() {
  const [prompt, setPrompt] = useState(null)
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone
  useEffect(() => {
    const f = (e) => { e.preventDefault(); setPrompt(e) }
    window.addEventListener('beforeinstallprompt', f)
    return () => window.removeEventListener('beforeinstallprompt', f)
  }, [])
  if (standalone) return null
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>Put it on your home screen</h3>
      {prompt ? <button className="btn block" onClick={() => prompt.prompt()}>Install the app</button>
        : ios ? <p className="small">On iPhone, open this in <b>Safari</b>, tap the <b>Share</b> button, then <b>Add to Home Screen</b>.</p>
          : <p className="small">On Android, open the browser menu (three dots) and tap <b>Install app</b> or <b>Add to Home screen</b>.</p>}
      <p className="tiny muted">It then opens full screen like a normal app.</p>
    </div>
  )
}
