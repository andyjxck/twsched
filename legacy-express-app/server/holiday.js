// Holiday calculator. Kept separate and pure so it can be unit tested and checked by an accountant.
// All figures are hours internally; the app shows hours and days.
//
// Rules (gov.uk, as of 2026):
//  - Regular hours: 5.6 weeks a year = days_per_week x 5.6 days, capped at 28 days.
//    In the first year of employment, leave builds up at one twelfth of the year's entitlement per month worked.
//    A starter or leaver part-way through the leave year gets a pro-rata share of the year.
//  - Irregular hours / part-year: 12.07% of hours actually worked, from finished pay periods
//    (here: weeks that have ended, since pay is weekly by default).
//  - Remaining = accrued + opening balance + carry-over + adjustments - taken - booked.
//    Pending requests are shown apart and not deducted.
import { addDays, daysBetween } from './util.js'

export const IRREGULAR_RATE = 0.1207
export const MAX_DAYS = 28

export function leaveYear(today, startMonth = 1) {
  const [y, m] = today.split('-').map(Number)
  const startYear = m >= startMonth ? y : y - 1
  const start = `${startYear}-${String(startMonth).padStart(2, '0')}-01`
  const nextStart = `${startYear + 1}-${String(startMonth).padStart(2, '0')}-01`
  return { start, end: addDays(nextStart, -1) }
}

// Whole months between two dates (a month counts once the same day-of-month is reached).
export function wholeMonths(from, to) {
  const [y1, m1, d1] = from.split('-').map(Number)
  const [y2, m2, d2] = to.split('-').map(Number)
  let months = (y2 - y1) * 12 + (m2 - m1)
  if (d2 < d1) months -= 1
  return Math.max(0, months)
}

export function regularEntitlementHours(profile) {
  const days = Math.min(Number(profile.days_per_week) * 5.6, MAX_DAYS)
  return days * Number(profile.hours_per_day)
}

/**
 * @param profile   { holiday_type, days_per_week, hours_per_day, start_date, leave_date }
 * @param ctx       { today, leaveYearStartMonth }
 * @param confirmedShifts  [{ shift_date, hours }] confirmed actual hours (irregular staff)
 * @param ledger    [{ kind, hours, note, entry_date }]
 * @param requests  [{ start_date, end_date, hours, status, kind }] holiday requests
 */
export function computeBalance(profile, ctx, confirmedShifts = [], ledger = [], requests = []) {
  const { today } = ctx
  const year = leaveYear(today, ctx.leaveYearStartMonth || 1)
  const lines = []
  let accrued = 0

  if (profile.holiday_type === 'irregular') {
    // Only hours from pay periods that have finished count; weekly pay periods end on Sunday.
    const dow = (new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7
    const currentPeriodStart = addDays(today, -dow)
    let hours = 0
    for (const s of confirmedShifts) {
      if (s.shift_date >= year.start && s.shift_date < currentPeriodStart) hours += Number(s.hours)
    }
    accrued = hours * IRREGULAR_RATE
    lines.push({ label: `12.07% of ${round1(hours)} confirmed hours worked this leave year (finished weeks only)`, hours: accrued })
  } else {
    const full = regularEntitlementHours(profile)
    const fullDays = Math.min(Number(profile.days_per_week) * 5.6, MAX_DAYS)
    // Portion of the leave year this person is employed.
    const from = profile.start_date && profile.start_date > year.start ? profile.start_date : year.start
    const to = profile.leave_date && profile.leave_date < year.end ? profile.leave_date : year.end
    const yearDays = daysBetween(year.start, year.end) + 1
    const share = Math.max(0, Math.min(1, (daysBetween(from, to) + 1) / yearDays))
    const firstYear = profile.start_date && daysBetween(profile.start_date, today) < 365
    if (firstYear) {
      // First year: one twelfth per whole month worked so far, never more than this year's share.
      const months = wholeMonths(profile.start_date, today) + 1 // leave builds at the start of each month
      accrued = Math.min(full * share, (full * months) / 12)
      lines.push({ label: `First year: ${Math.min(12, months)}/12 of ${round1(fullDays)} days (${round1(full)} h), limited to the part of the year employed`, hours: accrued })
    } else {
      accrued = full * share
      lines.push({ label: share < 1 ? `${round1(fullDays)} days a year, pro rata for ${Math.round(share * 100)}% of the leave year` : `${round1(fullDays)} days a year (5.6 weeks x ${profile.days_per_week} days, max 28)`, hours: accrued })
    }
  }

  let ledgerTotal = 0
  for (const e of ledger) {
    ledgerTotal += Number(e.hours)
    lines.push({ label: `${labelKind(e.kind)}: ${e.note} (${e.entry_date})`, hours: Number(e.hours) })
  }

  let taken = 0, booked = 0, pending = 0
  for (const r of requests) {
    if (r.kind && r.kind !== 'holiday') continue
    if (r.end_date < year.start || r.start_date > year.end) continue
    const days = daysBetween(r.start_date, r.end_date) + 1
    const perDay = Number(r.hours) / days
    if (r.status === 'pending') { pending += Number(r.hours); continue }
    if (r.status !== 'approved' && r.status !== 'cancel_pending') continue
    let past = 0
    for (let i = 0; i < days; i++) if (addDays(r.start_date, i) < today) past++
    taken += perDay * past
    booked += perDay * (days - past)
    lines.push({ label: `Holiday ${r.start_date}${r.end_date !== r.start_date ? ' to ' + r.end_date : ''}`, hours: -Number(r.hours) })
  }

  const remaining = accrued + ledgerTotal - taken - booked
  const hpd = Number(profile.hours_per_day) || 8
  return {
    leave_year: year,
    holiday_type: profile.holiday_type,
    hours_per_day: hpd,
    accrued, adjustments: ledgerTotal, taken, booked, pending, remaining,
    days: { accrued: accrued / hpd, adjustments: ledgerTotal / hpd, taken: taken / hpd, booked: booked / hpd, pending: pending / hpd, remaining: remaining / hpd },
    lines,
  }
}

// gov.uk notice rule: a worker gives twice the length of the leave, plus a day.
export function noticeWarning(today, start, end) {
  const len = daysBetween(start, end) + 1
  const need = len * 2 + 1
  const have = daysBetween(today, start)
  return have < need ? `Short notice: the usual rule is ${need} days' notice for ${len} day${len > 1 ? 's' : ''} off, and this is ${Math.max(0, have)} days away.` : null
}

const round1 = (n) => Math.round(n * 10) / 10
const labelKind = (k) => ({ opening: 'Opening balance', carry_over: 'Carried over', adjustment: 'Adjustment' }[k] || k)
