/* Two-step verification in the Staff Hub (authenticator app codes, Firebase TOTP MFA).
 *
 * Built by tools/two-step/build.sh into public/assets/twostep/twostep-tws2610ts.js. It uses the same
 * Firebase version as the main bundle (11.10.0 / auth 1.10.8) and works on the main bundle's own Auth
 * instance (window.__tws.auth, already exposed by the main bundle), so there is one signed-in user, not two.
 *
 *  - Sign-in: the login form hands a auth/multi-factor-auth-required error to resolveSignIn(), which
 *    asks for the 6-digit code and finishes the sign-in.
 *  - Gate: a login whose token says it must use two-step (claim mfa=true) but which signed in without a
 *    second factor sees a full-screen "set up two-step" screen. The server already refuses it everything
 *    (firestore.rules, storage.rules, callables); this screen is only what it sees instead of errors.
 *  - Account page: management logins get a Two-step verification card (openSetup()).
 *
 * Nothing here can grant access: the server decides from Google-signed ID tokens.
 */
import {
  getIdTokenResult, onIdTokenChanged, multiFactor, getMultiFactorResolver,
  TotpMultiFactorGenerator, sendEmailVerification, signOut,
} from 'firebase/auth';
import qrcode from 'qrcode-generator';

const ISSUER = 'TWS Staff Hub';
const FACTOR_NAME = 'Authenticator app';

function waitForAuth() {
  const get = () => window.__tws && window.__tws.auth;
  return new Promise((res) => { const t = () => (get() ? res(get()) : setTimeout(t, 40)); t(); });
}
function friendly(msg) { const e = new Error(msg); e.code = 'two-step'; return e; }

/* ---------- tiny DOM helpers (no innerHTML with user data) ---------- */
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
const STYLE = `
.tws2s-back{position:fixed;inset:0;z-index:2147483000;background:rgba(15,15,15,.62);display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto}
.tws2s-back.tws2s-gate{background:var(--bg,#f4f1ea)}
.tws2s-card{width:100%;max-width:440px;box-sizing:border-box}
.tws2s-card h2{margin:0}
.tws2s-qr{display:flex;justify-content:center;padding:8px;background:#fff;border-radius:8px}
.tws2s-qr svg{width:200px;height:200px}
.tws2s-key{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:15px;letter-spacing:.06em;word-break:break-all;user-select:all}
.tws2s-code{font-size:22px;letter-spacing:.3em;text-align:center}
.tws2s-row{display:flex;gap:8px;flex-wrap:wrap}
.tws2s-row .btn{flex:1}
`;
function ensureStyle() {
  if (document.getElementById('tws2s-style')) return;
  document.head.append(h('style', { id: 'tws2s-style' }, STYLE));
}
function openDialog({ gate = false, label }) {
  ensureStyle();
  const card = h('div', { class: 'card stack tws2s-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': label });
  const back = h('div', { class: 'tws2s-back' + (gate ? ' tws2s-gate' : ''), 'data-tws2s': gate ? 'gate' : 'dialog' }, card);
  document.body.append(back);
  return { back, card, close: () => back.remove(), set: (...kids) => { card.replaceChildren(...kids.flat()); const f = card.querySelector('input,button'); if (f) f.focus(); } };
}
function codeInput(id) {
  return h('input', { id, class: 'tws2s-code', inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9]*', maxlength: '6', required: true, 'aria-label': '6-digit code' });
}
const digits = (v) => String(v || '').replace(/\D/g, '');
const errBox = () => h('div', { class: 'err', role: 'alert', hidden: true });
function showErr(box, msg) { box.textContent = msg; box.hidden = !msg; }

/* ---------- sign-in: second step ---------- */
async function resolveSignIn(error) {
  const auth = await waitForAuth();
  const resolver = getMultiFactorResolver(auth, error);
  const hint = resolver.hints.find((x) => x.factorId === TotpMultiFactorGenerator.FACTOR_ID);
  if (!hint) throw friendly('This login needs a kind of second step the Staff Hub does not support. Ask an owner to reset your two-step verification.');
  return new Promise((resolve, reject) => {
    const d = openDialog({ label: 'Enter your code' });
    const err = errBox(); const input = codeInput('tws2s-signin-code');
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Verify');
    const cancel = () => { d.close(); reject(friendly('Sign-in cancelled.')); };
    const form = h('form', { class: 'stack', async onsubmit(ev) {
      ev.preventDefault(); showErr(err, '');
      const code = digits(input.value);
      if (code.length !== 6) { showErr(err, 'Type the 6-digit code from your authenticator app.'); return; }
      btn.disabled = true;
      try {
        await resolver.resolveSignIn(TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code));
        d.close(); resolve();
      } catch (e) {
        const c = (e && e.code) || '';
        if (c === 'auth/invalid-verification-code') {
          showErr(err, 'That code didn’t work. Use the newest code in the app, and check the time on your phone is set automatically.');
          input.value = ''; input.focus();
        } else if (c === 'auth/too-many-requests') {
          showErr(err, 'Too many tries. Wait a minute and sign in again.');
        } else if (c === 'auth/network-request-failed') {
          showErr(err, 'No connection. Check your signal and try again.');
        } else {
          d.close(); reject(friendly('That sign-in took too long or was interrupted. Sign in again.'));
        }
      } finally { btn.disabled = false; }
    } },
      h('label', { for: 'tws2s-signin-code' }, `Type the 6-digit code for ${ISSUER} from your authenticator app.`),
      input, err,
      h('div', { class: 'tws2s-row' }, h('button', { class: 'btn secondary', type: 'button', onclick: cancel }, 'Cancel'), btn),
      h('p', { class: 'small muted' }, 'Lost your phone? Ask another owner to reset your two-step verification.'));
    d.set(h('h2', { class: 'card-title' }, 'Enter your code'), form);
  });
}

/* ---------- set-up ---------- */
function enrolled(user) {
  try { return multiFactor(user).enrolledFactors.filter((f) => f.factorId === TotpMultiFactorGenerator.FACTOR_ID); } catch { return []; }
}
// Runs the set-up steps inside dialog d. onDone() after the authenticator is added.
async function setupFlow(d, user, { gate, onDone }) {
  const auth = await waitForAuth();
  let twoSteps = false;
  const out = () => signOut(auth).catch(() => {});
  const signOutBtn = () => h('button', { class: 'btn secondary', type: 'button', onclick: () => { d.close(); out(); } }, 'Sign out');
  const closeBtn = () => (gate ? signOutBtn() : h('button', { class: 'btn secondary', type: 'button', onclick: () => d.close() }, 'Close'));
  const title = h('h2', { class: 'card-title' }, 'Two-step verification');
  const intro = gate
    ? h('p', {}, 'Managers and owners need two-step verification to open the Staff Hub. It takes about two minutes and needs an authenticator app on your phone, such as Google Authenticator or Microsoft Authenticator.')
    : h('p', {}, 'Add a code from an authenticator app on your phone to your sign-in, such as Google Authenticator or Microsoft Authenticator.');

  function fail(e) {
    const c = (e && e.code) || '';
    if (c === 'auth/requires-recent-login') return 'For security, sign out and sign back in, then set this up straight away.';
    if (c === 'auth/unverified-email') return 'Confirm your email address first.';
    if (c === 'auth/operation-not-allowed' || c === 'auth/admin-restricted-operation') return 'Two-step verification isn’t switched on for the Staff Hub yet. Tell Andy.';
    if (c === 'auth/network-request-failed') return 'No connection. Check your signal and try again.';
    if (c === 'auth/invalid-verification-code') return 'That code didn’t work. Use the newest code in the app, and check the time on your phone is set automatically.';
    if (c === 'auth/maximum-second-factor-count-exceeded') return 'This login already has the most authenticators allowed. Ask an owner to reset it.';
    return 'Something went wrong. Try again, or sign out and back in.';
  }

  async function stepEmail() {
    const err = errBox();
    const send = h('button', { class: 'btn', type: 'button', async onclick() {
      showErr(err, ''); send.disabled = true;
      try { await sendEmailVerification(user); sent.hidden = false; cont.hidden = false; send.textContent = 'Send the link again'; send.className = 'btn secondary'; }
      catch (e) { showErr(err, (e && e.code) === 'auth/too-many-requests' ? 'A link was sent a moment ago. Check your inbox, or wait a minute.' : fail(e)); }
      finally { send.disabled = false; }
    } }, 'Email me a link');
    const sent = h('p', { class: 'small', hidden: true }, 'Link sent. Open it on any device, then come back here and press Continue.');
    const cont = h('button', { class: 'btn', type: 'button', hidden: true, async onclick() {
      showErr(err, ''); cont.disabled = true;
      try { await user.reload(); await user.getIdToken(true); if (user.emailVerified) return stepQr(); showErr(err, 'Not confirmed yet. Open the link in the email, then press Continue.'); }
      catch (e) { showErr(err, fail(e)); } finally { cont.disabled = false; }
    } }, 'Continue');
    d.set(title, intro, h('p', {}, 'Step 1 of 2: confirm your email address. We’ll send a link to ', h('strong', {}, user.email || 'your email'), '.'), send, sent, cont, err, h('div', { class: 'tws2s-row' }, closeBtn()));
  }

  async function stepQr() {
    const err = errBox();
    d.set(title, h('p', {}, 'Getting your code ready…'));
    let secret;
    try {
      secret = await TotpMultiFactorGenerator.generateSecret(await multiFactor(user).getSession());
    } catch (e) {
      if ((e && e.code) === 'auth/unverified-email') return stepEmail();
      const recent = (e && e.code) === 'auth/requires-recent-login';
      d.set(title, h('div', { class: 'err', role: 'alert' }, fail(e)), h('div', { class: 'tws2s-row' }, recent ? signOutBtn() : closeBtn(),
        recent ? null : h('button', { class: 'btn', type: 'button', onclick: () => stepQr() }, 'Try again')));
      return;
    }
    const qr = qrcode(0, 'M'); qr.addData(secret.generateQrCodeUrl(user.email || 'Staff Hub login', ISSUER)); qr.make();
    const qrBox = h('div', { class: 'tws2s-qr', role: 'img', 'aria-label': 'QR code to scan with your authenticator app' });
    qrBox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); // locally generated SVG, no user text in it
    const key = (secret.secretKey || '').replace(/(.{4})/g, '$1 ').trim();
    const input = codeInput('tws2s-enrol-code');
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Turn on two-step');
    const form = h('form', { class: 'stack', async onsubmit(ev) {
      ev.preventDefault(); showErr(err, '');
      const code = digits(input.value);
      if (code.length !== 6) { showErr(err, 'Type the 6-digit code your app shows for TWS Staff Hub.'); return; }
      btn.disabled = true;
      try {
        await multiFactor(user).enroll(TotpMultiFactorGenerator.assertionForEnrollment(secret, code), FACTOR_NAME);
        return onDone();
      } catch (e) { showErr(err, fail(e)); if ((e && e.code) === 'auth/invalid-verification-code') { input.value = ''; input.focus(); } }
      finally { btn.disabled = false; }
    } },
      h('label', { for: 'tws2s-enrol-code' }, 'Then type the 6-digit code it shows:'), input, err,
      h('div', { class: 'tws2s-row' }, closeBtn(), btn));
    d.set(title,
      h('p', {}, (twoSteps ? 'Step 2 of 2: ' : '') + 'In your authenticator app, add an account and scan this code.'),
      qrBox,
      h('details', {}, h('summary', {}, 'Can’t scan it? Type this key instead'), h('p', { class: 'tws2s-key' }, key), h('p', { class: 'small muted' }, 'Account: your email. Type: time-based.')),
      form);
  }

  if (!user.emailVerified) { twoSteps = true; return stepEmail(); }
  return stepQr();
}

function fmtDate(s) { try { return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return ''; } }

// Account page card button.
async function openSetup() {
  const auth = await waitForAuth();
  const user = auth.currentUser; if (!user) return;
  const d = openDialog({ label: 'Two-step verification' });
  const title = h('h2', { class: 'card-title' }, 'Two-step verification');
  const close = h('button', { class: 'btn secondary', type: 'button', onclick: () => d.close() }, 'Close');
  const have = enrolled(user);
  if (have.length) {
    d.set(title, h('p', {}, 'Two-step verification is on. When you sign in, you’ll be asked for a code from your authenticator app.'),
      h('ul', {}, have.map((f) => h('li', {}, `${f.displayName || FACTOR_NAME}, added ${fmtDate(f.enrollmentTime)}`))),
      h('p', { class: 'small muted' }, 'New or lost phone? Ask another owner to reset your two-step verification, then set it up again.'), close);
    return;
  }
  await setupFlow(d, user, { gate: false, onDone: async () => {
    d.set(title, h('p', {}, 'Two-step verification is on. Next time you sign in, you’ll be asked for a code from your authenticator app.'),
      h('button', { class: 'btn', type: 'button', onclick: () => d.close() }, 'Done'));
  } });
}

/* ---------- gate for logins that must use two-step ---------- */
let gateDlg = null;
function closeGate() { if (gateDlg && !gateDlg.done) { gateDlg.close(); gateDlg = null; } }
async function openGate(user) {
  if (gateDlg) return;
  const auth = await waitForAuth();
  gateDlg = openDialog({ gate: true, label: 'Two-step verification needed' });
  const d = gateDlg;
  const title = h('h2', { class: 'card-title' }, 'Two-step verification');
  const again = () => { d.close(); if (gateDlg === d) gateDlg = null; signOut(auth).catch(() => {}); };
  if (enrolled(user).length) {
    d.set(title, h('p', {}, 'Your login has two-step verification, but this sign-in didn’t use it. Sign out, then sign in again with your code.'),
      h('button', { class: 'btn', type: 'button', onclick: again }, 'Sign out and sign in again'));
    return;
  }
  await setupFlow(d, user, { gate: true, onDone: async () => {
    d.done = true; // stay up even if the refreshed token no longer needs the gate: sign in afresh
    d.set(title, h('p', {}, 'Two-step verification is on. Sign in once more with your password and a code from the app to open the Staff Hub.'),
      h('button', { class: 'btn', type: 'button', onclick: again }, 'Sign in again'));
  } });
}

async function start() {
  const auth = await waitForAuth();
  onIdTokenChanged(auth, async (user) => {
    if (!user) { if (gateDlg) { gateDlg.close(); gateDlg = null; } return; }
    try {
      const r = await getIdTokenResult(user);
      const need = r.claims.mfa === true && !r.signInSecondFactor;
      if (need) openGate(user); else closeGate();
    } catch { /* offline: the server still refuses; nothing to show */ }
  });
}

window.__twsTwoStep = { resolveSignIn, openSetup };
start();
