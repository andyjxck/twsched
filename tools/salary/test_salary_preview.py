"""Salary option: Team > person > Pay and holiday, panel, Home card, Payroll Export/Overview, rules.
Preview only (made-up data, local emulators). Usage: python3 salary.py"""
import json, os, urllib.request
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://127.0.0.1:8098')
PW = json.load(open('/home/sprite/tws-preview/seed-ids.json'))['password']
OUT = '/home/sprite/tws-preview/tests/shots'
os.makedirs(OUT, exist_ok=True)
SIZES = {'desktop': (1280, 800, False), 'iphone': (390, 844, True), 'android': (412, 915, True)}
FS = 'http://127.0.0.1:18085/v1/projects/demo-twsched/databases/(default)/documents'
AUTH = 'http://127.0.0.1:19099/identitytoolkit.googleapis.com/v1'
fails, errs, notes = [], [], []


def ok(cond, msg):
    if not cond:
        fails.append(msg)
    return cond


def http(method, url, body=None, token='owner'):
    rq = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token})
    try:
        with urllib.request.urlopen(rq) as r:
            return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')


def ids():
    _, d = http('GET', FS + '/staff?pageSize=50')
    return {x['fields']['name']['stringValue']: x['name'].split('/')[-1] for x in d['documents']}


def payinfo(uid):
    _, d = http('GET', FS + '/payInfo/' + uid)
    return {k: list(v.values())[0] for k, v in d.get('fields', {}).items()}


def login(b, who, size):
    w, h, mob = SIZES[size]
    c = b.new_context(viewport={'width': w, 'height': h}, is_mobile=mob, has_touch=mob)
    c.route('**/*', lambda r: r.continue_() if r.request.url.startswith((BASE, 'data:', 'blob:')) else r.abort())
    pg = c.new_page()
    pg.on('pageerror', lambda e: errs.append(f'{who}/{size}: {e}'))
    pg.goto(BASE + '/', wait_until='networkidle')
    pg.fill('input[autocomplete=username]', f'{who}@preview.test')
    pg.fill('input[type=password]', PW)
    pg.keyboard.press('Enter')
    pg.wait_for_timeout(3500)
    return c, pg


def open_person(pg, name):
    pg.evaluate('location.hash="#/team"')
    pg.wait_for_timeout(2500)
    pg.locator('.tws-namebtn', has_text=name).first.click()
    pg.wait_for_timeout(2500)


def sideways(pg):
    return pg.evaluate('document.documentElement.scrollWidth>innerWidth+1')


I = ids()
KIT, MIA, SAM = I['Kit Kitchen'], I['Mia Manager'], I['Sam Staff']
before_sam = payinfo(SAM)

with sync_playwright() as p:
    b = p.chromium.launch()
    # 1. Owner sets Kit to salaried on each size (desktop does the real save; phones check layout + validation)
    for size in ('iphone', 'android', 'desktop'):
        c, pg = login(b, 'owner', size)
        open_person(pg, 'Kit Kitchen')
        ps = pg.locator('[data-testid=team-payset]')
        if not ok(ps.count() == 1, f'owner/{size}: no Pay and holiday form'):
            c.close(); continue
        ok(ps.locator('select[name=payType]').input_value() == 'hourly', f'owner/{size}: Kit not hourly at start')
        ok(ps.locator('input[name=hourlyRate]').count() == 1, f'owner/{size}: hourly rate box missing')
        ps.locator('select[name=payType]').select_option('salary')
        pg.wait_for_timeout(300)
        ok(ps.locator('input[name=hourlyRate]').count() == 0, f'owner/{size}: hourly box still shown for salary')
        ok(ps.locator('input[name=annualSalary]').count() == 1, f'owner/{size}: salary box missing')
        # empty salary is refused
        ps.locator('button', has_text='Save').click()
        pg.wait_for_timeout(800)
        ok('Enter an annual salary' in ps.inner_text(), f'owner/{size}: empty salary not refused')
        ps.locator('input[name=annualSalary]').fill('26000')
        pg.wait_for_timeout(300)
        hint = ps.locator('[data-testid=team-salary-hint]').inner_text()
        ok('£2,166.67' in hint and 'monthly' in hint, f'owner/{size}: hint wrong: {hint}')
        box = ps.bounding_box()
        ok(box and box['x'] >= 0 and box['x'] + box['width'] <= SIZES[size][0] + 1, f'owner/{size}: form off screen {box}')
        ok(not sideways(pg), f'owner/{size}: sideways scroll on Team')
        ps.scroll_into_view_if_needed()
        pg.screenshot(path=f'{OUT}/salary-owner-{size}-team-form.png')
        if size == 'desktop':
            ps.locator('button', has_text='Save').click()
            pg.wait_for_timeout(1500)
            ok('Saved.' in ps.inner_text(), f'owner/{size}: save failed: {ps.inner_text()[-200:]}')
            pi = payinfo(KIT)
            notes.append(('Kit payInfo after save', pi))
            ok(pi.get('payType') == 'salary' and float(pi.get('annualSalary', 0)) == 26000 and 'hourlyRate' not in pi,
               f'Kit doc wrong: {pi}')
            pg.reload(wait_until='load'); pg.wait_for_timeout(3000)
            open_person(pg, 'Kit Kitchen')
            ps = pg.locator('[data-testid=team-payset]')
            ok(ps.locator('select[name=payType]').input_value() == 'salary', 'reload: Paid by not salary')
            ok(ps.locator('input[name=annualSalary]').input_value() in ('26000', '26000.00'), 'reload: salary value lost')
            panel = pg.locator('.tws-personpanel').first.inner_text()
            notes.append(('Kit panel (owner, desktop)', panel[:300]))
            ok('£2,166.67' in panel and 'salary this period' in panel and 'salaried' in panel, 'panel does not show salary')
            ok('no pay rate set' not in panel, 'panel still says no pay rate set')
            pg.screenshot(path=f'{OUT}/salary-owner-desktop-panel.png', full_page=True)
            # Mia: salary then back to hourly -> doc goes back to the old hourly shape
            open_person(pg, 'Mia Manager')
            ps = pg.locator('.tws-personpanel').filter(has=pg.locator('[data-testid=team-payset]')).last.locator('[data-testid=team-payset]')
            ps.locator('select[name=payType]').select_option('salary')
            ps.locator('input[name=annualSalary]').fill('30000')
            ps.locator('button', has_text='Save').click(); pg.wait_for_timeout(1500)
            ok(payinfo(MIA).get('payType') == 'salary', 'Mia salary not saved')
            ps.locator('select[name=payType]').select_option('hourly')
            pg.wait_for_timeout(300)
            ok(ps.locator('input[name=hourlyRate]').input_value() in ('12.5', '12.50'), 'Mia old hourly value not kept in form')
            ps.locator('input[name=hourlyRate]').fill('13')
            ps.locator('button', has_text='Save').click(); pg.wait_for_timeout(1500)
            mi = payinfo(MIA)
            notes.append(('Mia payInfo after back to hourly', mi))
            ok(float(mi.get('hourlyRate', 0)) == 13 and 'payType' not in mi and 'annualSalary' not in mi, f'Mia doc wrong: {mi}')
        c.close()

    # 2. Payroll > Export and Overview (owner + payroll, all sizes)
    for who in ('owner', 'payroll'):
        for size in SIZES:
            c, pg = login(b, who, size)
            pg.evaluate('location.hash="#/payroll"'); pg.wait_for_timeout(3000)
            ov = pg.inner_text('main')
            ok('Missing hourly rate' not in ov or 'Kit Kitchen' not in ov.split('Missing hourly rate')[1][:80],
               f'{who}/{size}: Kit listed as missing hourly rate')
            pg.locator('main').get_by_role('tab', name='Export').first.click(); pg.wait_for_timeout(2500)
            heads = pg.eval_on_selector_all('.tws-table th', 'e=>e.map(x=>x.innerText.trim())')
            rows = pg.eval_on_selector_all('.tws-table tbody tr', 'e=>e.map(r=>[...r.cells].map(c=>c.innerText.trim()))')
            if size == 'desktop':
                notes.append((f'{who} export headings', heads))
                notes.append((f'{who} export rows', rows))
            ok(heads[:9] == ['Staff name', 'Staff/payroll ID', 'Period start', 'Period end', 'Ordinary hours', 'Overtime hours',
                             'Holiday hours', 'Hourly rate', 'Gross estimate'], f'{who}/{size}: first 9 columns changed {heads}')
            ok(heads[9:] == ['Pay type', 'Annual salary'], f'{who}/{size}: new columns {heads[9:]}')
            R = {r[0]: dict(zip(heads, r)) for r in rows}
            k, s = R.get('Kit Kitchen'), R.get('Sam Staff')
            ok(k and k['Hourly rate'] == '' and k['Gross estimate'] == '2166.67' and k['Pay type'] == 'Salaried'
               and k['Annual salary'] == '26000.00', f'{who}/{size}: Kit row {k}')
            ok(s and s['Hourly rate'] == '12.50' and s['Pay type'] == 'Hourly' and s['Annual salary'] == ''
               and s['Gross estimate'] != '', f'{who}/{size}: Sam row {s}')
            ok(not sideways(pg), f'{who}/{size}: sideways scroll on Export')
            pg.screenshot(path=f'{OUT}/salary-{who}-{size}-export.png', full_page=True)
            # CSV, if the period can be downloaded
            dl = pg.locator('[data-testid=export-download]')
            if size == 'desktop' and dl.count() and dl.is_enabled():
                with pg.expect_download() as d:
                    dl.click()
                txt = open(d.value.path(), encoding='utf-8-sig').read()
                notes.append((f'{who} CSV', txt[:600]))
                ok(txt.splitlines()[0].startswith('Staff name,Staff/payroll ID,Period start,Period end,Ordinary hours,Overtime hours,Holiday hours,Hourly rate,Gross estimate,Pay type,Annual salary'), f'{who}: CSV header {txt.splitlines()[0]}')
            elif size == 'desktop':
                notes.append((f'{who} CSV', 'download button disabled (weeks not approved)'))
            if who == 'payroll' and size == 'desktop':
                pg.evaluate('location.hash="#/team"'); pg.wait_for_timeout(2500)
                notes.append(('payroll can open Team', pg.locator('.tws-namebtn').count()))
            c.close()

    # 3. Kit (staff) sees own salary on Home; manager sees no pay form or salary
    for size in SIZES:
        c, pg = login(b, 'kit', size)
        pg.evaluate('location.hash="#/"'); pg.wait_for_timeout(3000)
        card = pg.locator('.tws-paycard').first
        t = card.inner_text() if card.count() else ''
        if size == 'desktop':
            notes.append(('Kit Home pay card', t[:200]))
        ok('£2,166.67' in t, f'kit/{size}: Home card does not show salary: {t[:120]}')
        ok(not sideways(pg), f'kit/{size}: sideways scroll on Home')
        pg.screenshot(path=f'{OUT}/salary-kit-{size}-home.png')
        c.close()
        c, pg = login(b, 'manager', size)
        open_person(pg, 'Kit Kitchen')
        t = pg.inner_text('main')
        ok(pg.locator('[data-testid=team-payset]').count() == 0, f'manager/{size}: pay form visible')
        ok('26,000' not in t and '26000' not in t and '2,166.67' not in t, f'manager/{size}: salary visible')
        ok(not sideways(pg), f'manager/{size}: sideways scroll on Team')
        c.close()
    b.close()

# 4. Rules (signed-in tokens from the auth emulator, straight to the Firestore emulator)
def token(who):
    _, d = http('POST', AUTH + '/accounts:signInWithPassword?key=fake', {'email': f'{who}@preview.test', 'password': PW, 'returnSecureToken': True})
    return d['idToken']


T = {w: token(w) for w in ('owner', 'payroll', 'manager', 'staff', 'kit')}


def write(who, uid, fields, uid_self):
    f = {'staffId': {'stringValue': uid}, 'updatedBy': {'stringValue': uid_self}}
    for k, v in fields.items():
        f[k] = {'stringValue': v} if isinstance(v, str) else {'doubleValue': v}
    body = {'writes': [{'update': {'name': f'projects/demo-twsched/databases/(default)/documents/payInfo/{uid}', 'fields': f},
                        'updateTransforms': [{'fieldPath': 'updatedAt', 'setToServerValue': 'REQUEST_TIME'}]}]}
    st, _ = http('POST', FS.replace('/documents', '/documents:commit'), body, T[who])
    return st


OWN, PAY = I['Olly Owner'], I['Pat Payroll']
tests = [('owner', SAM, {'payType': 'salary', 'annualSalary': 28000.0}, OWN, 200),
         ('payroll', SAM, {'payType': 'salary', 'annualSalary': 28000.0}, PAY, 200),
         ('owner', SAM, {'payType': 'weekly', 'annualSalary': 28000.0}, OWN, 403),
         ('owner', SAM, {'payType': 'salary', 'annualSalary': 2000000.0}, OWN, 403),
         ('manager', SAM, {'payType': 'salary', 'annualSalary': 28000.0}, MIA, 403),
         ('staff', SAM, {'payType': 'salary', 'annualSalary': 99000.0}, SAM, 403),
         ('owner', SAM, {'hourlyRate': 12.5, 'payrollId': 'P-SAM'}, OWN, 200)]
for who, uid, fields, me, want in tests:
    st = write(who, uid, fields, me)
    ok(st == want, f'rules: {who} write {fields} -> {st}, wanted {want}')
reads = [('manager', KIT, 403), ('staff', KIT, 403), ('kit', KIT, 200), ('payroll', KIT, 200)]
for who, uid, want in reads:
    st, _ = http('GET', FS + '/payInfo/' + uid, token=T[who])
    ok(st == want, f'rules: {who} read Kit payInfo -> {st}, wanted {want}')
# put Sam back exactly as seeded
http('PATCH', FS + '/payInfo/' + SAM, {'fields': {'staffId': {'stringValue': SAM}, 'payrollId': {'stringValue': before_sam['payrollId']},
                                                   'hourlyRate': {'doubleValue': float(before_sam['hourlyRate'])},
                                                   'updatedBy': {'stringValue': before_sam['updatedBy']},
                                                   'updatedAt': {'timestampValue': before_sam['updatedAt']}}})

for n in notes:
    print(n[0], ':', json.dumps(n[1], ensure_ascii=False)[:900])
print('PAGE ERRORS', errs)
print('FAILS', len(fails))
for f in fails:
    print(' -', f)
