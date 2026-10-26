import React, { useRef, useState } from 'react';
import { collection, query, where, orderBy, doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { ref as sref, uploadBytes, getBlob, deleteObject } from 'firebase/storage';
import { db, storage, niceError } from '../firebase.js';
import { useSession } from '../App.jsx';
import { useLive, Loading, ErrorBox, useToast } from '../ui.jsx';
import { byName, taxPosition, taxYearLabel, taxMonthLabel, taxMonthRange, slotOf, ago } from '../util.js';

export async function downloadPayslip(p) {
  const blob = await getBlob(sref(storage, p.storagePath));
  const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = p.fileName || 'payslip.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// The one Payslips destination. Only the owner manages everyone's payslips (pick a person, then a month).
// Everyone else, managers included, sees only their own - the security rules enforce the same.
// #/payslips?staff={uid} opens that person straight away (linked from their Team profile).
export default function Payslips({ params }) {
  const s = useSession();
  const want = params && typeof params.get === 'function' ? params.get('staff') : null;
  return s.isOwner ? <ManagerPayslips want={want} /> : <PersonMonths person={{ id: s.user.uid, name: s.name }} canUpload={false} />;
}

function ManagerPayslips({ want }) {
  const s = useSession();
  const staff = useLive(() => query(collection(db, 'staff'), orderBy('name')), []);
  const { taxYear } = taxPosition();
  const all = useLive(() => query(collection(db, 'payslips'), where('taxYear', '==', taxYear)), [taxYear]);
  const [sel, setSel] = useState(null);
  const [used, setUsed] = useState('');
  if (want && want !== used && staff.docs) {
    const p = staff.docs.find((x) => x.id === want);
    setUsed(want);
    if (p) setSel(p);
  }
  const people = (staff.docs || []).filter((p) => p.active !== false || p.terminated).sort((a, b) => (!!a.terminated - !!b.terminated) || byName(a, b));
  const count = (id) => (all.docs || []).filter((p) => p.staffId === id).length;
  const { taxMonth } = taxPosition();
  // Desktop: everyone down the left, the chosen person's months on the right.
  // Phone: the list first, then one person at a time with a way back.
  const own = sel && sel.id === s.user.uid;
  return (
    <div className={`split payslips-split ${sel ? 'has-sel' : ''}`}>
    <div className="split-side card">
      <h3>Tax year {taxYearLabel(taxYear)}</h3>
      <ErrorBox error={staff.error || all.error} />
      {!staff.docs ? <Loading /> : (
        <ul className="list">
          {people.map((p) => {
            const n = count(p.id);
            return (
              <li key={p.id}>
                <button className={`rowbtn ${sel && sel.id === p.id ? 'on' : ''}`} aria-current={sel && sel.id === p.id ? 'true' : undefined} onClick={() => setSel(p)} data-testid="payslip-person">
                  <span className="grow"><strong>{p.name}</strong>{p.id === s.user.uid ? ' (you)' : ''}{p.terminated ? <span className="tiny muted"> · left {p.leftAt || ''}</span> : null}</span>
                  <span className={`pill ${n >= taxMonth ? 'green' : ''}`}>{n}/{taxMonth}</span>
                  <span aria-hidden="true">›</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
    <div className="split-main">
      {sel ? (
        <>
          <button className="btn ghost sm split-back" onClick={() => setSel(null)} style={{ marginBottom: 8 }}>‹ Everyone</button>
          <PersonMonths key={sel.id} person={sel} canUpload={s.isOwner} note={own ? '' : `Only you and ${sel.name} can open these.`} />
        </>
      ) : (
        <div className="card split-empty"><p className="muted" style={{ margin: 0 }}>Pick someone on the left to see and upload their payslips.</p></div>
      )}
    </div>
    </div>
  );
}

function PersonMonths({ person, canUpload, note }) {
  const s = useSession();
  const toast = useToast();
  const now = taxPosition();
  const [ty, setTy] = useState(now.taxYear);
  const list = useLive(() => query(collection(db, 'payslips'), where('staffId', '==', person.id)), [person.id]);
  const [busy, setBusy] = useState('');
  const fileInput = useRef(null);
  const pending = useRef(null);
  const months = ty === now.taxYear ? now.taxMonth : 12;
  const bySlot = {};
  (list.docs || []).forEach((p) => { if (p.slot) bySlot[p.slot] = p; });
  const legacy = (list.docs || []).filter((p) => !p.slot);
  const years = [...new Set([now.taxYear, now.taxYear - 1, ...(list.docs || []).map((p) => p.taxYear).filter(Boolean)])].sort((a, b) => b - a);

  function pick(tm) {
    pending.current = tm;
    fileInput.current.value = '';
    fileInput.current.click();
  }
  async function onFile(e) {
    const file = e.target.files[0];
    const tm = pending.current;
    if (!file || !tm) return;
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) { toast('Payslips need to be PDF files.', 'warn'); return; }
    if (file.size > 10 * 1024 * 1024) { toast('That file is over 10 MB.', 'warn'); return; }
    const slot = slotOf(ty, tm);
    const id = `${person.id}_${slot}`;
    const path = `payslips/${person.id}/${id}.pdf`;
    setBusy(slot);
    try {
      if (bySlot[slot]) await deleteDoc(doc(db, 'payslips', id)); // replacing
      await uploadBytes(sref(storage, path), file, { contentType: 'application/pdf', contentDisposition: `attachment; filename="${file.name.replace(/"/g, '')}"` });
      await setDoc(doc(db, 'payslips', id), {
        staffId: person.id, staffName: person.name, period: taxMonthLabel(ty, tm), slot, taxYear: ty, taxMonth: tm,
        payDate: '', fileName: file.name.slice(0, 200), storagePath: path, size: file.size,
        uploadedAt: serverTimestamp(), uploadedBy: s.user.uid, uploadedByName: (s.name || '').slice(0, 80),
      });
      toast(`${taxMonthLabel(ty, tm)} payslip uploaded. ${person.name} has been told.`);
    } catch (e2) {
      toast(niceError(e2), 'warn');
    } finally {
      setBusy('');
    }
  }
  async function remove(p) {
    if (!window.confirm(`Remove ${p.staffName}’s payslip for ${p.period}?`)) return;
    try {
      await deleteObject(sref(storage, p.storagePath)).catch((e) => { if (e.code !== 'storage/object-not-found') throw e; });
      await deleteDoc(doc(db, 'payslips', p.id));
      toast('Payslip removed.');
    } catch (e) {
      toast(niceError(e), 'warn');
    }
  }
  async function dl(p) {
    setBusy(p.id);
    try {
      await downloadPayslip(p);
    } catch (e) {
      toast(niceError(e), 'warn');
    } finally {
      setBusy('');
    }
  }
  const rows = [...Array(months)].map((_, i) => months - i); // newest first
  return (
    <div className="card">
      <div className="row between wrap">
        <h3 style={{ margin: 0 }}>{person.id === s.user.uid && !s.isManager ? 'Your payslips' : person.name}</h3>
        <select value={ty} onChange={(e) => setTy(Number(e.target.value))} style={{ maxWidth: 150 }} aria-label="Tax year">
          {years.map((y) => <option key={y} value={y}>Tax year {taxYearLabel(y)}</option>)}
        </select>
      </div>
      {note && <div className="warn" style={{ marginTop: 8 }}>{note}</div>}
      <input ref={fileInput} type="file" accept="application/pdf,.pdf" hidden onChange={onFile} data-testid="payslip-file" />
      <ErrorBox error={list.error} />
      {!list.docs ? <Loading /> : (
        <ul className="list">
          {rows.map((tm) => {
            const slot = slotOf(ty, tm);
            const p = bySlot[slot];
            return (
              <li key={slot} className="row between" data-testid="payslip-month" data-slot={slot}>
                <div className="grow">
                  <span className={`tick ${p ? 'done' : ''}`} aria-label={p ? 'Uploaded' : 'Not uploaded'}>{p ? '✓' : ''}</span>
                  <strong>{taxMonthLabel(ty, tm)}</strong> <span className="tiny muted">month {tm}</span>
                  <div className="tiny muted">{p ? `${p.fileName} · uploaded ${ago(p.uploadedAt)}${p.uploadedByName ? ` by ${p.uploadedByName}` : ''}` : taxMonthRange(ty, tm)}</div>
                </div>
                <div className="actions">
                  {p && <button className="btn secondary sm" disabled={busy === p.id} onClick={() => dl(p)}>{busy === p.id ? 'Opening…' : 'Download'}</button>}
                  {canUpload && <button className={`btn sm ${p ? 'ghost' : ''}`} disabled={busy === slot} onClick={() => pick(tm)}>{busy === slot ? 'Uploading…' : p ? 'Replace' : 'Upload'}</button>}
                  {canUpload && p && <button className="btn ghost sm" onClick={() => remove(p)}>Remove</button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {legacy.length > 0 && (
        <>
          <h3>Other payslips</h3>
          <ul className="list">
            {legacy.map((p) => (
              <li key={p.id} className="row between">
                <div className="grow"><strong>{p.period}</strong><div className="tiny muted">{p.fileName}</div></div>
                <button className="btn secondary sm" onClick={() => dl(p)}>Download</button>
              </li>
            ))}
          </ul>
        </>
      )}
      {!s.isOwner && <p className="tiny muted">Private: only you and the owner can see these.</p>}
    </div>
  );
}
