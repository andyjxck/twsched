// Developer login hidden from everyone but owners: REAL patched bundle + REAL firestore.rules on LOCAL
// emulators (project demo-twostep). Made-up people only. The fixture has a developer record shaped like
// the live one (role owner, developer: true, onRota: true) and proves it never shows outside the owner's
// Team page, while an ordinary team member with onRota: false still shows.
// Needs: emulators (auth 9741, firestore 8641) with this repo's firestore.rules, and a web copy from
// tools/two-step/test/prep_web.py served on :9061.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8641';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9741';
const req = require('module').createRequire((process.env.RP_MODULES || '/tmp/rpx') + '/');
const { initializeApp } = req('firebase-admin/app');
const { getFirestore } = req('firebase-admin/firestore');
const { getAuth } = req('firebase-admin/auth');
const { chromium } = req('playwright-core');
initializeApp({ projectId: 'demo-twostep' });
const db = getFirestore();
const auth = getAuth();
const PW = 'Test-pass-12345';
const BASE = 'http://127.0.0.1:9061';
const DEV = 'Andy (developer)';
const WEEK = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
const D = (i) => { const d = new Date(WEEK + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); };
let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  ->  ' + d : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = {};
async function mk(name, role, extra = {}) {
  const email = name.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '') + (extra.developer ? '.dev' : '') + '@example.test';
  const u = await auth.createUser({ email, password: PW, displayName: name });
  await auth.setCustomUserClaims(u.uid, { role });
  const rec = { name, email, role, active: true, onRota: true, jobTitle: 'Bar', developer: false, ...extra };
  await db.doc(`staff/${u.uid}`).set(rec);
  if (!rec.developer) await db.doc(`directory/${u.uid}`).set({ name, role, jobTitle: rec.jobTitle, active: true });
  ids[name] = u.uid;
}

(async () => {
  if (!process.env.RP_NOSEED) {
    await mk('Olly Owner', 'owner');
    await mk('Mia Manager', 'manager');
    await mk('Pat Payroll', 'payroll', { onRota: false });
    await mk('Sam Staff', 'staff');
    await mk('Nora Norota', 'staff', { onRota: false }); // ordinary onRota:false still shows
    await mk(DEV, 'owner', { developer: true, jobTitle: '' }); // like the live record
    for (const [n, d] of [['Sam Staff', 0], ['Sam Staff', 2], ['Mia Manager', 1], ['Nora Norota', 3]])
      await db.collection('shifts').add({ staffId: ids[n], staffName: n, date: D(d), start: '12:00', end: '18:00', area: 'Bar', published: true });
    await db.doc(`weeks/${WEEK}`).set({ status: 'published', publishedAt: new Date() });
  } else for (const d of (await db.collection('staff').get()).docs) ids[d.get('name')] = d.id;

  const browser = await chromium.launch({ executablePath: process.env.RP_CHROME });
  const errors = [];
  async function login(email) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(email + ': ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && /permission|insufficient/i.test(m.text())) errors.push(email + ' console: ' + m.text().slice(0, 200)); });
    page.on('dialog', (d) => d.accept());
    await page.goto(BASE + '/');
    await page.fill('input[type=email]', email);
    await page.fill('input[type=password]', PW);
    await page.click('button:has-text("Sign in")');
    await page.waitForFunction(() => !document.querySelector('input[type=password]'), null, { timeout: 20000 });
    await sleep(2000);
    return page;
  }
  const routes = (p) => p.evaluate(() => [...new Set([...document.querySelectorAll('a[href^="#/"]')].map((a) => a.getAttribute('href').split('?')[0]))]);
  async function sweep(p, who, allow = []) {
    const rs = await routes(p);
    const seen = [];
    for (const r of rs) {
      await p.goto(BASE + '/' + r);
      await sleep(1800);
      const t = await p.evaluate(() => document.body.innerText + ' ' + [...document.querySelectorAll('option')].map((o) => o.textContent).join(' '));
      if (/Andy \(developer\)|maintenance login/i.test(t) && !allow.includes(r)) seen.push(r);
    }
    check(`${who}: developer login on none of ${rs.length} pages${allow.length ? ' (except ' + allow.join(', ') + ')' : ''}`, seen.length === 0, seen.join(', ') || rs.join(' '));
    return rs;
  }
  async function rotaNames(p) {
    await p.goto(`${BASE}/#/rota?week=${WEEK}`);
    await p.waitForSelector('[data-testid=print-rota]:not([disabled]), table', { timeout: 20000 }).catch(() => {});
    await sleep(2000);
    return p.evaluate(() => document.body.innerText);
  }
  async function printNames(p) {
    await p.click('[data-testid=print-rota]');
    await p.waitForSelector('[data-testid=rota-print-sheet]');
    await sleep(500);
    const n = await p.evaluate(() => [...document.querySelectorAll('[data-testid=rota-print-sheet] th.nm')].map((e) => e.textContent.trim()));
    await p.keyboard.press('Escape');
    return n;
  }
  // straight to Firestore with the signed-in user's own credentials (the app's SDK)
  const raw = (p, devUid) => p.evaluate(async (devUid) => {
    const w = window.__tws;
    const once = (ref) => new Promise((res) => { const u = w.onSnapshot(ref, { includeMetadataChanges: true }, (s) => { if (s.metadata.fromCache) return; u(); res(s.docs ? 'ok:' + s.docs.map((d) => d.data().name).join('|') : 'ok:' + (s.exists() ? s.data().name : 'none')); }, (e) => res('denied:' + e.code)); });
    return {
      devDoc: await once(w.doc(w.db, 'staff', devUid)),
      allStaff: await once(w.query(w.collection(w.db, 'staff'))),
      filtered: await once(w.query(w.collection(w.db, 'staff'), w.where('developer', '==', false))),
      directory: await once(w.query(w.collection(w.db, 'directory'))),
    };
  }, devUid);

  // ---- Owner ----
  let p = await login('olly@example.test');
  let t = await rotaNames(p);
  check('owner Rota: no developer', !t.includes(DEV) && t.includes('Sam Staff') && t.includes('Nora Norota'), '');
  let names = await printNames(p);
  check('owner printed rota: no developer, onRota:false member still listed', !names.includes(DEV) && names.includes('Nora Norota') && names.includes('Olly Owner'), names.join(', '));
  await p.goto(BASE + '/#/team');
  await sleep(2000);
  const team = await p.evaluate(() => ({ text: document.body.innerText, pill: (document.querySelector('[data-testid=dev-pill]') || {}).textContent || '' }));
  check('owner Team: developer listed and marked as the maintenance login', team.text.includes(DEV) && /Developer maintenance login\. Only owners can see it/.test(team.pill), team.pill);
  await sweep(p, 'owner', ['#/team']);
  let R = await raw(p, ids[DEV]);
  check('owner can read the developer record', R.devDoc === 'ok:' + DEV, R.devDoc);
  check('directory never holds it', !R.directory.includes(DEV), R.directory);

  // ---- Manager ----
  p = await login('mia@example.test');
  t = await rotaNames(p);
  check('manager Rota: staff load, no developer', !t.includes(DEV) && t.includes('Sam Staff') && t.includes('Nora Norota') && t.includes('Olly Owner'), '');
  names = await printNames(p);
  check('manager printed rota: no developer', !names.includes(DEV) && names.includes('Nora Norota') && names.includes('Olly Owner'), names.join(', '));
  await p.goto(BASE + '/#/team');
  await sleep(2000);
  t = await p.evaluate(() => document.body.innerText);
  check('manager Team: everyone else listed, developer not', !t.includes(DEV) && t.includes('Olly Owner') && t.includes('Pat Payroll') && t.includes('Nora Norota') && !/maintenance login/i.test(t), '');
  await sweep(p, 'manager');
  R = await raw(p, ids[DEV]);
  check('rules: manager refused the developer record', R.devDoc.startsWith('denied'), R.devDoc);
  check('rules: manager refused an unfiltered staff query', R.allStaff.startsWith('denied'), R.allStaff);
  check('rules: manager filtered query returns everyone else', R.filtered.startsWith('ok:') && !R.filtered.includes(DEV) && R.filtered.split('|').length === 5, R.filtered);

  // ---- Payroll ----
  p = await login('pat@example.test');
  await sweep(p, 'payroll');
  let tt = [];
  for (const r of ['#/', '#/holidays', '#/payslips']) { await p.goto(BASE + '/' + r); await sleep(3000); tt.push(await p.evaluate(() => document.body.innerText + ' ' + [...document.querySelectorAll('option')].map((o) => o.textContent).join(' '))); }
  t = tt.join(' ');
  check('payroll pages load staff, no developer', !t.includes(DEV) && t.includes('Sam Staff'), tt.map((x) => x.slice(200, 600).replace(/\n/g, ' ')).join(' || '));
  R = await raw(p, ids[DEV]);
  check('rules: payroll refused the developer record and unfiltered query', R.devDoc.startsWith('denied') && R.allStaff.startsWith('denied'), R.devDoc + ' / ' + R.allStaff);
  check('rules: payroll filtered query works', R.filtered.startsWith('ok:') && !R.filtered.includes(DEV), R.filtered);

  // ---- Team member ----
  p = await login('sam@example.test');
  t = await rotaNames(p);
  check('team member Rota: no developer', !t.includes(DEV), t.slice(0, 400).replace(/\n/g, ' '));
  await sweep(p, 'team member');
  R = await raw(p, ids[DEV]);
  check('rules: team member refused the developer record', R.devDoc.startsWith('denied'), R.devDoc);

  check('no page errors or permission errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
