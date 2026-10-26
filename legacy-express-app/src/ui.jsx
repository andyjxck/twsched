import { useCallback, useEffect, useRef, useState, createContext, useContext } from 'react'

export const AppCtx = createContext(null)
export const useApp = () => useContext(AppCtx)

// Load data and reload on demand.
export function useLoad(fn, deps = []) {
  const [state, set] = useState({ data: null, error: null, loading: true })
  const fnRef = useRef(fn); fnRef.current = fn
  const reload = useCallback(async () => {
    set((s) => ({ ...s, loading: true }))
    try { const data = await fnRef.current(); set({ data, error: null, loading: false }) } catch (e) { set({ data: null, error: e.message, loading: false }) }
  }, [])
  useEffect(() => { reload() }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, reload }
}

export function Loader({ state, children }) {
  if (state.error) return <div className="err">{state.error}</div>
  if (!state.data) return <p className="muted">Loading…</p>
  return children(state.data)
}

export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = '' }
  }, [onClose])
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="head"><h2 style={{ margin: 0 }}>{title}</h2><button className="btn ghost" onClick={onClose} aria-label="Close">Close</button></div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, children, hint }) {
  return <label className="field"><span>{label}</span>{children}{hint && <div className="tiny muted" style={{ marginTop: 3 }}>{hint}</div>}</label>
}

// Runs an async action with a busy flag and shows errors via toast.
export function useAction() {
  const { toast } = useApp()
  const [busy, setBusy] = useState(false)
  const run = async (fn, okMsg) => {
    setBusy(true)
    try { const r = await fn(); if (okMsg) toast(okMsg); return r } catch (e) { toast(e.message, 'warn'); return undefined } finally { setBusy(false) }
  }
  return [busy, run]
}

export const STATUS_PILL = {
  pending: ['Pending', 'amber'], approved: ['Approved', 'green'], declined: ['Declined', 'red'], withdrawn: ['Withdrawn', ''], expired: ['Expired', ''],
  cancel_pending: ['Cancel requested', 'amber'], cancelled: ['Cancelled', ''], sent: ['Waiting for colleague', 'amber'], declined_by_colleague: ['Colleague said no', 'red'],
  awaiting_manager: ['With manager', 'blue'], void: ['Cancelled (shift changed)', ''], open: ['Open', 'amber'], uploaded: ['Not released', 'amber'], released: ['Released', 'blue'], viewed: ['Viewed', 'green'],
}
export const Status = ({ s }) => { const [t, c] = STATUS_PILL[s] || [s, '']; return <span className={`pill ${c}`}>{t}</span> }

// ---------- Dates ----------
export const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }
export const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
export const mondayOf = (iso) => addDays(iso, -((new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7))
export const fmtDate = (iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => (iso ? new Date(iso.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' }) : '')
export const fmtDateTime = (ts) => (ts ? new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')
export const fmtRange = (a, b) => (a === b ? fmtDate(a) : `${fmtDate(a)} to ${fmtDate(b)}`)
export const shiftText = (s) => `${fmtDate(s.shift_date)} ${s.start_time}–${s.end_time}${s.position ? ' · ' + s.position : ''}`
export const money = (n) => (n == null ? '–' : '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
export const r1 = (n) => Math.round(Number(n) * 10) / 10
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

// ---------- Icons (inline, no external requests) ----------
const P = {
  shifts: 'M7 3v3M17 3v3M4 9h16M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z',
  requests: 'M4 6h16M4 12h10M4 18h7M17 15l3 3-3 3',
  holiday: 'M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9zM12 12v8M9 20h6',
  news: 'M4 5h13v14H6a2 2 0 0 1-2-2V5zM17 9h3v8a2 2 0 0 1-2 2M7 9h7M7 13h7',
  me: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  rota: 'M3 5h18v14H3zM3 10h18M8 5v14M13 5v14',
  inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5',
  team: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2 20a7 7 0 0 1 14 0M16 4a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 4 6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
}
export const Icon = ({ name }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === 'more' ? 3.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={P[name]} /></svg>
)
