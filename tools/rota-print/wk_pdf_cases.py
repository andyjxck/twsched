# Save PDF edge cases in WebKit (iPhone profile): shift leader star, drafts, notes, holiday, a non-Latin name,
# and a very big week (45 people). Calls window.__twsRotaPrint with made-up data; no sign-in needed.
import sys, time, json, base64
from playwright.sync_api import sync_playwright
import os
BASE = os.environ.get('RP_BASE', 'http://127.0.0.1:9061')
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/rpx/out/case'
JS = '''(n) => {
  const days = [...Array(7)].map((_, i) => new Date(Date.UTC(2026, 10, 2 + i)).toISOString().slice(0, 10));
  const people = [{ id: 'open', name: 'Open shifts', open: true }];
  const shifts = [];
  for (let i = 0; i < n; i++) {
    people.push({ id: 'p' + i, name: i === 1 ? 'Zo\u00eb \u0141uk\u0105szewicz-Ng' : i === 2 ? '\u674e\u534e' : 'Person Number ' + i });
    days.forEach((x, d) => { if ((i + d) % 3) shifts.push({ staffId: 'p' + i, date: x, start: ['17:00', '12:00', '09:30'][(i + d) % 3], end: ['23:00', '18:00', '15:00'][(i + d) % 3], published: !(i === 3 && d === 5), leader: i === 0 && d === 5, notes: i === 4 && d === 1 ? 'Deep clean the fryers and stock check' : '' }); });
  }
  shifts.push({ staffId: 'p0', date: days[5], start: '19:00', end: '23:30', published: true });
  shifts.push({ staffId: '', date: days[4], start: '18:00', end: '22:00', published: true });
  const blocks = { ['p5|' + days[2]]: { kind: 'holiday' } };
  const events = days.map((x, i) => i === 3 ? [{ title: 'Music bingo', start: '19:30' }, { title: 'Quiz', start: '' }] : []);
  window.__twsRotaPrint({ weekStart: days[0], days, people, shifts, blocks, events, status: 'published' });
  document.querySelector('.tws-rp-drafts').click();
}'''
with sync_playwright() as p:
    b = p.webkit.launch()
    ctx = b.new_context(**p.devices['iPhone 13'])
    errs = []
    for n in (8, 45):
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(BASE + '/')
        pg.wait_for_function('() => !!window.__twsRotaPrint')
        pg.evaluate(JS, n)
        pg.wait_for_function('() => { const x = window.__twsRotaPrint._pdf(); return x && x.ready && x.key === "d"; }', timeout=20000)
        info = pg.evaluate('() => { const x = window.__twsRotaPrint._pdf(); return { size: x.size, zoom: x.zoom, bytes: x.blob.size, name: x.name }; }')
        b64 = pg.evaluate('''async () => { const x = window.__twsRotaPrint._pdf(); const buf = new Uint8Array(await x.blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]); return btoa(s); }''')
        open(f'{out}-{n}.pdf', 'wb').write(base64.b64decode(b64))
        pg.screenshot(path=f'{out}-{n}-preview.png')
        print(n, json.dumps(info))
        pg.close()
    print('errors:', errs)
    b.close()
