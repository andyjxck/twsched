// First sign-in with a temporary password (sent from Team): the account can't see or do anything
// until it chooses its own password. The server (completePasswordChange) checks the temporary
// password, sets the new one, proves it works and only then lifts the restriction; Firestore and
// Storage rules and every other callable refuse the account until then. See functions/onboarding.js.
import { APP_NAME, VENUE_NAME } from './brand.js';
import React, { useEffect, useState } from 'react';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db, niceError, call } from './firebase.js';
import { Field } from './ui.jsx';

// The password typed on the sign-in form, kept in memory only (never stored) so the temporary
// password doesn't have to be typed twice. Read once.
let typed = '';
export function rememberTypedPassword(pw) { typed = pw || ''; }
function takeTyped() { const t = typed; typed = ''; return t; }

// Watches authGate/{uid}: if a manager sends this signed-in account a new temporary password, its
// current token (minted before) is refreshed. The refresh token was revoked by the server, so the
// refresh fails and Firebase signs the device out; they sign in again with the new temporary password.
export function useLoginGate(user, mustChange, onClaims) {
  useEffect(() => {
    if (!user) return undefined;
    return onSnapshot(doc(db, 'authGate', user.uid), async (snap) => {
      if (snap.exists() && !mustChange) {
        try {
          const t = await user.getIdTokenResult(true);
          onClaims(t.claims);
        } catch {
          signOut(auth);
        }
      }
    }, () => {});
  }, [user, mustChange]);
}

function fmtDay(ms) {
  return new Date(ms).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

export default function FirstPassword({ user, onDone }) {
  const [current, setCurrent] = useState(takeTyped);
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [expired, setExpired] = useState(false);
  const [gate, setGate] = useState(null);

  useEffect(() => onSnapshot(doc(db, 'authGate', user.uid), (s) => setGate(s.exists() ? s.data() : null), () => {}), [user]);
  const expiresMs = gate && gate.expiresAt && gate.expiresAt.toMillis ? gate.expiresAt.toMillis() : 0;
  const isExpired = expired || (gate && gate.expired === true) || (expiresMs && expiresMs < Date.now());

  function localProblem() {
    if (!current) return 'Enter the temporary password from your email.';
    if (next.length < 8) return 'Your new password needs at least 8 characters.';
    if (next === current) return 'Choose a different password from your temporary one.';
    if (next !== again) return 'The two new passwords don’t match.';
    return '';
  }

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const p = localProblem();
    if (p) { setErr(p); return; }
    setBusy(true); setErr('');
    try {
      await call('completePasswordChange', { currentPassword: current, newPassword: next });
      // The server signed out every old session; sign this device back in with the new password.
      let lastErr;
      for (let i = 0; i < 3; i++) {
        try {
          await signInWithEmailAndPassword(auth, user.email, next);
          lastErr = null;
          break;
        } catch (e2) {
          lastErr = e2;
          await new Promise((r) => setTimeout(r, 1200));
        }
      }
      if (lastErr) {
        setErr('Your new password is saved. Sign in again with it.');
        await signOut(auth);
        return;
      }
      const u = auth.currentUser;
      const t = await u.getIdTokenResult(true);
      onDone(u, t.claims);
    } catch (e2) {
      const reason = e2 && e2.details && e2.details.reason;
      if (reason === 'expired') setExpired(true);
      setErr(niceError(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" />
          <h1>{APP_NAME}</h1>
          <div className="small">{VENUE_NAME}</div>
        </div>
        {isExpired ? (
          <div className="card stack">
            <h3 style={{ margin: 0 }}>Your temporary password has run out</h3>
            <p className="small" style={{ margin: 0 }}>Ask a manager to send you a new one from Team. It will arrive by email at {user.email}.</p>
            {err && !expired && <div className="err" role="alert">{err}</div>}
            <button type="button" className="btn secondary block" onClick={() => signOut(auth)}>Sign out</button>
          </div>
        ) : (
          <form className="card stack" onSubmit={submit} noValidate>
            <h3 style={{ margin: 0 }}>Choose your own password</h3>
            <p className="small" style={{ margin: 0 }}>
              You’ve signed in as <strong>{user.email}</strong> with a temporary password. Choose your own to carry on.
            </p>
            {/* hidden username so password managers save the new password against the right login */}
            <input type="email" autoComplete="username" value={user.email || ''} readOnly hidden />
            <Field label="Temporary password (from your email)">
              <input type={show ? 'text' : 'password'} autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
            </Field>
            <Field label="New password">
              <input type={show ? 'text' : 'password'} autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />
            </Field>
            <Field label="New password again">
              <input type={show ? 'text' : 'password'} autoComplete="new-password" minLength={8} value={again} onChange={(e) => setAgain(e.target.value)} required />
            </Field>
            <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show passwords
            </label>
            <p className="tiny muted" style={{ margin: 0 }}>
              At least 8 characters, and not easy to guess.
              {expiresMs ? ` Your temporary password works until ${fmtDay(expiresMs)}.` : ''}
            </p>
            {err && <div className="err" role="alert">{err}</div>}
            <button className="btn block" disabled={busy}>{busy ? 'Saving…' : 'Save my password'}</button>
            <button type="button" className="btn ghost block" onClick={() => signOut(auth)} disabled={busy}>Sign out</button>
          </form>
        )}
      </div>
    </div>
  );
}
