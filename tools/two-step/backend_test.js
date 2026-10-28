// Two-step backend test: REAL firestore.rules, storage.rules and Cloud Functions from this branch on LOCAL
// emulators (run via run_backend_tests.sh, project demo-twostep). Made-up people only.
//
// The Auth emulator does not implement TOTP (it answers "TOTP based MFA not supported yet"), so the
// second factor here is the emulator's SMS factor. The ID token it issues carries the same
// firebase.sign_in_second_factor claim the rules and callables check (value 'phone' instead of 'totp');
// nothing in the server code looks at which factor it was.
const path = require('path');
const FN_DIR = '/tmp/tws-twostep-e2e/functions';
const admin = require(path.join(FN_DIR, 'node_modules/firebase-admin'));
const twoStep = require(path.join(FN_DIR, 'twoStep.js'));

const P = 'demo-twostep';
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const FS = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${P}/databases/(default)/documents`;
const ST = `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9641'}`;
const FN = `http://127.0.0.1:5641/${P}/europe-west2`;
const BUCKET = `${P}.appspot.com`;
admin.initializeApp({ projectId: P, storageBucket: BUCKET });
const db = admin.firestore();
const PW = 'Test-pass-12345';
let pass = 0, fail = 0;
const check = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  ->  ' + d : ''}`); };
const ids = {};
const post = async (url, body, headers = {}) => {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const claimsOf = (tok) => JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString());
const idt = (p) => `${AUTH}/identitytoolkit.googleapis.com/${p}?key=fake-key`;

async function lastSmsCode(phone) {
  const r = await fetch(`${AUTH}/emulator/v1/projects/${P}/verificationCodes`);
  const codes = (await r.json()).verificationCodes.filter((c) => c.phoneNumber === phone);
  return codes[codes.length - 1];
}
async function mk(name, email, role, extra = {}) {
  const u = await admin.auth().createUser({ email, password: PW, displayName: name, emailVerified: true });
  ids[name] = u.uid;
  await db.doc(`staff/${u.uid}`).set({ name, email, role, active: true, onRota: true, jobTitle: 'Bar', ...extra });
  await db.doc(`directory/${u.uid}`).set({ name, jobTitle: 'Bar', role, active: true, terminated: false, onRota: true });
  return u.uid;
}
async function setClaimsLikeServer(uid, role) {
  // Same function claimsFor() and createStaff use.
  await admin.auth().setCustomUserClaims(uid, twoStep.withTwoStepClaim({ role }, role, await twoStep.enforced()));
}
async function pwSignIn(email) {
  return (await post(idt('v1/accounts:signInWithPassword'), { email, password: PW, returnSecureToken: true })).json;
}
async function enrolSms(email, phone) {
  const s = await pwSignIn(email);
  const st = await post(idt('v2/accounts/mfaEnrollment:start'), { idToken: s.idToken, phoneEnrollmentInfo: { phoneNumber: phone } });
  const code = await lastSmsCode(phone);
  const fin = await post(idt('v2/accounts/mfaEnrollment:finalize'), {
    idToken: s.idToken, displayName: 'test phone',
    phoneVerificationInfo: { sessionInfo: st.json.phoneSessionInfo.sessionInfo, code: code.code },
  });
  return fin.json;
}
async function mfaSignIn(email, phone) {
  const s = await pwSignIn(email);
  if (!s.mfaPendingCredential) return { error: 'no second factor asked for', first: s };
  const st = await post(idt('v2/accounts/mfaSignIn:start'), {
    mfaPendingCredential: s.mfaPendingCredential, mfaEnrollmentId: s.mfaInfo[0].mfaEnrollmentId, phoneSignInInfo: {},
  });
  const code = await lastSmsCode(phone);
  const fin = await post(idt('v2/accounts/mfaSignIn:finalize'), {
    mfaPendingCredential: s.mfaPendingCredential,
    phoneVerificationInfo: { sessionInfo: st.json.phoneResponseInfo.sessionInfo, code: code.code },
  });
  return { first: s, idToken: fin.json.idToken, raw: fin.json };
}
async function fsGet(tok, docPath) {
  const r = await fetch(`${FS}/${docPath}`, { headers: tok ? { authorization: `Bearer ${tok}` } : {} });
  return r.status;
}
async function fsList(tok, coll) {
  const r = await fetch(`${FS}/${coll}?pageSize=50`, { headers: { authorization: `Bearer ${tok}` } });
  return r.status;
}
async function fsCreateShift(tok, uid, staffId, date, week) {
  const name = `${FS.replace(/^http:\/\/[^/]+\/v1\//, '')}/shifts/t${Math.random().toString(36).slice(2, 12)}`;
  const S = (v) => ({ stringValue: v });
  const body = {
    writes: [{
      update: { name, fields: {
        staffId: S(staffId), staffName: S('Sam Staff'), date: S(date), week: S(week), start: S('10:00'), end: S('16:00'),
        published: { booleanValue: false }, updatedBy: S(uid),
      } },
      updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
      currentDocument: { exists: false },
    }],
  };
  const r = await fetch(`${FS}:commit`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, msg: (j.error && j.error.message || '').slice(0, 160) };
}
async function stGet(tok, objPath) {
  try {
    const r = await fetch(`${ST}/v0/b/${BUCKET}/o/${encodeURIComponent(objPath)}`, { headers: { authorization: `Firebase ${tok}` } });
    const body = await r.text();
    if (process.env.TS_DEBUG) console.log('   storage', objPath, r.status, body.slice(0, 160).replace(/\s+/g, ' '));
    return r.status;
  } catch (e) { console.log('   storage error', objPath, e.cause ? e.cause.code || e.cause.message : e.message); return -1; }
}
async function callFn(name, tok, data) {
  const r = await post(`${FN}/${name}`, { data }, tok ? { authorization: `Bearer ${tok}` } : {});
  const e = r.json.error;
  return { status: r.status, ok: !e, code: e && e.status, reason: e && e.details && e.details.reason, msg: e && e.message, result: r.json.result };
}
const add = (ymd, n) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mondayAfter = () => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 14 + ((8 - d.getUTCDay()) % 7)); return d.toISOString().slice(0, 10); };

(async () => {
  // ---------------- Phase 1: switch OFF (how this ships) ----------------
  console.log('--- switch off (nothing changes) ---');
  const owner1 = await mk('Olly Owner', 'olly@example.test', 'owner');
  await setClaimsLikeServer(owner1, 'owner');
  let t = (await pwSignIn('olly@example.test')).idToken;
  check('switch off: owner gets no mfa claim', claimsOf(t).mfa === undefined);
  check('switch off: owner signs in with password only and reads staff records', (await fsList(t, 'staff')) === 200);

  // ---------------- Phase 2: switch ON ----------------
  console.log('--- switch on ---');
  await db.doc(twoStep.SETTING).set({ enforced: true });
  const owner2 = await mk('Ola Owner', 'ola@example.test', 'owner');
  const mgr = await mk('Mia Manager', 'mia@example.test', 'manager');
  const pay = await mk('Pat Payroll', 'pat@example.test', 'payroll', { onRota: false });
  const staff = await mk('Sam Staff', 'sam@example.test', 'staff');
  const dev = await mk('Dev Login', 'dev@example.test', 'developer', { developer: true, onRota: false });
  const mgrDevFlag = await mk('Flag Manager', 'flag@example.test', 'manager', { developer: true, onRota: false });
  for (const [u, r] of [[owner1, 'owner'], [owner2, 'owner'], [mgr, 'manager'], [pay, 'payroll'], [staff, 'staff'], [dev, 'developer'], [mgrDevFlag, 'manager']]) {
    await setClaimsLikeServer(u, r);
  }
  const C = async (email) => claimsOf((await pwSignIn(email)).idToken);
  check('owner gets mfa claim', (await C('olly@example.test')).mfa === true);
  check('manager gets mfa claim', (await C('mia@example.test')).mfa === true);
  check('payroll does not (not above manager)', (await C('pat@example.test')).mfa === undefined);
  check('staff does not', (await C('sam@example.test')).mfa === undefined);
  check('developer login does not (exempt)', (await C('dev@example.test')).mfa === undefined);
  check('manager with a developer flag on its record still does (no back door)', (await C('flag@example.test')).mfa === true);

  // Some data to read
  await db.doc('payslips/p1').set({ staffId: staff, period: '2026-10', fileName: 'x.pdf' });
  await db.doc('settings/general').set({ x: 1 }).catch(() => {});
  await admin.storage().bucket().file(`payslips/${staff}/x.pdf`).save(Buffer.from('%PDF-1.4 test'), { contentType: 'application/pdf', resumable: false });
  await admin.storage().bucket().file(`rtw/${staff}/abcdefghijklmnopqrst.pdf`).save(Buffer.from('%PDF-1.4 test'), { contentType: 'application/pdf', resumable: false });
  const week = mondayAfter();

  console.log('--- manager / owner WITHOUT a second factor are locked out ---');
  const mPw = (await pwSignIn('mia@example.test')).idToken;
  const oPw = (await pwSignIn('olly@example.test')).idToken;
  check('manager, password only: staff records denied', (await fsGet(mPw, `staff/${staff}`)) === 403);
  check('manager, password only: own staff record denied too', (await fsGet(mPw, `staff/${mgr}`)) === 403);
  check('manager, password only: rota (shifts) denied', (await fsList(mPw, 'shifts')) === 403);
  check('manager, password only: directory denied', (await fsList(mPw, 'directory')) === 403);
  const ms = await fsCreateShift(mPw, mgr, staff, add(week, 1), week);
  check('manager, password only: cannot create a shift', ms.status === 403, ms.msg);
  check('owner, password only: payslips denied', (await fsList(oPw, 'payslips')) === 403);
  check('owner, password only: Storage payslip file denied', (await stGet(oPw, `payslips/${staff}/x.pdf`)) === 403);
  check('owner, password only: Storage right-to-work file denied', (await stGet(oPw, `rtw/${staff}/abcdefghijklmnopqrst.pdf`)) === 403);
  let r = await callFn('updateStaff', oPw, { uid: staff, jobTitle: 'Floor' });
  check('owner, password only: callables refused (two-step-required)', !r.ok && r.reason === 'two-step-required', `${r.code} ${r.reason}`);
  r = await callFn('resetTwoStep', oPw, { uid: mgr });
  check('owner, password only: cannot reset someone else\'s two-step', !r.ok && r.reason === 'two-step-required', `${r.code} ${r.reason}`);

  console.log('--- enrol, then sign in with the second factor ---');
  const enO = await enrolSms('olly@example.test', '+447700900001');
  const enM = await enrolSms('mia@example.test', '+447700900002');
  check('owner enrolment finalised', !!enO.idToken, JSON.stringify(enO).slice(0, 120));
  check('manager enrolment finalised', !!enM.idToken);
  const o2 = await mfaSignIn('olly@example.test', '+447700900001');
  const m2 = await mfaSignIn('mia@example.test', '+447700900002');
  check('after enrolling, password alone no longer signs in (second factor asked for)', !!o2.first.mfaPendingCredential && !o2.first.idToken);
  const oc = claimsOf(o2.idToken), mc = claimsOf(m2.idToken);
  check('real Firebase token carries firebase.sign_in_second_factor', !!(oc.firebase && oc.firebase.sign_in_second_factor), JSON.stringify(oc.firebase && oc.firebase.sign_in_second_factor));
  check('manager + second factor: staff records allowed', (await fsGet(m2.idToken, `staff/${staff}`)) === 200);
  check('manager + second factor: rota allowed', (await fsList(m2.idToken, 'shifts')) === 200);
  const ms2 = await fsCreateShift(m2.idToken, mgr, staff, add(week, 1), week);
  check('manager + second factor: can create a shift (heaviest rule still under the expression limit)', ms2.status === 200, ms2.msg);
  check('manager + second factor: payslips still denied (unchanged permissions)', (await fsList(m2.idToken, 'payslips')) === 403);
  check('owner + second factor: payslips allowed', (await fsList(o2.idToken, 'payslips')) === 200);
  check('owner + second factor: Storage payslip file allowed', (await stGet(o2.idToken, `payslips/${staff}/x.pdf`)) === 200);
  check('owner + second factor: Storage right-to-work file allowed', (await stGet(o2.idToken, `rtw/${staff}/abcdefghijklmnopqrst.pdf`)) === 200);
  r = await callFn('updateStaff', o2.idToken, { uid: staff, jobTitle: 'Floor' });
  check('owner + second factor: callables work', r.ok, r.msg);
  r = await callFn('updateStaff', m2.idToken, { uid: staff, jobTitle: 'Floor' });
  check('manager + second factor: still cannot edit staff (owner-only, unchanged)', !r.ok && r.code === 'PERMISSION_DENIED', `${r.code}`);

  console.log('--- staff, payroll unchanged ---');
  const sPw = (await pwSignIn('sam@example.test')).idToken;
  check('staff: password only, own record readable', (await fsGet(sPw, `staff/${staff}`)) === 200);
  check('staff: other records still denied', (await fsGet(sPw, `staff/${mgr}`)) === 403);
  check('staff: own payslip file readable', (await stGet(sPw, `payslips/${staff}/x.pdf`)) === 200);
  const pPw = (await pwSignIn('pat@example.test')).idToken;
  check('payroll: password only, payslips readable (unchanged)', (await fsList(pPw, 'payslips')) === 200);

  console.log('--- developer login: exempt from two-step, still reaches nothing ---');
  const dPw = (await pwSignIn('dev@example.test')).idToken;
  check('developer signs in with password only (no second factor asked)', !!dPw);
  check('developer: own staff record denied', (await fsGet(dPw, `staff/${dev}`)) === 403);
  check('developer: other staff records denied', (await fsGet(dPw, `staff/${staff}`)) === 403);
  check('developer: directory denied', (await fsList(dPw, 'directory')) === 403);
  check('developer: rota denied', (await fsList(dPw, 'shifts')) === 403);
  check('developer: payslips denied', (await fsList(dPw, 'payslips')) === 403);
  check('developer: settings/general denied', (await fsGet(dPw, 'settings/general')) === 403);
  check('developer: Storage payslip file denied', (await stGet(dPw, `payslips/${staff}/x.pdf`)) === 403);
  check('developer: Storage right-to-work file denied', (await stGet(dPw, `rtw/${staff}/abcdefghijklmnopqrst.pdf`)) === 403);
  const ds = await fsCreateShift(dPw, dev, staff, add(week, 2), week);
  check('developer: cannot create a shift', ds.status === 403);
  r = await callFn('updateStaff', dPw, { uid: staff, jobTitle: 'x' });
  check('developer: owner callables refused', !r.ok && r.code === 'PERMISSION_DENIED', `${r.code}`);
  r = await callFn('resetTwoStep', dPw, { uid: mgr });
  check('developer: cannot reset anyone\'s two-step', !r.ok && r.code === 'PERMISSION_DENIED', `${r.code}`);
  const fPw = (await pwSignIn('flag@example.test')).idToken;
  check('manager record flagged developer, password only: still locked out', (await fsList(fPw, 'shifts')) === 403);

  console.log('--- promotion / demotion move the requirement with the role ---');
  r = await callFn('updateStaff', o2.idToken, { uid: staff, role: 'manager' });
  check('owner promotes staff to manager', r.ok, r.msg);
  check('promoted manager now has the mfa claim', (await C('sam@example.test')).mfa === true);
  r = await callFn('updateStaff', o2.idToken, { uid: staff, role: 'staff' });
  check('demoted back to staff: claim removed', r.ok && (await C('sam@example.test')).mfa === undefined, r.msg);

  console.log('--- lost phone: owner reset ---');
  r = await callFn('resetTwoStep', o2.idToken, { uid: o2.first.localId });
  check('owner cannot reset their own two-step', !r.ok && r.code === 'FAILED_PRECONDITION', r.code);
  r = await callFn('resetTwoStep', m2.idToken, { uid: owner1 });
  check('manager cannot reset two-step', !r.ok && r.code === 'PERMISSION_DENIED', r.code);
  r = await callFn('resetTwoStep', o2.idToken, { uid: mgr });
  check('owner + second factor resets manager\'s authenticator', r.ok, r.msg);
  const mu = await admin.auth().getUser(mgr);
  check('manager has no enrolled factor after reset', !(mu.multiFactor && mu.multiFactor.enrolledFactors && mu.multiFactor.enrolledFactors.length));
  const mAfter = await pwSignIn('mia@example.test');
  check('reset manager signs in with password but is still locked out until re-enrolled', !!mAfter.idToken && claimsOf(mAfter.idToken).mfa === true && (await fsList(mAfter.idToken, 'shifts')) === 403);

  // Not tested here: forged/unsigned tokens. The emulators accept unsigned tokens by design; in
  // production Firestore, Storage and callables verify Google's signature on every ID token.

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
