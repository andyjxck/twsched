// Demo only: runs the real server routes inside the browser for the GitHub Pages version.
// The page's API calls come here instead of going over the network. Everything stays in this
// browser: made-up demo data in an in-browser Postgres (PGlite) saved to IndexedDB.
import './polyfills.js'
import express from './express.js'
import { openDb, closeDb, one } from './db.js'
import { loadFiles, clearFiles } from './security.js'
import { migrate } from './migrate.js'
import { seed } from '../server/seed.js'
import { loadSession, authRouter, requireUser } from '../server/auth.js'
import { loadVenue } from '../server/access.js'
import { HttpError, todayIn } from '../server/util.js'
import { rota } from '../server/routes/rota.js'
import { my } from '../server/routes/my.js'
import { inbox, problemThread } from '../server/routes/inbox.js'
import { team } from '../server/routes/team.js'
import { announcements } from '../server/routes/announcements.js'
import { events, publicApi } from '../server/routes/events.js'
import { business } from '../server/routes/business.js'
import { documents, payslips } from '../server/routes/documents.js'

const DB_NAME = 'idb://swan-staff-demo'
const SEEDED_KEY = 'swan_demo_seeded_on'
const COOKIE_KEY = 'swan_demo_cookies'
// Demo data is dated around the day it was made. After a fortnight it's refreshed so the rota
// always shows this week.
const REFRESH_AFTER_DAYS = 14

function buildApp() {
  const app = express()
  app.use('/api/public', publicApi)
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  app.use('/api', loadSession)
  app.use('/api/auth', authRouter)
  const v = express.Router({ mergeParams: true })
  v.use(loadVenue)
  v.use('/rota', rota)
  v.use('/my', my)
  v.use('/inbox', inbox)
  v.post('/problems/:id/messages', problemThread)
  v.use('/team', team)
  v.use('/announcements', announcements)
  v.use('/events', events)
  v.use('/business', business)
  v.use('/documents', documents)
  v.use('/payslips', payslips)
  app.use('/api/v/:venueId', requireUser, v)
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }))
  return app
}

// ---------- Cookie jar (the session cookie lives in localStorage) ----------
function readJar() { try { return JSON.parse(localStorage.getItem(COOKIE_KEY) || '{}') } catch { return {} } }
function writeJar(j) { try { localStorage.setItem(COOKIE_KEY, JSON.stringify(j)) } catch { /* ignore */ } }

export const hasSession = () => Object.keys(readJar()).length > 0

// ---------- Start-up ----------
let app = null
let ready = null
async function boot(fresh = false) {
  if (fresh) {
    await closeDb()
    await new Promise((resolve) => { const r = indexedDB.deleteDatabase('/pglite/swan-staff-demo'); r.onsuccess = r.onerror = r.onblocked = () => resolve() })
    await clearFiles()
    writeJar({})
    localStorage.removeItem(SEEDED_KEY)
  }
  await openDb(DB_NAME)
  await loadFiles()
  await migrate()
  const seededOn = localStorage.getItem(SEEDED_KEY)
  const today = todayIn('Europe/London')
  const stale = seededOn && (Date.parse(today) - Date.parse(seededOn)) / 86400000 >= REFRESH_AFTER_DAYS
  const n = (await one('SELECT count(*)::int AS n FROM venues')).n
  if (n === 0 || stale || !seededOn) {
    await clearFiles()
    await seed({ reset: n > 0 })
    localStorage.setItem(SEEDED_KEY, today)
    if (n > 0) writeJar({})
  }
  app = buildApp()
}
export function start() { if (!ready) ready = boot(false); return ready }
export function resetDemo() {
  const p = queue.then(() => boot(true))
  ready = p
  queue = p.catch(() => {})
  return p
}

// ---------- Handling one request ----------
function errorResponse(err, res) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) })
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'That file is too big.' })
  if (err?.name === 'MulterError') return res.status(400).json({ error: 'Upload problem: ' + err.message })
  console.error('[demo backend]', err)
  return res.status(500).json({ error: 'Something went wrong in the demo. Try again, or reset the demo data.' })
}

function runOne({ method, url, body, form }) {
  return new Promise((resolve) => {
    const u = new URL(url, 'https://demo.local')
    const jar = readJar()
    const headers = {}
    let status = 200
    let done = false
    const finish = (payload, type) => {
      if (done) return
      done = true
      resolve({ status, headers, type: type || headers['Content-Type'] || 'application/json', body: payload })
    }
    const reqHeaders = { 'user-agent': navigator.userAgent, 'x-requested-with': 'swan-staff' }
    const req = {
      method, url: u.pathname + u.search, originalUrl: u.pathname + u.search, path: u.pathname,
      query: Object.fromEntries(u.searchParams.entries()), params: {},
      body: form ? Object.fromEntries([...form.entries()].filter(([, val]) => typeof val === 'string')) : (body === undefined ? {} : JSON.parse(JSON.stringify(body))),
      _form: form || null, cookies: { ...jar }, ip: 'demo-browser',
      get: (name) => reqHeaders[String(name).toLowerCase()],
    }
    const res = {
      status(c) { status = c; return res },
      set(k, val) { if (typeof k === 'object') Object.assign(headers, k); else headers[k] = val; return res },
      setHeader(k, val) { headers[k] = val; return res },
      get(k) { return headers[k] },
      json(obj) { headers['Content-Type'] = 'application/json'; finish(obj === undefined ? null : JSON.parse(JSON.stringify(obj)), 'application/json') },
      send(data) {
        if (data && typeof data === 'object' && !(data instanceof Uint8Array)) return res.json(data)
        finish(data, headers['Content-Type'] || (typeof data === 'string' ? 'text/plain' : 'application/octet-stream'))
      },
      sendStatus(c) { status = c; finish('', 'text/plain') },
      end(data) { finish(data ?? '', headers['Content-Type'] || 'text/plain') },
      cookie(name, val) { const j = readJar(); j[name] = val; writeJar(j); return res },
      clearCookie(name) { const j = readJar(); delete j[name]; writeJar(j); return res },
    }
    try {
      app.handle(req, res, (err) => {
        if (err) errorResponse(err, res)
        else res.status(404).json({ error: 'Not found.' })
      })
    } catch (e) { errorResponse(e, res) }
  })
}

// One request at a time, like a single careful server process.
let queue = Promise.resolve()
export function handle(reqInfo) {
  const p = queue.then(() => start()).then(() => runOne(reqInfo))
  queue = p.catch(() => {})
  return p
}
