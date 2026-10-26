// Right to work documents (UK GDPR special care) and payslips.
// Files are checked by their real type, encrypted, stored outside any public folder and only
// streamed back through these routes after a role check. Every view of a right to work file is logged.
import express from 'express'
import multer from 'multer'
import crypto from 'node:crypto'
import { z } from 'zod'
import { q, one, tx } from '../db.js'
import { need, needDocs } from '../access.js'
import { h, parse, bad, notFound, forbidden, zDate, zId, zText, todayIn, addDays, audit, notify } from '../util.js'
import { storeEncrypted, readEncrypted, deleteStored, sniffType, safeFileName } from '../security.js'
import { sendFile } from './my.js'

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } })

// ---------- Right to work ----------
export const documents = express.Router({ mergeParams: true })
documents.use(needDocs)

documents.get('/', h(async (req, res) => {
  const today = todayIn(req.venue.timezone)
  const docs = await q(`SELECT d.id, d.membership_id, u.full_name, d.doc_type, d.check_date, d.check_method, d.expiry_date, d.file_name, d.size_bytes, d.created_at,
      p.leave_date, (p.leave_date + interval '2 years')::date AS delete_after
    FROM rtw_documents d JOIN memberships m ON m.id=d.membership_id JOIN users u ON u.id=m.user_id LEFT JOIN staff_profiles p ON p.membership_id=m.id
    WHERE d.venue_id=$1 AND d.deleted_at IS NULL AND d.replaced_by IS NULL ORDER BY u.full_name`, [req.venue.id])
  const missing = await q(`SELECT m.id, u.full_name FROM memberships m JOIN users u ON u.id=m.user_id
    WHERE m.venue_id=$1 AND m.is_active AND m.role <> 'owner' AND NOT EXISTS (SELECT 1 FROM rtw_documents d WHERE d.membership_id=m.id AND d.deleted_at IS NULL) ORDER BY u.full_name`, [req.venue.id])
  res.json({
    documents: docs,
    missing,
    expiring: docs.filter((d) => d.expiry_date && d.expiry_date <= addDays(today, 60)),
    due_for_deletion: docs.filter((d) => d.delete_after && d.delete_after < today),
  })
}))

documents.post('/', upload.single('file'), h(async (req, res) => {
  const b = parse(z.object({
    membership_id: zId, doc_type: zText(80).min(2), check_date: zDate,
    check_method: z.enum(['manual', 'online_share_code', 'idsp']),
    expiry_date: zDate.optional().or(z.literal('')).transform((x) => x || null),
    replaces_id: zId.optional().or(z.literal('')).transform((x) => x || null),
  }), req.body)
  if (!req.file) throw bad('Attach the scan or photo of the document check.')
  const mime = sniffType(req.file.buffer)
  if (!mime) throw bad('Only PDF, JPEG or PNG files.')
  const m = await one('SELECT id FROM memberships WHERE id=$1 AND venue_id=$2', [b.membership_id, req.venue.id])
  if (!m) throw bad('Pick someone on the team.')
  const fileKey = storeEncrypted(req.file.buffer)
  const id = await tx(async (db) => {
    const r = await db.one(`INSERT INTO rtw_documents(venue_id, membership_id, doc_type, check_date, check_method, expiry_date, file_key, file_name, mime, size_bytes, sha256, uploaded_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [req.venue.id, m.id, b.doc_type, b.check_date, b.check_method, b.expiry_date, fileKey, safeFileName(req.file.originalname), mime, req.file.size, crypto.createHash('sha256').update(req.file.buffer).digest('hex'), req.m.id])
    // Documents can't be edited, only replaced. The old one is kept as a record until retention ends.
    if (b.replaces_id) await db.q('UPDATE rtw_documents SET replaced_by=$2 WHERE id=$1 AND venue_id=$3 AND membership_id=$4', [b.replaces_id, r.id, req.venue.id, m.id])
    return r.id
  })
  await audit(req, 'rtw_uploaded', 'rtw_document', id, { membership_id: m.id })
  res.json({ id })
}))

documents.get('/:id/file', h(async (req, res) => {
  const d = await one('SELECT id, file_key, file_name, mime, membership_id FROM rtw_documents WHERE id=$1 AND venue_id=$2 AND deleted_at IS NULL', [parse(zId, req.params.id), req.venue.id])
  if (!d) throw notFound()
  await audit(req, 'rtw_viewed', 'rtw_document', d.id, { membership_id: d.membership_id })
  sendFile(res, readEncrypted(d.file_key), d.mime, d.file_name)
}))

documents.get('/log', h(async (req, res) => {
  res.json(await q(`SELECT a.action, a.target_id, a.created_at, u.full_name AS by_name, a.detail FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user_id
    WHERE a.venue_id=$1 AND a.action LIKE 'rtw_%' ORDER BY a.created_at DESC LIMIT 100`, [req.venue.id]))
}))

// Retention: copies are kept while someone works here and for 2 years after they leave, then deleted.
documents.post('/:id/delete-expired', h(async (req, res) => {
  const id = parse(zId, req.params.id)
  const d = await one(`SELECT d.id, d.file_key FROM rtw_documents d JOIN staff_profiles p ON p.membership_id=d.membership_id
      WHERE d.id=$1 AND d.venue_id=$2 AND d.deleted_at IS NULL AND p.leave_date IS NOT NULL AND (p.leave_date + interval '2 years')::date < $3`, [id, req.venue.id, todayIn(req.venue.timezone)])
  if (!d) throw bad('This document isn\'t due for deletion yet.')
  deleteStored(d.file_key)
  await q('UPDATE rtw_documents SET deleted_at=now() WHERE id=$1', [id])
  await audit(req, 'rtw_deleted_retention', 'rtw_document', id)
  res.json({ ok: true })
}))

// ---------- Payslips ----------
// Managers upload and release them. Only the owner can open someone else's payslip.
export const payslips = express.Router({ mergeParams: true })
payslips.use(need('manager'))

payslips.get('/', h(async (req, res) => {
  res.json(await q(`SELECT p.id, p.membership_id, u.full_name, p.period_label, p.status, p.file_name, p.released_at, p.viewed_at, p.created_at
    FROM payslips p JOIN memberships m ON m.id=p.membership_id JOIN users u ON u.id=m.user_id
    WHERE p.venue_id=$1 AND p.status <> 'withdrawn' ORDER BY p.created_at DESC LIMIT 200`, [req.venue.id]))
}))

payslips.post('/', upload.single('file'), h(async (req, res) => {
  const b = parse(z.object({ membership_id: zId, period_label: zText(60).min(2) }), req.body)
  if (!req.file) throw bad('Attach the payslip PDF.')
  if (sniffType(req.file.buffer) !== 'application/pdf') throw bad('Payslips must be PDF files.')
  const m = await one('SELECT id FROM memberships WHERE id=$1 AND venue_id=$2', [b.membership_id, req.venue.id])
  if (!m) throw bad('Pick someone on the team.')
  const fileKey = storeEncrypted(req.file.buffer)
  const r = await one(`INSERT INTO payslips(venue_id, membership_id, period_label, file_key, file_name, size_bytes, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [req.venue.id, m.id, b.period_label, fileKey, safeFileName(req.file.originalname), req.file.size, req.m.id])
  await audit(req, 'payslip_uploaded', 'payslip', r.id, { membership_id: m.id })
  res.json(r)
}))

payslips.post('/release', h(async (req, res) => {
  const { ids } = parse(z.object({ ids: z.array(zId).min(1).max(200) }), req.body)
  const rel = await tx(async (db) => {
    const rel = await db.q(`UPDATE payslips SET status='released', released_at=now() WHERE venue_id=$1 AND id = ANY($2) AND status='uploaded' RETURNING membership_id, period_label`, [req.venue.id, ids])
    for (const r of rel) await notify(db, req.venue.id, [r.membership_id], 'payslip', `Your payslip for ${r.period_label} is ready.`, '/me')
    return rel
  })
  await audit(req, 'payslips_released', null, null, { count: rel.length })
  res.json({ released: rel.length })
}))

payslips.post('/:id/withdraw', h(async (req, res) => {
  const p = await one(`UPDATE payslips SET status='withdrawn' WHERE id=$1 AND venue_id=$2 AND status='uploaded' RETURNING file_key`, [parse(zId, req.params.id), req.venue.id])
  if (!p) throw bad('Only a payslip that hasn\'t been released can be withdrawn.')
  deleteStored(p.file_key)
  res.json({ ok: true })
}))

payslips.get('/:id/file', h(async (req, res) => {
  if (req.m.role !== 'owner') throw forbidden('Only the owner can open other people\'s payslips.')
  const p = await one('SELECT id, file_key, file_name FROM payslips WHERE id=$1 AND venue_id=$2 AND status <> \'withdrawn\'', [parse(zId, req.params.id), req.venue.id])
  if (!p) throw notFound()
  await audit(req, 'payslip_viewed_by_owner', 'payslip', p.id)
  sendFile(res, readEncrypted(p.file_key), 'application/pdf', p.file_name)
}))
