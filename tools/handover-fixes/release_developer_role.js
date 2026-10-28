#!/usr/bin/env node
// RELEASE STEP (run only after Andy approves, together with the rules + functions + hosting release).
// Moves the developer maintenance login from role 'manager' (full manager access) to role 'developer'
// (isolated: firestore.rules deny it everything except its own staff record).
//
//   node release_developer_role.js            -> dry run: says how many developer records it found
//   node release_developer_role.js --apply    -> sets the custom claim + staff.role, revokes its sessions
//
// Prints no names, emails or uids.
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'twsched-f8b16' });
(async () => {
  const apply = process.argv.includes('--apply');
  const snap = await admin.firestore().collection('staff').where('developer', '==', true).get();
  console.log(`developer records: ${snap.size}`);
  if (snap.size !== 1) { console.log('expected exactly 1, stopping'); process.exit(1); }
  const doc = snap.docs[0];
  const user = await admin.auth().getUser(doc.id);
  const claims = user.customClaims || {};
  console.log(`current role claim: ${claims.role || '(none)'}, staff.role: ${doc.get('role')}`);
  if (!apply) { console.log('dry run, nothing changed'); return; }
  await admin.auth().setCustomUserClaims(doc.id, { ...claims, role: 'developer' });
  await doc.ref.set({ role: 'developer', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  await admin.auth().revokeRefreshTokens(doc.id);
  console.log('done: role is now developer, its old sessions are signed out');
})().catch((e) => { console.error(e.message); process.exit(1); });
