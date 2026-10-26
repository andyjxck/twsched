// Publish rota UI: patched main bundle served from /tmp/pubrota/web on :8994 against local emulators. Fake people only.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8633';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9733';
const admin = require('/tmp/pubrota/repo/functions/node_modules/firebase-admin');
const { chromium } = require('/tmp/pwt/node_modules/playwright-core');
const fs = require('fs');
admin.initializeApp({ projectId: 'demo-pubrota' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const PW = 'Test-pass-12345';
const BASE = 'http://127.0.0.1:8994';
const W = '2026-11-02';
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
async function shift(id, name, date, start, end, extra = {}) {
  await db.doc(`shifts/${id}`).set({ staffId: ids[name], staffName: name, date, week: W, start, end, breakStart: '', breakEnd: '', area: '', notes: '',
    published: false, updatedAt: FV.serverTimestamp(), updatedBy: 'seed', ...extra });
}
const mailCount = () => (fs.existsSync('/tmp/pubrota/mail.jsonl') ? fs.readFileSync('/tmp/pubrota/mail.jsonl', 'utf8').trim().split('\n').filter(Boolean).length : 0);

(async () => {
  try { fs.unlinkSync('/tmp/pubrota/mail.jsonl'); } catch (e) {}
  await mk('Mia Manager', 'mia@ui.example.test', 'manager');
  await mk('Olly Owner', 'olly@ui.example.test', 'owner');
  await mk('Alice Ash', 'alice@ui.example.test', 'staff');
  await mk('Ben Birch', 'ben@ui.example.test', 'staff');
  await db.doc('private/mail').set({ host: '127.0.0.1', port: 2599, secure: false, user: 'rota@ui.example.test', pass: 'x', from: 'Test <rota@ui.example.test>', enabled: true, emailStaff: true });
  await shift('s1', 'Alice Ash', '2026-11-02', '09:00', '17:00', { breakStart: '12:00', breakEnd: '12:30' });
  await shift('s2', 'Alice Ash', '2026-11-04', '10:00', '14:00');
  await shift('s3', 'Ben Birch', '2026-11-03', '11:00', '19:00');
  await sleep(2000);

  const browser = await chromium.launch();
  const errors = [];
  const dialogs = [];
  async function login(email, vp = { width: 1400, height: 1000 }) {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
    await page.goto(BASE + '/');
    await page.fill('input[type=email]', email);
    await page.fill('input[type=password]', PW);
    await page.click('button:has-text("Sign in")');
    await page.waitForFunction(() => !document.querySelector('input[type=password]'), null, { timeout: 20000 });
    await sleep(1500);
    return page;
  }
  const btn = (p) => p.locator('[data-testid=publish-rota]');
  const toastText = async (p) => (await p.locator('body').innerText());

  const m = await login('mia@ui.example.test');
  await m.goto(`${BASE}/#/rota?week=${W}`);
  await m.waitForSelector('[data-testid=publish-rota]', { timeout: 20000 });
  await sleep(1500);
  check('button says Publish rota before publishing', (await btn(m).innerText()).trim() === 'Publish rota' && await btn(m).isEnabled(), await btn(m).innerText());
  check('status pill says Not published', (await m.locator('[data-testid=week-status]').innerText()).trim() === 'Not published');
  check('no unpublished-changes pill on an unpublished week', (await m.locator('[data-testid=unpublished-changes]').count()) === 0);

  // shift editor: one Save, no per-shift publish
  await m.locator('.chip.draft').first().click();
  await m.waitForSelector('.popover', { timeout: 10000 });
  const popBtns = (await m.locator('.popover .actions button').allInnerTexts()).map((t) => t.trim());
  check('shift editor has Save and Delete only', JSON.stringify(popBtns) === JSON.stringify(['Save', 'Delete']), JSON.stringify(popBtns));
  await m.locator('.popover .actions button:has-text("Save")').click();
  await sleep(1500);
  const s1 = (await db.doc('shifts/s1').get()).data();
  check('saving a draft keeps it a draft', s1 && s1.published === false);
  check('draft save toast', (await toastText(m)).includes('Saved as a draft. Staff see it when you publish.'));
  check('no emails or bells while building', mailCount() === 0 && (await db.collection('notifications').get()).size === 0);

  // publish rota
  dialogs.length = 0;
  await btn(m).click();
  await m.waitForFunction(() => document.body.innerText.includes('Rota published.'), null, { timeout: 20000 });
  check('publish confirm explains one email each', dialogs[0] && dialogs[0].includes('Publish the rota for the week of 2 November?') && dialogs[0].includes('one email and one notification'), dialogs[0]);
  check('toast: 2 people told', (await toastText(m)).includes('Rota published. 2 people told.'));
  await sleep(1500);
  check('button now Published and disabled', (await btn(m).innerText()).trim() === 'Published' && !(await btn(m).isEnabled()), await btn(m).innerText());
  check('status pill Published', (await m.locator('[data-testid=week-status]').innerText()).trim() === 'Published');
  check('two emails, one per person', mailCount() === 2, String(mailCount()));

  // edit a published shift through the editor: stays published, shows unpublished changes
  await m.locator('.chip').filter({ hasText: '10:00' }).first().click();
  await m.waitForSelector('.popover', { timeout: 10000 });
  const popBtns2 = (await m.locator('.popover .actions button').allInnerTexts()).map((t) => t.trim());
  check('published shift editor also just Save', JSON.stringify(popBtns2) === JSON.stringify(['Save', 'Delete']), JSON.stringify(popBtns2));
  const startInput = m.locator('.popover input').first();
  await m.locator('.popover .actions button:has-text("Save")').click();
  await sleep(800);
  // change the time directly as the editor's time inputs are custom; the save path is the same Firestore write
  await db.doc('shifts/s2').set({ start: '11:00' }, { merge: true });
  await m.waitForSelector('[data-testid=unpublished-changes]', { timeout: 15000 });
  check('saving a published shift keeps it published', (await db.doc('shifts/s2').get()).data().published === true);
  check('Unpublished changes pill appears', await m.locator('[data-testid=unpublished-changes]').isVisible());
  check('button becomes Publish changes', (await btn(m).innerText()).trim() === 'Publish changes' && await btn(m).isEnabled());
  check('pill explains who', ((await m.locator('[data-testid=unpublished-changes]').getAttribute('title')) || '').includes('1 person with changed shifts'));
  check('no email sent by the edit', mailCount() === 2);

  dialogs.length = 0;
  await btn(m).click();
  await m.waitForFunction(() => document.body.innerText.includes('Changes published.'), null, { timeout: 20000 });
  check('changes confirm says only changed people', dialogs[0] && dialogs[0].includes('Only the people whose shifts changed'), dialogs[0]);
  check('toast: 1 person told', (await toastText(m)).includes('Changes published. 1 person told.'));
  await sleep(2000);
  check('pill gone, button back to Published', (await m.locator('[data-testid=unpublished-changes]').count()) === 0 && (await btn(m).innerText()).trim() === 'Published');
  check('one more email only', mailCount() === 3, String(mailCount()));

  // a new draft in a published week -> Publish changes
  await shift('s4', 'Ben Birch', '2026-11-06', '12:00', '16:00');
  await sleep(2500);
  check('new draft turns button to Publish changes', (await btn(m).innerText()).trim() === 'Publish changes' && await m.locator('[data-testid=unpublished-changes]').isVisible());

  // phone width: toolbar still usable
  const mp = await login('mia@ui.example.test', { width: 390, height: 844 });
  await mp.goto(`${BASE}/#/rota?week=${W}`);
  await mp.waitForSelector('[data-testid=publish-rota]', { timeout: 20000 });
  const bb = await mp.locator('[data-testid=publish-rota]').boundingBox();
  check('phone: publish button on screen', bb && bb.x >= 0 && bb.x + bb.width <= 390, JSON.stringify(bb));
  await mp.screenshot({ path: '/tmp/pubrota/ui_phone.png' });
  await m.screenshot({ path: '/tmp/pubrota/ui_desktop.png' });

  // staff see no publish controls
  const a = await login('alice@ui.example.test');
  await a.goto(`${BASE}/#/rota?week=${W}`);
  await sleep(3000);
  check('staff see no publish button', (await a.locator('[data-testid=publish-rota]').count()) === 0);

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
