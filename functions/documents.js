/* Staff documents: Right to Work files and payslip file hygiene.
 *
 * Right to Work (RTW)
 *   File:      Storage rtw/{staffId}/{docId}.{pdf|jpg|png|webp|heic}   (private, no public URL)
 *   Metadata:  Firestore staffDocs/{docId}  { staffId, kind: 'rtw', docType, fileName, contentType, size,
 *              storagePath, uploadedAt, uploadedBy, uploadedByName }  + server-set checked/checkedAt
 *   Status:    Firestore rtwStatus/{staffId}  { ok, count, updatedAt }  written ONLY here.
 *              firestore.rules reads it on every shift write that puts someone on a shift, so nobody can be
 *              assigned until a checked RTW document is on file (Andy, 20 Oct).
 *   Who:       owner - upload, view, download, remove anyone's (incl. their own)
 *              manager - upload only (write-only) for people with the staff role, never their own,
 *                        never view/download/remove; they see only the tick (rtwStatus)
 *              staff - nothing (not even their own files)
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

async function recountRtw(staffId) {
  if (!staffId) return;
  const snap = await db().collection('staffDocs').where('staffId', '==', staffId).where('kind', '==', 'rtw').get();
  const count = snap.docs.filter((d) => d.get('checked') === true).length;
  await db().doc(`rtwStatus/${staffId}`).set({ staffId, ok: count > 0, count, updatedAt: FieldValue.serverTimestamp() });
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
    else reason = await checkAndLockFile(after.storagePath, { size: after.size, contentType: after.contentType });
    if (reason) {
      logger.warn('RTW upload refused', { staffId: after.staffId, docId: event.params.docId, reason });
      if (expectedPath && after.storagePath === expectedPath) await deleteFile(after.storagePath);
      await event.data.after.ref.delete();
      await recountRtw(after.staffId);
      return;
    }
    await event.data.after.ref.update({ checked: true, checkedAt: FieldValue.serverTimestamp() });
    logger.info('RTW document stored', { staffId: after.staffId, by: after.uploadedBy, docType: after.docType });
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

module.exports = { onStaffDocWritten, onPayslipStored, missingRtwIds, hasRtw, magicOk, RTW_TYPES };
