// Merged Inbox: browser test of the REAL patched bundle against local emulators.
// Fake people only (project demo-twsched). Nothing touches the live site.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8493';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9713';
const admin = require('/tmp/rtwfix/functions/node_modules/firebase-admin');
const { chromium } = require('/tmp/pwt/node_modules/playwright-core');
admin.initializeApp({ projectId: 'demo-twsched' });
const db = admin.firestore();
const TS = admin.firestore.Timestamp;
const PW = 'Test-pass-12345';
const BASE = 'http://127.0.0.1:8913';
let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  ->  ' + d : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = {};
const ago = (min) => TS.fromMillis(Date.now() - min * 60000);
async function mk(name, email, role) {
  const u = await admin.auth().createUser({ email, password: PW, displayName: name });
  await admin.auth().setCustomUserClaims(u.uid, { role });
  await db.doc(`staff/${u.uid}`).set({ name, email, role, active: true, onRota: true });
  ids[name] = u.uid;
}
const note = (uid, title, o = {}) => db.collection('notifications').add({ uid, title, body: o.body || '', link: o.link || '#/', managerOnly: !!o.managerOnly, read: !!o.read, createdAt: ago(o.min || 5) });

(async () => {
  await mk('Olly Owner', 'olly@example.test', 'owner');
  await mk('Mia Manager', 'mia@example.test', 'manager');
  await mk('Sam Staff', 'sam@example.test', 'staff');
  await mk('Joe Payroll', 'joe@example.test', 'payroll');
  const S = ids['Sam Staff'], M = ids['Mia Manager'], J = ids['Joe Payroll'];
  await db.collection('timeOff').add({ staffId: S, staffName: 'Sam Staff', from: '2026-11-20', to: '2026-11-21', status: 'pending', paid: true, reason: 'Wedding', createdAt: ago(30) });
  await db.collection('timeOff').add({ staffId: S, staffName: 'Sam Staff', from: '2026-11-02', to: '2026-11-02', status: 'approved', paid: true, reason: 'Dentist', decidedByName: 'Olly Owner', decidedAt: ago(100), createdAt: ago(300) });
  await db.collection('requests').add({ staffId: S, staffName: 'Sam Staff', kind: 'problem', shiftLabel: 'Sat 31 Oct 17:00-23:00', message: 'Bus strike', status: 'pending', createdAt: ago(10) });
  const E1 = await db.collection('enquiries').add({ name: 'Jane Partyhost', email: 'jane@example.test', phone: '07700 900123', occasion: 'Birthday', space: 'Garden room', date: '2026-12-12', guests: 40, message: 'Hi, we would love to book the garden room for a 40th birthday. '.repeat(4) + 'END-OF-MESSAGE', status: 'new', createdAt: ago(3) });
  await db.collection('enquiries').add({ name: 'Bob Replied', email: 'bob@example.test', occasion: 'Wake', date: '2026-11-15', guests: 25, message: 'Short note', status: 'replied', createdAt: ago(60) });
  await db.collection('enquiries').add({ name: 'Cara Booked', email: 'cara@example.test', occasion: 'Wedding', date: '2027-06-01', guests: 90, message: 'Old one', status: 'booked', handledAt: ago(500), createdAt: ago(900) });
  await note(M, 'Time off request', { link: '#/inbox', body: 'Sam Staff: 20 Nov', min: 30 });
  await note(M, 'New private hire enquiry', { link: '#/enquiries', managerOnly: true, body: 'Jane', min: 3 });
  await note(M, 'Shift changed', { link: '#/', body: 'Sat is now 18:00-23:00', min: 8 });
  await note(M, 'Rota for week of 2 Nov is out', { read: true, link: '#/rota', min: 200 });
  await note(S, 'Holiday approved', { link: '#/inbox', body: '2 Nov (paid)', min: 100 });
  await note(S, 'New private hire enquiry', { link: '#/enquiries', managerOnly: true, min: 3 });
  await note(J, 'Payroll cut-off in 2 days', { link: '#/payroll', body: 'Hours due Wed', min: 20 });

  const browser = await chromium.launch();
  const errors = [];
  async function login(email, path = '/', vp = { width: 1400, height: 1000 }) {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(email + ': ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && /permission|denied|FirebaseError/i.test(m.text())) errors.push(email + ' console: ' + m.text().slice(0, 200)); });
    page.on('dialog', (d) => d.accept());
    await page.goto(BASE + path);
    await page.fill('input[type=email]', email);
    await page.fill('input[type=password]', PW);
    await page.click('button:has-text("Sign in")');
    await page.waitForSelector('main', { timeout: 20000 });
    await sleep(1800);
    return page;
  }
  async function go(page, hash) { await page.evaluate((h) => { location.hash = h; }, hash); await sleep(1500); }
  const mainText = (page) => page.evaluate(() => (document.querySelector('main') || document.body).innerText);
  const navLabels = (page) => page.evaluate(() => [...document.querySelectorAll('#sidemenu a')].map((a) => a.innerText.replace(/\s+/g, ' ').trim()));
  const hash = (page) => page.evaluate(() => location.hash);

  // Baseline: old bundle has separate entries
  let p = await login('mia@example.test', '/before.html');
  let nav = await navLabels(p);
  check('baseline (old bundle): manager sidebar has Enquiries and Notifications', nav.some((t) => t.startsWith('Enquiries')) && nav.some((t) => t.startsWith('Notifications')), nav.join(' | '));
  await p.context().close();
  // reset pointer reads that the old bundle could not have changed anyway

  // ---------- Manager, desktop ----------
  p = await login('mia@example.test', '/');
  nav = await navLabels(p);
  check('manager sidebar: no Enquiries entry', !nav.some((t) => t.startsWith('Enquiries')), nav.join(' | '));
  check('manager sidebar: no Notifications entry', !nav.some((t) => t.startsWith('Notifications')));
  const inboxNav = nav.find((t) => t.startsWith('Inbox')) || '';
  check('manager sidebar: one Inbox with combined badge 5 (2 requests + 2 open enquiries + 1 update)', /^Inbox 5\b/.test(inboxNav), inboxNav);
  const homeLinks = await p.evaluate(() => [...document.querySelectorAll('.todos a')].map((a) => a.getAttribute('href') + ' ' + a.innerText.replace(/\s+/g, ' ')));
  check('Home: enquiries card links to Inbox enquiries filter and counts open ones (2)', homeLinks.some((h) => h.startsWith('#/inbox?f=enquiries') && /\b2\b/.test(h)), homeLinks.join(' | '));
  check('Home: requests card links to Inbox requests filter', homeLinks.some((h) => h.startsWith('#/inbox?f=requests')));
  const seeAll = await p.evaluate(() => { const a = document.querySelector('.block-news .morelink'); return a && a.getAttribute('href'); });
  check('Home: Latest updates "See all" goes to Inbox updates', seeAll === '#/inbox?f=updates', seeAll);

  await go(p, '#/inbox');
  let t = await mainText(p);
  const chips = await p.evaluate(() => [...document.querySelectorAll('.ibx-chip')].map((b) => b.innerText.replace(/\s+/g, ' ').trim()));
  check('chips All / Requests / Enquiries / Updates', chips.length === 4 && chips[0].startsWith('All') && chips[1].startsWith('Requests') && chips[2].startsWith('Enquiries') && chips[3].startsWith('Updates'), chips.join(' | '));
  check('All shows requests and enquiries together', t.includes('Jane Partyhost') && t.includes('Bob Replied') && t.includes('Bus strike') && t.includes('Wedding'));
  check('All: requests keep Approve/Decline and Mark sorted', (await p.locator('button:has-text("Approve")').count()) === 1 && (await p.locator('button:has-text("Mark sorted")').count()) === 1);
  check('All: Updates section shows the update', t.includes('Shift changed'));
  check('Updates hide the duplicate "Time off request"/"New private hire enquiry" alerts', !/Time off request|New private hire enquiry/.test(t));
  check('No booked/cancel status buttons in the main view', (await p.locator('.ibx button:has-text("Booked"), .ibx button:has-text("Closed"), .ibx button:has-text("Replied")').count()) === 0);
  const enq = p.locator('[data-testid=ibx-enquiry]', { hasText: 'Jane Partyhost' });
  const hrefs = await enq.evaluate((el) => [...el.querySelectorAll('a')].map((a) => a.getAttribute('href')));
  check('Enquiry card: email and phone links', hrefs.some((h) => h.startsWith('mailto:jane@example.test?subject=')) && hrefs.includes('tel:07700900123'), hrefs.join(' '));
  const what = await enq.locator('.req-what').innerText();
  check('Enquiry card: date, guests, space in one line', /12 Dec 2026/.test(what) && what.includes('40 guests') && what.includes('Garden room'), what);
  check('Enquiry card: message preview is clamped (full text hidden until More)', !(await enq.innerText()).includes('Sent'));
  await enq.locator('button:has-text("More")').click(); await sleep(300);
  const full = await enq.innerText();
  check('More expands the full details', full.includes('END-OF-MESSAGE') && full.includes('Sent') && full.includes('Garden room'));
  check('More button reports expanded state', (await enq.locator('button[aria-expanded=true]').count()) === 1);
  await enq.locator('button:has-text("Less")').click(); await sleep(300);
  await sleep(800);
  const ptrs = (await db.collection('notifications').where('uid', '==', M).get()).docs.filter((d) => ['Time off request', 'New private hire enquiry'].includes(d.get('title')));
  check('Opening the Inbox marks the duplicate alerts as read', ptrs.length === 2 && ptrs.every((d) => d.get('read') === true));
  check('Done section is collapsed by default', (await p.locator('details.ibx-done').evaluate((d) => d.open)) === false);

  // Tick Jane
  await enq.locator('[data-testid=ibx-tick]').click(); await sleep(1500);
  const j1 = (await db.doc(`enquiries/${E1.id}`).get()).data();
  check('Tick marks the enquiry dealt with (status closed, by Mia)', j1.status === 'closed' && j1.handledBy === M && !!j1.handledAt);
  check('Ticked enquiry leaves the main list', (await p.locator('[data-testid=ibx-enquiry]', { hasText: 'Jane Partyhost' }).count()) === 0);
  nav = await navLabels(p);
  check('Badge drops to 4 after the tick', /^Inbox 4\b/.test(nav.find((x) => x.startsWith('Inbox')) || ''), nav.find((x) => x.startsWith('Inbox')));
  await p.locator('details.ibx-done > summary').click(); await sleep(300);
  const doneT = await p.locator('details.ibx-done').innerText();
  check('Done shows the ticked enquiry, the old booked one and the decided request', doneT.includes('Jane Partyhost') && doneT.includes('Cara Booked') && doneT.includes('Approved') && doneT.includes('By Olly Owner'), doneT.replace(/\s+/g, ' ').slice(0, 300));
  check('Old enquiry data is kept (Cara still booked)', (await db.collection('enquiries').where('name', '==', 'Cara Booked').get()).docs[0].get('status') === 'booked');
  await p.locator('details.ibx-done li', { hasText: 'Jane Partyhost' }).locator('button:has-text("Move back")').click(); await sleep(1500);
  check('Move back reopens it', (await db.doc(`enquiries/${E1.id}`).get()).get('status') === 'new' && (await p.locator('[data-testid=ibx-enquiry]', { hasText: 'Jane Partyhost' }).count()) === 1);
  await p.screenshot({ path: '/tmp/inbx/test/inbox-manager-all.png', fullPage: true });

  // Filters
  await p.locator('[data-testid=ibx-chip-enquiries]').click(); await sleep(800);
  t = await mainText(p);
  check('Enquiries filter: only enquiries, URL ?f=enquiries', (await hash(p)) === '#/inbox?f=enquiries' && t.includes('Jane Partyhost') && !t.includes('Bus strike') && !t.includes('Shift changed'));
  check('Enquiries chip shows pressed state', (await p.locator('[data-testid=ibx-chip-enquiries][aria-pressed=true]').count()) === 1);
  await p.locator('[data-testid=ibx-chip-requests]').click(); await sleep(800);
  t = await mainText(p);
  check('Requests filter: only requests', t.includes('Bus strike') && t.includes('Wedding') && !t.includes('Jane Partyhost') && !t.includes('Shift changed'));
  await p.locator('[data-testid=ibx-chip-updates]').click(); await sleep(800);
  t = await mainText(p);
  check('Updates filter: notifications with Mark all as read / Clear all', t.includes('Shift changed') && t.includes('Rota for week of 2 Nov is out') && t.includes('Mark all as read') && t.includes('Clear all') && !t.includes('Jane Partyhost'));
  await p.locator('button:has-text("Mark all as read")').click(); await sleep(1200);
  const sc = (await db.collection('notifications').where('uid', '==', M).where('title', '==', 'Shift changed').get()).docs[0];
  check('Mark all as read works', sc.get('read') === true);
  await p.locator('[data-testid=ibx-update]', { hasText: 'Rota for week' }).locator('.up-remove').click(); await sleep(1200);
  check('Clear one update deletes it', (await db.collection('notifications').where('uid', '==', M).where('title', '==', 'Rota for week of 2 Nov is out').get()).empty);

  // Old links
  await go(p, '#/enquiries');
  check('Old #/enquiries link redirects to the Enquiries filter', (await hash(p)) === '#/inbox?f=enquiries', await hash(p));
  await go(p, '#/notifications');
  check('Old #/notifications link redirects to the Updates filter', (await hash(p)) === '#/inbox?f=updates', await hash(p));
  await go(p, '#/timeoff');
  check('Old #/timeoff still opens the Inbox', (await mainText(p)).includes('Needs doing'));
  await p.context().close();

  // ---------- Owner ----------
  p = await login('olly@example.test', '/#/inbox');
  nav = await navLabels(p);
  t = await mainText(p);
  check('owner: Inbox with requests and enquiries, Payroll still in sidebar, no Enquiries/Notifications entries', t.includes('Jane Partyhost') && t.includes('Bus strike') && nav.some((x) => x.startsWith('Payroll')) && !nav.some((x) => /^(Enquiries|Notifications)/.test(x)), nav.join(' | '));
  await p.context().close();

  // ---------- Staff ----------
  p = await login('sam@example.test', '/');
  nav = await navLabels(p);
  check('staff sidebar: Inbox with badge 1, no Enquiries/Notifications', /^Inbox 1\b/.test(nav.find((x) => x.startsWith('Inbox')) || '') && !nav.some((x) => /^(Enquiries|Notifications)/.test(x)), nav.join(' | '));
  await go(p, '#/inbox');
  t = await mainText(p);
  const sChips = await p.evaluate(() => [...document.querySelectorAll('.ibx-chip')].map((b) => b.innerText.replace(/\s+/g, ' ').trim()));
  check('staff chips: All / Your requests / Updates (no Enquiries)', sChips.length === 3 && sChips[1].startsWith('Your requests') && !sChips.some((c) => c.startsWith('Enquiries')), sChips.join(' | '));
  check('staff sees own requests and updates', t.includes('Your requests') && t.includes('Fri 20 Nov') && t.includes('Bus') === false && t.includes('Problem with a shift') && t.includes('Holiday approved'));
  check('staff does not see enquiries, decide buttons or manager-only alerts', !t.includes('Jane Partyhost') && !t.includes('New private hire enquiry') && (await p.locator('.ibx button:text-is("Approve")').count()) === 0);
  await go(p, '#/enquiries');
  check('staff: old #/enquiries link lands on their Inbox', ['#/inbox', '#/'].includes(await hash(p)), await hash(p));
  await go(p, '#/notifications');
  check('staff: old #/notifications link lands on Updates', (await hash(p)) === '#/inbox?f=updates');
  await p.context().close();

  // ---------- Payroll ----------
  p = await login('joe@example.test', '/');
  nav = (await navLabels(p)).filter((x) => x !== 'Staff Hub');
  check('payroll sidebar: Payroll, Inbox (badge 1), Holidays, Payslips; no Notifications', nav[0].startsWith('Payroll') && /^Inbox 1\b/.test(nav[1] || '') && !nav.some((x) => /^(Enquiries|Notifications)/.test(x)), nav.join(' | '));
  await go(p, '#/inbox');
  t = await mainText(p);
  check('payroll Inbox: just updates with the cut-off reminder, no chips', t.includes('Payroll cut-off in 2 days') && (await p.locator('.ibx-chip').count()) === 0 && !t.includes('Needs doing'));
  await go(p, '#/notifications');
  check('payroll: old #/notifications link lands on Inbox', (await hash(p)).startsWith('#/inbox'));
  await p.context().close();

  // ---------- Phone ----------
  for (const [who, email] of [['manager', 'mia@example.test'], ['staff', 'sam@example.test']]) {
    p = await login(email, '/#/inbox', { width: 375, height: 812 });
    await sleep(500);
    const ov = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`phone (${who}): no sideways scrolling`, ov <= 0, String(ov));
    const bell = await p.evaluate(() => { const a = document.querySelector('[data-testid=mbar-inbox]'); return a && a.getAttribute('href') + '|' + a.getAttribute('aria-label'); });
    check(`phone (${who}): top bar icon opens the Inbox with the combined count`, !!bell && bell.startsWith('#/inbox|Inbox'), bell);
    await p.screenshot({ path: `/tmp/inbx/test/inbox-${who}-phone.png`, fullPage: true });
    await p.context().close();
  }

  check('no page errors or permission errors', errors.length === 0, errors.slice(0, 5).join(' || '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
