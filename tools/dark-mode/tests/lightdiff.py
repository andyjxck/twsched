"""Light mode must be unchanged: original index (before.html) vs new index.html, light theme, switch hidden."""
import sys
from playwright.sync_api import sync_playwright
from PIL import Image, ImageChops
BASE = 'http://127.0.0.1:8871'
PW = 'Test-pass-12345'
OUT = '/tmp/twsdark/shots/light'
import os; os.makedirs(OUT, exist_ok=True)
same = diff = 0
import time as _t
T0 = _t.time() + 5
with sync_playwright() as pw:
    b = pw.chromium.launch()
    for w, h, mob in ((1280, 860, False), (390, 844, True)):
        for who in ('olly', 'sam', 'pat', 'mia'):
            shots = {}
            for page_name in ('before.html', 'index.html'):
                c = b.new_context(viewport={'width': w, 'height': h}, color_scheme='light', is_mobile=mob, has_touch=mob,
                                  reduced_motion='reduce')
                c.route('**/*', lambda r: r.continue_() if r.request.url.startswith(('http://127.0.0.1', 'data:', 'blob:')) else r.abort())
                p = c.new_page()
                p.clock.set_fixed_time(T0)
                p.goto(BASE + '/' + page_name); p.wait_for_selector('input[type=password]')
                p.wait_for_timeout(600)
                shots[(page_name, 'login')] = p.screenshot()
                p.fill('input[type=email], input[autocomplete=username], input[name=email]', who + '@example.test')
                p.fill('input[type=password]', PW); p.keyboard.press('Enter')
                p.wait_for_selector('#sidemenu', state='attached', timeout=20000); p.wait_for_timeout(1500)
                p.add_style_tag(content='.tws-themetoggle{display:none!important} *{caret-color:transparent!important;animation:none!important;transition:none!important}')
                hs = [x for x in p.eval_on_selector_all('#sidemenu a.sidelink', 'e => e.map(x => x.getAttribute("href"))') if x and x.startswith('#')]
                for x in dict.fromkeys(hs):
                    p.goto(BASE + '/' + page_name + x); p.wait_for_timeout(1400)
                    p.add_style_tag(content='.tws-themetoggle{display:none!important} *{caret-color:transparent!important;animation:none!important;transition:none!important}')
                    p.evaluate('document.querySelectorAll("time,[data-now]").length')
                    p.wait_for_timeout(300)
                    shots[(page_name, x)] = p.screenshot(full_page=True)
                c.close()
            keys = sorted(set(k[1] for k in shots))
            for k in keys:
                a, bb = shots.get(('before.html', k)), shots.get(('index.html', k))
                if a is None or bb is None:
                    print('MISSING', who, k); diff += 1; continue
                import io
                ia, ib = Image.open(io.BytesIO(a)).convert('RGB'), Image.open(io.BytesIO(bb)).convert('RGB')
                if ia.size != ib.size:
                    print('SIZE DIFF', w, who, k, ia.size, ib.size); diff += 1; continue
                box = ImageChops.difference(ia, ib).getbbox()
                if box is None:
                    same += 1
                else:
                    diff += 1
                    print('PIXEL DIFF', w, who, k, box)
                    tag = '%d-%s-%s' % (w, who, k.strip('#/') or 'home')
                    ia.save('%s/%s-before.png' % (OUT, tag)); ib.save('%s/%s-after.png' % (OUT, tag))
    b.close()
print('RESULT identical=%d different=%d' % (same, diff))
