/* Developer access (Andy, 24 Nov 2026).
 *
 * The developer login (custom claim role 'developer', staff record developer: true) sees every page with
 * staff information blacked out: firestore.rules and storage.rules give it nothing but its own staff record
 * and its own grants. An OWNER can give it 24 hours of access:
 *   1. grantDevAccess (owner only, from Team > Andy (developer) > Give access) makes a one-time code, keeps
 *      only its salted SHA-256 hash (devCodes/{id}, server-only), and emails the code to the developer's
 *      login address through the app's mail settings (Brevo, noreply@tws-rota.co.uk). The code works for
 *      CODE_TTL_MS and MAX_ATTEMPTS wrong tries.
 *   2. redeemDevCode (developer only) checks the code. On success devAccess/{id} becomes active with
 *      expiresAt = now + 24h, and the login's claims get devGrant (the grant id) and devUntil. The rules
 *      treat the developer as an owner only while devAccess/{devGrant} is active, belongs to it and
 *      request.time < expiresAt, so access ends by itself at 24 hours and the moment an owner ends it.
 *   3. endDevAccess (owner only) ends an active grant or cancels an unused code.
 * The developer can never ask for a code: grantDevAccess checks the caller's token role is 'owner', and a
 * developer token's role stays 'developer' even during a grant. During a grant the developer still can't
 * use any callable (staff accounts, roles, logins, publishing), so it can't change its own role, make
 * itself an owner login, take over another login or give itself access. Every grant is kept in
 * devAccess (owners can read the whole log; the developer only its own grants).
 */
const { HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');

const ACCESS_MS = 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 60 * 60 * 1000; // the emailed code works for 1 hour
const MAX_ATTEMPTS = 5;
const MIN_GAP_MS = 60 * 1000; // one new code a minute at most

function hashCode(salt, code) {
  return crypto.createHash('sha256').update(salt + ':' + code).digest('hex');
}
function newCode() {
  return String(crypto.randomInt(0, 100000000)).padStart(8, '0');
}
function isDevRecord(d) { return !!d && d.developer === true && d.role === 'developer'; }
function tokenRole(req) { return (req.auth && req.auth.token && req.auth.token.role) || ''; }
function ukTime(ms) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
}

function makeFunctions({ onCall, MAIL, sendMail, managerIds, APP_URL }) {
  const db = () => admin.firestore();
  const auth = () => admin.auth();

  // A real owner: token role owner AND an owner staff record that isn't the developer's.
  async function requireRealOwner(req) {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Please sign in.');
    if (tokenRole(req) !== 'owner') throw new HttpsError('permission-denied', 'Only an owner can give or end developer access.');
    const me = await db().doc(`staff/${req.auth.uid}`).get();
    if (!me.exists || me.get('role') !== 'owner' || me.get('developer') === true || me.get('active') === false || me.get('terminated') === true) {
      throw new HttpsError('permission-denied', 'Only an owner can give or end developer access.');
    }
    return me;
  }

  const grantDevAccess = onCall(MAIL, async (req) => {
    const me = await requireRealOwner(req);
    const devUid = String((req.data || {}).uid || '').slice(0, 128);
    const devSnap = devUid ? await db().doc(`staff/${devUid}`).get() : null;
    if (!devSnap || !devSnap.exists || !isDevRecord(devSnap.data())) throw new HttpsError('failed-precondition', 'That isn\u2019t the developer login.');
    if (devSnap.get('active') === false) throw new HttpsError('failed-precondition', 'The developer login is switched off.');
    const devUser = await auth().getUser(devUid);
    if (!devUser.email) throw new HttpsError('failed-precondition', 'The developer login has no email address.');

    const open = await db().collection('devAccess').where('devUid', '==', devUid).where('status', 'in', ['pending', 'active']).get();
    const now = Date.now();
    for (const g of open.docs) {
      const st = g.get('status');
      if (st === 'active' && g.get('expiresAt').toMillis() > now) {
        throw new HttpsError('failed-precondition', 'The developer already has access until ' + ukTime(g.get('expiresAt').toMillis()) + '. End it first to send a new code.');
      }
      if (st === 'pending' && g.get('createdAt') && now - g.get('createdAt').toMillis() < MIN_GAP_MS) {
        throw new HttpsError('resource-exhausted', 'A code was sent less than a minute ago. Please wait a moment.');
      }
    }
    const code = newCode();
    const salt = crypto.randomBytes(16).toString('hex');
    const ref = db().collection('devAccess').doc();
    const codeExpiresAt = Timestamp.fromMillis(now + CODE_TTL_MS);
    const batch = db().batch();
    for (const g of open.docs) {
      batch.update(g.ref, g.get('status') === 'pending'
        ? { status: 'superseded', endedAt: FieldValue.serverTimestamp() }
        : { status: 'expired' });
      if (g.get('status') === 'pending') batch.delete(db().doc(`devCodes/${g.id}`));
    }
    batch.set(ref, {
      devUid, status: 'pending', grantedBy: req.auth.uid, grantedByName: me.get('name') || '',
      createdAt: FieldValue.serverTimestamp(), codeExpiresAt, usedAt: null, expiresAt: null,
      endedBy: null, endedByName: null, endedAt: null, wrongAttempts: 0,
    });
    batch.set(db().doc(`devCodes/${ref.id}`), { hash: hashCode(salt, code), salt, attempts: 0, codeExpiresAt, devUid });
    await batch.commit();

    const text = `${me.get('name') || 'An owner'} has given you developer access to the White Swan Staff Hub.\n\n`
      + `Your code: ${code}\n\nSign in to the Staff Hub as the developer and enter the code. It works once, within 1 hour (until ${ukTime(now + CODE_TTL_MS)}).\n`
      + `Access then lasts 24 hours, and any owner can end it sooner.\n\nIf you weren\u2019t expecting this, ignore it.\n\n${APP_URL}`;
    let sent = { sent: false, reason: '' };
    try { sent = await sendMail({ to: devUser.email, subject: 'Your Staff Hub developer access code', text }); } catch (e) { sent = { sent: false, reason: e.message }; }
    if (!sent.sent) {
      await ref.update({ status: 'failed', endedAt: FieldValue.serverTimestamp() });
      await db().doc(`devCodes/${ref.id}`).delete();
      logger.error('dev code email failed', sent.reason);
      throw new HttpsError('unavailable', 'Couldn\u2019t send the code email. Nothing was given. Try again later.');
    }
    logger.info('dev access code sent', { grant: ref.id, by: req.auth.uid });
    return { ok: true, grantId: ref.id, codeExpiresAt: now + CODE_TTL_MS };
  });

  const redeemDevCode = onCall(MAIL, async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Please sign in.');
    if (tokenRole(req) !== 'developer') throw new HttpsError('permission-denied', 'Only the developer login uses access codes.');
    const uid = req.auth.uid;
    const code = String((req.data || {}).code || '').replace(/\D/g, '');
    if (code.length !== 8) throw new HttpsError('invalid-argument', 'Enter the 8-digit code from the email.');
    const pend = await db().collection('devAccess').where('devUid', '==', uid).where('status', '==', 'pending').get();
    const latest = pend.docs.sort((a, b) => (b.get('createdAt') ? b.get('createdAt').toMillis() : 0) - (a.get('createdAt') ? a.get('createdAt').toMillis() : 0))[0];
    if (!latest) throw new HttpsError('failed-precondition', 'There\u2019s no code waiting. Ask an owner to tap Give access on the Team page.');
    const gRef = latest.ref;
    const cRef = db().doc(`devCodes/${latest.id}`);
    const result = await db().runTransaction(async (tx) => {
      const [g, c] = await Promise.all([tx.get(gRef), tx.get(cRef)]);
      if (!g.exists || g.get('status') !== 'pending' || !c.exists) return { err: 'gone' };
      const now = Date.now();
      if (c.get('codeExpiresAt').toMillis() <= now) {
        tx.update(gRef, { status: 'code-expired', endedAt: FieldValue.serverTimestamp() }); tx.delete(cRef);
        return { err: 'expired' };
      }
      const a = Buffer.from(hashCode(c.get('salt'), code), 'hex');
      const b = Buffer.from(c.get('hash'), 'hex');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        const n = (c.get('attempts') || 0) + 1;
        if (n >= MAX_ATTEMPTS) {
          tx.update(gRef, { status: 'locked', wrongAttempts: n, endedAt: FieldValue.serverTimestamp() }); tx.delete(cRef);
          return { err: 'locked' };
        }
        tx.update(cRef, { attempts: n }); tx.update(gRef, { wrongAttempts: n });
        return { err: 'wrong', left: MAX_ATTEMPTS - n };
      }
      const expiresAt = Timestamp.fromMillis(now + ACCESS_MS);
      tx.update(gRef, { status: 'active', usedAt: FieldValue.serverTimestamp(), expiresAt });
      tx.delete(cRef);
      return { ok: true, expiresMs: expiresAt.toMillis() };
    });
    if (result.err === 'wrong') throw new HttpsError('permission-denied', `That code isn\u2019t right. ${result.left} ${result.left === 1 ? 'try' : 'tries'} left.`);
    if (result.err === 'locked') throw new HttpsError('permission-denied', 'Too many wrong codes, so that code no longer works. Ask an owner for a new one.');
    if (result.err === 'expired') throw new HttpsError('deadline-exceeded', 'That code has expired. Ask an owner for a new one.');
    if (result.err) throw new HttpsError('failed-precondition', 'That code no longer works. Ask an owner for a new one.');
    const u = await auth().getUser(uid);
    await auth().setCustomUserClaims(uid, { ...(u.customClaims || {}), role: 'developer', devGrant: latest.id, devUntil: Math.floor(result.expiresMs / 1000) });
    // tell the owners (not the developer) that the code was used
    try {
      const owners = (await managerIds()).filter(Boolean);
      for (const id of owners) {
        const s = await db().doc(`staff/${id}`).get();
        if (!s.exists || s.get('role') !== 'owner' || !s.get('email')) continue;
        await sendMail({ to: s.get('email'), subject: 'Developer access is now on',
          text: `The developer used the access code from ${latest.get('grantedByName') || 'an owner'}. They can see and edit staff information in the Staff Hub until ${ukTime(result.expiresMs)}.\n\nTo end it sooner: Team > Andy (developer) > End access.\n\n${APP_URL}` });
      }
    } catch (e) { logger.warn('owner notice failed', e.message); }
    logger.info('dev access active', { grant: latest.id });
    return { ok: true, grantId: latest.id, expiresAt: result.expiresMs };
  });

  const endDevAccess = onCall(async (req) => {
    const me = await requireRealOwner(req);
    const id = String((req.data || {}).grantId || '').slice(0, 64);
    if (!id) throw new HttpsError('invalid-argument', 'Missing grant.');
    const ref = db().doc(`devAccess/${id}`);
    const g = await ref.get();
    if (!g.exists) throw new HttpsError('not-found', 'Grant not found.');
    if (!['pending', 'active'].includes(g.get('status'))) return { ok: true, already: true };
    await ref.update({ status: 'ended', endedBy: req.auth.uid, endedByName: me.get('name') || '', endedAt: FieldValue.serverTimestamp() });
    await db().doc(`devCodes/${id}`).delete();
    try {
      const u = await auth().getUser(g.get('devUid'));
      const c = { ...(u.customClaims || {}) };
      if (c.devGrant === id) { delete c.devGrant; delete c.devUntil; await auth().setCustomUserClaims(u.uid, c); }
    } catch (e) { logger.warn('claim cleanup failed', e.message); }
    return { ok: true };
  });

  return { grantDevAccess, redeemDevCode, endDevAccess };
}

module.exports = { makeFunctions, hashCode, ACCESS_MS, CODE_TTL_MS, MAX_ATTEMPTS };
