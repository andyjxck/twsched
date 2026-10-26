// Day-by-day rota approval: the small tick in each day's header on the manager rota.
// The lock itself is enforced on the server (firestore.rules + Cloud Functions approveDay / unapproveDay);
// this file only shows it and calls those functions.
import React, { useEffect, useMemo, useState } from 'react';
import { collection, query, where } from 'firebase/firestore';
import { db, call, niceError } from './firebase.js';
import { useLive } from './ui.jsx';
import { pretty, tsDate } from './util.js';
import './dayApproval.css';

const ms = (t) => { const d = tsDate(t); return d ? d.getTime() : 0; };

// Live approvals for a week: { get(date), isApproved(date) }
export function useDayLocks(weekStart, weekEnd) {
  const live = useLive(() => query(collection(db, 'days'), where('date', '>=', weekStart), where('date', '<=', weekEnd)), [weekStart]);
  return useMemo(() => {
    const map = {};
    (live.docs || []).forEach((d) => { if (d.status === 'approved') map[d.date || d.id] = d; });
    return { get: (date) => map[date] || null, isApproved: (date) => !!map[date] };
  }, [live.docs]);
}

function useNow(active) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function TickIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <path d="M3.2 8.4l3 3 6.6-6.8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true" focusable="false">
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
      <path d="M5.2 7V5.2a2.8 2.8 0 015.6 0V7" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

// The tick for one day header.
//   not approved: manager/owner sees an empty tick button to approve that date
//   approved: filled tick + padlock. The approver can untick for 5 minutes (countdown shown);
//             after that it is locked for good for managers. The owner can always unlock.
export function DayTick({ date, info, session, weekApproved, toast }) {
  const [busy, setBusy] = useState(false);
  const graceEnd = info ? ms(info.graceUntil) : 0;
  const mine = !!info && info.approvedBy === session.user.uid;
  const now = useNow(!!info && mine && graceEnd > Date.now());
  const left = Math.max(0, graceEnd - now);
  const inGrace = mine && left > 0;
  const dayName = pretty(date, { weekday: 'long', day: 'numeric', month: 'long' });
  const short = pretty(date, { weekday: 'short', day: 'numeric', month: 'short' });

  if (!session.isManager) {
    return info ? <span className="daytick on static" role="img" aria-label={`${dayName} approved`} title="Approved"><TickIcon /></span> : null;
  }

  async function approve() {
    if (!window.confirm(`Approve ${short}?\n\nAny draft shifts that day get published, and after that only the owner can change that day's shifts.\nYou can undo it for 5 minutes.`)) return;
    setBusy(true);
    try {
      const r = await call('approveDay', { date });
      toast(`${short} approved${r.published ? `, ${r.published} draft${r.published === 1 ? '' : 's'} published` : ''}. ${session.isOwner ? '' : 'You can undo it for 5 minutes.'}`.trim());
    } catch (e) {
      toast(niceError(e), 'warn');
    } finally {
      setBusy(false);
    }
  }
  async function unapprove() {
    const msg = session.isOwner && !inGrace
      ? `Unlock ${short}? Managers will be able to change its shifts again.`
      : `Undo the approval for ${short}?`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      await call('unapproveDay', { date });
      toast(`${short} is no longer approved.`);
    } catch (e) {
      toast(niceError(e), 'warn');
    } finally {
      setBusy(false);
    }
  }

  if (!info) {
    if (weekApproved && !session.isOwner) return null; // the whole week is already finalised
    return (
      <button type="button" className="daytick" onClick={approve} disabled={busy}
        aria-label={`Approve ${dayName}. Only the owner can change it after that.`} title={`Approve ${short}`}
        data-testid={`daytick-${date}`}>
        <TickIcon />
      </button>
    );
  }

  const when = ms(info.approvedAt) ? new Date(ms(info.approvedAt)).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : '';
  const by = `Approved by ${info.approvedByName || 'a manager'}${when ? `, ${when}` : ''}`;
  const canUndo = session.isOwner || inGrace;
  const mmss = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;
  return (
    <span className="daytick-wrap" data-testid={`daytick-${date}`}>
      {canUndo ? (
        <button type="button" className="daytick on" onClick={unapprove} disabled={busy} aria-pressed="true"
          aria-label={`${dayName} is approved and locked. ${by}. ${inGrace ? `Untick to undo, ${mmss} left.` : 'Untick to unlock it.'}`}
          title={`${by}. ${inGrace ? `Untick to undo (${mmss} left)` : 'Untick to unlock'}`}>
          <TickIcon />
        </button>
      ) : (
        <span className="daytick on static" role="img" tabIndex={0}
          aria-label={`${dayName} is approved and locked. ${by}. Only the owner can change it.`}
          title={`${by}. Locked: only the owner can change it.`}>
          <TickIcon />
        </span>
      )}
      <span className="daytick-state" aria-hidden="true">
        <LockIcon />{inGrace ? ` Undo ${mmss}` : ' Locked'}
      </span>
    </span>
  );
}
