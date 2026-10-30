// One-off account changes for launch (26 Oct). Run locally with ADC; not deployed.
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'twsched-f8b16' });
const db = admin.firestore();
const auth = admin.auth();
const { FieldValue } = admin.firestore;

const ANDY = 'andyblewett9@gmail.com';
const STELLA = 'stellablizzard@gmail.com';
const DEV = 'andy@andysocialapps.website';
const mode = process.argv[2] || 'show';

function directoryEntry(d) {
  if (!d || d.developer === true || d.role === 'developer') return null;
  return { name: d.name || '', jobTitle: d.jobTitle || '', role: d.role || 'staff',
    active: d.active !== false, terminated: d.terminated === true, onRota: d.onRota !== false };
}

(async () => {
  const staff = await db.collection('staff').get();
  for (const s of staff.docs) {
    const d = s.data();
    let claims = {};
    try { claims = (await auth.getUser(s.id)).customClaims || {}; } catch (e) { claims = { err: e.code }; }
    console.log(s.id, d.name, d.email, 'doc:', d.role, d.primaryOwner ? 'primary' : '', d.developer ? 'DEV' : '', 'claims:', JSON.stringify(claims));
  }
  if (mode !== 'apply') return;
  const byEmail = {};
  staff.docs.forEach((s) => { byEmail[String(s.get('email') || '').toLowerCase()] = s; });

  // Andy -> manager (no longer an owner or main owner)
  const a = await auth.getUserByEmail(ANDY);
  const ac = { ...(a.customClaims || {}), role: 'manager' }; delete ac.primaryOwner;
  await auth.setCustomUserClaims(a.uid, ac);
  await db.doc(`staff/${a.uid}`).update({ role: 'manager', primaryOwner: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
  console.log('Andy ->', JSON.stringify(ac));

  // Stella -> owner + main owner
  const st = await auth.getUserByEmail(STELLA);
  const sc = { ...(st.customClaims || {}), role: 'owner', primaryOwner: true };
  await auth.setCustomUserClaims(st.uid, sc);
  await db.doc(`staff/${st.uid}`).update({ role: 'owner', primaryOwner: true, updatedAt: FieldValue.serverTimestamp() });
  console.log('Stella ->', JSON.stringify(sc));

  // Developer login (isolated: no staff data), hidden from staff lists and the rota, shown to owners in Team
  let dev;
  try { dev = await auth.getUserByEmail(DEV); } catch (e) {
    dev = await auth.createUser({ email: DEV, displayName: 'Andy (developer)', emailVerified: false });
  }
  await auth.setCustomUserClaims(dev.uid, { role: 'developer' }); // isolated maintenance login (see firestore.rules)
  await db.doc(`staff/${dev.uid}`).set({
    name: 'Andy (developer)', email: DEV, role: 'developer', jobTitle: 'App developer (maintenance)', phone: '',
    onRota: false, active: true, developer: true,
    createdAt: FieldValue.serverTimestamp(), createdBy: a.uid,
  }, { merge: true });
  console.log('Dev ->', dev.uid);

  // Backfill the colleague directory
  const again = await db.collection('staff').get();
  for (const s of again.docs) {
    const e = directoryEntry(s.data());
    if (e) await db.doc(`directory/${s.id}`).set(e); else await db.doc(`directory/${s.id}`).delete();
  }
  console.log('directory backfilled', again.size);
})().catch((e) => { console.error(e); process.exit(1); });
