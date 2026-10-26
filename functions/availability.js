/* Rota availability: nobody (owner included) can be put on a shift on a day they are unavailable
 * or on approved holiday (Andy, 20 Oct).
 *
 * Source records (unchanged):
 *   unavailability/{id}  { staffId, from, to, weekday (0 = every day, 1..7 = Mon..Sun only), reason }  whole UK days
 *   timeOff/{id}         { staffId, from, to, paid, status }  only status 'approved' blocks; pending, declined
 *                        and cancelled requests never do
 *
 * Server-maintained index, read by firestore.rules on every shift write that assigns someone or changes
 * a shift's person, day or times (the rules cannot query collections, so they look the day up here):
 *   rotaBlocks/{staffId}_{YYYY}  { staffId, year, d: { 'YYYY-MM-DD': { k: 'holiday'|'unav', r: reason, paid } } }
 * Written only here (rules: write false). It is rebuilt for a person:
 *   - in the same transaction that creates unavailability through addUnavailability and that approves
 *     holiday through decideRequest, so there is no moment where the record exists but is not enforced;
 *   - by the triggers below for every other change (deletes, older app versions writing directly);
 *   - daily, so long recurring unavailability keeps extending past the indexed horizon.
 *
 * A shift on day D conflicts if D is blocked, or if it runs past midnight (end before start, and end
 * not exactly 00:00) and D+1 is blocked. Existing shifts are never changed or deleted here; shifts
 * that already clash are only reported.
 */
const { HttpsError } = require('firebase-functions/v2/https');
const { gatedOnCall: onCall } = require('./onboarding'); // refuses accounts that must still choose a password
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const db = () => admin.firestore();
const PAST_DAYS = 400; // index this far back so recent past shifts are covered too
const FUTURE_DAYS = 3 * 366 + 31; // and this far ahead; the daily refresh keeps rolling it forward

function londonToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
}
function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function isoWeekday(ymd) {
  const g = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return g === 0 ? 7 : g;
}
function validYmd(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function prettyDate(ymd) {
  if (!ymd) return '';
  const d = new Date(`${ymd}T12:00:00Z`);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
// shift finishes after midnight (the rota's convention: end <= start means it ends the next day)
function spillsOver(start, end) {
  return !!(start && end && end <= start && end !== '00:00');
}

// The blocked days for one person, from their unavailability and approved holiday.
// Returns { [year]: { [ymd]: entry } }. Approved holiday wins over unavailability on the same day.
function desiredBlocks(unavs, holidays, today) {
  const lo = addDays(today, -PAST_DAYS);
  const hi = addDays(today, FUTURE_DAYS);
  const out = {};
  const put = (d, entry, force) => {
    const y = d.slice(0, 4);
    out[y] = out[y] || {};
    if (force || !out[y][d]) out[y][d] = entry;
  };
  const span = (from, to, fn) => {
    if (!validYmd(from) || !validYmd(to) || to < from) return;
    let d = from < lo ? lo : from;
    const end = to > hi ? hi : to;
    for (; d <= end; d = addDays(d, 1)) fn(d);
  };
  unavs.forEach((u) => {
    const wd = Number(u.weekday) || 0;
    const r = String(u.reason || '').slice(0, 200);
    span(u.from, u.to, (d) => { if (!wd || isoWeekday(d) === wd) put(d, { k: 'unav', r }, false); });
  });
  holidays.forEach((t) => {
    span(t.from, t.to, (d) => put(d, { k: 'holiday', paid: t.paid !== false }, true));
  });
  return out;
}

// Rebuild rotaBlocks for staffId inside transaction t. All reads happen before any write, so the
// caller may write more afterwards. overrides: { unavailability: { id: data|null }, timeOff: { id: data|null } }
async function rebuildInTx(t, staffId, overrides = {}) {
  if (!staffId) return;
  const [uSnap, tSnap, bSnap] = await Promise.all([
    t.get(db().collection('unavailability').where('staffId', '==', staffId)),
    t.get(db().collection('timeOff').where('staffId', '==', staffId)),
    t.get(db().collection('rotaBlocks').where('staffId', '==', staffId)),
  ]);
  const merge = (snap, extra) => {
    const m = new Map(snap.docs.map((d) => [d.id, d.data()]));
    Object.entries(extra || {}).forEach(([id, v]) => { if (v) m.set(id, v); else m.delete(id); });
    return [...m.values()].filter((x) => x && x.staffId === staffId);
  };
  const unavs = merge(uSnap, overrides.unavailability);
  const holidays = merge(tSnap, overrides.timeOff).filter((x) => x.status === 'approved');
  const want = desiredBlocks(unavs, holidays, londonToday());
  const have = new Map(bSnap.docs.map((d) => [d.id, d]));
  Object.entries(want).forEach(([year, d]) => {
    const id = `${staffId}_${year}`;
    const cur = have.get(id);
    have.delete(id);
    if (cur && JSON.stringify(sortKeys(cur.get('d') || {})) === JSON.stringify(sortKeys(d))) return;
    t.set(db().doc(`rotaBlocks/${id}`), { staffId, year: Number(year), d, updatedAt: FieldValue.serverTimestamp() });
  });
  have.forEach((doc) => t.delete(doc.ref));
}
function sortKeys(o) {
  return Object.keys(o).sort().map((k) => [k, o[k].k, o[k].r || '', o[k].paid === undefined ? '' : !!o[k].paid]);
}
async function rebuild(staffId) {
  if (!staffId) return;
  await db().runTransaction((t) => rebuildInTx(t, staffId));
}

// Read the blocks covering a shift (inside a transaction when t is given).
async function readBlocks(t, staffId, date, end) {
  const years = [...new Set([date.slice(0, 4), end.slice(0, 4)])];
  const snaps = await Promise.all(years.map((y) => {
    const ref = db().doc(`rotaBlocks/${staffId}_${y}`);
    return t ? t.get(ref) : ref.get();
  }));
  const all = {};
  snaps.forEach((s) => { if (s.exists) Object.assign(all, s.get('d') || {}); });
  return all;
}
// null if staffId can work a shift on date from start to end; otherwise { date, entry }
async function conflictFor(t, staffId, date, start, end) {
  if (!staffId || !validYmd(date)) return null;
  const next = addDays(date, 1);
  const spill = spillsOver(start, end);
  const blocks = await readBlocks(t, staffId, date, spill ? next : date);
  if (blocks[date]) return { date, entry: blocks[date] };
  if (spill && blocks[next]) return { date: next, entry: blocks[next], spill: true };
  return null;
}
function conflictMessage(name, c) {
  const who = name || 'They';
  const day = prettyDate(c.date);
  const what = c.entry.k === 'holiday'
    ? `on approved holiday (${c.entry.paid === false ? 'unpaid' : 'paid'}) on ${day}`
    : `unavailable on ${day}${c.entry.r ? ` (${c.entry.r})` : ''}`;
  return `${who} ${c.spill ? 'can’t work past midnight: they are ' : 'is '}${what}. Pick someone else or leave it as an open shift.`;
}

// Swap approval etc.: move a shift to toStaffId only if they are free, atomically.
async function reassignShift(shiftRef, toStaffId, toName, byUid) {
  await db().runTransaction(async (t) => {
    const sh = await t.get(shiftRef);
    if (!sh.exists) throw new HttpsError('failed-precondition', 'That shift has been deleted, so there is nothing to swap.');
    if (toStaffId) {
      const c = await conflictFor(t, toStaffId, sh.get('date'), sh.get('start'), sh.get('end'));
      if (c) throw new HttpsError('failed-precondition', conflictMessage(toName, c));
    }
    t.update(shiftRef, {
      staffId: toStaffId || '', staffName: toStaffId ? toName : 'Open shift',
      updatedAt: FieldValue.serverTimestamp(), updatedBy: byUid,
    });
  });
}

// Approve a holiday request and index it in one transaction.
async function approveTimeOff(ref, upd) {
  await db().runTransaction(async (t) => {
    const cur = await t.get(ref);
    if (!cur.exists) throw new HttpsError('not-found', 'That request no longer exists.');
    if (cur.get('status') !== 'pending') throw new HttpsError('failed-precondition', 'That request has already been decided.');
    const after = { ...cur.data(), status: upd.status };
    await rebuildInTx(t, after.staffId, { timeOff: { [ref.id]: after } });
    t.update(ref, upd);
  });
}

// Drafts that clash with unavailability / approved holiday (for publishing, which must not put them out).
async function clashingIds(shiftDocs) {
  const cache = new Map();
  const out = new Set();
  for (const s of shiftDocs) {
    const staffId = s.get('staffId');
    if (!staffId) continue;
    const date = s.get('date');
    const spill = spillsOver(s.get('start'), s.get('end'));
    const days = spill ? [date, addDays(date, 1)] : [date];
    for (const d of days) {
      const key = `${staffId}_${d.slice(0, 4)}`;
      if (!cache.has(key)) {
        const snap = await db().doc(`rotaBlocks/${key}`).get();
        cache.set(key, snap.exists ? snap.get('d') || {} : {});
      }
      if (cache.get(key)[d]) { out.add(s.id); break; }
    }
  }
  return out;
}

function makeFunctions({ requireRole, callerRole, staffName }) {
  // Mark unavailable (the app uses this so the record and its enforcement appear together).
  const addUnavailability = onCall(async (req) => {
    requireRole(req, ['owner', 'manager', 'staff']);
    const d = req.data || {};
    const uid = req.auth.uid;
    const isManager = ['owner', 'manager'].includes(callerRole(req));
    const staffId = typeof d.staffId === 'string' && d.staffId.trim() ? d.staffId.trim().slice(0, 128) : uid;
    if (staffId !== uid && !isManager) throw new HttpsError('permission-denied', 'You can only mark yourself unavailable.');
    const from = String(d.from || '');
    const to = String(d.to || '');
    if (!validYmd(from) || !validYmd(to)) throw new HttpsError('invalid-argument', 'Pick valid dates.');
    if (to < from) throw new HttpsError('invalid-argument', 'The end date is before the start date.');
    const weekday = Number(d.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 7) throw new HttpsError('invalid-argument', 'Pick which days.');
    const reason = typeof d.reason === 'string' ? d.reason.trim().slice(0, 200) : '';
    if (!reason) throw new HttpsError('invalid-argument', 'Add a reason. Managers see it on the rota.');
    const person = await db().doc(`staff/${staffId}`).get();
    if ((!person.exists && staffId !== uid) || (person.exists && (person.get('active') === false || person.get('terminated')))) {
      throw new HttpsError('failed-precondition', 'That person is no longer on the team.');
    }
    const given = typeof d.staffName === 'string' ? d.staffName.trim() : '';
    const rec = {
      staffId, staffName: String((person.exists && person.get('name')) || given || '').slice(0, 80),
      from, to, weekday, reason, createdAt: FieldValue.serverTimestamp(), createdBy: uid,
    };
    const ref = db().collection('unavailability').doc();
    await db().runTransaction(async (t) => {
      await rebuildInTx(t, staffId, { unavailability: { [ref.id]: rec } });
      t.create(ref, rec);
    });
    // Shifts already on those days are left exactly as they are; managers are told how many clash.
    let clashes = 0;
    if (isManager) {
      const snap = await db().collection('shifts').where('staffId', '==', staffId).get();
      const want = desiredBlocks([rec], [], londonToday());
      const has = (day) => !!(want[day.slice(0, 4)] || {})[day];
      clashes = snap.docs.filter((s) => {
        const date = s.get('date');
        if (!date || date < addDays(from, -1) || date > to) return false;
        return has(date) || (spillsOver(s.get('start'), s.get('end')) && has(addDays(date, 1)));
      }).length;
    }
    return { id: ref.id, clashes };
  });

  const onUnavailabilityBlocks = onDocumentWritten('unavailability/{id}', async (event) => {
    const b = event.data.before.exists ? event.data.before.data() : null;
    const a = event.data.after.exists ? event.data.after.data() : null;
    const ids = new Set([b && b.staffId, a && a.staffId].filter(Boolean));
    for (const id of ids) await rebuild(id);
  });

  const onTimeOffBlocks = onDocumentWritten('timeOff/{id}', async (event) => {
    const b = event.data.before.exists ? event.data.before.data() : null;
    const a = event.data.after.exists ? event.data.after.data() : null;
    const was = b && b.status === 'approved';
    const is = a && a.status === 'approved';
    if (!was && !is) return; // pending / declined / cancelled never block
    if (was && is && b.from === a.from && b.to === a.to && b.paid === a.paid && b.staffId === a.staffId) return;
    const ids = new Set([b && b.staffId, a && a.staffId].filter(Boolean));
    for (const id of ids) await rebuild(id);
  });

  // Daily: keep long recurring unavailability indexed past the rolling horizon (and heal anything missed).
  const refreshRotaBlocks = onSchedule({ schedule: '20 0 * * *', timeZone: 'Europe/London' }, async () => {
    const ids = new Set();
    (await db().collection('unavailability').get()).docs.forEach((d) => ids.add(d.get('staffId')));
    (await db().collection('timeOff').where('status', '==', 'approved').get()).docs.forEach((d) => ids.add(d.get('staffId')));
    (await db().collection('rotaBlocks').get()).docs.forEach((d) => ids.add(d.get('staffId')));
    let n = 0;
    for (const id of ids) {
      if (!id) continue;
      try { await rebuild(id); n += 1; } catch (e) { logger.error('rotaBlocks rebuild failed', id, e.message); }
    }
    logger.info('rotaBlocks refreshed', n);
  });

  return { addUnavailability, onUnavailabilityBlocks, onTimeOffBlocks, refreshRotaBlocks };
}

module.exports = {
  makeFunctions, rebuild, rebuildInTx, desiredBlocks, conflictFor, conflictMessage, reassignShift,
  approveTimeOff, clashingIds, spillsOver, addDays,
};
