export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function ymd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}
export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
export function mondayOf(s) {
  const d = parseYmd(s);
  const dow = (d.getDay() + 6) % 7; // Mon=0
  d.setDate(d.getDate() - dow);
  return ymd(d);
}
export function weekdayIndex(s) {
  return (parseYmd(s).getDay() + 6) % 7;
}
export function pretty(s, opts) {
  if (!s) return '';
  return parseYmd(s).toLocaleDateString('en-GB', opts || { weekday: 'short', day: 'numeric', month: 'short' });
}
export function prettyLong(s) {
  return pretty(s, { weekday: 'long', day: 'numeric', month: 'long' });
}
export function hours(start, end) {
  if (!start || !end) return 0;
  const [a, b] = start.split(':').map(Number);
  const [c, d] = end.split(':').map(Number);
  let mins = c * 60 + d - (a * 60 + b);
  if (mins <= 0) mins += 24 * 60; // finishes after midnight
  return mins / 60;
}
export function fmtHours(h) {
  return `${Math.round(h * 100) / 100}h`;
}
export function tsDate(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  return new Date(ts);
}
export function ago(ts) {
  const d = tsDate(ts);
  if (!d) return '';
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
export function byName(a, b) {
  return (a.name || '').localeCompare(b.name || '');
}
export const AREAS = ['Bar', 'Floor', 'Kitchen', 'Reception', 'Housekeeping', 'Events', 'Management'];

// minutes between two HH:MM times, wrapping past midnight
function mins(start, end) {
  if (!start || !end) return 0;
  const [a, b] = start.split(':').map(Number);
  const [c, d] = end.split(':').map(Number);
  let m = c * 60 + d - (a * 60 + b);
  if (m <= 0) m += 24 * 60;
  return m;
}
// hours that count towards pay: shift length minus the break when the break is unpaid
export function paidHours(s) {
  const total = mins(s.start, s.end);
  const brk = s.breakStart && s.breakEnd ? mins(s.breakStart, s.breakEnd) : 0;
  const unpaid = s.breakPaid === false ? Math.min(brk, total) : 0;
  return (total - unpaid) / 60;
}
// length of the shift's break in minutes (0 when there is no break)
export function breakMinutes(s) {
  return s.breakStart && s.breakEnd ? mins(s.breakStart, s.breakEnd) : 0;
}
// HH:MM plus n minutes, wrapping past midnight
export function addMinutes(t, n) {
  const [h, m] = t.split(':').map(Number);
  const v = (((h * 60 + m + Number(n)) % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}
// a break of len minutes starting at bs fits wholly inside the shift (overnight shifts included)
export function breakFits(s, bs, len) {
  const total = mins(s.start, s.end);
  const [a, b] = s.start.split(':').map(Number);
  const [c, d] = bs.split(':').map(Number);
  const offset = (((c * 60 + d) - (a * 60 + b)) + 1440) % 1440;
  return offset + Number(len) <= total;
}
export function overnight(s) {
  return !!(s.start && s.end && s.end <= s.start);
}

// ---------- UK tax year: 6 April to 5 April; tax month n runs from the 6th to the 5th ----------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function taxPosition(dateStr = ymd()) {
  const [y, m, d] = dateStr.split('-').map(Number);
  let mm = m; let yy = y;
  if (d < 6) { mm -= 1; if (mm === 0) { mm = 12; yy -= 1; } }
  const taxYear = mm >= 4 ? yy : yy - 1; // year the tax year starts in
  const taxMonth = ((mm - 4 + 12) % 12) + 1;
  return { taxYear, taxMonth };
}
export function taxYearLabel(ty) {
  return `${ty}/${String((ty + 1) % 100).padStart(2, '0')}`;
}
// calendar month the tax month starts in, e.g. (2026, 7) -> 'Oct 2026'
export function taxMonthLabel(ty, tm) {
  const cal = ((tm + 2) % 12); // 0-based calendar month: tm1 -> Apr(3)
  const year = tm <= 9 ? ty : ty + 1;
  return `${MONTHS[cal]} ${year}`;
}
export function taxMonthRange(ty, tm) {
  const cal = (tm + 2) % 12;
  const year = tm <= 9 ? ty : ty + 1;
  const nextCal = (cal + 1) % 12;
  const nextYear = cal === 11 ? year + 1 : year;
  return `6 ${MONTHS[cal]} ${year} – 5 ${MONTHS[nextCal]} ${nextYear}`;
}
export function slotOf(ty, tm) {
  return `${ty}-${String(tm).padStart(2, '0')}`;
}
