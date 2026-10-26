import React, { useState } from 'react';
import { collection, query, orderBy } from 'firebase/firestore';
import { db, call, niceError } from '../firebase.js';
import { useSession } from '../App.jsx';
import { useLive, Sheet, Field, Loading, ErrorBox, useToast, Tabs, TabPanel } from '../ui.jsx';
import { AREAS } from '../util.js';
import { RtwPicker, StaffDocuments, uploadAll } from './StaffDocs.jsx';

const ROLE_LABEL = { owner: 'Owner', manager: 'Manager', staff: 'Staff' };
const LOGIN_PILL = { sent: 'Not signed in yet', 'not-sent': 'Login email not sent', expired: 'Temporary password ran out' };

export default function Team() {
  const s = useSession();
  const [edit, setEdit] = useState(null);
  const [created, setCreated] = useState(null);
  const [tab, setTab] = useState('active');
  const staff = useLive(() => query(collection(db, 'staff'), orderBy('name')), []);
  const list = staff.docs || [];
  const active = list.filter((p) => p.active !== false && !p.terminated);
  const off = list.filter((p) => p.active === false && !p.terminated);
  const left = list.filter((p) => p.terminated);
  const cur = (tab === 'off' && off.length) || (tab === 'left' && left.length) ? tab : 'active';
  return (
    <div className="team-page">
      <div className="tabrow">
        {off.length || left.length ? (
          <Tabs items={[
            { key: 'active', label: 'Active', count: active.length },
            ...(off.length ? [{ key: 'off', label: 'Switched off', count: off.length }] : []),
            ...(left.length ? [{ key: 'left', label: 'Left', count: left.length }] : []),
          ]} value={cur} onChange={setTab} label="Team" idBase="team" />
        ) : <span className="muted small tabrow-note">{staff.docs ? `${active.length} active login${active.length === 1 ? '' : 's'}` : ''}</span>}
        {s.isManager && <button className="btn sm" onClick={() => setEdit({ name: '', email: '', role: 'staff', jobTitle: 'Bar', phone: '' })}>Add staff</button>}
      </div>
      <ErrorBox error={staff.error} />
      {!staff.docs ? <Loading /> : (
        <TabPanel idBase="team" value={cur} plain={!(off.length || left.length)}>
          <div className="card">
            {cur === 'left' && <p className="tiny muted">Login removed. Name, past shifts and payslips are kept for payroll records.</p>}
            <ul className="list peoplelist">
              {(cur === 'off' ? off : cur === 'left' ? left : active).map((p) => <Person key={p.id} p={p} onEdit={cur !== 'left' && canEdit(s, p) ? () => setEdit(p) : null} />)}
            </ul>
          </div>
        </TabPanel>
      )}
      {edit && <PersonSheet p={edit} onClose={() => setEdit(null)} onCreated={(c) => { setEdit(null); setCreated(c); }} />}
      {created && <LoginResult c={created} onClose={() => setCreated(null)} />}
    </div>
  );
}

function canEdit(s, p) {
  if (!s.isManager) return false;
  if (p.primaryOwner && p.id !== s.user.uid) return false;
  if (p.role === 'owner' && !s.isPrimaryOwner && p.id !== s.user.uid) return false;
  if (s.isOwner) return true;
  return p.role === 'staff';
}

function Person({ p, onEdit }) {
  return (
    <li className="row between">
      <div className="grow">
        <strong>{p.name}</strong> {p.role !== 'staff' && <span className="pill dark">{ROLE_LABEL[p.role]}</span>}
        {p.pendingFirstLogin && !p.terminated && <> <span className="pill amber">{LOGIN_PILL[(p.loginEmail || {}).status] || 'Not signed in yet'}</span></>}
        <div className="small muted">{[p.jobTitle, p.email, p.phone, p.terminated ? `left ${p.leftAt || ''}` : ''].filter(Boolean).join(' · ')}</div>
      </div>
      {onEdit && <button className="btn ghost sm" onClick={onEdit}>Edit</button>}
    </li>
  );
}

function PersonSheet({ p, onClose, onCreated }) {
  const s = useSession();
  const toast = useToast();
  const [f, setF] = useState({ ...p });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const isNew = !p.id;
  const isSelf = p.id === s.user.uid;
  const [rtwFiles, setRtwFiles] = useState([]); // Right to Work files picked while adding someone
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function run(fn) {
    setErr('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setErr(niceError(e));
    } finally {
      setBusy(false);
    }
  }
  const save = () => run(async () => {
    if (isNew) {
      const r = await call('createStaff', { name: f.name, email: f.email, role: f.role, jobTitle: f.jobTitle, phone: f.phone });
      // Right to Work: optional here, uploaded once the login exists. Without it they can't go on a shift.
      if (r && r.uid && rtwFiles.length) {
        const u = await uploadAll(rtwFiles, r.uid, f.name, { uid: s.user.uid, name: s.name });
        if (u.failed.length) toast(`Login created, but some Right to Work files didn’t upload: ${u.failed.join(' ')} Add them from Edit on their name.`, 'warn');
        else toast(`Right to Work: ${u.done} document${u.done === 1 ? '' : 's'} uploaded.`);
      } else if (r && r.uid) {
        toast(`No Right to Work documents yet. ${f.name.trim().split(/\s+/)[0]} can’t be put on a shift until they’re uploaded (Edit on their name).`);
      }
      onCreated({ ...r, name: f.name, email: f.email.trim().toLowerCase(), isNew: true });
    } else {
      const upd = { uid: p.id, name: f.name, jobTitle: f.jobTitle || '', phone: f.phone || '' };
      if (s.isOwner && !isSelf && f.role !== p.role) upd.role = f.role;
      await call('updateStaff', upd);
      toast('Saved.');
      onClose();
    }
  });
  const resetPassword = () => run(async () => {
    if (!window.confirm(`Email ${p.name} a new temporary password?\n\nTheir current password stops working straight away, and they’ll have to choose a new one when they sign in.`)) return;
    const r = await call('resendStaffLogin', { uid: p.id });
    onCreated({ ...r, name: p.name, email: p.email, isNew: false });
  });
  const toggleActive = () => run(async () => {
    const next = p.active === false;
    if (!next && !window.confirm(`Switch off ${p.name}’s login? They won’t be able to sign in.`)) return;
    await call('updateStaff', { uid: p.id, active: next });
    toast(next ? 'Login switched back on.' : 'Login switched off.');
    onClose();
  });
  const remove = () => run(async () => {
    if (!window.confirm(`${p.name} has left?\n\nTheir login, future shifts, pending requests and phone number are removed. Their name, past shifts and payslips are kept for payroll records.`)) return;
    await call('deleteStaff', { uid: p.id });
    toast(`${p.name} removed. Records kept for payroll.`);
    onClose();
  });

  return (
    <Sheet title={isNew ? 'Add staff' : p.name} onClose={onClose}>
      <div className="stack">
        <Field label="Name"><input value={f.name} onChange={set('name')} maxLength={80} /></Field>
        <Field label="Email (their login)"><input type="email" value={f.email} onChange={set('email')} disabled={!isNew} maxLength={150} /></Field>
        <div className="grid2">
          <Field label="Job">
            <select value={f.jobTitle || ''} onChange={set('jobTitle')}>
              <option value="">—</option>
              {AREAS.map((a) => <option key={a}>{a}</option>)}
            </select>
          </Field>
          <Field label="Phone"><input type="tel" value={f.phone || ''} onChange={set('phone')} maxLength={40} /></Field>
        </div>
        <Field label="Access">
          <select value={f.role} onChange={set('role')} disabled={!s.isOwner || isSelf || (p.role === 'owner' && !s.isPrimaryOwner)}>
            <option value="staff">Staff – own rota, payslips, time off</option>
            <option value="manager">Manager – rota, events, team, own payslips</option>
            {(s.isPrimaryOwner || f.role === 'owner') && <option value="owner">Owner – everything, incl. managers</option>}
          </select>
        </Field>
        {!s.isOwner && <p className="tiny muted">Only the owner can make someone a manager.</p>}
        {isNew && (
          <div className="field" role="group" aria-labelledby="rtw-new-label">
            <span id="rtw-new-label">Right to Work documents (optional)</span>
            <RtwPicker files={rtwFiles} setFiles={setRtwFiles} disabled={busy} />
            <p className="tiny muted" style={{ margin: '6px 0 0' }}>Passport, share code check or permit. Optional now; needed before their first shift.</p>
          </div>
        )}
        {!isNew && !p.terminated && <StaffDocuments person={p} />}
        {err && <div className="err">{err}</div>}
        <button className="btn" disabled={busy} onClick={save}>{isNew ? 'Create login' : 'Save'}</button>
        {!isNew && !isSelf && (
          <div className="actions">
            <button className="btn secondary sm" disabled={busy || p.active === false} onClick={resetPassword}>{p.pendingFirstLogin ? 'Resend login' : 'New password'}</button>
            <button className="btn secondary sm" disabled={busy} onClick={toggleActive}>{p.active === false ? 'Switch login on' : 'Switch login off'}</button>
            <button className="btn danger sm" disabled={busy} onClick={remove}>Has left</button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

// After "Create login" / "Resend login". The temporary password is only in the reply when the
// email did NOT reach them (server decides), so a manager only sees it when they must pass it on.
function LoginResult({ c, onClose }) {
  const until = c.expiresAt ? new Date(c.expiresAt).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
  const first = String(c.name || '').split(/\s+/)[0] || 'They';
  return (
    <Sheet title={c.isNew ? 'Login created' : 'New temporary password'} onClose={onClose}>
      <div className="stack">
        {c.emailSent ? (
          <>
            <div className="okbox" role="status">
              {c.isNew ? `${c.name} has a login.` : `${c.name}’s old password has stopped working.`} We’ve emailed a temporary password to <strong>{c.email}</strong>.
            </div>
            <p className="small">{first} signs in at andyjxck.github.io/twsched with it, and has to choose their own password before they can see anything.{until ? ` The temporary password works until ${until}.` : ''}</p>
            <p className="small muted">If it doesn’t arrive, ask them to check junk mail, then use “Resend login” on their name in Team.</p>
          </>
        ) : (
          <>
            <div className="err" role="alert">
              <strong>The login email wasn’t sent.</strong>
              <div className="err-detail">{c.reason || 'The email could not be sent.'}</div>
            </div>
            <p className="small">{c.isNew ? `${c.name}’s login is set up.` : `${c.name}’s old password has stopped working.`} Give them this temporary password yourself, in person or by text:</p>
            <div className="kv"><dt>App</dt><dd>andyjxck.github.io/twsched</dd><dt>Email</dt><dd>{c.email}</dd></div>
            <div className="temp-pass">{c.tempPassword}</div>
            <p className="small muted">It’s only shown this once. When they sign in they’ll have to choose their own password before they can use the app.{until ? ` It works until ${until}.` : ''}</p>
            <button className="btn" onClick={() => navigator.clipboard && navigator.clipboard.writeText(c.tempPassword || '')}>Copy password</button>
          </>
        )}
      </div>
    </Sheet>
  );
}
