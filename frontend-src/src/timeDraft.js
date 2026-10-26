// Pure helpers for the segmented 24-hour time entry (hours box + minutes box).
// A draft is what the boxes hold while someone types: "" (nothing), or "h:m" where
// either side may be empty or one digit ("1:", "19:3"). Saved values stay "HH:MM" or "".

export const MAX = { hours: 23, minutes: 59 };

export function digits(s) {
  return String(s == null ? '' : s).replace(/\D/g, '').slice(0, 2);
}

export function splitDraft(v) {
  const s = String(v == null ? '' : v);
  if (!s) return ['', ''];
  const i = s.indexOf(':');
  if (i < 0) return [digits(s), ''];
  return [digits(s.slice(0, i)), digits(s.slice(i + 1))];
}

export function joinDraft(h, m) {
  return h || m ? `${h}:${m}` : '';
}

export function segmentError(kind, s) {
  if (s.length === 2 && Number(s) > MAX[kind]) {
    return kind === 'hours' ? 'Hours go from 00 to 23.' : 'Minutes go from 00 to 59.';
  }
  return '';
}

export function pad(s) {
  return s.length === 1 ? `0${s}` : s;
}

// Move on only when the person has just typed (or pasted) the second digit of a box,
// building it up from fewer digits, and the box now holds a valid value. Focusing a box,
// deleting, or swapping one digit of a full box never moves the cursor.
export function shouldAdvance(kind, prev, next, inputType) {
  if (!inputType || !String(inputType).startsWith('insert')) return false;
  if (next.length !== 2 || prev.length >= 2) return false;
  return !segmentError(kind, next);
}

// "19:30", "19.30", "1930", "9:05", "19h30" -> ["19", "30"]; anything else -> null.
export function parsePastedTime(text) {
  const m = String(text || '').trim().match(/^(\d{1,2})\s*[:.h]?\s*(\d{2})$/i);
  if (!m) return null;
  const h = pad(m[1]);
  const mm = m[2];
  if (Number(h) > 23 || Number(mm) > 59) return null;
  return [h, mm];
}

// Turn a draft into what gets saved. Returns { value } or { error }.
export function normaliseTime(draft, label = 'time') {
  const [h, m] = splitDraft(draft);
  if (!h && !m) return { value: '' };
  if (!h || !m) return { error: `Finish the ${label}: it needs hours and minutes, or clear both boxes.` };
  const hh = pad(h);
  const mm = pad(m);
  if (Number(hh) > 23) return { error: `The ${label} hours go from 00 to 23.` };
  if (Number(mm) > 59) return { error: `The ${label} minutes go from 00 to 59.` };
  return { value: `${hh}:${mm}` };
}
