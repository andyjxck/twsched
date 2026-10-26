// Subtle rota hours warnings: REAL patched bundle against local emulators. Made-up people only.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8611';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9739';
const admin = require('/tmp/rtwfix/functions/node_modules/firebase-admin');
const { chromium, devices } = require('/tmp/pwt/node_modules/playwright-core');
admin.initializeApp({ projectId: 'demo-twsched' });
const db = admin.firestore();
const PW = 'Test-pass-12345';
const BASE = 'http://127.0.0.1:9011';
const WEEK = '2026-11-02';
const D = (i) => new Date(Date.UTC(2026, 10, 2 + i)).toISOString().slice(0, 10);
let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  ->  ' + d : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = {};
async function mk(name, email, role) {
  const u = await admin.auth().createUser({ email, password: PW, displayName: name });
  await admin.auth().setCustomUserClaims(u.uid, { role });
  await db.doc(`staff/${u.uid}`).set({ name, email, role, active: true, onRota: role !== 'payroll' });
  ids[name] = u.uid;
}
async function shift(name, day, start, end, brk, extra = {}) {
  const s = { staffId: ids[name], staffName: name, date: D(day), start, end, published: true, area: 'Kitchen', ...extra };
  if (brk) Object.assign(s, { breakStart: brk[0], breakEnd: brk[1], breakPaid: brk[2] === true });
  await db.collection('shifts').add(s);
}
async function contract(name, data) { await db.doc(`contracts/${ids[name]}`).set({ staffId: ids[name], ...data }); }

(async () => {
  await mk('Olly Owner', 'olly@example.test', 'owner');
  await mk('Mia Manager', 'mia@example.test', 'manager');
  await mk('Sam Staff', 'sam@example.test', 'staff');
  for (const n of ['Ben Over', 'Cat Near', 'Dan Way', 'Eve Under', 'Fay Exact', 'Ivy Fortyeight']) await mk(n, n.split(' ')[0].toLowerCase() + '@example.test', 'staff');
  for (let i = 0; i < 5; i++) await shift('Ben Over', i, '09:00', '19:00', ['13:00', '13:30']); // 47.5
  await shift('Ben Over', 5, '17:00', '18:00'); // 48.5 -> over 48
  await contract('Ben Over', { contractHours: 40 });
  for (let i = 0; i < 5; i++) await shift('Cat Near', i, '09:00', '19:30', ['13:00', '13:30'], { published: i > 1 }); // 50 -> near, 20h draft
  for (let i = 0; i < 5; i++) await shift('Dan Way', i, '09:00', '18:30', ['13:00', '13:30']); // 45
  await shift('Dan Way', 5, '22:00', '06:00'); // 53 -> over 52, Sat no break
  await contract('Eve Under', { contractHours: 30 });
  await shift('Eve Under', 0, '10:00', '16:00'); // 6h exactly, not flagged
  await shift('Eve Under', 1, '10:00', '16:15', ['13:00', '13:15', true]); // short break Tue
  await shift('Eve Under', 3, '09:00', '16:00'); // 7h no break Thu
  await db.collection('timeOff').add({ staffId: ids['Eve Under'], staffName: 'Eve Under', from: D(2), to: D(2), status: 'approved', type: 'holiday', paid: true, days: 1 });
  await contract('Fay Exact', { contractHours: 20 });
  await shift('Fay Exact', 0, '09:00', '16:20', ['12:00', '12:20']);
  await shift('Fay Exact', 1, '09:00', '16:20', ['12:00', '12:20']);
  await shift('Fay Exact', 2, '10:00', '16:00');
  for (let i = 0; i < 6; i++) await shift('Ivy Fortyeight', i, '09:00', '17:00', ['12:00', '12:30', true]); // 48 exactly

  const browser = await chromium.launch();
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
  const bangFor = (p, name) => p.$(`tr[data-person="${ids[name]}"] [data-testid=hours-bang]`);
  const label = async (p, name) => { const b = await bangFor(p, name); return b ? b.getAttribute('aria-label') : null; };

  // ---- Owner, desktop ----
  let p = await login('olly@example.test');
  await p.goto(`${BASE}/#/rota?week=${WEEK}`);
  await p.waitForSelector('[data-testid=hours-bang]', { timeout: 20000 });
  await sleep(1500);
  check('"Hours to check this week" box gone', (await p.$('[data-testid=hours-note]')) === null && !(await p.evaluate(() => document.body.innerText.includes('Hours to check this week'))));
  check('no loud row tags', (await p.$$('.tws-hflag')).length === 0);
  check('no No break / Short break chip tags', (await p.$$('.tws-chipflag')).length === 0);
  check('no red hours total', (await p.$$('table.rota .hrs.over')).length === 0);
  const L = {};
  for (const n of ['Ben Over', 'Cat Near', 'Dan Way', 'Eve Under', 'Fay Exact', 'Ivy Fortyeight', 'Olly Owner']) { L[n] = await label(p, n); console.log('LABEL', n, '=>', L[n]); }
  check('Ben: over 48h', /48\.5h this week, over 48h/.test(L['Ben Over'] || ''));
  check('Ben 40h contract, 48.5h: not under contract', !/Under contract/.test(L['Ben Over'] || ''));
  check('Cat 50h: close to 52h with draft noted', /50h this week \(20h of it draft\), close to 52h/.test(L['Cat Near'] || ''));
  check('Dan 53h: over 52h + 1 no-break shift on Sat', /53h this week, over 52h/.test(L['Dan Way'] || '') && /1 shift over 6h with no break \(Sat\)/.test(L['Dan Way'] || ''));
  check('Eve: under contract with holiday', /Under contract: 25\.25h of 30h, holiday included/.test(L['Eve Under'] || ''), L['Eve Under']);
  check('Eve: Thu no break, Tue short break, 6h exactly not flagged', /1 shift over 6h with no break \(Thu\)/.test(L['Eve Under'] || '') && /1 shift over 6h with a break under 20 min \(Tue\)/.test(L['Eve Under'] || ''));
  check('Fay (exactly at contract, 20-min breaks): no !', L['Fay Exact'] === null);
  check('Ivy (exactly 48h): no !', L['Ivy Fortyeight'] === null);
  check('owner with no shifts: no !', L['Olly Owner'] === null);
  const bangCount = (await p.$$('[data-testid=hours-bang]')).length;
  check('exactly 4 markers (Ben, Cat, Dan, Eve)', bangCount === 4, String(bangCount));
  // Placement: next to the name, small, orange
  const geo = await p.evaluate((id) => {
    const tr = document.querySelector(`tr[data-person="${id}"]`); const b = tr.querySelector('[data-testid=hours-bang]'); const n = tr.querySelector('td.person strong');
    const rb = b.getBoundingClientRect(), rn = n.getBoundingClientRect(); const cs = getComputedStyle(b);
    return { text: b.textContent, sameLine: Math.abs((rb.top + rb.bottom) / 2 - (rn.top + rn.bottom) / 2) < 8, after: rb.left >= rn.right - 1, w: rb.width, h: rb.height, color: cs.color, bg: cs.backgroundColor, fs: cs.fontSize };
  }, ids['Dan Way']);
  console.log('GEO', JSON.stringify(geo));
  check('marker is a small orange "!" right after the name', geo.text === '!' && geo.sameLine && geo.after && geo.w < 20 && geo.color === 'rgb(217, 98, 11)' && /rgba\(0, 0, 0, 0\)|transparent/.test(geo.bg));
  await p.screenshot({ path: '/tmp/subtletest/owner-desktop.png' });

  // Hover shows tooltip
  check('no tooltip before interaction', (await p.$('[data-testid=hours-tip]')) === null);
  await (await bangFor(p, 'Dan Way')).hover();
  await sleep(300);
  let tip = await p.$('[data-testid=hours-tip]');
  const tipTxt = tip ? await tip.innerText() : '';
  check('hover shows plain-words tooltip', /53h this week, over 52h/.test(tipTxt) && /no break \(Sat\)/.test(tipTxt), tipTxt.replace(/\n/g, ' | '));
  const tipVis = await p.evaluate(() => { const t = document.querySelector('[data-testid=hours-tip]'); if (!t) return null; const r = t.getBoundingClientRect(); const el = document.elementFromPoint(r.left + 10, r.top + 10); return { inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, onTop: t.contains(el), role: t.getAttribute('role') }; });
  check('tooltip fully on screen, on top of the grid, role=tooltip', tipVis && tipVis.inView && tipVis.onTop && tipVis.role === 'tooltip', JSON.stringify(tipVis));
  await p.screenshot({ path: '/tmp/subtletest/owner-hover.png' });
  await p.mouse.move(5, 500);
  await sleep(300);
  check('tooltip hides when the mouse leaves', (await p.$('[data-testid=hours-tip]')) === null);

  // Click opens shift editor? Clicking ! must not open anything else / drag
  await (await bangFor(p, 'Ben Over')).click();
  await sleep(300);
  await p.mouse.move(5, 500);
  await sleep(300);
  check('click pins the tooltip open', /48\.5h this week/.test((await p.$('[data-testid=hours-tip]')) ? await p.innerText('[data-testid=hours-tip]') : ''));
  check('click does not open the shift editor', (await p.$('[data-testid=pop-derived]')) === null);
  await p.keyboard.press('Escape');
  await sleep(300);
  check('Escape closes it', (await p.$('[data-testid=hours-tip]')) === null);

  // Keyboard focus
  await p.focus('body');
  let found = false;
  for (let i = 0; i < 80; i++) {
    await p.keyboard.press('Tab');
    const isBang = await p.evaluate(() => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.testid === 'hours-bang');
    if (isBang) { found = true; break; }
  }
  await sleep(300);
  const kbTip = await p.$('[data-testid=hours-tip]');
  check('reachable by Tab and shows tooltip on keyboard focus', found && !!kbTip);
  const desc = await p.evaluate(() => document.activeElement.getAttribute('aria-describedby'));
  check('aria-describedby points at the tooltip', !!desc && !!(await p.$('#' + desc)));
  await p.screenshot({ path: '/tmp/subtletest/owner-keyboard.png' });
  await p.keyboard.press('Tab');
  await sleep(200);
  check('tooltip closes when focus moves on', (await p.$('[data-testid=hours-tip]')) === null);

  // Shift editor hint kept
  const longChip = await p.$(`tr[data-person="${ids['Dan Way']}"] .chip >> nth=5`);
  await longChip.click();
  await p.waitForSelector('[data-testid=pop-nobreak]', { timeout: 8000 }).catch(() => {});
  const popTxt = (await p.$('[data-testid=pop-nobreak]')) ? await p.textContent('[data-testid=pop-nobreak]') : '';
  check('shift editor still has the break hint', /Over 6 hours/.test(popTxt), popTxt);
  check('Paid break box still there', !!(await p.$('[data-testid=break-paid]')));
  await p.keyboard.press('Escape');
  await p.close();

  // ---- Manager sees it too ----
  p = await login('mia@example.test');
  await p.goto(`${BASE}/#/rota?week=${WEEK}`);
  await p.waitForSelector('[data-testid=hours-bang]', { timeout: 20000 });
  await sleep(1000);
  check('manager sees the markers', (await p.$$('[data-testid=hours-bang]')).length >= 3);
  await p.close();

  // ---- Staff doesn't ----
  p = await login('sam@example.test');
  await p.goto(`${BASE}/#/rota?week=${WEEK}`);
  await sleep(4000);
  check('team member sees no markers or warnings', (await p.$$('[data-testid=hours-bang]')).length === 0 && !(await p.evaluate(() => /over 48h|Under contract|Hours to check/i.test(document.body.innerText))));
  await p.close();

  // ---- Owner on a phone ----
  const phone = { ...devices['iPhone 13'] };
  delete phone.defaultBrowserType;
  p = await login('olly@example.test', phone);
  await p.goto(`${BASE}/#/rota?week=${WEEK}`);
  await p.waitForSelector('[data-testid=hours-bang]', { timeout: 20000 });
  await sleep(1500);
  const b = await bangFor(p, 'Eve Under');
  await b.scrollIntoViewIfNeeded();
  await b.tap();
  await sleep(400);
  tip = await p.$('[data-testid=hours-tip]');
  const pt = tip ? await tip.innerText() : '';
  check('phone: tap shows tooltip', /Under contract/.test(pt), pt.replace(/\n/g, ' | '));
  const pv = await p.evaluate(() => { const t = document.querySelector('[data-testid=hours-tip]'); if (!t) return null; const r = t.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; });
  check('phone: tooltip fits on screen', pv === true);
  check('phone: tap does not open the shift editor', (await p.$('[data-testid=pop-derived]')) === null);
  await p.screenshot({ path: '/tmp/subtletest/owner-phone-tip.png' });
  const h1 = await p.$('main h1, h1');
  const hb = h1 ? await h1.boundingBox() : null;
  console.log('tap-away target', hb && JSON.stringify(hb));
  await p.touchscreen.tap(hb ? hb.x + 5 : 200, hb ? hb.y + hb.height / 2 : 120);
  await sleep(400);
  check('phone: tapping elsewhere closes it', (await p.$('[data-testid=hours-tip]')) === null);
  await b.tap(); await sleep(300); await b.tap(); await sleep(300);
  check('phone: tapping ! again closes it', (await p.$('[data-testid=hours-tip]')) === null);
  await p.screenshot({ path: '/tmp/subtletest/owner-phone.png' });
  await p.close();

  check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
