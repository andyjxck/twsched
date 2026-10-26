/* Staff documents: Right to Work files and payslip file hygiene.
 *
 * Right to Work (RTW)
 *   File:      Storage rtw/{staffId}/{docId}.{pdf|jpg|png|webp|heic}   (private, no public URL)
 *   Metadata:  Firestore staffDocs/{docId}  { staffId, kind: 'rtw', docType, fileName, contentType, size,
 *              storagePath, uploadedAt, uploadedBy, uploadedByName,
 *              checkId, route, slot, checkedOn, declared }  + server-set checked/checkedAt
 *   Checks (Andy, 26 Oct): the owner records one right to work check at a time. A check is one or two files
 *   that share a checkId: route 'passport' (British/Irish passport or Irish passport card on its own),
 *   'birth_ni' (birth or adoption certificate + official proof of NI number), 'naturalisation_ni'
 *   (naturalisation/registration certificate + NI proof), 'share_code' (the GOV.UK online check result)
 *   or 'other' (one document, optionally a second). checkedOn is the date the owner says they did the
 *   check; declared is their statement that they checked the originals (or did the online check) themselves.
 *   The app stores the copies and that record. It does not check documents itself.
 *   rtwStatus.ok is true once one complete check (every required file stored and verified) is on file.
 *   Files from before 26 Oct have no checkId and still count one each.
 *   Status:    Firestore rtwStatus/{staffId}  { ok, count, updatedAt }  written ONLY here.
 *              firestore.rules reads it on every shift write that puts someone on a shift, so nobody can be
 *              assigned until a checked RTW document is on file (Andy, 20 Oct).
 *   Who:       owner - upload, view, download, remove anyone's (incl. their own)
 *              manager, payroll, staff - nothing (managers only see the tick, rtwStatus)
 *   Enforced in firestore.rules + storage.rules; this module re-checks every upload server-side:
 *   the file must exist, match the metadata (size, type), start with the right magic bytes for its type,
 *   and its persistent download token is removed so no permanent link to it exists. A file that fails
 *   is deleted together with its metadata and never counts towards the tick.
 *
 * Payslips (existing feature): the same token stripping and PDF check runs on every new payslip.
 */
const { onDocumentWritten, onDocumentCreated } = require('firebase-functions/v2/firestore');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const db = () => admin.firestore();
const bucket = () => admin.storage().bucket();

const MAX_BYTES = 10 * 1024 * 1024;
const RTW_TYPES = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

// Which document types each kind of check takes, file by file. The second file of 'other' is optional.
const ALL_DOC_TYPES = ['passport', 'passport_card', 'birth_certificate', 'naturalisation_certificate', 'ni_evidence',
  'share_code', 'brp', 'visa', 'other'];
const RTW_ROUTES = {
  passport: { slots: [['passport', 'passport_card']], required: 1 },
  birth_ni: { slots: [['birth_certificate'], ['ni_evidence']], required: 2 },
  naturalisation_ni: { slots: [['naturalisation_certificate'], ['ni_evidence']], required: 2 },
  share_code: { slots: [['share_code']], required: 1 },
  other: { slots: [ALL_DOC_TYPES, ALL_DOC_TYPES], required: 1 },
};

function londonToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// The check details on a new upload. Returns '' if they make sense, or the reason they don't.
function checkShapeReason(d) {
  if (typeof d.checkId !== 'string' || !/^[A-Za-z0-9]{20}$/.test(d.checkId)) return 'missing check';
  const route = RTW_ROUTES[d.route];
  if (!route) return 'unknown kind of check';
  if (!Number.isInteger(d.slot) || d.slot < 1 || d.slot > route.slots.length) return 'bad file number';
  if (!route.slots[d.slot - 1].includes(d.docType)) return 'document type does not fit the check';
  if (d.declared !== true) return 'check not confirmed';
  const on = d.checkedOn;
  if (typeof on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(on)) return 'bad check date';
  const dt = new Date(`${on}T12:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== on) return 'bad check date';
  if (on < '2000-01-01' || on > londonToday()) return 'check date in the future';
  return '';
}

// The other files of the same check must be for the same person, route and date, and not the same file number.
async function siblingReason(docId, d) {
  const snap = await db().collection('staffDocs').where('checkId', '==', d.checkId).get();
  const mine = d.uploadedAt && d.uploadedAt.toMillis ? d.uploadedAt.toMillis() : 0;
  for (const s of snap.docs) {
    if (s.id === docId) continue;
    const o = s.data();
    if (o.staffId !== d.staffId || o.route !== d.route || o.checkedOn !== d.checkedOn) return 'does not match the rest of the check';
    if (o.slot === d.slot) {
      const theirs = o.uploadedAt && o.uploadedAt.toMillis ? o.uploadedAt.toMillis() : 0;
      if (theirs < mine || (theirs === mine && s.id < docId)) return 'that file of the check is already uploaded';
    }
  }
  return '';
}

// First bytes of each allowed type. Anything else (HTML, scripts, executables renamed) is refused.
function magicOk(contentType, b) {
  if (!b || b.length < 4) return false;
  const hex = b.subarray(0, 12).toString('hex');
  const ascii = b.subarray(0, 12).toString('latin1');
  switch (contentType) {
    case 'application/pdf': return ascii.startsWith('%PDF-');
    case 'image/jpeg': return hex.startsWith('ffd8ff');
    case 'image/png': return hex.startsWith('89504e470d0a1a0a');
    case 'image/webp': return ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP';
    case 'image/heic': return ascii.slice(4, 8) === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(ascii.slice(8, 12));
    default: return false;
  }
}

// Checks the stored object against what the metadata claims, then removes its download token.
// Returns '' if fine, or the reason it was refused.
async function checkAndLockFile(path, expect) {
  const file = bucket().file(path);
  let meta;
  try {
    [meta] = await file.getMetadata();
  } catch (e) {
    return 'file missing';
  }
  const size = Number(meta.size);
  if (!(size > 0) || size > MAX_BYTES) return 'bad size';
  if (expect.size != null && size !== Number(expect.size)) return 'size does not match';
  if (meta.contentType !== expect.contentType) return 'type does not match';
  let head;
  try {
    [head] = await file.download({ start: 0, end: 15 });
  } catch (e) {
    return 'unreadable';
  }
  if (!magicOk(expect.contentType, head)) return 'content is not a real ' + expect.contentType;
  // No permanent download link: drop the Firebase download token. Files are then only readable through
  // the security rules (signed-in owner / the payslip's own staff member), never by URL alone.
  await file.setMetadata({
    contentDisposition: 'attachment',
    cacheControl: 'private, no-store',
    metadata: { firebaseStorageDownloadTokens: null },
  });
  // Cloud Storage deletes a key set to null. If a token is somehow still there (the local emulator keeps
  // it), replace it with a random value nobody was ever given, so any link issued at upload stops working.
  const [after] = await file.getMetadata();
  if (after.metadata && after.metadata.firebaseStorageDownloadTokens) {
    await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: require('crypto').randomBytes(24).toString('hex') } });
  }
  return '';
}

async function deleteFile(path) {
  if (!path) return;
  await bucket().file(path).delete().catch((e) => {
    if (e.code !== 404) logger.warn('could not delete file', { path, err: e.message });
  });
}

// Complete checks for one person: every required file stored and verified. Pure, so it can be tested alone.
function summariseRtw(docs) {
  let legacy = 0;
  const groups = new Map();
  for (const d of docs) {
    if (d.kind !== 'rtw') continue;
    if (!d.checkId) { if (d.checked === true) legacy += 1; continue; }
    if (!groups.has(d.checkId)) groups.set(d.checkId, []);
    groups.get(d.checkId).push(d);
  }
  let complete = 0;
  let lastCheckedOn = '';
  for (const g of groups.values()) {
    const route = RTW_ROUTES[g[0].route];
    if (!route) continue;
    let ok = true;
    for (let slot = 1; slot <= route.required; slot += 1) {
      if (!g.some((d) => d.slot === slot && d.checked === true && route.slots[slot - 1].includes(d.docType))) ok = false;
    }
    if (ok) {
      complete += 1;
      if (g[0].checkedOn && g[0].checkedOn > lastCheckedOn) lastCheckedOn = g[0].checkedOn;
    }
  }
  const files = docs.filter((d) => d.kind === 'rtw').length;
  return { count: complete + legacy, files, incomplete: groups.size - complete, lastCheckedOn };
}

async function recountRtw(staffId) {
  if (!staffId) return;
  const snap = await db().collection('staffDocs').where('staffId', '==', staffId).where('kind', '==', 'rtw').get();
  const s = summariseRtw(snap.docs.map((d) => d.data()));
  await db().doc(`rtwStatus/${staffId}`).set({
    staffId, ok: s.count > 0, count: s.count, files: s.files, incomplete: s.incomplete,
    lastCheckedOn: s.lastCheckedOn, updatedAt: FieldValue.serverTimestamp(),
  });
}

const onStaffDocWritten = onDocumentWritten({ document: 'staffDocs/{docId}', region: 'europe-west2', timeoutSeconds: 60 }, async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  if (after && !before) {
    // new upload: verify before it can count
    const ext = RTW_TYPES[after.contentType];
    const expectedPath = ext ? `rtw/${after.staffId}/${event.params.docId}.${ext}` : '';
    let reason = '';
    if (after.kind !== 'rtw') reason = 'unknown kind';
    else if (!ext) reason = 'type not allowed';
    else if (after.storagePath !== expectedPath) reason = 'path does not match';
    else reason = checkShapeReason(after) || await siblingReason(event.params.docId, after)
      || await checkAndLockFile(after.storagePath, { size: after.size, contentType: after.contentType });
    if (reason) {
      logger.warn('RTW upload refused', { staffId: after.staffId, docId: event.params.docId, reason });
      if (expectedPath && after.storagePath === expectedPath) await deleteFile(after.storagePath);
      await event.data.after.ref.delete();
      await recountRtw(after.staffId);
      return;
    }
    await event.data.after.ref.update({ checked: true, checkedAt: FieldValue.serverTimestamp() });
    logger.info('RTW document stored', { staffId: after.staffId, by: after.uploadedBy, docType: after.docType, route: after.route, slot: after.slot });
    await recountRtw(after.staffId);
    return;
  }
  if (before && !after) {
    // removed by the owner: make sure the file goes too
    if (before.storagePath && before.storagePath.startsWith(`rtw/${before.staffId}/`)) await deleteFile(before.storagePath);
    logger.info('RTW document removed', { staffId: before.staffId, docId: event.params.docId });
    await recountRtw(before.staffId);
    return;
  }
  if (before && after && before.checked !== after.checked) await recountRtw(after.staffId);
});

// Payslips: same check (real PDF, matches metadata) and no permanent download link.
const onPayslipStored = onDocumentCreated({ document: 'payslips/{id}', region: 'europe-west2', timeoutSeconds: 60 }, async (event) => {
  const p = event.data.data();
  if (!p || !p.storagePath || !String(p.storagePath).startsWith(`payslips/${p.staffId}/`)) return;
  const reason = await checkAndLockFile(p.storagePath, { size: p.size, contentType: 'application/pdf' });
  if (reason) {
    logger.warn('payslip file refused', { staffId: p.staffId, id: event.params.id, reason });
    await deleteFile(p.storagePath);
    await event.data.ref.delete();
    return;
  }
  await event.data.ref.update({ checked: true }).catch(() => {});
});

// Shifts (or drafts) for people with no checked RTW document. Publishing / approving leaves them as drafts.
async function missingRtwIds(shiftDocs) {
  const ids = [...new Set(shiftDocs.map((s) => s.get('staffId')).filter(Boolean))];
  const ok = new Set();
  await Promise.all(ids.map(async (id) => {
    const s = await db().doc(`rtwStatus/${id}`).get();
    if (s.exists && s.get('ok') === true) ok.add(id);
  }));
  return new Set(shiftDocs.filter((s) => s.get('staffId') && !ok.has(s.get('staffId'))).map((s) => s.id));
}

async function hasRtw(staffId) {
  const s = await db().doc(`rtwStatus/${staffId}`).get();
  return s.exists && s.get('ok') === true;
}

module.exports = { onStaffDocWritten, onPayslipStored, missingRtwIds, hasRtw, magicOk, RTW_TYPES, RTW_ROUTES, ALL_DOC_TYPES, checkShapeReason, summariseRtw };
