import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, setVenue, v, DEMO, HASH_ROUTES } from './api.js'
import DemoBar from './DemoBar.jsx'
import { AppCtx, Icon, Modal, fmtDateTime, useApp } from './ui.jsx'
import Login, { Invite } from './pages/Login.jsx'
import MyShifts from './pages/MyShifts.jsx'
import Requests from './pages/Requests.jsx'
import Holiday from './pages/Holiday.jsx'
import News from './pages/News.jsx'
import Me from './pages/Me.jsx'
import Rota from './pages/Rota.jsx'
import Inbox from './pages/Inbox.jsx'
import Team from './pages/Team.jsx'
import Events from './pages/Events.jsx'
import Business from './pages/Business.jsx'
import Documents from './pages/Documents.jsx'
import Payslips from './pages/Payslips.jsx'
import Settings from './pages/Settings.jsx'

// Tiny router: the path decides the page.
// On GitHub Pages (the demo) the page lives after a # so refreshing never hits a missing file.
const currentPath = () => (HASH_ROUTES ? (location.hash.replace(/^#/, '') || '/') : location.pathname)
export const hrefFor = (to) => (HASH_ROUTES ? '#' + to : to)
function usePath() {
  const [path, setPath] = useState(currentPath())
  useEffect(() => {
    const f = () => setPath(currentPath())
    window.addEventListener('popstate', f); window.addEventListener('hashchange', f)
    return () => { window.removeEventListener('popstate', f); window.removeEventListener('hashchange', f) }
  }, [])
  const go = useCallback((p) => { if (p !== currentPath()) history.pushState(null, '', hrefFor(p)); setPath(p); window.scrollTo(0, 0) }, [])
  return [path, go]
}

export function Link({ to, children, ...rest }) {
  const { go } = window.__swanNav
  return <a href={hrefFor(to)} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); go(to) }} {...rest}>{children}</a>
}

const LEAD = ['owner', 'manager', 'supervisor']
const MGR = ['owner', 'manager']

export default function App() {
  const [path, go] = usePath()
  window.__swanNav = { go }
  const [me, setMe] = useState(undefined) // undefined = loading, null = signed out
  const [venue, setVenueState] = useState(null)
  const [toastMsg, setToast] = useState(null)
  const [summary, setSummary] = useState({ unread: 0, inbox: 0 })
  const [showBell, setShowBell] = useState(false)

  const toast = useCallback((text, kind = '') => { setToast({ text, kind, id: Math.random() }) }, [])
  useEffect(() => { if (!toastMsg) return; const t = setTimeout(() => setToast(null), toastMsg.kind ? 6000 : 3000); return () => clearTimeout(t) }, [toastMsg])

  const loadMe = useCallback(async () => {
    try {
      const r = await api.get('/api/auth/me')
      setMe(r)
      const saved = Number(localStorage.getItem('swan_venue'))
      const ven = r.venues.find((x) => x.id === saved) || r.venues[0] || null
      if (ven) { setVenue(ven.id); setVenueState(ven) }
    } catch { setMe(null) }
  }, [])
  useEffect(() => { loadMe() }, [loadMe])

  const refreshSummary = useCallback(async () => {
    if (!venue) return
    try {
      const s = await api.get(v('/my/summary'))
      let inbox = 0
      if (LEAD.includes(venue.role)) inbox = (await api.get(v('/inbox'))).length
      setSummary({ unread: s.unread, swaps: s.swaps_waiting, inbox })
    } catch (e) { if (e.status === 401) setMe(null) }
  }, [venue])
  useEffect(() => { refreshSummary(); const t = setInterval(refreshSummary, 60000); return () => clearInterval(t) }, [refreshSummary, path])

  const ctx = useMemo(() => ({ me, venue, toast, go, refreshSummary, reloadMe: loadMe,
    isLead: venue && LEAD.includes(venue.role), isManager: venue && MGR.includes(venue.role), isOwner: venue?.role === 'owner',
    canDocs: venue && (venue.role === 'owner' || (venue.role === 'manager' && venue.can_view_documents)) }), [me, venue, toast, go, refreshSummary, loadMe])

  if (path.startsWith('/invite/')) return <AppCtx.Provider value={ctx}>{DEMO && <DemoBar />}<Invite token={path.slice(8)} onDone={() => { loadMe(); go('/') }} />{toastMsg && <div className={`toast ${toastMsg.kind}`}>{toastMsg.text}</div>}</AppCtx.Provider>
  if (me === undefined) return <div className="login"><p style={{ color: '#f7f3ea' }}>{DEMO ? 'Loading the demo…' : 'Loading…'}</p></div>
  if (me === null) return <AppCtx.Provider value={ctx}>{DEMO && <DemoBar />}<Login onDone={async () => { await loadMe(); go('/') }} />{toastMsg && <div className={`toast ${toastMsg.kind}`}>{toastMsg.text}</div>}</AppCtx.Provider>
  if (!venue) return <div className="login"><div className="card">Your account isn't linked to a venue yet. Ask your manager.</div></div>

  const role = venue.role
  const tabs = MGR.includes(role)
    ? [['/rota', 'Rota', 'rota'], ['/inbox', 'Inbox', 'inbox', summary.inbox], ['/', 'My shifts', 'shifts', summary.swaps], ['/team', 'Team', 'team'], ['/more', 'More', 'more']]
    : role === 'supervisor'
      ? [['/', 'Shifts', 'shifts', summary.swaps], ['/rota', 'Rota', 'rota'], ['/inbox', 'Inbox', 'inbox', summary.inbox], ['/requests', 'Requests', 'requests'], ['/more', 'More', 'more']]
      : [['/', 'Shifts', 'shifts', summary.swaps], ['/requests', 'Requests', 'requests'], ['/holiday', 'Holiday', 'holiday'], ['/news', 'News', 'news'], ['/me', 'Me', 'me']]

  const pages = {
    '/': [MyShifts, 'My shifts'], '/requests': [Requests, 'Requests'], '/holiday': [Holiday, 'Holiday'], '/news': [News, 'Announcements'], '/me': [Me, 'Me'],
    '/more': [More, 'More'],
    ...(LEAD.includes(role) ? { '/rota': [Rota, 'Rota'], '/inbox': [Inbox, 'Approvals'] } : {}),
    ...(MGR.includes(role) ? { '/team': [Team, 'Team'], '/events': [Events, 'Website events'], '/business': [Business, 'Sales & labour'], '/payslips': [Payslips, 'Payslips'], '/settings': [Settings, 'Settings'] } : {}),
    ...(ctx.canDocs ? { '/documents': [Documents, 'Right to work'] } : {}),
  }
  const [Page, title] = pages[path] || [NotFound, 'Not found']

  return (
    <AppCtx.Provider value={ctx}>
      {DEMO && <DemoBar signedIn />}
      <header className="topbar">
        <div className="title"><div className="venue">{venue.name}</div><h1>{title}</h1></div>
        <button className="iconbtn" onClick={() => setShowBell(true)} aria-label="Notifications"><Icon name="bell" />{summary.unread > 0 && <span className="badge">{summary.unread}</span>}</button>
      </header>
      <main className={path === '/rota' ? 'wide' : ''}><Page /></main>
      <nav className="tabs">
        {tabs.map(([to, label, icon, count]) => (
          <Link key={to} to={to} className={path === to ? 'on' : ''}><Icon name={icon} />{label}{count > 0 && <span className="badge">{count}</span>}</Link>
        ))}
      </nav>
      {showBell && <Bell onClose={() => { setShowBell(false); refreshSummary() }} />}
      {toastMsg && <div key={toastMsg.id} className={`toast ${toastMsg.kind}`} role="status">{toastMsg.text}</div>}
    </AppCtx.Provider>
  )
}

function Bell({ onClose }) {
  const [items, setItems] = useState(null)
  useEffect(() => { api.get(v('/my/notifications')).then((r) => { setItems(r); api.post(v('/my/notifications/read')) }).catch(() => setItems([])) }, [])
  return (
    <Modal title="Notifications" onClose={onClose}>
      {!items ? <p className="muted">Loading…</p> : items.length === 0 ? <p className="muted">Nothing yet.</p> : (
        <ul className="list">
          {items.map((n) => (
            <li key={n.id} style={{ fontWeight: n.read_at ? 400 : 600 }}>
              {n.link ? <Link to={n.link} onClick={onClose} style={{ color: 'inherit', textDecoration: 'none' }}>{n.body}</Link> : n.body}
              <div className="tiny muted">{fmtDateTime(n.created_at)}</div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

function More() {
  const { isManager, isLead, canDocs, venue } = useApp()
  const links = [
    ...(isManager ? [['/', 'My shifts'], ['/requests', 'My requests'], ['/events', 'Website events'], ['/news', 'Announcements'], ['/business', 'Sales, labour and overtime'], ['/payslips', 'Payslips'], ...(canDocs ? [['/documents', 'Right to work documents']] : []), ['/settings', 'Venue settings']] : []),
    ...(!isManager && isLead ? [['/news', 'Announcements']] : []),
    ['/holiday', 'My holiday'], ['/me', 'Me, payslips and sign out'],
  ]
  return (
    <div className="card morelist">
      {links.map(([to, label]) => <Link key={to + label} to={to}>{label}<span className="muted">›</span></Link>)}
      <p className="tiny muted" style={{ marginTop: 10 }}>Signed in as {venue.role} at {venue.name}.</p>
    </div>
  )
}

function NotFound() { return <div className="card">That page doesn't exist, or you don't have access to it. <Link to="/">Go to my shifts</Link></div> }
