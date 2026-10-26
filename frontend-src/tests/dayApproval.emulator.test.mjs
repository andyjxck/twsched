// Day-by-day rota approval: Firestore rules + approveDay / unapproveDay and every Cloud Function that
// changes shifts. Runs only against local emulators with made-up accounts (no live data, no email).
// Run: npm run test:days
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch, runTransaction, serverTimestamp } from 'firebase/firestore';

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-twsched';
const FN = (name) => `http://127.0.0.1:5001/${PROJECT}/europe-west2/${name}`;
const AUTH = 'http://127.0.0.1:9099';

const LOCKED_DAY = '2030-03-05'; // Tue, week of Mon 2030-03-04
const OPEN_DAY = '2030-03-06';   // Wed, same week, not approved
const NEXT_TUE = '2030-03-12';   // the following Tuesday (approving one Tuesday must not lock all Tuesdays)
const WEEK = '2030-03-04';

let env; let adb;
const users = {}; // key -> { uid, token }

async function makeUser(key, role, extra = {}) {
  const email = `${key}@hotel.test`;
  let u;
  try { u = await admin.auth().getUserByEmail(email); } catch { u = await admin.auth().createUser({ email, password: 'Emulator-only-pw1' }); }
  await admin.auth().setCustomUserClaims(u.uid, { role, ...extra });
  await adb.doc(`staff/${u.uid}`).set({ name: key[0].toUpperCase() + key.slice(1), email, role, active: true, onRota: true });
  // Right to Work on file (server-written in real life), so their drafts can be published
  await adb.doc(`rtwStatus/${u.uid}`).set({ staffId: u.uid, ok: true, count: 1 });
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Emulator-only-pw1', returnSecureToken: true }),
  });
  const j = await r.json();
  users[key] = { uid: u.uid, token: j.idToken };
}
async function callFn(name, who, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (who) headers.Authorization = `Bearer ${users[who].token}`;
  const r = await fetch(FN(name), { method: 'POST', headers, body: JSON.stringify({ data }) });
  return r.json();
}
const ok = (r) => { assert.ok(r.result && !r.error, JSON.stringify(r)); return r.result; };
const denied = (r, status) => { assert.ok(r.error, `expected an error, got ${JSON.stringify(r)}`); if (status) assert.equal(r.error.status, status, JSON.stringify(r)); return r.error; };

const client = (who) => env.authenticatedContext(users[who].uid, { role: { owner: 'owner', manager: 'manager', manager2: 'manager', staff: 'staff' }[who], email: `${who}@hotel.test` }).firestore();
const shift = (who, extra = {}) => ({
  staffId: users.staff.uid, staffName: 'Staff', date: OPEN_DAY, week: WEEK, start: '17:00', end: '23:00',
  breakStart: '', breakEnd: '', breakPaid: true, area: 'Bar', notes: '', eventId: '', eventTitle: '',
  published: true, updatedAt: serverTimestamp(), updatedBy: users[who].uid, ...extra,
});
const seedShift = (id, date, extra = {}) => adb.doc(`shifts/${id}`).set({
  staffId: users.staff.uid, staffName: 'Staff', date, week: date >= '2030-03-11' ? '2030-03-11' : WEEK,
  start: '17:00', end: '23:00', breakStart: '', breakEnd: '', breakPaid: true, area: 'Bar', notes: '',
  eventId: '', eventTitle: '', published: true, updatedAt: new Date(), updatedBy: 'seed', ...extra,
});

before(async () => {
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  adb = admin.firestore();
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
});
after(async () => { await env.cleanup(); await admin.app().delete(); });
beforeEach(async () => {
  await env.clearFirestore();
  for (const [k, r, x] of [['owner', 'owner'], ['manager', 'manager'], ['manager2', 'manager'], ['staff', 'staff']]) await makeUser(k, r, x);
  await seedShift('onLocked', LOCKED_DAY);
  await seedShift('draftLocked', LOCKED_DAY, { published: false });
  await seedShift('onOpen', OPEN_DAY);
  await seedShift('nextTue', NEXT_TUE);
  await seedShift('openShiftLocked', LOCKED_DAY, { staffId: '', staffName: 'Open shift' });
});

async function approveAsManager() {
  const r = ok(await callFn('approveDay', 'manager', { date: LOCKED_DAY }));
  assert.equal(r.published, 1, 'the draft on that day is published when it is approved');
  return r;
}

test('manager approves one calendar day: metadata is stored, drafts published, 5-minute window set', async () => {
  const r = await approveAsManager();
  const d = (await adb.doc(`days/${LOCKED_DAY}`).get()).data();
  assert.equal(d.status, 'approved');
  assert.equal(d.approvedBy, users.manager.uid);
  assert.equal(d.approvedByName, 'Manager');
  assert.equal(d.week, WEEK);
  const ms = d.graceUntil.toMillis() - d.approvedAt.toMillis();
  assert.equal(ms, 5 * 60 * 1000);
  assert.ok(Math.abs(r.graceUntil - d.graceUntil.toMillis()) < 5);
  assert.equal((await adb.doc('shifts/draftLocked').get()).get('published'), true);
  // only that date: the next Tuesday and the rest of the week stay unapproved
  assert.equal((await adb.doc(`days/${NEXT_TUE}`).get()).exists, false);
  assert.equal((await adb.doc(`weeks/${WEEK}`).get()).exists, false);
  denied(await callFn('approveDay', 'manager2', { date: LOCKED_DAY }), 'ALREADY_EXISTS');
});

test('staff cannot approve or unapprove, and nobody can write the day lock directly', async () => {
  denied(await callFn('approveDay', 'staff', { date: LOCKED_DAY }), 'PERMISSION_DENIED');
  denied(await callFn('approveDay', null, { date: LOCKED_DAY }), 'UNAUTHENTICATED');
  denied(await callFn('approveDay', 'manager', { date: '2030-02-30' }), 'INVALID_ARGUMENT');
  await approveAsManager();
  denied(await callFn('unapproveDay', 'staff', { date: LOCKED_DAY }), 'PERMISSION_DENIED');
  for (const who of ['staff', 'manager', 'owner']) {
    const c = client(who);
    await assertFails(setDoc(doc(c, 'days', OPEN_DAY), { status: 'approved' }));
    await assertFails(updateDoc(doc(c, 'days', LOCKED_DAY), { status: 'unapproved' }));
    await assertFails(deleteDoc(doc(c, 'days', LOCKED_DAY)));
  }
  await assertSucceeds(getDoc(doc(client('staff'), 'days', LOCKED_DAY)));
});

test('after approval a manager cannot create, edit, delete, move in/out, publish or reassign shifts on that day', async () => {
  await approveAsManager();
  const m = client('manager');
  await assertFails(setDoc(doc(m, 'shifts', 'new1'), shift('manager', { date: LOCKED_DAY })));                // create
  await assertFails(setDoc(doc(m, 'shifts', 'newOpen'), shift('manager', { date: LOCKED_DAY, staffId: '', staffName: 'Open shift' })));
  await assertFails(setDoc(doc(m, 'shifts', 'onLocked'), shift('manager', { date: LOCKED_DAY, start: '18:00' }))); // edit
  await assertFails(updateDoc(doc(m, 'shifts', 'onLocked'), { end: '22:00', updatedAt: serverTimestamp(), updatedBy: users.manager.uid }));
  await assertFails(deleteDoc(doc(m, 'shifts', 'onLocked')));                                                // delete
  await assertFails(setDoc(doc(m, 'shifts', 'onLocked'), shift('manager', { date: OPEN_DAY })));              // move out
  await assertFails(setDoc(doc(m, 'shifts', 'onOpen'), shift('manager', { date: LOCKED_DAY })));              // move in
  await assertFails(setDoc(doc(m, 'shifts', 'openShiftLocked'), shift('manager', { date: LOCKED_DAY })));     // fill/reassign open shift
  // bulk: a batch with one locked write fails as a whole, and a transaction too
  const b = writeBatch(m);
  b.set(doc(m, 'shifts', 'bulkA'), shift('manager', { date: OPEN_DAY }));
  b.set(doc(m, 'shifts', 'bulkB'), shift('manager', { date: LOCKED_DAY }));
  await assertFails(b.commit());
  assert.equal((await adb.doc('shifts/bulkA').get()).exists, false);
  await assertFails(runTransaction(m, async (t) => { t.delete(doc(m, 'shifts', 'onLocked')); }));
  // staff could never edit the rota anyway
  await assertFails(setDoc(doc(client('staff'), 'shifts', 'onOpen'), shift('staff')));
});

test('other days are unaffected: same week, and the same weekday next week', async () => {
  await approveAsManager();
  const m = client('manager');
  await assertSucceeds(setDoc(doc(m, 'shifts', 'n2'), shift('manager', { date: OPEN_DAY })));
  await assertSucceeds(setDoc(doc(m, 'shifts', 'onOpen'), shift('manager', { date: OPEN_DAY, start: '16:00' })));
  await assertSucceeds(setDoc(doc(m, 'shifts', 'nextTue'), shift('manager', { date: NEXT_TUE, week: '2030-03-11', start: '16:00' })));
  await assertSucceeds(deleteDoc(doc(m, 'shifts', 'nextTue')));
  // staff still read their own published shift on the locked day
  await assertSucceeds(getDoc(doc(client('staff'), 'shifts', 'onLocked')));
});

test('the owner can still change everything on an approved day', async () => {
  await approveAsManager();
  const o = client('owner');
  await assertSucceeds(setDoc(doc(o, 'shifts', 'o1'), shift('owner', { date: LOCKED_DAY })));
  await assertSucceeds(setDoc(doc(o, 'shifts', 'onLocked'), shift('owner', { date: LOCKED_DAY, start: '18:00' })));
  await assertSucceeds(setDoc(doc(o, 'shifts', 'onOpen'), shift('owner', { date: LOCKED_DAY })));  // move in
  await assertSucceeds(setDoc(doc(o, 'shifts', 'onLocked'), shift('owner', { date: OPEN_DAY })));  // move out
  await assertSucceeds(deleteDoc(doc(o, 'shifts', 'o1')));
});

test('the approver can untick within 5 minutes; another manager cannot', async () => {
  await approveAsManager();
  denied(await callFn('unapproveDay', 'manager2', { date: LOCKED_DAY }), 'PERMISSION_DENIED');
  ok(await callFn('unapproveDay', 'manager', { date: LOCKED_DAY }));
  const d = (await adb.doc(`days/${LOCKED_DAY}`).get()).data();
  assert.equal(d.status, 'unapproved');
  assert.equal(d.unapprovedBy, users.manager.uid);
  assert.deepEqual(d.history.map((h) => h.action), ['approved', 'undone in 5 minutes']);
  // unlocked again for managers
  await assertSucceeds(setDoc(doc(client('manager'), 'shifts', 'onLocked'), shift('manager', { date: LOCKED_DAY, start: '18:00' })));
  // and it can be ticked again
  ok(await callFn('approveDay', 'manager2', { date: LOCKED_DAY }));
  assert.equal((await adb.doc(`days/${LOCKED_DAY}`).get()).get('approvedBy'), users.manager2.uid);
});

test('after 5 minutes the lock is permanent for managers (server clock); only the owner can unlock', async () => {
  await approveAsManager();
  // simulate the 5 minutes passing by back-dating the server record
  const past = admin.firestore.Timestamp.fromMillis(Date.now() - 6 * 60 * 1000);
  await adb.doc(`days/${LOCKED_DAY}`).update({ approvedAt: past, graceUntil: admin.firestore.Timestamp.fromMillis(past.toMillis() + 5 * 60 * 1000) });
  const e = denied(await callFn('unapproveDay', 'manager', { date: LOCKED_DAY }), 'PERMISSION_DENIED');
  assert.match(e.message, /5 minutes .* passed/);
  assert.equal((await adb.doc(`days/${LOCKED_DAY}`).get()).get('status'), 'approved');
  ok(await callFn('unapproveDay', 'owner', { date: LOCKED_DAY }));
  assert.equal((await adb.doc(`days/${LOCKED_DAY}`).get()).get('status'), 'unapproved');
});

test('Cloud Functions respect the day lock: swaps, publishing and removing a leaver', async () => {
  // owner-added draft on the day after it was approved
  await approveAsManager();
  await seedShift('ownerDraft', LOCKED_DAY, { published: false });
  await seedShift('openDraft', OPEN_DAY, { published: false });
  // publishWeek by a manager publishes other days only
  const p = ok(await callFn('publishWeek', 'manager', { weekStart: WEEK }));
  assert.equal(p.skippedLocked, 1);
  assert.equal((await adb.doc('shifts/ownerDraft').get()).get('published'), false);
  assert.equal((await adb.doc('shifts/openDraft').get()).get('published'), true);
  // swap approval on the locked day: manager refused, owner allowed
  await adb.doc('requests/sw1').set({ kind: 'swap', staffId: users.staff.uid, staffName: 'Staff', shiftId: 'onLocked', shiftLabel: 'x', shiftDate: LOCKED_DAY, toStaffId: '', toStaffName: '', status: 'pending', createdAt: new Date() });
  denied(await callFn('decideRequest', 'manager', { kind: 'request', id: 'sw1', status: 'approved' }), 'FAILED_PRECONDITION');
  assert.equal((await adb.doc('shifts/onLocked').get()).get('staffId'), users.staff.uid);
  ok(await callFn('decideRequest', 'owner', { kind: 'request', id: 'sw1', status: 'approved' }));
  assert.equal((await adb.doc('shifts/onLocked').get()).get('staffId'), '');
  // swap on an unlocked day still works for a manager
  await adb.doc('requests/sw2').set({ kind: 'swap', staffId: users.staff.uid, staffName: 'Staff', shiftId: 'onOpen', shiftLabel: 'x', shiftDate: OPEN_DAY, toStaffId: '', toStaffName: '', status: 'pending', createdAt: new Date() });
  ok(await callFn('decideRequest', 'manager', { kind: 'request', id: 'sw2', status: 'approved' }));
  // manager removing a leaver keeps their shifts on approved days
  await seedShift('leaverLocked', LOCKED_DAY);
  await seedShift('leaverOpen', OPEN_DAY);
  const r = ok(await callFn('deleteStaff', 'manager', { uid: users.staff.uid }));
  assert.equal(r.keptLocked, 3); // draftLocked, ownerDraft and leaverLocked are all on the approved day
  assert.equal((await adb.doc('shifts/leaverLocked').get()).exists, true);
  assert.equal((await adb.doc('shifts/leaverOpen').get()).exists, false);
});

test('concurrent ticks: exactly one approval wins', async () => {
  const rs = await Promise.all([callFn('approveDay', 'manager', { date: OPEN_DAY }), callFn('approveDay', 'manager2', { date: OPEN_DAY }), callFn('approveDay', 'owner', { date: OPEN_DAY })]);
  assert.equal(rs.filter((r) => r.result).length, 1, JSON.stringify(rs));
  assert.equal(rs.filter((r) => r.error && r.error.status === 'ALREADY_EXISTS').length, 2);
});

test('a manager cannot approve a day inside a week that is already approved; the owner can', async () => {
  await adb.doc(`weeks/${WEEK}`).set({ status: 'approved' });
  denied(await callFn('approveDay', 'manager', { date: OPEN_DAY }), 'FAILED_PRECONDITION');
  ok(await callFn('approveDay', 'owner', { date: OPEN_DAY }));
  // owner-approved: the owner can unlock any time; a manager never can
  denied(await callFn('unapproveDay', 'manager', { date: OPEN_DAY }), 'PERMISSION_DENIED');
  ok(await callFn('unapproveDay', 'owner', { date: OPEN_DAY }));
});
