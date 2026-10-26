import { useState } from 'react'
import { api, v } from '../api.js'
import { useLoad, Loader, Field, Modal, useAction, fmtDate, fmtDateTime, todayISO } from '../ui.jsx'

// Right to work documents. Personal data under UK GDPR: the route is only reachable by the owner
// and managers the owner has given the documents permission (the server checks this too).
// Files are encrypted on the server, every view is logged, and copies are deleted 2 years after someone leaves.
const METHODS = { manual: 'Manual check of original document', online_share_code: 'Home Office online check (share code)', idsp: 'Identity service provider (IDSP)' }
const ACTIONS = { rtw_uploaded: 'Uploaded', rtw_viewed: 'Opened', rtw_deleted_retention: 'Deleted (retention ended)' }
const blank = { membership_id: '', doc_type: '', check_date: '', check_method: 'manual', expiry_date: '', replaces_id: '' }

export default function Documents() {
  const state = useLoad(() => api.get(v('/documents')))
  const team = useLoad(() => api.get(v('/team')))
  const [f, setF] = useState({ ...blank, check_date: todayISO() })
  const [file, setFile] = useState(null)
  const [fileKey, setFileKey] = useState(0)
  const [log, setLog] = useState(null)
  const [busy, run] = useAction()

  const upload = () => run(async () => {
    const form = new FormData()
    for (const [k, val] of Object.entries(f)) form.append(k, val)
    form.append('file', file)
    await api.upload(v('/documents'), form)
    setF({ ...blank, check_date: todayISO() }); setFile(null); setFileKey((k) => k + 1); state.reload()
  }, 'Saved and encrypted.')
  const delExpired = (id) => run(async () => { await api.post(v(`/documents/${id}/delete-expired`)); state.reload() }, 'Deleted. The retention period had ended.')
  const showLog = async () => setLog(await api.get(v('/documents/log')))
  const replace = (d) => { setF({ ...blank, check_date: todayISO(), membership_id: String(d.membership_id), doc_type: d.doc_type, replaces_id: String(d.id) }); window.scrollTo(0, 0) }

  return (
    <>
      <div className="warn" style={{ marginBottom: 12 }}>These are personal documents. Only open one when you need to, don't download copies to your own phone, and never share them. Every time a document is opened it's logged with your name.</div>

      <div className="card stack">
        <h3>{f.replaces_id ? 'Replace a document' : 'Add a right to work check'}</h3>
        <Loader state={team}>{(people) => (
          <Field label="Team member">
            <select value={f.membership_id} disabled={!!f.replaces_id} onChange={(e) => setF({ ...f, membership_id: e.target.value })}>
              <option value="">Pick someone</option>
              {people.filter((p) => p.is_active && p.role !== 'owner').map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </Field>
        )}</Loader>
        <Field label="Document" hint="e.g. UK passport, Share code result, BRP"><input value={f.doc_type} maxLength={80} onChange={(e) => setF({ ...f, doc_type: e.target.value })} /></Field>
        <div className="grid2">
          <Field label="Date checked"><input type="date" value={f.check_date} onChange={(e) => setF({ ...f, check_date: e.target.value })} /></Field>
          <Field label="Permission ends (if any)"><input type="date" value={f.expiry_date} onChange={(e) => setF({ ...f, expiry_date: e.target.value })} /></Field>
        </div>
        <Field label="How it was checked"><select value={f.check_method} onChange={(e) => setF({ ...f, check_method: e.target.value })}>{Object.entries(METHODS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Field>
        <Field label="Scan or photo (PDF, JPEG or PNG, up to 10 MB)"><input key={fileKey} type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files[0] || null)} /></Field>
        <button className="btn block" disabled={busy || !f.membership_id || f.doc_type.trim().length < 2 || !f.check_date || !file} onClick={upload}>Save document</button>
        {f.replaces_id && <button className="btn ghost block" onClick={() => setF({ ...blank, check_date: todayISO() })}>Cancel replacing</button>}
      </div>

      <Loader state={state}>{(d) => (
        <>
          {d.missing.length > 0 && (
            <div className="card">
              <h3>No check on file ({d.missing.length})</h3>
              <p className="tiny muted">Everyone must have a right to work check before their first shift.</p>
              <ul className="list">{d.missing.map((m) => <li key={m.id}>{m.full_name}</li>)}</ul>
            </div>
          )}
          {d.expiring.length > 0 && (
            <div className="card">
              <h3>Permission ending within 60 days</h3>
              <p className="tiny muted">Do a follow-up check before the date, then replace the document.</p>
              <ul className="list">{d.expiring.map((x) => <li key={x.id} className="row between"><span><b>{x.full_name}</b> <span className="tiny muted">ends {fmtDate(x.expiry_date)}</span></span><button className="btn ghost sm" onClick={() => replace(x)}>Replace</button></li>)}</ul>
            </div>
          )}
          {d.due_for_deletion.length > 0 && (
            <div className="card">
              <h3>Due for deletion</h3>
              <p className="tiny muted">These people left over 2 years ago, so the copies should now be deleted.</p>
              <ul className="list">{d.due_for_deletion.map((x) => <li key={x.id} className="row between"><span><b>{x.full_name}</b> <span className="tiny muted">left {fmtDate(x.leave_date)}</span></span><button className="btn danger sm" disabled={busy} onClick={() => delExpired(x.id)}>Delete</button></li>)}</ul>
            </div>
          )}

          <div className="row between"><h2>On file</h2><button className="btn ghost sm" onClick={showLog}>Access log</button></div>
          {d.documents.length === 0 ? <p className="muted small">No documents yet.</p> : (
            <div className="card tight">
              <ul className="list">{d.documents.map((x) => (
                <li key={x.id} className="row between">
                  <div>
                    <b>{x.full_name}</b>
                    <div className="tiny muted">{x.doc_type} · checked {fmtDate(x.check_date)} · {METHODS[x.check_method] || x.check_method}{x.expiry_date ? ` · ends ${fmtDate(x.expiry_date)}` : ''}{x.leave_date ? ` · left ${fmtDate(x.leave_date)}, delete after ${fmtDate(x.delete_after)}` : ''}</div>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <a className="btn secondary sm" href={v(`/documents/${x.id}/file`)} target="_blank" rel="noreferrer">Open</a>
                    <button className="btn ghost sm" onClick={() => replace(x)}>Replace</button>
                  </div>
                </li>
              ))}</ul>
            </div>
          )}
        </>
      )}</Loader>

      {log && (
        <Modal title="Access log" onClose={() => setLog(null)}>
          {log.length === 0 ? <p className="muted">Nothing logged yet.</p> : (
            <ul className="list">{log.map((l, i) => <li key={i}>{ACTIONS[l.action] || l.action} by {l.by_name || 'system'} <span className="tiny muted">{fmtDateTime(l.created_at)} · document #{l.target_id}</span></li>)}</ul>
          )}
        </Modal>
      )}
    </>
  )
}
