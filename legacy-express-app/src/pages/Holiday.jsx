import { api, v } from '../api.js'
import { useLoad, Loader, fmtDate, r1 } from '../ui.jsx'
import { Link } from '../App.jsx'

export function BalanceView({ b }) {
  const hpd = b.hours_per_day
  const box = (label, h, strong) => (
    <div className="stat"><div className="label">{label}</div><div className={strong ? 'big' : ''} style={strong ? {} : { fontSize: '1.25rem', fontWeight: 700 }}>{r1(h)}h</div><div className="tiny muted">{r1(h / hpd)} days</div></div>
  )
  return (
    <>
      <div className="grid4">
        {box('Accrued', b.accrued + b.adjustments)}
        {box('Taken', b.taken)}
        {box('Booked', b.booked)}
        {box('Left', b.remaining, true)}
      </div>
      {b.pending > 0 && <p className="small">Plus <b>{r1(b.pending)}h</b> waiting for approval (not taken off yet).</p>}
      <div className="card" style={{ marginTop: 12 }}>
        <h3>How it's worked out</h3>
        <p className="tiny muted">Leave year {fmtDate(b.leave_year.start, { day: 'numeric', month: 'short', year: 'numeric' })} to {fmtDate(b.leave_year.end, { day: 'numeric', month: 'short', year: 'numeric' })}. {b.holiday_type === 'irregular' ? 'Irregular hours: you build up 12.07% of the hours you actually work.' : 'Regular hours: 5.6 weeks a year, pro rata.'} A day counts as {hpd}h.</p>
        <table className="simple"><tbody>
          {b.lines.map((l, i) => <tr key={i}><td>{l.label}</td><td className="num">{l.hours >= 0 ? '+' : ''}{r1(l.hours)}h</td></tr>)}
          <tr><td><b>Left</b></td><td className="num"><b>{r1(b.remaining)}h</b></td></tr>
        </tbody></table>
      </div>
    </>
  )
}

export default function Holiday() {
  const state = useLoad(() => api.get(v('/my/holiday')))
  return (
    <>
      <Loader state={state}>{(b) => <BalanceView b={b} />}</Loader>
      <Link to="/requests" className="btn block" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>Ask for time off</Link>
      <p className="tiny muted">If something looks wrong, ask a manager. They can see the same breakdown and add a correction.</p>
    </>
  )
}
