"""Contrast + light-surface audit of every menu page in dark mode (and light, for comparison)."""
import json, sys
from playwright.sync_api import sync_playwright
sys.path.insert(0, '/tmp/twsdark')
BASE = 'http://127.0.0.1:8871'
PW = 'Test-pass-12345'
JS = open('/tmp/twsdark/audit.js').read()
mode = sys.argv[1] if len(sys.argv) > 1 else 'dark'
page_name = sys.argv[2] if len(sys.argv) > 2 else 'index.html'
who_list = sys.argv[3].split(',') if len(sys.argv) > 3 else ['olly', 'sam', 'pat']
report = {}
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for who in who_list:
        c = b.new_context(viewport={'width': int(__import__('os').environ.get('W','1280')), 'height': 844}, color_scheme=mode, is_mobile=__import__('os').environ.get('W')=='390', has_touch=__import__('os').environ.get('W')=='390')
        c.route('**/*', lambda r: r.continue_() if r.request.url.startswith(('http://127.0.0.1', 'data:', 'blob:')) else r.abort())
        c.add_init_script('try{localStorage.setItem("tws-theme","%s")}catch(e){}' % mode)
        p = c.new_page()
        p.goto(BASE + '/' + page_name)
        p.wait_for_selector('input[type=password]')
        p.fill('input[type=email], input[autocomplete=username], input[name=email]', who + '@example.test')
        p.fill('input[type=password]', PW); p.keyboard.press('Enter')
        p.wait_for_selector('#sidemenu', state='attached', timeout=20000); p.wait_for_timeout(1500)
        hs = [h for h in p.eval_on_selector_all('#sidemenu a.sidelink', 'e => e.map(x => x.getAttribute("href"))') if h and h.startswith('#')]
        for h in dict.fromkeys(hs):
            p.goto(BASE + '/' + page_name + h); p.wait_for_timeout(1300)
            report['%s %s' % (who, h)] = p.evaluate(JS)
        c.close()
    b.close()
low = {}; light = {}
for k, v in report.items():
    for x in v['low']:
        low.setdefault((x['el'], x['fg'], x['bg']), []).append((k, x['ratio'], x['text']))
    for x in v['light']:
        light.setdefault((x['el'], x['bg']), []).append((k, x['area'], x['text']))
print('== LOW CONTRAST (%s): %d distinct' % (mode, len(low)))
for (el, fg, bg), w in sorted(low.items(), key=lambda kv: min(r for _, r, _ in kv[1])):
    print('  %.2f  %s  fg=%s bg=%s  e.g. %r on %s (%d places)' % (min(r for _, r, _ in w), el, fg, bg, w[0][2], w[0][0], len(w)))
print('== LIGHT SURFACES (%s): %d distinct' % (mode, len(light)))
for (el, bg), w in light.items():
    print('  %s bg=%s area=%d %r on %s' % (el, bg, w[0][1], w[0][2], w[0][0]))
