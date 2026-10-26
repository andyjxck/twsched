import express from 'express'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import path from 'node:path'
import fs from 'node:fs'
import { config } from './config.js'
import { migrate } from './migrate.js'
import { loadSession, authRouter, requireUser } from './auth.js'
import { loadVenue } from './access.js'
import { HttpError } from './util.js'
import { rota } from './routes/rota.js'
import { my } from './routes/my.js'
import { inbox, problemThread } from './routes/inbox.js'
import { team } from './routes/team.js'
import { announcements } from './routes/announcements.js'
import { events, publicApi } from './routes/events.js'
import { business } from './routes/business.js'
import { documents, payslips } from './routes/documents.js'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1) // behind one proxy (the host or tunnel), so req.ip and HTTPS are read correctly

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:'],
        'connect-src': ["'self'"],
        'frame-src': ["'self'", 'blob:'],
        'object-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'upgrade-insecure-requests': config.cookieSecure ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.cookieSecure ? { maxAge: 15552000 } : false,
  }))

  app.get('/healthz', (req, res) => res.json({ ok: true }))

  // Public, read-only: published events for the website.
  app.use('/api/public', publicApi)

  app.use('/api', express.json({ limit: '100kb' }), cookieParser())

  // CSRF protection: every request that changes something must carry our custom header and come
  // from our own origin. Another website can't add that header without our permission (CORS).
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
    if (req.get('x-requested-with') !== 'swan-staff') return next(new HttpError(403, 'Request blocked.'))
    const origin = req.get('origin')
    if (origin && new URL(origin).host !== req.get('host')) return next(new HttpError(403, 'Request blocked.'))
    next()
  })
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

  // The app itself (built React files). Every other path gets index.html so links like /invite/... work.
  const dist = path.join(config.root, 'dist')
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, {
      index: false,
      setHeaders: (res, p) => {
        if (p.endsWith('sw.js') || p.endsWith('.webmanifest') || p.endsWith('.html')) res.set('Cache-Control', 'no-cache')
        else if (p.includes(`${path.sep}assets${path.sep}`)) res.set('Cache-Control', 'public, max-age=31536000, immutable')
      },
    }))
    app.get('*', (req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(path.join(dist, 'index.html')) })
  }

  // Errors: readable message for expected ones, nothing internal leaks for the rest.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) })
    if (err?.type === 'entity.too.large' || err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'That file is too big.' })
    if (err?.name === 'MulterError') return res.status(400).json({ error: 'Upload problem: ' + err.message })
    if (err instanceof SyntaxError && err.status === 400) return res.status(400).json({ error: 'Bad request.' })
    console.error(err)
    res.status(500).json({ error: 'Something went wrong on our side. Try again.' })
  })
  return app
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await migrate()
  createApp().listen(config.port, () => console.log(`White Swan staff app on http://localhost:${config.port}`))
}
