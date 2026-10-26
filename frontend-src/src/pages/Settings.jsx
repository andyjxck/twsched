import React, { useEffect, useState } from 'react';
import { call, niceError } from '../firebase.js';
import { useSession } from '../App.jsx';
import { Field, Loading, useToast } from '../ui.jsx';

export default function Settings() {
  const s = useSession();
  const toast = useToast();
  const [f, setF] = useState(null);
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!s.isOwner) return;
    call('getMailSettings').then(setF).catch((e) => setErr(niceError(e)));
  }, [s.isOwner]);
  if (!s.isOwner) return <p className="muted">Only the owner can change email settings.</p>;
  if (!f) return err ? <div className="err">{err}</div> : <Loading />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  async function save(test) {
    setErr('');
    setBusy(true);
    try {
      const r = await call('setMailSettings', { ...f, pass });
      setPass('');
      setF({ ...f, hasPassword: f.hasPassword || !!pass });
      if (test) {
        const t = await call('sendTestEmail');
        toast(`Test email sent to ${t.to}.`);
      } else {
        toast(r.ready ? 'Saved. Emails are switched on.' : 'Saved. Emails stay off until the server, username and password are filled in.');
      }
    } catch (e) {
      setErr(niceError(e));
    } finally {
      setBusy(false);
    }
  }
  function gmail() {
    setF({ ...f, host: 'smtp.gmail.com', port: 465, secure: true });
  }
  return (
    <div className="card stack">
      <h3>Outgoing email</h3>
      <div className="row between wrap" style={{ gap: 8 }}>
        <span className="small muted">Emails enquiries to you and rota, payslip and login emails to staff.</span>
        <button type="button" className="btn secondary sm" onClick={gmail}>Use Gmail settings</button>
      </div>
      <details className="small muted">
        <summary style={{ cursor: 'pointer' }}>Gmail help</summary>
        Turn on 2-step verification, make an app password at myaccount.google.com/apppasswords, and paste it as the password below.
      </details>
      <Field label="Send enquiries to (up to 3, separated by commas)"><input type="text" inputMode="email" value={f.enquiryTo} onChange={set('enquiryTo')} placeholder={f.enquiryRecipient || 'you@example.com'} /></Field>
      <div className="grid2">
        <Field label="SMTP server"><input value={f.host} onChange={set('host')} placeholder="smtp.gmail.com" /></Field>
        <Field label="Port"><input type="number" value={f.port} onChange={set('port')} /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={!!f.secure} onChange={set('secure')} /> Use SSL (port 465)</label>
      <Field label="Username (the sending address)"><input value={f.user} onChange={set('user')} autoComplete="off" /></Field>
      <Field label={f.hasPassword ? (f.passwordInSecretStore ? 'Password (saved securely on the server – leave blank to keep it)' : 'Password (saved – leave blank to keep it)') : 'Password / app password'}>
        <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
      </Field>
      <Field label="From name and address (optional)"><input value={f.from} onChange={set('from')} placeholder="The White Swan <you@gmail.com>" /></Field>
      <label className="check"><input type="checkbox" checked={f.enabled !== false} onChange={set('enabled')} /> Emails switched on</label>
      <label className="check"><input type="checkbox" checked={!!f.emailStaff} onChange={set('emailStaff')} /> Email staff about new logins, rota changes, payslips and time off</label>
      <p className="tiny muted">The password stays on the server and can’t be read back.</p>
      {err && <div className="err">{err}</div>}
      <div className="actions">
        <button className="btn" disabled={busy} onClick={() => save(false)}>Save</button>
        <button className="btn secondary" disabled={busy} onClick={() => save(true)}>Save & send test</button>
      </div>
    </div>
  );
}
