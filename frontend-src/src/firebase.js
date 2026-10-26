import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions, httpsCallable } from 'firebase/functions';

// Public web config for Firebase project twsched-f8b16 (safe to ship; access is enforced by security rules).
const firebaseConfig = {
  apiKey: 'AIzaSyDe67skrRZG6TcHFcDUI45zY6Az4Jn5Y2I',
  authDomain: 'twsched-f8b16.firebaseapp.com',
  projectId: 'twsched-f8b16',
  storageBucket: 'twsched-f8b16.firebasestorage.app',
  messagingSenderId: '293364223218',
  appId: '1:293364223218:web:0ddc66832378a1b74cd46b',
  measurementId: 'G-KTN344M0X3',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
let firestore;
try {
  firestore = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch {
  firestore = initializeFirestore(app, {});
}
export const db = firestore;
export const storage = getStorage(app);
export const functions = getFunctions(app, 'europe-west2');

export async function call(name, data) {
  const res = await httpsCallable(functions, name)(data || {});
  return res.data;
}

export function niceError(e) {
  const code = (e && e.code) || '';
  const map = {
    'auth/invalid-credential': 'That email and password don’t match.',
    'auth/wrong-password': 'That password isn’t right.',
    'auth/user-not-found': 'No login with that email.',
    'auth/user-disabled': 'This login has been switched off. Ask a manager.',
    'auth/too-many-requests': 'Too many tries. Wait a minute and try again.',
    'auth/weak-password': 'Use at least 8 characters.',
    'auth/requires-recent-login': 'Sign out and back in, then try again.',
    'auth/network-request-failed': 'No connection. Check your signal and try again.',
    'permission-denied': 'You don’t have permission to do that.',
    'storage/unauthorized': 'You don’t have permission to do that.',
  };
  if (map[code]) return map[code];
  const msg = (e && e.message) || String(e);
  return msg.replace(/^Firebase:\s*/, '').replace(/\s*\(.*\)\.?$/, '');
}
