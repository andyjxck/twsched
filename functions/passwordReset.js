/* requestPasswordReset - the staff app's "Forgot password" route.
 *
 * Server-side limits, checked and recorded in one Firestore transaction before any email is asked for:
 *   - per address: one reset email every 2 minutes (sliding) and at most 5 a day
 *   - per caller IP: 5 an hour, 20 a day
 *   - whole app: 60 a day
 * Addresses are normalised (trimmed, lower-cased; Firebase Auth treats email case-insensitively)
 * and only salted hashes of addresses / IPs are stored in rateLimits/ (no client access, expireAt
 * drives the TTL policy). Limits apply whether or not the address has a login, and the answer is
 * the same either way, so the route cannot be used to find out who has an account.
 *
 * The email itself is still Firebase Auth's own password-reset email (accounts:sendOobCode),
 * exactly as before. Firebase's improved email privacy is on for this project, so no email is sent
 * to an address without a login and the response does not say so.
 *
 * Limitation: this limits the app's route. Firebase's public accounts:sendOobCode endpoint can
 * still be called directly with the public web API key; that path only has Firebase's own built-in
 * abuse limits. Closing it needs Identity Platform blocking functions (beforeEmailSent).
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { callerIp, keyHash, isEmail } = require('./enquiry');

const API_KEY = 'AIzaSyDe67skrRZG6TcHFcDUI45zY6Az4Jn5Y2I'; // public web API key (already shipped in the app)
const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const RESET_LIMITS = {
  cooldownMs: 2 * MIN, // one email per address per 2 minutes
  perEmailDay: 5,
  perIpHour: 5,
  perIpDay: 20,
  globalDay: 60,
};

function normaliseEmail(v) {
  const e = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!e || e.length > 150 || /[\s\r\n]/.test(e) || !isEmail(e)) return '';
  return e;
}

let salt = null;
async function getSalt(db) {
  if (salt) return salt;
  const ref = db.doc('private/rateLimitSalt'); // same salt doc the enquiry limits use
  try {
    await ref.create({ salt: crypto.randomBytes(24).toString('hex'), createdAt: admin.firestore.FieldValue.serverTimestamp() });
  } catch (e) {
    // already exists
  }
  salt = (await ref.get()).get('salt');
  return salt;
}

// Checks every limit and, only if all pass, records the request. Returns { ok } or
// { ok: false, kind, retryAfter } (seconds). Runs in a transaction, so concurrent requests for the
// same address cannot both get through the 2-minute cooldown.
async function takeResetSlot(db, email, ip, now = Date.now()) {
  const s = await getSalt(db);
  const col = db.collection('rateLimits');
  const cooldownRef = col.doc(keyHash('reset-email-cooldown', email, s));
  const windows = [
    { kind: 'reset-email-day', value: email, windowMs: DAY, limit: RESET_LIMITS.perEmailDay },
    { kind: 'reset-ip-hour', value: ip, windowMs: HOUR, limit: RESET_LIMITS.perIpHour },
    { kind: 'reset-ip-day', value: ip, windowMs: DAY, limit: RESET_LIMITS.perIpDay },
    { kind: 'reset-global-day', value: 'all', windowMs: DAY, limit: RESET_LIMITS.globalDay },
  ].map((w) => {
    const bucket = Math.floor(now / w.windowMs);
    return { ...w, bucket, end: (bucket + 1) * w.windowMs, ref: col.doc(keyHash(w.kind, `${w.value}|${bucket}`, s)) };
  });
  return db.runTransaction(async (tx) => {
    const cd = await tx.get(cooldownRef);
    const snaps = await Promise.all(windows.map((w) => tx.get(w.ref)));
    const until = cd.exists ? Number(cd.get('until')) || 0 : 0;
    if (until > now) return { ok: false, kind: 'reset-email-cooldown', retryAfter: Math.ceil((until - now) / 1000) };
    const i = windows.findIndex((w, j) => (snaps[j].exists ? snaps[j].get('count') || 0 : 0) >= w.limit);
    if (i >= 0) return { ok: false, kind: windows[i].kind, retryAfter: Math.ceil((windows[i].end - now) / 1000) };
    tx.set(cooldownRef, { kind: 'reset-email-cooldown', until: now + RESET_LIMITS.cooldownMs, expireAt: new Date(now + RESET_LIMITS.cooldownMs + HOUR) });
    windows.forEach((w, j) => {
      const count = (snaps[j].exists ? snaps[j].get('count') || 0 : 0) + 1;
      tx.set(w.ref, { kind: w.kind, count, expireAt: new Date((w.bucket + 2) * w.windowMs) });
    });
    return { ok: true };
  });
}

// Ask Firebase Auth to send its standard password-reset email.
async function sendResetEmail(email) {
  const emu = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const base = emu ? `http://${emu}/identitytoolkit.googleapis.com` : 'https://identitytoolkit.googleapis.com';
  const r = await fetch(`${base}/v1/accounts:sendOobCode?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: 'https://andyjxck.github.io/twsched/' },
    body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }),
  });
  if (r.ok) return { sent: true };
  let code = `HTTP_${r.status}`;
  try {
    code = ((await r.json()).error || {}).message || code;
  } catch (e) {
    // ignore
  }
  return { sent: false, code: String(code).split(' ')[0].slice(0, 60) };
}

const requestPasswordReset = onCall({
  cors: ['https://andyjxck.github.io', /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/],
  maxInstances: 2,
  timeoutSeconds: 20,
  invoker: 'public',
}, async (req) => {
  const d = req.data || {};
  if (JSON.stringify(d).length > 1000) throw new HttpsError('invalid-argument', 'Please check your email address.');
  const email = normaliseEmail(d.email);
  if (!email) throw new HttpsError('invalid-argument', 'Please check your email address.');
  const db = admin.firestore();
  const slot = await takeResetSlot(db, email, callerIp(req.rawRequest));
  if (!slot.ok) {
    logger.warn('password reset rate limited', { kind: slot.kind });
    const msg = slot.kind === 'reset-email-cooldown'
      ? 'A reset link was sent to that address in the last 2 minutes. Please wait before asking again.'
      : 'Too many reset requests. Please try again later, or ask a manager.';
    throw new HttpsError('resource-exhausted', msg, { retryAfter: slot.retryAfter });
  }
  const res = await sendResetEmail(email);
  // Never log the address. Failures keep the same answer so they reveal nothing about the account.
  if (!res.sent) logger.warn('password reset email not sent', { code: res.code });
  return { ok: true, retryAfter: RESET_LIMITS.cooldownMs / 1000 };
});

module.exports = { requestPasswordReset, takeResetSlot, normaliseEmail, RESET_LIMITS };
