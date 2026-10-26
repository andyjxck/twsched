// "Others on this shift": REAL patched bundle + real othersOnShift function + real rules on local emulators. Made-up people only.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8603';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9731';
const admin = require('/tmp/others/e2e/functions/node_modules/firebase-admin');
const { chromium } = require('/tmp/pwt/node_modules/playwright-core');
admin.initializeApp({ projectId: 'demo-twsched' });
const db = admin.firestore();
const PW = 'Test-pass-12345';
const BASE = 'http://127.0.0.1:8999';
const FN = 'http://127.0.0.1:5523/demo-twsched/europe-west2/othersOnShift';
let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  ->  ' + d : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = {};
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
const add = (ymd, n) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekOf = (ymd) => { const d = new Date(`${ymd}T12:00:00Z`); const w = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - w); return d.toISOString().slice(0, 10); };
const D = add(today, 2), D3 = add(today, 3), D4 = add(today, 4), D5 = add(today, 6);

async function mk(name, email, role, extra = {}) {
  const u = await admin.auth().createUser({ email, password: PW, displayName: name });
  await admin.auth().setCustomUserClaims(u.uid, { role });
  const doc = { name, email, role, active: true, onRota: role !== 'payroll', phone: '07700 900' + Math.floor(Math.random() * 900 + 100), jobTitle: extra.jobTitle || 'Bar' };
  await db.doc(`staff/${u.uid}`).set(doc);
  await db.doc(`directory/${u.uid}`).set({ name, jobTitle: doc.jobTitle, role, active: true, terminated: false, onRota: doc.onRota });
  ids[name] = u.uid;
}
async function shift(name, date, start, end, extra = {}) {
  const staffId = name ? ids[name] : '';
  const r = await db.collection('shifts').add({ staffId, staffName: name || 'Open shift', date, week: weekOf(date), start, end, published: true, area: 'Bar', leader: false, notes: 'secret note', breakStart: '', breakEnd: '', breakPaid: true, ...extra });
  return r.id;
}
async function token(email) {
  const r = await fetch('http://127.0.0.1:9731/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW, returnSecureToken: true }) });
  return (await r.json()).idToken;
}
async function callFn(tok, data) {
  const h = { 'content-type': 'application/json' };
  if (tok) h.authorization = `Bearer ${tok}`;
  const r = await fetch(FN, { method: 'POST', headers: h, body: JSON.stringify({ data }) });
  return r.json();
}

(async () => {
  await mk('Olly Owner', 'olly@example.test', 'owner', { jobTitle: 'Floor' });
  await mk('Mia Manager', 'mia@example.test', 'manager', { jobTitle: 'Floor' });
  await mk('Pat Payroll', 'pat@example.test', 'payroll');
  await mk('Sam Staff', 'sam@example.test', 'staff');
  await mk('Tia Team', 'tia@example.test', 'staff');
  await mk('Ken Kitchen', 'ken@example.test', 'staff', { jobTitle: 'Kitchen' });
  await mk('Dan Draft', 'dan@example.test', 'staff');
  await mk('Ned Night', 'ned@example.test', 'staff');
  await mk('Ella Early', 'ella@example.test', 'staff');

  const samD = await shift('Sam Staff', D, '17:00', '23:00');
  const tiaD = await shift('Tia Team', D, '18:00', '00:00', { leader: true });
  await shift('Ken Kitchen', D, '16:00', '22:00', { area: 'Kitchen' });
  await shift('Olly Owner', D, '20:00', '23:00', { area: 'Floor' });
  await shift('Mia Manager', D, '12:00', '17:00', { area: 'Floor' });          // touches, does not overlap
  const draft = await shift('Dan Draft', D, '19:00', '23:00', { published: false }); // draft
  await shift('', D, '18:00', '22:00');                                         // open shift
  await shift('Ella Early', add(D, -1), '22:00', '02:00');                      // overnight, ends 02:00 on D: no overlap
  const samD3 = await shift('Sam Staff', D3, '20:00', '02:00');                 // overnight
  await shift('Ned Night', D4, '01:00', '05:00', { area: 'Cellar' });           // next morning, overlaps
  await shift('Ella Early', D3, '10:00', '15:00');                              // same day, earlier
  const samD5 = await shift('Sam Staff', D5, '10:00', '14:00');                 // alone
  await db.collection('requests').add({ kind: 'swap', staffId: ids['Sam Staff'], staffName: 'Sam Staff', shiftId: samD5, status: 'pending', message: '' });

  // ---------- server / privacy checks
  const tSam = await token('sam@example.test');
  const r1 = await callFn(tSam, { shiftId: samD });
  const o = (r1.result || {}).others || [];
  check('callable: Sam sees 3 others on his shift', o.length === 3, JSON.stringify(r1));
  check('callable: names = Tia, Ken, Olly (leader first, then by start)', o.map((x) => x.name).join(',') === 'Tia Team,Ken Kitchen,Olly Owner', o.map((x) => x.name).join(','));
  check('callable: only name/area/start/end/leader returned', o.every((x) => Object.keys(x).sort().join(',') === 'area,end,leader,name,start'), JSON.stringify(o));
  check('callable: star only on Tia', o.filter((x) => x.leader).map((x) => x.name).join() === 'Tia Team');
  check('callable: positions + times', JSON.stringify(o.map((x) => [x.area, x.start, x.end])) === JSON.stringify([['Bar', '18:00', '00:00'], ['Kitchen', '16:00', '22:00'], ['Floor', '20:00', '23:00']]), JSON.stringify(o));
  check('callable: no notes, ids, emails or phones in the response', !/secret note|example\.test|07700|staffId/.test(JSON.stringify(r1)));
  const r3 = await callFn(tSam, { shiftId: samD3 });
  check('callable: overnight shift picks up next-morning colleague only', JSON.stringify((r3.result || {}).others) === JSON.stringify([{ name: 'Ned Night', area: 'Cellar', start: '01:00', end: '05:00', leader: false }]), JSON.stringify(r3));
  const r5 = await callFn(tSam, { shiftId: samD5 });
  check('callable: alone -> empty list', Array.isArray((r5.result || {}).others) && r5.result.others.length === 0, JSON.stringify(r5));
  const rT = await callFn(tSam, { shiftId: tiaD });
  check('callable: Sam cannot ask about Tia\'s shift', rT.error && rT.error.status === 'NOT_FOUND', JSON.stringify(rT));
  const tDan = await token('dan@example.test');
  const rDr = await callFn(tDan, { shiftId: draft });
  check('callable: draft shift refused even for its owner', rDr.error && rDr.error.status === 'NOT_FOUND', JSON.stringify(rDr));
  const rP = await callFn(await token('pat@example.test'), { shiftId: samD });
  check('callable: payroll login refused', rP.error && rP.error.status === 'PERMISSION_DENIED', JSON.stringify(rP));
  const rU = await callFn(null, { shiftId: samD });
  check('callable: signed out refused', rU.error && rU.error.status === 'UNAUTHENTICATED', JSON.stringify(rU));
  const rM = await callFn(await token('mia@example.test'), { shiftId: samD });
  check('callable: manager can ask about any published shift', ((rM.result || {}).others || []).length === 3, JSON.stringify(rM));
  const rBad = await callFn(tSam, { shiftId: '../staff/x' });
  check('callable: bad id refused', !!rBad.error, JSON.stringify(rBad));
  // rules unchanged: Sam still cannot read Tia's shift directly
  const fr = await fetch(`http://127.0.0.1:8603/v1/projects/demo-twsched/databases/(default)/documents/shifts/${tiaD}`, { headers: { authorization: `Bearer ${tSam}` } });
  check('rules: Sam still cannot read other people\'s shifts directly', fr.status === 403, String(fr.status));

  // ---------- UI checks
  const browser = await chromium.launch();
  const errors = [];
  async function login(email, vp = { width: 1400, height: 1000 }) {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(email + ': ' + e.message));
    await page.goto(BASE + '/');
    await page.fill('input[type=email]', email);
    await page.fill('input[type=password]', PW);
    await page.click('button:has-text("Sign in")');
    await page.waitForFunction(() => !document.querySelector('input[type=password]') && document.body.innerText.length > 100, null, { timeout: 20000 });
    await sleep(1500);
    return page;
  }
  for (const vp of [{ width: 1400, height: 1000 }, { width: 375, height: 760 }]) {
    const tag = vp.width > 800 ? 'desktop' : 'phone';
    const p = await login('sam@example.test', vp);
    await p.goto(BASE + '/#/rota');
    await p.waitForSelector('[data-testid=my-shift]', { timeout: 20000 });
    await sleep(800);
    const items = p.locator('[data-testid=my-shift]');
    const n = await items.count();
    check(`${tag}: 3 upcoming shifts listed`, n === 3, String(n));
    check(`${tag}: Others button on every upcoming shift`, (await p.locator('[data-testid=others-btn]').count()) === 3);
    check(`${tag}: Swap/Problem still on the 2 shifts without a pending request`, (await p.locator('button:has-text("Swap")').count()) === 2 && (await p.locator('button:has-text("Problem")').count()) === 2);
    const firstBtns = await items.nth(0).locator('.actions button').allInnerTexts();
    check(`${tag}: order Swap, Problem, Others on this shift`, firstBtns.join('|') === 'Swap|Problem|Others on this shift', firstBtns.join('|'));
    await items.nth(0).locator('[data-testid=others-btn]').click();
    await p.waitForSelector('[data-testid=other-on-shift]', { timeout: 15000 });
    const rows = await p.locator('[data-testid=other-on-shift]').allInnerTexts();
    check(`${tag}: sheet lists Tia, Ken, Olly`, rows.length === 3 && /Tia Team/.test(rows[0]) && /Ken Kitchen/.test(rows[1]) && /Olly Owner/.test(rows[2]), JSON.stringify(rows));
    check(`${tag}: rows show position and times`, /Bar · 18:00–00:00/.test(rows[0]) && /Kitchen · 16:00–22:00/.test(rows[1]) && /Floor · 20:00–23:00/.test(rows[2]), JSON.stringify(rows));
    check(`${tag}: one star, on Tia, labelled Team leader`, (await p.locator('[data-testid=other-leader]').count()) === 1 && (await p.locator('[data-testid=other-on-shift]').nth(0).locator('[aria-label="Team leader"]').count()) === 1);
    const sheetText = await p.locator('[data-testid=others-sheet]').innerText();
    check(`${tag}: nothing else in the sheet`, !/Mia|Dan|Open shift|example\.test|07700|secret|£|paid/i.test(sheetText), sheetText.replace(/\n/g, ' / '));
    await p.screenshot({ path: `/tmp/others/e2e/${tag}-sheet.png` });
    const dlg = await p.locator('[role=dialog]').boundingBox();
    check(`${tag}: sheet fits the screen width`, dlg && dlg.x >= 0 && dlg.x + dlg.width <= vp.width + 1, JSON.stringify(dlg));
    await p.keyboard.press('Escape');
    await sleep(400);
    check(`${tag}: Escape closes it`, (await p.locator('[data-testid=others-sheet]').count()) === 0);
    await items.nth(2).locator('[data-testid=others-btn]').click();
    await p.waitForSelector('[data-testid=others-none]', { timeout: 15000 });
    check(`${tag}: alone -> "Nobody else is on this shift."`, (await p.locator('[data-testid=others-none]').innerText()) === 'Nobody else is on this shift.');
    check(`${tag}: pending-swap shift has Others but no Swap/Problem`, (await items.nth(2).locator('.actions button').allInnerTexts()).join('|') === 'Others on this shift');
    await p.click('[role=dialog] button[aria-label=Close]');
    await sleep(300);
    await items.nth(1).locator('button:has-text("Swap")').click();
    await sleep(500);
    check(`${tag}: Swap still opens the swap form`, (await p.locator('[role=dialog][aria-label="Swap or give away shift"]').count()) === 1);
    await p.keyboard.press('Escape');
    if (tag === 'phone') await p.screenshot({ path: '/tmp/others/e2e/phone-list.png', fullPage: true });
    await p.context().close();
  }
  for (const email of ['mia@example.test', 'olly@example.test']) {
    const p = await login(email);
    await p.goto(BASE + '/#/rota');
    await sleep(3000);
    check(`${email}: rota page loads (full rota, no My shifts buttons)`, (await p.locator('[data-testid=others-btn]').count()) === 0 && (await p.locator('body').innerText()).length > 200);
    await p.context().close();
  }
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
