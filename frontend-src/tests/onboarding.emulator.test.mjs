// End-to-end test of staff onboarding (onboarding.js + createStaff/updateStaff + rules) against the
// Firebase emulators on their own ports (firebase.onboarding-test.json), with a local SMTP sink.
// No real accounts, no real mail. Run: npm run test:onboarding
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { SMTPServer } = require('smtp-server');
const admin = require('../functions/node_modules/firebase-admin');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-twsched';
const FN = (name) => `http://127.0.0.1:15401/${PROJECT}/europe-west2/${name}`;
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:19499'}`;
const FS = `http://${process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:18480'}/v1/projects/${PROJECT}/databases/(default)/documents`;
const ST = `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:19599'}`;
const BUCKET = 'twsched-f8b16.firebasestorage.app';
const SMTP_PORT = 2585;
const KEY = 'fake-api-key';
const TEMP_RE = /Temporary password: ([A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4})/;
const seenTemps = []; // written out at the end so the runner can grep the emulator logs for them
const mails = [];
let smtp, db, auth;
let smtpMode = 'ok'; // 'ok' | 'reject'

const MAIL_ON = { host: '127.0.0.1', port: SMTP_PORT, secure: false, user: 'sender@hotel.test', from: '', enabled: true, emailStaff: false, pass: 'dummy-pass' };

before(async () => {
  smtp = new SMTPServer({
    authOptional: false, allowInsecureAuth: true, disabledCommands: ['STARTTLS'], logger: false,
    onAuth(a, s, cb) {
      if (smtpMode === 'reject') return cb(Object.assign(new Error('Username and Password not accepted (test)'), { responseCode: 535 }));
      return cb(null, { user: a.username });
    },
    onData(stream, session, cb) {
      let raw = '';
      stream.on('data', (c) => { raw += c; });
      stream.on('end', () => { mails.push({ rcpt: session.envelope.rcptTo.map((r) => r.address), raw }); cb(); });
    },
  });
  await new Promise((r) => smtp.listen(SMTP_PORT, '127.0.0.1', r));
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT, storageBucket: BUCKET });
  db = admin.firestore();
  auth = admin.auth();
  await db.doc('private/mail').set(MAIL_ON);
  await mkUser('owner1', 'andy@hotel.test', { role: 'owner', primaryOwner: true }, { name: 'Andy Owner', role: 'owner', primaryOwner: true });
  await mkUser('mgr1', 'mgr@hotel.test', { role: 'manager' }, { name: 'Mia Manager', role: 'manager' });
  await mkUser('mgr2', 'mgr2@hotel.test', { role: 'manager' }, { name: 'Max Manager', role: 'manager' });
  await mkUser('old1', 'old@hotel.test', { role: 'staff' }, { name: 'Olly Existing', role: 'staff' });
  await db.doc('shifts/s1').set({ staffId: 'old1', published: true, date: '2026-10-21', week: '2026-10-19' });
});
after(async () => {
  fs.writeFileSync('/tmp/onboarding-test-temps.txt', seenTemps.join('\n'));
  await new Promise((r) => smtp.close(r));
  await admin.app().delete();
});

async function mkUser(uid, email, claims, profile) {
  await auth.createUser({ uid, email, password: `pw-${uid}-Long1`, emailVerified: true });
  await auth.setCustomUserClaims(uid, claims);
  await db.doc(`staff/${uid}`).set({ active: true, email, ...profile });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function signIn(email, password) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const j = await r.json();
  return r.ok ? j : { error: j.error };
}
const claimsOf = (idToken) => JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString());
async function callFn(name, data, idToken) {
  const r = await fetch(FN(name), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) }, body: JSON.stringify({ data }) });
  return r.json();
}
async function fsGet(path, idToken) {
  const r = await fetch(`${FS}/${path}`, { headers: { Authorization: `Bearer ${idToken}` } });
  return r.status;
}
async function fsPatch(path, fields, idToken) {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&');
  const r = await fetch(`${FS}/${path}?${mask}`, { method: 'PATCH', headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
  return r.status;
}
async function fsDelete(path, idToken) {
  const r = await fetch(`${FS}/${path}`, { method: 'DELETE', headers: { Authorization: `Bearer ${idToken}` } });
  return r.status;
}
async function stGet(path, idToken) {
  const r = await fetch(`${ST}/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media`, { headers: { Authorization: `Firebase ${idToken}` } });
  return r.status;
}
const owner = () => signIn('andy@hotel.test', 'pw-owner1-Long1').then((j) => j.idToken);
const mgr = () => signIn('mgr@hotel.test', 'pw-mgr1-Long1').then((j) => j.idToken);
function lastMailTo(addr) {
  const m = [...mails].reverse().find((x) => x.rcpt.includes(addr));
  if (!m) return null;
  const body = m.raw.replace(/=\r?\n/g, '');
  const t = (body.match(TEMP_RE) || [])[1];
  if (t) seenTemps.push(t);
  return { ...m, body, temp: t };
}
async function waitMail(addr, n = 1) {
  for (let i = 0; i < 60; i++) { if (mails.filter((x) => x.rcpt.includes(addr)).length >= n) return lastMailTo(addr); await sleep(100); }
  return null;
}
// Scans every Firestore document for a string (temporary password must never be stored).
async function firestoreContains(str) {
  const cols = await db.listCollections();
  for (const c of cols) {
    for (const d of (await c.get()).docs) if (JSON.stringify(d.data()).includes(str)) return `${c.id}/${d.id}`;
  }
  return null;
}

let newUid, newTemp;

test('owner adds staff: temporary password is emailed (not returned), account is gated', async () => {
  const r = await callFn('createStaff', { name: 'Nina New', email: 'Nina.New@staff.test', role: 'staff', jobTitle: 'Bar' }, await owner());
  assert.ok(r.result, JSON.stringify(r));
  assert.equal(r.result.emailSent, true);
  assert.equal(r.result.tempPassword, undefined, 'password not handed back when the email went');
  newUid = r.result.uid;
  const m = await waitMail('nina.new@staff.test');
  assert.ok(m && m.temp, 'email has the temporary password');
  assert.match(m.body, /andyjxck\.github\.io\/twsched/);
  assert.match(m.body, /choose your own password/i);
  assert.match(m.body, /only works until/i);
  assert.match(m.raw, /Subject: Your White Swan staff login/);
  newTemp = m.temp;
  assert.equal(await firestoreContains(newTemp), null, 'temporary password stored nowhere in Firestore');
  const u = await auth.getUser(newUid);
  assert.equal(u.customClaims.role, 'staff');
  assert.equal(u.customClaims.pwChange, true);
  const gate = await db.doc(`authGate/${newUid}`).get();
  assert.ok(gate.exists);
  assert.ok(gate.get('expiresAt').toMillis() > Date.now() + 6 * 86400000);
  const sd = (await db.doc(`staff/${newUid}`).get()).data();
  assert.equal(sd.pendingFirstLogin, true);
  assert.equal(sd.loginEmail.status, 'sent');
});

test('while gated: no data, no files, no callables, and the flag cannot be cleared by the user', async () => {
  await db.doc(`shifts/s2`).set({ staffId: newUid, published: true, date: '2026-10-22', week: '2026-10-19' });
  await admin.storage().bucket().file(`payslips/${newUid}/p1.pdf`).save(Buffer.from('%PDF-1.4 test'), { contentType: 'application/pdf' });
  const s = await signIn('nina.new@staff.test', newTemp);
  assert.ok(s.idToken, 'temporary password signs in');
  const t = s.idToken;
  assert.equal(claimsOf(t).pwChange, true);
  assert.equal(await fsGet(`staff/${newUid}`, t), 403);
  assert.equal(await fsGet('shifts/s2', t), 403);
  assert.equal(await fsGet(`authGate/${newUid}`, t), 200, 'can read own gate (expiry date)');
  assert.equal(await fsDelete(`authGate/${newUid}`, t), 403);
  assert.equal(await fsPatch(`staff/${newUid}`, { pendingFirstLogin: { booleanValue: false } }, t), 403);
  assert.equal(await stGet(`payslips/${newUid}/p1.pdf`, t), 403);
  const c = await callFn('resendStaffLogin', { uid: 'old1' }, t);
  assert.equal(c.error && c.error.status, 'FAILED_PRECONDITION');
  assert.match(c.error.message, /Choose your own password/);
  const c2 = await callFn('addUnavailability', {}, t);
  assert.equal(c2.error && c2.error.status, 'FAILED_PRECONDITION', `availability module gated: ${JSON.stringify(c2)}`);
  const c3 = await callFn('approveDay', {}, t);
  assert.equal(c3.error && c3.error.status, 'FAILED_PRECONDITION', `dayApproval module gated: ${JSON.stringify(c3)}`);
  // trying to set own claims through the Auth REST API does nothing
  await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:update?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: t, customAttributes: '{"role":"owner"}' }),
  });
  const u = await auth.getUser(newUid);
  assert.equal(u.customClaims.pwChange, true);
  assert.equal(u.customClaims.role, 'staff');
});

test('changing the password directly with Firebase Auth (bypassing the app) leaves the account gated', async () => {
  const s = await signIn('nina.new@staff.test', newTemp);
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:update?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: s.idToken, password: 'Bypass-Attempt-99', returnSecureToken: true }),
  });
  assert.equal(r.status, 200);
  const s2 = await signIn('nina.new@staff.test', 'Bypass-Attempt-99');
  assert.equal(claimsOf(s2.idToken).pwChange, true, 'still gated with a fresh token');
  assert.equal(await fsGet(`staff/${newUid}`, s2.idToken), 403);
  // the user now knows 'Bypass-Attempt-99' as their current password; they still must go through completePasswordChange
  newTemp = 'Bypass-Attempt-99';
});

test('completePasswordChange: validation, wrong temporary password, then success lifts the gate', async () => {
  const t = (await signIn('nina.new@staff.test', newTemp)).idToken;
  let r = await callFn('completePasswordChange', { currentPassword: 'wrong-one-123', newPassword: 'Nina-Own-Pass-2026' }, t);
  assert.equal(r.error && r.error.status, 'PERMISSION_DENIED');
  r = await callFn('completePasswordChange', { currentPassword: newTemp, newPassword: 'short' }, t);
  assert.equal(r.error && r.error.status, 'INVALID_ARGUMENT');
  r = await callFn('completePasswordChange', { currentPassword: newTemp, newPassword: newTemp }, t);
  assert.equal(r.error && r.error.status, 'INVALID_ARGUMENT');
  r = await callFn('completePasswordChange', { currentPassword: newTemp, newPassword: 'password123' }, t);
  assert.equal(r.error && r.error.status, 'INVALID_ARGUMENT');
  r = await callFn('completePasswordChange', { currentPassword: newTemp, newPassword: 'nina.new@staff.test' }, t);
  assert.equal(r.error && r.error.status, 'INVALID_ARGUMENT');
  assert.equal((await auth.getUser(newUid)).customClaims.pwChange, true, 'still gated after failures');
  r = await callFn('completePasswordChange', { currentPassword: newTemp, newPassword: 'Nina-Own-Pass-2026' }, t);
  assert.deepEqual(r.result, { ok: true }, JSON.stringify(r));
  const u = await auth.getUser(newUid);
  assert.equal(u.customClaims.pwChange, undefined);
  assert.equal(u.customClaims.role, 'staff', 'role kept');
  assert.equal((await db.doc(`authGate/${newUid}`).get()).exists, false);
  const sd = (await db.doc(`staff/${newUid}`).get()).data();
  assert.equal(sd.pendingFirstLogin, undefined);
  assert.ok(sd.passwordSetAt);
  assert.ok((await signIn('nina.new@staff.test', newTemp)).error, 'old password no longer works');
  const s = await signIn('nina.new@staff.test', 'Nina-Own-Pass-2026');
  assert.ok(s.idToken);
  assert.equal(claimsOf(s.idToken).pwChange, undefined);
  assert.equal(await fsGet(`staff/${newUid}`, s.idToken), 200);
  assert.equal(await fsGet('shifts/s2', s.idToken), 200);
  assert.equal(await stGet(`payslips/${newUid}/p1.pdf`, s.idToken), 200);
  r = await callFn('completePasswordChange', { currentPassword: 'Nina-Own-Pass-2026', newPassword: 'Another-Pass-2027' }, s.idToken);
  assert.equal(r.error && r.error.status, 'FAILED_PRECONDITION', 'cannot be used as a generic password changer');
});

test('existing staff are untouched: no gate, normal access', async () => {
  const s = await signIn('old@hotel.test', 'pw-old1-Long1');
  assert.equal(claimsOf(s.idToken).pwChange, undefined);
  assert.equal(await fsGet('staff/old1', s.idToken), 200);
  assert.equal(await fsGet('shifts/s1', s.idToken), 200);
});

test('manager sends a new temporary password: old session is cut off from callables, files and token refresh', async () => {
  const staleS = await signIn('old@hotel.test', 'pw-old1-Long1');
  const stale = staleS.idToken;
  const staleRefresh = staleS.refreshToken;
  await sleep(1100); // revocation is second-granular
  assert.equal(await fsGet('shifts/s1', stale), 200);
  const r = await callFn('resendStaffLogin', { uid: 'old1' }, await mgr());
  assert.equal(r.result && r.result.emailSent, true, JSON.stringify(r));
  assert.equal(r.result.tempPassword, undefined);
  const m = await waitMail('old@hotel.test');
  assert.match(m.raw, /Subject: Your new White Swan staff password/);
  assert.equal(claimsOf(stale).pwChange, undefined, 'stale token has no claim');
  await admin.storage().bucket().file('payslips/old1/p.pdf').save(Buffer.from('%PDF-1.4 x'), { contentType: 'application/pdf' });
  assert.equal(await stGet('payslips/old1/p.pdf', stale), 403, 'Storage refuses it (authGate)');
  const c = await callFn('resendStaffLogin', { uid: 'mgr2' }, stale);
  assert.equal(c.error && c.error.status, 'FAILED_PRECONDITION', 'callables refuse it (authGate)');
  // Known limit: Firestore rules check the token claim only (an exists() there broke the shift rules'
  // expression budget), so a token minted before the reset can still read Firestore until it expires
  // (max 1 hour; its refresh token is revoked, and the app signs the device out on the gate doc).
  assert.equal(await fsGet('shifts/s1', stale), 200);
  // The Auth emulator does not enforce refresh-token revocation, so check the revocation itself:
  // production Firebase refuses to refresh any token issued before tokensValidAfterTime.
  const validAfter = Date.parse((await auth.getUser('old1')).tokensValidAfterTime) / 1000;
  assert.ok(validAfter > claimsOf(stale).auth_time, `refresh tokens revoked (${validAfter} > ${claimsOf(stale).auth_time}); ${staleRefresh ? 'old refresh token now invalid in production' : ''}`);
  assert.ok((await signIn('old@hotel.test', 'pw-old1-Long1')).error, 'old password replaced');
  const s = await signIn('old@hotel.test', m.temp);
  assert.equal(claimsOf(s.idToken).pwChange, true);
  assert.equal((await auth.getUser('old1')).customClaims.role, 'staff');
});

test('resend limits: second email to the same person within 2 minutes is refused, also when sent at once', async () => {
  const r = await callFn('resendStaffLogin', { uid: 'old1' }, await mgr());
  assert.equal(r.error && r.error.status, 'RESOURCE_EXHAUSTED', JSON.stringify(r));
  // fresh target, 5 simultaneous requests -> exactly one
  await mkUser('old2', 'old2@hotel.test', { role: 'staff' }, { name: 'Ola Two', role: 'staff' });
  const t = await owner();
  const all = await Promise.all([1, 2, 3, 4, 5].map(() => callFn('resendStaffLogin', { uid: 'old2' }, t)));
  assert.equal(all.filter((x) => x.result && x.result.emailSent).length, 1, JSON.stringify(all.map((x) => x.error && x.error.status)));
  await sleep(500);
  assert.equal(mails.filter((x) => x.rcpt.includes('old2@hotel.test')).length, 1);
  lastMailTo('old2@hotel.test');
});

test('who may do what: staff cannot invite, manager cannot reset managers, nobody can reset themselves or Andy', async () => {
  const nina = (await signIn('nina.new@staff.test', 'Nina-Own-Pass-2026')).idToken;
  let r = await callFn('createStaff', { name: 'X', email: 'x@staff.test', role: 'staff' }, nina);
  assert.equal(r.error && r.error.status, 'PERMISSION_DENIED');
  r = await callFn('resendStaffLogin', { uid: 'old2' }, nina);
  assert.equal(r.error && r.error.status, 'PERMISSION_DENIED');
  const m = await mgr();
  r = await callFn('resendStaffLogin', { uid: 'mgr2' }, m);
  assert.equal(r.error && r.error.status, 'PERMISSION_DENIED');
  r = await callFn('resendStaffLogin', { uid: 'mgr1' }, m);
  assert.equal(r.error && r.error.status, 'FAILED_PRECONDITION');
  r = await callFn('resendStaffLogin', { uid: 'owner1' }, m);
  assert.equal(r.error && r.error.status, 'PERMISSION_DENIED');
  r = await callFn('resendStaffLogin', { uid: 'owner1' }, await owner());
  assert.equal(r.error && r.error.status, 'FAILED_PRECONDITION');
  r = await callFn('resendStaffLogin', { uid: 'old2' });
  assert.equal(r.error && r.error.status, 'UNAUTHENTICATED');
});

test('email switched off: login still created, honest reason, password shown once to the manager, no mail', async () => {
  await db.doc('private/mail').set({ ...MAIL_ON, enabled: false, disabledReason: 'Gmail rejected the app password (535 BadCredentials).' });
  const before = mails.length;
  const r = await callFn('createStaff', { name: 'Omar Off', email: 'omar@staff.test', role: 'staff' }, await owner());
  assert.equal(r.result && r.result.emailSent, false, JSON.stringify(r));
  assert.match(r.result.reason, /switched off/);
  assert.match(r.result.reason, /BadCredentials/);
  assert.match(r.result.tempPassword, /^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/);
  seenTemps.push(r.result.tempPassword);
  await sleep(800);
  assert.equal(mails.length, before);
  assert.equal((await db.doc(`staff/${r.result.uid}`).get()).get('loginEmail.status'), 'not-sent');
  assert.equal(await firestoreContains(r.result.tempPassword), null);
  const s = await signIn('omar@staff.test', r.result.tempPassword);
  assert.equal(claimsOf(s.idToken).pwChange, true);
});

test('mail server refuses: no duplicate account, retry says use Resend, Resend works once mail is fixed', async () => {
  await db.doc('private/mail').set(MAIL_ON);
  smtpMode = 'reject';
  const t = await owner();
  const r = await callFn('createStaff', { name: 'Ria Refused', email: 'ria@staff.test', role: 'staff' }, t);
  assert.equal(r.result && r.result.emailSent, false, JSON.stringify(r));
  assert.match(r.result.reason, /mail server refused/i);
  assert.ok(!r.result.reason.includes(r.result.tempPassword));
  seenTemps.push(r.result.tempPassword);
  const again = await callFn('createStaff', { name: 'Ria Refused', email: 'ria@staff.test', role: 'staff' }, t);
  assert.equal(again.error && again.error.status, 'ALREADY_EXISTS');
  assert.match(again.error.message, /Resend login/);
  const list = await auth.listUsers();
  assert.equal(list.users.filter((u) => u.email === 'ria@staff.test').length, 1, 'one account only');
  smtpMode = 'ok';
  const re = await callFn('resendStaffLogin', { uid: r.result.uid }, t);
  assert.equal(re.result && re.result.emailSent, true, JSON.stringify(re));
  const m = await waitMail('ria@staff.test');
  assert.match(m.raw, /Subject: Your White Swan staff login/, 'still worded as a new login');
  assert.ok((await signIn('ria@staff.test', r.result.tempPassword)).error, 'earlier temporary password replaced');
  assert.ok((await signIn('ria@staff.test', m.temp)).idToken);
});

test('old app versions using updateStaff resetPassword get the same gated, emailed behaviour', async () => {
  const r = await callFn('updateStaff', { uid: 'mgr2', resetPassword: true }, await owner());
  assert.equal(r.result && r.result.emailSent, true, JSON.stringify(r));
  assert.equal(r.result.tempPassword, null);
  const m = await waitMail('mgr2@hotel.test');
  const s = await signIn('mgr2@hotel.test', m.temp);
  assert.equal(claimsOf(s.idToken).pwChange, true);
  assert.equal(claimsOf(s.idToken).role, 'manager');
  assert.equal(await fsGet('shifts/s1', s.idToken), 403, 'a gated manager sees nothing either');
});

test('expired temporary password: change refused; daily job makes the old password stop working', async () => {
  await db.doc('authGate/old2').update({ expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() - 1000) });
  const temp = seenTemps[seenTemps.length - 1];
  const m = mails.filter((x) => x.rcpt.includes('old2@hotel.test')).pop();
  const t2 = (m.raw.replace(/=\r?\n/g, '').match(TEMP_RE) || [])[1];
  const s = await signIn('old2@hotel.test', t2);
  assert.ok(s.idToken, `temp ${temp ? 'known' : ''}`);
  const r = await callFn('completePasswordChange', { currentPassword: t2, newPassword: 'Ola-Own-Pass-2026' }, s.idToken);
  assert.equal(r.error && r.error.status, 'FAILED_PRECONDITION');
  assert.match(r.error.message, /run out/);
  // run the scheduled job's handler directly against the emulators
  const ob = require('../functions/onboarding.js');
  const fns = ob.makeFunctions({ sendMail: async () => ({ sent: false }), mailSettings: async () => null, mailReady: () => false, MAIL: {}, staffName: async () => '', clean: (v) => String(v || '') });
  await fns.expireTempLogins.run({});
  assert.ok((await signIn('old2@hotel.test', t2)).error, 'expired temporary password no longer signs in');
  assert.equal((await db.doc('authGate/old2').get()).get('expired'), true);
  assert.equal((await db.doc('staff/old2').get()).get('loginEmail.status'), 'expired');
});

test('temporary passwords are strong and unique', () => {
  const ob = require('../functions/onboarding.js');
  const set = new Set();
  for (let i = 0; i < 2000; i++) {
    const p = ob.generateTempPassword();
    assert.match(p, /^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/);
    assert.match(p, /[A-Z]/); assert.match(p, /[a-z]/); assert.match(p, /[2-9]/);
    set.add(p);
  }
  assert.equal(set.size, 2000);
  assert.equal(ob.safeReason(new Error('535 bad auth for Abcd-Efgh-2345-wxyz'), 'Abcd-Efgh-2345-wxyz').includes('Abcd'), false);
});
