import React, { useState } from 'react';
import { signOut, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { collection, query, where, orderBy, limit, doc, writeBatch } from 'firebase/firestore';
import { auth, db, niceError } from '../firebase.js';
import { useSession } from '../App.jsx';
import { useLive, Field, Loading, ErrorBox, useToast, go, Icon, Empty, Tabs, TabPanel } from '../ui.jsx';
import Settings from './Settings.jsx';
import { ago } from '../util.js';

// Account: who you are on the left, your login settings on the right. Everything else (Events, Team, ...)
// lives in the main menu only, so nothing here repeats it.
export function More({ tab }) {
  const s = useSession();
  const role = s.role ? s.role.charAt(0).toUpperCase() + s.role.slice(1) : '';
  const tabs = [
    { key: 'password', label: 'Password' },
    ...(s.isOwner ? [{ key: 'settings', label: 'Email settings' }] : []),
  ];
  const cur = tabs.some((t) => t.key === tab) ? tab : 'password';
  return (
    <div className="account split">
      <aside className="split-side">
        <div className="profile card">
          <span className="profile-initial" aria-hidden="true">{(s.name || '?').charAt(0)}</span>
          <div>
            <div className="profile-name">{s.name}</div>
            <div className="profile-mail">{s.user.email}</div>
            {role && <span className="pill">{role}</span>}
          </div>
        </div>
        <button className="btn secondary block signout" onClick={() => { go(''); signOut(auth); }}><Icon name="out" />Sign out</button>
      </aside>
      <div className="split-main">
        {tabs.length > 1 && <Tabs items={tabs} value={cur} onChange={(k) => go(k)} label="Account settings" idBase="acct" />}
        <TabPanel idBase="acct" value={cur} plain={tabs.length < 2}>
          {cur === 'settings' ? <Settings /> : <Password />}
        </TabPanel>
      </div>
    </div>
  );
}

export function Password() {
  const s = useSession();
  const toast = useToast();
  const [f, setF] = useState({ current: '', next: '', again: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (f.next.length < 8) { setErr('Use at least 8 characters.'); return; }
    if (f.next !== f.again) { setErr('The new passwords don’t match.'); return; }
    setBusy(true);
    try {
      await reauthenticateWithCredential(s.user, EmailAuthProvider.credential(s.user.email, f.current));
      await updatePassword(s.user, f.next);
      setF({ current: '', next: '', again: '' });
      toast('Password changed.');
      go('more');
    } catch (e2) {
      setErr(niceError(e2));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="card stack" onSubmit={submit} aria-labelledby="pw-h">
      <h2 id="pw-h" className="card-title">Change password</h2>
      <Field label="Current password"><input type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} required /></Field>
      <Field label="New password"><input type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} required /></Field>
      <Field label="New password again"><input type="password" autoComplete="new-password" value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} required /></Field>
      {err && <div className="err">{err}</div>}
      <button className="btn" disabled={busy}>Change password</button>
    </form>
  );
}

export function Notifications() {
  const s = useSession();
  const toast = useToast();
  const notes = useLive(() => query(collection(db, 'notifications'), where('uid', '==', s.user.uid), orderBy('createdAt', 'desc'), limit(50)), [s.user.uid]);
  async function markAll() {
    const unread = (notes.docs || []).filter((n) => !n.read);
    if (!unread.length) return;
    const b = writeBatch(db);
    unread.forEach((n) => b.update(doc(db, 'notifications', n.id), { read: true }));
    try {
      await b.commit();
    } catch (e) {
      toast(niceError(e), 'warn');
    }
  }
  async function open(n) {
    if (!n.read) {
      const b = writeBatch(db);
      b.update(doc(db, 'notifications', n.id), { read: true });
      b.commit().catch(() => {});
    }
    if (n.link) window.location.hash = n.link;
  }
  return (
    <div>
      {notes.docs && notes.docs.some((n) => !n.read) && (
        <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 10 }}>
          <button className="btn ghost sm" onClick={markAll}>Mark all as read</button>
        </div>
      )}
      <ErrorBox error={notes.error} />
      {!notes.docs ? <Loading label="Loading notifications" /> : notes.docs.length === 0 ? (
        <Empty icon="bell" title="No notifications yet">You’ll get one when the rota is published, a payslip is added or a request is answered.</Empty>
      ) : (
        <ol className="updates full">
          {notes.docs.map((n) => (
            <li key={n.id} className={n.read ? '' : 'unread'}>
              <button type="button" onClick={() => open(n)}>
                <span className="up-dot" aria-hidden="true" />
                <span className="up-body">
                  <span className="up-title">{n.title}{!n.read && <span className="sr"> (new)</span>}</span>
                  {n.body && <span className="up-text">{n.body}</span>}
                </span>
                <span className="up-when">{ago(n.createdAt)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
