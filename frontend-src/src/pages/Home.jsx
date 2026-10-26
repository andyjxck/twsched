import React from 'react';
import { collection, query, where, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase.js';
import { useSession } from '../App.jsx';
import { useLive, Loading, ErrorBox, Empty, Icon } from '../ui.jsx';
import { ymd, pretty, paidHours, fmtHours, addDays, weekdayIndex, ago, parseYmd } from '../util.js';

const LONG_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// "Today", "Tomorrow", "Thursday", or a date further out
function dayWord(date, today) {
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  if (date <= addDays(today, 6)) return LONG_DAYS[weekdayIndex(date)];
  return pretty(date, { weekday: 'long', day: 'numeric', month: 'long' });
}

// "Starts in 3 hours" / "In 2 days" / "On now"
function countdown(shift, today) {
  const [h, m] = (shift.start || '00:00').split(':').map(Number);
  const start = parseYmd(shift.date); start.setHours(h, m, 0, 0);
  const mins = Math.round((start.getTime() - Date.now()) / 60000);
  if (mins <= 0) return shift.date === today ? 'On now' : '';
  if (mins < 60) return `Starts in ${mins} min`;
  if (mins < 60 * 12) { const hrs = Math.round(mins / 60); return `Starts in ${hrs} hour${hrs === 1 ? '' : 's'}`; }
  const days = Math.round((parseYmd(shift.date) - parseYmd(today)) / 86400000);
  if (days <= 0) return 'Later today';
  if (days === 1) return 'Tomorrow';
  return `In ${days} days`;
}

function Waiting({ href, count, what, sub, testid }) {
  const n = count == null ? null : count;
  return (
    <a className={`todo ${n ? 'has' : 'clear'}`} href={href} data-testid={testid}>
      <span className="todo-num" aria-hidden="true">{n == null ? '–' : n ? n : <Icon name="check" />}</span>
      <span className="todo-text">
        <span className="todo-what">{n == null ? what.many : n === 0 ? what.none : n === 1 ? `1 ${what.one}` : `${n} ${what.many}`}</span>
        <span className="todo-sub">{sub}</span>
      </span>
      <span className="todo-go"><Icon name="chevron" /></span>
    </a>
  );
}

export default function Home() {
  const s = useSession();
  const today = ymd();
  const mine = useLive(() => query(collection(db, 'shifts'), where('staffId', '==', s.user.uid), where('published', '==', true), where('date', '>=', today), orderBy('date'), limit(14)), [s.user.uid, today]);
  const events = useLive(() => query(collection(db, 'events'), orderBy('date'), limit(200)), []);
  const notes = useLive(() => query(collection(db, 'notifications'), where('uid', '==', s.user.uid), orderBy('createdAt', 'desc'), limit(5)), [s.user.uid]);
  const enq = useLive(() => (s.isManager ? query(collection(db, 'enquiries'), where('status', '==', 'new'), limit(50)) : null), [s.isManager]);
  const pend = useLive(() => (s.isManager ? query(collection(db, 'timeOff'), where('status', '==', 'pending'), limit(50)) : null), [s.isManager]);
  const pendR = useLive(() => (s.isManager ? query(collection(db, 'requests'), where('status', '==', 'pending'), limit(50)) : null), [s.isManager]);

  const weekEnd = addDays(today, 6);
  const comingEvents = (events.docs || [])
    .flatMap((e) => {
      if (e.repeat === 'weekly') {
        // next occurrence within the coming week
        const diff = (weekdayIndex(e.date) - weekdayIndex(today) + 7) % 7;
        const d = addDays(today, diff);
        return d >= e.date ? [{ ...e, on: d }] : (e.date <= weekEnd ? [{ ...e, on: e.date }] : []);
      }
      return e.date >= today && e.date <= weekEnd ? [{ ...e, on: e.date }] : [];
    })
    .sort((a, b) => (a.on + (a.start || '')).localeCompare(b.on + (b.start || '')));
  const first = (s.name || '').split(' ')[0];
  const next = mine.docs && mine.docs[0];
  const later = (mine.docs || []).slice(1);
  const weekHours = (mine.docs || []).filter((x) => x.date <= weekEnd).reduce((t, x) => t + paidHours(x), 0);
  const holidays = pend.docs ? pend.docs.length : null;
  const swaps = pendR.docs ? pendR.docs.length : null;
  const decide = holidays == null ? null : holidays + (swaps || 0);
  const decideSub = decide ? [holidays ? `${holidays} holiday` : '', swaps ? `${swaps} swap or shift` : ''].filter(Boolean).join(' and ') : 'Holiday and shift swaps';

  return (
    <div className="home">
      <header className="hello">
        <p className="hello-date">{pretty(today, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <h1>{greeting()}{first ? `, ${first}` : ''}</h1>
      </header>

      {s.isManager && (
        <section className="todos" aria-label="Waiting for you">
          <Waiting href="#/enquiries" count={enq.docs ? enq.docs.length : null} testid="home-enquiries"
            what={{ one: 'new enquiry', many: 'new enquiries', none: 'No new enquiries' }} sub="Private hire, from the website" />
          <Waiting href="#/inbox" count={decide} testid="home-requests"
            what={{ one: 'request to decide', many: 'requests to decide', none: 'Nothing to decide' }} sub={decideSub} />
        </section>
      )}

      <section className="block block-next" aria-labelledby="h-next">
        <h2 id="h-next" className="block-title">Your next shift</h2>
        <ErrorBox error={mine.error} />
        {!mine.docs ? <Loading label="Finding your shifts" /> : !next ? (
          <div className="ticket empty">
            <Empty icon="rota" title="No shifts coming up">When a manager publishes the rota, your next shift shows here.</Empty>
          </div>
        ) : (
          <a className="ticket" href="#/rota" aria-label={`Next shift: ${dayWord(next.date, today)}, ${next.start} to ${next.end}${next.area ? `, ${next.area}` : ''}. Open my shifts`}>
            <div className="ticket-main">
              <div className="ticket-day">{dayWord(next.date, today)}</div>
              {next.date !== today && next.date <= weekEnd && <div className="ticket-date">{pretty(next.date, { day: 'numeric', month: 'long' })}</div>}
              <div className="ticket-time">{next.start}<span className="to"> to </span>{next.end}</div>
              <div className="ticket-meta">
                {next.area && <span>{next.area}</span>}
                {next.eventTitle && <span>{next.eventTitle}</span>}
                {next.breakStart && next.breakEnd && <span>Break {next.breakStart} to {next.breakEnd}</span>}
              </div>
              {next.notes && <div className="ticket-note">{next.notes}</div>}
            </div>
            <div className="ticket-stub">
              {(countdown(next, today) || 'Coming up') !== dayWord(next.date, today) && <span className="ticket-when">{countdown(next, today) || 'Coming up'}</span>}
              <span className="ticket-hours">{fmtHours(paidHours(next))} paid</span>
            </div>
          </a>
        )}
        {later.length > 0 && (
          <div className="later">
            <div className="later-head">
              <span>After that</span>
              <span className="later-total">{fmtHours(weekHours)} in the next 7 days</span>
            </div>
            <ul className="later-list">
              {later.map((x) => (
                <li key={x.id}>
                  <span className="later-day">{pretty(x.date, { weekday: 'short' })}</span>
                  <span className="later-num">{parseYmd(x.date).getDate()}</span>
                  <span className="later-time">{x.start} to {x.end}</span>
                  {x.area && <span className="later-area">{x.area}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="block block-week" aria-labelledby="h-week">
        <div className="block-head">
          <h2 id="h-week" className="block-title">This week</h2>
          <a className="morelink" href="#/events">All events<Icon name="chevron" /></a>
        </div>
        <ErrorBox error={events.error} />
        {!events.docs ? <Loading label="Loading events" /> : comingEvents.length === 0 ? (
          <Empty icon="events" title="Quiet week">Nothing is on the events calendar for the next seven days.</Empty>
        ) : (
          <ul className="whatson">
            {comingEvents.map((e) => (
              <li key={e.id + e.on} className={e.on === today ? 'is-today' : ''}>
                <div className="wo-date" aria-hidden="true">
                  <span className="wo-dow">{e.on === today ? 'Today' : pretty(e.on, { weekday: 'short' })}</span>
                  <span className="wo-num">{parseYmd(e.on).getDate()}</span>
                </div>
                <div className="wo-body">
                  <div className="wo-title">{e.title}</div>
                  <div className="wo-meta">
                    <span className="sr">{dayWord(e.on, today)}, </span>
                    {e.start ? `${e.start}${e.end ? ` to ${e.end}` : ''}` : 'All day'}
                    {e.room ? ` · ${e.room}` : ''}
                  </div>
                  {e.repeat === 'weekly' && <span className="wo-tag">Every {LONG_DAYS[weekdayIndex(e.date)]}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="block block-news" aria-labelledby="h-news">
        <div className="block-head">
          <h2 id="h-news" className="block-title">Latest updates</h2>
          <a className="morelink" href="#/notifications">See all<Icon name="chevron" /></a>
        </div>
        <ErrorBox error={notes.error} />
        {!notes.docs ? <Loading label="Loading updates" /> : notes.docs.length === 0 ? (
          <Empty icon="bell" title="No updates yet">Rota changes, payslips and replies to your requests show up here.</Empty>
        ) : (
          <ol className="updates">
            {notes.docs.map((n) => (
              <li key={n.id} className={n.read ? '' : 'unread'}>
                <a href={n.link && n.link.startsWith('#/') ? n.link : '#/notifications'}>
                  <span className="up-dot" aria-hidden="true" />
                  <span className="up-body">
                    <span className="up-title">{n.title}{!n.read && <span className="sr"> (new)</span>}</span>
                    {n.body && <span className="up-text">{n.body}</span>}
                  </span>
                  <span className="up-when">{ago(n.createdAt)}</span>
                </a>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
