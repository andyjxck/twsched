// Firestore rules: nobody can switch a holiday request between paid and unpaid by writing to it directly.
// Run: npm run test:holiday-rules (Firestore emulator). RULES_FILE=path checks another ruleset (e.g. the live one).
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';

const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
let env;
const OWNER = 'owner1', MGR = 'mgr1', ALICE = 'alice', BOB = 'bob';
const T = { staffId: ALICE, staffName: 'Alice', from: '2030-05-04', to: '2030-05-06', reason: 'Wedding', createdAt: new Date('2030-04-01') };

before(async () => {
  env = await initializeTestEnvironment({
    projectId: process.env.GCLOUD_PROJECT || 'demo-holiday',
    firestore: { rules: readFileSync(process.env.RULES_FILE || 'firestore.rules', 'utf8'), host, port: Number(port) },
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'timeOff', 'paidPending'), { ...T, paid: true, status: 'pending' });
    await setDoc(doc(db, 'timeOff', 'unpaidPending'), { ...T, paid: false, status: 'pending' });
    await setDoc(doc(db, 'timeOff', 'paidApproved'), { ...T, paid: true, status: 'approved', decidedBy: MGR });
    await setDoc(doc(db, 'timeOff', 'unpaidDeclined'), { ...T, paid: false, status: 'declined', decidedBy: MGR });
  });
});
const as = (uid, role) => env.authenticatedContext(uid, { role, email: `${uid}@x.com` }).firestore();

test('managers and the owner cannot write paid/unpaid (or decide) directly', async () => {
  for (const [u, r] of [[MGR, 'manager'], [OWNER, 'owner']]) {
    const db = as(u, r);
    await assertFails(updateDoc(doc(db, 'timeOff', 'paidPending'), { paid: false }));
    await assertFails(updateDoc(doc(db, 'timeOff', 'unpaidPending'), { paid: true }));
    await assertFails(updateDoc(doc(db, 'timeOff', 'paidPending'), { status: 'approved', paid: false }));
    await assertFails(updateDoc(doc(db, 'timeOff', 'paidApproved'), { paid: false }));
    await assertFails(updateDoc(doc(db, 'timeOff', 'unpaidDeclined'), { paid: true }));
    await assertFails(setDoc(doc(db, 'timeOff', 'paidPending'), { ...T, paid: false, status: 'approved' }));
    // cannot re-create someone else's request with the other type
    await assertFails(setDoc(doc(db, 'timeOff', 'fake'), { ...T, paid: false, status: 'pending', createdAt: serverTimestamp() }));
    await assertFails(addDoc(collection(db, 'timeOff'), { ...T, paid: false, status: 'pending', createdAt: serverTimestamp() }));
  }
});

test('the requester cannot switch type after submitting either, but can still cancel', async () => {
  const db = as(ALICE, 'staff');
  await assertFails(updateDoc(doc(db, 'timeOff', 'paidPending'), { paid: false }));
  await assertFails(updateDoc(doc(db, 'timeOff', 'unpaidPending'), { paid: true }));
  await assertFails(updateDoc(doc(db, 'timeOff', 'unpaidPending'), { status: 'cancelled', paid: true }));
  await assertFails(updateDoc(doc(db, 'timeOff', 'paidApproved'), { paid: false }));
  await assertFails(updateDoc(doc(db, 'timeOff', 'paidPending'), { status: 'approved' }));
  await assertSucceeds(updateDoc(doc(db, 'timeOff', 'paidPending'), { status: 'cancelled' }));
});

test('other staff cannot touch it', async () => {
  const db = as(BOB, 'staff');
  await assertFails(getDoc(doc(db, 'timeOff', 'paidPending')));
  await assertFails(updateDoc(doc(db, 'timeOff', 'paidPending'), { paid: false }));
  await assertFails(updateDoc(doc(db, 'timeOff', 'paidPending'), { status: 'cancelled' }));
  await assertFails(deleteDoc(doc(db, 'timeOff', 'paidPending')));
});

test('staff can still ask for paid or unpaid holiday', async () => {
  const db = as(ALICE, 'staff');
  for (const paid of [true, false]) {
    await assertSucceeds(addDoc(collection(db, 'timeOff'), { staffId: ALICE, staffName: 'Alice', from: '2030-06-01', to: '2030-06-02', reason: '', paid, status: 'pending', createdAt: serverTimestamp() }));
  }
  await assertFails(addDoc(collection(db, 'timeOff'), { staffId: ALICE, staffName: 'Alice', from: '2030-06-01', to: '2030-06-02', reason: '', paid: 'no', status: 'pending', createdAt: serverTimestamp() }));
});
