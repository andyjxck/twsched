// Publish-rota batching against local emulators only (project demo-pubrota). Made-up people; mail goes to a
// local SMTP sink on 127.0.0.1:2599 that writes /tmp/pubrota/mail.jsonl. Nothing reaches the real site.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8633';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9733';
const fs = require('fs');
const admin = require('/tmp/pubrota/repo/functions/node_modules/firebase-admin');
const { FieldValue } = require('/tmp/pubrota/repo/functions/node_modules/firebase-admin').firestore;
const P = 'demo-pubrota';
admin.initializeApp({ projectId: P });
const auth = admin.auth();
const db = admin.firestore();
const PW = 'Test-pass-12345';
const MAILF = '/tmp/pubrota/mail.jsonl';
let pass = 0, fail = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, cond, detail = '') {
  if (cond) pass++; else fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ->  ' + detail : ''}`);
}
async function mk(key, email, role) {
  const u = await auth.createUser({ email: email || `${key.toLowerCase()}-nomail@example.test`, password: PW, displayName: key });
  await auth.setCustomUserClaims(u.uid, { role });
  const doc = { name: key, role, active: true, onRota: true };
  if (email) doc.email = email;
  await db.doc(`staff/${u.uid}`).set(doc);
  return { uid: u.uid, login: email || `${key.toLowerCase()}-nomail@example.test`, name: key };
}
async function token(email) {
  const r = await fetch('http://127.0.0.1:9733/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW, returnSecureToken: true }) });
  const j = await r.json();
  if (!j.idToken) throw new Error('signin ' + email);
  return j.idToken;
}
async function call(who, fn, data) {
  const r = await fetch(`http://127.0.0.1:5533/${P}/europe-west2/${fn}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${await token(who.login)}` },
    body: JSON.stringify({ data }) });
  const j = await r.json();
  return j.error ? { ok: false, msg: j.error.message, status: j.error.status } : { ok: true, ...j.result };
}
function mails() {
  if (!fs.existsSync(MAILF)) return [];
  return fs.readFileSync(MAILF, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
async function notes(uid) {
  const s = await db.collection('notifications').where('uid', '==', uid).get();
  return s.docs.map((d) => d.data());
}
async function allNotes() {
  return (await db.collection('notifications').get()).size;
}
async function shift(id, s) {
  await db.doc(`shifts/${id}`).set({
    staffName: '', week: mondayOf(s.date), breakStart: '', breakEnd: '', area: '', notes: '', published: false,
    updatedAt: FieldValue.serverTimestamp(), updatedBy: 'test', ...s });
}
function mondayOf(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
async function week(w) {
  const d = await db.doc(`weeks/${w}`).get();
  return d.exists ? d.data() : {};
}
const pend = (wk) => Object.keys(wk.pending || {}).sort();
// waits for triggers to finish
async function settle(ms = 4000) { await sleep(ms); }

(async () => {
  try { fs.unlinkSync(MAILF); } catch (e) {}
  const owner = await mk('Olive Owner', 'olive@example.test', 'owner');
  const mgr = await mk('Manny Manager', 'manny@example.test', 'manager');
  const A = await mk('Alice Able', 'alice@example.test', 'staff');
  const B = await mk('Ben Baker', 'ben@example.test', 'staff');
  const C = await mk('Cara NoEmail', '', 'staff');
  const D = await mk('Dev Dodd', 'dev@example.test', 'staff');
  await db.doc('private/mail').set({ host: '127.0.0.1', port: 2599, secure: false, user: 'rota@example.test', pass: 'x',
    from: 'Test <rota@example.test>', enabled: true, emailStaff: true });
  const nm = { [A.uid]: 'Alice Able', [B.uid]: 'Ben Baker', [C.uid]: 'Cara NoEmail', [D.uid]: 'Dev Dodd' };
  const W1 = '2026-11-02', W2 = '2026-11-09', W3 = '2026-11-16', W4 = '2026-11-23', W5 = '2026-11-30';

  // ---------- 1. building a week: drafts added, changed, removed -> nothing sent
  await shift('a1', { staffId: A.uid, staffName: nm[A.uid], date: '2026-11-02', start: '09:00', end: '17:00', breakStart: '12:00', breakEnd: '12:30', breakPaid: false, area: 'Bar' });
  await shift('a2', { staffId: A.uid, staffName: nm[A.uid], date: '2026-11-04', start: '18:00', end: '02:00' });
  await shift('b1', { staffId: B.uid, staffName: nm[B.uid], date: '2026-11-03', start: '10:00', end: '16:00', breakStart: '13:00', breakEnd: '13:30' });
  await shift('b2', { staffId: B.uid, staffName: nm[B.uid], date: '2026-11-05', start: '10:00', end: '16:00' });
  await shift('c1', { staffId: C.uid, staffName: nm[C.uid], date: '2026-11-06', start: '11:00', end: '15:00' });
  await shift('x1', { staffId: B.uid, staffName: nm[B.uid], date: '2026-11-07', start: '11:00', end: '15:00' });
  await shift('b2', { staffId: B.uid, staffName: nm[B.uid], date: '2026-11-05', start: '10:30', end: '16:00' });
  await db.doc('shifts/x1').delete();
  await settle();
  check('building a week sends no notifications', (await allNotes()) === 0, `${await allNotes()}`);
  check('building a week sends no emails', mails().length === 0, `${mails().length}`);
  check('drafts do not mark anyone as pending', pend(await week(W1)).length === 0, JSON.stringify(pend(await week(W1))));

  // ---------- 2. publish rota
  const staffTry = await call(A, 'publishWeek', { weekStart: W1 });
  check('staff cannot publish', !staffTry.ok && staffTry.status === 'PERMISSION_DENIED', staffTry.msg);
  let r = await call(mgr, 'publishWeek', { weekStart: W1 });
  check('manager publishes week', r.ok && r.published === 5 && r.staffNotified === 3, JSON.stringify(r));
  await settle(3000);
  const nA = await notes(A.uid), nB = await notes(B.uid), nC = await notes(C.uid);
  check('one bell each for A, B, C', nA.length === 1 && nB.length === 1 && nC.length === 1, `${nA.length}/${nB.length}/${nC.length}`);
  check('bell lists shifts', nA[0] && /Rota for week of Mon 2 Nov is out/.test(nA[0].title) && /Mon 2 Nov 09:00-17:00, Wed 4 Nov 18:00-02:00/.test(nA[0].body), nA[0] && `${nA[0].title} | ${nA[0].body}`);
  let m = mails();
  check('two emails (C has no email)', m.length === 2, m.map((x) => x.to.join()).join(', '));
  const mA = m.find((x) => x.to.includes('alice@example.test'));
  check('A email subject', mA && mA.subject === 'Your shifts for the week of Mon 2 Nov', mA && mA.subject);
  check('A email lists day, date, times, break', mA && mA.text.includes('Mon 2 Nov: 09:00 to 17:00, break 12:00 to 12:30 (unpaid), Bar')
    && mA.text.includes('Wed 4 Nov: 18:00 to 02:00 (finishes the next day), no break'), mA && JSON.stringify(mA.text));
  const mB = m.find((x) => x.to.includes('ben@example.test'));
  check('B email shows paid break and edited draft time', mB && mB.text.includes('Tue 3 Nov: 10:00 to 16:00, break 13:00 to 13:30 (paid)') && mB.text.includes('Thu 5 Nov: 10:30 to 16:00'), mB && JSON.stringify(mB.text));
  let wk = await week(W1);
  check('week published, nothing pending', wk.status === 'published' && pend(wk).length === 0 && wk.snapV === 1, JSON.stringify({ s: wk.status, p: pend(wk) }));

  // ---------- 3. publishing again sends nothing
  r = await call(mgr, 'publishWeek', { weekStart: W1 });
  await settle(2000);
  check('second publish tells nobody', r.ok && r.staffNotified === 0 && mails().length === 2 && (await allNotes()) === 3, JSON.stringify(r));

  // ---------- 4. editing a published week: quick edits, add, remove -> nothing sent, pending shown
  await shift('a1', { staffId: A.uid, staffName: nm[A.uid], date: '2026-11-02', start: '10:00', end: '17:00', breakStart: '12:00', breakEnd: '12:30', breakPaid: false, area: 'Bar', published: true });
  await shift('a2', { staffId: A.uid, staffName: nm[A.uid], date: '2026-11-04', start: '18:00', end: '23:00', published: true });
  await shift('a2', { staffId: A.uid, staffName: nm[A.uid], date: '2026-11-04', start: '18:00', end: '23:30', published: true });
  await shift('a2', { staffId: A.uid, staffName: nm[A.uid], date: '2026-11-04', start: '18:00', end: '00:00', published: true });
  await shift('b3', { staffId: B.uid, staffName: nm[B.uid], date: '2026-11-08', start: '12:00', end: '18:00' });
  await db.doc('shifts/c1').delete();
  await settle(5000);
  wk = await week(W1);
  check('edits send no bells or emails', (await allNotes()) === 3 && mails().length === 2, `${await allNotes()} notes, ${mails().length} mails`);
  check('pending shows A and C (B only has a draft)', JSON.stringify(pend(wk)) === JSON.stringify([A.uid, C.uid].sort()), JSON.stringify(pend(wk).map((u) => nm[u])));

  // edit then undo -> pending clears again
  await shift('b1', { staffId: B.uid, staffName: nm[B.uid], date: '2026-11-03', start: '11:00', end: '16:00', breakStart: '13:00', breakEnd: '13:30', published: true });
  await settle(3000);
  check('B edit marks B pending', pend(await week(W1)).includes(B.uid));
  await shift('b1', { staffId: B.uid, staffName: nm[B.uid], date: '2026-11-03', start: '10:00', end: '16:00', breakStart: '13:00', breakEnd: '13:30', published: true });
  await settle(3000);
  check('undoing the edit clears B', !pend(await week(W1)).includes(B.uid), JSON.stringify(pend(await week(W1)).map((u) => nm[u])));
  // paid break switch counts as a change
  await shift('b1', { staffId: B.uid, staffName: nm[B.uid], date: '2026-11-03', start: '10:00', end: '16:00', breakStart: '13:00', breakEnd: '13:30', breakPaid: false, published: true });
  await settle(3000);
  check('unticking paid break marks B pending', pend(await week(W1)).includes(B.uid));

  // ---------- 5. publish changes: one update to each changed person only
  r = await call(mgr, 'publishWeek', { weekStart: W1 });
  await settle(3000);
  check('publish changes tells A, B and C', r.ok && r.published === 1 && r.staffNotified === 3, JSON.stringify(r));
  m = mails();
  check('two more emails (A, B)', m.length === 4, String(m.length));
  const uA = m.slice(2).find((x) => x.to.includes('alice@example.test'));
  check('A update subject', uA && uA.subject === 'Your shifts have changed: week of Mon 2 Nov', uA && uA.subject);
  check('A update shows was-times', uA && uA.text.includes('Mon 2 Nov: 10:00 to 17:00, break 12:00 to 12:30 (unpaid), Bar (changed, was 09:00 to 17:00)')
    && uA.text.includes('Wed 4 Nov: 18:00 to 00:00 (finishes the next day), no break (changed, was 18:00 to 02:00)'), uA && JSON.stringify(uA.text));
  const uB = m.slice(2).find((x) => x.to.includes('ben@example.test'));
  check('B update marks new shift and break change', uB && uB.text.includes('Sun 8 Nov: 12:00 to 18:00, no break (new)') && uB.text.includes('(unpaid)'), uB && JSON.stringify(uB.text));
  const ncC = await notes(C.uid);
  check('C (no email) gets one bell saying taken off', ncC.length === 2 && /no longer on the rota/.test(ncC.find((n) => /changed/.test(n.title)).body) && /Taken off: Fri 6 Nov 11:00-15:00/.test(ncC.find((n) => /changed/.test(n.title)).body), JSON.stringify(ncC.map((n) => n.body)));
  check('D (not on rota) told nothing', (await notes(D.uid)).length === 0);
  wk = await week(W1);
  check('pending cleared after publishing changes', pend(wk).length === 0, JSON.stringify(pend(wk)));

  // ---------- 6. approve after publish -> no duplicates
  r = await call(owner, 'approveWeek', { weekStart: W1 });
  await settle(2000);
  check('approving a published week tells nobody', r.ok && r.staffNotified === 0 && r.status === 'approved' && mails().length === 4, JSON.stringify(r));
  const mgrApproved = await call(mgr, 'publishWeek', { weekStart: W1 });
  check('manager cannot publish an approved week', !mgrApproved.ok, mgrApproved.msg);

  // ---------- 7. approving days one by one, then publishing
  await shift('d1', { staffId: D.uid, staffName: nm[D.uid], date: '2026-11-09', start: '09:00', end: '13:00' });
  await shift('d2', { staffId: D.uid, staffName: nm[D.uid], date: '2026-11-10', start: '09:00', end: '13:00' });
  await shift('d3', { staffId: D.uid, staffName: nm[D.uid], date: '2026-11-11', start: '09:00', end: '13:00' });
  await settle(2000);
  const before7 = { n: await allNotes(), m: mails().length };
  r = await call(mgr, 'approveDay', { date: '2026-11-09' });
  const r2 = await call(mgr, 'approveDay', { date: '2026-11-10' });
  await settle(4000);
  check('approving two days publishes their drafts', r.ok && r.published === 1 && r2.ok && r2.published === 1, JSON.stringify([r, r2]));
  check('approving days sends no bells or emails', (await allNotes()) === before7.n && mails().length === before7.m);
  check('approved-day drafts show as pending for D', pend(await week(W2)).includes(D.uid), JSON.stringify(pend(await week(W2))));
  r = await call(mgr, 'publishWeek', { weekStart: W2 });
  await settle(3000);
  const nD = await notes(D.uid);
  const mD = mails().filter((x) => x.to.includes('dev@example.test'));
  check('publish after day approvals: one bell, one email for D', r.ok && r.staffNotified === 1 && nD.length === 1 && mD.length === 1, `${JSON.stringify(r)} ${nD.length}/${mD.length}`);
  check('D email lists all three days', mD[0] && ['Mon 9 Nov', 'Tue 10 Nov', 'Wed 11 Nov'].every((d) => mD[0].text.includes(d)), mD[0] && JSON.stringify(mD[0].text));
  r = await call(owner, 'approveWeek', { weekStart: W2 });
  await settle(2000);
  check('approve week after that sends nothing', r.ok && r.staffNotified === 0 && (await notes(D.uid)).length === 1);

  // ---------- 8. approving a never-published week sends the rota once
  await shift('a5', { staffId: A.uid, staffName: nm[A.uid], date: '2026-12-01', start: '09:00', end: '12:00' });
  await settle(2000);
  const nA0 = (await notes(A.uid)).length;
  r = await call(owner, 'approveWeek', { weekStart: W5 });
  await settle(3000);
  check('approve without publishing: one message to A', r.ok && r.staffNotified === 1 && (await notes(A.uid)).length === nA0 + 1, JSON.stringify(r));

  // ---------- 9. staff emails switched off: bells only
  await db.doc('private/mail').set({ emailStaff: false }, { merge: true });
  await shift('b9', { staffId: B.uid, staffName: nm[B.uid], date: '2026-11-17', start: '09:00', end: '12:00' });
  await settle(2000);
  const m9 = mails().length, nB0 = (await notes(B.uid)).length;
  r = await call(mgr, 'publishWeek', { weekStart: W3 });
  await settle(3000);
  check('staff emails off: bell yes, email no', r.ok && r.staffNotified === 1 && (await notes(B.uid)).length === nB0 + 1 && mails().length === m9, `${mails().length - m9} mails`);
  await db.doc('private/mail').set({ emailStaff: true }, { merge: true });

  // ---------- 10. week published before this change (no snapshots)
  await shift('l1', { staffId: A.uid, staffName: nm[A.uid], date: '2026-11-23', start: '09:00', end: '17:00', published: true });
  await shift('l2', { staffId: A.uid, staffName: nm[A.uid], date: '2026-11-24', start: '09:00', end: '17:00', published: true });
  await shift('l3', { staffId: B.uid, staffName: nm[B.uid], date: '2026-11-25', start: '09:00', end: '17:00', published: true });
  await settle(4000);
  for (const d of (await db.collection('rotaSent').where('week', '==', W4).get()).docs) await d.ref.delete();
  await db.doc(`weeks/${W4}`).set({ weekStart: W4, status: 'published', publishedByName: 'Old' });
  await sleep(500);
  const nA1 = (await notes(A.uid)).length, nB1 = (await notes(B.uid)).length, m10 = mails().length;
  await shift('l2', { staffId: A.uid, staffName: nm[A.uid], date: '2026-11-24', start: '12:00', end: '17:00', published: true });
  await shift('l4', { staffId: A.uid, staffName: nm[A.uid], date: '2026-11-26', start: '09:00', end: '12:00' });
  await settle(4000);
  check('old-style week: edit marks only A pending', JSON.stringify(pend(await week(W4))) === JSON.stringify([A.uid]), JSON.stringify(pend(await week(W4)).map((u) => nm[u])));
  r = await call(mgr, 'publishWeek', { weekStart: W4 });
  await settle(3000);
  const lA = mails().slice(m10).find((x) => x.to.includes('alice@example.test'));
  check('old-style week: only A told, as a change', r.ok && r.staffNotified === 1 && (await notes(B.uid)).length === nB1 && (await notes(A.uid)).length === nA1 + 1, JSON.stringify(r));
  check('old-style week: A email shows change and new shift only as such', lA && lA.subject.startsWith('Your shifts have changed') && lA.text.includes('Tue 24 Nov: 12:00 to 17:00, no break (changed, was 09:00 to 17:00)')
    && lA.text.includes('Thu 26 Nov: 09:00 to 12:00, no break (new)') && /Mon 23 Nov: 09:00 to 17:00, no break\r?\n/.test(lA.text), lA && JSON.stringify(lA.text));

  // ---------- 11. two people pressing publish at the same moment
  await shift('p1', { staffId: B.uid, staffName: nm[B.uid], date: '2026-11-18', start: '14:00', end: '18:00' });
  await settle(2000);
  const nB2 = (await notes(B.uid)).length, m11 = mails().length;
  const [ra, rb] = await Promise.all([call(mgr, 'publishWeek', { weekStart: W3 }), call(owner, 'publishWeek', { weekStart: W3 })]);
  await settle(3000);
  check('double press sends one update', ra.ok && rb.ok && ra.staffNotified + rb.staffNotified === 1 && (await notes(B.uid)).length === nB2 + 1 && mails().length === m11 + 1, JSON.stringify([ra.staffNotified, rb.staffNotified, mails().length - m11]));

  // ---------- 12. past weeks never go pending
  await shift('old1', { staffId: A.uid, staffName: nm[A.uid], date: '2026-10-14', start: '09:00', end: '17:00', published: true });
  await settle(2000);
  check('past week edit: no pending, no week doc', !(await db.doc('weeks/2026-10-12').get()).exists);

  // ---------- 13. rotaSent is server-only
  const tokA = await token(A.login);
  const rr = await fetch(`http://127.0.0.1:8633/v1/projects/${P}/databases/(default)/documents/rotaSent`, { headers: { authorization: `Bearer ${tokA}` } });
  check('staff cannot read rotaSent', rr.status === 403, String(rr.status));
  const tokM = await token(mgr.login);
  const rm = await fetch(`http://127.0.0.1:8633/v1/projects/${P}/databases/(default)/documents/rotaSent`, { headers: { authorization: `Bearer ${tokM}` } });
  check('managers cannot read rotaSent', rm.status === 403, String(rm.status));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
