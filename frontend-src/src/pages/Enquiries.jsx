import React, { useState } from 'react';
import { VENUE_NAME } from '../brand.js';
import { collection, query, orderBy, limit, doc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db, niceError } from '../firebase.js';
import { useSession } from '../App.jsx';
import { useLive, Loading, ErrorBox, useToast } from '../ui.jsx';
import { pretty, ago } from '../util.js';

const STATUSES = [['new', 'New', 'amber'], ['replied', 'Replied', 'blue'], ['booked', 'Booked', 'green'], ['closed', 'Closed', '']];

export default function Enquiries() {
  const s = useSession();
  const [show, setShow] = useState('open');
  const list = useLive(() => (s.isManager ? query(collection(db, 'enquiries'), orderBy('createdAt', 'desc'), limit(200)) : null), [s.isManager]);
  if (!s.isManager) return <p className="muted">Only managers can see enquiries.</p>;
  const docs = (list.docs || []).filter((e) => (show === 'open' ? e.status === 'new' || e.status === 'replied' : true));
  return (
    <div>
      <div className="segment">
        <button className={show === 'open' ? 'on' : ''} onClick={() => setShow('open')}>Open</button>
        <button className={show === 'all' ? 'on' : ''} onClick={() => setShow('all')}>All</button>
      </div>
      <ErrorBox error={list.error} />
      {!list.docs ? <Loading /> : docs.length === 0 ? <p className="muted">No enquiries here.</p> : docs.map((e) => <EnquiryCard key={e.id} e={e} />)}
    </div>
  );
}

function EnquiryCard({ e }) {
  const s = useSession();
  const toast = useToast();
  const [note, setNote] = useState(e.staffNote || '');
  async function setStatus(status) {
    try {
      await updateDoc(doc(db, 'enquiries', e.id), { status, handledBy: s.user.uid, handledAt: serverTimestamp(), staffNote: note.slice(0, 500) });
      toast(`Marked as ${status}.`);
    } catch (err) {
      toast(niceError(err), 'warn');
    }
  }
  async function remove() {
    if (!window.confirm(`Delete the enquiry from ${e.name}?`)) return;
    try {
      await deleteDoc(doc(db, 'enquiries', e.id));
    } catch (err) {
      toast(niceError(err), 'warn');
    }
  }
  const st = STATUSES.find((x) => x[0] === e.status) || STATUSES[0];
  const subject = encodeURIComponent(`Your ${e.occasion || 'private hire'} enquiry - ${VENUE_NAME}`);
  return (
    <div className="card">
      <div className="row between">
        <strong>{e.name}</strong>
        <span><span className={`pill ${st[2]}`}>{st[1]}</span> <span className="tiny muted">{ago(e.createdAt)}</span></span>
      </div>
      <dl className="kv" style={{ marginTop: 8 }}>
        <dt>Occasion</dt><dd>{e.occasion || '—'}{e.space ? ` · ${e.space}` : ''}</dd>
        <dt>Date</dt><dd>{e.date ? pretty(e.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'Not set'}</dd>
        <dt>Guests</dt><dd>{e.guests || '—'}</dd>
        <dt>Email</dt><dd><a href={`mailto:${e.email}?subject=${subject}`}>{e.email}</a></dd>
        {e.phone && (<><dt>Phone</dt><dd><a href={`tel:${e.phone.replace(/\s/g, '')}`}>{e.phone}</a></dd></>)}
        <dt>Message</dt><dd>{e.message}</dd>
      </dl>
      {e.emailError && <div className="warn tiny" style={{ marginTop: 6 }}>Email alert failed: {e.emailError}</div>}
      <input style={{ marginTop: 8 }} placeholder="Team note (only staff see this)" value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={500} />
      <div className="actions" style={{ marginTop: 8 }}>
        {STATUSES.filter((x) => x[0] !== e.status).map(([v, label]) => (
          <button key={v} className="btn secondary sm" onClick={() => setStatus(v)}>{label}</button>
        ))}
        <button className="btn ghost sm" onClick={remove}>Delete</button>
      </div>
    </div>
  );
}
