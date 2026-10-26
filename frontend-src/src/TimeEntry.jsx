import React, { useRef, useState } from 'react';
import { digits, splitDraft, joinDraft, segmentError, pad, shouldAdvance, parsePastedTime } from './timeDraft.js';
import './timeentry.css';

function focusAndSelect(ref) {
  const el = ref && ref.current;
  if (!el) return;
  el.focus();
  try { el.select(); } catch { /* some browsers refuse select on focus */ }
}

function focusAtEnd(ref) {
  const el = ref && ref.current;
  if (!el) return;
  el.focus();
  const n = el.value.length;
  try { el.setSelectionRange(n, n); } catch { /* ignore */ }
}

// A 24-hour time typed as two boxes: hours then minutes. Typing the second digit of the
// hours moves to the minutes; typing the second digit of the minutes moves to `nextRef`
// (if given). Backspace in an empty box goes back to the previous box. Paste "19:30"
// into either box to fill both. `value` / onChange(draft) use the draft format from timeDraft.js.
export default function TimeEntry({ id, label, value, onChange, hoursRef, minutesRef, nextRef, prevRef, error, hint, testid }) {
  const ownH = useRef(null);
  const ownM = useRef(null);
  const hRef = hoursRef || ownH;
  const mRef = minutesRef || ownM;
  const justFocused = useRef(false);
  const [touchedErr, setTouchedErr] = useState('');
  const [h, m] = splitDraft(value);

  const liveErr = segmentError('hours', h) || segmentError('minutes', m);
  const shownErr = error || liveErr || touchedErr;
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;
  const describedBy = [hint ? hintId : '', shownErr ? errId : ''].filter(Boolean).join(' ') || undefined;

  function emit(nh, nm) {
    setTouchedErr('');
    onChange(joinDraft(nh, nm));
  }

  function onSeg(kind) {
    return (e) => {
      const prev = kind === 'hours' ? h : m;
      const next = digits(e.target.value);
      const nh = kind === 'hours' ? next : h;
      const nm = kind === 'hours' ? m : next;
      emit(nh, nm);
      const inputType = e.nativeEvent && e.nativeEvent.inputType;
      // focus change happens inside the input event itself, so phone keyboards stay open
      if (shouldAdvance(kind, prev, next, inputType)) {
        if (kind === 'hours') focusAndSelect(mRef);
        else if (nextRef) focusAndSelect(nextRef);
      }
    };
  }

  function onKeyDown(kind) {
    return (e) => {
      const cur = digits(e.target.value);
      if (e.key === 'Backspace' && !cur && !e.target.selectionEnd) {
        const back = kind === 'minutes' ? hRef : prevRef;
        if (back && back.current) { e.preventDefault(); focusAtEnd(back); }
        return;
      }
      // ":" or "." after the hours jumps to the minutes ("9" becomes "09")
      if (kind === 'hours' && (e.key === ':' || e.key === '.') ) {
        e.preventDefault();
        if (cur) {
          emit(pad(cur), m);
          focusAndSelect(mRef);
        }
      }
    };
  }

  function onPaste(e) {
    const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
    const t = parsePastedTime(text);
    if (t) {
      e.preventDefault();
      emit(t[0], t[1]);
      if (nextRef) focusAndSelect(nextRef); else focusAtEnd(mRef);
      return;
    }
    // one or two plain digits go through the normal typing path; anything else is refused
    if (!/^\s*\d{1,2}\s*$/.test(text)) {
      e.preventDefault();
      setTouchedErr('Paste a time like 19:30, or type the numbers.');
    }
  }

  function onBlur(kind) {
    return (e) => {
      justFocused.current = false;
      const cur = digits(e.target.value); // read the box itself: state may not have re-rendered yet
      if (cur.length === 1) {
        if (kind === 'hours') emit(pad(cur), m); else emit(h, pad(cur));
      }
    };
  }

  function onFocus(e) {
    justFocused.current = true;
    try { e.target.select(); } catch { /* ignore */ }
  }

  // keep the select-all from onFocus when the click/tap that focused the box ends
  function onMouseUp(e) {
    if (justFocused.current) { e.preventDefault(); justFocused.current = false; }
  }

  const common = {
    type: 'text',
    inputMode: 'numeric',
    pattern: '[0-9]*',
    maxLength: 2,
    autoComplete: 'off',
    autoCorrect: 'off',
    spellCheck: false,
    enterKeyHint: 'next',
    onFocus,
    onMouseUp,
    'aria-describedby': describedBy,
  };

  return (
    <fieldset className="timeentry" id={id} data-testid={testid}>
      <legend>{label}</legend>
      <div className="te-row">
        <input
          {...common}
          ref={hRef}
          value={h}
          placeholder="HH"
          aria-label={`${label}: hours, 00 to 23`}
          aria-invalid={segmentError('hours', h) || error ? 'true' : undefined}
          onChange={onSeg('hours')}
          onKeyDown={onKeyDown('hours')}
          onPaste={onPaste}
          onBlur={onBlur('hours')}
          data-seg="hours"
        />
        <span className="te-colon" aria-hidden="true">:</span>
        <input
          {...common}
          ref={mRef}
          value={m}
          placeholder="MM"
          aria-label={`${label}: minutes, 00 to 59`}
          aria-invalid={segmentError('minutes', m) || error ? 'true' : undefined}
          onChange={onSeg('minutes')}
          onKeyDown={onKeyDown('minutes')}
          onPaste={onPaste}
          onBlur={onBlur('minutes')}
          data-seg="minutes"
        />
      </div>
      {hint && <div className="te-hint" id={hintId}>{hint}</div>}
      {shownErr && <div className="te-err" id={errId} role="alert">{shownErr}</div>}
    </fieldset>
  );
}
