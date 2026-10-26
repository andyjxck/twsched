// Holiday decisions keep the paid/unpaid type the staff member asked for (decideRequest, functions emulator).
// Run: npm run test:holiday   (emulators only; no private/mail doc exists, so no email can be sent,
// and notifications are written only to the local emulator database)
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-twsched';
const FN_HOST = process.env.FUNCTIONS_EMULATOR_ORIGIN || 'http://127.0.0.1:5001';
const FN = `${FN_HOST}/${PROJECT}/europe-west2/decideRequest`;
const AUTH_HOST = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'}`;
const PW = 'Emulator-only-pw1';
const USERS = {
  owner: { email: 'owner@hotel.test', role: 'owner' },
  mgr: { email: 'mgr@hotel.test', role: 'manager' },
  alice: { email: 'alice@hotel.test', role: 'staff' },
  bob: { email: 'bob@hotel.test', role: 'staff' },
};
const uid = {};
const token = {};
let db;

before(async () => {
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  db = admin.firestore();
  await fetch(`${AUTH_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  for (const [k, u] of Object.entries(USERS)) {
    const rec = await admin.auth().createUser({ email: u.email, password: PW });
    await admin.auth().setCustomUserClaims(rec.uid, { role: u.role });
    uid[k] = rec.uid;
    const r = await fetch(`${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: u.email, password: PW, returnSecureToken: true }),
    });
    token[k] = (await r.json()).idToken;
    assert.ok(token[k], `token for ${k}`);
  }
});
after(async () => { await admin.app().delete(); });

const BASE = { staffName: 'Alice', from: '2030-05-04', to: '2030-05-06', reason: 'Family wedding', status: 'pending' };
beforeEach(async () => {
  for (const c of ['timeOff', 'requests', 'notifications', 'staff', 'private']) {
    const s = await db.collection(c).get();
    await Promise.all(s.docs.map((d) => d.ref.delete()));
  }
  await db.doc(`staff/${uid.alice}`).set({ name: 'Alice', role: 'staff', active: true, email: USERS.alice.email });
  await db.doc(`staff/${uid.mgr}`).set({ name: 'Mo Manager', role: 'manager', active: true, email: USERS.mgr.email });
  await db.doc(`staff/${uid.owner}`).set({ name: 'Owner', role: 'owner', active: true, email: USERS.owner.email });
  const created = admin.firestore.Timestamp.fromDate(new Date('2030-04-01T10:00:00Z'));
  await db.doc('timeOff/paidReq').set({ ...BASE, staffId: uid.alice, paid: true, createdAt: created });
  await db.doc('timeOff/unpaidReq').set({ ...BASE, staffId: uid.alice, paid: false, createdAt: created });
  // a record from before `paid` existed: the app treats a missing value as paid
  await db.doc('timeOff/legacyReq').set({ ...BASE, staffId: uid.alice, createdAt: created });
  await db.doc('requests/prob1').set({ kind: 'problem', staffId: uid.alice, staffName: 'Alice', shiftLabel: 'Mon 17:00', message: 'x', status: 'pending', createdAt: created });
});

async function decide(who, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (who) headers.Authorization = `Bearer ${token[who]}`;
  const r = await fetch(FN, { method: 'POST', headers, body: JSON.stringify({ data }) });
  return r.json();
}
const read = async (id) => (await db.doc(`timeOff/${id}`).get()).data();
const KEEP = ['staffId', 'staffName', 'from', 'to', 'reason', 'createdAt'];
function sameSubmission(before, after) {
  for (const k of KEEP) assert.deepEqual(after[k], before[k], `${k} unchanged`);
  assert.equal('paid' in after, 'paid' in before, 'paid field neither added nor removed');
  if ('paid' in before) assert.equal(after.paid, before.paid, 'paid unchanged');
}
async function waitForNote(u) {
  for (let i = 0; i < 40; i++) {
    const s = await db.collection('notifications').where('uid', '==', u).get();
    if (!s.empty) return s.docs.map((d) => d.data());
    await new Promise((r) => setTimeout(r, 250));
  }
  return [];
}

for (const [id, paidWord] of [['paidReq', 'paid'], ['unpaidReq', 'unpaid']]) {
  for (const status of ['approved', 'declined']) {
    test(`${paidWord} request ${status} as submitted keeps its type`, async () => {
      const before0 = await read(id);
      const r = await decide('mgr', { kind: 'timeOff', id, status, note: 'ok' });
      assert.deepEqual(r.result, { ok: true, decidedByName: 'Mo Manager' }, JSON.stringify(r));
      const after0 = await read(id);
      assert.equal(after0.status, status);
      assert.equal(after0.decidedBy, uid.mgr);
      sameSubmission(before0, after0);
      // if the server keeps a rota index of approved holiday (availability.js), it must carry the submitted type
      const blocks = await db.collection('rotaBlocks').where('staffId', '==', uid.alice).get();
      const days = blocks.docs.flatMap((d) => Object.entries(d.get('d') || {})).filter(([, e]) => e.k === 'holiday');
      if (status === 'approved' && blocks.size) {
        assert.deepEqual(days.map(([k]) => k).sort(), ['2030-05-04', '2030-05-05', '2030-05-06']);
        assert.ok(days.every(([, e]) => e.paid === (paidWord === 'paid')), JSON.stringify(days));
      }
      if (status === 'declined') assert.equal(days.length, 0, 'declined holiday never blocks the rota');
      const notes = await waitForNote(uid.alice);
      assert.ok(notes.some((n) => n.title === `Time off ${status}` && n.body.includes(`(${paidWord})`)), JSON.stringify(notes));
    });
  }
}

const OVERRIDES = [
  ['paidReq', 'approved', false], ['paidReq', 'declined', false],
  ['unpaidReq', 'approved', true], ['unpaidReq', 'declined', true],
  ['legacyReq', 'approved', false],
];
for (const [id, status, paid] of OVERRIDES) {
  test(`manager cannot ${status === 'approved' ? 'approve' : 'decline'} ${id} as ${paid ? 'paid' : 'unpaid'}`, async () => {
    const before0 = await read(id);
    const r = await decide('mgr', { kind: 'timeOff', id, status, note: '', paid });
    assert.equal(r.error && r.error.status, 'FAILED_PRECONDITION', JSON.stringify(r));
    assert.match(r.error.message, /Managers can only approve or decline it/);
    assert.deepEqual(await read(id), before0, 'request untouched, still pending');
  });
}

test('the owner cannot convert either (no owner exception)', async () => {
  const before0 = await read('unpaidReq');
  const r = await decide('owner', { kind: 'timeOff', id: 'unpaidReq', status: 'approved', paid: true });
  assert.equal(r.error && r.error.status, 'FAILED_PRECONDITION');
  assert.deepEqual(await read('unpaidReq'), before0);
});

test('malformed paid values are refused and change nothing', async () => {
  for (const paid of ['false', 0, 1, 'unpaid', {}, []]) {
    const before0 = await read('paidReq');
    const r = await decide('mgr', { kind: 'timeOff', id: 'paidReq', status: 'approved', paid });
    assert.equal(r.error && r.error.status, 'INVALID_ARGUMENT', JSON.stringify(paid));
    assert.deepEqual(await read('paidReq'), before0);
  }
});

test('an older app that still sends the unchanged type is accepted', async () => {
  let r = await decide('mgr', { kind: 'timeOff', id: 'paidReq', status: 'approved', paid: true });
  assert.ok(r.result && r.result.ok, JSON.stringify(r));
  r = await decide('mgr', { kind: 'timeOff', id: 'unpaidReq', status: 'declined', paid: false });
  assert.ok(r.result && r.result.ok, JSON.stringify(r));
  r = await decide('mgr', { kind: 'timeOff', id: 'legacyReq', status: 'approved', paid: true });
  assert.ok(r.result && r.result.ok, JSON.stringify(r));
  assert.equal((await read('paidReq')).paid, true);
  assert.equal((await read('unpaidReq')).paid, false);
  assert.equal('paid' in (await read('legacyReq')), false, 'legacy record not rewritten');
});

test('staff and signed-out callers cannot decide at all', async () => {
  const before0 = await read('paidReq');
  let r = await decide('alice', { kind: 'timeOff', id: 'paidReq', status: 'approved', paid: false });
  assert.equal(r.error && r.error.status, 'PERMISSION_DENIED');
  r = await decide('bob', { kind: 'timeOff', id: 'paidReq', status: 'approved' });
  assert.equal(r.error && r.error.status, 'PERMISSION_DENIED');
  r = await decide(null, { kind: 'timeOff', id: 'paidReq', status: 'approved', paid: false });
  assert.equal(r.error && r.error.status, 'UNAUTHENTICATED');
  assert.deepEqual(await read('paidReq'), before0);
});

test('a decided request cannot be decided again to flip its type', async () => {
  await decide('mgr', { kind: 'timeOff', id: 'paidReq', status: 'declined' });
  const before0 = await read('paidReq');
  for (const payload of [{ status: 'approved', paid: false }, { status: 'approved' }]) {
    const r = await decide('mgr', { kind: 'timeOff', id: 'paidReq', ...payload });
    assert.equal(r.error && r.error.status, 'FAILED_PRECONDITION');
  }
  assert.deepEqual(await read('paidReq'), before0);
});

test('other request types still work (problem report marked sorted)', async () => {
  const r = await decide('mgr', { kind: 'request', id: 'prob1', status: 'resolved', paid: false });
  assert.ok(r.result && r.result.ok, JSON.stringify(r));
  assert.equal((await db.doc('requests/prob1').get()).get('status'), 'resolved');
});
