// Demo only: a tiny in-browser stand-in for Express, so the real server routes in /server run
// unchanged inside the page on GitHub Pages. Supports what those routes use: Router, use/get/post/
// patch/put/delete, :params, mergeParams, next(err), res.json/status/set/send/sendStatus/cookie.

function compile(path, end) {
  const keys = []
  let src = String(path || '/').replace(/\/+$/, '')
  if (src === '' || src === '*') return { re: end && path !== '*' ? /^\/?$/ : /^/, keys, star: path === '*' }
  src = src.replace(/[.+?^${}()|[\]\\]/g, (c) => (c === '(' || c === ')' ? c : '\\' + c))
  src = src.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)' })
  src = src.replace(/\*/g, '.*')
  return { re: new RegExp('^' + src + (end ? '\\/?$' : '(?=\\/|$)'), 'i'), keys }
}

function makeRouter() {
  const stack = []
  function router(req, res, out) { router.handle(req, res, out) }
  const add = (method, end) => (path, ...fns) => {
    if (typeof path === 'function') { fns.unshift(path); path = '/' }
    for (const fn of fns.flat()) stack.push({ method, end, fn, ...compile(path, end) })
    return router
  }
  router.use = add(null, false)
  router.all = add('ALL', true)
  for (const m of ['get', 'post', 'patch', 'put', 'delete', 'options', 'head']) router[m] = add(m.toUpperCase(), true)
  router.handle = (req, res, out) => {
    let i = 0
    const basePath = req.path
    const baseParams = req.params || {}
    const next = (err) => {
      req.path = basePath; req.params = baseParams
      if (err === 'router') return out()
      const layer = stack[i++]
      if (!layer) return out(err)
      if (layer.method && layer.method !== 'ALL' && layer.method !== req.method && !(layer.method === 'GET' && req.method === 'HEAD')) return next(err)
      const mt = layer.re.exec(basePath)
      if (!mt) return next(err)
      const params = { ...baseParams }
      layer.keys.forEach((k, j) => { params[k] = decodeURIComponent(mt[j + 1]) })
      req.params = params
      if (!layer.method) { const rest = basePath.slice(mt[0].length); req.path = rest.startsWith('/') ? rest : '/' + rest }
      const isErrHandler = layer.fn.length === 4
      try {
        if (err) { if (isErrHandler) return layer.fn(err, req, res, next); return next(err) }
        if (isErrHandler) return next()
        const r = layer.fn(req, res, next)
        if (r && typeof r.catch === 'function') r.catch(next)
      } catch (e) { next(e) }
    }
    next()
  }
  return router
}

function express() { return makeRouter() }
express.Router = () => makeRouter()
express.json = () => (req, res, next) => next()
express.static = () => (req, res, next) => next()
export const Router = express.Router
export default express
