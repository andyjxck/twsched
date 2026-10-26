/* Single-day rota approval (the tick on each day of the rota).
 *
 *   approveDay({ date })   - owner/manager. Publishes that day's drafts and locks the calendar date
 *                            days/{YYYY-MM-DD}. From then on only the owner can change shifts on it
 *                            (enforced in firestore.rules and in every Cloud Function that changes shifts).
 *   unapproveDay({ date }) - the person who ticked it can untick it for 5 minutes (server clock).
 *                            After that the lock is permanent for managers; only the owner can unlock it.
 *
 * Dates are rota calendar days (the 'date' field on shifts, YYYY-MM-DD, the UK day the shift starts on).
 */
const { HttpsError } = require('firebase-functions/v2/https');
const { gatedOnCall: onCall } = require('./onboarding'); // refuses accounts that must still choose a password
const admin = require('firebase-admin');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');

const GRACE_MS = 5 * 60 * 1000;

function db() { return admin.firestore(); }
function role(req) { return (req.auth && req.auth.token && req.auth.token.role) || ''; }
function requireManager(req) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Please sign in.');
  if (!['owner', 'manager'].includes(role(req))) throw new HttpsError('permission-denied', 'Only managers and the owner can approve rota days.');
}
function validYmd(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function mondayOf(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
function prettyDate(ymd) {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
async function callerName(req) {
  const s = await db().doc(`staff/${req.auth.uid}`).get();
  return (s.exists && s.get('name')) || req.auth.token.email || (role(req) === 'owner' ? 'Owner' : 'Manager');
}

// Set of dates (YYYY-MM-DD) among `dates` whose day is approved.
async function approvedDays(dates) {
  const list = [...new Set((dates || []).filter(validYmd))];
  if (!list.length) return new Set();
  const snaps = await db().getAll(...list.map((d) => db().doc(`days/${d}`)));
  return new Set(snaps.filter((s) => s.exists && s.get('status') === 'approved').map((s) => s.id));
}
async function dayApproved(date) {
  return (await approvedDays([date])).has(date);
}

function makeFunctions({ notify, emailStaff, MAIL }) {
  const approveDay = onCall(MAIL, async (req) => {
    requireManager(req);
    const date = typeof (req.data || {}).date === 'string' ? req.data.date.trim() : '';
    if (!validYmd(date)) throw new HttpsError('invalid-argument', 'Pick a valid day.');
    const week = mondayOf(date);
    const isOwner = role(req) === 'owner';
    if (!isOwner) {
      const w = await db().doc(`weeks/${week}`).get();
      if (w.exists && w.get('status') === 'approved') {
        throw new HttpsError('failed-precondition', 'This whole week is already approved. Only the owner can change it.');
      }
    }
    const name = await callerName(req);
    const uid = req.auth.uid;
    const ref = db().doc(`days/${date}`);
    const now = Date.now();
    const published = await db().runTransaction(async (t) => {
      const cur = await t.get(ref);
      if (cur.exists && cur.get('status') === 'approved') {
        throw new HttpsError('already-exists', `${prettyDate(date)} is already approved${cur.get('approvedByName') ? ` by ${cur.get('approvedByName')}` : ''}.`);
      }
      const dayDrafts = (await t.get(db().collection('shifts').where('date', '==', date))).docs
        .filter((d) => d.get('published') !== true);
      // a draft for someone unavailable / on approved holiday then stays a draft (never published, not changed)
      const clash = await require('./availability').clashingIds(dayDrafts);
      // Right to Work no longer holds a draft back (Andy, 26 Oct); the app still flags missing documents
      const drafts = dayDrafts.filter((d) => !clash.has(d.id));
      drafts.forEach((d) => t.update(d.ref, { published: true, updatedAt: FieldValue.serverTimestamp(), updatedBy: uid }));
      t.set(ref, {
        date, week, status: 'approved',
        approvedBy: uid, approvedByName: name, approvedByRole: role(req),
        approvedAt: Timestamp.fromMillis(now),
        graceUntil: Timestamp.fromMillis(now + GRACE_MS),
        unapprovedBy: FieldValue.delete(), unapprovedByName: FieldValue.delete(), unapprovedAt: FieldValue.delete(),
        history: FieldValue.arrayUnion({ action: 'approved', by: uid, byName: name, at: Timestamp.fromMillis(now) }),
      }, { merge: true });
      return drafts.map((d) => d.get('staffId')).filter(Boolean);
    });
    const people = [...new Set(published)];
    if (people.length) {
      const title = `Rota for ${prettyDate(date)} is out`;
      await Promise.all(people.map((p) => notify([p], { title, body: 'Have a look at your shifts.', link: `#/rota?week=${week}` })));
      await emailStaff(people, title, `${title}. Have a look at your shifts in the staff app.`);
    }
    return { ok: true, date, published: published.length, approvedByName: name, graceUntil: now + GRACE_MS };
  });

  const unapproveDay = onCall(async (req) => {
    requireManager(req);
    const date = typeof (req.data || {}).date === 'string' ? req.data.date.trim() : '';
    if (!validYmd(date)) throw new HttpsError('invalid-argument', 'Pick a valid day.');
    const isOwner = role(req) === 'owner';
    const uid = req.auth.uid;
    const name = await callerName(req);
    const ref = db().doc(`days/${date}`);
    await db().runTransaction(async (t) => {
      const cur = await t.get(ref);
      if (!cur.exists || cur.get('status') !== 'approved') throw new HttpsError('failed-precondition', 'That day isn’t approved.');
      const now = Date.now();
      if (!isOwner) {
        if (cur.get('approvedBy') !== uid) {
          throw new HttpsError('permission-denied', `Only ${cur.get('approvedByName') || 'the person who approved it'} can undo this, within 5 minutes. After that only the owner can unlock it.`);
        }
        const until = cur.get('graceUntil');
        if (!until || now >= until.toMillis()) {
          throw new HttpsError('permission-denied', 'The 5 minutes to undo this have passed, so the day is locked for good. Only the owner can unlock it.');
        }
      }
      t.update(ref, {
        status: 'unapproved',
        unapprovedBy: uid, unapprovedByName: name, unapprovedAt: Timestamp.fromMillis(now),
        graceUntil: FieldValue.delete(),
        history: FieldValue.arrayUnion({ action: isOwner ? 'unlocked by owner' : 'undone in 5 minutes', by: uid, byName: name, at: Timestamp.fromMillis(now) }),
      });
    });
    return { ok: true, date };
  });

  return { approveDay, unapproveDay };
}

module.exports = { makeFunctions, approvedDays, dayApproved, GRACE_MS };
