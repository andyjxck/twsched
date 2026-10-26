// Publishing the rota: staff hear about their shifts once per publish, never per shift write.
//
// Andy, 26 Oct: "Make it so the emails don't email staff with EVERY shift added" and "add a 'publish rota'
// button instead that publishes the WHOLE rota at once".
//
// How it works
// - Shift writes never email or notify anyone. onShiftWritten only keeps weeks/{week}.pending up to date:
//   pending.{uid} = true while what that person can see for the week differs from what they were last sent.
// - publishWeek / approveWeek publish the week's drafts and then, in one transaction, compare each person's
//   published shifts with rotaSent/{week}_{uid} (the list they were last sent). Everyone whose shifts differ
//   gets ONE notification and ONE email listing their shifts for that week (and any that were taken off).
//   The snapshot is then updated and pending cleared, so pressing publish again, approving after publishing,
//   or two people pressing at once never sends the same thing twice.
// - Only shifts from today on count as a change, so fixing past shifts for payroll tells nobody.
// - rotaSent is server-only (no client rule matches it, so Firestore denies all client access).

const { FieldValue, FieldPath } = require('firebase-admin/firestore');
const admin = require('firebase-admin');

const db = () => admin.firestore();
const SNAP_VERSION = 1;

function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function mondayOf(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}
function londonToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
}
function dayLabel(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
function sentId(week, uid) {
  return `${week}_${uid}`.replace(/\//g, '_');
}

// The parts of a shift a person cares about. Everything else (notes, who saved it) is ignored.
function norm(id, s) {
  return {
    id,
    date: s.date || '',
    start: s.start || '',
    end: s.end || '',
    breakStart: s.breakStart || '',
    breakEnd: s.breakEnd || '',
    breakPaid: s.breakPaid !== false,
    area: s.area || '',
  };
}
function sortShifts(list) {
  return [...list].sort((a, b) => (a.date + a.start + a.id).localeCompare(b.date + b.start + b.id));
}
function sameShift(a, b) {
  return a.date === b.date && a.start === b.start && a.end === b.end && a.breakStart === b.breakStart
    && a.breakEnd === b.breakEnd && a.breakPaid === b.breakPaid && a.area === b.area;
}
// Shifts from today on, compared as content (ids ignored only when sorting).
function upcoming(list, today) {
  return sortShifts((list || []).filter((s) => s.date >= today));
}
function differs(current, sent, today) {
  const a = upcoming(current, today);
  const b = upcoming(sent, today);
  if (a.length !== b.length) return true;
  const byId = new Map(b.map((s) => [s.id, s]));
  for (const s of a) {
    const o = byId.get(s.id);
    if (!o || !sameShift(s, o)) return true;
  }
  return false;
}

function timesText(s) {
  const overnight = s.end && s.start && s.end <= s.start;
  let t = `${s.start} to ${s.end}${overnight ? ' (finishes the next day)' : ''}`;
  if (s.breakStart && s.breakEnd) t += `, break ${s.breakStart} to ${s.breakEnd} (${s.breakPaid ? 'paid' : 'unpaid'})`;
  else t += ', no break';
  if (s.area) t += `, ${s.area}`;
  return t;
}
function shortText(s) {
  return `${dayLabel(s.date)} ${s.start}-${s.end}`;
}

// Builds the one email and one bell notification for a person.
function buildMessage({ weekStart, name, current, sent, hadSnapshot, today }) {
  const now = upcoming(current, today);
  const before = upcoming(sent, today);
  const beforeById = new Map(before.map((s) => [s.id, s]));
  const nowIds = new Set(now.map((s) => s.id));
  const removed = before.filter((s) => !nowIds.has(s.id));
  const kind = hadSnapshot ? 'changed' : 'new';
  const wk = dayLabel(weekStart);
  const first = String(name || '').trim().split(/\s+/)[0] || 'there';
  const lines = now.map((s) => {
    let line = `${dayLabel(s.date)}: ${timesText(s)}`;
    if (kind === 'changed') {
      const o = beforeById.get(s.id);
      if (!o) line += ' (new)';
      else if (!sameShift(s, o)) line += ` (changed, was ${o.date !== s.date ? `${dayLabel(o.date)} ` : ''}${o.start} to ${o.end})`;
    }
    return line;
  });
  let subject;
  let title;
  let intro;
  if (kind === 'new') {
    subject = `Your shifts for the week of ${wk}`;
    title = `Rota for week of ${wk} is out`;
    intro = `The rota for the week of ${wk} is out. Your shifts:`;
  } else {
    subject = `Your shifts have changed: week of ${wk}`;
    title = `Your shifts for week of ${wk} have changed`;
    intro = now.length
      ? `Your shifts for the week of ${wk} have changed. This is your rota for that week now:`
      : `Your shifts for the week of ${wk} have changed. You're no longer on the rota that week.`;
  }
  let text = `Hi ${first},\n\n${intro}\n`;
  if (lines.length) text += `\n${lines.join('\n')}\n`;
  if (removed.length) text += `\nTaken off:\n${removed.map((s) => `${dayLabel(s.date)}: ${s.start} to ${s.end}`).join('\n')}\n`;
  let body;
  if (kind === 'new') {
    body = `Your shift${now.length === 1 ? '' : 's'}: ${now.map(shortText).join(', ')}.`;
  } else {
    body = now.length ? `Now: ${now.map(shortText).join(', ')}.` : 'You\'re no longer on the rota that week.';
    if (removed.length) body += ` Taken off: ${removed.map(shortText).join(', ')}.`;
  }
  return { kind, subject, title, body, text: text.trimEnd(), shifts: now.length, removed: removed.length };
}

// One transaction: compare everyone's published shifts in the week with what they were last sent,
// update the snapshots and clear pending. Returns the messages to send (sent after the transaction).
// `justPublished` = ids of drafts this call published (used only for weeks published before snapshots existed).
async function settleWeek({ weekStart, weekPatch, justPublished }) {
  const weekEnd = addDays(weekStart, 6);
  const today = londonToday();
  const fresh = new Set(justPublished || []);
  return db().runTransaction(async (t) => {
    const wkRef = db().doc(`weeks/${weekStart}`);
    const wk = await t.get(wkRef);
    const shifts = await t.get(db().collection('shifts').where('date', '>=', weekStart).where('date', '<=', weekEnd));
    const sentDocs = await t.get(db().collection('rotaSent').where('week', '==', weekStart));
    const status = wk.exists ? wk.get('status') || '' : '';
    const legacy = (status === 'published' || status === 'approved') && wk.exists && wk.get('snapV') !== SNAP_VERSION;

    const current = {};
    const names = {};
    for (const d of shifts.docs) {
      const s = d.data();
      if (s.published !== true || !s.staffId) continue;
      (current[s.staffId] = current[s.staffId] || []).push(norm(d.id, s));
      if (s.staffName) names[s.staffId] = s.staffName;
    }
    const sent = {};
    for (const d of sentDocs.docs) {
      // A baseline guessed for a week published before this system can't know about drafts this press
      // published, so those are always treated as new to the person. Real snapshots are exact.
      const list = d.get('shifts') || [];
      sent[d.get('uid')] = d.get('legacy') === true ? list.filter((s) => !fresh.has(s.id)) : list;
    }

    const messages = [];
    const people = new Set([...Object.keys(current), ...Object.keys(sent)]);
    for (const uid of people) {
      const cur = current[uid] || [];
      let had = Object.prototype.hasOwnProperty.call(sent, uid);
      let base = sent[uid] || [];
      if (!had && legacy) {
        // Week published before this system: they already knew about what was published before this press.
        base = cur.filter((s) => !fresh.has(s.id));
        had = base.length > 0;
      }
      if (differs(cur, base, today)) {
        messages.push({ uid, ...buildMessage({ weekStart, name: names[uid], current: cur, sent: base, hadSnapshot: had, today }) });
      }
      if (cur.length || had) {
        t.set(db().doc(`rotaSent/${sentId(weekStart, uid)}`), {
          week: weekStart, uid, shifts: sortShifts(cur), updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
    t.set(wkRef, { ...weekPatch, weekStart, snapV: SNAP_VERSION, pending: FieldValue.delete() }, { merge: true });
    return messages;
  });
}

// Called by onShiftWritten for each (week, person) a shift write touched. Sends nothing.
async function refreshPending({ weekStart, uid, shiftId, before, after }) {
  if (!uid || !weekStart) return;
  const today = londonToday();
  const weekEnd = addDays(weekStart, 6);
  if (weekEnd < today) return; // past weeks never need publishing again
  await db().runTransaction(async (t) => {
    const wkRef = db().doc(`weeks/${weekStart}`);
    const sentRef = db().doc(`rotaSent/${sentId(weekStart, uid)}`);
    const wk = await t.get(wkRef);
    const sentDoc = await t.get(sentRef);
    const shifts = await t.get(db().collection('shifts').where('date', '>=', weekStart).where('date', '<=', weekEnd));
    const mine = shifts.docs.filter((d) => d.get('published') === true && d.get('staffId') === uid);
    const cur = mine.map((d) => norm(d.id, d.data()));
    const status = wk.exists ? wk.get('status') || '' : '';
    let base = [];
    let writeBase = false;
    if (sentDoc.exists) {
      base = sentDoc.get('shifts') || [];
    } else if ((status === 'published' || status === 'approved') && wk.get('snapV') !== SNAP_VERSION) {
      // Week published before this system: what they knew = the week as it was just before this write.
      // Shifts saved in the same write as this one (or after it) were not known either.
      const at = after && after.updatedAt && after.updatedAt.toMillis ? after.updatedAt.toMillis() : Infinity;
      base = mine.filter((d) => d.id !== shiftId && !(d.get('updatedAt') && d.get('updatedAt').toMillis && d.get('updatedAt').toMillis() >= at))
        .map((d) => norm(d.id, d.data()));
      if (before && before.published === true && before.staffId === uid && mondayOf(before.date || '') === weekStart) {
        base.push(norm(shiftId, before));
      }
      writeBase = true;
    }
    const pend = differs(cur, base, today);
    const has = !!(wk.exists && (wk.get('pending') || {})[uid]);
    if (writeBase) t.set(sentRef, { week: weekStart, uid, shifts: sortShifts(base), legacy: true, updatedAt: FieldValue.serverTimestamp() });
    if (pend === has) return;
    if (wk.exists) t.update(wkRef, new FieldPath('pending', uid), pend ? true : FieldValue.delete());
    else t.set(wkRef, { weekStart, pending: { [uid]: true } }, { merge: true });
  });
}

// (week, uid) pairs a shift write touches.
function touched(before, after) {
  const out = new Map();
  for (const s of [before, after]) {
    if (s && s.staffId && /^\d{4}-\d{2}-\d{2}$/.test(s.date || '')) {
      const w = mondayOf(s.date);
      out.set(`${w}|${s.staffId}`, { weekStart: w, uid: s.staffId });
    }
  }
  return [...out.values()];
}

module.exports = { settleWeek, refreshPending, touched, buildMessage, differs, norm, SNAP_VERSION };
