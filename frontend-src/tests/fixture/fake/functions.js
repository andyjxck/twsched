export function getFunctions() { return {}; }
import { pwPending } from './store.js';

// ?ob=1 fakes the onboarding callables (?mail=off: the login email "wasn't sent").
const qs = new URLSearchParams(window.location.search);
const OB = qs.get('ob') === '1';
const mailOff = qs.get('mail') === 'off';
const ob = {
  async completePasswordChange({ currentPassword, newPassword }) {
    if (currentPassword !== 'fixture-pass') throw Object.assign(new Error('That temporary password isn’t right. Copy it from your email exactly.'), { code: 'functions/permission-denied' });
    if (!newPassword || newPassword.length < 8) throw Object.assign(new Error('Use at least 8 characters.'), { code: 'functions/invalid-argument' });
    pwPending.on = false;
    pwPending.newPw = newPassword;
    return { ok: true };
  },
  async createStaff(d) { return login(d && d.name); },
  async resendStaffLogin() { return login(); },
};
function login() {
  const expiresAt = Date.now() + 7 * 86400000;
  return mailOff
    ? { uid: 'fxnew', emailSent: false, reason: 'Email sending is switched off in Settings: Gmail rejected the app password (535 BadCredentials).', tempPassword: 'Abcd-Efgh-2345-wxyz', expiresAt }
    : { uid: 'fxnew', emailSent: true, reason: '', expiresAt };
}
export function httpsCallable(f, name) {
  if (OB && ob[name]) return async (data) => ({ data: await ob[name](data) });
  return async () => { throw Object.assign(new Error(`Fixture mode: ${name} is not run locally.`), { code: 'fixture' }); };
}
