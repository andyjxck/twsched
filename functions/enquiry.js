/* Private hire enquiries from the public website.
 *
 * Hardened after the October 2026 audit:
 *  - visitors can no longer write to Firestore directly; the only way in is the submitEnquiry
 *    callable, which validates everything on the server and rate-limits per caller and globally
 *  - no email ever goes to an address a visitor typed in (the customer thank-you email is gone)
 *  - the venue notification goes only to the owner-configured recipient (default: the primary owner)
 *  - single-line fields with CR/LF or other control characters are rejected (header injection)
 * Pure helpers live here so they can be unit tested without Firebase.
 */
const crypto = require('crypto');

const OCCASIONS = ['Birthday', 'Wedding or engagement', 'Christening', 'Wake', 'Work do', 'Christmas party', 'Other'];
const LIMITS = {
  perIpHour: 3, // enquiries per caller per hour
  perIpDay: 6, // enquiries per caller per day
  perEmailDay: 3, // enquiries per contact email per day
  globalDay: 40, // enquiries stored per day, whole site
  emailsDay: 20, // venue notification emails per day, whole site (in-app alert still shows the rest)
  maxBodyBytes: 8000,
  maxLinks: 3,
};

const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
// any C0/C1 control character, plus Unicode line/paragraph separators
const LINE_BREAK_OR_CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

class EnquiryError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const bad = (msg) => new EnquiryError('invalid-argument', msg);

function isEmail(v) {
  return typeof v === 'string' && v.length <= 150 && EMAIL_RE.test(v);
}

// Single-line text: must be a string, no line breaks or control characters at all.
function singleLine(v, max, label, { required = false, min = 0 } = {}) {
  if (v == null || v === '') {
    if (required) throw bad(`Please add your ${label}.`);
    return '';
  }
  if (typeof v !== 'string') throw bad(`Please check your ${label}.`);
  if (LINE_BREAK_OR_CONTROL.test(v)) throw bad(`Please check your ${label}.`);
  const s = v.trim();
  if (s.length > max) throw bad(`Your ${label} is too long.`);
  if (required && s.length < Math.max(1, min)) throw bad(`Please add your ${label}.`);
  return s;
}

// Multi-line text: keeps line breaks and tabs, removes every other control character.
function multiLine(v, max) {
  if (typeof v !== 'string') throw bad('Tell us a little about what you have in mind.');
  const s = v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/g, '').trim();
  if (!s) throw bad('Tell us a little about what you have in mind.');
  if (s.length > max) throw bad('Your message is too long.');
  return s;
}

function validDate(v, todayYmd) {
  if (v == null || v === '') return '';
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad('Please check the date.');
  const d = new Date(`${v}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw bad('Please check the date.');
  const today = new Date(`${todayYmd}T12:00:00Z`);
  const days = (d - today) / 86400000;
  if (days < -1 || days > 3 * 366) throw bad('Please pick a date in the next three years.');
  return v;
}

function validGuests(v) {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : (typeof v === 'string' && /^\d{1,4}$/.test(v.trim()) ? Number(v.trim()) : NaN);
  if (!Number.isInteger(n) || n < 0 || n > 1000) throw bad('Please check the number of guests.');
  return n;
}

/**
 * Validates a raw enquiry from the website. Returns { honeypot: true } for bot submissions
 * (caller should pretend success, store nothing), otherwise the clean enquiry.
 * Throws EnquiryError for anything malformed.
 */
function validateEnquiry(raw, todayYmd) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('Something went wrong. Please try again.');
  if (JSON.stringify(raw).length > LIMITS.maxBodyBytes) throw bad('Your enquiry is too long.');
  if (typeof raw.website === 'string' && raw.website.trim() !== '') return { honeypot: true };
  const name = singleLine(raw.name, 100, 'name', { required: true, min: 2 });
  const emailRaw = singleLine(raw.email, 150, 'email address', { required: true });
  if (!isEmail(emailRaw)) throw bad('Please check your email address.');
  const phone = singleLine(raw.phone, 40, 'phone number');
  if (phone && (phone.match(/[0-9]/g) || []).length < 5) throw bad('Please check your phone number.');
  const occasionRaw = singleLine(raw.occasion, 60, 'occasion');
  const occasion = OCCASIONS.includes(occasionRaw) ? occasionRaw : 'Other';
  const date = validDate(raw.date, todayYmd);
  const guests = validGuests(raw.guests);
  const message = multiLine(raw.message, 3000);
  const links = (message.match(/(https?:\/\/|www\.)/gi) || []).length;
  if (links > LIMITS.maxLinks) throw bad('Please leave out the links and tell us in words.');
  return { name, email: emailRaw.toLowerCase(), phone, occasion, date, guests, message };
}

// Caller IP for rate limiting. On Cloud Run (2nd gen functions) Google's front end appends the
// real client address as the LAST X-Forwarded-For entry; anything before it is caller-supplied
// and ignored.
function callerIp(rawRequest) {
  const h = rawRequest && rawRequest.headers && rawRequest.headers['x-forwarded-for'];
  const parts = String(Array.isArray(h) ? h.join(',') : h || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ip = parts.length ? parts[parts.length - 1] : (rawRequest && (rawRequest.ip || (rawRequest.socket && rawRequest.socket.remoteAddress))) || 'unknown';
  // group IPv6 callers by /64 so one host can't rotate through its own block
  if (ip.includes(':') && !ip.includes('.')) return ip.split(':').slice(0, 4).join(':') + '::/64';
  return ip;
}

function keyHash(kind, value, salt) {
  return crypto.createHash('sha256').update(`${salt}|${kind}|${value}`).digest('hex').slice(0, 40);
}

// Venue notification. Recipient is never taken from the enquiry; Reply-To uses the validated
// address as a structured value (nodemailer encodes it), the subject has no line breaks.
function ownerMessage(e, { to, appUrl, prettyDate, esc, summary }) {
  const toList = String(to || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!toList.length || toList.length > 3 || !toList.every(isEmail)) throw new Error('enquiry recipient is not a valid address');
  const rows = [
    ['Name', e.name], ['Email', e.email], ['Phone', e.phone], ['Occasion', e.occasion],
    ['Date', e.date ? prettyDate(e.date) : ''], ['Guests', e.guests || ''], ['Message', e.message],
  ];
  const text = rows.map(([k, v]) => `${k}: ${v || '-'}`).join('\n');
  const html = `<h2>New private hire enquiry</h2><table cellpadding="6">${rows
    .map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v || '-').replace(/\n/g, '<br>')}</td></tr>`)
    .join('')}</table><p><a href="${appUrl}#/enquiries">Open in the staff app</a></p>`;
  const msg = {
    to: toList,
    subject: `Private hire enquiry: ${summary}`.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').slice(0, 160),
    text: `${text}\n\nStaff app: ${appUrl}#/enquiries`,
    html,
  };
  if (isEmail(e.email)) msg.replyTo = { name: String(e.name || '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029"<>]/g, ' ').slice(0, 100), address: e.email };
  return msg;
}

// Recipients an owner may configure for enquiry emails: up to 3 valid addresses, comma separated.
function parseRecipients(v) {
  if (v == null || String(v).trim() === '') return '';
  if (typeof v !== 'string' || LINE_BREAK_OR_CONTROL.test(v)) throw bad('Enter up to three email addresses, separated by commas.');
  const list = v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length || list.length > 3 || !list.every(isEmail)) throw bad('Enter up to three email addresses, separated by commas.');
  return [...new Set(list)].join(', ');
}

module.exports = { OCCASIONS, LIMITS, EnquiryError, isEmail, validateEnquiry, callerIp, keyHash, ownerMessage, parseRecipients };
