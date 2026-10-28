/* New-staff onboarding: emailed temporary password + forced password change on first sign-in.
 *
 *   createStaff (index.js) and resendStaffLogin issue a temporary password through issueTempLogin():
 *     - a strong random password generated here, on the server (crypto.randomInt, ~92 bits)
 *     - set on the Firebase Auth user, never written to Firestore, never logged
 *     - the account is "gated": custom claim pwChange=true AND a server-only marker doc
 *       authGate/{uid} (expiresAt = 7 days). Refresh tokens are revoked, so other sessions end.
 *     - emailed to the staff member's own address. Only when that email could not be sent is the
 *       password handed back (once) to the manager who asked, so they can pass it on in person.
 *   While gated, the account can do nothing except choose a new password:
 *     - firestore.rules treat a pwChange token as having no role at all
 *     - storage.rules and every authenticated callable (gatedOnCall) refuse a pwChange token AND any
 *       token while authGate/{uid} exists, which covers ID tokens minted before a manager's reset.
 *       (Firestore rules check the claim only: an exists() per role() call exceeded the 1000-expression
 *       budget of the shift rules. A pre-reset token can read Firestore until it expires, max 1 hour;
 *       its refresh token is revoked and the app signs that device out when the gate doc appears.)
 *   completePasswordChange({ currentPassword, newPassword }) is the only way out:
 *     - checks the current (temporary) password with Firebase Auth itself, rate-limited per account
 *     - refuses expired temporary passwords, weak new passwords, or the same password again
 *     - sets the new password, then proves it works by signing in with it (Identity Toolkit), and
 *       only then removes the claim and the authGate doc and revokes the old tokens. Nobody,
 *       including the user, can clear the flag any other way: claims and authGate are server-only.
 *   expireTempLogins (daily) replaces expired temporary passwords with an unknown random one, so
 *   an old emailed password stops working; a manager can send a fresh one with "Resend login".
 *
 * Existing accounts are never gated unless a manager explicitly sends them a new temporary password.
 * Onboarding emails have their own limits (not the website enquiry caps) and ignore the "email staff
 * notifications" switch, but respect the master "emails on/off" switch in Settings.
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const twoStep = require('./twoStep');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');

const API_KEY = 'AIzaSyDe67skrRZG6TcHFcDUI45zY6Az4Jn5Y2I'; // public web API key (already shipped in the app)
const { APP_URL } = require('./siteConfig'); // the live staff app (was the old GitHub Pages address, now a 404)
const CLAIM = 'pwChange';
const GATE = 'authGate';
const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const TEMP_TTL_MS = 7 * DAY;
const LIMITS = {
  targetCooldownMs: 2 * MIN, // one login email per staff member per 2 minutes
  targetDay: 5, // and at most 5 a day
  callerHour: 15, // per manager/owner: invitations + resends
  callerDay: 40,
  globalDay: 100, // whole app, onboarding emails only (separate from website enquiry caps)
  changeAttempts15m: 6, // completePasswordChange attempts per account per 15 minutes
  changeAttemptsDay: 20,
};
const PASSWORD_REQUIRED = 'Choose your own password before using the app.';

function db() { return admin.firestore(); }
function auth() { return admin.auth(); }
const gateRef = (uid) => db().doc(`${GATE}/${uid}`);

// ---------------------------------------------------------------- temporary passwords
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; // no 0/O/1/l/I
function generateTempPassword() {
  for (;;) {
    let s = '';
    for (let i = 0; i < 16; i++) s += ALPHA[crypto.randomInt(ALPHA.length)];
    if (/[A-Z]/.test(s) && /[a-z]/.test(s) && /[2-9]/.test(s)) return s.match(/.{4}/g).join('-');
  }
}

const COMMON = new Set(['password', 'password1', 'password12', 'password123', '12345678', '123456789', '1234567890',
  'qwertyuiop', 'qwerty123', 'iloveyou', 'whiteswan', 'whiteswan1', 'whiteswan123', 'henleyinarden', 'letmein1',
  'abcdefgh', 'abc12345', '11111111', '00000000', 'football', 'welcome1', 'welcome123', 'changeme', 'passw0rd']);
// Returns '' if fine, else a message for the user.
function checkNewPassword(pw, { email = '', current = '' } = {}) {
  if (typeof pw !== 'string') return 'Enter a new password.';
  if (pw.length < 8) return 'Use at least 8 characters.';
  if (pw.length > 128) return 'That password is too long. Use 128 characters or fewer.';
  if (/^\s|\s$/.test(pw)) return 'Don’t start or end your password with a space.';
  if (current && pw === current) return 'Choose a different password from your temporary one.';
  const low = pw.toLowerCase();
  if (/^(.)\1+$/.test(pw)) return 'Use a password that isn’t just one character repeated.';
  if (COMMON.has(low) || COMMON.has(low.replace(/[^a-z0-9]/g, ''))) return 'That password is too easy to guess. Try another.';
  const e = String(email).toLowerCase();
  if (e && (low === e || low === e.split('@')[0])) return 'Don’t use your email address as your password.';
  return '';
}

// ---------------------------------------------------------------- rate limits (rateLimits/, server-only)
let salt = null;
async function getSalt() {
  if (salt) return salt;
  const ref = db().doc('private/rateLimitSalt'); // same salt doc the enquiry / reset limits use
  try {
    await ref.create({ salt: crypto.randomBytes(24).toString('hex'), createdAt: FieldValue.serverTimestamp() });
  } catch (e) {
    // already exists
  }
  salt = (await ref.get()).get('salt');
  return salt;
}
function hashKey(kind, value, s) {
  return crypto.createHash('sha256').update(`${s}|${kind}|${value}`).digest('hex').slice(0, 40);
}
// windows: [{ kind, key, windowMs, max }]; cooldown: optional { kind, key, ms }.
// All checked and recorded in one transaction: concurrent requests cannot both get through.
async function takeSlots(windows, cooldown, now = Date.now()) {
  const s = await getSalt();
  const ws = windows.map((w) => {
    const bucket = Math.floor(now / w.windowMs);
    return { ...w, bucket, ref: db().doc(`rateLimits/ob_${hashKey(w.kind, w.key, s)}_${bucket}`) };
  });
  const cref = cooldown && db().doc(`rateLimits/ob_${hashKey(cooldown.kind, cooldown.key, s)}`);
  return db().runTransaction(async (tx) => {
    const snaps = await Promise.all(ws.map((w) => tx.get(w.ref)));
    const csnap = cref ? await tx.get(cref) : null;
    if (csnap && csnap.exists && (csnap.get('until') || 0) > now) {
      return { ok: false, kind: cooldown.kind, retryAfter: Math.ceil((csnap.get('until') - now) / 1000) };
    }
    for (let i = 0; i < ws.length; i++) {
      const n = snaps[i].exists ? snaps[i].get('count') || 0 : 0;
      if (n >= ws[i].max) return { ok: false, kind: ws[i].kind, retryAfter: Math.ceil(((ws[i].bucket + 1) * ws[i].windowMs - now) / 1000) };
    }
    ws.forEach((w, i) => {
      const n = (snaps[i].exists ? snaps[i].get('count') || 0 : 0) + 1;
      tx.set(w.ref, { kind: w.kind, count: n, expireAt: new Date((w.bucket + 2) * w.windowMs) });
    });
    if (cref) tx.set(cref, { kind: cooldown.kind, until: now + cooldown.ms, expireAt: new Date(now + cooldown.ms + HOUR) });
    return { ok: true };
  });
}
function limitError(slot) {
  const wait = slot.retryAfter > 90 ? `${Math.ceil(slot.retryAfter / 60)} minutes` : `${slot.retryAfter} seconds`;
  const msg = {
    'onboard-target-cooldown': `A login email was sent to this person in the last 2 minutes. Try again in ${wait}.`,
    'onboard-target-day': 'This person has been sent 5 login emails today. Try again tomorrow.',
    'onboard-caller-hour': `You’ve sent a lot of logins in the last hour. Try again in ${wait}.`,
    'onboard-caller-day': 'You’ve reached today’s limit for new logins. Try again tomorrow.',
    'onboard-global-day': 'The app has reached today’s limit for login emails. Try again tomorrow.',
    'pwchange-15m': `Too many tries. Wait ${wait} and try again.`,
    'pwchange-day': 'Too many tries today. Ask a manager to send you a new temporary password.',
  }[slot.kind] || 'Too many requests. Try again later.';
  return new HttpsError('resource-exhausted', msg, { retryAfter: slot.retryAfter });
}
// Invitations/resends by one manager (and app-wide); target = staff uid for resends.
async function takeInviteSlot(callerUid, targetUid) {
  const windows = [
    { kind: 'onboard-caller-hour', key: callerUid, windowMs: HOUR, max: LIMITS.callerHour },
    { kind: 'onboard-caller-day', key: callerUid, windowMs: DAY, max: LIMITS.callerDay },
    { kind: 'onboard-global-day', key: 'all', windowMs: DAY, max: LIMITS.globalDay },
  ];
  if (targetUid) windows.unshift({ kind: 'onboard-target-day', key: targetUid, windowMs: DAY, max: LIMITS.targetDay });
  const slot = await takeSlots(windows, targetUid ? { kind: 'onboard-target-cooldown', key: targetUid, ms: LIMITS.targetCooldownMs } : null);
  if (!slot.ok) {
    logger.warn('onboarding rate limited', { kind: slot.kind });
    throw limitError(slot);
  }
}

// ---------------------------------------------------------------- gate
// Throws if this caller still has to choose a password (claim on the token, or a gate doc that
// was created after the token was minted).
async function assertNotGated(req) {
  if (!req.auth) return;
  if (req.auth.token && req.auth.token[CLAIM] === true) {
    throw new HttpsError('failed-precondition', PASSWORD_REQUIRED, { reason: 'password-change-required' });
  }
  // Management logins that must use two-step but signed in without it (functions/twoStep.js).
  twoStep.assertTwoStep(req);
  const g = await gateRef(req.auth.uid).get();
  if (g.exists) throw new HttpsError('failed-precondition', PASSWORD_REQUIRED, { reason: 'password-change-required' });
}
// Drop-in for onCall() for every callable that signed-in staff use.
function gatedOnCall(opts, handler) {
  if (typeof opts === 'function') { handler = opts; opts = {}; }
  return onCall(opts, async (req) => {
    await assertNotGated(req);
    return handler(req);
  });
}

// Sets a fresh temporary password on an existing Auth user and gates the account.
async function issueTempLogin(uid, { reason, by }) {
  const password = generateTempPassword();
  const expiresAt = Timestamp.fromMillis(Date.now() + TEMP_TTL_MS);
  // Gate first, so there is never a moment where the new password works on an ungated account.
  await gateRef(uid).set({ reason, by, createdAt: FieldValue.serverTimestamp(), expiresAt, expired: false });
  const u = await auth().getUser(uid);
  await auth().setCustomUserClaims(uid, { ...(u.customClaims || {}), [CLAIM]: true });
  await auth().updateUser(uid, { password });
  await auth().revokeRefreshTokens(uid);
  return { password, expiresAt };
}

// ---------------------------------------------------------------- email
function prettyDay(ts) {
  return new Date(ts.toMillis()).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' });
}
function loginEmail({ name, email, password, expiresAt, byName, isNew }) {
  const first = String(name || '').split(/\s+/)[0] || 'there';
  const intro = isNew
    ? `${byName ? `${byName} has` : 'A manager has'} set you up on the White Swan staff app, where you can see your rota, events, payslips and time off.`
    : `${byName ? `${byName} has` : 'A manager has'} sent you a new temporary password for the White Swan staff app. Your old password no longer works.`;
  const text = [
    `Hi ${first},`,
    '',
    intro,
    '',
    'To sign in:',
    `1. Open ${APP_URL}`,
    `2. Email: ${email}`,
    `3. Temporary password: ${password}`,
    '4. You’ll then be asked to choose your own password. You need to do this before you can see anything in the app.',
    '',
    `This temporary password only works until ${prettyDay(expiresAt)}. If it has run out or doesn’t work, ask a manager to send you a new one.`,
    '',
    'Please don’t share this password or forward this email. If you weren’t expecting it, you can ignore it.',
    '',
    'The White Swan, Henley-in-Arden',
  ].join('\n');
  return { to: email, subject: isNew ? 'Your White Swan staff login' : 'Your new White Swan staff password', text };
}

function withTimeout(p, ms) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('The mail server took too long to answer.')), ms); })])
    .finally(() => clearTimeout(t));
}
// The mail server's message, without anything that could contain the password (it is only ever in
// the message body, which servers never echo, but trim and strip to be safe).
function safeReason(e, password) {
  let m = String((e && (e.response || e.message)) || 'unknown error').replace(/[\r\n]+/g, ' ').slice(0, 200);
  if (password) m = m.split(password).join('[hidden]');
  return m;
}

// ---------------------------------------------------------------- functions
function makeFunctions({ sendMail, mailSettings, mailReady, MAIL, staffName, clean }) {
  // Tries to email the login. Returns { emailSent, reason }.
  async function deliver({ name, email, password, expiresAt, byUid, isNew }) {
    let m;
    try {
      m = await mailSettings();
    } catch (e) {
      return { emailSent: false, reason: 'The email settings could not be read.' };
    }
    if (!mailReady(m)) return { emailSent: false, reason: 'Email sending isn’t set up yet (Settings › Email).' };
    if (m.enabled === false) {
      return { emailSent: false, reason: `Email sending is switched off in Settings${m.disabledReason ? `: ${clean(m.disabledReason, 160)}` : '.'}` };
    }
    try {
      const byName = byUid ? await staffName(byUid) : '';
      const r = await withTimeout(sendMail(loginEmail({ name, email, password, expiresAt, byName, isNew }), m), 25000);
      if (!r || !r.sent) return { emailSent: false, reason: (r && r.reason) || 'The email could not be sent.' };
      return { emailSent: true, reason: '' };
    } catch (e) {
      const reason = safeReason(e, password);
      logger.warn('login email failed', { reason }); // never the password or the address
      return { emailSent: false, reason: `The mail server refused it: ${reason}` };
    }
  }

  async function recordDelivery(uid, res, isNew) {
    await db().doc(`staff/${uid}`).set({
      pendingFirstLogin: true,
      loginEmail: { status: res.emailSent ? 'sent' : 'not-sent', at: FieldValue.serverTimestamp(), kind: isNew ? 'invite' : 'reset' },
    }, { merge: true });
  }

  // Shared by createStaff (after the Auth user + staff doc exist) and resendStaffLogin.
  async function sendLogin({ uid, name, email, byUid, isNew }) {
    const { password, expiresAt } = await issueTempLogin(uid, { reason: isNew ? 'new' : 'reset', by: byUid });
    const res = await deliver({ name, email, password, expiresAt, byUid, isNew });
    try {
      await recordDelivery(uid, res, isNew);
    } catch (e) {
      logger.warn('could not record login email status', { uid, err: e.message });
    }
    const out = { uid, emailSent: res.emailSent, reason: res.reason, expiresAt: expiresAt.toMillis() };
    // Only hand the password back when it did NOT reach the staff member by email.
    if (!res.emailSent) out.tempPassword = password;
    return out;
  }

  const resendStaffLogin = gatedOnCall({ ...MAIL, timeoutSeconds: 60 }, async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Please sign in.');
    const role = req.auth.token.role || '';
    // Owners only (Andy, 26 Oct): managers can't send logins or temporary passwords.
    if (role !== 'owner') throw new HttpsError('permission-denied', 'Only management can send logins or temporary passwords.');
    const uid = clean((req.data || {}).uid, 128);
    if (!uid) throw new HttpsError('invalid-argument', 'Missing staff member.');
    if (uid === req.auth.uid) throw new HttpsError('failed-precondition', 'Change your own password under Account › Change password.');
    const snap = await db().doc(`staff/${uid}`).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Staff member not found.');
    const p = snap.data();
    if (p.terminated) throw new HttpsError('failed-precondition', 'This person has left. Add them again as a new login if they come back.');
    if (p.active === false) throw new HttpsError('failed-precondition', 'Switch their login back on first.');
    let u;
    try {
      u = await auth().getUser(uid);
    } catch (e) {
      throw new HttpsError('failed-precondition', 'This person has no login any more. Remove them and add them again.');
    }
    if (!u.email) throw new HttpsError('failed-precondition', 'This login has no email address.');
    await takeInviteSlot(req.auth.uid, uid);
    return sendLogin({ uid, name: p.name, email: u.email, byUid: req.auth.uid, isNew: !!p.pendingFirstLogin && !p.passwordSetAt && (p.loginEmail || {}).kind !== 'reset' });
  });

  // NOT gated: this is how a gated account gets out.
  const completePasswordChange = onCall({ timeoutSeconds: 30, maxInstances: 3 }, async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Please sign in again.');
    const uid = req.auth.uid;
    const d = req.data || {};
    const current = typeof d.currentPassword === 'string' ? d.currentPassword : '';
    const next = typeof d.newPassword === 'string' ? d.newPassword : '';
    if (!current || current.length > 200) throw new HttpsError('invalid-argument', 'Enter the temporary password from your email.');
    const gate = await gateRef(uid).get();
    const claimed = req.auth.token[CLAIM] === true;
    if (!gate.exists) {
      if (claimed) {
        // stale token from before the change finished; nothing left to do
        return { ok: true, alreadyDone: true };
      }
      throw new HttpsError('failed-precondition', 'You don’t need to do this. To change your password, use Account › Change password.');
    }
    if (gate.get('expired') === true || (gate.get('expiresAt') && gate.get('expiresAt').toMillis() < Date.now())) {
      throw new HttpsError('failed-precondition', 'Your temporary password has run out. Ask a manager to send you a new one.', { reason: 'expired' });
    }
    const u = await auth().getUser(uid);
    if (u.disabled) throw new HttpsError('permission-denied', 'This login has been switched off. Ask a manager.');
    const problem = checkNewPassword(next, { email: u.email, current });
    if (problem) throw new HttpsError('invalid-argument', problem);
    const slot = await takeSlots([
      { kind: 'pwchange-15m', key: uid, windowMs: 15 * MIN, max: LIMITS.changeAttempts15m },
      { kind: 'pwchange-day', key: uid, windowMs: DAY, max: LIMITS.changeAttemptsDay },
    ], null);
    if (!slot.ok) throw limitError(slot);
    const check = await passwordSignIn(u.email, current);
    if (!check.ok || check.localId !== uid) {
      if (check.code === 'TOO_MANY_ATTEMPTS_TRY_LATER') throw new HttpsError('resource-exhausted', 'Too many tries. Wait a few minutes and try again.');
      throw new HttpsError('permission-denied', 'That temporary password isn’t right. Copy it from your email exactly.', { reason: 'wrong-current' });
    }
    // Make sure the gate wasn't replaced (e.g. a manager resent a new password) while we checked.
    const again = await gateRef(uid).get();
    if (!again.exists || !again.get('createdAt') || !gate.get('createdAt') || !again.get('createdAt').isEqual(gate.get('createdAt'))) {
      throw new HttpsError('aborted', 'Your login was just changed by a manager. Sign out and use the newest temporary password.');
    }
    await auth().updateUser(uid, { password: next });
    const verify = await passwordSignIn(u.email, next);
    if (!verify.ok || verify.localId !== uid) {
      logger.error('password change could not be verified', { code: verify.code });
      throw new HttpsError('internal', 'Your new password could not be checked. Try again in a minute.');
    }
    const fresh = await auth().getUser(uid);
    const claims = { ...(fresh.customClaims || {}) };
    delete claims[CLAIM];
    await auth().setCustomUserClaims(uid, claims);
    await gateRef(uid).delete();
    await db().doc(`staff/${uid}`).set({
      pendingFirstLogin: FieldValue.delete(),
      loginEmail: FieldValue.delete(),
      passwordSetAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await auth().revokeRefreshTokens(uid);
    logger.info('first-login password set', { uid });
    return { ok: true };
  });

  // Daily: temporary passwords that have run out stop working.
  const expireTempLogins = onSchedule({ schedule: '15 4 * * *', timeZone: 'Europe/London' }, async () => {
    const snap = await db().collection(GATE).where('expiresAt', '<', Timestamp.now()).get();
    for (const g of snap.docs) {
      if (g.get('expired') === true) continue;
      try {
        await auth().updateUser(g.id, { password: crypto.randomBytes(32).toString('base64url') });
        await auth().revokeRefreshTokens(g.id);
        await g.ref.update({ expired: true });
        await db().doc(`staff/${g.id}`).set({ loginEmail: { status: 'expired', at: FieldValue.serverTimestamp() } }, { merge: true });
      } catch (e) {
        if (e.code === 'auth/user-not-found') await g.ref.delete();
        else logger.warn('could not expire temp login', { uid: g.id, err: e.message });
      }
    }
  });

  return { resendStaffLogin, completePasswordChange, expireTempLogins, sendLogin, takeInviteSlot };
}

// Checks an email + password with Firebase Auth itself (Identity Toolkit). The emulator is used
// automatically when the functions emulator sets FIREBASE_AUTH_EMULATOR_HOST.
async function passwordSignIn(email, password) {
  const emu = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const base = emu ? `http://${emu}/identitytoolkit.googleapis.com` : 'https://identitytoolkit.googleapis.com';
  try {
    const r = await fetch(`${base}/v1/accounts:signInWithPassword?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Referer: APP_URL },
      body: JSON.stringify({ email, password, returnSecureToken: false }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.localId) return { ok: true, localId: j.localId };
    return { ok: false, code: String(((j.error || {}).message) || `HTTP_${r.status}`).split(' ')[0].slice(0, 60) };
  } catch (e) {
    return { ok: false, code: 'NETWORK' };
  }
}

module.exports = {
  CLAIM, GATE, LIMITS, TEMP_TTL_MS, gatedOnCall, assertNotGated, issueTempLogin, makeFunctions,
  generateTempPassword, checkNewPassword, loginEmail, safeReason,
  // used by myDetails.js (Account > Your details)
  takeSlots, limitError, API_KEY, APP_URL,
};
