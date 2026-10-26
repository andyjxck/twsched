import { useEffect, useState } from 'react'
import { api, v } from '../api.js'
import { useLoad, Loader, Field, Modal, useAction, useApp, fmtDateTime } from '../ui.jsx'

export default function News() {
  const { isManager, venue } = useApp()
  const state = useLoad(() => api.get(v('/announcements')))
  const [f, setF] = useState({ title: '', body: '', audience: '', pinned: false, expires: '' })
  const [reads, setReads] = useState(null)
  const [busy, run] = useAction()

  // Mark everything shown as read.
  useEffect(() => {
    for (const a of state.data || []) if (!a.read) api.post(v(`/announcements/${a.id}/read`)).catch(() => {})
  }, [state.data])

  const post = () => run(async () => {
    await api.post(v('/announcements'), { title: f.title, body: f.body, audience: f.audience || null, pinned: f.pinned, expires_at: f.expires ? new Date(f.expires + 'T23:59:00').toISOString() : null })
    setF({ title: '', body: '', audience: '', pinned: false, expires: '' }); state.reload()
  }, 'Posted. Everyone it\'s for gets a notification.')
  const del = (id) => run(async () => { await api.del(v(`/announcements/${id}`)); state.reload() }, 'Deleted.')
  const showReads = async (a) => setReads({ a, list: await api.get(v(`/announcements/${a.id}/reads`)) })

  return (
    <>
      {isManager && (
        <div className="card stack">
          <h3>Post to the team</h3>
          <Field label="Title"><input value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Message"><textarea value={f.body} maxLength={4000} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
          <div className="grid2">
            <Field label="Who for"><select value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}><option value="">Everyone</option>{venue.positions.map((p) => <option key={p}>{p}</option>)}</select></Field>
            <Field label="Hide after (optional)"><input type="date" value={f.expires} onChange={(e) => setF({ ...f, expires: e.target.value })} /></Field>
          </div>
          <label className="check"><input type="checkbox" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} /> Pin to the top</label>
          <button className="btn block" disabled={busy || f.title.trim().length < 2 || !f.body.trim()} onClick={post}>Post</button>
        </div>
      )}
      <Loader state={state}>{(rows) => rows.length === 0 ? <p className="muted">No announcements yet.</p> : rows.map((a) => (
        <div key={a.id} className="card" style={a.pinned ? { borderLeft: '4px solid var(--gold)' } : {}}>
          <div className="row between"><b>{a.title}</b><div className="row" style={{ gap: 6 }}>{a.pinned && <span className="pill amber">Pinned</span>}{a.audience && <span className="pill">{a.audience}</span>}</div></div>
          <div style={{ whiteSpace: 'pre-wrap', margin: '6px 0' }}>{a.body}</div>
          <div className="tiny muted">{a.author} · {fmtDateTime(a.created_at)}{a.expires_at ? ` · hides ${fmtDateTime(a.expires_at)}` : ''}</div>
          {isManager && (
            <div className="row" style={{ marginTop: 6 }}>
              <button className="btn ghost sm" onClick={() => showReads(a)}>Read by {a.read_count} of {a.audience_count}</button>
              <button className="btn ghost sm" onClick={() => del(a.id)}>Delete</button>
            </div>
          )}
        </div>
      ))}</Loader>
      {reads && (
        <Modal title="Who's read it" onClose={() => setReads(null)}>
          {reads.list.length === 0 ? <p className="muted">Nobody yet.</p> : <ul className="list">{reads.list.map((r, i) => <li key={i}>{r.full_name} <span className="tiny muted">{fmtDateTime(r.read_at)}</span></li>)}</ul>}
        </Modal>
      )}
    </>
  )
}
