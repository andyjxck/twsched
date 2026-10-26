import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { APP_NAME, VENUE_NAME } from './brand.js';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db, niceError, call } from './firebase.js';
import { ToastProvider, Field } from './ui.jsx';
import { clearLegacyDemoData } from './legacy.js';
import Shell from './Shell.jsx';
import FirstPassword, { rememberTypedPassword, useLoginGate } from './FirstPassword.jsx';

const SessionCtx = createContext(null);
export function useSession() {
  return useContext(SessionCtx);
}

clearLegacyDemoData();

export default function App() {
  const [user, setUser] = useState(undefined);
  const [role, setRole] = useState('');
  const [profile, setProfile] = useState(null);
  // true while this login still has to replace its temporary password (claim set by the server)
  const [mustChange, setMustChange] = useState(false);

  useEffect(() => onAuthStateChanged(auth, async (u) => {
    setUser(u || null);
    setProfile(null);
    if (!u) { setRole(''); setMustChange(false); return; }
    const t = await u.getIdTokenResult();
    setMustChange(t.claims.pwChange === true);
    if (t.claims.pwChange !== true) rememberTypedPassword('');
    setRole(t.claims.role || '');
  }), []);
  useLoginGate(user, mustChange, (claims) => { setMustChange(claims.pwChange === true); setRole(claims.role || ''); });

  // live profile; if a manager changes our role, refresh the token so rules see it
  useEffect(() => {
    if (!user) return undefined;
    return onSnapshot(doc(db, 'staff', user.uid), async (snap) => {
      const p = snap.exists() ? { id: snap.id, ...snap.data() } : null;
      setProfile(p || { id: user.uid, missing: true });
      if (p && p.role) {
        const t = await user.getIdTokenResult();
        if (t.claims.role !== p.role) {
          const fresh = await user.getIdTokenResult(true);
          setRole(fresh.claims.role || '');
        }
      }
    }, () => setProfile({ id: user.uid, missing: true }));
  }, [user, mustChange]); // re-subscribe once a first-login password change lifts the restriction

  if (user === undefined) return <div className="login"><p className="muted">Loading…</p></div>;
  if (!user) return <ToastProvider><Login /></ToastProvider>;
  if (mustChange) {
    return (
      <ToastProvider>
        <FirstPassword
          user={user}
          onDone={(u, claims) => { setMustChange(claims.pwChange === true); setRole(claims.role || ''); setProfile(null); setUser(u); }}
        />
      </ToastProvider>
    );
  }
  if (!role) {
    return (
      <div className="login"><div className="card stack">
        <h3>Your login isn’t set up yet</h3>
        <p className="small">You’re signed in as {user.email}, but a manager hasn’t given this login a role. Ask them to add you in Team.</p>
        <button className="btn block" onClick={() => user.getIdTokenResult(true).then((t) => setRole(t.claims.role || ''))}>Check again</button>
        <button className="btn secondary block" onClick={() => signOut(auth)}>Sign out</button>
      </div></div>
    );
  }
  const session = {
    user, role, profile: profile || { id: user.uid },
    isManager: role === 'owner' || role === 'manager',
    isOwner: role === 'owner',
    isPrimaryOwner: role === 'owner' && !!(profile && profile.primaryOwner),
    name: (profile && profile.name) || user.displayName || user.email,
  };
  return (
    <SessionCtx.Provider value={session}>
      <ToastProvider><Shell /></ToastProvider>
    </SessionCtx.Provider>
  );
}

// Password-reset cooldown remembered on this device (per address, survives reloads). The real limit
// is enforced by the requestPasswordReset Cloud Function; this just stops pointless taps.
const RESET_KEY = 'twsched.resetCooldown';
function resetTag(email) {
  let h = 2166136261;
  for (const ch of email.trim().toLowerCase()) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
function readCooldowns() {
  try {
    const m = JSON.parse(localStorage.getItem(RESET_KEY) || '{}');
    const now = Date.now();
    return Object.fromEntries(Object.entries(m).filter(([, v]) => typeof v === 'number' && v > now));
  } catch {
    return {};
  }
}
function saveCooldown(email, seconds) {
  const m = readCooldowns();
  m[resetTag(email)] = Date.now() + Math.min(Math.max(Number(seconds) || 120, 1), 86400) * 1000;
  try { localStorage.setItem(RESET_KEY, JSON.stringify(m)); } catch { /* private mode */ }
}
function cooldownLeft(email) {
  if (!email.trim()) return 0;
  const until = readCooldowns()[resetTag(email)] || 0;
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}
function mmss(s) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [resetting, setResetting] = useState(false);
  const resetInFlight = useRef(false);
  const [, setTick] = useState(0);
  const wait = cooldownLeft(email);
  useEffect(() => {
    if (!wait) return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [wait > 0]);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr(''); setOk('');
    try {
      rememberTypedPassword(password); // memory only: pre-fills the temporary password on first sign-in
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (e2) {
      rememberTypedPassword('');
      setErr(niceError(e2));
    } finally {
      setBusy(false);
    }
  }
  async function forgot() {
    if (resetInFlight.current) return;
    setErr(''); setOk('');
    const addr = email.trim();
    if (!addr) { setErr('Type your email first, then tap “Forgot password”.'); return; }
    if (cooldownLeft(addr)) return;
    resetInFlight.current = true;
    setResetting(true);
    try {
      const r = await call('requestPasswordReset', { email: addr });
      saveCooldown(addr, (r && r.retryAfter) || 120);
      setOk('If that email has a login, a reset link is on its way. Check your junk folder too. You can ask for another in 2 minutes.');
    } catch (e2) {
      const code = String((e2 && e2.code) || '');
      if (code.endsWith('resource-exhausted')) {
        const secs = e2.details && e2.details.retryAfter;
        if (secs) saveCooldown(addr, secs);
        setErr(String(e2.message || 'Too many reset requests. Please wait and try again.'));
      } else if (code.endsWith('invalid-argument')) {
        setErr('Please check your email address.');
      } else {
        setErr(niceError(e2));
      }
    } finally {
      resetInFlight.current = false;
      setResetting(false);
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
        <form className="card stack" onSubmit={submit}>
          <Field label="Email"><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Field label="Password"><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          {err && <div className="err">{err}</div>}
          {ok && <div className="okbox">{ok}</div>}
          <button className="btn block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <button type="button" className="btn ghost block" onClick={forgot} disabled={resetting || wait > 0} aria-live="polite">
            {resetting ? 'Sending reset link…' : wait > 0 ? `Send another link in ${mmss(wait)}` : 'Forgot password'}
          </button>
          <p className="tiny muted" style={{ margin: 0 }}>No login? Ask a manager.</p>
        </form>
      </div>
    </div>
  );
}

