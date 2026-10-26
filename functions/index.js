/* Cloud Functions for the White Swan (Henley-in-Arden) staff app + website.
 *
 * Callable (from the staff app):
 *   createStaff, updateStaff, deleteStaff   - shared staff accounts + roles (custom claims)
 *   publishWeek                             - publish a week's rota and notify staff
 *   getMailSettings, setMailSettings,
 *   sendTestEmail                           - owner-only SMTP settings for outgoing email
 * Triggers:
 *   submitEnquiry     - the ONLY way the public website can create an enquiry (validated,
 *                       rate-limited server-side; visitors cannot write to Firestore directly)
 *   onEnquiryCreated  - enquiry -> in-app alert to managers + email to the owner-set recipient only
 *   onShiftWritten    - published shift added/changed/removed -> notify the staff member
 *   onEventWritten    - rebuild the public events feed (public/events) for the website
 *   refreshEventsFeed - daily rebuild so past events drop off the feed
 *   onTimeOffWritten  - requests -> managers, decisions -> staff member
 *   onPayslipCreated  - tell staff a new payslip is ready
 */
const { setGlobalOptions } = require('firebase-functions/v2');
const { HttpsError } = require('firebase-functions/v2/https');
// Every callable goes through gatedOnCall: an account that still has to choose its first password
// (temporary password from Team) can call nothing except completePasswordChange. See onboarding.js.
const onboarding = require('./onboarding');
const onCall = onboarding.gatedOnCall;
const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const enquiry = require('./enquiry');
const dayApproval = require('./dayApproval');
const availability = require('./availability');
const documents = require('./documents');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();
const { FieldValue } = require('firebase-admin/firestore');

setGlobalOptions({ region: 'europe-west2', maxInstances: 5, memory: '256MiB' });

// SMTP password (Gmail app password) lives in Google Secret Manager, never in Firestore, code or
// the browser. Only functions that send email are bound to it. A password typed into the owner's
// Settings screen (stored in the server-only private/mail doc) still overrides it if ever set.
const SMTP_PASS = defineSecret('SMTP_PASS');
const MAIL = { secrets: [SMTP_PASS] };

const SITE_URL = 'https://andyjxck.github.io/wshenley/';
const { APP_URL, APP_ORIGINS, LOCAL_ORIGIN } = require('./siteConfig'); // https://tws-rota.co.uk/ (shared with onboarding.js and passwordReset.js)
// User types (Andy, 21 Oct): owner, manager, payroll (payroll tools only, not on the rota), staff (team member).
const ROLES = ['owner', 'manager', 'payroll', 'staff'];
// Permissions (Andy, 26 Oct): ANY owner can change anything - owners, managers, payroll and team
// members: user types, logins, temporary passwords, switching logins on/off and removing people.
// Managers run the rota and the day-to-day (shifts, events, time off, enquiries). They can NOT add,
// edit or remove staff, send logins/temporary passwords, switch logins on/off or change roles, and
// they can NOT create or edit payroll (hours sign-off, pay settings, rates, payslips, contracts).
// They can still see the team (read-only) to build the rota. Enforced here and in firestore.rules /
// storage.rules; the app hides those controls for managers.
// There is no "main owner" any more. The primaryOwner claim below is a leftover label for Stella and
// Tom and grants nothing extra anywhere (functions, firestore.rules, storage.rules or the app).
const PRIMARY_OWNER_EMAILS = ['stellablizzard@gmail.com', 'thomas.meehan@hotmail.co.uk'];
// Enquiries still go here when no recipient has been set in Settings (unchanged).
const PRIMARY_OWNER_EMAIL = 'andyblewett9@gmail.com';
// Safeguard: never leave the app without an active owner. True if someone other than `uid` is
// still an active owner who has not left.
async function anotherActiveOwner(uid) {
  const snap = await db.collection('staff').where('role', '==', 'owner').get();
  return snap.docs.some((x) => x.id !== uid && x.get('active') !== false && x.get('terminated') !== true);
}
async function claimsFor(uid, role) {
  const u = await auth.getUser(uid);
  const c = { ...(u.customClaims || {}), role };
  if (role === 'owner' && PRIMARY_OWNER_EMAILS.includes(String(u.email || '').toLowerCase())) c.primaryOwner = true;
  else delete c.primaryOwner;
  return c;
}
async function staffName(uid) {
  const s = await db.doc(`staff/${uid}`).get();
  return (s.exists && s.get('name')) || '';
}
// Monday (YYYY-MM-DD) of the week containing ymd
function mondayOf(ymd) {
  const d = new Date(`${ymd}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}
async function weekStatus(weekStart) {
  const w = await db.doc(`weeks/${weekStart}`).get();
  return w.exists ? w.get('status') || '' : '';
}

// ---------------------------------------------------------------- helpers
function callerRole(req) {
  return (req.auth && req.auth.token && req.auth.token.role) || '';
}
function requireRole(req, roles) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Please sign in.');
  if (!roles.includes(callerRole(req))) {
    throw new HttpsError('permission-denied', 'You do not have permission to do that.');
  }
}
// Staff accounts are owner-only (Andy, 26 Oct: "Managers CANNOT ADD STAFF. OR EDIT STAFF.").
function requireOwner(req, message) {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Please sign in.');
  if (callerRole(req) !== 'owner') throw new HttpsError('permission-denied', message);
}
function clean(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
function tempPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(10);
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return `Swan-${s.slice(0, 5)}-${s.slice(5)}`;
}
// YYYY-MM-DD for "today" in the UK
function londonToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
}
function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function prettyDate(ymd) {
  if (!ymd) return '';
  const d = new Date(`${ymd}T12:00:00Z`);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function notify(uids, note) {
  const list = [...new Set((uids || []).filter(Boolean))];
  if (!list.length) return;
  const batch = db.batch();
  for (const uid of list) {
    batch.set(db.collection('notifications').doc(), {
      uid,
      title: clean(note.title, 120),
      body: clean(note.body || '', 500),
      link: clean(note.link || '', 120),
      // Enquiry alerts are for owners/managers only; staff-level feeds filter on this flag (rules enforce it).
      managerOnly: note.managerOnly === true || String(note.link || '').startsWith('#/enquiries'),
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
}

async function managerIds() {
  const snap = await db.collection('staff').where('role', 'in', ['owner', 'manager']).get();
  // the hidden developer (maintenance) login gets no manager alerts
  return snap.docs.filter((d) => d.get('active') !== false && d.get('developer') !== true).map((d) => d.id);
}

// ---------------------------------------------------------------- email
function secretPass() {
  try {
    return (SMTP_PASS.value() || '').replace(/\s+/g, '');
  } catch (e) {
    return ''; // function not bound to the secret
  }
}
async function mailSettings() {
  const snap = await db.doc('private/mail').get();
  if (!snap.exists) return null;
  const m = snap.data();
  return { ...m, pass: m.pass || secretPass(), passFromSecret: !m.pass && !!secretPass() };
}
// Where enquiry emails go: the owner-configured list, else the primary owner. Never visitor input.
function enquiryRecipient(m) {
  try {
    return enquiry.parseRecipients(m.enquiryTo) || PRIMARY_OWNER_EMAIL;
  } catch (e) {
    return PRIMARY_OWNER_EMAIL;
  }
}
function mailReady(m) {
  return !!(m && m.host && m.user && m.pass);
}
async function sendMail(msg, settings) {
  const m = settings || (await mailSettings());
  if (!mailReady(m) || m.enabled === false) return { sent: false, reason: 'Email is not set up yet.' };
  const nodemailer = require('nodemailer');
  const port = Number(m.port) || 465;
  const transport = nodemailer.createTransport({
    host: m.host,
    port,
    secure: m.secure != null ? !!m.secure : port === 465,
    auth: { user: m.user, pass: m.pass },
  });
  const info = await transport.sendMail({
    from: m.from || `The White Swan <${m.user}>`,
    ...msg,
  });
  return { sent: true, id: info.messageId };
}
async function emailStaff(uids, subject, text) {
  const m = await mailSettings();
  if (!mailReady(m) || m.enabled === false || m.emailStaff === false) return;
  for (const uid of new Set(uids)) {
    try {
      const s = await db.doc(`staff/${uid}`).get();
      const to = s.exists && s.get('email');
      if (!to || s.get('active') === false) continue;
      await sendMail({ to, subject, text: `${text}\n\nOpen the staff app: ${APP_URL}` }, m);
    } catch (e) {
      logger.warn('staff email failed', uid, e.message);
    }
  }
}

// ---------------------------------------------------------------- staff accounts
exports.createStaff = onCall(MAIL, async (req) => {
  requireOwner(req, 'Only management can add or change staff.');
  const d = req.data || {};
  const name = clean(d.name, 80);
  const email = clean(d.email, 150).toLowerCase();
  const role = ROLES.includes(d.role) ? d.role : 'staff';
  if (name.length < 2) throw new HttpsError('invalid-argument', 'Enter a name.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !enquiry.isEmail(email)) throw new HttpsError('invalid-argument', 'Enter a valid email address.');
  await onboardingFns.takeInviteSlot(req.auth.uid, null);
  let user;
  try {
    // No password yet: the temporary one is set (and the account gated) by onboarding.sendLogin below.
    user = await auth.createUser({ email, displayName: name, emailVerified: false });
  } catch (e) {
    if (e.code === 'auth/email-already-exists') throw new HttpsError('already-exists', 'Someone already has a login with that email. If they never got their login, open them in Team and tap “Resend login”.');
    if (e.code === 'auth/invalid-email') throw new HttpsError('invalid-argument', 'Enter a valid email address.');
    throw new HttpsError('internal', 'The login could not be created. Try again.');
  }
  await auth.setCustomUserClaims(user.uid, { role, [onboarding.CLAIM]: true });
  await db.doc(`staff/${user.uid}`).set({
    name,
    email,
    role,
    jobTitle: clean(d.jobTitle, 60),
    phone: clean(d.phone, 40),
    onRota: true, // everyone who works here is on the rota; there is no opt-out
    active: true,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: req.auth.uid,
  });
  await notify([user.uid], { title: 'Welcome to White Swan Staff', body: 'Your rota, payslips and time off all live here.', link: '#/' });
  // Temporary password: generated server-side, emailed to them; handed back to the manager only if
  // the email could not be sent. If issuing it fails, undo the half-made login so a retry is clean.
  try {
    return await onboardingFns.sendLogin({ uid: user.uid, name, email, byUid: req.auth.uid, isNew: true });
  } catch (e) {
    logger.error('could not issue first login', { err: e.message });
    await auth.deleteUser(user.uid).catch(() => {});
    await db.doc(`staff/${user.uid}`).delete().catch(() => {});
    await db.doc(`${onboarding.GATE}/${user.uid}`).delete().catch(() => {});
    throw new HttpsError('internal', 'The login could not be created. Nothing was saved; try again.');
  }
});

exports.updateStaff = onCall(async (req) => {
  requireOwner(req, 'Only management can add or change staff.');
  const d = req.data || {};
  const uid = clean(d.uid, 128);
  if (!uid) throw new HttpsError('invalid-argument', 'Missing staff member.');
  const ref = db.doc(`staff/${uid}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Staff member not found.');
  const current = snap.data();
  const update = {};
  const authUpdate = {};
  if (d.name != null) {
    const name = clean(d.name, 80);
    if (name.length < 2) throw new HttpsError('invalid-argument', 'Enter a name.');
    update.name = name;
    authUpdate.displayName = name;
  }
  if (d.jobTitle != null) update.jobTitle = clean(d.jobTitle, 60);
  if (d.phone != null) update.phone = clean(d.phone, 40);
  // No rota opt-out: any edit puts a still-employed person back on the rota if an old flag hid them.
  if (!current.terminated && current.onRota === false && current.developer !== true) update.onRota = true;
  if (current.terminated) throw new HttpsError('failed-precondition', 'This person has left. Add them again as a new login if they come back.');
  if (d.role != null && d.role !== current.role) {
    if (!ROLES.includes(d.role)) throw new HttpsError('invalid-argument', 'Unknown role.');
    if (uid === req.auth.uid) throw new HttpsError('failed-precondition', 'You cannot change your own role.');
    if (current.role === 'owner' && !(await anotherActiveOwner(uid))) {
      throw new HttpsError('failed-precondition', 'There has to be at least one owner. Make someone else an owner first.');
    }
    update.role = d.role;
  }
  if (d.active != null && d.active !== current.active) {
    if (uid === req.auth.uid) throw new HttpsError('failed-precondition', 'You cannot switch off your own login.');
    if (d.active === false && current.role === 'owner' && !(await anotherActiveOwner(uid))) {
      throw new HttpsError('failed-precondition', 'There has to be at least one owner with a working login.');
    }
    update.active = !!d.active;
    authUpdate.disabled = !d.active;
  }
  // "New password" now goes through onboarding: emailed temporary password + forced change on next sign-in.
  if (d.resetPassword) {
    if (uid === req.auth.uid) throw new HttpsError('failed-precondition', 'Change your own password under Account › Change password.');
    if (update.active === false || (current.active === false && update.active !== true)) throw new HttpsError('failed-precondition', 'Switch their login back on first.');
    await onboardingFns.takeInviteSlot(req.auth.uid, uid);
  }
  if (Object.keys(authUpdate).length) await auth.updateUser(uid, authUpdate);
  if (update.role) await auth.setCustomUserClaims(uid, await claimsFor(uid, update.role));
  if (update.active === false || update.role) await auth.revokeRefreshTokens(uid);
  // Dropped to team member: clear any manager-only alerts (enquiries) they were sent as a manager.
  if (update.role === 'staff') {
    const old = await db.collection('notifications').where('uid', '==', uid).where('managerOnly', '==', true).get();
    if (!old.empty) { const b = db.batch(); old.docs.forEach((x) => b.delete(x.ref)); await b.commit(); }
  }
  let login = null;
  if (d.resetPassword) {
    const au = await auth.getUser(uid);
    login = await onboardingFns.sendLogin({ uid, name: update.name || current.name, email: au.email, byUid: req.auth.uid, isNew: false });
  }
  if (Object.keys(update).length) {
    update.updatedAt = FieldValue.serverTimestamp();
    update.updatedBy = req.auth.uid;
    await ref.update(update);
  }
  if (login) return { ok: true, emailSent: login.emailSent, reason: login.reason, expiresAt: login.expiresAt, tempPassword: login.tempPassword || null };
  return { ok: true, tempPassword: null };
});

// Terminate someone who has left.
// Removed: their login, future shifts, pending requests, unavailability and notifications, phone number.
// Kept (payroll/legal records): name, email, role, leaving date, past shifts and payslips.
exports.deleteStaff = onCall(async (req) => {
  requireOwner(req, 'Only management can remove staff.');
  const uid = clean((req.data || {}).uid, 128);
  if (!uid) throw new HttpsError('invalid-argument', 'Missing staff member.');
  if (uid === req.auth.uid) throw new HttpsError('failed-precondition', 'You cannot remove your own login.');
  const ref = db.doc(`staff/${uid}`);
  const snap = await ref.get();
  const cur = snap.exists ? snap.data() : {};
  if (cur.role === 'owner' && !(await anotherActiveOwner(uid))) {
    throw new HttpsError('failed-precondition', 'There has to be at least one owner. Make someone else an owner first.');
  }
  try {
    await auth.deleteUser(uid);
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw new HttpsError('internal', e.message);
  }
  const today = londonToday();
  const refs = [];
  const future = (await db.collection('shifts').where('staffId', '==', uid).get()).docs
    .filter((s) => s.get('date') >= today);
  // Shifts on an approved day or approved week can only be changed by the owner: a manager's
  // termination leaves those for the owner to sort out.
  let keptLocked = 0;
  if (callerRole(req) !== 'owner') {
    const lockedD = await dayApproval.approvedDays(future.map((s) => s.get('date')));
    const weekIds = [...new Set(future.map((s) => s.get('week') || mondayOf(s.get('date'))))];
    const lockedW = new Set();
    for (const w of weekIds) if ((await weekStatus(w)) === 'approved') lockedW.add(w);
    future.forEach((s) => {
      if (lockedD.has(s.get('date')) || lockedW.has(s.get('week') || mondayOf(s.get('date')))) keptLocked += 1;
      else refs.push(s.ref);
    });
  } else {
    future.forEach((s) => refs.push(s.ref));
  }
  (await db.collection('timeOff').where('staffId', '==', uid).get()).docs
    .filter((t) => t.get('status') === 'pending' || t.get('to') >= today).forEach((t) => refs.push(t.ref));
  (await db.collection('unavailability').where('staffId', '==', uid).get()).docs.forEach((t) => refs.push(t.ref));
  (await db.collection('requests').where('staffId', '==', uid).get()).docs
    .filter((t) => t.get('status') === 'pending').forEach((t) => refs.push(t.ref));
  (await db.collection('notifications').where('uid', '==', uid).get()).docs.forEach((t) => refs.push(t.ref));
  for (let i = 0; i < refs.length; i += 400) {
    const b = db.batch();
    refs.slice(i, i + 400).forEach((r) => b.delete(r));
    await b.commit();
  }
  await ref.set({
    name: cur.name || '', email: cur.email || '', role: cur.role || 'staff', jobTitle: cur.jobTitle || '',
    active: false, onRota: false, terminated: true, leftAt: today,
    terminatedBy: req.auth.uid, terminatedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true, removed: refs.length, keptLocked };
});

// ---------------------------------------------------------------- rota
async function publishDrafts(req, weekStart, approve) {
  requireRole(req, ['owner', 'manager']);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || mondayOf(weekStart) !== weekStart) throw new HttpsError('invalid-argument', 'Bad week.');
  const status = await weekStatus(weekStart);
  if (status === 'approved' && callerRole(req) !== 'owner') {
    throw new HttpsError('failed-precondition', 'This week has been approved and finalised. Only management can change it.');
  }
  const weekEnd = addDays(weekStart, 6);
  const snap = await db.collection('shifts').where('date', '>=', weekStart).where('date', '<=', weekEnd).get();
  // Drafts on a day that has been approved on its own stay as they are unless the owner publishes them.
  const lockedD = callerRole(req) === 'owner' ? new Set()
    : await dayApproval.approvedDays(snap.docs.map((d) => d.get('date')));
  const allDrafts = snap.docs.filter((d) => d.get('published') !== true);
  const unlockedDrafts = allDrafts.filter((d) => !lockedD.has(d.get('date')));
  const skippedLocked = allDrafts.length - unlockedDrafts.length;
  // A draft that puts someone on a day they are unavailable or on approved holiday is never published
  // (it stays a draft for a manager to move or reassign). Nothing is deleted or changed.
  const clashing = await availability.clashingIds(unlockedDrafts);
  // Right to Work no longer holds a shift back (Andy, 26 Oct): the rota can be built and published before
  // staff have uploaded their documents. The app still flags anyone missing them.
  const drafts = unlockedDrafts.filter((d) => !clashing.has(d.id));
  const skippedUnavailable = clashing.size;
  const skippedNoRtw = 0;
  const counts = {};
  for (let i = 0; i < drafts.length; i += 400) {
    const batch = db.batch();
    drafts.slice(i, i + 400).forEach((d) => {
      batch.update(d.ref, { published: true, updatedAt: FieldValue.serverTimestamp(), updatedBy: req.auth.uid });
    });
    await batch.commit();
  }
  snap.docs.forEach((d) => {
    const id = d.get('staffId');
    counts[id] = (counts[id] || 0) + 1;
  });
  const name = await staffName(req.auth.uid);
  const wk = { weekStart, status: approve || status === 'approved' ? 'approved' : 'published' };
  if (approve) Object.assign(wk, { approvedBy: req.auth.uid, approvedByName: name, approvedAt: FieldValue.serverTimestamp() });
  else Object.assign(wk, { publishedBy: req.auth.uid, publishedByName: name, publishedAt: FieldValue.serverTimestamp() });
  await db.doc(`weeks/${weekStart}`).set(wk, { merge: true });
  const changed = [...new Set(drafts.map((d) => d.get('staffId')).filter(Boolean))];
  const title = `Rota for week of ${prettyDate(weekStart)} is out`;
  await Promise.all(changed.map((uid) => notify([uid], {
    title,
    body: `You have ${counts[uid]} shift${counts[uid] === 1 ? '' : 's'} that week.`,
    link: `#/rota?week=${weekStart}`,
  })));
  await emailStaff(changed, title, `${title}. Have a look at your shifts in the staff app.`);
  return { published: drafts.length, staffNotified: changed.length, status: wk.status, skippedLocked, skippedUnavailable, skippedNoRtw };
}
exports.publishWeek = onCall(MAIL, async (req) => publishDrafts(req, clean((req.data || {}).weekStart, 10), false));
// Approving publishes any drafts and finalises the week: after this only the owner can change its shifts
// (enforced in firestore.rules via weeks/{weekStart}.status and in every callable here).
exports.approveWeek = onCall(MAIL, async (req) => publishDrafts(req, clean((req.data || {}).weekStart, 10), true));

// ---------------------------------------------------------------- requests (time off, swaps, problems)
// All decisions go through here so the deciding user is recorded server-side.
// Old app versions sent `paid` with every holiday decision; accept it only if it matches what was submitted.
function assertPaidUnchanged(r, d) {
  if (d.paid === undefined || d.paid === null) return;
  if (typeof d.paid !== 'boolean') throw new HttpsError('invalid-argument', 'Unknown holiday type.');
  const submittedPaid = r.paid !== false;
  if (d.paid !== submittedPaid) {
    const asked = submittedPaid ? 'paid' : 'unpaid';
    throw new HttpsError('failed-precondition', `This holiday was requested as ${asked}. Managers can only approve or decline it as ${asked}. If it should not be ${asked}, decline it.`);
  }
}
exports.decideRequest = onCall(async (req) => {
  requireRole(req, ['owner', 'manager']);
  const d = req.data || {};
  const coll = d.kind === 'timeOff' ? 'timeOff' : d.kind === 'request' ? 'requests' : '';
  if (!coll) throw new HttpsError('invalid-argument', 'Unknown request type.');
  const id = clean(d.id, 128);
  const status = clean(d.status, 20);
  const ref = db.doc(`${coll}/${id}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'That request no longer exists.');
  const r = snap.data();
  if (r.status !== 'pending') throw new HttpsError('failed-precondition', 'That request has already been decided.');
  const allowed = coll === 'requests' && r.kind === 'problem' ? ['resolved'] : ['approved', 'declined'];
  if (!allowed.includes(status)) throw new HttpsError('invalid-argument', 'Unknown decision.');
  const name = (await staffName(req.auth.uid)) || req.auth.token.email || 'Manager';
  const upd = {
    status, decidedBy: req.auth.uid, decidedByName: name, decidedAt: FieldValue.serverTimestamp(),
    managerNote: clean(d.note, 300),
  };
  // Holiday requests are decided exactly as submitted: a manager approves or declines them and can never
  // switch paid <-> unpaid (Andy, 20 Oct). `paid` is never written here, so the requester's choice stays on
  // the timeOff record (rota labels and notifications read it). A payload asking for the other type is refused.
  if (coll === 'timeOff') assertPaidUnchanged(r, d);
  if (coll === 'requests' && r.kind === 'swap' && status === 'approved') {
    const sref = db.doc(`shifts/${r.shiftId}`);
    const sh = await sref.get();
    if (!sh.exists) throw new HttpsError('failed-precondition', 'That shift has been deleted, so there is nothing to swap.');
    const wk = sh.get('week') || mondayOf(sh.get('date'));
    if ((await weekStatus(wk)) === 'approved' && callerRole(req) !== 'owner') {
      throw new HttpsError('failed-precondition', 'That week is finalised. Only management can change it.');
    }
    if (callerRole(req) !== 'owner' && (await dayApproval.dayApproved(sh.get('date')))) {
      throw new HttpsError('failed-precondition', `${prettyDate(sh.get('date'))} has been approved. Only management can change its shifts.`);
    }
    let toName = 'Open shift';
    if (r.toStaffId) {
      const t = await db.doc(`staff/${r.toStaffId}`).get();
      if (!t.exists || t.get('active') === false) throw new HttpsError('failed-precondition', 'The colleague is no longer on the team.');
      toName = t.get('name');
    }
    // refused (nothing changes) if the colleague is unavailable or on approved holiday that day
    await availability.reassignShift(sref, r.toStaffId || '', toName, req.auth.uid);
  }
  // approving holiday indexes it for the rota in the same transaction (see availability.js)
  if (coll === 'timeOff' && status === 'approved') await availability.approveTimeOff(ref, upd);
  else await ref.update(upd);
  if (coll === 'requests') {
    const label = r.kind === 'swap' ? 'Swap request' : 'Problem report';
    await notify([r.staffId], { title: `${label} ${status}`, body: `${r.shiftLabel || ''}${upd.managerNote ? ` - ${upd.managerNote}` : ''} (by ${name})`, link: '#/inbox' });
    if (r.kind === 'swap' && status === 'approved' && r.toStaffId) {
      await notify([r.toStaffId], { title: 'Shift passed to you', body: `${r.shiftLabel || ''} from ${r.staffName}`, link: '#/rota' });
    }
  }
  return { ok: true, decidedByName: name };
});

exports.onRequestCreated = onDocumentCreated('requests/{id}', async (event) => {
  const r = event.data.data();
  const title = r.kind === 'swap' ? 'Shift swap request' : 'Problem with a shift';
  await notify(await managerIds(), { title, body: `${r.staffName}: ${r.shiftLabel || ''}${r.toStaffName ? ` to ${r.toStaffName}` : ''}`, link: '#/inbox' });
});

function shiftLabel(s) {
  return `${prettyDate(s.date)} ${s.start}-${s.end}${s.area ? ` (${s.area})` : ''}`;
}
function pushNote(notes, uid, title, body) {
  if (uid) notes.push([uid, title, body]);
}
exports.onShiftWritten = onDocumentWritten({ document: 'shifts/{shiftId}', ...MAIL }, async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  const today = londonToday();
  const notes = [];
  if (before && after && !before.published && after.published) return; // publishWeek handles it
  if (after && after.published && after.date >= today) {
    if (!before || !before.published) {
      pushNote(notes, after.staffId, 'New shift added', shiftLabel(after));
    } else if (before.staffId !== after.staffId) {
      pushNote(notes, after.staffId, 'New shift added', shiftLabel(after));
      if (before.date >= today) pushNote(notes, before.staffId, 'Shift removed', `${shiftLabel(before)} has been given to someone else.`);
    } else if (before.date !== after.date || before.start !== after.start || before.end !== after.end
      || (before.area || '') !== (after.area || '') || (before.breakStart || '') !== (after.breakStart || '')
      || (before.breakEnd || '') !== (after.breakEnd || '')) {
      pushNote(notes, after.staffId, 'Shift changed', `${shiftLabel(before)} is now ${shiftLabel(after)}`);
    }
  } else if (before && before.published && before.date >= today && (!after || !after.published)) {
    pushNote(notes, before.staffId, 'Shift removed', `${shiftLabel(before)} has been taken off the rota.`);
  }
  for (const [uid, title, body] of notes) {
    await notify([uid], { title, body, link: '#/' });
    await emailStaff([uid], `${title}: ${body}`, `${title}: ${body}`);
  }
});

// ---------------------------------------------------------------- public events feed
async function rebuildEventsFeed() {
  const today = londonToday();
  const snap = await db.collection('events').where('onWebsite', '==', true).get();
  const events = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((e) => e.repeat === 'weekly' || e.date >= today)
    .map((e) => ({
      id: e.id,
      title: e.title || '',
      date: e.date,
      start: e.start || '',
      end: e.end || '',
      description: e.description || '',
      room: e.room || '',
      repeat: e.repeat === 'weekly' ? 'weekly' : 'none',
      weekday: new Date(`${e.date}T12:00:00Z`).getUTCDay(),
    }))
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
    .slice(0, 200);
  await db.doc('public/events').set({ events, generatedFor: today, updatedAt: FieldValue.serverTimestamp() });
  return events.length;
}
exports.onEventWritten = onDocumentWritten('events/{eventId}', async () => {
  const n = await rebuildEventsFeed();
  logger.info('events feed rebuilt', n);
});
exports.refreshEventsFeed = onSchedule({ schedule: '5 0 * * *', timeZone: 'Europe/London' }, async () => {
  await rebuildEventsFeed();
});

// ---------------------------------------------------------------- enquiries
// Random per-project salt for hashing caller IPs / emails in rate-limit docs (server-only).
let rateSalt = null;
async function getRateSalt() {
  if (rateSalt) return rateSalt;
  const ref = db.doc('private/rateLimitSalt');
  try {
    await ref.create({ salt: crypto.randomBytes(24).toString('hex'), createdAt: FieldValue.serverTimestamp() });
  } catch (e) {
    // already exists
  }
  rateSalt = (await ref.get()).get('salt');
  return rateSalt;
}

// Fixed-window counters in rateLimits/{hash} (no client access; expireAt drives a TTL policy).
// Increments every counter only if all of them are under their limit.
async function takeRateLimit(counters) {
  const salt = await getRateSalt();
  const now = Date.now();
  const refs = counters.map((c) => {
    const bucket = Math.floor(now / c.windowMs);
    return { ...c, bucket, ref: db.collection('rateLimits').doc(enquiry.keyHash(c.kind, `${c.value}|${bucket}`, salt)) };
  });
  return db.runTransaction(async (tx) => {
    const snaps = await Promise.all(refs.map((r) => tx.get(r.ref)));
    const over = refs.find((r, i) => (snaps[i].exists ? snaps[i].get('count') || 0 : 0) >= r.limit);
    if (over) return { ok: false, kind: over.kind };
    refs.forEach((r, i) => {
      const count = (snaps[i].exists ? snaps[i].get('count') || 0 : 0) + 1;
      tx.set(r.ref, { kind: r.kind, count, expireAt: new Date((r.bucket + 2) * r.windowMs) });
    });
    return { ok: true };
  });
}
const HOUR = 3600000;
const DAY = 24 * HOUR;

exports.submitEnquiry = onCall({
  // andyjxck.github.io stays: the hotel website (SITE_URL, andyjxck.github.io/wshenley) sends its enquiry form here.
  cors: ['https://andyjxck.github.io', ...APP_ORIGINS, LOCAL_ORIGIN],
  maxInstances: 2,
  timeoutSeconds: 20,
  invoker: 'public',
}, async (req) => {
  let e;
  try {
    e = enquiry.validateEnquiry(req.data, londonToday());
  } catch (err) {
    if (err instanceof enquiry.EnquiryError) throw new HttpsError(err.code, err.message);
    throw err;
  }
  const ip = enquiry.callerIp(req.rawRequest);
  const L = enquiry.LIMITS;
  const counters = [
    { kind: 'ip-hour', value: ip, windowMs: HOUR, limit: L.perIpHour },
    { kind: 'ip-day', value: ip, windowMs: DAY, limit: L.perIpDay },
    { kind: 'global-day', value: 'all', windowMs: DAY, limit: L.globalDay },
  ];
  if (!e.honeypot) counters.push({ kind: 'email-day', value: e.email, windowMs: DAY, limit: L.perEmailDay });
  const rl = await takeRateLimit(counters);
  if (!rl.ok) {
    logger.warn('enquiry rate limited', { kind: rl.kind });
    throw new HttpsError('resource-exhausted', 'We have had a lot of enquiries from here. Please call us on 01564 792623 instead.');
  }
  if (e.honeypot) {
    logger.info('enquiry honeypot hit; not stored');
    return { ok: true };
  }
  await db.collection('enquiries').add({
    ...e,
    source: 'website',
    status: 'new',
    via: 'submitEnquiry',
    createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

exports.onEnquiryCreated = onDocumentCreated({ document: 'enquiries/{id}', ...MAIL }, async (event) => {
  const e = event.data.data();
  const when = e.date ? prettyDate(e.date) : 'date not set';
  const summary = `${clean(e.name, 100)} - ${e.occasion || 'private hire'} - ${when}${e.guests ? ` - ${e.guests} guests` : ''}`;
  await notify(await managerIds(), { title: 'New private hire enquiry', body: summary, link: '#/enquiries', managerOnly: true });
  if (e.via !== 'submitEnquiry') {
    logger.warn('enquiry not created by submitEnquiry; no email sent');
    return;
  }
  const m = await mailSettings();
  if (!mailReady(m) || m.enabled === false) {
    logger.info('enquiry stored; email not configured');
    return;
  }
  // Global daily cap on venue emails, so a flood can't burn the Gmail sending quota.
  const cap = await takeRateLimit([{ kind: 'emails-day', value: 'all', windowMs: DAY, limit: enquiry.LIMITS.emailsDay }]);
  if (!cap.ok) {
    logger.warn('enquiry email skipped: daily cap reached');
    await event.data.ref.update({ emailSkipped: 'daily email limit reached' });
    return;
  }
  try {
    // The customer thank-you email was removed: nothing is ever sent to an address a visitor typed.
    await sendMail(enquiry.ownerMessage(e, { to: enquiryRecipient(m), appUrl: APP_URL, prettyDate, esc, summary }), m);
    await event.data.ref.update({ emailedAt: FieldValue.serverTimestamp() });
  } catch (err) {
    logger.error('enquiry email failed', err.message);
    await event.data.ref.update({ emailError: String(err.message).slice(0, 300) });
  }
});

// ---------------------------------------------------------------- time off + payslips
exports.onTimeOffWritten = onDocumentWritten({ document: 'timeOff/{id}', ...MAIL }, async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  if (!after) return;
  const range = after.from === after.to ? prettyDate(after.from) : `${prettyDate(after.from)} to ${prettyDate(after.to)}`;
  if (!before) {
    await notify(await managerIds(), { title: 'Time off request', body: `${after.staffName}: ${range}`, link: '#/inbox' });
  } else if (before.status !== after.status && ['approved', 'declined'].includes(after.status)) {
    const title = `Time off ${after.status}`;
    const kind = after.paid === false ? 'unpaid' : 'paid';
    await notify([after.staffId], { title, body: `${range} (${kind})${after.managerNote ? ` - ${after.managerNote}` : ''}${after.decidedByName ? ` (by ${after.decidedByName})` : ''}`, link: '#/inbox' });
    await emailStaff([after.staffId], `${title}: ${range}`, `Your time off request for ${range} has been ${after.status}.${after.managerNote ? `\nNote: ${after.managerNote}` : ''}`);
  }
});

exports.onPayslipCreated = onDocumentCreated({ document: 'payslips/{id}', ...MAIL }, async (event) => {
  const p = event.data.data();
  // Bulk upload with "Tell staff" switched off: file it quietly (no notification, no email).
  if (p.silent === true) {
    logger.info('payslip uploaded quietly', { staffId: p.staffId, by: p.uploadedBy, slot: p.slot });
    return;
  }
  await notify([p.staffId], { title: 'New payslip', body: `Your payslip for ${p.period} is ready to download.`, link: '#/payslips' });
  logger.info('payslip uploaded', { staffId: p.staffId, by: p.uploadedBy, taxYear: p.taxYear, taxMonth: p.taxMonth });
  await emailStaff([p.staffId], 'Your new payslip is ready', `Your payslip for ${p.period} is ready to download in the staff app (Payslips).`);
});

// ---------------------------------------------------------------- mail settings (owner only)
exports.getMailSettings = onCall(MAIL, async (req) => {
  requireRole(req, ['owner']);
  const m = (await mailSettings()) || {};
  return {
    host: m.host || '', port: m.port || 465, secure: m.secure != null ? !!m.secure : true,
    user: m.user || '', from: m.from || '', enquiryTo: m.enquiryTo || '',
    enquiryRecipient: enquiryRecipient(m), enabled: m.enabled !== false,
    emailStaff: m.emailStaff !== false,
    hasPassword: !!m.pass, passwordInSecretStore: !!m.passFromSecret,
  };
});
exports.setMailSettings = onCall(MAIL, async (req) => {
  requireRole(req, ['owner']);
  const d = req.data || {};
  const snap = await db.doc('private/mail').get();
  const current = snap.exists ? snap.data() : {};
  let enquiryTo;
  try {
    enquiryTo = enquiry.parseRecipients(d.enquiryTo);
  } catch (e) {
    throw new HttpsError('invalid-argument', e.message);
  }
  const user = clean(d.user, 150);
  if (user && !enquiry.isEmail(user)) throw new HttpsError('invalid-argument', 'The username must be the sending email address.');
  if (/[\r\n]/.test(String(d.from || ''))) throw new HttpsError('invalid-argument', 'Check the From name.');
  const from = clean(d.from, 150);
  const host = clean(d.host, 120);
  if (host && !/^[a-z0-9.-]+$/i.test(host)) throw new HttpsError('invalid-argument', 'Check the SMTP server name.');
  const next = {
    host,
    port: Number(d.port) || 465,
    secure: !!d.secure,
    user,
    from,
    enquiryTo,
    ackCustomer: false, // removed: never email addresses typed in by website visitors
    enabled: d.enabled !== false,
    emailStaff: d.emailStaff !== false,
    pass: d.pass ? String(d.pass).slice(0, 200) : current.pass || '',
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: req.auth.uid,
  };
  if (d.clearPassword) next.pass = '';
  await db.doc('private/mail').set(next);
  return { ok: true, ready: mailReady({ ...next, pass: next.pass || secretPass() }) && next.enabled };
});
exports.sendTestEmail = onCall(MAIL, async (req) => {
  requireRole(req, ['owner']);
  const m = await mailSettings();
  if (!mailReady(m)) throw new HttpsError('failed-precondition', 'Fill in the server, username and password first.');
  try {
    await sendMail({
      to: enquiryRecipient(m),
      subject: 'White Swan staff app: test email',
      text: 'This is a test from the White Swan staff app. Enquiry emails will arrive like this.',
    }, m);
    return { ok: true, to: enquiryRecipient(m) };
  } catch (e) {
    throw new HttpsError('failed-precondition', `The mail server said: ${e.message}`);
  }
});

// ---------------------------------------------------------------- password reset (rate-limited)
exports.requestPasswordReset = require('./passwordReset').requestPasswordReset;

// New staff: emailed temporary password, must choose their own on first sign-in. See onboarding.js.
const onboardingFns = onboarding.makeFunctions({ sendMail, mailSettings, mailReady, MAIL, staffName, clean });
exports.resendStaffLogin = onboardingFns.resendStaffLogin;
exports.completePasswordChange = onboardingFns.completePasswordChange;
exports.expireTempLogins = onboardingFns.expireTempLogins;

// Day-by-day rota approval (tick on each day). See dayApproval.js.
{
  const dayFns = dayApproval.makeFunctions({ notify, emailStaff, MAIL });
  exports.approveDay = dayFns.approveDay;
  exports.unapproveDay = dayFns.unapproveDay;
}

// No one (owner included) can be put on a shift while unavailable or on approved holiday. See availability.js.
{
  const av = availability.makeFunctions({ requireRole, callerRole, staffName });
  exports.addUnavailability = av.addUnavailability;
  exports.onUnavailabilityBlocks = av.onUnavailabilityBlocks;
  exports.onTimeOffBlocks = av.onTimeOffBlocks;
  exports.refreshRotaBlocks = av.refreshRotaBlocks;
}


// Staff documents: Right to Work verification + rtwStatus tick, payslip file check (see documents.js)
exports.onStaffDocWritten = documents.onStaffDocWritten;

// ---------------------------------------------------------------- payroll: cut-off reminder
// Every morning: if the next cut-off (payroll/settings) is reminderDays away or closer, tell payroll users
// once per pay period (in-app notification). Falls back to the owners when nobody has the payroll type.
const payperiods = require('./payperiods');
async function sendCutoffReminder(today) {
  const set = await db.doc('payroll/settings').get();
  if (!set.exists) return { sent: false, reason: 'no pay settings' };
  const p = payperiods.upcomingCutoff(set.data(), today);
  if (today < p.reminder || today > p.cutoff) return { sent: false, reason: 'not yet', period: p };
  const marker = db.doc(`payrollReminders/${p.start}`);
  const already = await marker.get();
  if (already.exists) return { sent: false, reason: 'already sent', period: p };
  const people = (await db.collection('staff').where('role', 'in', ['payroll', 'owner']).get()).docs
    .filter((d) => d.get('active') !== false && !d.get('terminated'));
  const payroll = people.filter((d) => d.get('role') === 'payroll').map((d) => d.id);
  const to = payroll.length ? payroll : people.map((d) => d.id);
  const days = payperiods.daysBetween(today, p.cutoff);
  await notify(to, {
    title: days <= 0 ? 'Payroll cut-off is today' : `Payroll cut-off in ${days} day${days === 1 ? '' : 's'}`,
    body: `Hours for ${prettyDate(p.start)} to ${prettyDate(p.end)} are due ${prettyDate(p.cutoff)}. Pay day ${prettyDate(p.payDate)}.`,
    link: '#/payroll',
  });
  await marker.set({ period: p.start, cutoff: p.cutoff, sentTo: to.length, sentAt: FieldValue.serverTimestamp() });
  return { sent: true, to: to.length, period: p };
}
exports.payrollCutoffReminder = onSchedule({ schedule: '0 8 * * *', timeZone: 'Europe/London' }, async () => {
  const r = await sendCutoffReminder(londonToday());
  logger.info('payroll cut-off reminder', r);
});
exports.onPayslipStored = documents.onPayslipStored;

// Colleague directory (launch audit, 26 Oct): team members can no longer read every staff record
// (emails, phone numbers). They read names from directory/{uid} instead. The developer login is never listed.
function directoryEntry(d) {
  if (!d || d.developer === true) return null;
  return {
    name: d.name || '', jobTitle: d.jobTitle || '', role: d.role || 'staff',
    active: d.active !== false, terminated: d.terminated === true, onRota: d.onRota !== false,
  };
}
exports.onStaffDirectory = onDocumentWritten('staff/{uid}', async (event) => {
  const after = event.data.after.exists ? event.data.after.data() : null;
  const entry = directoryEntry(after);
  const ref = db.doc(`directory/${event.params.uid}`);
  if (entry) await ref.set(entry);
  else await ref.delete();
});
