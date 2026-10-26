# Right to Work check picker in the real patched bundle, against the local emulators only (demo-rtwchk).
# Made-up people and made-up files. Every request to anything but 127.0.0.1 is blocked.
import json, re, sys
from ui_lib import *

PDF = b'%PDF-1.4\n% made-up test file, not a real document\n%%EOF\n'
JPG = bytes([0xFF, 0xD8, 0xFF, 0xE0]) + b'\x00\x10JFIF\x00 made-up photo' + bytes([0xFF, 0xD9])
res = []
def ok(name, cond, detail=''):
    res.append(bool(cond)); print(('PASS' if cond else 'FAIL') + '  ' + name + (('  ->  ' + detail) if detail else ''))

def open_editor(p, email):
    p.goto(URL + '#/team'); p.reload(wait_until='load'); p.wait_for_timeout(2500)
    li = p.locator('li.tws-teamli').filter(has=p.locator(f'div.small:text-is("{email}")'))
    li.locator('button:has-text("Edit")').click(); p.wait_for_timeout(1500)

with sync_playwright() as pw:
    b = pw.chromium.launch()
    errs, blocked = [], []
    p = b.new_page(viewport={'width': 420, 'height': 900})
    p.on('pageerror', lambda e: errs.append(str(e)))
    guard(p, blocked)
    login(p, 'uiowner@example.test')

    # --- Tessa: Option A, passport on its own, uploaded as a scan.
    open_editor(p, 'uistaff@example.test')
    c = p.locator('[data-testid=rtw-check]').first
    ok('owner sees the check picker', c.count() == 1)
    opts = c.locator('[data-testid=rtw-route] option').all_inner_texts()
    ok('kinds of check in the dropdown', len(opts) == 5 and opts[0].startswith('Option A') and opts[1].startswith('Option B'), ' | '.join(opts))
    ok('passport type dropdown (passport or Irish passport card)', c.locator('[data-testid=rtw-type-1] option').all_inner_texts() == ['Passport', 'Irish passport card'])
    ok('upload and take-photo buttons', c.locator('[data-testid=rtw-upload-1]').is_visible() and c.locator('[data-testid=rtw-photo-1]').is_visible())
    cam = c.locator('[data-testid=rtw-camera-1]')
    ok('take photo opens the camera (capture=environment, images)', cam.get_attribute('capture') == 'environment' and cam.get_attribute('accept') == 'image/*')
    ok('date of the check defaults to today and can\'t be in the future', c.locator('[data-testid=rtw-date]').input_value() == c.locator('[data-testid=rtw-date]').get_attribute('max'))
    ok('says what is still needed', 'Still needed: Passport' in c.locator('[data-testid=rtw-needed]').inner_text())
    c.locator('[data-testid=rtw-input-1]').set_input_files({'name': 'passport-scan.pdf', 'mimeType': 'application/pdf', 'buffer': PDF})
    p.wait_for_timeout(300)
    ok('file shows in the slot', 'passport-scan.pdf' in c.locator('[data-testid=rtw-file-1]').inner_text())
    ok('no upload button before confirming', p.locator('button:has-text("Upload 1 file")').count() == 0)
    c.locator('[data-testid=rtw-declare]').check(); p.wait_for_timeout(300)
    ok('notes the app does not check documents', 'doesn’t check the documents' in c.locator('[data-testid=rtw-needed]').inner_text())
    up = p.locator('button:has-text("Upload 1 file")')
    ok('upload button appears once complete', up.count() == 1)
    up.click()
    p.wait_for_selector('text=On file', timeout=25000)
    body = p.inner_text('body')
    m = re.search(r'On file, checked (\d\d/\d\d/\d{4})', body)
    ok('shows On file with the date of the check', bool(m), m.group(0) if m else body[body.find('Right to Work'):][:200])
    p.locator('button:has-text("View files")').first.click(); p.wait_for_timeout(1500)
    t = p.inner_text('body')
    ok('file list shows the check date', 'passport-scan.pdf' in t and '· checked ' in t)

    # --- Bob: Option B, birth certificate (scan) + NI proof (camera photo).
    open_editor(p, 'uistaff2@example.test')
    c = p.locator('[data-testid=rtw-check]').first
    c.locator('[data-testid=rtw-route]').select_option('birth_ni'); p.wait_for_timeout(300)
    ok('Option B shows two documents', c.locator('[data-testid=rtw-slot-1]').count() == 1 and c.locator('[data-testid=rtw-slot-2]').count() == 1)
    s2 = c.locator('[data-testid=rtw-slot-2]').inner_text()
    ok('NI slot explains the number alone doesn\'t count', 'National Insurance proof' in s2 and 'on its own doesn’t count' in s2)
    c.locator('[data-testid=rtw-input-1]').set_input_files({'name': 'birth-cert.pdf', 'mimeType': 'application/pdf', 'buffer': PDF})
    c.locator('[data-testid=rtw-declare]').check(); p.wait_for_timeout(300)
    ok('one of two files: still needs NI proof, no upload button', 'Still needed: National Insurance proof' in c.locator('[data-testid=rtw-needed]').inner_text() and p.locator('button:has-text("Upload 2 files")').count() == 0)
    c.locator('[data-testid=rtw-camera-2]').set_input_files({'name': 'ni-letter-photo.jpg', 'mimeType': 'image/jpeg', 'buffer': JPG})
    p.wait_for_timeout(300)
    c.locator('[data-testid=rtw-date]').fill('2026-10-20'); p.wait_for_timeout(300)
    up = p.locator('button:has-text("Upload 2 files")')
    ok('both files: upload button appears', up.count() == 1)
    up.click()
    p.wait_for_selector('text=On file', timeout=30000)
    ok('Option B on file with its date', 'On file, checked 20/10/2026' in p.inner_text('body'))
    p.locator('button:has-text("View files")').first.click(); p.wait_for_timeout(1500)
    t = p.inner_text('body')
    ok('both files listed as file 1 of 2 and file 2 of 2', 'file 1 of 2' in t and 'file 2 of 2' in t, '')
    msgs = []
    p.once('dialog', lambda d: (msgs.append(d.message), d.dismiss()))
    p.locator('button[aria-label^="Remove ni-letter"], button:has-text("Remove")').last.click(); p.wait_for_timeout(800)
    ok('removing one file of the pair warns the check won\'t count', bool(msgs) and 'two-file check' in msgs[0], msgs[0] if msgs else 'no dialog')
    p.screenshot(path='/tmp/rtw2/ui_owner_b.png', full_page=True)

    # --- Manager: tick only, no picker, no files.
    p2 = b.new_page(viewport={'width': 420, 'height': 900})
    guard(p2, blocked)
    login(p2, 'uimgr@example.test')
    p2.goto(URL + '#/team'); p2.wait_for_timeout(2500)
    t = p2.inner_text('body')
    li = p2.locator('li.tws-teamli').filter(has=p2.locator('div.small:text-is("uistaff@example.test")'))
    if li.count() and li.locator('button:has-text("Edit")').count():
        li.locator('button:has-text("Edit")').click(); p2.wait_for_timeout(1500)
    t = p2.inner_text('body')
    ok('manager gets no check picker', p2.locator('[data-testid=rtw-check]').count() == 0)
    ok('manager gets no View files', p2.locator('button:has-text("View files")').count() == 0)
    print('manager RTW text:', (t[t.find('Right to Work'):][:200] if 'Right to Work' in t else '(no Right to Work section)').replace('\n', ' | '))

    ok('no page errors', not errs, '; '.join(errs)[:300])
    print('requests blocked (not local):', len(blocked), sorted(set(re.sub(r'\?.*', '', x) for x in blocked))[:5])
    b.close()

print(f'\n{sum(res)} passed, {len(res) - sum(res)} failed')
