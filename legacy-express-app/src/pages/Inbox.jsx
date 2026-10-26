import { useState } from 'react'
import { api, v } from '../api.js'
import { useLoad, Loader, Field, Modal, useAction, useApp, Status, fmtDate, fmtRange, fmtDateTime, shiftText, r1 } from '../ui.jsx'

const KIND = { time_off: ['Time off', 'amber'], swap: ['Shift swap', 'blue'], problem: ['Shift problem', 'red'] }
const PTYPE = { cant_make_it: 'Can\'t make it', wrong_times: 'Times are wrong', wrong_role: 'Wrong role', other: 'Other' }

export default function Inbox() {
  const { refreshSummary, isManager } = useApp()
  const state = useLoad(() => api.get(v('/inbox')))
  const [history, setHistory] = useState(false)
  const [deciding, setDeciding] = useState(null) // { item, decision }
  const done = () => { setDeciding(null); state.reload(); refreshSummary() }
  return (
    <>
      <div className="segment">
        <button className={!history ? 'on' : ''} onClick={() => setHistory(false)}>Waiting {state.data ? `(${state.data.length})` : ''}</button>
        <button className={history ? 'on' : ''} onClick={() => setHistory(true)}>Recently decided</button>
      </div>
      {history ? <History /> : (
        <Loader state={state}>{(items) => items.length === 0 ? <div className="card muted">All clear. Nothing waiting for approval.</div> : items.map((it) => (
          <Item key={it.kind + it.id} it={it} onDecide={(decision) => setDeciding({ item: it, decision })} reload={state.reload} />
        ))}</Loader>
      )}
      {!isManager && <p className="tiny muted">As a supervisor you can answer swaps and problems. Time off goes to managers.</p>}
      {deciding && <Decide {...deciding} onClose={() => setDeciding(null)} onDone={done} />}
    </>
  )
}

function Item({ it, onDecide, reload }) {
  const [kl, kc] = KIND[it.kind]
  const d = it.detail
  const [reply, setReply] = useState('')
  const [busy, run] = useAction()
  const send = () => run(async () => { await api.post(v(`/problems/${it.id}/messages`), { body: reply }); setReply(''); reload() }, 'Sent.')
  return (
    <div className="card">
      <div className="row between"><span className={`pill ${kc}`}>{kl}</span><span className="tiny muted">{fmtDateTime(it.created_at)}</span></div>
      <h3 style={{ marginTop: 8 }}>{it.raised_by_name}</h3>
      {it.kind === 'time_off' && (
        <>
          <div><b>{fmtRange(d.start_date, d.end_date)}</b> · {r1(d.hours)}h {d.kind === 'unpaid' ? 'unpaid' : 'holiday'} {d.status === 'cancel_pending' && <span className="pill amber">Wants to cancel approved leave</span>}</div>
          {d.note && <div className="small muted">"{d.note}"</div>}
          {it.clashes.others_off.length > 0 && <div className="warn" style={{ marginTop: 6 }}>Also off then: {it.clashes.others_off.map((o) => `${o.name} (${fmtRange(o.start_date, o.end_date)})`).join(', ')}</div>}
          {it.clashes.own_shifts.length > 0 && <div className="warn" style={{ marginTop: 6 }}>Already rostered: {it.clashes.own_shifts.map((s) => shiftText(s)).join(', ')}. These need cover if you approve.</div>}
        </>
      )}
      {it.kind === 'swap' && (
        <>
          <div>{d.kind === 'give' ? `Giving to ${d.to_full_name}` : `Swapping with ${d.to_full_name}`} (they've accepted)</div>
          <div className="small"><b>{shiftText(d.from_shift)}</b></div>
          {d.offered_shift && <div className="small">In return: <b>{shiftText(d.offered_shift)}</b></div>}
          {d.note && <div className="small muted">"{d.note}"</div>}
        </>
      )}
      {it.kind === 'problem' && (
        <>
          <div><b>{PTYPE[d.type]}</b> on {shiftText(d.shift_snapshot)}</div>
          <div className="small">"{d.note}"</div>
          {!d.shift_id && <div className="warn">That shift has since been deleted.</div>}
          {d.messages.length > 0 && <div className="thread">{d.messages.map((m, i) => <p key={i}><b>{m.name}:</b> {m.body} <span className="tiny muted">{fmtDateTime(m.at)}</span></p>)}</div>}
          <div className="row" style={{ marginTop: 8 }}>
            <input style={{ flex: 1 }} placeholder="Ask a question first (optional)" value={reply} onChange={(e) => setReply(e.target.value)} />
            <button className="btn secondary sm" disabled={busy || !reply} onClick={send}>Send</button>
          </div>
        </>
      )}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn grow" onClick={() => onDecide('approve')}>Approve</button>
        <button className="btn secondary grow" onClick={() => onDecide('decline')}>Decline</button>
      </div>
    </div>
  )
}

function Decide({ item, decision, onClose, onDone }) {
  const { isManager } = useApp()
  const [reason, setReason] = useState('')
  const [resolution, setResolution] = useState('none')
  const snap = item.detail?.shift_snapshot
  const [times, setTimes] = useState({ start_time: snap?.start_time || '', end_time: snap?.end_time || '' })
  const [busy, run] = useAction()
  const submit = () => run(async () => {
    const body = { decision, reason: reason || null }
    if (item.kind === 'problem' && decision === 'approve') Object.assign(body, { resolution, ...(resolution === 'edit' ? times : {}) })
    await api.post(v(`/inbox/${item.kind}/${item.id}`), body)
    onDone()
  }, decision === 'approve' ? 'Approved. They\'ve been notified.' : 'Declined. They\'ve been told why.')
  return (
    <Modal title={decision === 'approve' ? 'Approve' : 'Decline'} onClose={onClose}>
      <div className="stack">
        {item.kind === 'swap' && decision === 'approve' && <p className="small">The rota updates straight away and both people are notified.</p>}
        {item.kind === 'problem' && decision === 'approve' && (
          <Field label="What happens to the shift?">
            <select value={resolution} onChange={(e) => setResolution(e.target.value)}>
              <option value="none">Nothing changes on the rota (just acknowledge)</option>
              {isManager && <option value="drop">Take them off it (it becomes an open shift)</option>}
              {isManager && <option value="edit">Change the times</option>}
            </select>
          </Field>
        )}
        {resolution === 'edit' && decision === 'approve' && (
          <div className="grid2">
            <Field label="New start"><input type="time" value={times.start_time} onChange={(e) => setTimes({ ...times, start_time: e.target.value })} /></Field>
            <Field label="New end"><input type="time" value={times.end_time} onChange={(e) => setTimes({ ...times, end_time: e.target.value })} /></Field>
          </div>
        )}
        <Field label={decision === 'decline' ? 'Reason (required, they see this)' : 'Note to them (optional)'}><textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></Field>
        <button className={`btn block ${decision === 'decline' ? 'danger' : ''}`} disabled={busy || (decision === 'decline' && reason.trim().length < 2)} onClick={submit}>{decision === 'approve' ? 'Approve' : 'Decline'}</button>
      </div>
    </Modal>
  )
}

function History() {
  const state = useLoad(() => api.get(v('/inbox/history')))
  return <Loader state={state}>{(rows) => rows.length === 0 ? <p className="muted">Nothing decided yet.</p> : (
    <div className="card tight"><ul className="list">{rows.map((r) => (
      <li key={r.kind + r.id}><div className="row between"><b>{r.name}</b><Status s={r.status} /></div><div className="small muted">{KIND[r.kind][0]} · {r.kind === 'time_off' ? r.summary.split(' to ').map((x) => fmtDate(x)).join(' to ') : r.summary} · {fmtDateTime(r.decided_at)}</div>{r.decision_reason && <div className="small">"{r.decision_reason}"</div>}</li>
    ))}</ul></div>
  )}</Loader>
}
