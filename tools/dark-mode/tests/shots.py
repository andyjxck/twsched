"""Dark mode browser checks against the real bundle (test copy pointed at local emulators). Fake people only."""
import json, sys, time, os
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:8871'
PW = 'Test-pass-12345'
OUT = '/tmp/twsdark/shots'
os.makedirs(OUT, exist_ok=True)
res = {'pass': 0, 'fail': 0}


def check(name, cond, detail=''):
    res['pass' if cond else 'fail'] += 1
    print(('PASS  ' if cond else 'FAIL  ') + name + (('  ->  ' + str(detail)) if detail else ''), flush=True)


FIRST_PAINT = """
window.__themeAtBody = 'unset';
new MutationObserver(function(ms, o){ for (const m of ms) for (const n of m.addedNodes) {
  if (n.tagName === 'BODY' || (n.tagName === 'LINK' && n.rel === 'stylesheet')) {
    window.__themeAtBody = document.documentElement.getAttribute('data-theme') || 'light'; o.disconnect(); return; } } })
  .observe(document, {childList: true, subtree: true});
"""


def ctx(b, scheme='light', w=1280, h=860, mobile=False):
    c = b.new_context(viewport={'width': w, 'height': h}, color_scheme=scheme, is_mobile=mobile, has_touch=mobile,
                      device_scale_factor=1)
    c.route('**/*', lambda r: r.continue_() if r.request.url.startswith(('http://127.0.0.1', 'data:', 'blob:')) else r.abort())
    c.add_init_script(FIRST_PAINT)
    return c


def login(p, email, page='/'):
    p.goto(BASE + page)
    p.wait_for_selector('input[type=password]', timeout=15000)
    p.fill('input[type=email], input[autocomplete=username], input[name=email]', email)
    p.fill('input[type=password]', PW)
    p.keyboard.press('Enter')
    p.wait_for_selector('#sidemenu', state='attached', timeout=20000)
    p.wait_for_timeout(1500)


def nav_items(p):
    hs = p.eval_on_selector_all('#sidemenu a.sidelink', 'els => els.map(e => e.getAttribute("href"))')
    out = []
    for h in hs:
        if h and h.startswith('#') and h not in out:
            out.append(h)
    return out


with sync_playwright() as pw:
    b = pw.chromium.launch()

    # 1. First visit follows the device; no light flash in dark.
    for scheme in ('light', 'dark'):
        c = ctx(b, scheme); p = c.new_page(); p.goto(BASE + '/'); p.wait_for_selector('input[type=password]')
        got = p.evaluate('document.documentElement.getAttribute("data-theme") || "light"')
        at_body = p.evaluate('window.__themeAtBody')
        check('first visit, device %s -> %s theme' % (scheme, scheme), got == scheme, got)
        check('device %s: theme set before the first stylesheet/body (no flash)' % scheme, at_body == scheme, at_body)
        bg = p.evaluate('getComputedStyle(document.body).backgroundColor')
        p.screenshot(path='%s/login-%s.png' % (OUT, scheme))
        c.close()

    # 2. Owner, dark: every menu page.
    errors = []
    c = ctx(b, 'dark'); p = c.new_page()
    p.on('pageerror', lambda e: errors.append(str(e)))
    login(p, 'olly@example.test')
    t = p.locator('.tws-themetoggle')
    check('switch is in the menu footer', t.count() == 1)
    check('switch role=switch, aria-checked=true in dark', t.get_attribute('role') == 'switch' and t.get_attribute('aria-checked') == 'true')
    order = p.eval_on_selector_all('#sidemenu .side-foot .sidelink', 'els => els.map(e => e.textContent.trim())')
    check('switch sits above Sign out', len(order) >= 2 and 'Dark mode' in order[-2], order)
    items = nav_items(p)
    print('menu pages:', items)
    for i, href in enumerate(items):
        p.goto(BASE + '/' + href if href.startswith('#') else BASE + href)
        p.wait_for_timeout(1300)
        name = href.strip('#/').replace('/', '_') or 'home'
        p.screenshot(path='%s/owner-dark-%02d-%s.png' % (OUT, i, name), full_page=True)
    check('no page errors while browsing (owner, dark)', not errors, errors[:3])

    # 3. Toggle to light: remembered across reload; then back.
    p.goto(BASE + '/'); p.wait_for_selector('.tws-themetoggle')
    p.click('.tws-themetoggle'); p.wait_for_timeout(200)
    check('click -> light', p.evaluate('document.documentElement.getAttribute("data-theme")') is None)
    check('saved light', p.evaluate('localStorage.getItem("tws-theme")') == 'light')
    check('aria-checked false in light', p.get_attribute('.tws-themetoggle', 'aria-checked') == 'false')
    p.reload(); p.wait_for_selector('#sidemenu', state='attached')
    check('light choice survives reload on a dark device', p.evaluate('window.__themeAtBody') == 'light')
    p.click('.tws-themetoggle'); p.wait_for_timeout(200)
    p.reload(); p.wait_for_selector('#sidemenu', state='attached')
    check('dark choice survives reload', p.evaluate('window.__themeAtBody') == 'dark')
    # keyboard
    p.focus('.tws-themetoggle'); p.keyboard.press('Enter'); p.wait_for_timeout(150)
    check('switch works from the keyboard', p.evaluate('document.documentElement.getAttribute("data-theme")') is None)
    p.keyboard.press('Space'); p.wait_for_timeout(150)
    check('space toggles back', p.evaluate('document.documentElement.getAttribute("data-theme")') == 'dark')
    # Collapsed menu
    collapse = p.locator('.tws-side-collapse, [data-testid=side-collapse], button[aria-label*=ollapse]')
    if collapse.count():
        collapse.first.click(); p.wait_for_timeout(400)
        p.screenshot(path='%s/owner-dark-collapsed.png' % OUT)
        check('switch still reachable when menu is collapsed', p.locator('.tws-themetoggle').is_visible())
        p.locator('.tws-side-collapse, button[aria-label*=xpand], button[aria-label*=ollapse]').first.click(); p.wait_for_timeout(300)
    c.close()

    # 4. Explicit choice beats device setting change.
    c = ctx(b, 'light'); p = c.new_page(); login(p, 'olly@example.test')
    p.emulate_media(color_scheme='dark'); p.wait_for_timeout(200)
    check('no saved choice: follows a live device switch to dark', p.evaluate('document.documentElement.getAttribute("data-theme")') == 'dark')
    p.click('.tws-themetoggle'); p.emulate_media(color_scheme='dark'); p.wait_for_timeout(200)
    p.emulate_media(color_scheme='light'); p.emulate_media(color_scheme='dark'); p.wait_for_timeout(200)
    check('saved light ignores device dark', p.evaluate('document.documentElement.getAttribute("data-theme")') is None)
    p2 = c.new_page(); p2.goto(BASE + '/'); p2.wait_for_selector('#sidemenu', state='attached')
    p.click('.tws-themetoggle'); p2.wait_for_timeout(400)
    check('other open tab follows the change', p2.evaluate('document.documentElement.getAttribute("data-theme")') == 'dark')
    c.close()

    # 5. Staff + payroll + manager, dark, every menu page.
    for who in ('sam', 'pat', 'mia'):
        errors = []
        c = ctx(b, 'dark'); p = c.new_page(); p.on('pageerror', lambda e: errors.append(str(e)))
        login(p, who + '@example.test')
        check(who + ': switch present', p.locator('.tws-themetoggle').count() == 1)
        for i, href in enumerate(nav_items(p)):
            p.goto(BASE + '/' + href if href.startswith('#') else BASE + href); p.wait_for_timeout(1200)
            name = href.strip('#/').replace('/', '_') or 'home'
            p.screenshot(path='%s/%s-dark-%02d-%s.png' % (OUT, who, i, name), full_page=True)
        check(who + ': no page errors (dark)', not errors, errors[:3])
        c.close()

    # 6. Mobile, dark: home, drawer open with the switch, rota.
    c = ctx(b, 'dark', 390, 844, True); p = c.new_page(); login(p, 'sam@example.test')
    p.screenshot(path='%s/mobile-sam-dark-home.png' % OUT, full_page=True)
    burger = p.locator('.mbar button, button[aria-label*=enu]')
    if burger.count():
        burger.first.click(); p.wait_for_timeout(500)
        p.screenshot(path='%s/mobile-sam-dark-drawer.png' % OUT)
        check('mobile: switch visible in the open menu', p.locator('.tws-themetoggle').is_visible())
    c.close()
    c = ctx(b, 'dark', 390, 844, True); p = c.new_page(); login(p, 'olly@example.test')
    for i, href in enumerate(nav_items(p)[:12]):
        p.goto(BASE + '/' + href if href.startswith('#') else BASE + href); p.wait_for_timeout(1100)
        name = href.strip('#/').replace('/', '_') or 'home'
        p.screenshot(path='%s/mobile-owner-dark-%02d-%s.png' % (OUT, i, name), full_page=True)
    c.close()
    b.close()

print('RESULT pass=%d fail=%d' % (res['pass'], res['fail']))
