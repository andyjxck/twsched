import React, { useRef, useState } from 'react';
import { collection, query, orderBy, doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db, niceError } from '../firebase.js';
import { useSession } from '../App.jsx';
import { useLive, Sheet, Field, Loading, ErrorBox, useToast, Tabs, TabPanel } from '../ui.jsx';
import { ymd, prettyLong, DAYS, weekdayIndex } from '../util.js';
import TimeEntry from '../TimeEntry.jsx';
import { normaliseTime } from '../timeDraft.js';

const ROOMS = ['Bar', 'Restaurant', 'Garden', 'Function room', 'Whole venue', 'Off site'];

export default function Events() {
  const s = useSession();
  const today = ymd();
  const [edit, setEdit] = useState(null);
  const [tab, setTab] = useState('upcoming');
  const events = useLive(() => query(collection(db, 'events'), orderBy('date')), []);
  const all = events.docs || [];
  const weekly = all.filter((e) => e.repeat === 'weekly');
  const upcoming = all.filter((e) => e.repeat !== 'weekly' && e.date >= today);
  const past = all.filter((e) => e.repeat !== 'weekly' && e.date < today).reverse();

  return (
    <div className="events-page">
      <div className="tabrow">
        <Tabs items={[
          { key: 'upcoming', label: 'Coming up', count: events.docs ? upcoming.length : undefined },
          { key: 'weekly', label: 'Every week', count: events.docs ? weekly.length : undefined },
          { key: 'past', label: 'Past', count: events.docs ? past.length : undefined },
        ]} value={tab} onChange={setTab} label="Events" idBase="events" />
        {s.isManager && <button className="btn sm" onClick={() => setEdit({ title: '', date: today, start: '19:00', end: '', room: 'Bar', description: '', repeat: 'none', onWebsite: true, staffNeeded: 0 })}>Add event</button>}
      </div>
      <ErrorBox error={events.error} />
      {!events.docs ? <Loading /> : (
        <TabPanel idBase="events" value={tab}>
          {tab === 'upcoming' && (upcoming.length === 0 ? <p className="muted">No one-off events booked.</p> : <div className="cardgrid">{upcoming.map((e) => <EventCard key={e.id} e={e} onEdit={s.isManager ? () => setEdit(e) : null} />)}</div>)}
          {tab === 'weekly' && (weekly.length === 0 ? <p className="muted">No weekly events.</p> : <div className="cardgrid">{weekly.map((e) => <EventCard key={e.id} e={e} onEdit={s.isManager ? () => setEdit(e) : null} />)}</div>)}
          {tab === 'past' && (past.length === 0 ? <p className="muted">No past events.</p> : <div className="cardgrid">{past.map((e) => <EventCard key={e.id} e={e} past onEdit={s.isManager ? () => setEdit(e) : null} />)}</div>)}
        </TabPanel>
      )}
      {edit && <EventSheet ev={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function EventCard({ e, onEdit, past }) {
  return (
    <div className={`card tight shift ${past ? 'past' : ''}`}>
      <div className="row between">
        <div className="grow">
          <strong>{e.title}</strong>
          <div className="small">
            {e.repeat === 'weekly' ? `Every ${DAYS[weekdayIndex(e.date)]}${e.date > ymd() ? ` from ${prettyLong(e.date)}` : ''}` : prettyLong(e.date)}
            {e.start ? ` · ${e.start}${e.end ? `–${e.end}` : ''}` : ''}{e.room ? ` · ${e.room}` : ''}
          </div>
          {e.description && <div className="small muted">{e.description}</div>}
        </div>
        <div className="right">
          {e.onWebsite ? <span className="pill green">On website</span> : <span className="pill">Staff only</span>}
          {e.staffNeeded > 0 && <div className="tiny muted">{e.staffNeeded} staff needed</div>}
          {onEdit && <div><button className="btn ghost sm" onClick={onEdit}>Edit</button></div>}
        </div>
      </div>
    </div>
  );
}

function EventSheet({ ev, onClose }) {
  const s = useSession();
  const toast = useToast();
  const [f, setF] = useState({ ...ev });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [timeErr, setTimeErr] = useState({ start: '', end: '' });
  // start hours -> start minutes -> end hours -> end minutes, then the cursor stays put
  const startH = useRef(null);
  const startM = useRef(null);
  const endH = useRef(null);
  const endM = useRef(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const setTime = (k) => (v) => {
    setTimeErr((t) => (t[k] ? { ...t, [k]: '' } : t));
    setF((prev) => ({ ...prev, [k]: v }));
  };
  async function save() {
    setErr('');
    if (!f.title.trim()) { setErr('Give the event a name.'); return; }
    if (!f.date) { setErr('Pick a date.'); return; }
    const st = normaliseTime(f.start, 'start time');
    const en = normaliseTime(f.end, 'end time');
    if (st.error || en.error) {
      setTimeErr({ start: st.error || '', end: en.error || '' });
      setErr(st.error || en.error);
      (st.error ? startH : endH).current?.focus();
      return;
    }
    setBusy(true);
    try {
      const ref = ev.id ? doc(db, 'events', ev.id) : doc(collection(db, 'events'));
      await setDoc(ref, {
        title: f.title.trim().slice(0, 120),
        date: f.date,
        start: st.value,
        end: en.value,
        room: f.room || '',
        description: (f.description || '').slice(0, 600),
        repeat: f.repeat === 'weekly' ? 'weekly' : 'none',
        onWebsite: !!f.onWebsite,
        staffNeeded: Math.max(0, Math.min(50, parseInt(f.staffNeeded, 10) || 0)),
        updatedAt: serverTimestamp(),
        updatedBy: s.user.uid,
      });
      toast(f.onWebsite ? 'Saved. The website updates in a few seconds.' : 'Saved.');
      onClose();
    } catch (e) {
      setErr(niceError(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!window.confirm(`Delete “${ev.title}”?`)) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, 'events', ev.id));
      toast('Event deleted.');
      onClose();
    } catch (e) {
      setErr(niceError(e));
      setBusy(false);
    }
  }
  return (
    <Sheet title={ev.id ? 'Edit event' : 'Add event'} onClose={onClose}>
      <div className="stack">
        <Field label="Event name"><input value={f.title} onChange={set('title')} maxLength={120} /></Field>
        <Field label={f.repeat === 'weekly' ? 'First date' : 'Date'}><input type="date" value={f.date} onChange={set('date')} /></Field>
        <div className="grid2">
          <TimeEntry id="ev-start" testid="ev-start" label="Starts" value={f.start} onChange={setTime('start')}
            hoursRef={startH} minutesRef={startM} nextRef={endH} error={timeErr.start} />
          <TimeEntry id="ev-end" testid="ev-end" label="Ends (optional)" value={f.end} onChange={setTime('end')}
            hoursRef={endH} minutesRef={endM} prevRef={startM} error={timeErr.end} />
        </div>
        <Field label="Repeats">
          <select value={f.repeat} onChange={set('repeat')}>
            <option value="none">One-off</option>
            <option value="weekly">Every week on this day</option>
          </select>
        </Field>
        <Field label="Where">
          <select value={f.room} onChange={set('room')}>
            <option value="">—</option>
            {ROOMS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Details"><textarea value={f.description} onChange={set('description')} maxLength={600} /></Field>
        <Field label="Staff needed"><input type="number" min="0" max="50" value={f.staffNeeded} onChange={set('staffNeeded')} /></Field>
        <label className="check"><input type="checkbox" checked={!!f.onWebsite} onChange={set('onWebsite')} /> Show on the hotel website</label>
        {err && <div className="err">{err}</div>}
        <div className="actions">
          <button className="btn" disabled={busy} onClick={save}>Save</button>
          {ev.id && <button className="btn danger" disabled={busy} onClick={remove}>Delete</button>}
        </div>
      </div>
    </Sheet>
  );
}
