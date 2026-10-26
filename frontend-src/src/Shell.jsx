import React, { useEffect, useRef, useState } from 'react';
import { signOut } from 'firebase/auth';
import { collection, query, where, limit } from 'firebase/firestore';
import { auth, db } from './firebase.js';
import { useSession } from './App.jsx';
import { useRoute, useLive, useMedia, DESKTOP, Icon, go } from './ui.jsx';
import { APP_NAME, VENUE_NAME, VENUE_SITE } from './brand.js';
import Home from './pages/Home.jsx';
import Rota from './pages/Rota.jsx';
import Events from './pages/Events.jsx';
import Payslips from './pages/Payslips.jsx';
import Inbox from './pages/Inbox.jsx';
import Enquiries from './pages/Enquiries.jsx';
import Team from './pages/Team.jsx';
import { More, Notifications } from './pages/More.jsx';

// Page titles and the one line under each, so every screen says plainly what it is for.
function pageInfo(path, s) {
  const m = {
    rota: s.isManager ? ['Rota', 'Plan the week, publish it to staff, then approve it.'] : ['My shifts', 'Your shifts on the published rota.'],
    inbox: s.isManager ? ['Inbox', 'Holiday, swaps, problems and unavailability.'] : ['Inbox', 'Ask for holiday and see what’s been decided.'],
    payslips: s.isOwner ? ['Payslips', 'Upload and find payslips by tax month.'] : ['Payslips', 'Your payslips by tax month.'],
    events: ['Events', 'What’s on. Events marked for the website show there too.'],
    enquiries: ['Enquiries', 'Private hire enquiries sent from the hotel website.'],
    team: s.isManager ? ['Team', 'Staff logins and roles. Everyone here is on the rota.'] : ['Team', 'Who works here.'],
    more: ['Account', 'Your login, alerts and settings.'],
    notifications: ['Notifications', 'Rota changes, payslips and replies to your requests.'],
    settings: ['Account', 'Your login and settings.'],
    password: ['Account', 'Your login and settings.'],
  };
  if (path === 'timeoff') return m.inbox;
  return m[path] || null;
}

export default function Shell() {
  const { path, params } = useRoute();
  const s = useSession();
  const [open, setOpen] = useState(false);
  const desktop = useMedia(DESKTOP);
  const menuBtn = useRef(null);
  const drawer = useRef(null);

  const unread = useLive(() => query(collection(db, 'notifications'), where('uid', '==', s.user.uid), where('read', '==', false), limit(50)), [s.user.uid]);
  const unreadCount = unread.docs ? unread.docs.length : 0;
  const pendT = useLive(() => (s.isManager ? query(collection(db, 'timeOff'), where('status', '==', 'pending'), limit(50)) : null), [s.isManager]);
  const pendR = useLive(() => (s.isManager ? query(collection(db, 'requests'), where('status', '==', 'pending'), limit(50)) : null), [s.isManager]);
  const pending = (pendT.docs ? pendT.docs.length : 0) + (pendR.docs ? pendR.docs.length : 0);

  const pages = {
    '': <Home />, rota: <Rota params={params} />, events: <Events />, payslips: <Payslips params={params} />, more: <More tab="password" />,
    inbox: <Inbox />, timeoff: <Inbox />, enquiries: <Enquiries />, team: <Team />, settings: <More tab="settings" />, password: <More tab="password" />,
    notifications: <Notifications />,
  };
  const known = Object.prototype.hasOwnProperty.call(pages, path);
  const page = known ? pages[path] : <Home />;
  const here = known ? path : '';
  const active = here === 'timeoff' ? 'inbox' : ['password', 'settings'].includes(here) ? 'more' : here;
  const info = here ? pageInfo(here, s) : null;

  // Main places: one list, used by the fixed sidebar on desktop and the slide-out menu on phones.
  const work = [
    { p: '', label: 'Home', icon: 'home' },
    { p: 'rota', label: s.isManager ? 'Rota' : 'My shifts', icon: 'rota' },
    { p: 'inbox', label: 'Inbox', icon: 'inbox', badge: s.isManager ? pending : 0, badgeLabel: 'waiting for a decision', testid: 'inbox-badge' },
    { p: 'payslips', label: 'Payslips', icon: 'pay' },
  ];
  const place = [
    { p: 'events', label: 'Events', icon: 'events' },
    ...(s.isManager ? [{ p: 'enquiries', label: 'Enquiries', icon: 'mail' }] : []),
    { p: 'team', label: 'Team', icon: 'team' },
  ];
  const account = [
    { p: 'notifications', label: 'Notifications', icon: 'bell', badge: unreadCount, badgeLabel: 'unread' },
    { p: 'more', label: 'Account', icon: 'user' },
  ];
  const menuShown = desktop || open;

  // close the phone menu when the page changes, and on Escape
  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [path]);
  useEffect(() => {
    if (!open || desktop) return undefined;
    const prev = document.activeElement;
    const first = drawer.current && drawer.current.querySelector('a, button');
    if (first) { first.focus(); requestAnimationFrame(() => { if (drawer.current && !drawer.current.contains(document.activeElement)) first.focus(); }); }
    const onKey = (e) => {
      if (e.key === 'Escape') { setOpen(false); return; }
      if (e.key !== 'Tab' || !drawer.current) return;
      const f = [...drawer.current.querySelectorAll('a, button')];
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('menu-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('menu-open');
      if (prev && prev.focus && menuBtn.current && prev === menuBtn.current) prev.focus();
    };
  }, [open, desktop]);

  const badge = (it) => (it.badge > 0 ? (
    <span className="badge" data-testid={it.testid}>
      {it.badge}<span className="sr"> {it.badgeLabel}</span>
    </span>
  ) : null);
  const link = (it, cls) => (
    <a key={it.p || 'home'} href={`#/${it.p}`} className={`${cls} ${active === it.p ? 'on' : ''}`} aria-current={active === it.p ? 'page' : undefined}>
      <Icon name={it.icon} />
      <span className="lbl">{it.label}</span>
      {badge(it)}
    </a>
  );
  const bell = (
    <a className="iconbtn bell" href="#/notifications" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}>
      <Icon name="bell" />
      {unreadCount > 0 && <span className="badge dot" aria-hidden="true">{unreadCount}</span>}
    </a>
  );

  return (
    <>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); const m = document.getElementById('main'); if (m) m.focus(); }}>Skip to content</a>

      {/* Phones and portrait tablets: a slim bar; the menu slides in from the side and starts closed */}
      <header className="mbar">
        <button ref={menuBtn} type="button" className="menubtn" aria-expanded={open} aria-controls="sidemenu" onClick={() => setOpen(true)}>
          <Icon name="menu" /><span>Menu</span>
          {(s.isManager ? pending : 0) > 0 && <span className="badge dot" aria-hidden="true">{pending}</span>}
        </button>
        <a href="#/" className="wordmark">{APP_NAME}</a>
        {bell}
      </header>
      <div className={`scrim ${open && !desktop ? 'open' : ''}`} onClick={() => setOpen(false)} aria-hidden="true" />
      {/* Desktop: the same menu, fixed down the left side. */}
      <aside id="sidemenu" ref={drawer} className={`sidemenu ${open ? 'open' : ''}`} aria-label="Menu" aria-hidden={!menuShown} inert={menuShown ? undefined : ''}>
        <div className="side-head">
          <div>
            <a href="#/" className="wordmark">{APP_NAME}</a>
            <div className="side-sub">{VENUE_NAME}</div>
          </div>
          <button type="button" className="iconbtn closebtn" onClick={() => setOpen(false)} aria-label="Close menu"><Icon name="close" /></button>
        </div>
        <nav aria-label="Main">
          <div className="side-group">Your work</div>
          {work.map((it) => link(it, 'sidelink'))}
          <div className="side-group">Workplace</div>
          {place.map((it) => link(it, 'sidelink'))}
          <div className="side-group">You</div>
          {account.map((it) => link(it, 'sidelink'))}
        </nav>
        <div className="side-foot">
          <div className="side-user"><span className="side-initial" aria-hidden="true">{(s.name || '?').charAt(0)}</span><span className="side-name">{s.name}</span></div>
          <a className="sidelink" href={VENUE_SITE} target="_blank" rel="noreferrer"><Icon name="link" /><span className="lbl">Venue website</span></a>
          <button type="button" className="sidelink" onClick={() => { go(''); signOut(auth); }}><Icon name="out" /><span className="lbl">Sign out</span></button>
        </div>
      </aside>

      <main id="main" tabIndex={-1} className={`page-${here || 'home'}`}>
        {info && (
          <div className="pagehead">
            <h1>{info[0]}</h1>
          </div>
        )}
        {page}
      </main>
    </>
  );
}
