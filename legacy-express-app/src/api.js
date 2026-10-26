// All calls go to our own server. The session lives in an httpOnly cookie the page can't read;
// the custom header is part of the server's CSRF protection.
// The GitHub Pages demo (VITE_DEMO) has no server: the same server routes run inside the page.
export const DEMO = import.meta.env.VITE_DEMO === '1'
export const HASH_ROUTES = DEMO
// Full address of an app page, e.g. an invite link.
export const pageUrl = (p) => (HASH_ROUTES ? location.origin + import.meta.env.BASE_URL + '#' + p : location.origin + p)

async function demoRequest(method, url, body, isForm) {
  const { handle, hasSession, start } = await import('./demoBackend.js')
  // Show the sign-in screen straight away while the in-browser database starts up behind it.
  if (method === 'GET' && url === '/api/auth/me' && !hasSession()) { start().catch(() => {}); throw new ApiError('Please sign in.', 401) }
  let r
  try { r = await handle({ method, url, body: isForm ? undefined : body, form: isForm ? body : null }) } catch { throw new ApiError('The demo could not start in this browser. Try reloading.', 0) }
  if (r.status >= 400) throw new ApiError((r.body && r.body.error) || `Error ${r.status}`, r.status)
  return r.body
}

async function request(method, url, body, isForm = false) {
  if (DEMO) return demoRequest(method, url, body, isForm)
  const opts = { method, credentials: 'same-origin', headers: { 'X-Requested-With': 'swan-staff' } }
  if (body !== undefined) {
    if (isForm) opts.body = body
    else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body) }
  }
  let res
  try { res = await fetch(url, opts) } catch { throw new ApiError('No connection. Check your signal and try again.', 0) }
  const type = res.headers.get('content-type') || ''
  const data = type.includes('application/json') ? await res.json() : await res.text()
  if (!res.ok) throw new ApiError((data && data.error) || `Error ${res.status}`, res.status)
  return data
}
export class ApiError extends Error { constructor(m, status) { super(m); this.status = status } }

export const api = {
  get: (u) => request('GET', u),
  post: (u, b = {}) => request('POST', u, b),
  patch: (u, b) => request('PATCH', u, b),
  del: (u) => request('DELETE', u),
  upload: (u, form) => request('POST', u, form, true),
}

// Venue-scoped URL helper: v('/rota') -> /api/v/1/rota
let venueId = null
export const setVenue = (id) => { venueId = id }
export const v = (path) => `/api/v/${venueId}${path}`
