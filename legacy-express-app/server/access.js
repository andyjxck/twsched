// Venue access. Every venue route runs through loadVenue, which checks on the server that the
// signed-in user really belongs to that venue, and sets req.m (their membership there).
// Role checks then run on the server for every route: hiding a button in the app is never the guard.
import { one } from './db.js'
import { h, HttpError, forbidden } from './util.js'

export const loadVenue = h(async (req, res, next) => {
  if (!req.user) throw new HttpError(401, 'Please sign in.')
  const venueId = Number(req.params.venueId)
  if (!Number.isInteger(venueId) || venueId <= 0) throw forbidden()
  const m = await one(
    `SELECT m.id, m.role, m.can_view_documents, m.position, v.id AS venue_id, v.name AS venue_name, v.slug, v.timezone,
            v.leave_year_start_month, v.weekly_hours_limit, v.vat_rate, v.labour_on_ex_vat, v.positions, v.sales_column_map
       FROM memberships m JOIN venues v ON v.id = m.venue_id
      WHERE m.user_id = $1 AND m.venue_id = $2 AND m.is_active`, [req.user.id, venueId])
  if (!m) throw forbidden()
  req.m = { id: m.id, role: m.role, canDocs: m.role === 'owner' || (m.role === 'manager' && m.can_view_documents), position: m.position }
  req.venue = {
    id: m.venue_id, name: m.venue_name, slug: m.slug, timezone: m.timezone, leaveYearStartMonth: m.leave_year_start_month,
    weeklyHoursLimit: m.weekly_hours_limit, vatRate: m.vat_rate, labourOnExVat: m.labour_on_ex_vat, positions: m.positions,
    salesColumnMap: m.sales_column_map,
  }
  next()
})

const RANK = { staff: 0, supervisor: 1, manager: 2, owner: 3 }
export const isManager = (req) => RANK[req.m.role] >= RANK.manager
export const isLead = (req) => RANK[req.m.role] >= RANK.supervisor

export function need(minRole) {
  return (req, res, next) => (RANK[req.m?.role] >= RANK[minRole] ? next() : next(forbidden()))
}
export function needDocs(req, res, next) {
  return req.m?.canDocs ? next() : next(forbidden('Right to work documents are limited to managers with the documents permission.'))
}
