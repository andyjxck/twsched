import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { collection, query, where, orderBy, doc, setDoc, addDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db, call, niceError } from '../firebase.js';
import { useSession } from '../App.jsx';
import { useLive, Field, Loading, ErrorBox, useToast, go } from '../ui.jsx';
import { ymd, mondayOf, addDays, pretty, DAYS, fmtHours, weekdayIndex, byName, AREAS, paidHours, overnight, tsDate, breakMinutes, addMinutes, breakFits } from '../util.js';
import '../shiftform.css';
import MyShifts from './MyShifts.jsx';
import { useRotaOrder, applyOrder, moveId } from '../rotaOrder.js';
import { useDayLocks, DayTick } from '../DayApproval.jsx';
import { clashFor, clashText } from '../availability.js';
import '../availability.css';

const OPEN = '';

// Team members never see the full rota: they get their own shifts only.
export default function Rota({ params }) {
  const s = useSession();
  return s.isManager ? <ManagerRota params={params} /> : <MyShifts />;
}

export function shiftData(x, uid) {
  return {
    staffId: x.staffId || OPEN,
    staffName: x.staffId ? (x.staffName || '') : 'Open shift',
    date: x.date,
    week: mondayOf(x.date),
    start: x.start,
    end: x.end,
    breakStart: x.breakStart && x.breakEnd ? x.breakStart : '',
    breakEnd: x.breakStart && x.breakEnd ? x.breakEnd : '',
    breakPaid: x.breakPaid !== false,
    leader: !!x.leader,
    area: x.area || '',
    notes: x.notes || '',
    eventId: x.eventId || '',
    eventTitle: x.eventTitle || '',
    published: !!x.published,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  };
}

export function breakText(x) {
  if (!x.breakStart || !x.breakEnd) return '';
  return `Break ${x.breakStart}–${x.breakEnd} (${x.breakPaid === false ? 'unpaid' : 'paid'})`;
}

// hover text and screen-reader label for a shift on the rota grid
function chipTitle(x) {
  return [x.leader ? '★ Shift leader' : '', breakText(x), x.notes || ''].filter(Boolean).join('\n');
}
function chipLabel(x, who) {
  return [
    `${x.start} to ${x.end}${overnight(x) ? ', finishes next day' : ''}`,
    x.area, x.eventTitle,
    `${fmtHours(paidHours(x))} paid`,
    x.leader ? 'Shift leader' : '',
    x.published ? '' : 'draft',
    who ? `for ${who}` : '',
  ].filter(Boolean).join(', ') + '. Open to change.';
}

function eventsOn(events, d) {
  return events.filter((e) => (e.repeat === 'weekly' ? d >= e.date && weekdayIndex(d) === weekdayIndex(e.date) : e.date === d));
}

function GripIcon() {
  return (
    <svg viewBox="0 0 12 18" width="12" height="18" aria-hidden="true" focusable="false" fill="currentColor">
      <circle cx="3" cy="3" r="1.6" /><circle cx="9" cy="3" r="1.6" /><circle cx="3" cy="9" r="1.6" />
      <circle cx="9" cy="9" r="1.6" /><circle cx="3" cy="15" r="1.6" /><circle cx="9" cy="15" r="1.6" />
    </svg>
  );
}

function ManagerRota({ params }) {
  const s = useSession();
  const toast = useToast();
  const today = ymd();
  const weekStart = mondayOf(params.get('week') || today);
  const weekEnd = addDays(weekStart, 6);
  const days = useMemo(() => [...Array(7)].map((_, i) => addDays(weekStart, i)), [weekStart]);
  const [pop, setPop] = useState(null); // { shift, rect }
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState('');
  const [ghost, setGhost] = useState(null);
  const drag = useRef(null);
  const suppressClick = useRef(false);

  const shifts = useLive(() => query(collection(db, 'shifts'), where('date', '>=', weekStart), where('date', '<=', weekEnd)), [weekStart]);
  const staff = useLive(() => query(collection(db, 'staff'), orderBy('name')), []);
  const events = useLive(() => query(collection(db, 'events'), orderBy('date')), []);
  const timeOff = useLive(() => query(collection(db, 'timeOff'), where('to', '>=', weekStart)), [weekStart]);
  const unav = useLive(() => query(collection(db, 'unavailability'), where('to', '>=', weekStart)), [weekStart]);
  // Right to Work tick per person (written only by the server once a document is checked). No tick = can't be put on.
  const rtw = useLive(() => (s.isManager ? collection(db, 'rtwStatus') : null), [s.isManager]);
  const rtwOk = (id) => !id || !rtw.docs || rtw.docs.some((r) => r.id === id && r.ok === true);
  const week = useLive(() => doc(db, 'weeks', weekStart), [weekStart]);
  const wk = (week.docs && week.docs[0]) || null;
  const approved = wk && wk.status === 'approved';
  const locked = approved && !s.isOwner;
  // single days approved with the tick in their header: only the owner can change those days
  const dayLocks = useDayLocks(weekStart, weekEnd);
  const dayLocked = (d) => !s.isOwner && dayLocks.isApproved(d);

  const eligible = useMemo(() => (staff.docs || [])
    .filter((p) => p.active !== false && !p.terminated).sort(byName), [staff.docs]);
  const people = useMemo(() => {
    const list = [...eligible];
    (shifts.docs || []).forEach((sh) => {
      if (sh.staffId && !list.find((p) => p.id === sh.staffId)) list.push({ id: sh.staffId, name: sh.staffName, gone: true });
    });
    return list;
  }, [eligible, shifts.docs]);

  // Personal row order: each person arranges the rows for themselves only (saved per login).
  const [rowOrder, saveRowOrder] = useRotaOrder(s.user.uid);
  const ordered = useMemo(() => applyOrder(people, rowOrder), [people, rowOrder]);
  const [rowDrag, setRowDrag] = useState(null); // { id, before }
  const rowDragRef = useRef(null);
  const [orderMsg, setOrderMsg] = useState('');
  const focusGrip = useRef('');
  useEffect(() => {
    if (!focusGrip.current) return;
    const el = document.querySelector(`[data-grip="${focusGrip.current}"]`);
    focusGrip.current = '';
    if (el) el.focus();
  });
  function placeRow(id, toIndex) {
    const ids = ordered.map((p) => p.id);
    const next = moveId(ids, id, toIndex);
    if (next.join('|') === ids.join('|')) return;
    saveRowOrder(next);
    const who = ordered.find((p) => p.id === id);
    setOrderMsg(`${who ? who.name : 'Person'} moved to position ${next.indexOf(id) + 1} of ${next.length}.`);
  }
  function onGripKey(e, id) {
    const i = ordered.findIndex((p) => p.id === id);
    const to = { ArrowUp: i - 1, ArrowDown: i + 1, Home: 0, End: ordered.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    if (to < 0 || to >= ordered.length || to === i) return;
    focusGrip.current = id;
    placeRow(id, to);
  }
  function rowIndexAt(y) {
    const trs = [...document.querySelectorAll('tr[data-person]')];
    for (let k = 0; k < trs.length; k += 1) {
      const r = trs[k].getBoundingClientRect();
      if (y < r.top + r.height / 2) return k;
    }
    return trs.length;
  }
  function onGripDown(e, id) {
    if (e.button > 0) return;
    e.preventDefault();
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    rowDragRef.current = { id, y: e.clientY, active: false };
  }
  function onGripMove(e) {
    const d = rowDragRef.current;
    if (!d) return;
    if (!d.active) {
      if (Math.abs(e.clientY - d.y) < 4) return;
      d.active = true;
    }
    e.preventDefault();
    if (e.clientY < 70) window.scrollBy(0, -12);
    else if (e.clientY > window.innerHeight - 50) window.scrollBy(0, 12);
    setRowDrag({ id: d.id, before: rowIndexAt(e.clientY) });
  }
  function onGripUp(e) {
    const d = rowDragRef.current;
    rowDragRef.current = null;
    setRowDrag(null);
    if (!d || !d.active) return;
    const before = rowIndexAt(e.clientY);
    const from = ordered.findIndex((p) => p.id === d.id);
    placeRow(d.id, before > from ? before - 1 : before);
  }
  function onGripCancel() { rowDragRef.current = null; setRowDrag(null); }
  const dragFrom = rowDrag ? ordered.findIndex((p) => p.id === rowDrag.id) : -1;
  const dropAt = rowDrag && rowDrag.before !== dragFrom && rowDrag.before !== dragFrom + 1 ? rowDrag.before : -1;

  const byCell = useMemo(() => {
    const m = {};
    (shifts.docs || []).forEach((sh) => {
      const k = `${sh.staffId || OPEN}|${sh.date}`;
      (m[k] = m[k] || []).push(sh);
    });
    Object.values(m).forEach((l) => l.sort((a, b) => a.start.localeCompare(b.start)));
    return m;
  }, [shifts.docs]);

  // approved holiday and unavailability per person/day
  const blocks = useMemo(() => {
    const m = {};
    (timeOff.docs || []).filter((t) => t.status === 'approved').forEach((t) => days.forEach((d) => {
      if (d >= t.from && d <= t.to) m[`${t.staffId}|${d}`] = { kind: 'holiday', label: `HOLIDAY (${t.paid === false ? 'UNPAID' : 'PAID'})` };
    }));
    (unav.docs || []).forEach((u) => days.forEach((d, i) => {
      const k = `${u.staffId}|${d}`;
      if (m[k]) return;
      if (d >= u.from && d <= u.to && (!u.weekday || u.weekday === i + 1)) m[k] = { kind: 'unav', label: 'Unavailable', reason: u.reason };
    }));
    return m;
  }, [timeOff.docs, unav.docs, days]);

  const evs = events.docs || [];
  const all = shifts.docs || [];
  const drafts = all.filter((x) => !x.published);
  const totalHours = all.filter((x) => x.staffId).reduce((t, x) => t + paidHours(x), 0);
  const openCount = all.filter((x) => !x.staffId).length;

  function personName(id) {
    const p = people.find((q) => q.id === id);
    return p ? p.name : '';
  }
  // Unavailable or on approved holiday: nobody (owner included) can be put on. The server refuses it too.
  function checkBlock(staffId, date, start, end) {
    if (staffId && !rtwOk(staffId)) {
      toast(`${personName(staffId)} can’t be put on a shift until their Right to Work documents are uploaded. Add them in Team: Edit on their name.`, 'warn');
      return false;
    }
    const c = clashFor(staffId, date, start, end, timeOff.docs, unav.docs);
    if (!c) return true;
    toast(`${clashText(personName(staffId), c)} Pick someone else or make it an open shift.`, 'warn');
    return false;
  }
  // shifts already on the rota for someone who is now unavailable / on holiday (left as they are, flagged)
  const clashOf = (x) => (x.staffId ? clashFor(x.staffId, x.date, x.start, x.end, timeOff.docs, unav.docs) : null);
  const clashes = all.filter(clashOf);

  function openNew(e, staffId, date) {
    if (locked || dayLocked(date) || suppressClick.current) return;
    if (staffId && !checkBlock(staffId, date)) return;
    const p = people.find((q) => q.id === staffId);
    setPop({
      rect: e.currentTarget.getBoundingClientRect(),
      shift: { staffId, date, start: '17:00', end: '23:00', breakStart: '', breakEnd: '', breakPaid: true, leader: false,
        area: p && AREAS.includes(p.jobTitle) ? p.jobTitle : 'Bar', notes: '', eventId: '' },
    });
  }
  function openEdit(e, x) {
    e.stopPropagation();
    if (suppressClick.current) return;
    setPop({ rect: e.currentTarget.getBoundingClientRect(), shift: x });
  }

  async function duplicateTo(x, staffId, date) {
    if (x.staffId === staffId && x.date === date) return;
    if (dayLocked(date)) { toast(`${pretty(date)} has been approved. Only the owner can change it.`, 'warn'); return; }
    if (!checkBlock(staffId, date, x.start, x.end)) return;
    try {
      // the shift-leader star stays with the person: it is kept when copying someone's shift to another of their days,
      // and dropped when the copy goes to someone else or to open shifts
      const keepLeader = !!x.leader && !!staffId && staffId === x.staffId;
      await addDoc(collection(db, 'shifts'), shiftData({ ...x, staffId, staffName: personName(staffId), date, leader: keepLeader, published: false }, s.user.uid));
      toast(`Copied to ${staffId ? personName(staffId) : 'open shifts'}, ${pretty(date)} (draft)${x.leader && !keepLeader ? ', without the shift leader star' : ''}.`);
    } catch (err) {
      toast(niceError(err), 'warn');
    }
  }

  // ---- drag a shift onto another square to duplicate it (mouse: drag; touch: press and hold, then drag)
  function endDrag() {
    const d = drag.current;
    if (d && d.timer) clearTimeout(d.timer);
    if (d && d.raf) cancelAnimationFrame(d.raf);
    drag.current = null;
    setGhost(null);
    setDragOver('');
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
  }
  function cellAt(x, y) {
    const el = document.elementFromPoint(x, y);
    const c = el && el.closest('[data-cell]');
    return c ? c.getAttribute('data-cell') : '';
  }
  // scroll the rota (and page) when a dragged shift nears an edge, so far-away days can be reached
  function autoScroll() {
    const d = drag.current;
    if (!d || !d.active) return;
    const wrap = document.querySelector('.rota-wrap');
    if (wrap && d.lx != null) {
      const r = wrap.getBoundingClientRect();
      const edge = 36;
      if (d.lx > r.right - edge) wrap.scrollLeft += 10;
      else if (d.lx < r.left + 110 + edge && wrap.scrollLeft > 0) wrap.scrollLeft -= 10;
      if (d.ly > window.innerHeight - edge - 70) window.scrollBy(0, 10);
      else if (d.ly < edge + 60) window.scrollBy(0, -10);
      setDragOver(cellAt(d.lx, d.ly));
    }
    d.raf = requestAnimationFrame(autoScroll);
  }
  function onMove(e) {
    const d = drag.current;
    if (!d) return;
    d.lx = e.clientX; d.ly = e.clientY;
    const dist = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    if (!d.active) {
      if (dist < 6) return;
      if (d.type === 'mouse') { d.active = true; d.raf = requestAnimationFrame(autoScroll); }
      else { endDrag(); return; } // finger moved before the hold: let the page scroll
    }
    e.preventDefault();
    setGhost({ x: e.clientX, y: e.clientY, shift: d.shift });
    setDragOver(cellAt(e.clientX, e.clientY));
  }
  function onUp(e) {
    const d = drag.current;
    if (!d) return;
    if (d.active) {
      const target = cellAt(e.clientX, e.clientY);
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 50);
      if (target) {
        const [staffId, date] = target.split('|');
        duplicateTo(d.shift, staffId, date);
      }
    }
    endDrag();
  }
  function onCancel() { endDrag(); }
  function onChipDown(e, x) {
    if (locked || e.button > 0) return;
    const d = { x: e.clientX, y: e.clientY, shift: x, type: e.pointerType, active: false, timer: null };
    if (e.pointerType !== 'mouse') {
      d.timer = setTimeout(() => {
        if (drag.current !== d) return;
        d.active = true;
        d.raf = requestAnimationFrame(autoScroll);
        if (navigator.vibrate) navigator.vibrate(15);
        setGhost({ x: d.x, y: d.y, shift: x });
      }, 350);
    }
    drag.current = d;
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }
  useEffect(() => {
    // stop the page scrolling while a held shift is being dragged on a touch screen
    const tm = (e) => { if (drag.current && drag.current.active) e.preventDefault(); };
    document.addEventListener('touchmove', tm, { passive: false });
    return () => { document.removeEventListener('touchmove', tm); endDrag(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function publish() {
    setBusy(true);
    try {
      const r = await call('publishWeek', { weekStart });
      toast(`Published ${r.published} shift${r.published === 1 ? '' : 's'}. ${r.staffNotified} ${r.staffNotified === 1 ? 'person' : 'people'} told.`
        + (r.skippedUnavailable ? ` ${r.skippedUnavailable} draft${r.skippedUnavailable === 1 ? ' was' : 's were'} held back: the person is unavailable or on holiday then.` : ''));
    } catch (e) {
      toast(niceError(e), 'warn');
    } finally {
      setBusy(false);
    }
  }
  async function approve() {
    const msg = `Approve and finalise the week of ${pretty(weekStart, { day: 'numeric', month: 'long' })}?\n\n`
      + `${drafts.length ? `${drafts.length} draft shift${drafts.length === 1 ? '' : 's'} will be published. ` : ''}`
      + 'After this only the owner can change this week.';
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      await call('approveWeek', { weekStart });
      toast('Week approved and finalised.');
    } catch (e) {
      toast(niceError(e), 'warn');
    } finally {
      setBusy(false);
    }
  }

  const loading = !shifts.docs || !staff.docs;
  // open shifts always sit at the top of the rota
  const rows = [{ id: OPEN, name: 'Open shifts', open: true }, ...ordered.map((p) => ({ ...p, open: false }))];
  const approvedAt = wk && tsDate(wk.approvedAt);

  return (
    <div>
      <div className="rota-toolbar">
        <div className="weekpick">
          <button className="btn secondary sm" onClick={() => go(`rota?week=${addDays(weekStart, -7)}`)} aria-label="Previous week">‹</button>
          <div className="weeklabel">w/c {pretty(weekStart, { day: 'numeric', month: 'short', year: 'numeric' })}</div>
          <button className="btn secondary sm" onClick={() => go(`rota?week=${addDays(weekStart, 7)}`)} aria-label="Next week">›</button>
          {weekStart !== mondayOf(today) && <button className="btn ghost sm" onClick={() => go('rota')}>This week</button>}
        </div>
        <div className="facts">
          <span className={`pill ${approved ? 'green' : wk && wk.status === 'published' ? 'blue' : ''}`} data-testid="week-status">
            {approved ? 'Approved' : wk && wk.status === 'published' ? 'Published' : 'Not published'}
          </span>
          <span className="pill" title="Paid hours this week">{fmtHours(totalHours)} paid</span>
          {openCount > 0 && <span className="pill amber">{openCount} open</span>}
          {!locked && drafts.length > 0 && <span className="legend-draft" title="Staff can’t see drafts until you publish"><i aria-hidden="true" />Draft</span>}
        </div>
        <div className="spacer" />
        {!locked && (
          <div className="actions">
            <button className="btn secondary sm" disabled={busy || !drafts.length} onClick={publish}>
              {drafts.length ? `Publish ${drafts.length} change${drafts.length === 1 ? '' : 's'}` : 'All published'}
            </button>
            {!approved && <button className="btn sm" disabled={busy || loading} onClick={approve}>Approve week</button>}
          </div>
        )}
        {!locked && (
          <details className="help">
            <summary aria-label="How the rota works" title="How the rota works">?</summary>
            <div className="help-body">
              <ul>
                <li>Tap an empty square to add a shift, or a shift to change it.</li>
                <li>Drag a shift to another square to copy it (on a phone, press and hold first).</li>
                <li>Dashed shifts are drafts. Staff only see them once you publish.</li>
                <li>Tick a day to approve it. Only the owner can change it after that; whoever ticked can undo for 5 minutes.</li>
                {people.length > 1 && <li>Drag the handle beside a name to reorder people. Only you see this order.</li>}
              </ul>
            </div>
          </details>
        )}
      </div>
      {approved && (
        <div className={`rota-note ${locked ? 'warn' : 'okbox'}`}>
          Approved{wk.approvedByName ? ` by ${wk.approvedByName}` : ''}{approvedAt ? ` on ${approvedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}.{' '}
          {locked ? 'Only the owner can change it now.' : 'You can still change it as the owner.'}
        </div>
      )}
      {clashes.length > 0 && (
        <div className="warn availclash rota-note" role="status">
          {clashes.length === 1 ? '1 shift clashes' : `${clashes.length} shifts clash`} with holiday or unavailability:{' '}
          {clashes.slice(0, 4).map((x) => `${x.staffName || personName(x.staffId)} ${pretty(x.date)}`).join(', ')}{clashes.length > 4 ? '…' : ''}.
          {' '}Move or reassign {clashes.length === 1 ? 'it' : 'them'}; drafts like this won’t publish.
        </div>
      )}
      <ErrorBox error={shifts.error || staff.error || timeOff.error || unav.error} />
      {!loading && people.length > 1 && (
        <div className="rota-orderhelp" id="rota-order-help">
          <span className="sr">Drag the handle beside a name, or use the arrow keys on it, to change the order of people. Only you see this order.</span>
          {rowOrder.length > 0 && <button type="button" className="btn ghost sm" onClick={() => { saveRowOrder([]); setOrderMsg('Order reset to A to Z.'); }}>Reset to A&ndash;Z</button>}
        </div>
      )}
      <div className="sr" aria-live="polite">{orderMsg}</div>
      {loading ? <Loading /> : (
        <div className="rota-wrap">
          <table className={`rota ${locked ? 'locked' : ''}`}>
            <thead>
              <tr>
                <th className="person">Staff</th>
                {days.map((d, i) => (
                  <th key={d} className={`${d === today ? 'today' : ''} ${dayLocks.isApproved(d) ? 'daylocked' : ''}`}>
                    {DAYS[i]} {pretty(d, { day: 'numeric', month: 'short' })}
                    <DayTick date={d} info={dayLocks.get(d)} session={s} weekApproved={approved} toast={toast} />
                    {eventsOn(evs, d).map((e) => <div key={e.id} className="dayhead-events">★ {e.title}{e.start ? ` ${e.start}` : ''}</div>)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const h = p.open ? 0 : days.reduce((t, d) => t + (byCell[`${p.id}|${d}`] || []).reduce((a, x) => a + paidHours(x), 0), 0);
                return (
                  <tr key={p.id || 'open'} data-person={p.open ? undefined : p.id}
                    className={`${p.id === s.user.uid ? 'me' : ''} ${p.open ? 'openrow' : ''} ${rowDrag && rowDrag.id === p.id ? 'rowdragging' : ''} ${!p.open && dropAt >= 0 && ordered[dropAt] && ordered[dropAt].id === p.id ? 'drop-above' : ''} ${!p.open && dropAt === ordered.length && ordered[ordered.length - 1].id === p.id ? 'drop-below' : ''}`}>
                    <td className="person">
                      {!p.open && people.length > 1 && (
                        <button type="button" className="grip" data-grip={p.id}
                          aria-label={`Move ${p.name}, position ${ordered.findIndex((o) => o.id === p.id) + 1} of ${ordered.length}. Use the up and down arrow keys.`}
                          aria-describedby="rota-order-help"
                          onPointerDown={(e) => onGripDown(e, p.id)} onPointerMove={onGripMove} onPointerUp={onGripUp}
                          onPointerCancel={onGripCancel} onLostPointerCapture={onGripCancel}
                          onKeyDown={(e) => onGripKey(e, p.id)} onClick={(e) => e.stopPropagation()}>
                          <GripIcon />
                        </button>
                      )}
                      <strong>{p.name}</strong>{p.gone ? <span className="tiny muted"> (left)</span> : null}
                      {p.jobTitle && <div className="tiny muted">{p.jobTitle}</div>}
                      {!p.open && !p.gone && !rtwOk(p.id) && <div className="rtw-missing" title="Can’t be put on a shift until their Right to Work documents are uploaded in Team">No Right to Work docs</div>}
                      {!p.open && <div className={`hrs ${h > 48 ? 'over' : ''}`}>{fmtHours(h)}</div>}
                    </td>
                    {days.map((d) => {
                      const key = `${p.id}|${d}`;
                      const b = p.open ? null : blocks[key];
                      const list = byCell[key] || [];
                      const canAdd = !locked && !dayLocked(d) && !p.gone && !b;
                      return (
                        <td key={d} data-cell={key}
                          className={`cell ${b ? (b.kind === 'holiday' ? 'off holiday' : 'off unav') : ''} ${dragOver === key ? 'dropping' : ''} ${dayLocked(d) ? 'daylocked' : ''}`}
                          onClick={canAdd ? (e) => openNew(e, p.id, d) : (b && !locked && !p.gone ? (e) => openNew(e, p.id, d) : undefined)}
                          title={b ? (b.reason ? `${b.label}: ${b.reason}` : b.label) : ''}>
                          {b && <div className="cellflag">{b.label}{b.reason ? <span className="reason">{b.reason}</span> : null}</div>}
                          {list.map((x) => (
                            <div key={x.id} className={`chip ${x.published ? '' : 'draft'} ${!x.staffId ? 'openchip' : ''} ${clashOf(x) ? 'clash' : ''}`}
                              role="button" tabIndex={0} data-shift={x.id}
                              onPointerDown={(e) => onChipDown(e, x)}
                              onContextMenu={(e) => e.preventDefault()}
                              onClick={(e) => openEdit(e, x)}
                              onKeyDown={(e) => { if (e.key === 'Enter') openEdit(e, x); }}
                              title={chipTitle(x)} aria-label={chipLabel(x, p.open ? 'anyone (open shift)' : p.name)}>
                              <div className="chip-times">
                                <span>{x.start}–{x.end}{overnight(x) ? <span className="chip-next"> +1</span> : null}</span>
                                {x.leader && <span className="chip-star" role="img" aria-label="Shift leader" title="Shift leader">★</span>}
                              </div>
                              {clashOf(x) && <div className="chip-clash">{clashOf(x).block.kind === 'holiday' ? 'On holiday' : 'Unavailable'}{clashOf(x).spill ? ' next day' : ''}</div>}
                              <div className="area chip-meta">
                                {(x.area || x.eventTitle) && <span className="chip-area">{[x.area, x.eventTitle].filter(Boolean).join(' · ')} · </span>}
                                <span className="chip-hours">{fmtHours(paidHours(x))} paid</span>
                              </div>
                            </div>
                          ))}
                          {canAdd && list.length > 0 && <div className="addmore" aria-hidden="true">+</div>}
                          {canAdd && list.length === 0 && <span className="sr">Add shift for {p.name} on {pretty(d)}</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {people.length === 0 && <tr><td colSpan={8} className="empty">No staff yet. Add people on the Team page.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {ghost && (
        <div className="dragghost" style={{ left: ghost.x, top: ghost.y }}>{ghost.shift.start}–{ghost.shift.end}</div>
      )}
      {pop && (
        <ShiftPopover pop={pop} staff={eligible} events={evs} blocks={blocks} avail={{ timeOff: timeOff.docs, unav: unav.docs, rtw: rtw.docs }} locked={locked || dayLocked(pop.shift.date)}
          dayLocked={dayLocked} onClose={() => setPop(null)} />
      )}
    </div>
  );
}

// Editor anchored to the square or shift that was tapped.
function ShiftPopover({ pop, staff, events, blocks, avail, locked, dayLocked, onClose }) {
  const s = useSession();
  const toast = useToast();
  const shift = pop.shift;
  // the break is entered as a start time plus a length in minutes; the end time is worked out when saving
  const [f, setF] = useState(() => {
    const len = breakMinutes(shift);
    return { ...shift, breakStart: len ? shift.breakStart : '', breakMins: len ? String(len) : '',
      breakPaid: shift.breakPaid !== false, leader: !!shift.leader };
  });
  const [moving, setMoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pos, setPos] = useState({ left: -9999, top: 0, maxHeight: 400 });
  const box = useRef(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const dayEvents = eventsOn(events, f.date || '');
  const personOf = (id) => { const p = staff.find((q) => q.id === id); return p ? p.name : ''; };
  const lenNow = String(f.breakMins ?? '').trim();
  const breakEndsAt = f.breakStart && /^\d+$/.test(lenNow) && Number(lenNow) > 0 ? addMinutes(f.breakStart, Number(lenNow)) : '';

  useLayoutEffect(() => {
    const vw = window.innerWidth; const vh = window.innerHeight;
    const r = pop.rect;
    const el = box.current;
    const w = Math.min(360, vw - 16);
    const h = el ? el.scrollHeight : 420;
    const left = Math.max(8, Math.min(r.left, vw - w - 8));
    const below = vh - r.bottom - 8;
    const above = r.top - 8;
    let top; let maxHeight;
    if (below >= Math.min(h, 320) || below >= above) { top = r.bottom + 6; maxHeight = Math.max(200, vh - top - 8); }
    else { maxHeight = Math.max(200, above - 6); top = Math.max(8, r.top - 6 - Math.min(h, maxHeight)); }
    setPos({ left, top, width: w, maxHeight });
  }, [pop.rect]);
  useEffect(() => {
    const on = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);

  async function save(publishNow) {
    setErr('');
    if (!f.date) { setErr('This shift has no day. Close this and tap the day’s square on the rota.'); return; }
    if (dayLocked && dayLocked(f.date)) { setErr(`${pretty(f.date)} has been approved. Only the owner can change it.`); return; }
    if (!f.start || !f.end) { setErr('Fill in the start and finish times.'); return; }
    const lenText = String(f.breakMins ?? '').trim();
    let breakStart = ''; let breakEnd = '';
    if (f.breakStart || lenText) {
      if (!f.breakStart) { setErr('Put when the break starts, or clear the break minutes for no break.'); return; }
      if (!lenText) { setErr('Put how long the break is in minutes, e.g. 30. Or clear the break start for no break.'); return; }
      if (!/^\d+$/.test(lenText) || Number(lenText) < 1) { setErr('Break length must be a whole number of minutes, 1 or more.'); return; }
      if (!breakFits(f, f.breakStart, Number(lenText))) {
        setErr(`A ${lenText}-minute break from ${f.breakStart} doesn’t fit inside ${f.start}–${f.end}. Change the break start or length.`);
        return;
      }
      breakStart = f.breakStart;
      breakEnd = addMinutes(f.breakStart, Number(lenText));
    }
    const person = staff.find((p) => p.id === f.staffId);
    // nobody (owner included) can be put on while unavailable or on approved holiday; the form stays open as typed
    const moved = !shift.id || f.staffId !== shift.staffId || f.date !== shift.date || f.start !== shift.start || f.end !== shift.end;
    const c = moved ? clashFor(f.staffId, f.date, f.start, f.end, avail && avail.timeOff, avail && avail.unav) : null;
    if (f.staffId && (!shift.id || f.staffId !== shift.staffId) && avail && avail.rtw && !avail.rtw.some((r) => r.id === f.staffId && r.ok === true)) {
      setErr(`${person ? person.name : f.staffName || 'They'} can’t be put on a shift until their Right to Work documents are uploaded (Team, Edit on their name). Pick someone else or make it an open shift.`);
      return;
    }
    if (c) {
      setErr(`${clashText(person ? person.name : f.staffName, c)} Pick someone else, change the day or times, or make it an open shift.`);
      return;
    }
    const ev = events.find((e) => e.id === f.eventId);
    setBusy(true);
    try {
      const ref = shift.id ? doc(db, 'shifts', shift.id) : doc(collection(db, 'shifts'));
      const published = publishNow ? true : shift.id ? !!shift.published : false;
      await setDoc(ref, shiftData({ ...f, breakStart, breakEnd, staffName: person ? person.name : (f.staffId ? f.staffName : ''), eventTitle: ev ? ev.title : '', published }, s.user.uid));
      toast(published ? (shift.id ? 'Shift updated.' : 'Shift added and published.') : 'Saved as a draft.');
      onClose();
    } catch (e) {
      setErr(e && e.code === 'permission-denied'
        ? 'Not saved: the server refused it. The person may be unavailable or on holiday then (including the next day if it runs past midnight), or the day has been approved.'
        : niceError(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!window.confirm(`Delete this shift (${pretty(shift.date)} ${shift.start}–${shift.end})?`)) return;
    setBusy(true);
    try {
      await deleteDoc(doc(db, 'shifts', shift.id));
      toast('Shift deleted.');
      onClose();
    } catch (e) {
      setErr(niceError(e));
      setBusy(false);
    }
  }
  const ro = locked;
  return (
    <div className="popback" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className="popover" role="dialog" aria-label={shift.id ? 'Edit shift' : 'Add shift'}
        style={{ left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight }}>
        <div className="row between" style={{ marginBottom: 6 }}>
          <strong>{shift.id ? 'Edit shift' : 'Add shift'}</strong>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="stack tight">
          <div className="shift-context" data-testid="pop-context">
            <span className="shift-context-who">{f.staffId ? (personOf(f.staffId) || f.staffName || 'Someone') : 'Open shift (anyone)'}</span>
            <span className="shift-context-day">{f.date ? pretty(f.date, { weekday: 'long', day: 'numeric', month: 'long' }) : 'No day'}</span>
            {shift.id && !ro && !moving && (
              <button type="button" className="linkish" onClick={() => setMoving(true)}>Change person or day</button>
            )}
          </div>
          {shift.id && moving && (
            <div className="grid2">
              <Field label="Person">
                <select value={f.staffId || ''} onChange={set('staffId')} disabled={ro}>
                  <option value="">Open shift (anyone)</option>
                  {staff.map((p) => <option key={p.id} value={p.id}>{p.name}{p.jobTitle ? ` (${p.jobTitle})` : ''}</option>)}
                  {f.staffId && !staff.find((p) => p.id === f.staffId) && <option value={f.staffId}>{f.staffName} (left)</option>}
                </select>
              </Field>
              <Field label="Day"><input type="date" value={f.date} onChange={set('date')} disabled={ro} /></Field>
            </div>
          )}
          <div className="grid2">
            <Field label="Start"><input type="time" value={f.start} onChange={set('start')} disabled={ro} /></Field>
            <Field label="Finish"><input type="time" value={f.end} onChange={set('end')} disabled={ro} /></Field>
          </div>
          <div className="grid2">
            <Field label="Break start"><input type="time" value={f.breakStart} onChange={set('breakStart')} disabled={ro} data-testid="break-start" /></Field>
            <Field label="Break (minutes)">
              <input type="number" inputMode="numeric" min="1" max="720" step="1" placeholder="e.g. 30"
                value={f.breakMins} onChange={set('breakMins')} disabled={ro} data-testid="break-mins" />
            </Field>
          </div>
          {(breakEndsAt || overnight(f)) && (
            <div className="tiny muted" data-testid="pop-derived">
              {breakEndsAt ? `Break ends ${breakEndsAt}` : ''}{breakEndsAt && overnight(f) ? ' \u00b7 ' : ''}{overnight(f) ? 'Finishes next day' : ''}
            </div>
          )}
          <Field label="Area">
            <select value={f.area} onChange={set('area')} disabled={ro}>
              <option value="">—</option>
              {AREAS.map((a) => <option key={a}>{a}</option>)}
            </select>
          </Field>
          <label className="check leader-toggle">
            <input type="checkbox" checked={!!f.leader} disabled={ro} onChange={(e) => setF({ ...f, leader: e.target.checked })} data-testid="leader-toggle" />
            <span className="leader-star" aria-hidden="true">★</span>
            Shift leader
          </label>
          {dayEvents.length > 0 && (
            <Field label="For an event">
              <select value={f.eventId || ''} onChange={set('eventId')} disabled={ro}>
                <option value="">None</option>
                {dayEvents.map((e) => <option key={e.id} value={e.id}>{e.title}{e.start ? ` (${e.start})` : ''}</option>)}
              </select>
            </Field>
          )}
          <Field label="Notes"><input value={f.notes} onChange={set('notes')} maxLength={300} disabled={ro} /></Field>
          {err && <div className="err">{err}</div>}
          {ro ? <div className="warn">{dayLocked && dayLocked(shift.date) ? `${pretty(shift.date)} has been approved. Only the owner can change it.` : 'This week is finalised. Only the owner can change it.'}</div> : (
            <div className="actions">
              {(!shift.id || !shift.published) && <button className="btn secondary sm" disabled={busy} onClick={() => save(false)}>Save draft</button>}
              <button className="btn sm" disabled={busy} onClick={() => save(true)}>{shift.id && shift.published ? 'Save' : 'Save & publish'}</button>
              {shift.id && <button className="btn danger sm" disabled={busy} onClick={remove}>Delete</button>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
