// Demo data so both views can be tried. Run: npm run seed -- --reset   (wipes ALL app data first)
// Never run this against the real database once real staff are using it.
import { pool, tx } from './db.js'
import { migrate } from './migrate.js'
import { hashPassword, storeEncrypted } from './security.js'
import { todayIn, mondayOf, addDays } from './util.js'

export const DEMO_PASSWORD = 'swan-demo-2026'

// A tiny one-page PDF with a line of text, for demo payslips and documents.
function demoPdf(text) {
  const stream = `BT /F1 18 Tf 60 760 Td (${text.replace(/[()\\]/g, '')}) Tj ET`
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'; const offs = []
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

export async function seed({ reset = false } = {}) {
  await migrate()
  const today = todayIn('Europe/London')
  const week = mondayOf(today)
  const pw = hashPassword(DEMO_PASSWORD)
  await tx(async (db) => {
    if (reset) {
      await db.q(`TRUNCATE audit_log, events, payslips, rtw_documents, sales_days, sales_uploads, notifications, announcement_reads, announcements,
        problem_messages, shift_problems, swap_requests, time_off_requests, blackout_dates, unavailability, shifts, shift_templates, rota_weeks,
        sessions, invites, staff_profiles, memberships, users, venues, organisations RESTART IDENTITY CASCADE`)
    } else if ((await db.one('SELECT count(*)::int AS n FROM venues')).n > 0) {
      console.log('Data already present; run with --reset to wipe and reseed.'); return
    }
    const org = await db.one(`INSERT INTO organisations(name) VALUES ('Westbourne') RETURNING id`)
    const v = await db.one(`INSERT INTO venues(organisation_id, slug, name) VALUES ($1,'white-swan','The White Swan, Henley-in-Arden') RETURNING id`, [org.id])

    const people = [
      { key: 'owner', email: 'owner@whiteswan.demo', name: 'Olivia Owner', role: 'owner', position: null },
      { key: 'mgr', email: 'manager@whiteswan.demo', name: 'Morgan Manager', role: 'manager', position: 'Front of house', docs: true, type: 'regular', dpw: 5, rate: 14.5, contracted: 45 },
      { key: 'sam', email: 'staff@whiteswan.demo', name: 'Sam Taylor', role: 'staff', position: 'Bar', type: 'irregular', rate: 12.21, start: '2026-03-02' },
      { key: 'jess', email: 'jess@whiteswan.demo', name: 'Jess Patel', role: 'staff', position: 'Kitchen', type: 'regular', dpw: 5, rate: 13.0, contracted: 40, start: '2024-06-01' },
      { key: 'tom', email: 'tom@whiteswan.demo', name: 'Tom Hughes', role: 'staff', position: 'Bar', type: 'irregular', rate: 12.21, start: '2025-09-15' },
      { key: 'priya', email: 'supervisor@whiteswan.demo', name: 'Priya Shah', role: 'supervisor', position: 'Front of house', type: 'regular', dpw: 4, rate: 13.5, contracted: 32, start: '2023-04-10' },
      { key: 'dan', email: 'dan@whiteswan.demo', name: 'Dan Okafor', role: 'staff', position: 'Kitchen', type: 'irregular', rate: 12.21, start: '2026-07-01' },
    ]
    const M = {}
    for (const p of people) {
      const u = await db.one('INSERT INTO users(email, password_hash, full_name, phone) VALUES ($1,$2,$3,$4) RETURNING id', [p.email, pw, p.name, '07700 900' + String(100 + people.indexOf(p))])
      const m = await db.one('INSERT INTO memberships(user_id, venue_id, role, position, can_view_documents) VALUES ($1,$2,$3,$4,$5) RETURNING id', [u.id, v.id, p.role, p.position, !!p.docs])
      M[p.key] = m.id
      if (p.role !== 'owner') {
        await db.q(`INSERT INTO staff_profiles(membership_id, holiday_type, days_per_week, hours_per_day, contracted_hours, start_date, pay_rate) VALUES ($1,$2,$3,8,$4,$5,$6)`,
          [m.id, p.type, p.dpw || 5, p.contracted || null, p.start || '2022-01-10', p.rate])
      }
    }

    const T = [
      ['Bar open', '11:00', '17:00', 30, 'Bar'], ['Bar close', '17:00', '23:30', 30, 'Bar'], ['Kitchen lunch', '10:00', '15:00', 0, 'Kitchen'],
      ['Kitchen dinner', '16:30', '22:00', 30, 'Kitchen'], ['Front of house', '12:00', '20:00', 30, 'Front of house'], ['Late close', '18:00', '01:00', 30, 'Bar'],
    ]
    for (const t of T) await db.q('INSERT INTO shift_templates(venue_id, name, start_time, end_time, break_minutes, position) VALUES ($1,$2,$3,$4,$5,$6)', [v.id, ...t])

    // A weekly pattern, used for six past weeks (confirmed), this week (published) and next week (draft).
    const pattern = [
      // [dayOffset, who, start, end, break, position]
      [0, 'sam', '11:00', '17:00', 30, 'Bar'], [0, 'jess', '10:00', '15:00', 0, 'Kitchen'], [0, 'mgr', '12:00', '20:00', 30, 'Front of house'],
      [1, 'tom', '17:00', '23:30', 30, 'Bar'], [1, 'jess', '16:30', '22:00', 30, 'Kitchen'], [1, 'priya', '12:00', '20:00', 30, 'Front of house'],
      [2, 'sam', '17:00', '23:30', 30, 'Bar'], [2, 'dan', '16:30', '22:00', 30, 'Kitchen'], [2, 'mgr', '12:00', '20:00', 30, 'Front of house'],
      [3, 'sam', '11:00', '17:00', 30, 'Bar'], [3, 'tom', '17:00', '23:30', 30, 'Bar'], [3, 'jess', '10:00', '15:00', 0, 'Kitchen'], [3, 'priya', '12:00', '20:00', 30, 'Front of house'],
      [4, 'sam', '17:00', '23:30', 30, 'Bar'], [4, 'tom', '18:00', '01:00', 30, 'Bar'], [4, 'jess', '16:30', '22:00', 30, 'Kitchen'], [4, 'dan', '10:00', '15:00', 0, 'Kitchen'], [4, 'mgr', '12:00', '20:00', 30, 'Front of house'],
      [5, 'sam', '11:00', '17:00', 30, 'Bar'], [5, 'tom', '17:00', '23:30', 30, 'Bar'], [5, 'jess', '16:30', '22:00', 30, 'Kitchen'], [5, 'dan', '10:00', '15:00', 0, 'Kitchen'], [5, 'priya', '12:00', '20:00', 30, 'Front of house'],
      [6, 'tom', '11:00', '17:00', 30, 'Bar'], [6, 'dan', '10:00', '15:00', 0, 'Kitchen'], [6, 'mgr', '12:00', '20:00', 30, 'Front of house'],
    ]
    const shiftIds = {}
    for (let w = -6; w <= 1; w++) {
      const ws = addDays(week, w * 7)
      if (w <= 0) await db.q(`INSERT INTO rota_weeks(venue_id, week_start, status, published_at) VALUES ($1,$2,'published', now())`, [v.id, ws])
      for (const [d, who, s, e, br, pos] of pattern) {
        const date = addDays(ws, d)
        const confirmed = date < today
        const r = await db.one(`INSERT INTO shifts(venue_id, membership_id, shift_date, start_time, end_time, break_minutes, position, actual_start, actual_end, actual_break_minutes, confirmed_at, confirmed_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
          [v.id, M[who], date, s, e, br, pos, confirmed ? s : null, confirmed ? e : null, confirmed ? br : null, confirmed ? new Date() : null, confirmed ? M.mgr : null])
        shiftIds[`${w}:${d}:${who}`] = r.id
      }
    }
    // An open shift on Saturday this week.
    await db.q(`INSERT INTO shifts(venue_id, membership_id, shift_date, start_time, end_time, break_minutes, position, notes) VALUES ($1,NULL,$2,'18:00','23:30',30,'Bar','Wedding party in the function room')`, [v.id, addDays(week, 5)])

    // Requests waiting in the inbox.
    await db.q(`INSERT INTO time_off_requests(venue_id, membership_id, kind, start_date, end_date, hours, note) VALUES ($1,$2,'holiday',$3,$4,24,'Family wedding in Leeds')`, [v.id, M.jess, addDays(week, 23), addDays(week, 25)])
    await db.q(`INSERT INTO time_off_requests(venue_id, membership_id, kind, start_date, end_date, hours, status, decided_by, decided_at) VALUES ($1,$2,'holiday',$3,$4,16,'approved',$5,now())`, [v.id, M.priya, addDays(week, 15), addDays(week, 16), M.mgr])
    await db.q(`INSERT INTO swap_requests(venue_id, kind, from_membership_id, to_membership_id, from_shift_id, note, status, colleague_responded_at) VALUES ($1,'give',$2,$3,$4,'Dentist appointment, Dan said he can cover','awaiting_manager',now())`,
      [v.id, M.sam, M.dan, shiftIds['0:3:sam']])
    const snap = await db.one(`SELECT id, shift_date, to_char(start_time,'HH24:MI') AS start_time, to_char(end_time,'HH24:MI') AS end_time, position, membership_id FROM shifts WHERE id=$1`, [shiftIds['0:4:tom']])
    await db.q(`INSERT INTO shift_problems(venue_id, shift_id, shift_snapshot, raised_by, type, note) VALUES ($1,$2,$3,$4,'wrong_times','I can only stay until 23:00 on Friday, my last bus is at 23:15.')`, [v.id, snap.id, JSON.stringify(snap), M.tom])
    await db.q(`INSERT INTO unavailability(venue_id, membership_id, start_date, end_date, weekday, note) VALUES ($1,$2,$3,$4,2,'College on Tuesdays')`, [v.id, M.dan, addDays(week, 7), addDays(week, 7 * 12 + 6)])

    // Holiday ledger: Sam moved from cash in hand onto the books, starting on zero until the accountant says otherwise.
    await db.q(`INSERT INTO holiday_ledger(venue_id, membership_id, entry_date, kind, hours, note, created_by) VALUES ($1,$2,$3,'opening',0,'Moved onto the books: starting on zero until the accountant confirms a figure',$4)`, [v.id, M.sam, today, M.mgr])
    await db.q(`INSERT INTO holiday_ledger(venue_id, membership_id, entry_date, kind, hours, note, created_by) VALUES ($1,$2,$3,'carry_over',8,'1 day carried over from last year',$4)`, [v.id, M.jess, '2026-01-01', M.mgr])
    await db.q(`INSERT INTO time_off_requests(venue_id, membership_id, kind, start_date, end_date, hours, status, decided_by, decided_at) VALUES ($1,$2,'holiday','2026-08-10','2026-08-14',40,'approved',$3,now())`, [v.id, M.jess, M.mgr])

    await db.q(`INSERT INTO blackout_dates(venue_id, start_date, end_date, label) VALUES ($1,'2026-12-19','2027-01-01','Christmas and New Year')`, [v.id])

    await db.q(`INSERT INTO announcements(venue_id, author_membership_id, title, body, pinned) VALUES ($1,$2,'Welcome to the new staff app','Your shifts, holiday and swaps all live here now. Add it to your home screen: on iPhone tap Share then Add to Home Screen; on Android tap Install.',true)`, [v.id, M.mgr])
    await db.q(`INSERT INTO announcements(venue_id, author_membership_id, title, body, audience) VALUES ($1,$2,'New cask ale on Thursday','Purity Mad Goose is going on the bar. Please pull a taster before service.','Bar')`, [v.id, M.mgr])

    const ev = [
      [addDays(week, 3), 'Quiz night', '20:00', '22:30', 'Teams of up to six. £1 a head, prizes from the bar.'],
      [addDays(week, 5), 'Live music: The Arden Strings', '20:30', '23:00', 'Acoustic covers in the bar.'],
      [addDays(week, 6), 'Sunday roast', '12:00', '16:00', 'Book ahead for tables of six or more.'],
      [addDays(week, 12), 'Halloween party', '19:00', '23:30', 'Fancy dress encouraged.'],
    ]
    for (const [d, t, s, e, n] of ev) await db.q(`INSERT INTO events(venue_id, title, description, event_date, start_time, end_time, is_published, created_by) VALUES ($1,$2,$3,$4,$5,$6,true,$7)`, [v.id, t, n, d, s, e, M.mgr])
    await db.q(`INSERT INTO events(venue_id, title, description, event_date, start_time, is_published, created_by) VALUES ($1,'Christmas menu launch (draft)','Not on the website until published.',$2,'18:00',false,$3)`, [v.id, addDays(week, 20), M.mgr])

    // Takings for the past fortnight, typed in as the End of Day report figure (includes VAT).
    for (let i = 14; i >= 1; i--) {
      const d = addDays(today, -i)
      const dow = (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7
      const base = [1450, 1380, 1620, 1890, 3120, 3680, 2540][dow]
      await db.q(`INSERT INTO sales_days(venue_id, sales_date, source, net_sales, includes_vat, wet_sales, dry_sales, covers, entered_by) VALUES ($1,$2,'typed',$3,true,$4,$5,$6,$7)`,
        [v.id, d, base + (i * 37) % 200, Math.round(base * 0.55), Math.round(base * 0.45), Math.round(base / 28), M.mgr])
    }

    const ps = storeEncrypted(demoPdf('Demo payslip - Sam Taylor - week ending ' + addDays(week, -1)))
    await db.q(`INSERT INTO payslips(venue_id, membership_id, period_label, file_key, file_name, size_bytes, status, uploaded_by, released_at) VALUES ($1,$2,$3,$4,'payslip-demo.pdf',900,'released',$5,now())`,
      [v.id, M.sam, 'Week ending ' + addDays(week, -1), ps, M.mgr])
    const rtw = storeEncrypted(demoPdf('Demo right to work check - Jess Patel'))
    await db.q(`INSERT INTO rtw_documents(venue_id, membership_id, doc_type, check_date, check_method, expiry_date, file_key, file_name, mime, size_bytes, sha256, uploaded_by)
      VALUES ($1,$2,'UK passport','2024-05-28','manual',NULL,$3,'rtw-demo.pdf','application/pdf',900,'demo',$4)`, [v.id, M.jess, rtw, M.mgr])
    const rtw2 = storeEncrypted(demoPdf('Demo right to work check - Dan Okafor'))
    await db.q(`INSERT INTO rtw_documents(venue_id, membership_id, doc_type, check_date, check_method, expiry_date, file_key, file_name, mime, size_bytes, sha256, uploaded_by)
      VALUES ($1,$2,'Share code (time-limited)','2026-06-25','online_share_code',$3,$4,'share-code-check.pdf','application/pdf',900,'demo',$5)`, [v.id, M.dan, addDays(today, 40), rtw2, M.mgr])
  })
  console.log(`Seeded. Demo password for every account: ${DEMO_PASSWORD}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed({ reset: process.argv.includes('--reset') }).then(() => pool.end()).catch((e) => { console.error(e); process.exit(1) })
}
