import { useState } from 'react'
import { api, v } from '../api.js'
import { useLoad, Loader, Field, useAction, useApp, Status, fmtDateTime } from '../ui.jsx'

// Managers send out payslip PDFs that payroll has already produced. The app never works out pay.
// Upload -> (check) -> release. Staff get a notification and open their own copy from the Me page.
// Only the owner can open someone else's payslip; managers see the list and status only.
export default function Payslips() {
  const { isOwner } = useApp()
  const list = useLoad(() => api.get(v('/payslips')))
  const team = useLoad(() => api.get(v('/team')))
  const [f, setF] = useState({ membership_id: '', period_label: '' })
  const [file, setFile] = useState(null)
  const [fileKey, setFileKey] = useState(0)
  const [picked, setPicked] = useState([])
  const [busy, run] = useAction()

  const upload = () => run(async () => {
    const form = new FormData()
    form.append('membership_id', f.membership_id)
    form.append('period_label', f.period_label.trim())
    form.append('file', file)
    await api.upload(v('/payslips'), form)
    // Keep the period so the next person's payslip for the same week/month is quicker.
    setF({ ...f, membership_id: '' }); setFile(null); setFileKey((k) => k + 1); list.reload()
  }, 'Uploaded. It stays hidden from them until you release it.')

  const release = (ids) => run(async () => {
    const r = await api.post(v('/payslips/release'), { ids })
    setPicked([]); list.reload()
    return r
  }, 'Released. Each person gets a notification.')

  const withdraw = (id) => run(async () => { await api.post(v(`/payslips/${id}/withdraw`)); setPicked((p) => p.filter((x) => x !== id)); list.reload() }, 'Withdrawn and deleted.')
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  return (
    <>
      <div className="card stack">
        <h3>Upload a payslip</h3>
        <p className="tiny muted">Upload the PDF your payroll provider or accountant already made. This app doesn't calculate pay. Nobody sees it until you release it.</p>
        <Loader state={team}>{(people) => (
          <Field label="Who for">
            <select value={f.membership_id} onChange={(e) => setF({ ...f, membership_id: e.target.value })}>
              <option value="">Pick someone</option>
              {people.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </Field>
        )}</Loader>
        <Field label="Pay period" hint="e.g. Week ending 25 Oct 2026, or October 2026"><input value={f.period_label} maxLength={60} onChange={(e) => setF({ ...f, period_label: e.target.value })} /></Field>
        <Field label="Payslip PDF (up to 10 MB)"><input key={fileKey} type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files[0] || null)} /></Field>
        <button className="btn block" disabled={busy || !f.membership_id || f.period_label.trim().length < 2 || !file} onClick={upload}>Upload</button>
      </div>

      <Loader state={list}>{(rows) => {
        const waiting = rows.filter((p) => p.status === 'uploaded')
        const sent = rows.filter((p) => p.status !== 'uploaded')
        return (
          <>
            <h2>Not released yet</h2>
            {waiting.length === 0 ? <p className="muted small">Nothing waiting.</p> : (
              <div className="card tight">
                <ul className="list">{waiting.map((p) => (
                  <li key={p.id} className="row between">
                    <label className="check"><input type="checkbox" checked={picked.includes(p.id)} onChange={() => toggle(p.id)} /><span><b>{p.full_name}</b><div className="tiny muted">{p.period_label} · {p.file_name}</div></span></label>
                    <div className="row" style={{ gap: 6 }}>
                      {isOwner && <a className="btn ghost sm" href={v(`/payslips/${p.id}/file`)} target="_blank" rel="noreferrer">Open</a>}
                      <button className="btn ghost sm" disabled={busy} onClick={() => withdraw(p.id)}>Withdraw</button>
                    </div>
                  </li>
                ))}</ul>
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="btn secondary grow" disabled={busy || picked.length === 0} onClick={() => release(picked)}>Release selected ({picked.length})</button>
                  <button className="btn grow" disabled={busy} onClick={() => release(waiting.map((p) => p.id))}>Release all ({waiting.length})</button>
                </div>
              </div>
            )}

            <h2>Sent</h2>
            {sent.length === 0 ? <p className="muted small">None sent yet.</p> : (
              <div className="card tight">
                <ul className="list">{sent.map((p) => (
                  <li key={p.id} className="row between">
                    <div><b>{p.full_name}</b><div className="tiny muted">{p.period_label} · released {fmtDateTime(p.released_at)}{p.viewed_at ? ` · opened ${fmtDateTime(p.viewed_at)}` : ''}</div></div>
                    <div className="row" style={{ gap: 6 }}>
                      <Status s={p.status} />
                      {isOwner && <a className="btn ghost sm" href={v(`/payslips/${p.id}/file`)} target="_blank" rel="noreferrer">Open</a>}
                    </div>
                  </li>
                ))}</ul>
              </div>
            )}
            {!isOwner && <p className="tiny muted">Payslips are private. Only the person and the owner can open them; you can see whether each one has been released and opened.</p>}
          </>
        )
      }}</Loader>
    </>
  )
}
