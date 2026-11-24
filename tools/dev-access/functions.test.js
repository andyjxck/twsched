// Developer access functions test: runs the real handlers in functions/devAccess.js against the Firestore
// and Auth emulators with fake people and a fake mailer (no email is sent). Usage (from this folder):
//   firebase emulators:exec --only firestore,auth --project demo-dev-access "node functions.test.js"
process.env.GCLOUD_PROJECT = 'demo-dev-access';
const path = require('path');
const FN = path.resolve(__dirname, '../../functions');
const admin = require(FN + '/node_modules/firebase-admin');
admin.initializeApp({ projectId: 'demo-dev-access' });
const { makeFunctions } = require(FN + '/devAccess.js');
const mails = [];
const fake = (opts, h) => (typeof opts === 'function' ? opts : h);
const fns = makeFunctions({ onCall: fake, MAIL: {}, sendMail: async (m) => { mails.push(m); return { sent: true }; }, managerIds: async () => ['owner1', 'mgr1'], APP_URL: 'https://example.test/' });
const db = admin.firestore();
let pass = 0, fail = 0;
function check(name, cond, extra) { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra || ''); } }
async function expectErr(name, p, code) {
  try { await p; check(name, false, 'no error'); } catch (e) { check(name + ` (${e.code})`, e.code === code, e.message); }
}
const req = (uid, role, data, extra = {}) => ({ auth: { uid, token: { role, ...extra } }, data });
(async () => {
  for (const [uid, email, role] of [['owner1', 'owner@example.test', 'owner'], ['mgr1', 'mgr@example.test', 'manager'], ['dev1', 'dev@example.test', 'developer']]) {
    await admin.auth().createUser({ uid, email, password: 'x-' + uid + '-pass' });
    await admin.auth().setCustomUserClaims(uid, { role });
    await db.doc(`staff/${uid}`).set({ name: 'Fake ' + uid, email, role, developer: role === 'developer', active: true });
  }
  // the developer can never ask for a code, for itself or anyone
  await expectErr('developer cannot issue a code for itself', fns.grantDevAccess(req('dev1', 'developer', { uid: 'dev1' })), 'permission-denied');
  await expectErr('developer with an owner-like claim but a developer record cannot issue', fns.grantDevAccess(req('dev1', 'owner', { uid: 'dev1' })), 'permission-denied');
  await expectErr('manager cannot issue a code', fns.grantDevAccess(req('mgr1', 'manager', { uid: 'dev1' })), 'permission-denied');
  await expectErr('owner cannot send a code to a non-developer', fns.grantDevAccess(req('owner1', 'owner', { uid: 'mgr1' })), 'failed-precondition');
  // owner issues
  const g = await fns.grantDevAccess(req('owner1', 'owner', { uid: 'dev1' }));
  check('owner can issue a code', g.ok && g.grantId);
  const mail = mails.pop();
  const code = (mail.text.match(/Your code: (\d{8})/) || [])[1];
  check('code emailed to the developer login address only', mail.to === 'dev@example.test' && !!code);
  const c = await db.doc(`devCodes/${g.grantId}`).get();
  check('code stored hashed, never in plain text', c.exists && !JSON.stringify(c.data()).includes(code) && c.get('hash').length === 64);
  check('grant logged as pending with who gave it', (await db.doc(`devAccess/${g.grantId}`).get()).get('grantedBy') === 'owner1');
  await expectErr('only one code a minute', fns.grantDevAccess(req('owner1', 'owner', { uid: 'dev1' })), 'resource-exhausted');
  // redeeming
  await expectErr('owner cannot redeem', fns.redeemDevCode(req('owner1', 'owner', { code })), 'permission-denied');
  const wrong = code === '00000000' ? '11111111' : '00000000';
  await expectErr('wrong code refused', fns.redeemDevCode(req('dev1', 'developer', { code: wrong })), 'permission-denied');
  check('wrong attempt counted', (await db.doc(`devCodes/${g.grantId}`).get()).get('attempts') === 1);
  const r = await fns.redeemDevCode(req('dev1', 'developer', { code }));
  const hrs = (r.expiresAt - Date.now()) / 3600e3;
  check('right code gives 24 hours', r.ok && hrs > 23.9 && hrs <= 24, hrs);
  const gd = (await db.doc(`devAccess/${g.grantId}`).get()).data();
  check('grant active, usedAt and expiresAt recorded', gd.status === 'active' && gd.usedAt && gd.expiresAt);
  const claims = (await admin.auth().getUser('dev1')).customClaims;
  check('developer token gets devGrant, role stays developer', claims.role === 'developer' && claims.devGrant === g.grantId);
  check('code deleted after use', !(await db.doc(`devCodes/${g.grantId}`).get()).exists);
  check('owners (not managers) emailed when the code is used', mails.length === 1 && mails[0].to === 'owner@example.test', JSON.stringify(mails.map((m) => m.to)));
  mails.length = 0;
  await expectErr('used code cannot be reused', fns.redeemDevCode(req('dev1', 'developer', { code })), 'failed-precondition');
  await expectErr('developer with active grant still cannot issue codes', fns.grantDevAccess(req('dev1', 'developer', { uid: 'dev1' }, { devGrant: g.grantId })), 'permission-denied');
  await expectErr('developer cannot end grants', fns.endDevAccess(req('dev1', 'developer', { grantId: g.grantId })), 'permission-denied');
  await expectErr('owner cannot stack a second code during active access', fns.grantDevAccess(req('owner1', 'owner', { uid: 'dev1' })), 'failed-precondition');
  // owner ends early
  await fns.endDevAccess(req('owner1', 'owner', { grantId: g.grantId }));
  const ended = (await db.doc(`devAccess/${g.grantId}`).get()).data();
  check('owner can end access early (logged)', ended.status === 'ended' && ended.endedBy === 'owner1');
  check('devGrant claim removed on end', !(await admin.auth().getUser('dev1')).customClaims.devGrant);
  // lockout after 5 wrong tries
  await db.doc(`devAccess/${g.grantId}`).update({ createdAt: admin.firestore.Timestamp.fromMillis(Date.now() - 120e3) });
  const g2 = await fns.grantDevAccess(req('owner1', 'owner', { uid: 'dev1' }));
  const code2 = mails.pop().text.match(/Your code: (\d{8})/)[1];
  const bad = code2 === '22222222' ? '33333333' : '22222222';
  for (let i = 0; i < 4; i++) await fns.redeemDevCode(req('dev1', 'developer', { code: bad })).catch(() => {});
  await expectErr('5th wrong try locks the code', fns.redeemDevCode(req('dev1', 'developer', { code: bad })), 'permission-denied');
  check('locked grant logged', (await db.doc(`devAccess/${g2.grantId}`).get()).get('status') === 'locked');
  await expectErr('right code no longer works after lockout', fns.redeemDevCode(req('dev1', 'developer', { code: code2 })), 'failed-precondition');
  // expired code
  await db.doc(`devAccess/${g2.grantId}`).update({ createdAt: admin.firestore.Timestamp.fromMillis(Date.now() - 120e3) });
  const g3 = await fns.grantDevAccess(req('owner1', 'owner', { uid: 'dev1' }));
  const code3 = mails.pop().text.match(/Your code: (\d{8})/)[1];
  await db.doc(`devCodes/${g3.grantId}`).update({ codeExpiresAt: admin.firestore.Timestamp.fromMillis(Date.now() - 1000) });
  await expectErr('code older than an hour refused', fns.redeemDevCode(req('dev1', 'developer', { code: code3 })), 'deadline-exceeded');
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
