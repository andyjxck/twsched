import { useState } from 'react'
import { api, v } from '../api.js'
import { useLoad, Loader, Field, Modal, useAction, useApp, fmtDate, todayISO } from '../ui.jsx'

// Managers add what's on (quiz night, live music, Sunday roast) here. Only events marked
// "Show on website" reach the public site, through the read-only public events feed.
const blank = () => ({ title: '', description: '', event_date: todayISO(), start_time: '', end_time: '', is_published: true })

export default function Events() {
  const { venue } = useApp()
  const state = useLoad(() => api.get(v('/events')))
  const [editing, setEditing] = useState(null) // null = closed, {} = new, row = edit
  const [busy, run] = useAction()
  const today = todayISO()

  const togglePublish = (e) => run(async () => { await api.patch(v(`/events/${e.id}`), { is_published: !e.is_published }); state.reload() },
    e.is_published ? 'Hidden from the website.' : 'Now showing on the website.')
  const del = (e) => { if (!confirm(`Delete "${e.title}"?`)) return; run(async () => { await api.del(v(`/events/${e.id}`)); state.reload() }, 'Deleted.') }

  return (
    <>
      <div className="row between" style={{ marginBottom: 10 }}>
        <span className="small muted">Events marked "On website" appear on the {venue.name} website within a minute.</span>
        <button className="btn sm" onClick={() => setEditing(blank())}>Add event</button>
      </div>
      <Loader state={state}>{(rows) => {
        const upcoming = rows.filter((e) => e.event_date.slice(0, 10) >= today)
        const past = rows.filter((e) => e.event_date.slice(0, 10) < today).reverse()
        return (
          <>
            {upcoming.length === 0 ? <div className="card muted">Nothing coming up. Add the next quiz, band or special night.</div> : upcoming.map((e) => (
              <EventCard key={e.id} e={e} busy={busy} onEdit={() => setEditing(e)} onToggle={() => togglePublish(e)} onDelete={() => del(e)} />
            ))}
            {past.length > 0 && (
              <details className="card tight">
                <summary className="small muted">Past 30 days ({past.length})</summary>
                <ul className="list">{past.map((e) => (
                  <li key={e.id} className="row between"><span>{fmtDate(e.event_date)} · {e.title}</span><button className="btn ghost sm" onClick={() => setEditing({ ...e, id: undefined, event_date: today })}>Repeat</button></li>
                ))}</ul>
              </details>
            )}
          </>
        )
      }}</Loader>
      {editing && <EventForm initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); state.reload() }} />}
    </>
  )
}

function EventCard({ e, busy, onEdit, onToggle, onDelete }) {
  const time = e.start_time ? e.start_time + (e.end_time ? '–' + e.end_time : '') : 'All day'
  return (
    <div className="card" style={{ borderLeft: `4px solid ${e.is_published ? 'var(--green)' : 'var(--line)'}` }}>
      <div className="row between">
        <b>{e.title}</b>
        {e.is_published ? <span className="pill green">On website</span> : <span className="pill">Draft</span>}
      </div>
      <div className="small" style={{ margin: '4px 0' }}>{fmtDate(e.event_date, { weekday: 'long', day: 'numeric', month: 'long' })} · {time}</div>
      {e.description && <div className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{e.description}</div>}
      <div className="row" style={{ marginTop: 6 }}>
        <button className="btn ghost sm" onClick={onEdit}>Edit</button>
        <button className="btn ghost sm" disabled={busy} onClick={onToggle}>{e.is_published ? 'Hide from website' : 'Show on website'}</button>
        <button className="btn ghost sm" disabled={busy} onClick={onDelete}>Delete</button>
      </div>
    </div>
  )
}

function EventForm({ initial, onClose, onSaved }) {
  const [f, setF] = useState({ ...initial, event_date: (initial.event_date || '').slice(0, 10), description: initial.description || '', start_time: initial.start_time || '', end_time: initial.end_time || '' })
  const [busy, run] = useAction()
  const timeBad = f.end_time && !f.start_time
  const save = () => run(async () => {
    const b = { title: f.title.trim(), description: f.description.trim() || null, event_date: f.event_date, start_time: f.start_time || null, end_time: f.end_time || null, is_published: f.is_published }
    if (f.id) await api.patch(v(`/events/${f.id}`), b); else await api.post(v('/events'), b)
    onSaved()
  }, f.id ? 'Saved.' : (f.is_published ? 'Added, and showing on the website.' : 'Saved as a draft.'))
  return (
    <Modal title={f.id ? 'Edit event' : 'New event'} onClose={onClose}>
      <div className="stack">
        <Field label="What's on"><input value={f.title} maxLength={120} placeholder="Quiz night" onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Date"><input type="date" value={f.event_date} onChange={(e) => setF({ ...f, event_date: e.target.value })} /></Field>
        <div className="grid2">
          <Field label="Starts (optional)"><input type="time" value={f.start_time} onChange={(e) => setF({ ...f, start_time: e.target.value })} /></Field>
          <Field label="Ends (optional)"><input type="time" value={f.end_time} onChange={(e) => setF({ ...f, end_time: e.target.value })} /></Field>
        </div>
        {timeBad && <div className="warn small">Add a start time as well as an end time.</div>}
        <Field label="Details for the website (optional)" hint="Up to 1,000 characters. Keep it short: price, booking, who's playing."><textarea value={f.description} maxLength={1000} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <label className="check"><input type="checkbox" checked={f.is_published} onChange={(e) => setF({ ...f, is_published: e.target.checked })} /> Show on the website</label>
        <button className="btn block" disabled={busy || f.title.trim().length < 2 || !f.event_date || timeBad} onClick={save}>{f.id ? 'Save' : 'Add event'}</button>
      </div>
    </Modal>
  )
}
