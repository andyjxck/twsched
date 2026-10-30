// Printable rota: REAL patched bundle against LOCAL emulators (demo project). Made-up people only.
// Needs: emulators (auth 9741, firestore 8641, project demo-twostep), web copy from two-step/test/prep_web.py on :9061.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8641';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9741';
const M = '';
const req = require('module').createRequire((process.env.RP_MODULES || '/tmp/rpx') + '/');
const { initializeApp } = req('firebase-admin/app');
const { getFirestore } = req('firebase-admin/firestore');
const { getAuth } = req('firebase-admin/auth');
const { chromium, devices } = req('playwright-core');
const fs = require('fs');
initializeApp({ projectId: 'demo-twostep' });
const db = getFirestore();
const auth = getAuth();
const PW = 'Test-pass-12345';
const BASE = 'http://127.0.0.1:9061';
const WEEK = '2026-11-02';
const OUT = process.env.RP_OUT || '/tmp/rpx/out';
fs.mkdirSync(OUT, { recursive: true });
const D = (i) => new Date(Date.UTC(2026, 10, 2 + i)).toISOString().slice(0, 10);
let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  ->  ' + d : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = {};
async function mk(name, role, job) {
  const email = name.split(' ')[0].toLowerCase() + '@example.test';
  const u = await auth.createUser({ email, password: PW, displayName: name });
  await auth.setCustomUserClaims(u.uid, { role });
  await db.doc(`staff/${u.uid}`).set({ name, email, role, active: true, onRota: true, jobTitle: job || '' });
  ids[name] = u.uid;
}
async function sh(name, day, start, end, area, extra = {}) {
  await db.collection('shifts').add({ staffId: name ? ids[name] : '', staffName: name || '', date: D(day), start, end, area, published: true, ...extra });
}

(async () => {
  if (!process.env.RP_NOSEED) {
    await mk('Olly Owner', 'owner', 'Management');
    await mk('Mia Manager', 'manager', 'Bar');
    await mk('Sam Staff', 'staff', 'Bar');
    for (const n of ['Amy Fletcher', 'Ben Carter', 'Chloe Price', 'Dan Hughes', 'Ellie Ward', 'Finn Taylor', 'Grace Lowe', 'Harry Bennett']) await mk(n, 'staff', ['Bar', 'Floor'][n.length % 2]);
    for (const n of ['Jack Morris', 'Kieran Doyle', 'Liam Cooper', 'Megan Hart', 'Nathan Rees']) await mk(n, 'staff', 'Kitchen');
    await mk('Rosie Grant', 'staff', 'Housekeeping');
    await mk('Toby Newman', 'staff', ''); // no job set: grouped by the area he works most
    const foh = ['Mia Manager', 'Sam Staff', 'Amy Fletcher', 'Ben Carter', 'Chloe Price', 'Dan Hughes', 'Ellie Ward', 'Finn Taylor', 'Grace Lowe', 'Harry Bennett'];
    const pat = [['12:00', '18:00'], ['11:00', '23:00'], ['18:00', '23:00'], ['10:00', '15:00'], ['17:30', '23:30']];
    for (let p = 0; p < foh.length; p++) for (let d = 0; d < 7; d++) if ((p + d) % 3 !== 0) {
      const t = pat[(p + d) % pat.length];
      await sh(foh[p], d, t[0], t[1], (p + d) % 4 ? 'Bar' : 'Floor', d === 5 && p === 1 ? { leader: true } : {});
    }
    const kit = ['Jack Morris', 'Kieran Doyle', 'Liam Cooper', 'Megan Hart', 'Nathan Rees'];
    for (let p = 0; p < kit.length; p++) for (let d = 0; d < 7; d++) if ((p + d) % 3 !== 1) {
      const t = [['10:00', '15:00'], ['16:00', '22:00'], ['11:00', '21:00']][(p + d) % 3];
      await sh(kit[p], d, t[0], t[1], 'Kitchen', d === 0 && p === 0 ? { notes: 'Stock' } : d === 2 && p === 3 ? { notes: 'Lines - 3' } : {});
    }
    await sh('Rosie Grant', 0, '09:00', '14:00', 'Housekeeping');
    await sh('Rosie Grant', 2, '09:00', '14:00', 'Housekeeping');
    await sh('Toby Newman', 4, '18:00', '00:30', 'Bar');
    await sh('Toby Newman', 5, '18:00', '01:00', 'Bar');
    await sh('Amy Fletcher', 6, '12:00', '17:00', 'Kitchen'); // FOH person helping in the kitchen
    await sh('', 5, '19:00', '23:00', 'Bar'); // open shift
    await sh('Ben Carter', 6, '09:00', '13:00', 'Bar', { published: false }); // draft
    await db.collection('timeOff').add({ staffId: ids['Chloe Price'], staffName: 'Chloe Price', from: D(2), to: D(2), status: 'approved', type: 'holiday', paid: true, days: 2 });
    await db.collection('timeOff').add({ staffId: ids['Dan Hughes'], staffName: 'Dan Hughes', from: D(0), to: D(0), status: 'approved', type: 'holiday', paid: true, days: 1 }); // clashes with a shift
    await db.doc(`weeks/${WEEK}`).set({ status: 'published', publishedAt: new Date() });
    const ev = [[0, 'Burger night', '17:00'], [1, 'Sweet treat', ''], [2, 'Wings', '17:00'], [3, 'Music bingo', '19:30'], [4, 'Jacko', '20:00'], [6, 'Sunday roast', '12:00']];
    for (const [d, title, start] of ev) await db.collection('events').add({ title, date: D(d), start, end: '', room: '', repeat: 'none' });
  }

  const browser = await chromium.launch({ executablePath: process.env.RP_CHROME });
  const errors = [];
  async function login(email, ctxOpts) {
    const ctx = await browser.newContext(ctxOpts || { viewport: { width: 1400, height: 1000 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(BASE + '/');
    await page.fill('input[type=email]', email);
    await page.fill('input[type=password]', PW);
    await page.click('button:has-text("Sign in")');
    await page.waitForFunction(() => !document.querySelector('input[type=password]'), null, { timeout: 20000 });
    await sleep(1500);
    return page;
  }
  async function openPrint(p) {
    await p.goto(`${BASE}/#/rota?week=${WEEK}`);
    await p.waitForSelector('[data-testid=print-rota]:not([disabled])', { timeout: 20000 });
    await sleep(1500);
    await p.click('[data-testid=print-rota]');
    await p.waitForSelector('[data-testid=rota-print-sheet]');
    await sleep(500);
  }
  const sheetInfo = (p) => p.evaluate(() => {
    const s = document.querySelector('[data-testid=rota-print-sheet]');
    const txt = (q) => [...s.querySelectorAll(q)].map((e) => e.textContent.trim());
    const over = [...s.querySelectorAll('th,td,h1,.evt,.t')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim());
    const rowOf = (name) => { const th = [...s.querySelectorAll('th.nm')].find((e) => e.textContent === name); return th ? [...th.parentNode.children].map((c) => c.textContent.trim()) : null; };
    return {
      h1: s.querySelector('h1').textContent, tables: s.querySelectorAll('table.grid').length, depts: txt('th.dept'), days: txt('table.grid')[0] ? [...s.querySelector('table.grid thead tr').children].slice(1).map((e) => e.textContent) : [],
      names: txt('th.nm'), over, height: s.scrollHeight, font: s.style.fontSize, zoom: s.style.transform || 'none',
      amy: rowOf('Amy Fletcher'), chloe: rowOf('Chloe Price'), dan: rowOf('Dan Hughes'), ben: rowOf('Ben Carter'), jack: rowOf('Jack Morris'), toby: rowOf('Toby Newman'), open: rowOf('Open shift'),
      events: [...s.querySelectorAll('tr.ev')].map((r) => [...r.children].map((c) => c.textContent.trim())),
      text: s.innerText, logo: (s.querySelector('img.logo') || {}).naturalWidth || 0,
    };
  });

  // ---- Owner, desktop, light ----
  let p = await login('olly@example.test');
  await openPrint(p);
  let S = await sheetInfo(p);
  console.log(JSON.stringify({ h1: S.h1, depts: S.depts, days: S.days, font: S.font, zoom: S.zoom, height: S.height }, null, 0));
  check('heading has w/c date', S.h1 === 'Rota w/c Monday 2nd November 2026', S.h1);
  check('day headers Monday 2nd .. Sunday 8th', S.days[0] === 'Monday 2nd' && S.days[6] === 'Sunday 8th', S.days.join(', '));
  check('one table for the whole team, no department sections', S.depts.join('|') === 'Name' && S.tables === 1, S.depts.join('|') + ' x' + S.tables);
  check('everyone listed (page order), open shift last', S.names.includes('Olly Owner') && S.names.includes('Rosie Grant') && S.names.includes('Jack Morris') && S.names[S.names.length - 2] === 'Open shift' && S.names[S.names.length - 1] === 'Events', S.names.join(', '));
  check('Toby (no job) listed', !!S.toby, JSON.stringify(S.toby));
  check('pub-style times', /12\u20136/.test(S.text) && /11\u201311/.test(S.text) && /5:30\u201311:30/.test(S.text) && /6\u201312:30/.test(S.text), '');
  check('holiday shown', S.chloe && S.chloe[3] === 'Holiday' && S.dan && /on holiday/.test(S.dan[1]), JSON.stringify([S.chloe, S.dan]));
  check('draft not printed by default', S.ben && S.ben[7] === '', JSON.stringify(S.ben));
  check('two shifts in one day both shown, no area labels', S.amy && /10\u20133/.test(S.amy[7]) && /12\u20135/.test(S.amy[7]) && !/Kitchen|Bar/.test(S.amy[7]), JSON.stringify(S.amy));
  check('shift note shown', S.jack && /Stock/.test(S.jack[1]), JSON.stringify(S.jack));
  check('open shift row', S.open && /7\u201311/.test(S.open[6]), JSON.stringify(S.open));
  check('events row along the bottom', S.events.length === 1 && S.events[0][0] === 'Events' && S.events[0] && /Burger night/.test(S.events[0][1]) && /Music bingo/.test(S.events[0][4]) && /Sunday roast/.test(S.events[0][7]), JSON.stringify(S.events[0]));
  check('logo loaded', S.logo > 0, String(S.logo));
  check('no clipped text in cells', S.over.length === 0, S.over.join(' | '));
  check('fits one A4 landscape page', S.height <= Math.floor(194 * 96 / 25.4), S.height + 'px at ' + S.font);
  await p.screenshot({ path: OUT + '/preview-desktop.png' });

  // print: one page, nothing else from the app
  await p.emulateMedia({ media: 'print' });
  const vis = await p.evaluate(() => ({ root: getComputedStyle(document.getElementById('root')).display, bar: getComputedStyle(document.querySelector('#tws-rp .tws-rp-bar')).display, sidebar: [...document.querySelectorAll('aside,nav,.sidebar')].filter((e) => e.offsetParent).length }));
  check('print hides app, sidebar and preview buttons', vis.root === 'none' && vis.bar === 'none' && vis.sidebar === 0, JSON.stringify(vis));
  await p.pdf({ path: OUT + '/rota-light.pdf', preferCSSPageSize: true, printBackground: true });
  await p.emulateMedia({ media: 'screen' });

  // drafts toggle
  await p.check('.tws-rp-drafts');
  await sleep(300);
  S = await sheetInfo(p);
  check('drafts included when ticked, marked draft', S.ben && /9\u20131.*draft/.test(S.ben[7]) && /Includes 1 draft shift/.test(S.text), JSON.stringify(S.ben));
  await p.uncheck('.tws-rp-drafts');
  await p.keyboard.press('Escape');
  check('Escape closes preview', (await p.$('#tws-rp')) === null);

  // ---- dark mode ----
  await p.evaluate(() => localStorage.setItem('tws-theme', 'dark'));
  await p.reload();
  await openPrint(p);
  const dark = await p.evaluate(() => ({ theme: document.documentElement.getAttribute('data-theme'), bg: getComputedStyle(document.querySelector('.tws-rp-sheet')).backgroundColor, td: getComputedStyle(document.querySelector('.tws-rp-sheet td.c')).color, nm: getComputedStyle(document.querySelector('.tws-rp-sheet th.nm')).backgroundColor }));
  check('dark mode: sheet stays light', dark.bg === 'rgb(255, 255, 255)' && dark.td === 'rgb(28, 31, 27)', JSON.stringify(dark));
  await p.screenshot({ path: OUT + '/preview-dark.png' });
  await p.emulateMedia({ media: 'print' });
  await p.pdf({ path: OUT + '/rota-dark.pdf', preferCSSPageSize: true, printBackground: true });
  await p.emulateMedia({ media: 'screen' });
  await p.evaluate(() => localStorage.removeItem('tws-theme'));

  // ---- Manager on a phone ----
  const m = await login('mia@example.test', { ...devices['iPhone 13'] });
  await m.goto(`${BASE}/#/rota?week=${WEEK}`);
  await m.waitForSelector('[data-testid=print-rota]:not([disabled])', { timeout: 20000 });
  await sleep(1000);
  const bb = await (await m.$('[data-testid=print-rota]')).boundingBox();
  check('phone: Print button on screen', bb && bb.x >= 0 && bb.x + bb.width <= 390, JSON.stringify(bb));
  await m.screenshot({ path: OUT + '/phone-toolbar.png' });
  await m.click('[data-testid=print-rota]');
  await m.waitForSelector('[data-testid=rota-print-sheet]');
  await sleep(500);
  const ph = await m.evaluate(() => { const w = document.querySelector('#tws-rp .tws-rp-wrap').getBoundingClientRect(); const b = [...document.querySelectorAll('#tws-rp .tws-rp-bar button')].map((x) => x.getBoundingClientRect()); return { wrapW: w.width, vw: innerWidth, buttons: b.map((r) => [Math.round(r.left), Math.round(r.right)]) }; });
  check('phone: preview scaled to fit width, buttons on screen', ph.wrapW <= ph.vw && ph.buttons.every(([l, r]) => l >= 0 && r <= ph.vw), JSON.stringify(ph));
  await m.screenshot({ path: OUT + '/phone-preview.png' });
  await m.emulateMedia({ media: 'print' });
  await m.pdf({ path: OUT + '/rota-phone.pdf', preferCSSPageSize: true, printBackground: true });

  // ---- Staff: no print button ----
  const st = await login('sam@example.test');
  await st.goto(`${BASE}/#/rota?week=${WEEK}`);
  await sleep(3000);
  check('staff rota has no Print button', (await st.$('[data-testid=print-rota]')) === null);

  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
