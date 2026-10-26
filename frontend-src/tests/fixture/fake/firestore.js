import { store, emit, subscribe, newId, failMode, slowMode } from './store.js';

export function initializeFirestore() { return { fake: true }; }
export function persistentLocalCache() { return {}; }
export function persistentMultipleTabManager() { return {}; }
export function serverTimestamp() { return new Date().toISOString(); }

export function collection(db, name) { return { type: 'col', name }; }
export function doc(db, name, id) {
  if (db && db.type === 'col') return { type: 'doc', name: db.name, id: newId() };
  return { type: 'doc', name, id };
}
export function where(field, op, value) { return { kind: 'where', field, op, value }; }
export function orderBy(field, dir = 'asc') { return { kind: 'order', field, dir }; }
export function limit(n) { return { kind: 'limit', n }; }
export function query(col, ...cons) { return { type: 'query', name: col.name, cons }; }

function rows(name) { return Object.entries(store[name] || {}).map(([id, d]) => ({ id, ...d })); }
function test(d, w) {
  const v = d[w.field];
  switch (w.op) {
    case '==': return v === w.value;
    case '!=': return v !== w.value;
    case '>=': return v >= w.value;
    case '<=': return v <= w.value;
    case '>': return v > w.value;
    case '<': return v < w.value;
    case 'in': return w.value.includes(v);
    case 'array-contains': return Array.isArray(v) && v.includes(w.value);
    default: return true;
  }
}
function run(q) {
  let r = rows(q.name);
  const cons = q.type === 'query' ? q.cons : [];
  cons.filter((c) => c.kind === 'where').forEach((w) => { r = r.filter((d) => test(d, w)); });
  cons.filter((c) => c.kind === 'order').reverse().forEach((o) => {
    r.sort((a, b) => {
      const x = a[o.field] ?? ''; const y = b[o.field] ?? '';
      const c = x < y ? -1 : x > y ? 1 : 0;
      return o.dir === 'desc' ? -c : c;
    });
  });
  const l = cons.find((c) => c.kind === 'limit');
  if (l) r = r.slice(0, l.n);
  return r;
}
function snapOf(ref) {
  if (ref.type === 'doc') {
    const d = (store[ref.name] || {})[ref.id];
    return { id: ref.id, exists: () => !!d, data: () => (d ? { ...d } : undefined) };
  }
  return { docs: run(ref).map(({ id, ...d }) => ({ id, data: () => d })) };
}
export function onSnapshot(ref, next, err) {
  if (failMode && ref.type !== 'doc') { setTimeout(() => err && err(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' })), 300); return () => {}; }
  let live = true;
  const fire = () => { if (live) next(snapOf(ref)); };
  const t = setTimeout(fire, slowMode ? 60000 : 120);
  const un = subscribe(fire);
  return () => { live = false; clearTimeout(t); un(); };
}
export async function getDoc(ref) { return snapOf(ref); }
export async function getDocs(q) { return snapOf(q); }
export async function addDoc(col, data) { const id = newId(); (store[col.name] = store[col.name] || {})[id] = data; emit(); return { id }; }
export async function setDoc(ref, data, opts) {
  const c = (store[ref.name] = store[ref.name] || {});
  c[ref.id] = opts && opts.merge ? { ...(c[ref.id] || {}), ...data } : data; emit();
}
export async function updateDoc(ref, data) { const c = store[ref.name] || {}; c[ref.id] = { ...(c[ref.id] || {}), ...data }; emit(); }
export async function deleteDoc(ref) { delete (store[ref.name] || {})[ref.id]; emit(); }
export function writeBatch() {
  const ops = [];
  return {
    set: (r, d, o) => ops.push(() => setDoc(r, d, o)),
    update: (r, d) => ops.push(() => updateDoc(r, d)),
    delete: (r) => ops.push(() => deleteDoc(r)),
    commit: async () => { for (const op of ops) await op(); },
  };
}
export class Timestamp { static now() { return new Date(); } }
