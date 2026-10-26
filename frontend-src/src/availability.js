// Who can't be put on the rota when: approved holiday (paid or unpaid) and recorded unavailability.
// Mirrors functions/availability.js and firestore.rules, which enforce it for everyone (owner included);
// this copy only gives instant, specific feedback in the app.
// Unavailability is whole UK days: weekday 0 = every day from..to, 1..7 = only that weekday (Mon..Sun).
// Pending, declined and cancelled holiday requests never block.
import { addDays, pretty, weekdayIndex } from './util.js';

// a shift finishes after midnight (end <= start), unless it ends exactly at 00:00
export function spillsOver(start, end) {
  return !!(start && end && end <= start && end !== '00:00');
}

export function blockFor(staffId, date, timeOffDocs, unavDocs) {
  if (!staffId || !date) return null;
  const t = (timeOffDocs || []).find((x) => x.staffId === staffId && x.status === 'approved' && date >= x.from && date <= x.to);
  if (t) return { kind: 'holiday', label: `HOLIDAY (${t.paid === false ? 'UNPAID' : 'PAID'})`, paid: t.paid !== false };
  const wd = weekdayIndex(date) + 1;
  const u = (unavDocs || []).find((x) => x.staffId === staffId && date >= x.from && date <= x.to && (!x.weekday || Number(x.weekday) === wd));
  if (u) return { kind: 'unav', label: 'Unavailable', reason: u.reason || '' };
  return null;
}

// null if the person can work it; otherwise { date, block, spill }
export function clashFor(staffId, date, start, end, timeOffDocs, unavDocs) {
  if (!staffId || !date) return null;
  const b = blockFor(staffId, date, timeOffDocs, unavDocs);
  if (b) return { date, block: b, spill: false };
  if (spillsOver(start, end)) {
    const next = addDays(date, 1);
    const b2 = blockFor(staffId, next, timeOffDocs, unavDocs);
    if (b2) return { date: next, block: b2, spill: true };
  }
  return null;
}

export function clashText(name, c) {
  const who = name || 'They';
  const day = pretty(c.date, { weekday: 'long', day: 'numeric', month: 'long' });
  const what = c.block.kind === 'holiday'
    ? `on approved holiday (${c.block.paid === false ? 'unpaid' : 'paid'}) on ${day}`
    : `unavailable on ${day}${c.block.reason ? ` (${c.block.reason})` : ''}`;
  return c.spill
    ? `${who} can’t do this shift: it finishes after midnight and they are ${what}.`
    : `${who} can’t be put on the rota: they are ${what}.`;
}
