import React, { useState } from 'react';
import { collection, query, where, orderBy, doc, addDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db, call, niceError } from '../firebase.js';
import { useSession } from '../App.jsx';
import { useLive, Field, Loading, ErrorBox, useToast, Tabs, TabPanel } from '../ui.jsx';
import { ymd, pretty, ago, tsDate, byName, DAYS } from '../util.js';

const WEEKDAYS = ['Every day', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
function range(t) {
  return t.from === t.to ? pretty(t.from) : `${pretty(t.from)} – ${pretty(t.to)}`;
}
function when(ts) {
  const d = tsDate(ts);
  return d ? ago(ts) : '';
}
function newest(a, b) {
  return ((tsDate(b.decidedAt || b.createdAt) || 0) - (tsDate(a.decidedAt || a.createdAt) || 0));
}
function kindLabel(x) {
  if (x.type === 'holiday') return x.paid === false ? 'Holiday, unpaid' : 'Holiday, paid';
  if (x.type === 'swap') return 'Shift swap';
  return 'Problem with a shift';
}
function headline(x) {
  if (x.type === 'holiday') return range(x);
  if (x.type === 'swap') return `${x.shiftLabel} → ${x.toStaffName || 'open shift'}`;
  return x.shiftLabel;
}
function detail(x) {
  return x.type === 'holiday' ? x.reason : x.message;
}
function statusWord(x) {
  return { approved: 'Approved', declined: 'Declined', resolved: 'Sorted', pending: 'Waiting', cancelled: 'Cancelled' }[x.status] || x.status;
}
function statusTone(x) {
  if (x.status === 'approved' || x.status === 'resolved') return 'green';
  if (x.status === 'declined') return 'red';
  if (x.status === 'pending') return 'amber';
  return '';
}

const ICONS = {
  holiday: <><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  unav: <><circle cx="12" cy="12" r="8.5" /><path d="M6 6l12 12" /></>,
  swap: <path d="M7 7h12l-3.5-3.5M17 17H5l3.5 3.5" />,
  problem: <><path d="M12 3.5l9 16H3z" /><path d="M12 10v4.5M12 17.2v.3" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
};
function Icon({ name, size = 22 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{ICONS[name]}</svg>
  );
}
function Kind({ x }) {
  return <span className={`kind k-${x.type}`}><Icon name={x.type} size={18} />{kindLabel(x)}</span>;
}
function SectionHead({ title, count, id }) {
  return (
    <div className="sec-head">
      <h2 id={id}>{title}</h2>
      {count !== undefined && <span className={`count ${count ? '' : 'zero'}`} aria-label={`${count} ${count === 1 ? 'item' : 'items'}`}>{count}</span>}
    </div>
  );
}

// Requests: holiday (paid / unpaid), unavailability, shift swaps and problem reports.
// Managers get tabs (to decide / decided / their own); who's unavailable sits beside them on desktop.
export default function Inbox() {
  const s = useSession();
  const [open, setOpen] = useState('');
  const toggle = (k) => setOpen(open === k ? '' : k);
  return (
    <div className="inbox">
      <div className="inbox-actions" role="group" aria-label="Ask for something">
        <button type="button" className="actcard" aria-expanded={open === 'holiday'} aria-controls="ask-holiday" onClick={() => toggle('holiday')}>
          <span className="ic"><Icon name="holiday" /></span>
          <span><strong>Ask for holiday</strong></span>
        </button>
        <button type="button" className="actcard" aria-expanded={open === 'unav'} aria-controls="mark-unav" onClick={() => toggle('unav')}>
          <span className="ic"><Icon name="unav" /></span>
          <span><strong>{s.isManager ? 'Mark someone unavailable' : 'Mark yourself unavailable'}</strong></span>
        </button>
      </div>
      {open === 'holiday' && <HolidayForm onClose={() => setOpen('')} />}
      {open === 'unav' && <UnavForm onClose={() => setOpen('')} />}
      <div className="inbox-grid">
        <div className="inbox-main">
          {s.isManager ? <ManagerTabs /> : <MyRequests />}
        </div>
        <aside className="inbox-side" aria-label="Unavailability">
          <UnavList />
        </aside>
      </div>
    </div>
  );
}

// Managers: one focused list at a time instead of every section stacked down the page.
function ManagerTabs() {
  const [tab, setTab] = useState('decide');
  const all = useAllRequests();
  const waiting = all.docs ? all.docs.filter((x) => x.status === 'pending').length : undefined;
  const items = [
    { key: 'decide', label: 'To decide', count: waiting },
    { key: 'decided', label: 'Decided' },
    { key: 'mine', label: 'Your requests' },
  ];
  return (
    <>
      <Tabs items={items} value={tab} onChange={setTab} label="Requests" idBase="inbox" />
      <TabPanel idBase="inbox" value={tab}>
        {tab === 'decide' && <Queue />}
        {tab === 'decided' && <Decided />}
        {tab === 'mine' && <MyRequests always />}
      </TabPanel>
    </>
  );
}

function useAllRequests() {
  const t = useLive(() => query(collection(db, 'timeOff'), orderBy('from', 'desc')), []);
  const r = useLive(() => query(collection(db, 'requests'), orderBy('createdAt', 'desc')), []);
  const docs = t.docs && r.docs
    ? [...t.docs.map((x) => ({ ...x, kind: 'timeOff', type: 'holiday' })), ...r.docs.map((x) => ({ ...x, type: x.kind, kind: 'request' }))]
    : null;
  return { docs, error: t.error || r.error };
}

function Queue() {
  const all = useAllRequests();
  const pending = (all.docs || []).filter((x) => x.status === 'pending').sort((a, b) => -newest(a, b));
  return (
    <section className="inbox-sec" aria-labelledby="sec-decide">
      <SectionHead id="sec-decide" title="Waiting for your decision" count={all.docs ? pending.length : undefined} />
      <ErrorBox error={all.error} />
      {!all.docs ? <Loading /> : pending.length === 0 ? (
        <div className="allclear"><span className="ic"><Icon name="check" /></span><span>All caught up. Nothing is waiting for a decision.</span></div>
      ) : (
        <ul className="reqs">{pending.map((x) => <Pending key={x.kind + x.id} x={x} />)}</ul>
      )}
    </section>
  );
}

function Pending({ x }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  // Holiday is decided exactly as the staff member asked for it: managers approve or decline, they never
  // switch paid <-> unpaid (Andy, 20 Oct). No paid/unpaid control here; decideRequest also refuses a change.
  const asked = x.paid === false ? 'unpaid' : 'paid';
  async function decide(status) {
    setBusy(true);
    try {
      const r = await call('decideRequest', { kind: x.kind, id: x.id, status, note: note.trim() });
      toast(`Marked ${status} (by ${r.decidedByName}).`);
    } catch (e) {
      toast(niceError(e), 'warn');
      setBusy(false);
    }
  }
  const noteId = `note-${x.kind}-${x.id}`;
  return (
    <li className={`req k-${x.type} ${x.type === 'holiday' && x.paid === false ? 'unpaid' : ''}`} data-testid="pending">
      <div className="req-top"><Kind x={x} /><span className="req-when">{when(x.createdAt)}</span></div>
      <div className="req-who">{x.staffName}</div>
      <div className="req-what">{headline(x)}</div>
      {detail(x) && <p className="req-note">“{detail(x)}”</p>}
      <div className="req-decide">
        {x.type === 'holiday' && (
          <p className="req-line" data-testid="holiday-type">
            <span className={`pill ${asked === 'unpaid' ? 'amber' : 'green'}`}>Asked for {asked}</span>
          </p>
        )}
        <label className="sr" htmlFor={noteId}>Note for {x.staffName} (optional)</label>
        <input id={noteId} placeholder="Add a note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        <div className="actions">
          {x.type === 'problem' ? (
            <button className="btn sm" disabled={busy} onClick={() => decide('resolved')}>Mark sorted</button>
          ) : (
            <>
              <button className="btn sm" disabled={busy} onClick={() => decide('approved')}>Approve</button>
              <button className="btn secondary sm" disabled={busy} onClick={() => decide('declined')}>Decline</button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function Decided() {
  const all = useAllRequests();
  const [more, setMore] = useState(false);
  const done = (all.docs || []).filter((x) => ['approved', 'declined', 'resolved'].includes(x.status)).sort(newest).slice(0, 60);
  const shown = more ? done : done.slice(0, 6);
  return (
    <section className="inbox-sec" aria-labelledby="sec-decided">
      <SectionHead id="sec-decided" title="Recently decided" />
      <ErrorBox error={all.error} />
      {!all.docs ? <Loading /> : done.length === 0 ? <p className="muted">Nothing decided yet.</p> : (
        <>
          <ul className="reqs compact">
            {shown.map((x) => (
              <li key={x.kind + x.id} className={`req compact k-${x.type}`} data-testid="decided">
                <div className="req-top"><Kind x={x} /><span className={`pill ${statusTone(x)}`}>{statusWord(x)}</span></div>
                <div className="req-line"><strong>{x.staffName}</strong> · {headline(x)}</div>
                <div className="req-meta">
                  {statusWord(x)} by {x.decidedByName || 'a manager'}{x.decidedAt ? ` · ${when(x.decidedAt)}` : ''}
                  {x.managerNote ? ` · “${x.managerNote}”` : ''}
                </div>
              </li>
            ))}
          </ul>
          {done.length > 6 && (
            <button type="button" className="btn ghost sm" aria-expanded={more} onClick={() => setMore(!more)}>
              {more ? 'Show fewer' : `Show all ${done.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function FormCard({ id, title, onClose, onSubmit, children }) {
  return (
    <form id={id} className="card stack formcard" onSubmit={onSubmit} aria-labelledby={`${id}-h`}>
      <div className="row between">
        <h2 id={`${id}-h`}>{title}</h2>
        <button type="button" className="btn ghost sm" onClick={onClose}>Close</button>
      </div>
      {children}
    </form>
  );
}

function HolidayForm({ onClose }) {
  const s = useSession();
  const toast = useToast();
  const [f, setF] = useState({ from: ymd(), to: ymd(), reason: '', paid: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (f.to < f.from) { setErr('The end date is before the start date.'); return; }
    setBusy(true);
    try {
      await addDoc(collection(db, 'timeOff'), {
        staffId: s.user.uid, staffName: s.name, from: f.from, to: f.to, reason: f.reason.trim().slice(0, 300),
        paid: f.paid, status: 'pending', createdAt: serverTimestamp(),
      });
      toast('Holiday request sent to the managers.');
      setF({ from: ymd(), to: ymd(), reason: '', paid: true });
      onClose();
    } catch (e2) {
      setErr(niceError(e2));
    } finally {
      setBusy(false);
    }
  }
  return (
    <FormCard id="ask-holiday" title="Ask for holiday" onClose={onClose} onSubmit={submit}>
      <div className="grid2">
        <Field label="From"><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, to: f.to < e.target.value ? e.target.value : f.to })} /></Field>
        <Field label="To"><input type="date" value={f.to} min={f.from} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
      </div>
      <div className="segment sm" role="group" aria-label="Paid or unpaid">
        <button type="button" aria-pressed={f.paid} className={f.paid ? 'on' : ''} onClick={() => setF({ ...f, paid: true })}>Paid holiday</button>
        <button type="button" aria-pressed={!f.paid} className={!f.paid ? 'on' : ''} onClick={() => setF({ ...f, paid: false })}>Unpaid</button>
      </div>
      <Field label="Reason (optional)"><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={300} /></Field>
      {err && <div className="err">{err}</div>}
      <button className="btn" disabled={busy}>Send request</button>
    </FormCard>
  );
}

function MyRequests({ always }) {
  const s = useSession();
  const toast = useToast();
  const t = useLive(() => query(collection(db, 'timeOff'), where('staffId', '==', s.user.uid)), [s.user.uid]);
  const r = useLive(() => query(collection(db, 'requests'), where('staffId', '==', s.user.uid)), [s.user.uid]);
  const docs = t.docs && r.docs
    ? [...t.docs.map((x) => ({ ...x, kind: 'timeOff', type: 'holiday' })), ...r.docs.map((x) => ({ ...x, type: x.kind, kind: 'request' }))].sort(newest)
    : null;
  async function cancel(x) {
    if (!window.confirm('Cancel this request?')) return;
    try {
      await updateDoc(doc(db, x.kind === 'timeOff' ? 'timeOff' : 'requests', x.id), { status: 'cancelled' });
      toast('Request cancelled.');
    } catch (e) {
      toast(niceError(e), 'warn');
    }
  }
  // Managers mostly decide; their own section only shows once they've asked for something.
  if (!always && s.isManager && docs && docs.length === 0 && !(t.error || r.error)) return null;
  return (
    <section className="inbox-sec" aria-labelledby="sec-mine">
      <SectionHead id="sec-mine" title={s.isManager ? 'Your own requests' : 'Your requests'} />
      <ErrorBox error={t.error || r.error} />
      {!docs ? <Loading /> : docs.length === 0 ? <p className="muted">No requests yet. Use Ask for holiday above.</p> : (
        <ul className="reqs compact">
          {docs.map((x) => (
            <li key={x.kind + x.id} className={`req compact k-${x.type} ${x.status === 'pending' ? 'waiting' : ''}`}>
              <div className="req-top"><Kind x={x} /><span className={`pill ${statusTone(x)}`}>{statusWord(x)}</span></div>
              <div className="req-line">{headline(x)}</div>
              {x.decidedByName && <div className="req-meta">{statusWord(x)} by {x.decidedByName}{x.managerNote ? ` · “${x.managerNote}”` : ''}</div>}
              {x.status === 'pending' && (
                <div className="req-foot"><span className="req-meta">Sent {when(x.createdAt)}</span><button className="btn ghost sm" onClick={() => cancel(x)}>Cancel request</button></div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function UnavForm({ onClose }) {
  const s = useSession();
  const toast = useToast();
  const today = ymd();
  const staff = useLive(() => (s.isManager ? query(collection(db, 'staff'), orderBy('name')) : null), [s.isManager]);
  const people = (staff.docs || []).filter((p) => p.active !== false && !p.terminated).sort(byName);
  const [f, setF] = useState({ staffId: s.user.uid, from: today, to: today, weekday: 0, reason: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (f.to < f.from) { setErr('The end date is before the start date.'); return; }
    if (!f.reason.trim()) { setErr('Add a reason. Managers see it on the rota.'); return; }
    const who = f.staffId === s.user.uid ? s.name : (people.find((p) => p.id === f.staffId) || {}).name;
    setBusy(true);
    try {
      // saved by the server together with the rota block, so from now on nobody can be put on those days
      const r = await call('addUnavailability', {
        staffId: f.staffId, staffName: who || '', from: f.from, to: f.to, weekday: Number(f.weekday),
        reason: f.reason.trim().slice(0, 200),
      });
      toast(r && r.clashes
        ? `Saved. ${who || 'They'} already ${r.clashes === 1 ? 'has 1 shift' : `has ${r.clashes} shifts`} on those days. They’re marked in red on the rota and haven’t been changed.`
        : 'Saved. It shows greyed out on the rota, and nobody can put them on those days.');
      setF({ ...f, reason: '' });
      onClose();
    } catch (e2) {
      setErr(niceError(e2));
    } finally {
      setBusy(false);
    }
  }
  return (
    <FormCard id="mark-unav" title="Mark unavailable" onClose={onClose} onSubmit={submit}>
      {s.isManager && (
        <Field label="Who">
          <select value={f.staffId} onChange={(e) => setF({ ...f, staffId: e.target.value })}>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      )}
      <div className="grid2">
        <Field label="From"><input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value, to: f.to < e.target.value ? e.target.value : f.to })} /></Field>
        <Field label="To"><input type="date" value={f.to} min={f.from} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
      </div>
      <Field label="Days">
        <select value={f.weekday} onChange={(e) => setF({ ...f, weekday: e.target.value })}>
          {WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}
        </select>
      </Field>
      <Field label="Reason"><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} maxLength={200} /></Field>
      {err && <div className="err">{err}</div>}
      <button className="btn" disabled={busy}>Save</button>
    </FormCard>
  );
}

function UnavList() {
  const s = useSession();
  const toast = useToast();
  const today = ymd();
  const list = useLive(() => (s.isManager
    ? query(collection(db, 'unavailability'), where('to', '>=', today))
    : query(collection(db, 'unavailability'), where('staffId', '==', s.user.uid))), [s.isManager, s.user.uid, today]);
  async function remove(u) {
    if (!window.confirm('Remove this?')) return;
    try {
      await deleteDoc(doc(db, 'unavailability', u.id));
    } catch (e2) {
      toast(niceError(e2), 'warn');
    }
  }
  const rows = (list.docs || []).filter((u) => u.to >= today).sort((a, b) => a.from.localeCompare(b.from));
  return (
    <section className="card unav-card" aria-labelledby="sec-unav">
      <SectionHead id="sec-unav" title={s.isManager ? 'Unavailable, coming up' : 'When you’re unavailable'} count={list.docs ? rows.length : undefined} />
      <ErrorBox error={list.error} />
      {!list.docs ? <Loading /> : rows.length === 0 ? <p className="muted">{s.isManager ? 'Nobody is marked unavailable.' : 'You haven\u2019t marked any days.'}</p> : (
        <ul className="unav-list">
          {rows.map((u) => (
            <li key={u.id}>
              <div className="grow">
                {s.isManager && <div className="unav-who">{u.staffName}</div>}
                <div className="unav-when">{range(u)}{u.weekday ? ` (${DAYS[u.weekday - 1]} only)` : ''}</div>
                {u.reason && <div className="req-meta">{u.reason}</div>}
              </div>
              <button className="btn ghost sm" onClick={() => remove(u)} aria-label={`Remove ${s.isManager ? `${u.staffName}, ` : ''}${range(u)}`}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
