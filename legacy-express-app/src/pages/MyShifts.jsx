import { useState } from 'react'
import { api, v } from '../api.js'
import { useLoad, Loader, Modal, Field, useAction, useApp, fmtDate, shiftText, r1 } from '../ui.jsx'
import { Link } from '../App.jsx'

export default function MyShifts() {
  const { refreshSummary } = useApp()
  const state = useLoad(() => api.get(v('/my/shifts')))
  const news = useLoad(() => api.get(v('/announcements')))
  const [showPast, setShowPast] = useState(false)
  const [swapFor, setSwapFor] = useState(null)
  const [problemFor, setProblemFor] = useState(null)
  const done = () => { setSwapFor(null); setProblemFor(null); state.reload(); refreshSummary() }

  const unreadPinned = (news.data || []).filter((a) => a.pinned && !a.read)
  return (
    <>
      {unreadPinned.map((a) => <div key={a.id} className="card tight" style={{ borderLeft: '4px solid var(--gold)' }}><b>{a.title}</b><div className="small">{a.body}</div><Link to="/news" className="small">All announcements</Link></div>)}
      <Loader state={state}>{({ today, shifts }) => {
        const upcoming = shifts.filter((s) => s.shift_date >= today)
        const past = shifts.filter((s) => s.shift_date < today).reverse()
        const weekHours = upcoming.filter((s) => s.shift_date < addDaysLocal(today, 7)).reduce((a, s) => a + Number(s.hours), 0)
        return (
          <>
            <div className="row between" style={{ marginBottom: 6 }}>
              <div className="small muted">{upcoming.length} upcoming shift{upcoming.length === 1 ? '' : 's'} · {r1(weekHours)}h in the next 7 days</div>
              <button className="btn ghost sm" onClick={() => setShowPast(!showPast)}>{showPast ? 'Hide past' : 'Show past'}</button>
            </div>
            {upcoming.length === 0 && <div className="card muted">No upcoming shifts on a published rota yet.</div>}
            {groupByDay(upcoming).map(([day, list]) => (
              <div key={day}>
                <div className="dayhead">{day === today ? 'Today' : fmtDate(day, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
                {list.map((s) => <ShiftCard key={s.id} s={s} onSwap={() => setSwapFor(s)} onProblem={() => setProblemFor(s)} />)}
              </div>
            ))}
            {showPast && <><h2>Past shifts</h2>{past.map((s) => <ShiftCard key={s.id} s={s} past />)}</>}
            {swapFor && <SwapModal shift={swapFor} onClose={() => setSwapFor(null)} onDone={done} />}
            {problemFor && <ProblemModal shift={problemFor} onClose={() => setProblemFor(null)} onDone={done} />}
          </>
        )
      }}</Loader>
      <p className="tiny muted">You see your own shifts, and who else is working at the same time as you.</p>
    </>
  )
}

const addDaysLocal = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
function groupByDay(list) { const m = new Map(); for (const s of list) { if (!m.has(s.shift_date)) m.set(s.shift_date, []); m.get(s.shift_date).push(s) } return [...m.entries()] }

function ShiftCard({ s, past, onSwap, onProblem }) {
  return (
    <div className={`card shift ${past ? 'past' : ''}`}>
      <div className="row between">
        <div className="when">{s.start_time}–{s.end_time}{past && <span className="muted" style={{ fontWeight: 400 }}> · {fmtDate(s.shift_date)}</span>}</div>
        <div className="row" style={{ gap: 6 }}>
          {s.position && <span className="pill dark">{s.position}</span>}
          <span className="pill">{r1(s.hours)}h</span>
        </div>
      </div>
      {s.break_minutes > 0 && <div className="tiny muted">{s.break_minutes} min break</div>}
      {s.notes && <div className="small" style={{ marginTop: 4 }}>{s.notes}</div>}
      {s.edited_after_publish && <div className="tiny" style={{ color: 'var(--amber)', fontWeight: 600 }}>Changed since the rota went out</div>}
      <div className="small" style={{ marginTop: 8 }}>
        <span className="muted">On with you: </span>
        {s.on_with_me.length ? s.on_with_me.map((p) => `${p.name}${p.position ? ' (' + p.position + ')' : ''}`).join(', ') : 'nobody else'}
      </div>
      {!past && (
        <div className="row" style={{ marginTop: 10, gap: 8 }}>
          {s.open_swap ? <span className="pill blue">Swap {s.open_swap.status === 'sent' ? 'sent' : 'with manager'}</span> : <button className="btn secondary sm" onClick={onSwap}>Swap</button>}
          {s.open_problem ? <span className="pill amber">Problem raised</span> : <button className="btn secondary sm" onClick={onProblem}>Raise problem</button>}
        </div>
      )}
    </div>
  )
}

function SwapModal({ shift, onClose, onDone }) {
  const [kind, setKind] = useState('give')
  const [to, setTo] = useState(null)
  const [note, setNote] = useState('')
  const colleagues = useLoad(() => api.get(v(`/my/swaps/colleagues?shift_id=${shift.id}`)), [shift.id])
  const [busy, run] = useAction()
  const send = () => run(async () => { await api.post(v('/my/swaps'), { shift_id: shift.id, to_membership_id: to, kind, note: note || null }); onDone() }, 'Swap request sent.')
  return (
    <Modal title="Swap this shift" onClose={onClose}>
      <p className="small"><b>{shiftText(shift)}</b></p>
      <div className="segment">
        <button className={kind === 'give' ? 'on' : ''} onClick={() => setKind('give')}>Give it away</button>
        <button className={kind === 'exchange' ? 'on' : ''} onClick={() => setKind('exchange')}>Swap for one of theirs</button>
      </div>
      <p className="tiny muted">They have to accept, then a manager approves it. Until then it's still your shift.</p>
      <Loader state={colleagues}>{(list) => (
        <ul className="list">
          {list.map((c) => (
            <li key={c.id}>
              <label className="check" style={{ opacity: kind === 'give' && !c.free ? .5 : 1 }}>
                <input type="radio" name="to" disabled={kind === 'give' && !c.free} checked={to === c.id} onChange={() => setTo(c.id)} />
                <span className="grow">{c.name}</span>
                {c.free ? <span className="pill green">Free</span> : <span className="pill">Not free</span>}
              </label>
            </li>
          ))}
        </ul>
      )}</Loader>
      <Field label="Message (optional)"><input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. I've got a dentist appointment" /></Field>
      <button className="btn block" style={{ marginTop: 12 }} disabled={!to || busy} onClick={send}>Send request</button>
    </Modal>
  )
}

const PROBLEM_TYPES = [['cant_make_it', 'I can\'t make it'], ['wrong_times', 'The times are wrong'], ['wrong_role', 'Wrong role or section'], ['other', 'Something else']]
function ProblemModal({ shift, onClose, onDone }) {
  const [type, setType] = useState('cant_make_it')
  const [note, setNote] = useState('')
  const [busy, run] = useAction()
  const send = () => run(async () => { await api.post(v('/my/problems'), { shift_id: shift.id, type, note }); onDone() }, 'Sent to the managers.')
  return (
    <Modal title="Raise a problem" onClose={onClose}>
      <p className="small"><b>{shiftText(shift)}</b></p>
      <div className="stack">
        <Field label="What's wrong?"><select value={type} onChange={(e) => setType(e.target.value)}>{PROBLEM_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Tell the managers more"><textarea value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="e.g. My last bus is at 23:15, can I finish at 23:00?" /></Field>
        <p className="tiny muted">The managers get this with the exact shift attached, and approve or decline it like a swap. You'll get a notification either way.</p>
        <button className="btn block" disabled={note.trim().length < 3 || busy} onClick={send}>Send to managers</button>
      </div>
    </Modal>
  )
}
