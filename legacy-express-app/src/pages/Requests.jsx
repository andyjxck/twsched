import { useEffect, useState } from 'react'
import { api, v } from '../api.js'
import { useLoad, Loader, Field, useAction, useApp, Status, fmtDate, fmtRange, fmtDateTime, shiftText, todayISO, addDays, r1, WEEKDAYS } from '../ui.jsx'

export default function Requests() {
  const [tab, setTab] = useState(() => sessionStorage.getItem('req_tab') || 'time_off')
  useEffect(() => sessionStorage.setItem('req_tab', tab), [tab])
  return (
    <>
      <div className="segment">
        {[['time_off', 'Time off'], ['unavailable', 'Unavailable'], ['swaps', 'Swaps'], ['problems', 'Problems']].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'time_off' && <TimeOff />}
      {tab === 'unavailable' && <Unavailable />}
      {tab === 'swaps' && <Swaps />}
      {tab === 'problems' && <Problems />}
    </>
  )
}

function TimeOff() {
  const list = useLoad(() => api.get(v('/my/time-off')))
  const [f, setF] = useState({ kind: 'holiday', start_date: addDays(todayISO(), 14), end_date: addDays(todayISO(), 14), hours: '', note: '' })
  const [preview, setPreview] = useState(null)
  const [perr, setPerr] = useState(null)
  const [busy, run] = useAction()
  const body = () => ({ ...f, hours: f.hours === '' ? null : Number(f.hours), note: f.note || null })
  useEffect(() => {
    const t = setTimeout(() => {
      if (!f.start_date || !f.end_date) return
      api.post(v('/my/time-off/preview'), body()).then((p) => { setPreview(p); setPerr(null) }).catch((e) => { setPreview(null); setPerr(e.message) })
    }, 300)
    return () => clearTimeout(t)
  }, [f.kind, f.start_date, f.end_date, f.hours]) // eslint-disable-line
  const send = () => run(async () => { await api.post(v('/my/time-off'), body()); list.reload(); setF({ ...f, note: '' }) }, 'Request sent to the managers.')
  const act = (id, what) => run(async () => { await api.post(v(`/my/time-off/${id}/${what}`)); list.reload() }, what === 'withdraw' ? 'Withdrawn.' : 'Cancellation sent to a manager.')
  return (
    <>
      <div className="card stack">
        <h3>Ask for time off</h3>
        <div className="segment" style={{ marginBottom: 0 }}>
          <button className={f.kind === 'holiday' ? 'on' : ''} onClick={() => setF({ ...f, kind: 'holiday' })}>Paid holiday</button>
          <button className={f.kind === 'unpaid' ? 'on' : ''} onClick={() => setF({ ...f, kind: 'unpaid' })}>Unpaid</button>
        </div>
        <div className="grid2">
          <Field label="From"><input type="date" value={f.start_date} min={todayISO()} onChange={(e) => setF({ ...f, start_date: e.target.value, end_date: f.end_date < e.target.value ? e.target.value : f.end_date })} /></Field>
          <Field label="To (inclusive)"><input type="date" value={f.end_date} min={f.start_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field>
        </div>
        <Field label="Hours (leave blank to use your usual day length)"><input type="number" inputMode="decimal" min="0" step="0.5" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} placeholder={preview ? String(preview.hours) : ''} /></Field>
        <Field label="Note for the manager (optional)"><input value={f.note} maxLength={500} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        {preview && (
          <div className="small">
            This uses <b>{r1(preview.hours)}h</b>.{f.kind === 'holiday' && <> You have <b>{r1(preview.remaining)}h</b> left now, and <b>{r1(preview.remaining_after)}h</b> after this if approved.</>}
          </div>
        )}
        {preview?.warnings.map((w) => <div key={w} className="warn">{w}</div>)}
        {perr && <div className="err">{perr}</div>}
        <button className="btn block" disabled={busy || !!perr} onClick={send}>Send request</button>
      </div>
      <h2>My time off</h2>
      <Loader state={list}>{(rows) => rows.length === 0 ? <p className="muted">No requests yet.</p> : rows.map((r) => (
        <div key={r.id} className="card tight">
          <div className="row between"><b>{fmtRange(r.start_date, r.end_date)}</b><Status s={r.status} /></div>
          <div className="small muted">{r.kind === 'holiday' ? 'Paid holiday' : 'Unpaid'} · {r1(r.hours)}h{r.note ? ' · ' + r.note : ''}</div>
          {r.decision_reason && <div className="small">Manager: "{r.decision_reason}"</div>}
          <div className="row" style={{ marginTop: 6 }}>
            {r.status === 'pending' && <button className="btn ghost sm" onClick={() => act(r.id, 'withdraw')}>Withdraw</button>}
            {r.status === 'approved' && r.end_date >= todayISO() && <button className="btn ghost sm" onClick={() => act(r.id, 'cancel')}>Ask to cancel</button>}
          </div>
        </div>
      ))}</Loader>
    </>
  )
}

function Unavailable() {
  const list = useLoad(() => api.get(v('/my/unavailability')))
  const [mode, setMode] = useState('day')
  const [f, setF] = useState({ start_date: addDays(todayISO(), 1), end_date: addDays(todayISO(), 1), weekday: '', note: '' })
  const [busy, run] = useAction()
  const save = () => run(async () => {
    await api.post(v('/my/unavailability'), { start_date: f.start_date, end_date: mode === 'day' ? f.start_date : f.end_date, weekday: mode === 'repeat' && f.weekday ? Number(f.weekday) : null, note: f.note || null })
    list.reload()
  }, 'Saved. Managers will see it when building the rota.')
  const remove = (id) => run(async () => { await api.del(v(`/my/unavailability/${id}`)); list.reload() }, 'Removed.')
  return (
    <>
      <div className="card stack">
        <h3>Mark when you can't work</h3>
        <p className="tiny muted" style={{ margin: 0 }}>No approval needed. It shows on the manager's rota so they don't put you on. Use time off for paid holiday.</p>
        <div className="segment" style={{ marginBottom: 0 }}>
          {[['day', 'One day'], ['range', 'Several days'], ['repeat', 'Every week']].map(([k, l]) => <button key={k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{l}</button>)}
        </div>
        <div className={mode === 'day' ? '' : 'grid2'}>
          <Field label={mode === 'day' ? 'Date' : 'From'}><input type="date" min={todayISO()} value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value, end_date: f.end_date < e.target.value ? e.target.value : f.end_date })} /></Field>
          {mode !== 'day' && <Field label="Until"><input type="date" min={f.start_date} value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field>}
        </div>
        {mode === 'repeat' && <Field label="Which day each week"><select value={f.weekday} onChange={(e) => setF({ ...f, weekday: e.target.value })}><option value="">Choose…</option>{WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select></Field>}
        <Field label="Reason (optional, only managers see it)"><input value={f.note} maxLength={300} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <button className="btn block" disabled={busy || (mode === 'repeat' && !f.weekday)} onClick={save}>Save</button>
      </div>
      <h2>Coming up</h2>
      <Loader state={list}>{(rows) => rows.length === 0 ? <p className="muted">Nothing marked.</p> : rows.map((r) => (
        <div key={r.id} className="card tight row between">
          <div><b>{r.weekday ? `Every ${WEEKDAYS[r.weekday - 1]}` : fmtRange(r.start_date, r.end_date)}</b>{r.weekday && <div className="tiny muted">{fmtRange(r.start_date, r.end_date)}</div>}{r.note && <div className="small muted">{r.note}</div>}</div>
          <button className="btn ghost sm" onClick={() => remove(r.id)}>Remove</button>
        </div>
      ))}</Loader>
    </>
  )
}

function Swaps() {
  const { me, venue, refreshSummary } = useApp()
  const list = useLoad(() => api.get(v('/my/swaps')))
  const mine = useLoad(() => api.get(v('/my/shifts')))
  const [offer, setOffer] = useState({})
  const [busy, run] = useAction()
  const act = (id, what, body = {}) => run(async () => { await api.post(v(`/my/swaps/${id}/${what}`), body); list.reload(); refreshSummary() }, { accept: 'Accepted. It\'s now with a manager.', decline: 'Declined.', withdraw: 'Withdrawn.' }[what])
  return (
    <Loader state={list}>{(rows) => {
      const incoming = rows.filter((r) => r.to_membership_id === venue.membership_id)
      const outgoing = rows.filter((r) => r.from_membership_id === venue.membership_id)
      const myUpcoming = (mine.data?.shifts || []).filter((s) => s.shift_date >= mine.data.today)
      return (
        <>
          <h3>Asked of you</h3>
          {incoming.length === 0 && <p className="muted small">Nothing waiting.</p>}
          {incoming.map((r) => (
            <div key={r.id} className="card tight">
              <div className="row between"><b>{r.from_name} {r.kind === 'give' ? 'wants you to take' : 'wants to swap'}</b><Status s={r.status} /></div>
              <div className="small">{shiftText(r.from_shift)}</div>
              {r.offered_shift && <div className="small muted">In return: {shiftText(r.offered_shift)}</div>}
              {r.note && <div className="small muted">"{r.note}"</div>}
              {r.status === 'sent' && (
                <div className="stack" style={{ marginTop: 8 }}>
                  {r.kind === 'exchange' && (
                    <Field label="Which of your shifts will you give back?">
                      <select value={offer[r.id] || ''} onChange={(e) => setOffer({ ...offer, [r.id]: Number(e.target.value) })}>
                        <option value="">Choose…</option>
                        {myUpcoming.map((s) => <option key={s.id} value={s.id}>{shiftText(s)}</option>)}
                      </select>
                    </Field>
                  )}
                  <div className="row">
                    <button className="btn sm" disabled={busy || (r.kind === 'exchange' && !offer[r.id])} onClick={() => act(r.id, 'accept', { offered_shift_id: offer[r.id] || null })}>Accept</button>
                    <button className="btn secondary sm" disabled={busy} onClick={() => act(r.id, 'decline')}>Say no</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          <h3>Your requests</h3>
          {outgoing.length === 0 && <p className="muted small">To swap, open a shift on the Shifts page and tap Swap.</p>}
          {outgoing.map((r) => (
            <div key={r.id} className="card tight">
              <div className="row between"><b>{r.kind === 'give' ? 'Giving to' : 'Swapping with'} {r.to_name}</b><Status s={r.status} /></div>
              <div className="small">{shiftText(r.from_shift)}</div>
              {r.offered_shift && <div className="small muted">You'd get: {shiftText(r.offered_shift)}</div>}
              {r.decision_reason && <div className="small">Manager: "{r.decision_reason}"</div>}
              {['sent', 'awaiting_manager'].includes(r.status) && <button className="btn ghost sm" onClick={() => act(r.id, 'withdraw')}>Withdraw</button>}
            </div>
          ))}
        </>
      )
    }}</Loader>
  )
}

const TYPE = { cant_make_it: 'Can\'t make it', wrong_times: 'Times are wrong', wrong_role: 'Wrong role', other: 'Other' }
function Problems() {
  const list = useLoad(() => api.get(v('/my/problems')))
  const [reply, setReply] = useState({})
  const [busy, run] = useAction()
  const send = (id) => run(async () => { await api.post(v(`/problems/${id}/messages`), { body: reply[id] }); setReply({ ...reply, [id]: '' }); list.reload() }, 'Sent.')
  const withdraw = (id) => run(async () => { await api.post(v(`/my/problems/${id}/withdraw`)); list.reload() }, 'Withdrawn.')
  return (
    <Loader state={list}>{(rows) => rows.length === 0 ? <p className="muted">No problems raised. Use "Raise problem" on a shift if something's wrong with it.</p> : rows.map((p) => (
      <div key={p.id} className="card tight">
        <div className="row between"><b>{TYPE[p.type]}</b><Status s={p.status} /></div>
        <div className="small">{shiftText(p.shift_snapshot)}</div>
        <div className="small muted">"{p.note}"</div>
        {p.decision_reason && <div className="small">Manager: "{p.decision_reason}"</div>}
        {p.messages.length > 0 && <div className="thread">{p.messages.map((m, i) => <p key={i}><b>{m.mine ? 'You' : m.name}:</b> {m.body} <span className="tiny muted">{fmtDateTime(m.at)}</span></p>)}</div>}
        {p.status === 'open' && (
          <div className="row" style={{ marginTop: 8 }}>
            <input className="grow" style={{ flex: 1 }} placeholder="Add a message" value={reply[p.id] || ''} onChange={(e) => setReply({ ...reply, [p.id]: e.target.value })} />
            <button className="btn sm" disabled={busy || !reply[p.id]} onClick={() => send(p.id)}>Send</button>
            <button className="btn ghost sm" onClick={() => withdraw(p.id)}>Withdraw</button>
          </div>
        )}
      </div>
    ))}</Loader>
  )
}
