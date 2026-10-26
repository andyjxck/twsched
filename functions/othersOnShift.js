/* "Others on this shift" (Andy, 26 Oct).
 *
 * Team members can only read their own published shifts (firestore.rules), so they cannot see who
 * else is working. This callable returns a minimal projection for ONE of the caller's own published
 * shifts: for every other person whose published shift overlaps it in time, only
 *   { name, area, start, end, leader }
 * Nothing else leaves the server: no ids, emails, phone numbers, notes, breaks, pay or hours.
 * Draft (unpublished) shifts and open shifts (nobody assigned) are never included.
 *
 * othersOnShift({ shiftId }) -> { others: [{ name, area, start, end, leader }] }
 *   - caller must be on the rota (owner, manager or team member); payroll logins are refused
 *   - the shift must be published and belong to the caller (owners and managers can ask about any
 *     published shift, since they can already read the whole rota)
 * Times are whole-day strings 'HH:MM'; a shift whose end is at or before its start finishes the next
 * day. Overlap is checked on real minutes, so a late shift the day before that runs past midnight
 * counts, and so does an early shift the next morning if this one runs past midnight.
 */
const { HttpsError } = require('firebase-functions/v2/https');
const { gatedOnCall: onCall } = require('./onboarding'); // refuses accounts that must still choose a password
const admin = require('firebase-admin');

const db = () => admin.firestore();
const ROTA_ROLES = ['owner', 'manager', 'staff'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

// [start, end) in minutes from midnight at the start of baseDate
function span(s, baseDate) {
  if (!s || !YMD.test(s.date || '') || !HHMM.test(s.start || '') || !HHMM.test(s.end || '')) return null;
  const offset = s.date === baseDate ? 0 : s.date < baseDate ? -1440 : 1440;
  const a = mins(s.start);
  let b = mins(s.end);
  if (b <= a) b += 1440; // finishes next day
  return [a + offset, b + offset];
}

function clean(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

exports.othersOnShift = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const uid = req.auth.uid;
  const role = req.auth.token.role || '';
  if (!ROTA_ROLES.includes(role)) throw new HttpsError('permission-denied', 'Only people on the rota can see this.');

  const shiftId = clean((req.data || {}).shiftId, 128);
  if (!shiftId || shiftId.includes('/')) throw new HttpsError('invalid-argument', 'Pick a shift.');

  const snap = await db().doc(`shifts/${shiftId}`).get();
  const mine = snap.exists ? snap.data() : null;
  const isManager = role === 'owner' || role === 'manager';
  // Same answer for "doesn't exist", "draft" and "someone else's", so nothing can be probed.
  if (!mine || mine.published !== true || (!isManager && mine.staffId !== uid)) {
    throw new HttpsError('not-found', 'That shift isn’t on the published rota.');
  }
  const base = mine.date;
  const me = span(mine, base);
  if (!me) return { others: [] };

  // Single-field 'in' query (no composite index); published is filtered here.
  const days = [addDays(base, -1), base, addDays(base, 1)];
  const qs = await db().collection('shifts').where('date', 'in', days).get();

  const rows = [];
  qs.forEach((d) => {
    if (d.id === snap.id) return;
    const s = d.data();
    if (s.published !== true) return; // never drafts
    if (!s.staffId || typeof s.staffId !== 'string') return; // open shifts: nobody to show
    if (s.staffId === mine.staffId) return; // the person themself (e.g. a split shift)
    const t = span(s, base);
    if (!t || !(t[0] < me[1] && me[0] < t[1])) return; // must overlap in time
    rows.push({ staffId: s.staffId, staffName: clean(s.staffName, 80), area: clean(s.area, 40), start: s.start, end: s.end, leader: s.leader === true, sortKey: t[0] });
  });

  // Current names from the colleague directory (no contact details in there); fall back to the shift.
  const ids = [...new Set(rows.map((r) => r.staffId))];
  const dir = {};
  if (ids.length) {
    const refs = ids.map((id) => db().doc(`directory/${id}`));
    const docs = await db().getAll(...refs);
    docs.forEach((d) => { if (d.exists) dir[d.id] = d.data() || {}; });
  }

  const others = rows
    .map((r) => {
      const e = dir[r.staffId] || {};
      return {
        name: clean(e.name, 80) || r.staffName || 'Someone',
        area: r.area || clean(e.jobTitle, 40),
        start: r.start,
        end: r.end,
        leader: r.leader,
        _k: r.sortKey,
      };
    })
    .sort((a, b) => (b.leader - a.leader) || (a._k - b._k) || a.name.localeCompare(b.name))
    .map(({ _k, ...o }) => o);

  return { others };
});

// for tests
exports._span = span;
