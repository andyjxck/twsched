import React, { useEffect, useRef, useState } from 'react';
import { collection, query, where, doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { ref as sref, uploadBytes, getBlob, deleteObject } from 'firebase/storage';
import { db, storage, niceError } from '../firebase.js';
import { useSession } from '../App.jsx';
import { useLive, useToast, go } from '../ui.jsx';
import '../staffdocs.css';

/* Right to Work documents (identity / immigration papers) and the link to someone's payslips.
 * Who can do what is enforced by firestore.rules + storage.rules and re-checked by functions/documents.js:
 *   owner   - upload, view, download, remove anyone's
 *   manager - upload only, for people with the staff role; they see the tick, never the files
 *   staff   - nothing
 * Nobody can be put on a shift until a checked document is on file (rtwStatus, server-written). */

export const MAX_BYTES = 10 * 1024 * 1024;
const EXT_TYPE = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heic' };
const TYPE_EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };
export const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif';
export const DOC_TYPES = [
  ['passport', 'Passport'],
  ['share_code', 'Share code check (GOV.UK)'],
  ['brp', 'Residence permit (BRP)'],
  ['visa', 'Visa or eVisa'],
  ['birth_certificate', 'Birth certificate + NI number'],
  ['other', 'Other'],
];
const docLabel = (t) => (DOC_TYPES.find((d) => d[0] === t) || [t, 'Document'])[1];

function typeOf(file) {
  const t = (file.type || '').toLowerCase();
  if (t === 'image/heif') return 'image/heic';
  if (TYPE_EXT[t]) return t;
  const ext = (String(file.name || '').split('.').pop() || '').toLowerCase();
  return EXT_TYPE[ext] || '';
}
function guessDocType(name) {
  const n = String(name || '').toLowerCase();
  if (/passport/.test(n)) return 'passport';
  if (/share|code|right.?to.?work|rtw/.test(n)) return 'share_code';
  if (/brp|residence/.test(n)) return 'brp';
  if (/visa/.test(n)) return 'visa';
  if (/birth/.test(n)) return 'birth_certificate';
  return 'passport';
}
export function sizeText(b) {
  return b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
}
// '' when fine, else what is wrong (shown to the user). The server checks the real content again.
export function checkRtwFile(file) {
  if (!typeOf(file)) return `${file.name}: use a PDF or a photo (JPG, PNG, WEBP or HEIC).`;
  if (!file.size) return `${file.name} is empty.`;
  if (file.size > MAX_BYTES) return `${file.name} is over 10 MB.`;
  return '';
}
function safeName(name) {
  return String(name || 'document').replace(/[\\/\u0000-\u001f"<>|:*?]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || 'document';
}

// Uploads one file for staffId. File first, then its metadata (the server checks both match).
export async function uploadRtw({ staffId, staffName, file, docType, me }) {
  const ct = typeOf(file);
  const ref = doc(collection(db, 'staffDocs'));
  const path = `rtw/${staffId}/${ref.id}.${TYPE_EXT[ct]}`;
  await uploadBytes(sref(storage, path), file, { contentType: ct, contentDisposition: 'attachment', cacheControl: 'private, no-store' });
  await setDoc(ref, {
    staffId, staffName: String(staffName || '').slice(0, 80), kind: 'rtw', docType,
    fileName: safeName(file.name), contentType: ct, size: file.size, storagePath: path,
    uploadedAt: serverTimestamp(), uploadedBy: me.uid, uploadedByName: String(me.name || '').slice(0, 80),
  });
}

// Files picked but not uploaded yet: used when adding someone (uploaded once their login exists)
// and when someone's documents are missing.
export function RtwPicker({ files, setFiles, disabled }) {
  const input = useRef(null);
  const toast = useToast();
  function onPick(e) {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    const ok = [];
    picked.forEach((file) => {
      const bad = checkRtwFile(file);
      if (bad) toast(bad, 'warn');
      else ok.push({ key: `${file.name}-${file.size}-${Math.random()}`, file, docType: guessDocType(file.name) });
    });
    if (ok.length) setFiles([...files, ...ok].slice(0, 6));
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      {files.length > 0 && (
        <ul className="rtw-files">
          {files.map((x) => (
            <li key={x.key}>
              <span className="fname">{x.file.name} <span className="tiny muted">{sizeText(x.file.size)}</span></span>
              <select aria-label={`What is ${x.file.name}?`} value={x.docType} disabled={disabled}
                onChange={(e) => setFiles(files.map((y) => (y.key === x.key ? { ...y, docType: e.target.value } : y)))}>
                {DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <button type="button" className="btn ghost sm" disabled={disabled} aria-label={`Remove ${x.file.name}`}
                onClick={() => setFiles(files.filter((y) => y.key !== x.key))}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn secondary sm rtw-add" disabled={disabled || files.length >= 6} onClick={() => input.current && input.current.click()} data-testid="rtw-add">
          {files.length ? 'Add another file' : 'Add Right to Work documents'}
        </button>
        <span className="tiny muted">PDF or photo, up to 10 MB each</span>
      </div>
      <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={onPick} data-testid="rtw-input" />
    </div>
  );
}

// Uploads every picked file; returns { done, failed: [messages] }. Used by the Add staff flow.
export async function uploadAll(files, staffId, staffName, me) {
  let done = 0;
  const failed = [];
  for (const x of files) {
    try {
      await uploadRtw({ staffId, staffName, file: x.file, docType: x.docType, me });
      done += 1;
    } catch (e) {
      failed.push(`${x.file.name}: ${niceError(e)}`);
    }
  }
  return { done, failed };
}

// "Documents" in someone's Team profile (Edit). Right to Work: a green tick when on file, the upload
// when missing. The owner can also open, download or remove the files, and jump to their payslips.
export function StaffDocuments({ person }) {
  const s = useSession();
  const toast = useToast();
  const status = useLive(() => doc(db, 'rtwStatus', person.id), [person.id]);
  const st = status.docs && status.docs[0];
  const ok = !!(st && st.ok);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(0); // time of last upload, while the server checks it
  const [showFiles, setShowFiles] = useState(false);
  const [slow, setSlow] = useState(false);
  const isSelf = person.id === s.user.uid;
  // Managers may add documents only for people with the staff role (never their own); the rules say the same.
  const canUpload = s.isOwner || (s.isManager && !isSelf && person.role === 'staff');
  useEffect(() => {
    if (!waiting || ok) { setSlow(false); return undefined; }
    const t = setTimeout(() => setSlow(true), 45000);
    return () => clearTimeout(t);
  }, [waiting, ok]);
  useEffect(() => { if (ok) setWaiting(0); }, [ok]);

  async function upload() {
    if (!files.length) return;
    setBusy(true);
    const r = await uploadAll(files, person.id, person.name, { uid: s.user.uid, name: s.name });
    setBusy(false);
    if (r.failed.length) toast(`Not uploaded: ${r.failed.join(' ')}`, 'warn');
    if (r.done) {
      setFiles([]);
      setWaiting(Date.now());
      toast(`${r.done} document${r.done === 1 ? '' : 's'} uploaded. Checking ${r.done === 1 ? 'it' : 'them'} now.`);
    }
  }

  return (
    <section className="docs-block" aria-label="Documents" data-testid="staff-documents">
      <h4>Documents</h4>
      <div className="docs-row">
        <span className="grow">
          <strong>Right to Work</strong>
          <div>
            {!status.docs ? <span className="tiny muted">Checking…</span>
              : ok ? (
                <span className="rtw-tick" data-testid="rtw-ok">
                  <span className="tickdot" aria-hidden="true">✓</span>
                  On file{st.count > 1 ? ` (${st.count} documents)` : ''}
                </span>
              ) : waiting ? (
                <span className="small muted">{slow ? 'Still not confirmed. If the tick doesn’t appear, the file couldn’t be read as a real PDF or photo: try another copy.' : 'Uploaded. Checking the file…'}</span>
              ) : (
                <span className="small rtw-missing-line" data-testid="rtw-missing">Missing. {isSelf ? 'You' : person.name.split(/\s+/)[0]} can’t be put on a shift until this is uploaded.</span>
              )}
          </div>
        </span>
        {s.isOwner && ok && (
          <button type="button" className="btn ghost sm" onClick={() => setShowFiles(!showFiles)} aria-expanded={showFiles}>
            {showFiles ? 'Hide files' : 'View files'}
          </button>
        )}
      </div>
      {status.docs && !ok && !waiting && (canUpload ? (
        <>
          <RtwPicker files={files} setFiles={setFiles} disabled={busy} />
          {files.length > 0 && (
            <button type="button" className="btn sm" disabled={busy} onClick={upload} data-testid="rtw-upload">
              {busy ? 'Uploading…' : `Upload ${files.length} file${files.length === 1 ? '' : 's'}`}
            </button>
          )}
          {!s.isOwner && <p className="tiny muted" style={{ margin: 0 }}>Only the owner can open these once uploaded.</p>}
        </>
      ) : (
        <p className="tiny muted" style={{ margin: 0 }}>Only the owner can add these for {isSelf ? 'you' : person.name}.</p>
      ))}
      {s.isOwner && ok && showFiles && <OwnerFiles person={person} />}
      {s.isOwner && (
        <div className="docs-row">
          <span className="grow"><strong>Payslips</strong></span>
          <button type="button" className="btn ghost sm" onClick={() => go(`payslips?staff=${encodeURIComponent(person.id)}`)}>Open payslips</button>
        </div>
      )}
    </section>
  );
}

// Owner only: the files themselves. Opened through the security rules (no shareable link).
function OwnerFiles({ person }) {
  const s = useSession();
  const toast = useToast();
  const list = useLive(() => query(collection(db, 'staffDocs'), where('staffId', '==', person.id)), [person.id]);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState('');
  const docs = (list.docs || []).filter((d) => d.kind === 'rtw').sort((a, b) => ((b.uploadedAt && b.uploadedAt.seconds) || 0) - ((a.uploadedAt && a.uploadedAt.seconds) || 0));

  async function open(d, save) {
    setBusy(d.id);
    try {
      const blob = await getBlob(sref(storage, d.storagePath));
      // only ever shown as the checked type (PDF or image), never as a web page
      const type = TYPE_EXT[d.contentType] ? d.contentType : 'application/octet-stream';
      const url = URL.createObjectURL(new Blob([blob], { type: save || type === 'image/heic' ? 'application/octet-stream' : type }));
      if (save || type === 'image/heic') {
        const a = document.createElement('a');
        a.href = url;
        a.download = d.fileName || `right-to-work.${TYPE_EXT[d.contentType] || 'bin'}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        const w = window.open(url, '_blank', 'noopener');
        if (!w) toast('Your browser blocked the new tab. Use Download instead.', 'warn');
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      toast(niceError(e), 'warn');
    } finally {
      setBusy('');
    }
  }
  async function remove(d) {
    const last = docs.length === 1;
    if (!window.confirm(`Remove ${d.fileName}?${last ? `\n\nIt’s ${person.name}’s only Right to Work document, so they can’t be put on new shifts until another is uploaded.` : ''}`)) return;
    setBusy(d.id);
    try {
      await deleteObject(sref(storage, d.storagePath)).catch((e) => { if (e.code !== 'storage/object-not-found') throw e; });
      await deleteDoc(doc(db, 'staffDocs', d.id));
      toast('Document removed.');
    } catch (e) {
      toast(niceError(e), 'warn');
    } finally {
      setBusy('');
    }
  }
  async function add() {
    setBusy('add');
    const r = await uploadAll(files, person.id, person.name, { uid: s.user.uid, name: s.name });
    setBusy('');
    if (r.failed.length) toast(`Not uploaded: ${r.failed.join(' ')}`, 'warn');
    if (r.done) { setFiles([]); toast(`${r.done} document${r.done === 1 ? '' : 's'} added.`); }
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      {list.error && <div className="err">{niceError(list.error)}</div>}
      {!list.docs ? <span className="tiny muted">Loading…</span> : (
        <ul className="rtw-files" data-testid="rtw-files">
          {docs.map((d) => (
            <li key={d.id}>
              <span className="fname">
                <strong>{docLabel(d.docType)}</strong> · {d.fileName}
                <div className="tiny muted">{sizeText(d.size)}{d.uploadedByName ? ` · added by ${d.uploadedByName}` : ''}{d.uploadedAt && d.uploadedAt.toDate ? `, ${d.uploadedAt.toDate().toLocaleDateString('en-GB')}` : ''}{d.checked ? '' : ' · checking'}</div>
              </span>
              {d.contentType !== 'image/heic' && <button type="button" className="btn ghost sm" disabled={!!busy} onClick={() => open(d, false)}>View</button>}
              <button type="button" className="btn ghost sm" disabled={!!busy} onClick={() => open(d, true)}>Download</button>
              <button type="button" className="btn ghost sm" disabled={!!busy} onClick={() => remove(d)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <RtwPicker files={files} setFiles={setFiles} disabled={!!busy} />
      {files.length > 0 && <button type="button" className="btn sm" disabled={!!busy} onClick={add}>{busy === 'add' ? 'Uploading…' : `Upload ${files.length} file${files.length === 1 ? '' : 's'}`}</button>}
      <p className="tiny muted" style={{ margin: 0 }}>Only owners can open these. Keep them for 2 years after someone leaves.</p>
    </div>
  );
}
