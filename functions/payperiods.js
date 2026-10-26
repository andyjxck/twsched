/* Pay periods for the White Swan staff hub (shared by the payroll screens and Cloud Functions).
 *
 * Settings (Firestore payroll/settings):
 *   anchor          YYYY-MM-DD  first day of any one pay period (all others are counted from it)
 *   frequency       'weekly' | 'fortnightly' | 'fourweekly' | 'monthly'
 *   cutoffOffset    days after the period's last day when final hours are due (0 = the last day itself)
 *   payDateOffset   days after the period's last day when staff are paid
 *   reminderDays    how many days before cut-off payroll users get a reminder
 * Monthly periods run from the anchor's day of the month to the day before it next month
 * (e.g. anchor 2026-04-06: 6 Apr - 5 May). Days past the 28th are clamped to the month's last day.
 * Plain CommonJS on purpose: the browser bundle and Cloud Functions both use this file.
 */
const FREQUENCIES = {
  weekly: { label: 'Weekly', days: 7 },
  fortnightly: { label: 'Fortnightly', days: 14 },
  fourweekly: { label: 'Every four weeks', days: 28 },
  monthly: { label: 'Monthly', days: 0 },
};
const DEFAULT_SETTINGS = {
  anchor: '2026-04-06', frequency: 'monthly', cutoffOffset: 0, payDateOffset: 5, reminderDays: 2,
  holidayYearStart: '04-01', overtimeMultiplier: 1, accrualRate: 12.07,
};

function toDate(ymd) { return new Date(`${ymd}T12:00:00Z`); }
function ymdOf(d) { return d.toISOString().slice(0, 10); }
function addDays(ymd, n) { const d = toDate(ymd); d.setUTCDate(d.getUTCDate() + n); return ymdOf(d); }
function daysBetween(a, b) { return Math.round((toDate(b) - toDate(a)) / 86400000); }
function daysInMonth(y, m0) { return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate(); }
// the anchor's day of the month, in month (y, m0), clamped to the month's length
function monthStart(y, m0, day) {
  const yy = y + Math.floor(m0 / 12);
  const mm = ((m0 % 12) + 12) % 12;
  return ymdOf(new Date(Date.UTC(yy, mm, Math.min(day, daysInMonth(yy, mm)), 12)));
}
function withDefaults(s) {
  const out = { ...DEFAULT_SETTINGS, ...(s || {}) };
  if (!FREQUENCIES[out.frequency]) out.frequency = DEFAULT_SETTINGS.frequency;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.anchor || '')) out.anchor = DEFAULT_SETTINGS.anchor;
  return out;
}
// The pay period (start, end, cutoff, payDate, label) that contains the date ymd.
function periodContaining(settings, ymd) {
  const s = withDefaults(settings);
  let start;
  let end;
  if (s.frequency === 'monthly') {
    const day = Number(s.anchor.slice(8, 10));
    const d = toDate(ymd);
    let y = d.getUTCFullYear();
    let m0 = d.getUTCMonth();
    start = monthStart(y, m0, day);
    if (start > ymd) { m0 -= 1; start = monthStart(y, m0, day); }
    end = addDays(monthStart(y, m0 + 1, day), -1);
  } else {
    const len = FREQUENCIES[s.frequency].days;
    const k = Math.floor(daysBetween(s.anchor, ymd) / len);
    start = addDays(s.anchor, k * len);
    end = addDays(start, len - 1);
  }
  return describe(s, start, end);
}
function describe(s, start, end) {
  const cutoff = addDays(end, Number(s.cutoffOffset) || 0);
  const payDate = addDays(end, Number(s.payDateOffset) || 0);
  const reminder = addDays(cutoff, -(Number(s.reminderDays) || 0));
  return { id: start, start, end, cutoff, payDate, reminder, days: daysBetween(start, end) + 1 };
}
function nextPeriod(settings, p) { return periodContaining(settings, addDays(p.end, 1)); }
function prevPeriod(settings, p) { return periodContaining(settings, addDays(p.start, -1)); }
// count periods back from (and including) the one containing ymd, newest first
function recentPeriods(settings, ymd, count) {
  const out = [];
  let p = periodContaining(settings, ymd);
  for (let i = 0; i < count; i++) { out.push(p); p = prevPeriod(settings, p); }
  return out;
}
// The period whose cut-off is the next one on or after today (the period payroll is working towards).
function upcomingCutoff(settings, today) {
  let p = periodContaining(settings, today);
  const prev = prevPeriod(settings, p);
  if (prev.cutoff >= today) return prev;
  while (p.cutoff < today) p = nextPeriod(settings, p);
  return p;
}
// Holiday year containing ymd, from holidayYearStart 'MM-DD'
function holidayYear(settings, ymd) {
  const s = withDefaults(settings);
  const md = /^\d{2}-\d{2}$/.test(s.holidayYearStart || '') ? s.holidayYearStart : '04-01';
  let y = Number(ymd.slice(0, 4));
  let start = `${y}-${md}`;
  if (start > ymd) { y -= 1; start = `${y}-${md}`; }
  const end = addDays(`${y + 1}-${md}`, -1);
  return { start, end };
}

module.exports = {
  FREQUENCIES, DEFAULT_SETTINGS, withDefaults, periodContaining, nextPeriod, prevPeriod, recentPeriods,
  upcomingCutoff, holidayYear, addDays, daysBetween,
};
