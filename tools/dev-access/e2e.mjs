// Browser check of the developer flow against local emulators with FAKE people only.
// The app copy in /tmp/tws-e2e talks to the Firestore emulator; Playwright reroutes Auth and the callables
// to the emulators and blocks every other Google request, so nothing reaches the live project.
// Mail goes to a local SMTP sink (no real email).
import { createRequire } from 'node:module'
import fs from 'node:fs'
import net from 'node:net'
import http from 'node:http'
import path from 'node:path'
const require = createRequire(import.meta.url)
const { chromium } = require('/tmp/rpx/node_modules/playwright-core')
const admin = require(path.resolve(process.env.HOME+'/tws-devaccess/functions/node_modules/firebase-admin'))
admin.initializeApp({ projectId: 'twsched-f8b16' })
const db = admin.firestore()
const OUT = '/tmp/tws-e2e-shots'; fs.mkdirSync(OUT, { recursive: true })

// SMTP sink
const mails = []
net.createServer((c) => {
  let data = false, buf = ''
  c.write('220 sink\r\n')
  c.on('data', (d) => {
    for (const line of d.toString().split('\r\n')) {
      if (data) { if (line === '.') { data = false; mails.push(buf); buf = ''; c.write('250 ok\r\n') } else buf += line + '\n'; continue }
      if (!line) continue
      const cmd = line.slice(0, 4).toUpperCase()
      if (cmd === 'EHLO') c.write('250-sink\r\n250 AUTH PLAIN LOGIN\r\n')
      else if (cmd === 'AUTH') c.write('235 ok\r\n')
      else if (cmd === 'DATA') { data = true; c.write('354 go\r\n') }
      else if (cmd === 'QUIT') { c.write('221 bye\r\n'); c.end() }
      else c.write('250 ok\r\n')
    }
  })
}).listen(2525)

// static server for the app copy
const ROOT = '/tmp/tws-e2e'
http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'
  const f = path.join(ROOT, p)
  if (!fs.existsSync(f)) { r.writeHead(404); return r.end() }
  const ext = path.extname(f); r.writeHead(200, { 'Content-Type': { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' }[ext] || 'application/octet-stream' })
  fs.createReadStream(f).pipe(r)
}).listen(5055)

// fake people
const people = [['owner1', 'owner@example.test', 'owner', 'Olive Owner (fake)'], ['dev1', 'dev@example.test', 'developer', 'Andy (developer, fake)'], ['staffA', 'staffa@example.test', 'staff', 'Sam Secretname (fake)']]
for (const [uid, email, role, name] of people) {
  await admin.auth().createUser({ uid, email, password: 'Fake-pass-123' })
  await admin.auth().setCustomUserClaims(uid, { role })
  await db.doc(`staff/${uid}`).set({ name, email, role, developer: role === 'developer', active: true, phone: '07000 FAKE 99', rate: 12.34 })
}
await db.doc('private/mail').set({ host: '127.0.0.1', port: 2525, secure: false, user: 'fake', pass: 'fake', from: 'noreply@tws-rota.co.uk' })

const blocked = []
const browser = await chromium.launch({ executablePath: fs.readdirSync(process.env.HOME + '/.cache/ms-playwright').filter((d) => d.startsWith('chromium-')).map((d) => `${process.env.HOME}/.cache/ms-playwright/${d}/chrome-linux64/chrome`).find((p) => fs.existsSync(p)) })
async function session() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url())
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return route.continue()
    let to = null
    if (u.hostname === 'identitytoolkit.googleapis.com' || u.hostname === 'securetoken.googleapis.com') to = `http://127.0.0.1:9099/${u.hostname}${u.pathname}${u.search}`
    if (u.hostname === 'europe-west2-twsched-f8b16.cloudfunctions.net') to = `http://127.0.0.1:5001/twsched-f8b16/europe-west2${u.pathname}`
    if (/fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) return route.continue()
    if (!to) { blocked.push(u.hostname); return route.abort() }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
    const res = await fetch(to, { method: route.request().method(), headers: route.request().headers(), body: route.request().postDataBuffer() || undefined })
    const h = Object.fromEntries(res.headers); h['access-control-allow-origin'] = '*'
    return route.fulfill({ status: res.status, headers: h, body: Buffer.from(await res.arrayBuffer()) })
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
  return { ctx, page, errors }
}
async function signIn(page, email) {
  await page.goto('http://127.0.0.1:5055/')
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', 'Fake-pass-123')
  await page.locator('button[type=submit], form button').first().click()
  await page.waitForTimeout(4000)
}
const res = []
const check = (n, c, x) => { res.push(`${c ? 'PASS' : 'FAIL'} ${n}${c ? '' : ' ' + (x || '')}`) }
const SECRET = /Sam Secretname|Olive Owner|07000 FAKE|12\.34/

// 1. developer, no grant
const D = await session()
await signIn(D.page, 'dev@example.test')
let body = await D.page.innerText('body')
check('developer (no grant) sees redaction page', /Staff information is blacked out/.test(body), body.slice(0, 200))
check('developer (no grant) sees no fake staff details', !SECRET.test(body))
check('no Give access / code request control for developer', await D.page.locator('[data-testid=give-access]').count() === 0)
await D.page.screenshot({ path: `${OUT}/1-dev-redacted.png` })
await D.page.goto('http://127.0.0.1:5055/#/team'); await D.page.waitForTimeout(1500)
body = await D.page.innerText('body')
check('developer Team page also redacted', /blacked out/.test(body) && !SECRET.test(body))
await D.page.screenshot({ path: `${OUT}/2-dev-team-redacted.png` })

// 2. owner gives access
const O = await session()
await signIn(O.page, 'owner@example.test')
await O.page.goto('http://127.0.0.1:5055/#/team'); await O.page.waitForTimeout(2500)
const give = O.page.locator('[data-testid=give-access]')
check('owner sees Give access on the developer row', await give.count() === 1)
await give.click(); await O.page.waitForTimeout(5000)
body = await O.page.innerText('body')
check('owner told code emailed', /Code emailed/.test(body), body.match(/.{0,80}(code|Code).{0,80}/)?.[0])
await O.page.screenshot({ path: `${OUT}/3-owner-give-access.png` })
const m = mails.find((x) => /dev@example\.test/.test(x))
const code = m && (m.replace(/=\r?\n/g, '').match(/Your code: (\d{8})/) || [])[1]
check('code email sent to developer address from noreply', !!code && /noreply@tws-rota\.co\.uk/.test(m))

// 3. developer enters wrong then right code
await D.page.goto('http://127.0.0.1:5055/#/'); await D.page.waitForTimeout(1500)
await D.page.fill('input[aria-label="Access code"]', code === '00000000' ? '11111111' : '00000000')
await D.page.click('text=Enter code'); await D.page.waitForTimeout(3000)
body = await D.page.innerText('body')
check('wrong code refused with tries left', /isn.t right. 4 tries left/.test(body), body.match(/.{0,80}tr(y|ies).{0,40}/)?.[0])
await D.page.fill('input[aria-label="Access code"]', code)
await D.page.click('text=Enter code'); await D.page.waitForTimeout(7000)
await D.page.goto('http://127.0.0.1:5055/#/team'); await D.page.waitForTimeout(4000)
body = await D.page.innerText('body')
check('developer with grant sees access banner', /Developer access from Olive Owner/.test(body), body.slice(0, 200))
check('developer with grant sees staff (fake) on Team', /Sam Secretname/.test(body))
check('developer with grant still has no Give access button', await D.page.locator('[data-testid=give-access]').count() === 0)
await D.page.screenshot({ path: `${OUT}/4-dev-granted-team.png` })
check('owners emailed when code used', mails.some((x) => /owner@example\.test/.test(x) && /Developer access is now on/.test(x)))

// 4. owner ends early -> developer back to redaction live
await O.page.reload(); await O.page.waitForTimeout(3000)
await O.page.click('text=End access'); await O.page.waitForTimeout(4000)
await O.page.click('text=Access log').catch(() => {}); await O.page.waitForTimeout(800)
body = await O.page.innerText('body')
check('owner sees log: ended early by owner', /Ended early by Olive Owner/.test(body))
await O.page.screenshot({ path: `${OUT}/5-owner-log.png` })
await D.page.waitForTimeout(3000)
body = await D.page.innerText('body')
check('developer switched back to redaction without reload', /blacked out/.test(body) && !SECRET.test(body), body.slice(0, 200))
await D.page.screenshot({ path: `${OUT}/6-dev-after-end.png` })

// 5. expiry: grant whose expiresAt passes
await db.doc('devAccess/expTest').set({ devUid: 'dev1', status: 'active', expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 8000), grantedByName: 'Olive Owner (fake)' })
const u = await admin.auth().getUser('dev1'); await admin.auth().setCustomUserClaims('dev1', { ...u.customClaims, devGrant: 'expTest' })
await D.page.evaluate(async () => {}).catch(() => {})
await D.page.reload(); await D.page.waitForTimeout(3000)
body = await D.page.innerText('body')
const sawGrant = /Developer access from/.test(body)
await D.page.waitForTimeout(9000)
body = await D.page.innerText('body')
check('short grant shows, then switches to redaction at expiry by itself', sawGrant && /blacked out/.test(body) && !SECRET.test(body), `sawGrant=${sawGrant}`)

console.log(res.join('\n'))
console.log('blocked non-emulator hosts:', [...new Set(blocked)].join(', ') || 'none')
console.log('developer console errors:', D.errors.length, D.errors.slice(0, 5).join(' | '))
console.log('owner console errors:', O.errors.length, O.errors.slice(0, 5).join(' | '))
await browser.close()
process.exit(res.some((r) => r.startsWith('FAIL')) ? 1 : 0)
