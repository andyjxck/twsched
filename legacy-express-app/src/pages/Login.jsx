import { useEffect, useState } from 'react'
import { api, DEMO } from '../api.js'
import { Field } from '../ui.jsx'

export default function Login({ onDone }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try { await api.post('/api/auth/login', { email, password }); await onDone() } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }
  return (
    <div className="login">
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div className="brand"><img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" /><h1 style={{ color: '#f7f3ea', marginTop: 8 }}>White Swan Staff</h1><div className="small" style={{ opacity: .8 }}>Rota, holiday and swaps</div></div>
        <form className="card stack" onSubmit={submit}>
          <Field label="Email"><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <Field label="Password"><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          {err && <div className="err">{err}</div>}
          <button className="btn block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <p className="tiny muted" style={{ margin: 0 }}>Forgotten your password? Ask a manager for a reset link.</p>
        </form>
        {DEMO && (
          <div className="card stack demo-logins" style={{ marginTop: 12 }}>
            <b>Demo logins</b>
            <p className="tiny muted" style={{ margin: 0 }}>Every demo account uses the password <b>swan-demo-2026</b>. Tap one to fill it in. The first sign-in sets the demo up in your browser, so it can take a few seconds.</p>
            {[['Owner', 'owner@whiteswan.demo'], ['Manager', 'manager@whiteswan.demo'], ['Supervisor', 'supervisor@whiteswan.demo'], ['Staff (Sam Taylor)', 'staff@whiteswan.demo']].map(([label, em]) => (
              <button key={em} type="button" className="btn secondary block" onClick={() => { setEmail(em); setPassword('swan-demo-2026'); setErr(null) }}>{label}<span className="tiny" style={{ display: 'block', opacity: .75 }}>{em}</span></button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function Invite({ token, onDone }) {
  const [info, setInfo] = useState(null)
  const [err, setErr] = useState(null)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.get(`/api/auth/invite/${encodeURIComponent(token)}`).then(setInfo).catch((e) => setErr(e.message)) }, [token])
  const submit = async (e) => {
    e.preventDefault()
    if (pw !== pw2) return setErr('The two passwords don\'t match.')
    setBusy(true); setErr(null)
    try { await api.post(`/api/auth/invite/${encodeURIComponent(token)}`, { password: pw }); history.replaceState(null, '', import.meta.env.BASE_URL); onDone() } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }
  return (
    <div className="login">
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div className="brand"><img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" /><h1 style={{ color: '#f7f3ea', marginTop: 8 }}>White Swan Staff</h1></div>
        <form className="card stack" onSubmit={submit}>
          {!info && !err && <p className="muted">Checking your link…</p>}
          {info && <>
            <h2 style={{ marginTop: 0 }}>{info.purpose === 'invite' ? `Welcome, ${info.full_name.split(' ')[0]}` : 'Set a new password'}</h2>
            <p className="small muted">You'll sign in with <b>{info.email}</b>. Pick a password of at least 10 characters.</p>
            <Field label="New password"><input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={10} /></Field>
            <Field label="Type it again"><input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required minLength={10} /></Field>
            <button className="btn block" disabled={busy}>Save and sign in</button>
          </>}
          {err && <div className="err">{err}</div>}
        </form>
      </div>
    </div>
  )
}
