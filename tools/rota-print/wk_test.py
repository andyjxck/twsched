# Printable rota on a phone: WebKit (Safari's engine) with an iPhone 13 profile, against the LOCAL emulators
# (made-up people, project demo-twostep). Needs the emulators and the test web copy on :9061 (see ui_test.js).
# Usage: python3 wk_test.py [out-prefix]
import sys, time, json, base64
from playwright.sync_api import sync_playwright
BASE = 'http://127.0.0.1:9061'
WEEK = '2026-11-02'
PW = 'Test-pass-12345'
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/rpx/out/wk'
passed = failed = 0
def check(name, ok, detail=''):
    global passed, failed
    passed += bool(ok); failed += (not ok)
    print(('PASS  ' if ok else 'FAIL  ') + name + ('  ->  ' + str(detail) if detail else ''))

with sync_playwright() as p:
    b = p.webkit.launch()
    ctx = b.new_context(**p.devices['iPhone 13'], accept_downloads=True)
    pg = ctx.new_page()
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    popups = []
    pg.on('popup', lambda pp: popups.append(pp.url))
    pg.goto(BASE + '/')
    pg.fill('input[type=email]', 'mia@example.test')
    pg.fill('input[type=password]', PW)
    pg.click('button:has-text("Sign in")')
    pg.wait_for_function('() => !document.querySelector("input[type=password]")', timeout=30000)
    time.sleep(1.5)
    pg.goto(f'{BASE}/#/rota?week={WEEK}')
    pg.wait_for_selector('[data-testid=print-rota]:not([disabled])', timeout=30000)
    time.sleep(1.5)
    url_before = pg.url
    pg.tap('[data-testid=print-rota]')
    pg.wait_for_selector('[data-testid=rota-print-sheet]', timeout=10000)
    ov = pg.evaluate('''() => { const r = document.getElementById('tws-rp').getBoundingClientRect();
      const bs = [...document.querySelectorAll('#tws-rp .tws-rp-bar button')].map(b => { const q = b.getBoundingClientRect(); const t = document.elementFromPoint(q.left + q.width/2, q.top + q.height/2); return { text: b.textContent, l: q.left, r: q.right, top: q.top, h: q.height, hit: t === b }; });
      return { rect: [r.left, r.top, r.width, r.height], vw: innerWidth, vh: innerHeight, buttons: bs, hist: !!(history.state && history.state.twsRotaPrint) }; }''')
    check('tap Print opens the preview full screen in the same tab', ov['rect'] == [0, 0, ov['vw'], ov['vh']] and not popups, ov['rect'])
    check('Print, Save PDF and Close on screen and tappable', [x['text'] for x in ov['buttons']][:1] == ['Print'] and len(ov['buttons']) == 3 and all(x['hit'] and x['l'] >= 0 and x['r'] <= ov['vw'] and x['h'] >= 30 for x in ov['buttons']), json.dumps(ov['buttons']))
    pg.screenshot(path=out + '-preview.png')

    # Save PDF gets ready in the background
    pg.wait_for_selector('[data-testid=rota-print-pdf]:not([disabled])', timeout=20000)
    info = pg.evaluate('() => { const x = window.__twsRotaPrint._pdf(); return x && { ready: x.ready, name: x.name, size: x.size, zoom: x.zoom, bytes: x.blob.size }; }')
    check('PDF made on the phone', info and info['ready'] and info['bytes'] > 5000, json.dumps(info))
    b64 = pg.evaluate('''async () => { const x = window.__twsRotaPrint._pdf(); const buf = new Uint8Array(await x.blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]); return btoa(s); }''')
    open(out + '-rota.pdf', 'wb').write(base64.b64decode(b64))

    # Print in a browser that can't print (headless WebKit here, like an in-app web view): a message, not silence
    pg.tap('[data-testid=rota-print-go]')
    time.sleep(2)
    nt = pg.evaluate('() => { const n = document.querySelector("[data-testid=rota-print-note]"); return n && n.style.display !== "none" ? n.textContent : ""; }')
    check('Print where printing does nothing shows what to do', 'Save PDF' in nt, nt)
    pg.screenshot(path=out + '-print-note.png')

    # Save PDF: share sheet if the browser has one, else a download
    share = pg.evaluate('() => !!(navigator.canShare && navigator.share)')
    got = None
    if not share:
        with pg.expect_download(timeout=10000) as dl:
            pg.tap('[data-testid=rota-print-pdf]')
        got = dl.value.suggested_filename
    check('Save PDF hands over the file', share or got == info['name'], 'share sheet' if share else got)

    # drafts ticked -> a new PDF with the draft
    pg.tap('.tws-rp-drafts')
    pg.wait_for_function('() => { const x = window.__twsRotaPrint._pdf(); return x && x.ready && x.key === "d"; }', timeout=20000)
    check('ticking drafts remakes the PDF', True)
    pg.tap('.tws-rp-drafts')

    # Back button closes the preview and leaves the Rota page as it was
    pg.go_back()
    time.sleep(1)
    st = pg.evaluate('() => ({ open: !!document.getElementById("tws-rp"), print: !!document.querySelector("[data-testid=print-rota]"), url: location.href })')
    check('Back closes the preview, still on the Rota page', not st['open'] and st['print'] and st['url'] == url_before, json.dumps(st))
    # open again, Close button
    pg.tap('[data-testid=print-rota]')
    pg.wait_for_selector('[data-testid=rota-print-sheet]')
    pg.tap('[data-testid=rota-print-close]')
    time.sleep(1)
    st2 = pg.evaluate('() => ({ open: !!document.getElementById("tws-rp"), print: !!document.querySelector("[data-testid=print-rota]"), url: location.href, scroll: getComputedStyle(document.documentElement).overflow })')
    check('Close closes it, page scrolls again', not st2['open'] and st2['print'] and st2['url'] == url_before and st2['scroll'] != 'hidden', json.dumps(st2))
    check('no page errors', not errors, ' | '.join(errors))
    b.close()
print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
