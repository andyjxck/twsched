// Right to Work checks (owner-only, one or two files per check) against local emulators only, project
// demo-rtwchk. Made-up people and a fake PDF. No real accounts, documents or emails.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8311';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9311';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9411';
const admin = require('/tmp/rtw2/repo/functions/node_modules/firebase-admin');
const P = 'demo-rtwchk';
const BUCKET = `${P}.appspot.com`;
admin.initializeApp({ projectId: P, storageBucket: BUCKET });
const auth = admin.auth();
const db = admin.firestore();
const PW = 'Test-pass-12345';
const RUN = '-' + Date.now().toString(36);
const DOCS = `projects/${P}/databases/(default)/documents`;
let pass = 0, fail = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mk(key, email, role) {
  const u = await auth.createUser({ email, password: PW, displayName: key });
  await auth.setCustomUserClaims(u.uid, { role });
  await db.doc(`staff/${u.uid}`).set({ name: key, email, role, active: true, onRota: true });
  return u.uid;
}
async function token(email) {
  const r = await fetch('http://127.0.0.1:9311/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW, returnSecureToken: true }) });
  const j = await r.json();
  if (!j.idToken) throw new Error('signin ' + email + ' ' + JSON.stringify(j));
  return j.idToken;
}
function expect(name, r, wantOk) {
  const good = r.ok === wantOk;
  if (good) pass++; else fail++;
  console.log(`${good ? 'PASS' : 'FAIL'}  ${name}  ->  ${r.ok ? 'ok' : r.status + ': ' + r.msg}`);
}
function check(name, cond, detail = '') {
  if (cond) pass++; else fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ->  ' + detail : ''}`);
}
function val(v) {
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (Number.isInteger(v)) return { integerValue: String(v) };
  throw new Error('type');
}
const short = (t) => t.slice(0, 110).replace(/\s+/g, ' ');
async function rulesWrite(tok, path, fields) {
  const f = {};
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) f[k] = val(v);
  const body = { writes: [{ update: { name: `${DOCS}/${path}`, fields: f },
    updateTransforms: [{ fieldPath: 'uploadedAt', setToServerValue: 'REQUEST_TIME' }], currentDocument: { exists: false } }] };
  const r = await fetch(`http://127.0.0.1:8311/v1/${DOCS}:commit`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: JSON.stringify(body) });
  const t = await r.text();
  return r.ok ? { ok: true } : { ok: false, status: r.status, msg: short(t) };
}
async function rulesRead(tok, path) {
  const r = await fetch(`http://127.0.0.1:8311/v1/${DOCS}/${path}`, { headers: { authorization: `Bearer ${tok}` } });
  const t = await r.text();
  return r.ok ? { ok: true } : { ok: false, status: r.status, msg: short(t) };
}
async function rulesDelete(tok, path) {
  const r = await fetch(`http://127.0.0.1:8311/v1/${DOCS}/${path}`, { method: 'DELETE', headers: { authorization: `Bearer ${tok}` } });
  const t = await r.text();
  return r.ok ? { ok: true } : { ok: false, status: r.status, msg: short(t) };
}
const PDF = Buffer.from('%PDF-1.4\n% made-up test file, not a real document\n%%EOF\n');
async function storageUpload(tok, path, body = PDF, type = 'application/pdf') {
  const r = await fetch(`http://127.0.0.1:9411/v0/b/${BUCKET}/o?name=${encodeURIComponent(path)}`, {
    method: 'POST', headers: { 'content-type': type, authorization: `Firebase ${tok}` }, body });
  const t = await r.text();
  return r.ok ? { ok: true } : { ok: false, status: r.status, msg: short(t) };
}
const A62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const rid = () => Array.from({ length: 20 }, () => A62[Math.floor(Math.random() * 62)]).join('');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(Date.now() + 86400000 * 2));
function meta(staffId, id, by, chk, extra = {}) {
  return { staffId, staffName: 'x', kind: 'rtw', fileName: 'scan.pdf', contentType: 'application/pdf', size: PDF.length,
    storagePath: `rtw/${staffId}/${id}.pdf`, uploadedBy: by, uploadedByName: 'x', declared: true, checkedOn: today, ...chk, ...extra };
}
async function upload(tok, staffId, by, chk, extra = {}, body = PDF) {
  const id = rid();
  const f = await storageUpload(tok, `rtw/${staffId}/${id}.pdf`, body);
  const m = await rulesWrite(tok, `staffDocs/${id}`, meta(staffId, id, by, chk, { ...extra, size: body.length }));
  return { id, f, m, ok: f.ok && m.ok, status: f.ok ? m.status : f.status, msg: f.ok ? m.msg : f.msg };
}
async function waitFor(fn, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(400); }
  return null;
}
const docData = async (id) => { const s = await db.doc(`staffDocs/${id}`).get(); return s.exists ? s.data() : null; };
const status = async (sid) => { const s = await db.doc(`rtwStatus/${sid}`).get(); return s.exists ? s.data() : null; };
const fileExists = async (p) => (await admin.storage().bucket(BUCKET).file(p).exists())[0];
const checkedSoon = (id) => waitFor(async () => { const d = await docData(id); return d && d.checked === true; });
const goneSoon = (id) => waitFor(async () => !(await docData(id)));

(async () => {
  // Pure helpers first.
  const D = require('/tmp/rtw2/repo/functions/documents.js');
  const base = { checkId: rid(), declared: true, checkedOn: today };
  check('shape: passport alone fits', D.checkShapeReason({ ...base, route: 'passport', slot: 1, docType: 'passport' }) === '');
  check('shape: Irish passport card fits', D.checkShapeReason({ ...base, route: 'passport', slot: 1, docType: 'passport_card' }) === '');
  check('shape: birth certificate as file 2 refused', D.checkShapeReason({ ...base, route: 'birth_ni', slot: 2, docType: 'birth_certificate' }) !== '');
  check('shape: NI proof as file 2 fits', D.checkShapeReason({ ...base, route: 'birth_ni', slot: 2, docType: 'ni_evidence' }) === '');
  check('shape: future date refused', D.checkShapeReason({ ...base, checkedOn: tomorrow, route: 'passport', slot: 1, docType: 'passport' }) !== '');
  check('shape: 30 February refused', D.checkShapeReason({ ...base, checkedOn: '2026-02-30', route: 'passport', slot: 1, docType: 'passport' }) !== '');
  check('shape: not confirmed refused', D.checkShapeReason({ ...base, declared: false, route: 'passport', slot: 1, docType: 'passport' }) !== '');
  const g = (id, route, slot, docType, checked = true) => ({ kind: 'rtw', checkId: id, route, slot, docType, checked, checkedOn: '2026-10-20' });
  check('summary: birth cert without NI proof is not complete', D.summariseRtw([g('a', 'birth_ni', 1, 'birth_certificate')]).count === 0);
  check('summary: birth cert + NI proof is complete', D.summariseRtw([g('a', 'birth_ni', 1, 'birth_certificate'), g('a', 'birth_ni', 2, 'ni_evidence')]).count === 1);
  check('summary: unverified second file does not count', D.summariseRtw([g('a', 'birth_ni', 1, 'birth_certificate'), g('a', 'birth_ni', 2, 'ni_evidence', false)]).count === 0);
  check('summary: old file without a check still counts', D.summariseRtw([{ kind: 'rtw', docType: 'passport', checked: true }]).count === 1);
  check('summary: other with one file is complete', D.summariseRtw([g('b', 'other', 1, 'brp')]).count === 1);

  const owner = await mk('Owner', 'owner@example.test'.replace('@', RUN + '@'), 'owner');
  const owner2 = await mk('Owner2', 'owner2@example.test'.replace('@', RUN + '@'), 'owner');
  const mgr = await mk('Manager', 'mgr@example.test'.replace('@', RUN + '@'), 'manager');
  const pay = await mk('Payroll', 'pay@example.test'.replace('@', RUN + '@'), 'payroll');
  const s1 = await mk('Staff1', 's1@example.test'.replace('@', RUN + '@'), 'staff');
  const s2 = await mk('Staff2', 's2@example.test'.replace('@', RUN + '@'), 'staff');
  const s3 = await mk('Staff3', 's3@example.test'.replace('@', RUN + '@'), 'staff');
  const [tO, tO2, tM, tP, t1] = await Promise.all(['owner', 'owner2', 'mgr', 'pay', 's1'].map((k) => token(`${k}${RUN}@example.test`)));

  console.log('--- who can upload');
  const pass1 = { checkId: rid(), route: 'passport', slot: 1, docType: 'passport' };
  const mU = await upload(tM, s1, mgr, pass1);
  expect('manager uploads for a team member (blocked)', mU, false);
  { const id = rid(); expect('manager saves details for a team member (blocked)', await rulesWrite(tM, `staffDocs/${id}`, meta(s1, id, mgr, pass1)), false); }
  expect('manager uploads for themselves (blocked)', await upload(tM, mgr, mgr, { ...pass1, checkId: rid() }), false);
  expect('team member uploads their own (blocked)', await upload(t1, s1, s1, { ...pass1, checkId: rid() }), false);
  expect('payroll user uploads (blocked)', await upload(tP, pay, pay, { ...pass1, checkId: rid() }), false);
  expect('manager can\'t read the files list', await rulesRead(tM, `staffDocs/${rid()}`), false);

  console.log('--- Option A: passport on its own');
  const a = await upload(tO, s1, owner, pass1);
  expect('owner uploads passport for a team member', a, true);
  check('server verifies it', !!(await checkedSoon(a.id)));
  const st1 = await waitFor(async () => { const s = await status(s1); return s && s.ok ? s : null; });
  check('Right to Work shows on file', !!st1, JSON.stringify(st1 && { ok: st1.ok, count: st1.count, files: st1.files, last: st1.lastCheckedOn }));
  check('date of the check saved', st1 && st1.lastCheckedOn === today);
  expect('manager can read the tick', await rulesRead(tM, `rtwStatus/${s1}`), true);
  expect('owner uploads for another owner', await upload(tO, owner2, owner, { checkId: rid(), route: 'passport', slot: 1, docType: 'passport' }), true);
  expect('owner uploads for themselves', await upload(tO2, owner2, owner2, { checkId: rid(), route: 'passport', slot: 1, docType: 'passport_card' }), true);

  console.log('--- Option B: birth certificate + NI proof');
  const cb = rid();
  const b1 = await upload(tO, s2, owner, { checkId: cb, route: 'birth_ni', slot: 1, docType: 'birth_certificate' });
  expect('owner uploads birth certificate (file 1)', b1, true);
  await checkedSoon(b1.id);
  await sleep(800);
  let st2 = await status(s2);
  check('one file of two is not on file yet', st2 && st2.ok === false && st2.incomplete === 1 && st2.files === 1, JSON.stringify(st2 && { ok: st2.ok, inc: st2.incomplete, files: st2.files }));
  const b2 = await upload(tO, s2, owner, { checkId: cb, route: 'birth_ni', slot: 2, docType: 'ni_evidence' });
  expect('owner uploads NI proof (file 2)', b2, true);
  st2 = await waitFor(async () => { const s = await status(s2); return s && s.ok ? s : null; });
  check('both files: on file', !!st2 && st2.count === 1 && st2.incomplete === 0);
  const dup = await upload(tO, s2, owner, { checkId: cb, route: 'birth_ni', slot: 2, docType: 'ni_evidence' });
  check('a second file 2 for the same check is refused and removed', dup.ok && !!(await goneSoon(dup.id)) && !(await fileExists(`rtw/${s2}/${dup.id}.pdf`)));
  const mis = await upload(tO, s2, owner, { checkId: rid(), route: 'birth_ni', slot: 1, docType: 'birth_certificate' }, { checkedOn: '2026-10-01' });
  await checkedSoon(mis.id);
  const mis2 = await upload(tO, s2, owner, { checkId: '', route: 'birth_ni', slot: 2, docType: 'ni_evidence' });
  expect('blank check id (blocked)', mis2, false);

  console.log('--- document type must fit the check');
  const bad = (chk, extra = {}) => { const id = rid(); return rulesWrite(tO, `staffDocs/${id}`, meta(s3, id, owner, chk, extra)); };
  expect('control: same helper with a good passport check', await bad({ checkId: rid(), route: 'passport', slot: 1, docType: 'passport' }), true);
  expect('passport check with a birth certificate (blocked)', await bad({ checkId: rid(), route: 'passport', slot: 1, docType: 'birth_certificate' }), false);
  expect('passport check with a second file (blocked)', await bad({ checkId: rid(), route: 'passport', slot: 2, docType: 'passport' }), false);
  expect('Option B with NI proof as file 1 (blocked)', await bad({ checkId: rid(), route: 'birth_ni', slot: 1, docType: 'ni_evidence' }), false);
  expect('unknown kind of check (blocked)', await bad({ checkId: rid(), route: 'ni_only', slot: 1, docType: 'ni_evidence' }), false);
  expect('no check details at all (blocked)', await bad({ docType: 'passport' }, { checkId: undefined, route: undefined, slot: undefined, checkedOn: undefined, declared: undefined }), false);
  expect('not confirmed (blocked)', await bad({ checkId: rid(), route: 'passport', slot: 1, docType: 'passport' }, { declared: false }), false);
  expect('date in the wrong format (blocked)', await bad({ checkId: rid(), route: 'passport', slot: 1, docType: 'passport' }, { checkedOn: '26/10/2026' }), false);
  expect('sneaking in an approval field (blocked)', await bad({ checkId: rid(), route: 'passport', slot: 1, docType: 'passport' }, { status: 'approved' }), false);
  const fut = await upload(tO, s3, owner, { checkId: rid(), route: 'passport', slot: 1, docType: 'passport' }, { checkedOn: tomorrow });
  check('date in the future: refused by the server and removed', fut.ok && !!(await goneSoon(fut.id)) && !(await fileExists(`rtw/${s3}/${fut.id}.pdf`)));
  const fake = await upload(tO, s3, owner, { checkId: rid(), route: 'passport', slot: 1, docType: 'passport' }, {}, Buffer.from('not a pdf at all, just text'));
  check('a file that isn\'t really a PDF is refused and removed', fake.ok && !!(await goneSoon(fake.id)));
  const sc = await upload(tO, s3, owner, { checkId: rid(), route: 'share_code', slot: 1, docType: 'share_code' });
  expect('online check result upload', sc, true);
  const st3 = await waitFor(async () => { const s = await status(s3); return s && s.ok ? s : null; });
  check('online check result counts', !!st3);
  const oc = rid();
  const o1 = await upload(tO, s3, owner, { checkId: oc, route: 'other', slot: 1, docType: 'brp' });
  const o2 = await upload(tO, s3, owner, { checkId: oc, route: 'other', slot: 2, docType: 'visa' });
  expect('other documents: file 1', o1, true);
  expect('other documents: optional file 2', o2, true);

  console.log('--- removing');
  expect('manager removes a file (blocked)', await rulesDelete(tM, `staffDocs/${b2.id}`), false);
  expect('owner removes NI proof', await rulesDelete(tO, `staffDocs/${b2.id}`), true);
  const after = await waitFor(async () => { const s = await status(s2); return s && s.ok === false ? s : null; });
  check('check no longer complete once a file is removed', !!after, JSON.stringify(after && { ok: after.ok, inc: after.incomplete, files: after.files }));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
