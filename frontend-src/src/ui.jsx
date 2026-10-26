import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { onSnapshot } from 'firebase/firestore';

// ---------- hash router ----------
function readHash() {
  const h = window.location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  return { path: path || '', params: new URLSearchParams(qs || '') };
}
export function useRoute() {
  const [route, setRoute] = useState(readHash);
  useEffect(() => {
    const on = () => setRoute(readHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
export function go(path) {
  window.location.hash = `#/${path}`;
}

// ---------- screen size ----------
// Desktop gets the fixed sidebar and side-by-side panels; phones keep the slim bar and slide-out menu.
export const DESKTOP = '(min-width: 900px)';
export function useMedia(q) {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q).matches : false);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const m = window.matchMedia(q);
    const f = () => setOn(m.matches);
    f();
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, [q]);
  return on;
}

// ---------- tabs ----------
// One focused section at a time instead of everything stacked down the page.
// items: [{ key, label, count }]. Arrow keys move between tabs.
export function Tabs({ items, value, onChange, label, idBase = 'tab' }) {
  const onKey = (e) => {
    const i = items.findIndex((t) => t.key === value);
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = items.length - 1;
    if (n < 0) return;
    e.preventDefault();
    onChange(items[n].key);
    const el = document.getElementById(`${idBase}-${items[n].key}`);
    if (el) el.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
      {items.map((t) => (
        <button key={t.key} id={`${idBase}-${t.key}`} type="button" role="tab" aria-selected={t.key === value}
          aria-controls={`${idBase}-panel`} tabIndex={t.key === value ? 0 : -1}
          className={`tab ${t.key === value ? 'on' : ''}`} onClick={() => onChange(t.key)} data-testid={`tab-${t.key}`}>
          {t.label}
          {t.count !== undefined && t.count !== null && <span className={`tabcount ${t.count ? '' : 'zero'}`}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
export function TabPanel({ idBase = 'tab', value, children, plain }) {
  if (plain) return <div className="tabpanel">{children}</div>;
  return <div id={`${idBase}-panel`} role="tabpanel" aria-labelledby={`${idBase}-${value}`} className="tabpanel">{children}</div>;
}

// ---------- live Firestore query ----------
export function useLive(makeQuery, deps) {
  const [state, setState] = useState({ docs: null, error: null });
  useEffect(() => {
    const q = makeQuery();
    if (!q) {
      setState({ docs: [], error: null });
      return undefined;
    }
    setState((s) => ({ docs: s.docs, error: null }));
    const unsub = onSnapshot(
      q,
      (snap) => {
        if ('docs' in snap) setState({ docs: snap.docs.map((d) => ({ id: d.id, ...d.data() })), error: null });
        else setState({ docs: snap.exists() ? [{ id: snap.id, ...snap.data() }] : [], error: null });
      },
      (error) => {
        console.error(error);
        setState({ docs: [], error });
      },
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

// ---------- toast ----------
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const show = useCallback((msg, kind) => {
    setToast({ msg, kind, id: Math.random() });
  }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && <div className={`toast ${toast.kind === 'warn' ? 'warn' : ''}`} role="status">{toast.msg}</div>}
    </ToastCtx.Provider>
  );
}
export function useToast() {
  return useContext(ToastCtx);
}

// ---------- sheet (modal) ----------
export function Sheet({ title, onClose, children }) {
  useEffect(() => {
    const on = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="head">
          <h2 className="sheet-title">{title}</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Close">Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Loading({ label = 'Loading' }) {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="loading-dots" aria-hidden="true"><i /><i /><i /></span>
      <span>{label}…</span>
    </div>
  );
}
export function ErrorBox({ error }) {
  if (!error) return null;
  const denied = /permission|insufficient/i.test(`${error.code || ''} ${error.message || ''}`);
  return (
    <div className="err" role="alert">
      <strong>{denied ? 'You can’t see this part.' : 'This didn’t load.'}</strong>{' '}
      {denied ? 'Your login doesn’t have access. Ask a manager if you think it should.' : 'Check your signal, then pull down or reload the page.'}
      <div className="err-detail">{error.message || String(error)}</div>
    </div>
  );
}

// Friendly empty state: a short title and one line saying what will appear here.
export function Empty({ icon = 'leaf', title, children }) {
  return (
    <div className="emptystate">
      <span className="emptystate-icon"><Icon name={icon} /></span>
      <div>
        <div className="emptystate-title">{title}</div>
        {children && <div className="emptystate-text">{children}</div>}
      </div>
    </div>
  );
}

// ---------- icons ----------
const paths = {
  home: 'M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z',
  rota: 'M4 5h16v15H4zM4 9h16M9 5V3M15 5V3M8 13h3M13 13h3M8 16h3',
  events: 'M12 3l2.6 5.5 6 .8-4.4 4.2 1.1 6L12 16.7 6.7 19.5l1.1-6L3.4 9.3l6-.8z',
  pay: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5',
  bell: 'M18 16v-5a6 6 0 1 0-12 0v5l-2 2h16zM10 20a2 2 0 0 0 4 0',
  team: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.8c2 .7 3.2 2.4 3.5 5.2',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c.8-4 3.9-6 8-6s7.2 2 8 6',
  key: 'M14.5 9.5a4.5 4.5 0 1 1-1.3-3.2 4.5 4.5 0 0 1 1.3 3.2zM12.3 12.7 4 21M7 18l2 2M9.5 15.5l2 2',
  gear: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 4.5v5M8 14.5v5',
  out: 'M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10',
  link: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  menu: 'M4 7h16M4 12h16M4 17h10',
  close: 'M6 6l12 12M18 6 6 18',
  chevron: 'M9 5l7 7-7 7',
  back: 'M15 5l-7 7 7 7',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  leaf: 'M5 19c0-8 5-13 14-14-1 9-6 14-14 14zM5 19l7-7',
  check: 'M5 12.5l4.5 4.5L19 7.5',
};
export function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === 'more' ? 3.5 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={paths[name]} />
    </svg>
  );
}
