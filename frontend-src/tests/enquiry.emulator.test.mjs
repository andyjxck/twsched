// End-to-end test of submitEnquiry + onEnquiryCreated against the Firebase emulators, with a local
// SMTP sink standing in for Gmail. Run: npm run test:enquiry
// (needs functions/.secret.local with SMTP_PASS=emulator-dummy-pass; never the real password)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { SMTPServer } = require('smtp-server');
const admin = require('../functions/node_modules/firebase-admin');
const { keyHash } = require('../functions/enquiry.js');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-twsched';
const FN = `http://127.0.0.1:5001/${PROJECT}/europe-west2/submitEnquiry`;
const OWNER_TO = 'owner-inbox@hotel.test';
const mails = [];
let smtp, db;

before(async () => {
  smtp = new SMTPServer({
    authOptional: false, allowInsecureAuth: true, disabledCommands: ['STARTTLS'], logger: false,
    onAuth(a, s, cb) { cb(null, { user: { username: a.username, password: a.password } }); },
    onData(stream, session, cb) {
      let raw = '';
      stream.on('data', (c) => { raw += c; });
      stream.on('end', () => {
        mails.push({ from: session.envelope.mailFrom.address, rcpt: session.envelope.rcptTo.map((r) => r.address), raw, auth: session.user });
        cb();
      });
    },
  });
  await new Promise((r) => smtp.listen(2525, '127.0.0.1', r));
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  db = admin.firestore();
  for (const col of ['enquiries', 'rateLimits', 'notifications']) {
    const s = await db.collection(col).get();
    await Promise.all(s.docs.map((d) => d.ref.delete()));
  }
  await db.doc('staff/owner1').set({ name: 'Owner', role: 'owner', active: true, email: 'owner1@hotel.test' });
  // Mail settings as the owner Settings screen would save them; password comes from the secret.
  await db.doc('private/mail').set({ host: '127.0.0.1', port: 2525, secure: false, user: 'sender@hotel.test', from: '', enquiryTo: OWNER_TO, ackCustomer: true, enabled: true, emailStaff: true, pass: '' });
});
after(async () => { await new Promise((r) => smtp.close(r)); await admin.app().delete(); });

const good = (extra = {}) => ({ name: 'Jo Bloggs', email: 'jo@visitor.test', phone: '07700 900123', occasion: 'Birthday', date: '2027-01-09', guests: '40', message: 'Hello, can we hire the room?', website: '', ...extra });
async function submit(data, ip) {
  const r = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(ip ? { 'X-Forwarded-For': ip } : {}) }, body: JSON.stringify({ data }) });
  const j = await r.json();
  return { status: r.status, ...j };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 15000) {
  const t = Date.now();
  while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(250); }
  return null;
}
async function enquiriesByEmail(email) {
  return (await db.collection('enquiries').where('email', '==', email).get()).docs;
}

test('a legitimate enquiry is saved and emailed to the owner recipient only', async () => {
  const r = await submit(good(), '198.51.100.1');
  assert.deepEqual(r.result, { ok: true });
  const docs = await waitFor(async () => { const d = await enquiriesByEmail('jo@visitor.test'); return d.length ? d : null; });
  assert.equal(docs.length, 1);
  const e = docs[0].data();
  assert.equal(e.via, 'submitEnquiry');
  assert.equal(e.status, 'new');
  assert.equal(e.guests, 40);
  const done = await waitFor(async () => (await docs[0].ref.get()).get('emailedAt'));
  assert.ok(done, 'emailedAt set');
  assert.equal(mails.length, 1, 'exactly one email (no customer thank-you)');
  assert.deepEqual(mails[0].rcpt, [OWNER_TO]);
  assert.equal(mails[0].auth.password, 'emulator-dummy-pass', 'SMTP password came from the secret');
  assert.match(mails[0].raw, /Reply-To: Jo Bloggs <jo@visitor\.test>/);
  assert.match(mails[0].raw, /Hello, can we hire the room\?/);
  const notes = await db.collection('notifications').where('uid', '==', 'owner1').get();
  assert.equal(notes.size, 1, 'in-app alert for the owner');
});

test('malicious requests cannot choose recipients or inject headers; nothing stored or sent', async () => {
  const before = mails.length;
  const attacks = [
    good({ email: 'victim@target.test\r\nBcc: list@target.test' }),
    good({ name: 'Jo\r\nBcc: list@target.test' }),
    good({ email: 'victim@target.test,list@target.test' }),
    good({ email: 'Victim <victim@target.test>' }),
    good({ phone: '1\nTo: x@target.test' }),
    good({ message: 'x'.repeat(3001) }),
    good({ message: 'spam http://a.test http://b.test http://c.test http://d.test' }),
  ];
  let i = 0;
  for (const a of attacks) {
    const r = await submit(a, `198.51.100.${50 + i++}`);
    assert.equal(r.error && r.error.status, 'INVALID_ARGUMENT', JSON.stringify(a).slice(0, 80));
  }
  // extra fields trying to redirect mail are ignored: the only email still goes to the owner
  const r = await submit(good({ email: 'override@visitor.test', to: 'victim@target.test', enquiryTo: 'victim@target.test', bcc: 'victim@target.test', ackCustomer: true, via: 'x', status: 'booked' }), '198.51.100.70');
  assert.deepEqual(r.result, { ok: true });
  const docs = await waitFor(async () => { const d = await enquiriesByEmail('override@visitor.test'); return d.length ? d : null; });
  const e = docs[0].data();
  assert.equal(e.status, 'new');
  assert.equal(e.via, 'submitEnquiry');
  for (const k of ['to', 'enquiryTo', 'bcc', 'ackCustomer']) assert.equal(e[k], undefined);
  await waitFor(async () => mails.length > before);
  await sleep(1500);
  assert.equal(mails.length, before + 1);
  const last = mails[mails.length - 1];
  assert.deepEqual(last.rcpt, [OWNER_TO]);
  assert.ok(!mails.some((m) => m.rcpt.some((x) => x.endsWith('@target.test') || x.endsWith('@visitor.test'))), 'no mail to visitor-supplied addresses');
  assert.ok(!/^bcc:/im.test(last.raw));
  assert.equal((await db.collection('enquiries').where('email', '==', 'victim@target.test').get()).size, 0);
});

test('honeypot submissions get a fake success and are not stored or emailed', async () => {
  const before = mails.length;
  const r = await submit(good({ email: 'bot@visitor.test', website: 'http://spam.test' }), '198.51.100.80');
  assert.deepEqual(r.result, { ok: true });
  await sleep(1500);
  assert.equal((await enquiriesByEmail('bot@visitor.test')).length, 0);
  assert.equal(mails.length, before);
});

test('per-caller limit: 4th enquiry in an hour is refused, even with spoofed X-Forwarded-For prefixes', async () => {
  const results = [];
  for (let i = 0; i < 4; i++) results.push(await submit(good({ email: `rl${i}@visitor.test` }), `10.0.0.${i}, 192.0.2.${i}, 203.0.113.7`));
  assert.deepEqual(results.slice(0, 3).map((r) => r.result && r.result.ok), [true, true, true]);
  assert.equal(results[3].error && results[3].error.status, 'RESOURCE_EXHAUSTED');
  await sleep(500);
  assert.equal((await enquiriesByEmail('rl3@visitor.test')).length, 0);
});

test('per-email limit: one address cannot be used more than 3 times a day from different callers', async () => {
  const out = [];
  for (let i = 0; i < 4; i++) out.push(await submit(good({ email: 'same@visitor.test' }), `203.0.113.${100 + i}`));
  assert.deepEqual(out.slice(0, 3).map((r) => r.result && r.result.ok), [true, true, true]);
  assert.equal(out[3].error && out[3].error.status, 'RESOURCE_EXHAUSTED');
});

async function setCounter(kind, value, windowMs, count) {
  const salt = (await db.doc('private/rateLimitSalt').get()).get('salt');
  const bucket = Math.floor(Date.now() / windowMs);
  await db.collection('rateLimits').doc(keyHash(kind, `${value}|${bucket}`, salt)).set({ kind, count, expireAt: new Date(Date.now() + 2 * windowMs) });
}

test('daily email cap: once reached, enquiries are still saved (with in-app alert) but not emailed', async () => {
  await sleep(2500); // let earlier tests' trigger emails finish
  await setCounter('emails-day', 'all', 86400000, 20);
  const before = mails.length;
  const r = await submit(good({ email: 'capped@visitor.test' }), '203.0.113.200');
  assert.deepEqual(r.result, { ok: true });
  const docs = await waitFor(async () => { const d = await enquiriesByEmail('capped@visitor.test'); return d.length ? d : null; });
  const skipped = await waitFor(async () => (await docs[0].ref.get()).get('emailSkipped'));
  assert.equal(skipped, 'daily email limit reached');
  await sleep(1000);
  assert.equal(mails.length, before);
  assert.ok(!mails.some((m) => m.raw.includes('capped@visitor.test')));
});

test('global daily limit: once reached, new enquiries are refused', async () => {
  await setCounter('global-day', 'all', 86400000, 40);
  const r = await submit(good({ email: 'global@visitor.test' }), '203.0.113.210');
  assert.equal(r.error && r.error.status, 'RESOURCE_EXHAUSTED');
});

test('with email switched off, enquiries are still saved', async () => {
  await db.doc('private/mail').update({ enabled: false });
  await setCounter('global-day', 'all', 86400000, 0);
  const before = mails.length;
  const r = await submit(good({ email: 'off@visitor.test' }), '203.0.113.220');
  assert.deepEqual(r.result, { ok: true });
  assert.ok(await waitFor(async () => (await enquiriesByEmail('off@visitor.test')).length));
  await sleep(1500);
  assert.equal(mails.length, before);
  await db.doc('private/mail').update({ enabled: true });
});
