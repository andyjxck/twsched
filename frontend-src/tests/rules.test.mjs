// Security rules tests. Run: npm run test:rules (starts the Firestore + Storage emulators).
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, collection, query, where, serverTimestamp, addDoc } from 'firebase/firestore';
import { ref, uploadBytes, getBytes } from 'firebase/storage';

let env;
const OWNER = 'owner1', MGR = 'mgr1', ALICE = 'alice', BOB = 'bob';

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-twsched',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
    storage: { rules: readFileSync('storage.rules', 'utf8'), host: '127.0.0.1', port: 9199 },
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'staff', ALICE), { name: 'Alice', role: 'staff', active: true });
    // Right to Work on file for Alice and Bob (server-written in real life), so they can be put on shifts
    await setDoc(doc(db, 'rtwStatus', ALICE), { staffId: ALICE, ok: true, count: 1 });
    await setDoc(doc(db, 'rtwStatus', BOB), { staffId: BOB, ok: true, count: 1 });
    await setDoc(doc(db, 'shifts', 'pub'), { staffId: ALICE, staffName: 'Alice', date: '2030-01-07', week: '2030-01-07', start: '17:00', end: '23:00', published: true });
    await setDoc(doc(db, 'shifts', 'draft'), { staffId: ALICE, staffName: 'Alice', date: '2030-01-08', week: '2030-01-07', start: '17:00', end: '23:00', published: false });
    await setDoc(doc(db, 'shifts', 'bobpub'), { staffId: BOB, staffName: 'Bob', date: '2030-01-07', week: '2030-01-07', start: '17:00', end: '23:00', published: true });
    await setDoc(doc(db, 'shifts', 'locked'), { staffId: ALICE, staffName: 'Alice', date: '2030-01-15', week: '2030-01-14', start: '17:00', end: '23:00', published: true });
    await setDoc(doc(db, 'weeks', '2030-01-14'), { status: 'approved' });
    await setDoc(doc(db, 'payslips', 'mgr1_2029-01'), { staffId: MGR, staffName: 'Mgr', period: 'Apr 2029', slot: '2029-01', storagePath: 'payslips/mgr1/mgr1_2029-01.pdf' });
    await setDoc(doc(db, 'events', 'pub'), { title: 'Quiz', date: '2030-01-07', onWebsite: true });
    await setDoc(doc(db, 'events', 'priv'), { title: 'Staff party', date: '2030-01-08', onWebsite: false });
    await setDoc(doc(db, 'payslips', 'pa'), { staffId: ALICE, staffName: 'Alice', period: 'Jan', payDate: '2030-01-31', storagePath: 'payslips/alice/pa.pdf' });
    await setDoc(doc(db, 'enquiries', 'e1'), { name: 'X', email: 'x@y.z', message: 'hi', status: 'new' });
    await setDoc(doc(db, 'notifications', 'n1'), { uid: ALICE, title: 't', read: false });
    await setDoc(doc(db, 'timeOff', 't1'), { staffId: ALICE, staffName: 'Alice', from: '2030-01-01', to: '2030-01-02', status: 'pending' });
    await setDoc(doc(db, 'private', 'mail'), { pass: 'secret' });
    await setDoc(doc(db, 'public', 'events'), { events: [] });
    await uploadBytes(ref(ctx.storage(), 'payslips/alice/pa.pdf'), new Uint8Array([37, 80, 68, 70]), { contentType: 'application/pdf' });
  });
});

const as = (uid, role) => env.authenticatedContext(uid, role ? { role, email: `${uid}@x.com` } : { email: `${uid}@x.com` });
const anon = () => env.unauthenticatedContext();
const shift = (uid, extra = {}) => ({ staffId: ALICE, staffName: 'Alice', date: '2030-02-01', week: '2030-01-28', start: '09:00', end: '17:00', breakStart: '12:00', breakEnd: '12:30', breakPaid: false, area: 'Bar', notes: '', eventId: '', eventTitle: '', published: false, updatedAt: serverTimestamp(), updatedBy: uid, ...extra });
const slip = (uid, staffId, slot, extra = {}) => ({ staffId, staffName: 'X', period: 'Apr 2030', slot, taxYear: Number(slot.slice(0, 4)), taxMonth: Number(slot.slice(5)), payDate: '', fileName: 'a.pdf', storagePath: `payslips/${staffId}/${staffId}_${slot}.pdf`, size: 1000, uploadedAt: serverTimestamp(), uploadedBy: uid, uploadedByName: 'M', ...extra });

// ---------- public / anonymous
test('public can read website events and the feed, not private events', async () => {
  const db = anon().firestore();
  await assertSucceeds(getDoc(doc(db, 'events', 'pub')));
  await assertFails(getDoc(doc(db, 'events', 'priv')));
  await assertSucceeds(getDocs(query(collection(db, 'events'), where('onWebsite', '==', true))));
  await assertFails(getDocs(collection(db, 'events')));
  await assertSucceeds(getDoc(doc(db, 'public', 'events')));
  await assertFails(setDoc(doc(db, 'public', 'events'), { events: [] }));
});
test('public cannot read staff data', async () => {
  const db = anon().firestore();
  for (const p of ['staff/alice', 'shifts/pub', 'payslips/pa', 'enquiries/e1', 'notifications/n1', 'timeOff/t1', 'private/mail']) {
    await assertFails(getDoc(doc(db, p)));
  }
});
test('nobody can write enquiries or rate-limit counters directly (only the submitEnquiry function)', async () => {
  const good = { name: 'Jo Bloggs', email: 'jo@example.com', phone: '0123', occasion: 'Birthday', date: '2030-05-01', guests: 40, message: 'Hello', source: 'website', status: 'new', via: 'submitEnquiry', createdAt: serverTimestamp() };
  for (const ctx of [anon(), as('rando'), as(ALICE, 'staff'), as(MGR, 'manager'), as(OWNER, 'owner')]) {
    const db = ctx.firestore();
    await assertFails(addDoc(collection(db, 'enquiries'), good));
    await assertFails(setDoc(doc(db, 'enquiries', 'forged'), good));
    await assertFails(setDoc(doc(db, 'rateLimits', 'x'), { count: 0 }));
    await assertFails(getDoc(doc(db, 'rateLimits', 'x')));
    await assertFails(getDoc(doc(db, 'private', 'rateLimitSalt')));
  }
  await assertFails(getDocs(collection(anon().firestore(), 'enquiries')));
});
test('signed in without a role is treated like the public', async () => {
  const db = as('rando').firestore();
  await assertFails(getDoc(doc(db, 'staff', ALICE)));
  await assertFails(getDoc(doc(db, 'shifts', 'pub')));
});

// ---------- staff
test('staff see only their own published shifts (no full rota) and cannot edit the rota', async () => {
  const db = as(BOB, 'staff').firestore();
  await assertSucceeds(getDoc(doc(db, 'shifts', 'bobpub')));
  await assertFails(getDoc(doc(db, 'shifts', 'pub')));
  await assertFails(getDoc(doc(db, 'shifts', 'draft')));
  await assertSucceeds(getDocs(query(collection(db, 'shifts'), where('staffId', '==', BOB), where('published', '==', true))));
  await assertFails(getDocs(query(collection(db, 'shifts'), where('published', '==', true))));
  await assertFails(getDocs(collection(db, 'shifts')));
  await assertSucceeds(getDoc(doc(db, 'weeks', '2030-01-14')));
  await assertFails(setDoc(doc(db, 'weeks', '2030-01-21'), { status: 'approved' }));
  await assertFails(setDoc(doc(db, 'shifts', 'new'), shift(BOB)));
  await assertFails(deleteDoc(doc(db, 'shifts', 'pub')));
  await assertSucceeds(getDoc(doc(db, 'events', 'priv')));
  await assertFails(setDoc(doc(db, 'events', 'x'), { title: 'x', date: '2030-01-01', onWebsite: true, updatedAt: serverTimestamp(), updatedBy: BOB }));
  await assertSucceeds(getDoc(doc(db, 'staff', ALICE)));
  await assertFails(updateDoc(doc(db, 'staff', ALICE), { role: 'owner' }));
});
test('staff see only their own payslips', async () => {
  await assertSucceeds(getDoc(doc(as(ALICE, 'staff').firestore(), 'payslips', 'pa')));
  await assertFails(getDoc(doc(as(BOB, 'staff').firestore(), 'payslips', 'pa')));
  await assertSucceeds(getDocs(query(collection(as(ALICE, 'staff').firestore(), 'payslips'), where('staffId', '==', ALICE))));
  await assertFails(getDocs(collection(as(BOB, 'staff').firestore(), 'payslips')));
  await assertSucceeds(getBytes(ref(as(ALICE, 'staff').storage(), 'payslips/alice/pa.pdf')));
  await assertFails(getBytes(ref(as(BOB, 'staff').storage(), 'payslips/alice/pa.pdf')));
  await assertFails(getBytes(ref(anon().storage(), 'payslips/alice/pa.pdf')));
  await assertFails(uploadBytes(ref(as(ALICE, 'staff').storage(), 'payslips/alice/x.pdf'), new Uint8Array([1]), { contentType: 'application/pdf' }));
});
test('staff time off: own requests, can cancel, cannot approve', async () => {
  const a = as(ALICE, 'staff').firestore();
  await assertSucceeds(addDoc(collection(a, 'timeOff'), { staffId: ALICE, staffName: 'Alice', from: '2030-03-01', to: '2030-03-02', reason: '', paid: false, status: 'pending', createdAt: serverTimestamp() }));
  await assertFails(addDoc(collection(a, 'timeOff'), { staffId: ALICE, staffName: 'Alice', from: '2030-03-01', to: '2030-03-02', reason: '', paid: 'yes', status: 'pending', createdAt: serverTimestamp() }));
  await assertFails(addDoc(collection(a, 'timeOff'), { staffId: BOB, staffName: 'Bob', from: '2030-03-01', to: '2030-03-02', status: 'pending', createdAt: serverTimestamp() }));
  await assertFails(addDoc(collection(a, 'timeOff'), { staffId: ALICE, staffName: 'Alice', from: '2030-03-01', to: '2030-03-02', status: 'approved', createdAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(a, 'timeOff', 't1'), { status: 'approved' }));
  await assertFails(getDoc(doc(as(BOB, 'staff').firestore(), 'timeOff', 't1')));
  await assertSucceeds(updateDoc(doc(a, 'timeOff', 't1'), { status: 'cancelled' }));
});
test('notifications: own only, can only flip read', async () => {
  const a = as(ALICE, 'staff').firestore();
  await assertSucceeds(getDoc(doc(a, 'notifications', 'n1')));
  await assertFails(getDoc(doc(as(BOB, 'staff').firestore(), 'notifications', 'n1')));
  await assertSucceeds(updateDoc(doc(a, 'notifications', 'n1'), { read: true }));
  await assertFails(updateDoc(doc(a, 'notifications', 'n1'), { title: 'hacked' }));
  await assertFails(addDoc(collection(a, 'notifications'), { uid: BOB, title: 'spam', read: false }));
});
test('staff cannot see enquiries or mail settings', async () => {
  const a = as(ALICE, 'staff').firestore();
  await assertFails(getDoc(doc(a, 'enquiries', 'e1')));
  await assertFails(getDoc(doc(a, 'private', 'mail')));
});

// ---------- managers
test('managers run the rota, events, payslips and enquiries', async () => {
  const m = as(MGR, 'manager').firestore();
  await assertSucceeds(getDoc(doc(m, 'shifts', 'draft')));
  await assertSucceeds(setDoc(doc(m, 'shifts', 'new'), shift(MGR)));
  await assertFails(setDoc(doc(m, 'shifts', 'bad'), shift(MGR, { start: '25:00' })));
  await assertFails(setDoc(doc(m, 'shifts', 'bad2'), shift(MGR, { updatedBy: 'someoneelse' })));
  await assertSucceeds(deleteDoc(doc(m, 'shifts', 'pub')));
  await assertSucceeds(setDoc(doc(m, 'events', 'e'), { title: 'Live music', date: '2030-01-10', start: '20:00', end: '', room: 'Bar', description: '', repeat: 'weekly', onWebsite: true, staffNeeded: 2, updatedAt: serverTimestamp(), updatedBy: MGR }));
  // payslips: only the owner manages them (20 Oct least-privilege change); managers can't read others'
  await assertFails(setDoc(doc(m, 'payslips', 'alice_2030-01'), slip(MGR, ALICE, '2030-01')));
  await assertFails(getDoc(doc(m, 'payslips', 'pa')));
  await assertFails(getDocs(collection(m, 'payslips')));
  const o = as(OWNER, 'owner').firestore();
  await assertSucceeds(setDoc(doc(o, 'payslips', 'alice_2030-01'), slip(OWNER, ALICE, '2030-01')));
  await assertFails(setDoc(doc(o, 'payslips', 'alice_2030-02'), slip(OWNER, ALICE, '2030-02', { storagePath: 'payslips/bob/alice_2030-02.pdf' })));
  await assertFails(setDoc(doc(o, 'payslips', 'random'), slip(OWNER, ALICE, '2030-03')));
  await assertFails(setDoc(doc(o, 'payslips', 'alice_2030-13'), slip(OWNER, ALICE, '2030-13')));
  await assertSucceeds(getDocs(collection(m, 'enquiries')));
  await assertSucceeds(updateDoc(doc(m, 'enquiries', 'e1'), { status: 'replied', handledBy: MGR, handledAt: serverTimestamp(), staffNote: 'called' }));
  await assertFails(updateDoc(doc(m, 'enquiries', 'e1'), { email: 'changed@x.com' }));
  // decisions only through the decideRequest function (records who decided)
  await assertFails(updateDoc(doc(m, 'timeOff', 't1'), { status: 'approved', decidedBy: MGR, decidedAt: serverTimestamp(), managerNote: '' }));
  await assertFails(getDoc(doc(m, 'private', 'mail')));
  await assertFails(setDoc(doc(m, 'staff', 'x'), { name: 'x', role: 'owner' }));
  const st = as(MGR, 'manager').storage();
  await assertFails(uploadBytes(ref(st, 'payslips/alice/p2.pdf'), new Uint8Array([37, 80, 68, 70]), { contentType: 'application/pdf' }));
  await assertFails(uploadBytes(ref(st, 'payslips/mgr1/mine.pdf'), new Uint8Array([37, 80, 68, 70]), { contentType: 'application/pdf' }));
  await assertFails(getBytes(ref(st, 'payslips/alice/pa.pdf')));
  const ost = as(OWNER, 'owner').storage();
  await assertSucceeds(uploadBytes(ref(ost, 'payslips/alice/p2.pdf'), new Uint8Array([37, 80, 68, 70]), { contentType: 'application/pdf' }));
  await assertFails(uploadBytes(ref(ost, 'payslips/alice/evil.exe'), new Uint8Array([1]), { contentType: 'application/pdf' }));
  await assertFails(uploadBytes(ref(ost, 'payslips/alice/p4.pdf'), new Uint8Array([1]), { contentType: 'text/html' }));
  await assertSucceeds(getBytes(ref(ost, 'payslips/alice/pa.pdf')));
  await assertFails(uploadBytes(ref(st, 'other/x.pdf'), new Uint8Array([1]), { contentType: 'application/pdf' }));
});

test('approved weeks are locked for managers, not for the owner', async () => {
  const m = as(MGR, 'manager').firestore();
  const o = as(OWNER, 'owner').firestore();
  const lockedShift = (uid) => shift(uid, { date: '2030-01-16', week: '2030-01-14' });
  await assertFails(setDoc(doc(m, 'shifts', 'nl'), lockedShift(MGR)));
  await assertFails(updateDoc(doc(m, 'shifts', 'locked'), { ...lockedShift(MGR) }));
  await assertFails(deleteDoc(doc(m, 'shifts', 'locked')));
  // moving a locked shift into an open week is still a change to the locked week
  await assertFails(setDoc(doc(m, 'shifts', 'locked'), shift(MGR)));
  await assertSucceeds(setDoc(doc(o, 'shifts', 'nl'), lockedShift(OWNER)));
  await assertSucceeds(deleteDoc(doc(o, 'shifts', 'locked')));
});
test('shift week must be the Monday of its date; open and overnight shifts allowed', async () => {
  const m = as(MGR, 'manager').firestore();
  await assertFails(setDoc(doc(m, 'shifts', 'w1'), shift(MGR, { week: '2030-01-29' })));
  await assertFails(setDoc(doc(m, 'shifts', 'w2'), shift(MGR, { week: '2030-01-21' })));
  await assertSucceeds(setDoc(doc(m, 'shifts', 'open'), shift(MGR, { staffId: '', staffName: 'Open shift' })));
  await assertSucceeds(setDoc(doc(m, 'shifts', 'night'), shift(MGR, { start: '22:00', end: '03:00', breakStart: '', breakEnd: '', breakPaid: true })));
  await assertFails(setDoc(doc(m, 'shifts', 'b'), shift(MGR, { breakPaid: 'no' })));
  // per-shift 'Shift leader' star: a plain true/false flag on the shift
  await assertSucceeds(setDoc(doc(m, 'shifts', 'lead'), shift(MGR, { leader: true })));
  await assertSucceeds(setDoc(doc(m, 'shifts', 'nolead'), shift(MGR, { leader: false })));
  await assertFails(setDoc(doc(m, 'shifts', 'lead2'), shift(MGR, { leader: 'yes' })));
});
test('payslips: managers cannot upload or remove any (own included) but read their own; owner can', async () => {
  const m = as(MGR, 'manager').firestore();
  const o = as(OWNER, 'owner').firestore();
  await assertFails(setDoc(doc(m, 'payslips', 'mgr1_2030-01'), slip(MGR, MGR, '2030-01')));
  await assertFails(deleteDoc(doc(m, 'payslips', 'mgr1_2029-01')));
  await assertFails(deleteDoc(doc(m, 'payslips', 'pa')));
  await assertSucceeds(getDoc(doc(m, 'payslips', 'mgr1_2029-01')));
  await assertSucceeds(getDocs(query(collection(m, 'payslips'), where('staffId', '==', MGR))));
  await assertSucceeds(setDoc(doc(o, 'payslips', 'owner1_2030-01'), slip(OWNER, OWNER, '2030-01')));
  await assertSucceeds(setDoc(doc(o, 'payslips', 'mgr1_2030-01'), slip(OWNER, MGR, '2030-01')));
  await assertSucceeds(uploadBytes(ref(as(OWNER, 'owner').storage(), 'payslips/owner1/owner1_2030-01.pdf'), new Uint8Array([37, 80, 68, 70]), { contentType: 'application/pdf' }));
});
test('unavailability: own or by a manager, with a reason; others cannot read', async () => {
  const a = as(ALICE, 'staff').firestore();
  const u = (by, staffId, extra = {}) => ({ staffId, staffName: 'Alice', from: '2030-02-01', to: '2030-02-28', weekday: 2, reason: 'College', createdAt: serverTimestamp(), createdBy: by, ...extra });
  const r = await assertSucceeds(addDoc(collection(a, 'unavailability'), u(ALICE, ALICE)));
  await assertFails(addDoc(collection(a, 'unavailability'), u(ALICE, BOB)));
  await assertFails(addDoc(collection(a, 'unavailability'), u(ALICE, ALICE, { reason: '' })));
  await assertFails(addDoc(collection(a, 'unavailability'), u(ALICE, ALICE, { weekday: 9 })));
  await assertFails(getDoc(doc(as(BOB, 'staff').firestore(), 'unavailability', r.id)));
  await assertSucceeds(addDoc(collection(as(MGR, 'manager').firestore(), 'unavailability'), u(MGR, ALICE)));
  await assertSucceeds(deleteDoc(doc(a, 'unavailability', r.id)));
});
test('swap and problem requests: only for your own shift, cannot self-approve', async () => {
  const b = as(BOB, 'staff').firestore();
  const req = (extra = {}) => ({ kind: 'swap', staffId: BOB, staffName: 'Bob', shiftId: 'bobpub', shiftLabel: 'Mon 7 Jan 17:00-23:00', shiftDate: '2030-01-07', toStaffId: '', toStaffName: '', message: '', status: 'pending', createdAt: serverTimestamp(), ...extra });
  const r = await assertSucceeds(addDoc(collection(b, 'requests'), req()));
  await assertFails(addDoc(collection(b, 'requests'), req({ shiftId: 'pub' })));
  await assertFails(addDoc(collection(b, 'requests'), req({ status: 'approved' })));
  await assertFails(updateDoc(doc(b, 'requests', r.id), { status: 'approved' }));
  await assertFails(updateDoc(doc(as(MGR, 'manager').firestore(), 'requests', r.id), { status: 'approved' }));
  await assertSucceeds(updateDoc(doc(b, 'requests', r.id), { status: 'cancelled' }));
});
