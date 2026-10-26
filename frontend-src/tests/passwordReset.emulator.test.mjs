// requestPasswordReset against the Firebase emulators (functions + firestore + auth).
// Run: npm run test:reset   (no real email is ever sent: the auth emulator only records reset codes)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-twsched';
const FN = `http://127.0.0.1:5001/${PROJECT}/europe-west2/requestPasswordReset`;
const AUTH = `http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/oobCodes`;
let db;

before(async () => {
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  db = admin.firestore();
  const s = await db.collection('rateLimits').get();
  await Promise.all(s.docs.map((d) => d.ref.delete()));
  await fetch(AUTH, { method: 'DELETE' });
  for (const email of ['staff1@hotel.test', 'staff2@hotel.test', 'staff3@hotel.test']) {
    try { await admin.auth().createUser({ email, password: 'Emulator-only-pw1' }); } catch { /* exists */ }
  }
});
after(async () => { await admin.app().delete(); });

async function reset(email, ip, extra = {}) {
  const r = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify({ data: { email, ...extra } }) });
  return { status: r.status, ...(await r.json()) };
}
async function codesFor(email) {
  const j = await (await fetch(AUTH)).json();
  return (j.oobCodes || []).filter((c) => c.email === email && c.requestType === 'PASSWORD_RESET');
}

test('first request is allowed and sends one reset email', async () => {
  const r = await reset('staff1@hotel.test', '198.51.100.1');
  assert.deepEqual(r.result, { ok: true, retryAfter: 120 });
  assert.equal((await codesFor('staff1@hotel.test')).length, 1);
});

test('a repeat within 2 minutes is blocked server-side, also with different case/spacing and from another IP', async () => {
  for (const [email, ip] of [['staff1@hotel.test', '198.51.100.1'], ['  STAFF1@Hotel.TEST ', '198.51.100.2'], ['Staff1@hotel.test', '203.0.113.9']]) {
    const r = await reset(email, ip);
    assert.equal(r.error && r.error.status, 'RESOURCE_EXHAUSTED', email);
    assert.ok(r.error.details.retryAfter > 100 && r.error.details.retryAfter <= 120, `retryAfter ${r.error.details.retryAfter}`);
    assert.match(r.error.message, /last 2 minutes/);
  }
  assert.equal((await codesFor('staff1@hotel.test')).length, 1, 'still only one reset email');
});

test('concurrent requests for one address: exactly one gets through', async () => {
  const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => reset('staff2@hotel.test', `198.51.100.${20 + i}`)));
  const ok = rs.filter((r) => r.result && r.result.ok);
  const blocked = rs.filter((r) => r.error && r.error.status === 'RESOURCE_EXHAUSTED');
  assert.equal(ok.length, 1, JSON.stringify(rs));
  assert.equal(blocked.length, 5);
  assert.equal((await codesFor('staff2@hotel.test')).length, 1);
});

test('an address with no login gets the same answer and the same cooldown (no account enumeration)', async () => {
  const r = await reset('nobody@hotel.test', '198.51.100.40');
  assert.deepEqual(r.result, { ok: true, retryAfter: 120 });
  assert.equal((await codesFor('nobody@hotel.test')).length, 0);
  const again = await reset('nobody@hotel.test', '198.51.100.40');
  assert.equal(again.error && again.error.status, 'RESOURCE_EXHAUSTED');
  assert.match(again.error.message, /last 2 minutes/);
});

test('bad input is rejected without sending anything', async () => {
  for (const email of ['', 'not-an-email', 'a@b.test\r\nBcc: x@y.test', 'a@b.test,c@d.test', 123, 'x'.repeat(200) + '@b.test']) {
    const r = await reset(email, '198.51.100.50');
    assert.equal(r.error && r.error.status, 'INVALID_ARGUMENT', String(email).slice(0, 40));
  }
});

test('one IP is limited to 5 requests an hour across different addresses', async () => {
  const ip = '198.51.100.60';
  for (let i = 0; i < 5; i++) {
    const r = await reset(`probe${i}@hotel.test`, ip);
    assert.ok(r.result && r.result.ok, `request ${i + 1}`);
  }
  const r = await reset('staff3@hotel.test', ip);
  assert.equal(r.error && r.error.status, 'RESOURCE_EXHAUSTED');
  assert.match(r.error.message, /Too many reset requests/);
  assert.equal((await codesFor('staff3@hotel.test')).length, 0, 'blocked request sent nothing');
  // a different caller can still reset that address
  const other = await reset('staff3@hotel.test', '198.51.100.61');
  assert.ok(other.result && other.result.ok);
  assert.equal((await codesFor('staff3@hotel.test')).length, 1);
});

test('rate-limit docs hold only hashes, never the address or IP', async () => {
  const s = await db.collection('rateLimits').get();
  assert.ok(s.size > 0);
  for (const d of s.docs) {
    const raw = JSON.stringify({ id: d.id, ...d.data() });
    assert.ok(!/@|198\.51\.100/.test(raw), raw);
  }
});
