// Local-only stand-in for Firebase, used by `npm run fixture` to check layouts and
// role-dependent navigation without touching the live project. Never shipped.
import { DATA, USERS } from './data.js';

const listeners = new Set();
export const store = JSON.parse(JSON.stringify(DATA));
let seq = 1;
export function newId() { seq += 1; return `fx${Date.now().toString(36)}${seq}`; }
export function emit() { listeners.forEach((l) => l()); }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

const params = new URLSearchParams(window.location.search);
export const pwPending = { on: params.get('pw') === '1', newPw: '' };
const wanted = params.get('as');
export const auth = { currentUser: null, _cbs: new Set() };
function makeUser(key) {
  const u = USERS[key];
  if (!u) return null;
  return {
    uid: u.uid, email: u.email, displayName: u.name,
    // ?pw=1: signed in with a temporary password (onboarding fixture, see functions.js ?ob=1)
    getIdTokenResult: async () => ({ claims: { role: u.role, ...(pwPending.on ? { pwChange: true } : {}) } }),
  };
}
if (wanted && wanted !== 'none') auth.currentUser = makeUser(wanted);
export function setUser(u) { auth.currentUser = u; auth._cbs.forEach((cb) => cb(u)); }
export function userByEmail(email) {
  const key = Object.keys(USERS).find((k) => USERS[k].email === email);
  return key ? makeUser(key) : null;
}
export const failMode = params.get('fail') === '1';
export const slowMode = params.get('slow') === '1';
