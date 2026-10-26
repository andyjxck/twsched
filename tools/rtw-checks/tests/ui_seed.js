// Made-up owner, manager and team member in the local emulators (demo-rtwchk). Prints their ids.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8311';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9311';
const admin = require('/tmp/rtw2/repo/functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: 'demo-rtwchk' });
const PW = 'Test-pass-12345';
(async () => {
  const out = {};
  for (const [key, name, role] of [['uiowner', 'Olive Owner', 'owner'], ['uimgr', 'Mike Manager', 'manager'], ['uistaff', 'Tessa Teammember', 'staff'], ['uistaff2', 'Bob Builder', 'staff']]) {
    const email = `${key}@example.test`;
    let u;
    try { u = await admin.auth().getUserByEmail(email); } catch { u = await admin.auth().createUser({ email, password: PW, displayName: name }); }
    await admin.auth().setCustomUserClaims(u.uid, { role });
    await admin.firestore().doc(`staff/${u.uid}`).set({ name, email, role, active: true, onRota: true, primaryOwner: role === 'owner', contractType: 'hourly', mustChangePassword: false }, { merge: true });
    out[key] = u.uid;
    const old = await admin.firestore().collection('staffDocs').where('staffId', '==', u.uid).get();
    for (const d of old.docs) await d.ref.delete();
    await admin.firestore().doc(`rtwStatus/${u.uid}`).delete();
  }
  console.log(JSON.stringify(out));
  process.exit(0);
})();
