// Rota availability: nobody (owner included) can be put on a shift on a day they are unavailable or on
// approved holiday. Firestore rules + addUnavailability / decideRequest / publishWeek / approveDay and the
// rotaBlocks triggers. Local emulators only, made-up accounts, no live data, no email.
// Run: npm run test:availability
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, addDoc, collection, writeBatch, runTransaction, serverTimestamp } from 'firebase/firestore';

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-twsched';
const FS_PORT = Number((process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':')[1]);
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099'}`;
const FN_HOST = process.env.FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001';
const FN = (name) => `http://${FN_HOST}/${PROJECT}/europe-west2/${name}`;

// a week inside the indexed horizon: Mon 2027-03-01 .. Sun 2027-03-07
const WEEK = '2027-03-01';
const MON = '2027-03-01'; const TUE = '2027-03-02'; const WED = '2027-03-03'; const THU = '2027-03-04'; const FRI = '2027-03-05';
const weekOf = (d) => (d >= '2027-03-08' ? (d >= '2027-03-15' ? '2027-03-15' : '2027-03-08') : WEEK);

let env; let adb;
const users = {};
const ROLES = { owner: 'owner', manager: 'manager', staff: 'staff', staff2: 'staff' };

async function makeUser(key, role) {
  const email = `${key}@hotel.test`;
  let u;
  try { u = await admin.auth().getUserByEmail(email); } catch { u = await admin.auth().createUser({ email, password: 'Emulator-only-pw1' }); }
  await admin.auth().setCustomUserClaims(u.uid, { role });
  await adb.doc(`staff/${u.uid}`).set({ name: key[0].toUpperCase() + key.slice(1), email, role, active: true, onRota: true });
  // right-to-work is checked on file for everyone here (a separate rule), so only availability is being tested
  await adb.doc(`rtwStatus/${u.uid}`).set({ ok: true });
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Emulator-only-pw1', returnSecureToken: true }),
  });
  users[key] = { uid: u.uid, token: (await r.json()).idToken };
}
async function callFn(name, who, data) {
  const r = await fetch(FN(name), {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${users[who].token}` },
    body: JSON.stringify({ data }),
  });
  return r.json();
}
const ok = (r) => { assert.ok(r.result && !r.error, JSON.stringify(r)); return r.result; };
const refused = (r, status) => { assert.ok(r.error, `expected an error, got ${JSON.stringify(r)}`); if (status) assert.equal(r.error.status, status, JSON.stringify(r)); return r.error; };
const client = (who) => env.authenticatedContext(users[who].uid, { role: ROLES[who], email: `${who}@hotel.test` }).firestore();
const shift = (who, extra = {}) => {
  const s = {
    staffId: users.staff.uid, staffName: 'Staff', date: THU, start: '17:00', end: '23:00',
    breakStart: '', breakEnd: '', breakPaid: true, area: 'Bar', notes: '', eventId: '', eventTitle: '',
    published: false, updatedAt: serverTimestamp(), updatedBy: users[who].uid, ...extra,
  };
  s.week = extra.week || weekOf(s.date);
  return s;
};
const seedShift = (id, extra = {}) => {
  const s = {
    staffId: users.staff.uid, staffName: 'Staff', date: THU, start: '17:00', end: '23:00', breakStart: '', breakEnd: '',
    breakPaid: true, area: 'Bar', notes: '', eventId: '', eventTitle: '', published: true, updatedAt: new Date(), updatedBy: 'seed', ...extra,
  };
  s.week = weekOf(s.date);
  return adb.doc(`shifts/${id}`).set(s);
};
const blocksOf = async (who, year = '2027') => {
  const s = await adb.doc(`rotaBlocks/${users[who].uid}_${year}`).get();
  return s.exists ? s.get('d') : {};
};
async function until(fn, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - t0 > ms) throw new Error('timed out waiting for the trigger');
    await new Promise((r) => setTimeout(r, 250));
  }
}
const addHoliday = async (who, from, to, paid) => {
  const ref = await adb.collection('timeOff').add({ staffId: users[who].uid, staffName: who, from, to, reason: 'Trip', paid, status: 'pending', createdAt: new Date() });
  return ref.id;
};

before(async () => {
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  adb = admin.firestore();
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: FS_PORT },
  });
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
});
after(async () => { await env.cleanup(); await admin.app().delete(); });
beforeEach(async () => {
  await env.clearFirestore();
  for (const [k, r] of Object.entries(ROLES)) await makeUser(k, r);
  // Staff: unavailable Wed 3 Mar (one day) and every Friday in March. Saved through the app's function.
  ok(await callFn('addUnavailability', 'staff', { from: WED, to: WED, weekday: 0, reason: 'Uni exam' }));
  ok(await callFn('addUnavailability', 'staff', { from: '2027-03-01', to: '2027-03-31', weekday: 5, reason: 'Childcare' }));
});

test('addUnavailability saves the record and its rota block together', async () => {
  const d = await blocksOf('staff');
  assert.deepEqual(d[WED], { k: 'unav', r: 'Uni exam' });
  assert.equal(d[FRI].k, 'unav');
  assert.equal(d['2027-03-12'].k, 'unav');
  assert.equal(d[THU], undefined, 'Thursday is free');
  assert.equal(d['2027-04-02'], undefined, 'the Friday after the range is free');
  const recs = await adb.collection('unavailability').where('staffId', '==', users.staff.uid).get();
  assert.equal(recs.size, 2);
  // staff can't mark someone else; a manager can
  refused(await callFn('addUnavailability', 'staff', { staffId: users.staff2.uid, from: THU, to: THU, weekday: 0, reason: 'x' }), 'PERMISSION_DENIED');
  ok(await callFn('addUnavailability', 'manager', { staffId: users.staff2.uid, from: THU, to: THU, weekday: 0, reason: 'Dentist' }));
  assert.equal((await blocksOf('staff2'))[THU].k, 'unav');
  refused(await callFn('addUnavailability', 'staff', { from: THU, to: WED, weekday: 0, reason: 'x' }), 'INVALID_ARGUMENT');
});

test('owner and manager cannot put someone on an unavailable day; open shifts and free days still work', async () => {
  for (const who of ['owner', 'manager']) {
    const c = client(who);
    await assertFails(setDoc(doc(c, `shifts/${who}Wed`), shift(who, { date: WED })));
    await assertFails(setDoc(doc(c, `shifts/${who}Fri`), shift(who, { date: FRI, published: true })));
    await assertFails(addDoc(collection(c, 'shifts'), shift(who, { date: '2027-03-19' })));
    await assertSucceeds(setDoc(doc(c, `shifts/${who}Thu`), shift(who, { date: THU })));
    await assertSucceeds(setDoc(doc(c, `shifts/${who}OpenWed`), shift(who, { date: WED, staffId: '', staffName: '' })));
    await assertSucceeds(setDoc(doc(c, `shifts/${who}OtherWed`), shift(who, { date: WED, staffId: users.staff2.uid, staffName: 'Staff2' })));
    await assertSucceeds(setDoc(doc(c, `shifts/${who}AprFri`), shift(who, { date: '2027-04-02', week: '2027-03-29' })));
  }
});

test('overnight and boundary times: a shift running past midnight into an unavailable day is refused', async () => {
  const c = client('owner');
  await assertFails(setDoc(doc(c, 'shifts/n1'), shift('owner', { date: TUE, start: '22:00', end: '02:00' })));
  await assertFails(setDoc(doc(c, 'shifts/n2'), shift('owner', { date: TUE, start: '09:00', end: '09:00' })));
  await assertFails(setDoc(doc(c, 'shifts/n3'), shift('owner', { date: THU, start: '20:00', end: '00:30' }))); // into Friday
  await assertSucceeds(setDoc(doc(c, 'shifts/b1'), shift('owner', { date: TUE, start: '18:00', end: '00:00' }))); // ends at midnight
  await assertSucceeds(setDoc(doc(c, 'shifts/b2'), shift('owner', { date: THU, start: '00:00', end: '06:00' }))); // day after
  await assertSucceeds(setDoc(doc(c, 'shifts/b3'), shift('owner', { date: TUE, start: '10:00', end: '23:59' })));
  // across a year boundary (rotaBlocks are per year): unavailable 1 Jan 2028, shift 31 Dec 2027 22:00-03:00
  ok(await callFn('addUnavailability', 'staff', { from: '2028-01-01', to: '2028-01-01', weekday: 0, reason: 'New year' }));
  await assertFails(setDoc(doc(c, 'shifts/y1'), shift('owner', { date: '2027-12-31', week: '2027-12-27', start: '22:00', end: '03:00' })));
  await assertSucceeds(setDoc(doc(c, 'shifts/y2'), shift('owner', { date: '2027-12-31', week: '2027-12-27', start: '12:00', end: '20:00' })));
});

test('editing: moving a shift onto an unavailable person/day/time is refused; other edits to an existing clash are kept', async () => {
  await seedShift('open', { date: WED, staffId: '', staffName: 'Open shift' });
  await seedShift('other', { date: WED, staffId: users.staff2.uid, staffName: 'Staff2' });
  await seedShift('thu', { date: THU });
  await seedShift('tue', { date: TUE, start: '17:00', end: '23:00' });
  await seedShift('clash', { date: WED, notes: 'was on before the exam was booked' }); // already on the rota
  for (const who of ['owner', 'manager']) {
    const c = client(who);
    await assertFails(updateDoc(doc(c, 'shifts/open'), { staffId: users.staff.uid, staffName: 'Staff', updatedAt: serverTimestamp(), updatedBy: users[who].uid }));
    await assertFails(updateDoc(doc(c, 'shifts/other'), { staffId: users.staff.uid, staffName: 'Staff', updatedAt: serverTimestamp(), updatedBy: users[who].uid }));
    await assertFails(updateDoc(doc(c, 'shifts/thu'), { date: FRI, updatedAt: serverTimestamp(), updatedBy: users[who].uid }));
    await assertFails(updateDoc(doc(c, 'shifts/tue'), { end: '01:00', updatedAt: serverTimestamp(), updatedBy: users[who].uid }));
    await assertFails(updateDoc(doc(c, 'shifts/clash'), { start: '18:00', updatedAt: serverTimestamp(), updatedBy: users[who].uid }));
    await assertSucceeds(updateDoc(doc(c, 'shifts/clash'), { notes: `checked by ${who}`, updatedAt: serverTimestamp(), updatedBy: users[who].uid }));
    await assertSucceeds(updateDoc(doc(c, 'shifts/thu'), { start: '16:00', updatedAt: serverTimestamp(), updatedBy: users[who].uid }));
  }
  const c = client('owner');
  await assertSucceeds(updateDoc(doc(c, 'shifts/clash'), { staffId: '', staffName: '', updatedAt: serverTimestamp(), updatedBy: users.owner.uid }));
  await assertSucceeds(deleteDoc(doc(c, 'shifts/other')));
  assert.equal((await adb.doc('shifts/tue').get()).get('end'), '23:00', 'refused edits change nothing');
});

test('batches and transactions cannot sneak a clash in', async () => {
  const c = client('owner');
  const b = writeBatch(c);
  b.set(doc(c, 'shifts/ok1'), shift('owner', { date: THU }));
  b.set(doc(c, 'shifts/bad1'), shift('owner', { date: WED }));
  await assertFails(b.commit());
  assert.equal((await adb.doc('shifts/ok1').get()).exists, false, 'the whole batch is refused');
  await seedShift('t1', { date: THU });
  await assertFails(runTransaction(c, async (t) => {
    await t.get(doc(c, 'shifts/t1'));
    t.update(doc(c, 'shifts/t1'), { date: WED, updatedAt: serverTimestamp(), updatedBy: users.owner.uid });
  }));
  // nobody can write the index directly, not even the owner
  await assertFails(setDoc(doc(c, `rotaBlocks/${users.staff.uid}_2027`), { staffId: users.staff.uid, year: 2027, d: {} }));
  await assertFails(deleteDoc(doc(c, `rotaBlocks/${users.staff.uid}_2027`)));
  await assertSucceeds(getDoc(doc(client('staff'), `rotaBlocks/${users.staff.uid}_2027`)));
  await assertFails(getDoc(doc(client('staff2'), `rotaBlocks/${users.staff.uid}_2027`)));
});

test('holiday: approved paid and unpaid block; pending and declined never do', async () => {
  const paid = await addHoliday('staff2', '2027-03-08', '2027-03-10', true);
  const unpaid = await addHoliday('staff2', '2027-03-15', '2027-03-15', false);
  const pend = await addHoliday('staff2', '2027-03-16', '2027-03-16', true);
  const decl = await addHoliday('staff2', '2027-03-17', '2027-03-17', false);
  const c = client('owner');
  const s2 = (date, id) => setDoc(doc(c, `shifts/${id}`), shift('owner', { date, staffId: users.staff2.uid, staffName: 'Staff2' }));
  await assertSucceeds(s2('2027-03-09', 'beforeApproval'));
  ok(await callFn('decideRequest', 'manager', { kind: 'timeOff', id: paid, status: 'approved' }));
  ok(await callFn('decideRequest', 'owner', { kind: 'timeOff', id: unpaid, status: 'approved' }));
  ok(await callFn('decideRequest', 'manager', { kind: 'timeOff', id: decl, status: 'declined' }));
  const d = await blocksOf('staff2');
  assert.deepEqual(d['2027-03-08'], { k: 'holiday', paid: true });
  assert.deepEqual(d['2027-03-15'], { k: 'holiday', paid: false });
  assert.equal(d['2027-03-16'], undefined, 'pending does not block');
  assert.equal(d['2027-03-17'], undefined, 'declined does not block');
  await assertFails(s2('2027-03-10', 'h1'));
  await assertFails(s2('2027-03-15', 'h2'));
  await assertFails(setDoc(doc(client('manager'), 'shifts/h3'), shift('manager', { date: '2027-03-07', week: WEEK, start: '20:00', end: '01:00', staffId: users.staff2.uid, staffName: 'Staff2' })));
  await assertSucceeds(s2('2027-03-16', 'h4'));
  await assertSucceeds(s2('2027-03-17', 'h5'));
  assert.equal((await adb.doc('shifts/beforeApproval').get()).exists, true, 'a shift already on the rota is not deleted');
  assert.equal((await adb.doc(`timeOff/${pend}`).get()).get('status'), 'pending');
  // the paid type the person asked for is unchanged by approval
  assert.equal((await adb.doc(`timeOff/${unpaid}`).get()).get('paid'), false);
});

test('triggers: deleting unavailability or cancelling approved holiday frees the day; a direct (older app) write is enforced', async () => {
  const wed = (await adb.collection('unavailability').where('from', '==', WED).get()).docs[0];
  await assertSucceeds(deleteDoc(doc(client('manager'), `unavailability/${wed.id}`)));
  await until(async () => !(await blocksOf('staff'))[WED]);
  await assertSucceeds(setDoc(doc(client('owner'), 'shifts/freed'), shift('owner', { date: WED })));
  assert.equal((await blocksOf('staff'))[FRI].k, 'unav', 'the other record still blocks');
  // older app version writing the record directly
  await assertSucceeds(addDoc(collection(client('staff2'), 'unavailability'), {
    staffId: users.staff2.uid, staffName: 'Staff2', from: MON, to: MON, weekday: 0, reason: 'Old app',
    createdAt: serverTimestamp(), createdBy: users.staff2.uid,
  }));
  await until(async () => !!(await blocksOf('staff2'))[MON]);
  await assertFails(setDoc(doc(client('owner'), 'shifts/oldapp'), shift('owner', { date: MON, staffId: users.staff2.uid, staffName: 'Staff2' })));
  // manager deletes an approved holiday
  const h = await addHoliday('staff2', '2027-03-22', '2027-03-22', true);
  ok(await callFn('decideRequest', 'manager', { kind: 'timeOff', id: h, status: 'approved' }));
  await assertSucceeds(deleteDoc(doc(client('manager'), `timeOff/${h}`)));
  await until(async () => !(await blocksOf('staff2'))['2027-03-22']);
});

test('swap approval to someone unavailable is refused and the shift stays put', async () => {
  await seedShift('swapme', { date: WED, staffId: users.staff2.uid, staffName: 'Staff2' });
  await adb.doc('requests/sw1').set({ kind: 'swap', staffId: users.staff2.uid, staffName: 'Staff2', shiftId: 'swapme', toStaffId: users.staff.uid, toStaffName: 'Staff', status: 'pending', createdAt: new Date() });
  const e = refused(await callFn('decideRequest', 'owner', { kind: 'request', id: 'sw1', status: 'approved' }), 'FAILED_PRECONDITION');
  assert.match(e.message, /unavailable on .*Uni exam/);
  assert.equal((await adb.doc('shifts/swapme').get()).get('staffId'), users.staff2.uid);
  assert.equal((await adb.doc('requests/sw1').get()).get('status'), 'pending');
  // to a free colleague it works
  await seedShift('swapok', { date: THU, staffId: users.staff2.uid, staffName: 'Staff2' });
  await adb.doc('requests/sw2').set({ kind: 'swap', staffId: users.staff2.uid, staffName: 'Staff2', shiftId: 'swapok', toStaffId: users.staff.uid, toStaffName: 'Staff', status: 'pending', createdAt: new Date() });
  ok(await callFn('decideRequest', 'manager', { kind: 'request', id: 'sw2', status: 'approved' }));
  assert.equal((await adb.doc('shifts/swapok').get()).get('staffId'), users.staff.uid);
});

test('publishing and approving a day never publish a clashing draft (left as it is)', async () => {
  await seedShift('draftClash', { date: WED, published: false });
  await seedShift('draftOk', { date: THU, published: false });
  await seedShift('draftSpill', { date: THU, start: '21:00', end: '01:00', published: false }); // into Friday
  const r = ok(await callFn('publishWeek', 'owner', { weekStart: WEEK }));
  assert.equal(r.skippedUnavailable, 2);
  assert.equal((await adb.doc('shifts/draftOk').get()).get('published'), true);
  assert.equal((await adb.doc('shifts/draftClash').get()).get('published'), false);
  assert.equal((await adb.doc('shifts/draftSpill').get()).get('published'), false);
  await seedShift('dayDraft', { date: WED, published: false, staffId: users.staff2.uid, staffName: 'Staff2' });
  ok(await callFn('approveDay', 'manager', { date: WED }));
  assert.equal((await adb.doc('shifts/dayDraft').get()).get('published'), true, 'the free person is published');
  const kept = await adb.doc('shifts/draftClash').get();
  assert.equal(kept.get('published'), false);
  assert.equal(kept.get('staffId'), users.staff.uid, 'and not changed');
});

test('manager is told how many existing shifts clash when marking someone unavailable', async () => {
  await seedShift('mon', { date: MON, staffId: users.staff2.uid, staffName: 'Staff2' });
  await seedShift('sunNight', { date: '2027-02-28', start: '22:00', end: '02:00', staffId: users.staff2.uid, staffName: 'Staff2' });
  const r = ok(await callFn('addUnavailability', 'manager', { staffId: users.staff2.uid, from: MON, to: MON, weekday: 0, reason: 'Court' }));
  assert.equal(r.clashes, 2);
  assert.equal((await adb.doc('shifts/mon').get()).exists, true);
  const s = ok(await callFn('addUnavailability', 'staff2', { from: TUE, to: TUE, weekday: 0, reason: 'x' }));
  assert.equal(s.clashes, 0, 'staff are not told about drafts');
});

test('concurrency: simultaneous unavailability saves all land in the index; every write after a save is refused', async () => {
  const days = ['2027-03-08', '2027-03-09', '2027-03-10', '2027-03-11', '2027-03-13', '2027-03-14'];
  const rs = await Promise.all(days.map((d, i) => callFn('addUnavailability', i % 2 ? 'staff2' : 'manager', { staffId: users.staff2.uid, from: d, to: d, weekday: 0, reason: `r${i}` })));
  rs.forEach(ok);
  const d = await blocksOf('staff2');
  days.forEach((x) => assert.ok(d[x], `${x} indexed`));
  // race a save against a burst of assignments for the same day: once the save has returned, nothing gets through
  const DAY = '2027-03-18';
  const c = client('owner');
  let saved = false;
  const lateWins = [];
  const burst = (async () => {
    for (let i = 0; i < 25; i += 1) {
      const startedAfter = saved;
      try {
        await setDoc(doc(c, `shifts/race${i}`), shift('owner', { date: DAY, staffId: users.staff2.uid, staffName: 'Staff2' }));
        if (startedAfter) lateWins.push(i);
      } catch { /* refused */ }
    }
  })();
  await new Promise((r) => setTimeout(r, 30));
  ok(await callFn('addUnavailability', 'staff2', { from: DAY, to: DAY, weekday: 0, reason: 'Race' }));
  saved = true;
  await burst;
  assert.deepEqual(lateWins, [], 'no assignment started after the save succeeded');
  await Promise.all([1, 2, 3, 4, 5].map((i) => assertFails(setDoc(doc(client(i % 2 ? 'manager' : 'owner'), `shifts/after${i}`), shift('owner', { date: DAY, staffId: users.staff2.uid, staffName: 'Staff2', updatedBy: users[i % 2 ? 'manager' : 'owner'].uid })))));
  // concurrent approve + delete of different records keeps the index right
  const h = await addHoliday('staff2', '2027-03-25', '2027-03-26', false);
  const one = (await adb.collection('unavailability').where('reason', '==', 'r0').get()).docs[0];
  await Promise.all([callFn('decideRequest', 'owner', { kind: 'timeOff', id: h, status: 'approved' }), adb.doc(`unavailability/${one.id}`).delete()]);
  await until(async () => { const b = await blocksOf('staff2'); return !b['2027-03-08'] && b['2027-03-25'] && b['2027-03-26']; });
});
