import React, { useState } from 'react';
import { collection, query, where, orderBy, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, niceError } from '../firebase.js';
import { useSession } from '../App.jsx';
import { useLive, Sheet, Field, Loading, ErrorBox, useToast } from '../ui.jsx';
import { ymd, mondayOf, addDays, pretty, prettyLong, fmtHours, byName, paidHours, overnight } from '../util.js';

function label(x) {
  return `${pretty(x.date)} ${x.start}-${x.end}${x.area ? ` (${x.area})` : ''}`;
}

// What a team member sees instead of the full rota: only their own published shifts.
export default function MyShifts() {
  const s = useSession();
  const today = ymd();
  const from = addDays(mondayOf(today), -7);
  const mine = useLive(() => query(collection(db, 'shifts'), where('staffId', '==', s.user.uid), where('published', '==', true), where('date', '>=', from), orderBy('date')), [s.user.uid, from]);
  const reqs = useLive(() => query(collection(db, 'requests'), where('staffId', '==', s.user.uid)), [s.user.uid]);
  const [act, setAct] = useState(null);

  const pendingFor = (id) => (reqs.docs || []).find((r) => r.shiftId === id && r.status === 'pending');
  const list = mine.docs || [];
  const upcoming = list.filter((x) => x.date >= today);
  const past = list.filter((x) => x.date < today).reverse();
  const weeks = {};
  upcoming.forEach((x) => { (weeks[mondayOf(x.date)] = weeks[mondayOf(x.date)] || []).push(x); });

  return (
    <div>
      <ErrorBox error={mine.error} />
      {!mine.docs ? <Loading /> : (
        <>
          {upcoming.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>No upcoming shifts on the published rota yet.</p></div>}
          {Object.entries(weeks).map(([w, l]) => (
            <div className="card" key={w}>
              <div className="row between">
                <h3 style={{ margin: 0 }}>Week of {pretty(w, { day: 'numeric', month: 'long' })}</h3>
                <span className="pill">{fmtHours(l.reduce((t, x) => t + paidHours(x), 0))}</span>
              </div>
              <ul className="list">
                {l.map((x) => {
                  const p = pendingFor(x.id);
                  return (
                    <li key={x.id} data-testid="my-shift">
                      <div className="row between wrap">
                        <div className="grow">
                          <strong>{x.date === today ? 'Today' : prettyLong(x.date)}</strong>
                          <div>{x.start}–{x.end}{overnight(x) ? ' (finishes next day)' : ''}{x.area ? ` · ${x.area}` : ''}{x.eventTitle ? ` · ${x.eventTitle}` : ''}</div>
                          {x.breakStart && <div className="small muted">Break {x.breakStart}–{x.breakEnd} ({x.breakPaid === false ? 'unpaid' : 'paid'})</div>}
                          {x.notes && <div className="small muted">{x.notes}</div>}
                          {p && <div className="tiny" style={{ color: 'var(--amber)' }}>{p.kind === 'swap' ? 'Swap requested' : 'Problem reported'}, waiting for a manager</div>}
                        </div>
                        {!p && (
                          <div className="actions">
                            <button className="btn secondary sm" onClick={() => setAct({ kind: 'swap', shift: x })}>Swap</button>
                            <button className="btn ghost sm" onClick={() => setAct({ kind: 'problem', shift: x })}>Problem</button>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {past.length > 0 && (
            <details className="card">
              <summary>Recent shifts</summary>
              <ul className="list">
                {past.map((x) => <li key={x.id} className="small">{prettyLong(x.date)} · {x.start}–{x.end} · {fmtHours(paidHours(x))}</li>)}
              </ul>
            </details>
          )}
        </>
      )}
      {act && <RequestSheet act={act} onClose={() => setAct(null)} />}
    </div>
  );
}

function RequestSheet({ act, onClose }) {
  const s = useSession();
  const toast = useToast();
  const staff = useLive(() => (act.kind === 'swap' ? query(collection(db, 'staff'), orderBy('name')) : null), [act.kind]);
  const [to, setTo] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const others = (staff.docs || []).filter((p) => p.id !== s.user.uid && p.active !== false && !p.terminated).sort(byName);
  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (act.kind === 'problem' && !msg.trim()) { setErr('Say what the problem is.'); return; }
    const target = others.find((p) => p.id === to);
    setBusy(true);
    try {
      await addDoc(collection(db, 'requests'), {
        kind: act.kind, staffId: s.user.uid, staffName: s.name, shiftId: act.shift.id, shiftLabel: label(act.shift),
        shiftDate: act.shift.date, toStaffId: target ? target.id : '', toStaffName: target ? target.name : '',
        message: msg.trim(), status: 'pending', createdAt: serverTimestamp(),
      });
      toast(act.kind === 'swap' ? 'Swap request sent to the managers.' : 'Sent to the managers.');
      onClose();
    } catch (e2) {
      setErr(niceError(e2));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet title={act.kind === 'swap' ? 'Swap or give away shift' : 'Report a problem'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="small"><strong>{label(act.shift)}</strong></div>
        {act.kind === 'swap' && (
          <Field label="Give it to">
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Anyone (make it an open shift)</option>
              {others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        )}
        <Field label={act.kind === 'swap' ? 'Message (optional)' : 'What’s wrong?'}>
          <textarea rows={3} maxLength={500} value={msg} onChange={(e) => setMsg(e.target.value)} />
        </Field>
        {act.kind === 'swap' && <div className="tiny muted">A manager has to approve it. You stay on the shift until they do.</div>}
        {err && <div className="err">{err}</div>}
        <button className="btn block" disabled={busy}>{busy ? 'Sending…' : 'Send to managers'}</button>
      </form>
    </Sheet>
  );
}
