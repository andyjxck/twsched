// Personal rota row order: each signed-in person arranges the rota rows for themselves only.
// Saved to prefs/{their uid} (only they can read or write it) and cached on the device so it
// shows instantly. It never changes shifts, roles or anyone else's view.
import { useCallback, useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase.js';

const cacheKey = (uid) => `twsched.rotaOrder.${uid}`;
const clean = (ids) => (Array.isArray(ids) ? ids.filter((x) => typeof x === 'string' && x && x.length <= 128).slice(0, 300) : []);

export function useRotaOrder(uid) {
  const [order, setOrder] = useState(() => {
    try { return clean(JSON.parse(localStorage.getItem(cacheKey(uid)) || '[]')); } catch (e) { return []; }
  });
  useEffect(() => {
    if (!uid) return undefined;
    return onSnapshot(doc(db, 'prefs', uid), (snap) => {
      const d = snap.exists() ? snap.data() : null;
      if (d && Array.isArray(d.rotaOrder)) {
        const ids = clean(d.rotaOrder);
        setOrder(ids);
        try { localStorage.setItem(cacheKey(uid), JSON.stringify(ids)); } catch (e) { /* ignore */ }
      }
    }, () => { /* offline or no access yet: the device copy still works */ });
  }, [uid]);
  const save = useCallback((ids) => {
    const next = clean(ids);
    setOrder(next);
    try { localStorage.setItem(cacheKey(uid), JSON.stringify(next)); } catch (e) { /* ignore */ }
    return setDoc(doc(db, 'prefs', uid), { rotaOrder: next, updatedAt: serverTimestamp() }).catch(() => {});
  }, [uid]);
  return [order, save];
}

// People in the saved order first; anyone not in it yet keeps the default (A-Z) order after them.
export function applyOrder(list, order) {
  if (!order || !order.length) return list;
  const at = new Map(order.map((id, i) => [id, i]));
  return list
    .map((p, i) => ({ p, k: at.has(p.id) ? at.get(p.id) : 100000 + i }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.p);
}

export function moveId(ids, id, toIndex) {
  const from = ids.indexOf(id);
  if (from < 0) return ids;
  const next = ids.slice();
  next.splice(from, 1);
  const to = Math.max(0, Math.min(next.length, toIndex));
  next.splice(to, 0, id);
  return next;
}
