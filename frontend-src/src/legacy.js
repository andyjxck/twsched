// The old demo version of this app kept fake staff, shifts and payslips in the browser
// (PGlite database "swan-staff-demo" in IndexedDB plus a localStorage key).
// Delete them once per browser so no demo records survive alongside the real data.
const FLAG = 'tw-legacy-cleared-v1';

export function clearLegacyDemoData() {
  try {
    if (localStorage.getItem(FLAG)) return;
    localStorage.removeItem('swan_venue');
    Object.keys(localStorage).filter((k) => k.startsWith('swan_')).forEach((k) => localStorage.removeItem(k));
  } catch (e) {
    return;
  }
  const done = () => { try { localStorage.setItem(FLAG, String(Date.now())); } catch (e) { /* ignore */ } };
  const names = ['/pglite/swan-staff-demo', 'swan-staff-demo'];
  const drop = (n) => new Promise((res) => {
    try {
      const r = indexedDB.deleteDatabase(n);
      r.onsuccess = r.onerror = r.onblocked = () => res();
    } catch (e) { res(); }
  });
  const list = indexedDB.databases ? indexedDB.databases().catch(() => []) : Promise.resolve([]);
  list
    .then((dbs) => {
      const extra = (dbs || []).map((d) => d.name).filter((n) => n && /swan-staff-demo|pglite/i.test(n));
      return Promise.all([...new Set([...names, ...extra])].map(drop));
    })
    .then(done, done);
  if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
    navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
  }
}
