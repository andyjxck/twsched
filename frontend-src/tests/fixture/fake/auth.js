import { auth, setUser, userByEmail, pwPending } from './store.js';

export function getAuth() { return auth; }
export function onAuthStateChanged(a, cb) {
  a._cbs.add(cb);
  setTimeout(() => cb(a.currentUser), 0);
  return () => a._cbs.delete(cb);
}
export async function signInWithEmailAndPassword(a, email, password) {
  const u = userByEmail(email);
  if (!u || (password !== 'fixture-pass' && !(pwPending.newPw && password === pwPending.newPw))) { const e = new Error('bad'); e.code = 'auth/invalid-credential'; throw e; }
  setUser(u);
  return { user: u };
}
export async function sendPasswordResetEmail() { return undefined; }
export async function signOut() { setUser(null); }
export async function updatePassword() { return undefined; }
export async function reauthenticateWithCredential() { return undefined; }
export const EmailAuthProvider = { credential: (email, pw) => ({ email, pw }) };
