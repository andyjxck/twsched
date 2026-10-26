// Right to Work server checks (functions/documents.js): file verification, token removal, the rtwStatus tick,
// and the RTW gate in publishWeek / approveDay / swap approval. Also the payslip file check.
// Local emulators only, made-up accounts and synthetic bytes (no real documents).
// Run: firebase --config firebase.staffdocs-test.json emulators:exec --only auth,firestore,storage,functions \
//        --project demo-twsched 'node --test --test-concurrency=1 tests/staffDocs.emulator.test.mjs'
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-twsched';
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:29499'}`;
const FN_HOST = process.env.FUNCTIONS_EMULATOR_HOST || '127.0.0.1:25401';
const FN = (name) => `http://${FN_HOST}/${PROJECT}/europe-west2/${name}`;
const BUCKET = `${PROJECT}.appspot.com`;

const PDF = Buffer.from('%PDF-1.7\n% synthetic test file, not a real document\n');
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), Buffer.from('JFIF synthetic')]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>');
const WEEK = '2027-03-01'; const THU = '2027-03-04';

let adb; let bucket;
const users = {};
async function makeUser(key, role) {
  const email = `${key}@hotel.test`;
  let u;
  try { u = await admin.auth().getUserByEmail(email); } catch { u = await admin.auth().createUser({ email, password: 'Emulator-only-pw1' }); }
  await admin.auth().setCustomUserClaims(u.uid, { role });
  await adb.doc(`staff/${u.uid}`).set({ name: key, email, role, active: true, onRota: true });
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Emulator-only-pw1', returnSecureToken: true }),
  });
  users[key] = { uid: u.uid, token: (await r.json()).idToken };
}
async function callFn(name, who, data) {
  const r = await fetch(FN(name), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${users[who].token}` }, body: JSON.stringify({ data }) });
  return r.json();
}
const ok = (r) => { assert.ok(r.result && !r.error, JSON.stringify(r)); return r.result; };
async function until(fn, ms = 25000) {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - t0 > ms) throw new Error('timed out waiting for the trigger');
    await new Promise((r) => setTimeout(r, 300));
  }
}
let n = 0;
const newId = () => `T${String(Date.now()).slice(-9)}${String(n++).padStart(4, '0')}abcdefghij`.slice(0, 20);
async function addRtw(staffKey, bytes, contentType, ext, extra = {}) {
  const id = newId();
  const path = `rtw/${users[staffKey].uid}/${id}.${ext}`;
  await bucket.file(path).save(bytes, { contentType, metadata: { metadata: { firebaseStorageDownloadTokens: 'leak-me-token' } } });
  await adb.doc(`staffDocs/${id}`).set({
    staffId: users[staffKey].uid, staffName: staffKey, kind: 'rtw', docType: 'passport', fileName: `x.${ext}`, contentType,
    size: bytes.length, storagePath: path, uploadedAt: new Date(), uploadedBy: users.owner.uid, uploadedByName: 'owner', ...extra,
  });
  return { id, path };
}
const status = async (k) => { const s = await adb.doc(`rtwStatus/${users[k].uid}`).get(); return s.exists ? s.data() : null; };
const exists = async (p) => (await bucket.file(p).exists())[0];

before(async () => {
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT, storageBucket: BUCKET });
  adb = admin.firestore();
  bucket = admin.storage().bucket(BUCKET);
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
});
after(async () => { await admin.app().delete(); });
beforeEach(async () => {
  for (const col of ['staffDocs', 'rtwStatus', 'shifts', 'requests', 'payslips', 'weeks', 'days']) {
    const s = await adb.collection(col).get();
    await Promise.all(s.docs.map((d) => d.ref.delete()));
  }
  await bucket.deleteFiles({ force: true }).catch(() => {});
  for (const [k, r] of [['owner', 'owner'], ['manager', 'manager'], ['amy', 'staff'], ['ben', 'staff']]) await makeUser(k, r);
  await new Promise((r) => setTimeout(r, 1500)); // let deletes' triggers settle
  for (const col of ['rtwStatus']) {
    const s = await adb.collection(col).get();
    await Promise.all(s.docs.map((d) => d.ref.delete()));
  }
});

test('a genuine PDF is checked, its download token removed, and the tick appears', async () => {
  const { id, path } = await addRtw('amy', PDF, 'application/pdf', 'pdf');
  await until(async () => (await status('amy'))?.ok === true);
  assert.equal((await status('amy')).count, 1);
  assert.equal((await adb.doc(`staffDocs/${id}`).get()).get('checked'), true);
  const [m] = await bucket.file(path).getMetadata();
  // removed in Cloud Storage; the emulator keeps the key, so there it must at least have been replaced
  assert.notEqual(m.metadata && m.metadata.firebaseStorageDownloadTokens, 'leak-me-token', `token should be revoked: ${JSON.stringify(m.metadata)}`);
  assert.equal(m.contentDisposition, 'attachment');
  // a JPEG photo counts too
  await addRtw('amy', JPG, 'image/jpeg', 'jpg');
  await until(async () => (await status('amy'))?.count === 2);
});

test('a fake file (HTML renamed to .pdf), a size mismatch or a missing file is refused and removed', async () => {
  const fake = await addRtw('ben', HTML, 'application/pdf', 'pdf');
  await until(async () => !(await adb.doc(`staffDocs/${fake.id}`).get()).exists);
  assert.equal(await exists(fake.path), false, 'the fake file is deleted');
  const lie = await addRtw('ben', PDF, 'application/pdf', 'pdf', { size: PDF.length + 5 });
  await until(async () => !(await adb.doc(`staffDocs/${lie.id}`).get()).exists);
  const id = newId();
  await adb.doc(`staffDocs/${id}`).set({ staffId: users.ben.uid, staffName: 'ben', kind: 'rtw', docType: 'passport', fileName: 'x.pdf', contentType: 'application/pdf', size: 10, storagePath: `rtw/${users.ben.uid}/${id}.pdf`, uploadedAt: new Date(), uploadedBy: users.owner.uid });
  await until(async () => !(await adb.doc(`staffDocs/${id}`).get()).exists);
  // a path pointing at someone else's folder is refused and that other file is NOT deleted
  const amys = await addRtw('amy', PDF, 'application/pdf', 'pdf');
  await until(async () => (await status('amy'))?.ok === true);
  const id2 = newId();
  await adb.doc(`staffDocs/${id2}`).set({ staffId: users.ben.uid, staffName: 'ben', kind: 'rtw', docType: 'passport', fileName: 'x.pdf', contentType: 'application/pdf', size: PDF.length, storagePath: amys.path, uploadedAt: new Date(), uploadedBy: users.owner.uid });
  await until(async () => !(await adb.doc(`staffDocs/${id2}`).get()).exists);
  assert.equal(await exists(amys.path), true);
  const s = await status('ben');
  assert.ok(!s || s.ok === false, JSON.stringify(s));
});

test('removing the last document takes the tick away and deletes the file', async () => {
  const a = await addRtw('amy', PDF, 'application/pdf', 'pdf');
  await until(async () => (await status('amy'))?.ok === true);
  await adb.doc(`staffDocs/${a.id}`).delete();
  await until(async () => (await status('amy'))?.ok === false);
  await until(async () => !(await exists(a.path)));
});

test('publishing a week and approving a day leave drafts for people without RTW as drafts; swaps to them are refused', async () => {
  const a = await addRtw('amy', PDF, 'application/pdf', 'pdf');
  await until(async () => (await status('amy'))?.ok === true);
  const base = { date: THU, week: WEEK, start: '17:00', end: '23:00', breakStart: '', breakEnd: '', breakPaid: true, area: 'Bar', notes: '', eventId: '', eventTitle: '', published: false, updatedAt: new Date(), updatedBy: 'seed' };
  await adb.doc('shifts/amyDraft').set({ ...base, staffId: users.amy.uid, staffName: 'amy' });
  await adb.doc('shifts/benDraft').set({ ...base, staffId: users.ben.uid, staffName: 'ben' });
  const r = ok(await callFn('publishWeek', 'owner', { weekStart: WEEK }));
  assert.equal(r.skippedNoRtw, 1, JSON.stringify(r));
  assert.equal((await adb.doc('shifts/amyDraft').get()).get('published'), true);
  assert.equal((await adb.doc('shifts/benDraft').get()).get('published'), false);
  await adb.doc('shifts/benDraft2').set({ ...base, date: '2027-03-02', staffId: users.ben.uid, staffName: 'ben' });
  await adb.doc('shifts/amyDraft2').set({ ...base, date: '2027-03-02', staffId: users.amy.uid, staffName: 'amy' });
  ok(await callFn('approveDay', 'owner', { date: '2027-03-02' }));
  assert.equal((await adb.doc('shifts/benDraft2').get()).get('published'), false);
  assert.equal((await adb.doc('shifts/amyDraft2').get()).get('published'), true);
  // swap Amy's published shift to Ben (no RTW): refused, nothing moves
  await adb.doc('requests/sw').set({ kind: 'swap', staffId: users.amy.uid, staffName: 'amy', shiftId: 'amyDraft', toStaffId: users.ben.uid, toStaffName: 'ben', status: 'pending', createdAt: new Date() });
  const e = await callFn('decideRequest', 'owner', { kind: 'request', id: 'sw', status: 'approved' });
  assert.ok(e.error && e.error.status === 'FAILED_PRECONDITION' && /Right to Work/.test(e.error.message), JSON.stringify(e));
  assert.equal((await adb.doc('shifts/amyDraft').get()).get('staffId'), users.amy.uid);
});

test('payslips: a real PDF loses its download token; a fake one is removed', async () => {
  const good = `payslips/${users.amy.uid}/${users.amy.uid}_2027-01.pdf`;
  await bucket.file(good).save(PDF, { contentType: 'application/pdf', metadata: { metadata: { firebaseStorageDownloadTokens: 'leak-me' } } });
  await adb.doc(`payslips/${users.amy.uid}_2027-01`).set({ staffId: users.amy.uid, slot: '2027-01', storagePath: good, size: PDF.length });
  await until(async () => (await adb.doc(`payslips/${users.amy.uid}_2027-01`).get()).get('checked') === true);
  const [m] = await bucket.file(good).getMetadata();
  assert.notEqual(m.metadata && m.metadata.firebaseStorageDownloadTokens, 'leak-me', JSON.stringify(m.metadata));
  const bad = `payslips/${users.amy.uid}/${users.amy.uid}_2027-02.pdf`;
  await bucket.file(bad).save(HTML, { contentType: 'application/pdf' });
  await adb.doc(`payslips/${users.amy.uid}_2027-02`).set({ staffId: users.amy.uid, slot: '2027-02', storagePath: bad, size: HTML.length });
  await until(async () => !(await adb.doc(`payslips/${users.amy.uid}_2027-02`).get()).exists);
  assert.equal(await exists(bad), false);
});
