// Everyone on the rota: there is no 'Show on rota' opt-out. createStaff always puts a new person on the
// rota; updateStaff ignores any onRota:false sent by an old client and puts back anyone an old flag hid.
// Runs only against local emulators with made-up accounts (no live data, no email).
// Run: firebase emulators:exec --config firebase.rotatest.json --only functions,firestore,auth --project demo-rotatest 'node --test tests/rotaVisibility.emulator.test.mjs'
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-rotatest';
const FN = (name) => 'http://127.0.0.1:5733/' + PROJECT + '/europe-west2/' + name;
const AUTH = 'http://' + (process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9733');

const users = {};
let adb;

async function makeUser(key, role) {
  const email = key + '@hotel.test';
  let u;
  try { u = await admin.auth().getUserByEmail(email); } catch { u = await admin.auth().createUser({ email, password: 'Emulator-only-pw1' }); }
  await admin.auth().setCustomUserClaims(u.uid, { role });
  await adb.doc('staff/' + u.uid).set({ name: key[0].toUpperCase() + key.slice(1), email, role, active: true, onRota: true });
  const r = await fetch(AUTH + '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Emulator-only-pw1', returnSecureToken: true }),
  });
  users[key] = { uid: u.uid, token: (await r.json()).idToken };
}
async function callFn(name, who, data) {
  const r = await fetch(FN(name), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + users[who].token },
    body: JSON.stringify({ data }),
  });
  return r.json();
}
const ok = (r) => { assert.ok(r.result && !r.error, JSON.stringify(r)); return r.result; };
async function seedPerson(uid, fields) {
  try { await admin.auth().getUser(uid); } catch { await admin.auth().createUser({ uid, email: fields.email || undefined }); }
  await adb.doc('staff/' + uid).set(fields);
}
const staffDoc = async (id) => (await adb.doc('staff/' + id).get()).data();

before(async () => {
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  adb = admin.firestore();
  await fetch(AUTH + '/emulator/v1/projects/' + PROJECT + '/accounts', { method: 'DELETE' });
});
after(async () => { await admin.app().delete(); });
beforeEach(async () => {
  await makeUser('owner', 'owner');
  await makeUser('manager', 'manager');
});

test('createStaff puts a new person on the rota even if an old client asks to hide them', async () => {
  const r = ok(await callFn('createStaff', 'manager', { name: 'Hidden Try', email: 'hide' + Date.now() + '@hotel.test', role: 'staff', jobTitle: 'Bar', onRota: false }));
  const d = await staffDoc(r.uid);
  assert.equal(d.onRota, true);
  assert.equal(d.role, 'staff');
});

test('createStaff with no onRota field puts them on the rota', async () => {
  const r = ok(await callFn('createStaff', 'owner', { name: 'Plain New', email: 'plain' + Date.now() + '@hotel.test', role: 'staff', jobTitle: 'Kitchen' }));
  assert.equal((await staffDoc(r.uid)).onRota, true);
});

test('updateStaff cannot take someone off the rota', async () => {
  await seedPerson('s-keep', { name: 'Keep Me', email: 'keep@hotel.test', role: 'staff', active: true, onRota: true });
  ok(await callFn('updateStaff', 'manager', { uid: 's-keep', name: 'Keep Me', onRota: false }));
  assert.equal((await staffDoc('s-keep')).onRota, true);
});

test('any edit puts back someone an old flag hid from the rota', async () => {
  await seedPerson('s-hidden', { name: 'Was Hidden', email: 'hidden@hotel.test', role: 'staff', active: true, onRota: false });
  ok(await callFn('updateStaff', 'manager', { uid: 's-hidden', name: 'Was Hidden', jobTitle: 'Bar', phone: '' }));
  const d = await staffDoc('s-hidden');
  assert.equal(d.onRota, true);
  assert.equal(d.jobTitle, 'Bar');
});

test('role permissions unchanged: a manager still cannot edit another manager', async () => {
  await seedPerson('m-other', { name: 'Other Mgr', email: 'om@hotel.test', role: 'manager', active: true, onRota: false });
  const r = await callFn('updateStaff', 'manager', { uid: 'm-other', name: 'Other Mgr' });
  assert.ok(r.error, JSON.stringify(r));
  assert.equal(r.error.status, 'PERMISSION_DENIED');
  assert.equal((await staffDoc('m-other')).onRota, false);
});

test('people who have left stay off the rota', async () => {
  await seedPerson('s-left', { name: 'Gone Away', email: '', role: 'staff', active: false, onRota: false, terminated: true });
  const r = await callFn('updateStaff', 'owner', { uid: 's-left', name: 'Gone Away' });
  assert.ok(r.error, JSON.stringify(r));
  assert.equal((await staffDoc('s-left')).onRota, false);
});
