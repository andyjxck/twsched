// Developer access rules test (24 Nov 2026), built on the earlier isolation audit: White Swan website editor rules vs Staff Hub data (project twsched-f8b16).
// Synthetic fixtures only, run against the Firebase emulators. Usage:
//   RULES_DIR=<dir with firestore.rules + storage.rules> LABEL=live|cand node isolation.test.mjs
// Writes results-<LABEL>.json: { "<user> <op> <path>": "ALLOW" | "DENY" | "ERR:..." }
import fs from 'node:fs'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import firebase from 'firebase/compat/app'
import 'firebase/compat/firestore'
import 'firebase/compat/storage'

const DIR = process.env.RULES_DIR
const LABEL = process.env.LABEL
const FS_PORT = Number(process.env.FS_PORT || 8391)
const ST_PORT = Number(process.env.ST_PORT || 9391)
const env = await initializeTestEnvironment({
  projectId: 'demo-dev-access',
  firestore: { rules: fs.readFileSync(`${DIR}/firestore.rules`, 'utf8'), host: '127.0.0.1', port: FS_PORT },
  storage: { rules: fs.readFileSync(`${DIR}/storage.rules`, 'utf8'), host: '127.0.0.1', port: ST_PORT },
})
const ts = firebase.firestore.FieldValue.serverTimestamp
const HEX = 'a'.repeat(24)
import crypto from 'node:crypto'
// fresh random names for every create, so a file left over from an earlier step can never turn a create into an update
const rnd = () => crypto.randomBytes(12).toString('hex')
const rndA = () => crypto.randomBytes(15).toString('base64').replace(/[^A-Za-z0-9]/g, 'Z').slice(0, 20)

// ---------- synthetic fixtures ----------
const FUT = firebase.firestore.Timestamp.fromMillis(Date.now() + 23 * 3600e3)
const PAST = firebase.firestore.Timestamp.fromMillis(Date.now() - 60e3)
const FS = {
  'staff/dev1': { name: 'Dev (fake)', email: 'dev@example.test', role: 'developer', developer: true },
  'devAccess/gActive': { devUid: 'dev1', status: 'active', expiresAt: FUT, grantedBy: 'owner1' },
  'devAccess/gExpired': { devUid: 'dev1', status: 'active', expiresAt: PAST, grantedBy: 'owner1' },
  'devAccess/gEnded': { devUid: 'dev1', status: 'ended', expiresAt: FUT, grantedBy: 'owner1' },
  'devAccess/gPending': { devUid: 'dev1', status: 'pending', expiresAt: null, grantedBy: 'owner1' },
  'devAccess/gOther': { devUid: 'someoneElse', status: 'active', expiresAt: FUT, grantedBy: 'owner1' },
  'devCodes/gPending': { hash: 'x', salt: 'y', attempts: 0, devUid: 'dev1' },
  'staff/staffA': { name: 'Test A', email: 'a@example.test', role: 'staff' },
  'staff/staffB': { name: 'Test B', email: 'b@example.test', phone: '000', role: 'staff' },
  'staff/editorS': { name: 'Editor S', email: 's@example.test', role: 'staff' },
  'directory/staffB': { name: 'Test B', role: 'staff', active: true },
  'shifts/sA': { staffId: 'staffA', staffName: 'Test A', date: '2026-11-03', week: '2026-11-02', start: '09:00', end: '17:00', published: true },
  'shifts/sB': { staffId: 'staffB', staffName: 'Test B', date: '2026-11-03', week: '2026-11-02', start: '09:00', end: '17:00', published: true },
  'shifts/sEdit': { staffId: 'editorS', staffName: 'Editor S', date: '2026-11-03', week: '2026-11-02', start: '09:00', end: '17:00', published: true },
  'payslips/staffB_2026-07': { staffId: 'staffB', staffName: 'Test B', period: 'Oct', slot: '2026-07' },
  'payInfo/staffB': { staffId: 'staffB', hourlyRate: 12 },
  'contracts/staffB': { staffId: 'staffB', contractHours: 20 },
  'timeOff/tB': { staffId: 'staffB', staffName: 'Test B', from: '2026-11-10', to: '2026-11-11', status: 'pending', paid: true },
  'requests/rB': { staffId: 'staffB', kind: 'swap', status: 'pending' },
  'unavailability/uB': { staffId: 'staffB', reason: 'x' },
  'staffDocs/dB': { staffId: 'staffB', kind: 'rtw' },
  'rtwStatus/staffB': { ok: true },
  'enquiries/e1': { name: 'Visitor', email: 'v@example.test', status: 'new' },
  'notifications/nB': { uid: 'staffB', managerOnly: false, read: false },
  'private/mail': { secret: 'x' },
  'rateLimits/r1': { n: 1 },
  'payroll/settings': { frequency: 'monthly' },
  'payPeriods/2026-10-01': { start: '2026-10-01', end: '2026-10-31', status: 'open' },
  'payPeriods/2026-10-01/hours/staffB': { staffId: 'staffB', rosteredHours: 10, actualHours: 10, approved: false },
  'payrollReminders/x': { a: 1 },
  'prefs/staffB': { rotaOrder: [] },
  'events/evPrivate': { title: 'Staff party', date: '2026-11-20', onWebsite: false },
  'events/evPublic': { title: 'Quiz', date: '2026-11-21', onWebsite: true },
  'public/events': { events: [] },
  'weeks/2026-11-02': { status: 'published' },
  'days/2026-11-03': { status: 'open' },
  'rotaBlocks/staffB_2026': { staffId: 'staffB', d: {} },
  'authGate/staffB': { reason: 'x' },
  // website editor
  'webEditors/editorS': { name: 'Sam' },
  'webEditors/editorP': { name: 'Pay' },
  'webEditors/dev1': { name: 'Dev' },
  'webEditors/noRole1': { name: 'Nobody' },
  'webEditors/mfaMgr': { name: 'Mgr' },
  'siteContent/published': { text: { a: 'live' }, photos: {}, order: [] },
  'siteContent/draft': { text: { a: 'secret draft' }, photos: {}, order: [] },
  'siteContentHistory/h1': { text: {}, photos: {}, order: [] },
}
const ST = {
  'payslips/staffB/staffB_2026-07.pdf': 'application/pdf',
  'rtw/staffB/AAAAAAAAAAAAAAAAAAAA.pdf': 'application/pdf',
  [`site/${HEX}.jpg`]: 'image/jpeg',
  [`site-draft/${HEX}.jpg`]: 'image/jpeg',
  'other/file.txt': 'text/plain',
}
async function seed() {
  await env.clearFirestore()
  try { await env.clearStorage() } catch (e) { console.log('CLEARSTORAGE_FAIL', String(e && e.message).slice(0, 200)) }
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    for (const [p, d] of Object.entries(FS)) await db.doc(p).set(d)
    const st = ctx.storage()
    for (const [p, ct] of Object.entries(ST)) await st.ref(p).put(new Uint8Array([1, 2, 3]), { contentType: ct })
  })
}

// ---------- identities ----------
const USERS = {
  anon: null,
  signupNoClaims: { uid: 'rando', claims: {} },              // anyone can self-register with the public API key
  noRoleWithEditorDoc: { uid: 'noRole1', claims: {} },        // webEditors doc exists but no Staff Hub role
  staffA: { uid: 'staffA', claims: { role: 'staff' } },
  webEditorStaff: { uid: 'editorS', claims: { role: 'staff' } }, // staff + webEditors doc (website-only delegated editor)
  webEditorPayroll: { uid: 'editorP', claims: { role: 'payroll' } },
  manager: { uid: 'mgr1', claims: { role: 'manager' } },
  payroll: { uid: 'pay1', claims: { role: 'payroll' } },
  owner: { uid: 'owner1', claims: { role: 'owner' } },
  ownerPwChange: { uid: 'owner2', claims: { role: 'owner', pwChange: true } },
  developerWithEditorDoc: { uid: 'dev1', claims: { role: 'developer' } },
  devGranted: { uid: 'dev1', claims: { role: 'developer', devGrant: 'gActive' } },
  devExpired: { uid: 'dev1', claims: { role: 'developer', devGrant: 'gExpired' } },
  devEnded: { uid: 'dev1', claims: { role: 'developer', devGrant: 'gEnded' } },
  devPendingOnly: { uid: 'dev1', claims: { role: 'developer', devGrant: 'gPending' } },
  devOthersGrant: { uid: 'dev1', claims: { role: 'developer', devGrant: 'gOther' } },
  devMissingGrant: { uid: 'dev1', claims: { role: 'developer', devGrant: 'nope' } },
  devForgedOwnerNoGrant: { uid: 'dev2', claims: { role: 'developer', devGrant: 'gActive' } },
}
function ctxFor(u) { return u ? env.authenticatedContext(u.uid, u.claims) : env.unauthenticatedContext() }

async function outcome(fn) {
  try { await fn(); return 'ALLOW' } catch (e) {
    const m = String((e && (e.code || e.message)) || e)
    if (/permission|PERMISSION_DENIED|unauthorized|storage\/unauthorized/i.test(m)) { if (process.env.VERBOSE) console.log('DENYMSG', String(e.message).slice(0,400)); return 'DENY' }
    if (/object-not-found/i.test(m)) return 'ALLOW(not-found)'
    return 'ERR:' + m.slice(0, 80)
  }
}

// ---------- operations ----------
const staffPaths = Object.keys(FS).filter((p) => !/^(webEditors|siteContent|siteContentHistory)\//.test(p))
const colls = [...new Set(staffPaths.map((p) => p.split('/').slice(0, -1).join('/')))]
function validSite(uid) { return { text: { a: 'x' }, photos: {}, order: ['hero'], updatedAt: ts(), updatedBy: uid } }

function opsFor(u) {
  const uid = u ? u.uid : 'nobody'
  const ops = []
  // Staff Hub data: read, list, update, create, delete (differential: must match live exactly)
  for (const p of staffPaths) {
    ops.push([`fs.get ${p}`, (db) => db.doc(p).get()])
    ops.push([`fs.update ${p}`, (db) => db.doc(p).update({ zzAudit: 1 })])
    ops.push([`fs.delete ${p}`, (db) => db.doc(p).delete()])
  }
  for (const c of colls) {
    ops.push([`fs.list ${c}`, (db) => db.collection(c).get()])
    ops.push([`fs.create ${c}/auditNew`, (db) => db.doc(`${c}/auditNew`).set({ zzAudit: 1 })])
  }
  ops.push([`fs.create unknownColl/x`, (db) => db.doc('unknownColl/x').set({ a: 1 })])
  ops.push([`fs.get unknownColl/x`, (db) => db.doc('unknownColl/x').get()])
  ops.push([`fs.collectionGroup hours`, (db) => db.collectionGroup('hours').get()])
  // Website editor paths
  ops.push([`fs.get siteContent/published`, (db) => db.doc('siteContent/published').get()])
  ops.push([`fs.get siteContent/draft`, (db) => db.doc('siteContent/draft').get()])
  ops.push([`fs.list siteContent`, (db) => db.collection('siteContent').get()])
  ops.push([`fs.query siteContent published-only`, (db) => db.collection('siteContent').where(firebase.firestore.FieldPath.documentId(), '==', 'published').get()])
  ops.push([`fs.set siteContent/draft valid`, (db) => db.doc('siteContent/draft').set(validSite(uid))])
  ops.push([`fs.set siteContent/published valid`, (db) => db.doc('siteContent/published').set(validSite(uid))])
  ops.push([`fs.set siteContent/other valid`, (db) => db.doc('siteContent/other').set(validSite(uid))])
  ops.push([`fs.set siteContent/draft forged updatedBy`, (db) => db.doc('siteContent/draft').set({ ...validSite(uid), updatedBy: 'owner1' })])
  ops.push([`fs.set siteContent/draft extra key`, (db) => db.doc('siteContent/draft').set({ ...validSite(uid), role: 'owner' })])
  ops.push([`fs.set siteContent/draft client time`, (db) => db.doc('siteContent/draft').set({ ...validSite(uid), updatedAt: new Date() })])
  ops.push([`fs.delete siteContent/published`, (db) => db.doc('siteContent/published').delete()])
  ops.push([`fs.get siteContentHistory/h1`, (db) => db.doc('siteContentHistory/h1').get()])
  ops.push([`fs.list siteContentHistory`, (db) => db.collection('siteContentHistory').get()])
  ops.push([`fs.create siteContentHistory/new`, (db) => db.doc('siteContentHistory/auditNew').set(validSite(uid))])
  ops.push([`fs.update siteContentHistory/h1`, (db) => db.doc('siteContentHistory/h1').set(validSite(uid))])
  ops.push([`fs.delete siteContentHistory/h1`, (db) => db.doc('siteContentHistory/h1').delete()])
  ops.push([`fs.get webEditors/self`, (db) => db.doc(`webEditors/${uid}`).get()])
  ops.push([`fs.get webEditors/editorS`, (db) => db.doc('webEditors/editorS').get()])
  ops.push([`fs.list webEditors`, (db) => db.collection('webEditors').get()])
  ops.push([`fs.create webEditors/self`, (db) => db.doc(`webEditors/${uid}`).set({ name: 'me' })])
  ops.push([`fs.create webEditors/staffA`, (db) => db.doc('webEditors/staffA').set({ name: 'A' })])
  ops.push([`fs.delete webEditors/editorP`, (db) => db.doc('webEditors/editorP').delete()])
  // Storage
  const put = (st, p, ct) => st.ref(p).put(new Uint8Array([9, 9, 9]), { contentType: ct })
  ops.push([`st.get payslips/staffB`, (db, st) => st.ref('payslips/staffB/staffB_2026-07.pdf').getMetadata()])
  ops.push([`st.put payslips/staffB`, (db, st) => put(st, 'payslips/staffB/staffB_2026-07.pdf', 'application/pdf')])
  ops.push([`st.delete payslips/staffB`, (db, st) => st.ref('payslips/staffB/staffB_2026-07.pdf').delete()])
  ops.push([`st.get rtw/staffB`, (db, st) => st.ref('rtw/staffB/AAAAAAAAAAAAAAAAAAAA.pdf').getMetadata()])
  ops.push([`st.put rtw/staffB`, (db, st) => put(st, `rtw/staffB/${rndA()}.pdf`, 'application/pdf')])
  ops.push([`st.delete rtw/staffB`, (db, st) => st.ref('rtw/staffB/AAAAAAAAAAAAAAAAAAAA.pdf').delete()])
  ops.push([`st.list rtw/staffB`, (db, st) => st.ref('rtw/staffB').listAll()])
  ops.push([`st.get other/file.txt`, (db, st) => st.ref('other/file.txt').getMetadata()])
  ops.push([`st.put other/x.jpg`, (db, st) => put(st, `other/${rnd()}.jpg`, 'image/jpeg')])
  ops.push([`st.get site/photo`, (db, st) => st.ref(`site/${HEX}.jpg`).getMetadata()])
  ops.push([`st.list site`, (db, st) => st.ref('site').listAll()])
  ops.push([`st.put site/new jpeg`, (db, st) => put(st, `site/${rnd()}.jpg`, 'image/jpeg')])
  ops.push([`st.put site/new png`, (db, st) => put(st, `site/${rnd()}.jpg`, 'image/png')])
  ops.push([`st.put site/badname`, (db, st) => put(st, 'site/evil.jpg', 'image/jpeg')])
  ops.push([`st.put site/nested`, (db, st) => put(st, `site/sub/${rnd()}.jpg`, 'image/jpeg')])
  ops.push([`st.put site/overwrite`, (db, st) => put(st, `site/${HEX}.jpg`, 'image/jpeg')])
  ops.push([`st.delete site/photo`, (db, st) => st.ref(`site/${HEX}.jpg`).delete()])
  ops.push([`st.get site-draft/photo`, (db, st) => st.ref(`site-draft/${HEX}.jpg`).getMetadata()])
  ops.push([`st.put site-draft/new`, (db, st) => put(st, `site-draft/${rnd()}.jpg`, 'image/jpeg')])
  ops.push([`st.delete site-draft/photo`, (db, st) => st.ref(`site-draft/${HEX}.jpg`).delete()])
  return ops
}

const results = {}
await seed()
for (const [name, u] of Object.entries(USERS)) {
  for (const [label, fn] of opsFor(u)) {
    if (process.env.ONLY && !new RegExp(process.env.ONLY).test(`${name} | ${label}`)) continue
    if (process.env.STSEED && label.startsWith('st.')) { await seed(); await new Promise((r) => setTimeout(r, Number(process.env.STSEED))) }
    const ctx = ctxFor(u) // fresh client for every operation
    let r = await outcome(() => fn(ctx.firestore(), ctx.storage()))
    // The Storage emulator's cross-service firestore.exists() check sometimes fails and denies spuriously
    // (seen in this audit: the same create flips between runs). A spurious result can only be a DENY, so a
    // Storage DENY is retried on fresh fixtures; any ALLOW wins.
    for (let i = 0; label.startsWith('st.') && r === 'DENY' && i < Number(process.env.ST_RETRY || 0); i++) {
      await seed(); await new Promise((res) => setTimeout(res, 300))
      const c2 = ctxFor(u)
      r = await outcome(() => fn(c2.firestore(), c2.storage()))
      if (r !== 'DENY') r += ' (after retry)'
    }
    results[`${name} | ${label}`] = r
    // any write that went through changes the fixtures: put them back, so no result depends on another
    if (r.startsWith('ALLOW') && !/\.(get|list|query|collectionGroup) /.test(label)) await seed()
  }
}
fs.writeFileSync(`results-${LABEL}.json`, JSON.stringify(results, null, 1))
console.log(LABEL, Object.keys(results).length, 'operations')
await env.cleanup()
