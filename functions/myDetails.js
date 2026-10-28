'use strict';
// Account > Your details: a signed-in staff member changes their OWN name and/or login email.
// - Name: no password needed.
// - Email: the current password is checked here on the server (Identity Toolkit sign-in), the new
//   address must not belong to another login or staff record, and a notice goes to the OLD address.
// - Only the caller's own record (uid from the verified token). No uid is ever taken from the client.
// - The developer maintenance login cannot use this (it has no staff record to edit).
// Roles are custom claims tied to the uid, so an email change never changes anyone's access.
const admin = require('firebase-admin');
const { HttpsError } = require('firebase-functions/v2/https');
const { FieldValue } = require('firebase-admin/firestore');
const logger = require('firebase-functions/logger');

const STAFF_ROLES = ['owner', 'manager', 'payroll', 'staff'];
const EMAIL_RE = /^[^\s@<>",;:]+@[^\s@<>",;:]+\.[^\s@<>",;:]{2,}$/;

// Checks the caller's current password on the server. MFA-enrolled accounts get an mfaPendingCredential
// instead of tokens, which Identity Toolkit only returns after the password was right.
async function checkPassword(apiKey, appUrl, email, password) {
  const emu = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const base = emu ? `http://${emu}/identitytoolkit.googleapis.com` : 'https://identitytoolkit.googleapis.com';
  try {
    const r = await fetch(`${base}/v1/accounts:signInWithPassword?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Referer: appUrl },
      body: JSON.stringify({ email, password, returnSecureToken: false }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && (j.localId || j.mfaPendingCredential)) return { ok: true, uid: j.localId || '' };
    return { ok: false };
  } catch (e) {
    return { ok: false, network: true };
  }
}

function makeFunctions({ gatedOnCall, sendMail, mailSettings, mailReady, MAIL, clean, takeSlots, limitError, apiKey, appUrl }) {
  const db = () => admin.firestore();
  const auth = () => admin.auth();

  const updateMyDetails = gatedOnCall(MAIL, async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    const uid = req.auth.uid;
    const role = req.auth.token && req.auth.token.role;
    if (!STAFF_ROLES.includes(role)) throw new HttpsError('permission-denied', 'This login can’t change details.');
    const d = req.data || {};
    const ref = db().doc(`staff/${uid}`);
    const snap = await ref.get();
    if (!snap.exists || snap.get('developer') === true) throw new HttpsError('permission-denied', 'This login can’t change details.');
    const cur = snap.data();
    const user = await auth().getUser(uid);
    const oldEmail = String(user.email || cur.email || '').toLowerCase();

    const update = {};
    if (d.name != null) {
      const name = clean(d.name, 80);
      if (name.length < 2) throw new HttpsError('invalid-argument', 'Enter your name.');
      if (name !== cur.name) update.name = name;
    }
    let newEmail = '';
    if (d.email != null) {
      newEmail = String(d.email).trim().toLowerCase();
      if (newEmail.length > 120 || !EMAIL_RE.test(newEmail)) throw new HttpsError('invalid-argument', 'Check the new email address.');
      if (newEmail === oldEmail) newEmail = '';
    }
    if (!Object.keys(update).length && !newEmail) return { ok: true, changed: false };

    if (newEmail) {
      // Throttle password guesses: 6 tries per account per 15 minutes, 20 a day.
      const slot = await takeSlots([
        { kind: 'details-15m', key: uid, windowMs: 15 * 60000, max: 6 },
        { kind: 'details-day', key: uid, windowMs: 24 * 3600000, max: 20 },
      ]);
      if (!slot.ok) throw new HttpsError('resource-exhausted', limitError(slot));
      const pw = typeof d.currentPassword === 'string' ? d.currentPassword : '';
      if (!pw) throw new HttpsError('invalid-argument', 'Enter your current password to change your email.');
      const signIn = await checkPassword(apiKey, appUrl, oldEmail, pw);
      if (signIn.network) throw new HttpsError('unavailable', 'Couldn\u2019t check your password. Try again.');
      if (!signIn.ok) throw new HttpsError('permission-denied', 'That password isn’t right.', { reason: 'wrong-password' });
      if (signIn.uid && signIn.uid !== uid) throw new HttpsError('permission-denied', 'That password isn’t right.', { reason: 'wrong-password' });
      // Duplicates: another login, or another staff record, already uses this address.
      try {
        const other = await auth().getUserByEmail(newEmail);
        if (other && other.uid !== uid) throw new HttpsError('already-exists', 'Someone else already uses that email.');
      } catch (e) {
        if (e instanceof HttpsError) throw e;
        if (e.code !== 'auth/user-not-found') throw e;
      }
      const dup = await db().collection('staff').where('email', '==', newEmail).limit(2).get();
      if (dup.docs.some((x) => x.id !== uid)) throw new HttpsError('already-exists', 'Someone else already uses that email.');
      try {
        await auth().updateUser(uid, { email: newEmail, emailVerified: false });
      } catch (e) {
        if (e.code === 'auth/email-already-exists') throw new HttpsError('already-exists', 'Someone else already uses that email.');
        throw e;
      }
      update.email = newEmail;
    }
    if (update.name) {
      try { await auth().updateUser(uid, { displayName: update.name }); } catch (e) { /* display name is cosmetic */ }
    }
    update.updatedAt = FieldValue.serverTimestamp();
    update.detailsChangedBySelfAt = FieldValue.serverTimestamp();
    await ref.set(update, { merge: true });

    let noticeSent = false;
    if (newEmail && oldEmail) {
      try {
        const m = await mailSettings();
        if (mailReady(m) && m.enabled !== false) {
          const first = String(update.name || cur.name || '').split(/\s+/)[0] || 'there';
          const r = await sendMail({
            to: oldEmail,
            subject: 'Your White Swan staff app email was changed',
            text: `Hi ${first},\n\nThe email you sign in to the White Swan staff app with was changed to ${newEmail}.\nFrom now on, sign in with the new address. Your password hasn’t changed.\n\nIf you didn’t do this, tell a manager straight away.\n\n${appUrl}`,
          }, m);
          noticeSent = !!(r && r.sent !== false);
        }
      } catch (e) {
        logger.error('old-address notice failed', { uid, err: e.message });
      }
      logger.info('staff changed own login email', { uid, noticeSent });
    }
    return { ok: true, changed: true, emailChanged: !!newEmail, noticeSent };
  });

  return { updateMyDetails };
}

module.exports = { makeFunctions, STAFF_ROLES, checkPassword };
