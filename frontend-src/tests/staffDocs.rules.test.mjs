// Right to Work documents, payslip privacy and the RTW gate on shifts: security rules only.
// Run: firebase --config firebase.staffdocs-test.json emulators:exec --only firestore,storage --project demo-twsched \
//        'node --test tests/staffDocs.rules.test.mjs'
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, collection, query, where, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getBytes, deleteObject, getMetadata } from 'firebase/storage';

const FS_PORT = Number(process.env.FS_PORT || 28480);
const ST_PORT = Number(process.env.ST_PORT || 29599);
const OWNER = 'owner1', MGR = 'mgr1', MGR2 = 'mgr2', ALICE = 'alice', BOB = 'bob', NEWBIE = 'newbie';
const PDF = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10]); // "%PDF-1.7\n" (synthetic, not a real document)
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);
const ID20 = 'AbCdEfGhIjKlMnOpQrSt';
const ID20b = 'ZyXwVuTsRqPoNmLkJiHg';

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-twsched',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: FS_PORT },
    storage: { rules: readFileSync('storage.rules', 'utf8'), host: '127.0.0.1', port: ST_PORT },
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'staff', OWNER), { name: 'Olive', role: 'owner', active: true });
    await setDoc(doc(db, 'staff', MGR), { name: 'Mo', role: 'manager', active: true });
    await setDoc(doc(db, 'staff', MGR2), { name: 'Max', role: 'manager', active: true });
    await setDoc(doc(db, 'staff', ALICE), { name: 'Alice', role: 'staff', active: true });
    await setDoc(doc(db, 'staff', BOB), { name: 'Bob', role: 'staff', active: true });
    await setDoc(doc(db, 'staff', NEWBIE), { name: 'Newbie', role: 'staff', active: true });
    await setDoc(doc(db, 'rtwStatus', ALICE), { staffId: ALICE, ok: true, count: 1 });
    await setDoc(doc(db, 'rtwStatus', BOB), { staffId: BOB, ok: false, count: 0 });
    await setDoc(doc(db, 'staffDocs', ID20), meta(OWNER, ALICE, ID20, { checked: true, uploadedAt: new Date() }));
    await setDoc(doc(db, 'payslips', 'alice_2030-01'), { staffId: ALICE, slot: '2030-01', storagePath: 'payslips/alice/alice_2030-01.pdf' });
    await setDoc(doc(db, 'payslips', 'mgr1_2030-01'), { staffId: MGR, slot: '2030-01', storagePath: 'payslips/mgr1/mgr1_2030-01.pdf' });
    await setDoc(doc(db, 'shifts', 'bobs'), shiftRaw(BOB));
    const st = ctx.storage();
    await uploadBytes(ref(st, `rtw/${ALICE}/${ID20}.pdf`), PDF, { contentType: 'application/pdf' });
    await uploadBytes(ref(st, 'payslips/alice/alice_2030-01.pdf'), PDF, { contentType: 'application/pdf' });
    await uploadBytes(ref(st, 'payslips/mgr1/mgr1_2030-01.pdf'), PDF, { contentType: 'application/pdf' });
  });
});

const as = (uid, role) => env.authenticatedContext(uid, { role, email: `${uid}@x.com` });
const anon = () => env.unauthenticatedContext();
function meta(by, staffId, id, extra = {}) {
  return {
    staffId, staffName: 'X', kind: 'rtw', docType: 'passport', fileName: 'passport.pdf', contentType: 'application/pdf',
    size: PDF.length, storagePath: `rtw/${staffId}/${id}.pdf`, uploadedAt: serverTimestamp(), uploadedBy: by, uploadedByName: 'Y', ...extra,
  };
}
function shiftRaw(staffId, extra = {}) {
  return { staffId, staffName: 'S', date: '2030-02-01', week: '2030-01-28', start: '09:00', end: '17:00', breakStart: '', breakEnd: '', breakPaid: true, area: 'Bar', notes: '', eventId: '', eventTitle: '', published: false, ...extra };
}
const shift = (by, staffId, extra = {}) => shiftRaw(staffId, { updatedAt: serverTimestamp(), updatedBy: by, ...extra });
const up = (ctx, path, bytes = PDF, ct = 'application/pdf') => uploadBytes(ref(ctx.storage(), path), bytes, { contentType: ct });

// ---------------- Right to Work: reading ----------------
test('RTW files and metadata: only the owner can read them', async () => {
  await assertSucceeds(getBytes(ref(as(OWNER, 'owner').storage(), `rtw/${ALICE}/${ID20}.pdf`)));
  await assertSucceeds(getDoc(doc(as(OWNER, 'owner').firestore(), 'staffDocs', ID20)));
  await assertSucceeds(getDocs(query(collection(as(OWNER, 'owner').firestore(), 'staffDocs'), where('staffId', '==', ALICE))));
  for (const [u, r] of [[MGR, 'manager'], [ALICE, 'staff'], [BOB, 'staff']]) {
    await assertFails(getBytes(ref(as(u, r).storage(), `rtw/${ALICE}/${ID20}.pdf`)));
    await assertFails(getMetadata(ref(as(u, r).storage(), `rtw/${ALICE}/${ID20}.pdf`)));
    await assertFails(getDoc(doc(as(u, r).firestore(), 'staffDocs', ID20)));
    await assertFails(getDocs(query(collection(as(u, r).firestore(), 'staffDocs'), where('staffId', '==', ALICE))));
  }
  await assertFails(getBytes(ref(anon().storage(), `rtw/${ALICE}/${ID20}.pdf`)));
  await assertFails(getDoc(doc(anon().firestore(), 'staffDocs', ID20)));
  // someone stuck at the first-password gate is not the owner yet
  await assertFails(getBytes(ref(env.authenticatedContext(OWNER, { role: 'owner', pwChange: true }).storage(), `rtw/${ALICE}/${ID20}.pdf`)));
});

test('RTW tick (rtwStatus): managers and owner can read, staff cannot, nobody can write', async () => {
  await assertSucceeds(getDoc(doc(as(MGR, 'manager').firestore(), 'rtwStatus', ALICE)));
  await assertSucceeds(getDocs(collection(as(OWNER, 'owner').firestore(), 'rtwStatus')));
  await assertFails(getDoc(doc(as(ALICE, 'staff').firestore(), 'rtwStatus', ALICE)));
  await assertFails(getDoc(doc(as(ALICE, 'staff').firestore(), 'rtwStatus', BOB)));
  for (const [u, r] of [[OWNER, 'owner'], [MGR, 'manager'], [BOB, 'staff']]) {
    await assertFails(setDoc(doc(as(u, r).firestore(), 'rtwStatus', BOB), { staffId: BOB, ok: true, count: 1 }));
  }
});

// ---------------- Right to Work: uploading ----------------
test('owner can upload RTW for anyone, including themselves and managers', async () => {
  const o = as(OWNER, 'owner');
  for (const who of [BOB, MGR, OWNER]) {
    await assertSucceeds(up(o, `rtw/${who}/${ID20b}.pdf`));
    await assertSucceeds(setDoc(doc(o.firestore(), 'staffDocs', ID20b.slice(0, 19) + who.slice(0, 1).toUpperCase()), meta(OWNER, who, ID20b.slice(0, 19) + who.slice(0, 1).toUpperCase())));
  }
  await assertSucceeds(up(o, `rtw/${BOB}/${'P'.repeat(20)}.jpg`, JPG, 'image/jpeg'));
});

test('manager can upload (write-only) for staff-role people only, never their own, another manager or the owner', async () => {
  const m = as(MGR, 'manager');
  await assertSucceeds(up(m, `rtw/${NEWBIE}/${ID20b}.pdf`));
  await assertSucceeds(setDoc(doc(m.firestore(), 'staffDocs', ID20b), meta(MGR, NEWBIE, ID20b)));
  // ...but cannot then read, overwrite or remove what they uploaded
  await assertFails(getBytes(ref(m.storage(), `rtw/${NEWBIE}/${ID20b}.pdf`)));
  await assertFails(getDoc(doc(m.firestore(), 'staffDocs', ID20b)));
  await assertFails(up(m, `rtw/${NEWBIE}/${ID20b}.pdf`));
  await assertFails(deleteObject(ref(m.storage(), `rtw/${NEWBIE}/${ID20b}.pdf`)));
  await assertFails(deleteDoc(doc(m.firestore(), 'staffDocs', ID20b)));
  // not for themselves, another manager or the owner
  for (const who of [MGR, MGR2, OWNER]) {
    await assertFails(up(m, `rtw/${who}/${'Q'.repeat(20)}.pdf`));
    await assertFails(setDoc(doc(m.firestore(), 'staffDocs', 'Q'.repeat(20)), meta(MGR, who, 'Q'.repeat(20))));
  }
  // not for someone with no staff record
  await assertFails(up(m, `rtw/ghost/${'R'.repeat(20)}.pdf`));
  await assertFails(setDoc(doc(m.firestore(), 'staffDocs', 'R'.repeat(20)), meta(MGR, 'ghost', 'R'.repeat(20))));
  // cannot overwrite an existing file of someone else's
  await assertFails(up(m, `rtw/${ALICE}/${ID20}.pdf`));
});

test('staff cannot upload or delete any RTW documents, not even their own', async () => {
  const a = as(ALICE, 'staff');
  await assertFails(up(a, `rtw/${ALICE}/${ID20b}.pdf`));
  await assertFails(setDoc(doc(a.firestore(), 'staffDocs', ID20b), meta(ALICE, ALICE, ID20b)));
  await assertFails(deleteObject(ref(a.storage(), `rtw/${ALICE}/${ID20}.pdf`)));
  await assertFails(deleteDoc(doc(a.firestore(), 'staffDocs', ID20)));
  await assertFails(up(anon(), `rtw/${ALICE}/${ID20b}.pdf`));
});

test('RTW uploads: type, size, name and metadata are validated', async () => {
  const o = as(OWNER, 'owner');
  await assertFails(up(o, `rtw/${BOB}/${ID20b}.pdf`, PDF, 'text/html'));
  await assertFails(up(o, `rtw/${BOB}/${ID20b}.html`, PDF, 'text/html'));
  await assertFails(up(o, `rtw/${BOB}/${ID20b}.jpg`, PDF, 'application/pdf')); // extension must match the type
  await assertFails(up(o, `rtw/${BOB}/short.pdf`));
  await assertFails(up(o, `rtw/${BOB}/${ID20b}.svg`, PDF, 'image/svg+xml'));
  await assertFails(up(o, `rtw/${BOB}/${ID20b}.pdf`, new Uint8Array(10 * 1024 * 1024 + 1), 'application/pdf'));
  await assertFails(up(o, `rtw/${BOB}/${ID20b}.pdf`, new Uint8Array(0), 'application/pdf'));
  const f = o.firestore();
  await assertFails(setDoc(doc(f, 'staffDocs', ID20b), meta(OWNER, BOB, ID20b, { storagePath: `rtw/${ALICE}/${ID20b}.pdf` })));
  await assertFails(setDoc(doc(f, 'staffDocs', ID20b), meta(OWNER, BOB, ID20b, { contentType: 'text/html' })));
  await assertFails(setDoc(doc(f, 'staffDocs', ID20b), meta(OWNER, BOB, ID20b, { size: 11 * 1024 * 1024 })));
  await assertFails(setDoc(doc(f, 'staffDocs', ID20b), meta(OWNER, BOB, ID20b, { uploadedBy: MGR })));
  await assertFails(setDoc(doc(f, 'staffDocs', ID20b), meta(OWNER, BOB, ID20b, { checked: true })));
  await assertFails(setDoc(doc(f, 'staffDocs', ID20b), meta(OWNER, BOB, ID20b, { kind: 'payslip' })));
  await assertFails(setDoc(doc(f, 'staffDocs', ID20b), meta(OWNER, BOB, ID20b, { docType: 'selfie' })));
  await assertFails(setDoc(doc(f, 'staffDocs', 'bad-id'), meta(OWNER, BOB, 'bad-id')));
  // metadata is never edited, only added or removed
  await assertFails(updateDoc(doc(f, 'staffDocs', ID20), { fileName: 'x.pdf' }));
});

test('owner can remove RTW documents; nobody else can', async () => {
  await assertFails(deleteObject(ref(as(MGR, 'manager').storage(), `rtw/${ALICE}/${ID20}.pdf`)));
  await assertFails(deleteDoc(doc(as(MGR, 'manager').firestore(), 'staffDocs', ID20)));
  await assertSucceeds(deleteObject(ref(as(OWNER, 'owner').storage(), `rtw/${ALICE}/${ID20}.pdf`)));
  await assertSucceeds(deleteDoc(doc(as(OWNER, 'owner').firestore(), 'staffDocs', ID20)));
});

// ---------------- Payslips ----------------
test('payslips: everyone reads only their own; managers cannot see or manage anyone else\'s', async () => {
  const m = as(MGR, 'manager');
  await assertSucceeds(getDoc(doc(m.firestore(), 'payslips', 'mgr1_2030-01')));
  await assertSucceeds(getBytes(ref(m.storage(), 'payslips/mgr1/mgr1_2030-01.pdf')));
  await assertFails(getDoc(doc(m.firestore(), 'payslips', 'alice_2030-01')));
  await assertFails(getDocs(collection(m.firestore(), 'payslips')));
  await assertFails(getDocs(query(collection(m.firestore(), 'payslips'), where('staffId', '==', ALICE))));
  await assertFails(getBytes(ref(m.storage(), 'payslips/alice/alice_2030-01.pdf')));
  await assertFails(getMetadata(ref(m.storage(), 'payslips/alice/alice_2030-01.pdf')));
  await assertFails(up(m, 'payslips/alice/alice_2030-02.pdf'));
  await assertFails(up(m, 'payslips/alice/alice_2030-01.pdf')); // replace
  await assertFails(deleteObject(ref(m.storage(), 'payslips/alice/alice_2030-01.pdf')));
  await assertFails(deleteDoc(doc(m.firestore(), 'payslips', 'alice_2030-01')));
  const a = as(ALICE, 'staff');
  await assertSucceeds(getBytes(ref(a.storage(), 'payslips/alice/alice_2030-01.pdf')));
  await assertFails(getBytes(ref(as(BOB, 'staff').storage(), 'payslips/alice/alice_2030-01.pdf')));
  await assertFails(getDoc(doc(as(BOB, 'staff').firestore(), 'payslips', 'alice_2030-01')));
  await assertFails(getBytes(ref(a.storage(), 'payslips/mgr1/mgr1_2030-01.pdf')));
  await assertFails(up(a, 'payslips/alice/alice_2030-02.pdf'));
  const o = as(OWNER, 'owner');
  await assertSucceeds(getDocs(collection(o.firestore(), 'payslips')));
  await assertSucceeds(getBytes(ref(o.storage(), 'payslips/alice/alice_2030-01.pdf')));
  await assertSucceeds(up(o, 'payslips/alice/alice_2030-01.pdf'));
  await assertSucceeds(deleteObject(ref(o.storage(), 'payslips/alice/alice_2030-01.pdf')));
  await assertSucceeds(deleteDoc(doc(o.firestore(), 'payslips', 'alice_2030-01')));
});

// ---------------- Shifts need RTW ----------------
test('nobody can be put on a shift without RTW on file; open shifts and unchanged assignments are fine', async () => {
  for (const [u, r] of [[MGR, 'manager'], [OWNER, 'owner']]) {
    const f = as(u, r).firestore();
    await assertSucceeds(setDoc(doc(f, 'shifts', `a-${u}`), shift(u, ALICE)));
    await assertFails(setDoc(doc(f, 'shifts', `b-${u}`), shift(u, BOB))); // ok:false
    await assertFails(setDoc(doc(f, 'shifts', `n-${u}`), shift(u, NEWBIE))); // no status at all
    await assertSucceeds(setDoc(doc(f, 'shifts', `o-${u}`), shift(u, '', { staffName: 'Open shift' })));
    // giving an open shift to someone without RTW is refused, to someone with RTW allowed
    await assertFails(updateDoc(doc(f, 'shifts', `o-${u}`), { staffId: NEWBIE, staffName: 'Newbie', updatedAt: serverTimestamp(), updatedBy: u }));
    await assertSucceeds(updateDoc(doc(f, 'shifts', `o-${u}`), { staffId: ALICE, staffName: 'Alice', updatedAt: serverTimestamp(), updatedBy: u }));
    // an existing shift that already has Bob on it can still have its time changed
    await assertSucceeds(updateDoc(doc(f, 'shifts', 'bobs'), { start: '10:00', updatedAt: serverTimestamp(), updatedBy: u }));
  }
});
