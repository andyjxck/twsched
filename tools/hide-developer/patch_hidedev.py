#!/usr/bin/env python3
"""Hide the developer maintenance login from everyone but owners (Andy, 30 Oct 2026).

Why: 'Andy (developer)' showed on the Rota, the printed rota and staff pickers. The app already dropped
records with developer: true in its live-data hook, but the live record had no developer flag (it was
made from Team as an ordinary owner), so nothing hid it. The data fix (mark_developer.js) sets the flag;
this patch makes the app's hiding one shared test and stops managers and payroll ever loading it.

One shared helper in the main bundle:
  __twsIsDev(d)   developer === true or role === 'developer'
  __twsStaffQ()   the one staff query every page uses:
                    owner             -> all of /staff by name (the live hook still drops the developer,
                                         except on the Team page, which opts in with __twsKeepDev)
                    manager / payroll -> /staff where developer == false (firestore.rules refuse them
                                         the developer record, so the query has to say so), sorted by name
                                         in the hook
                    team member       -> /directory (never holds the developer)
The live hook (He) drops __twsIsDev records unless the query opts in with __twsKeepDev (Team, owners only).
The payroll module gets the same query and the same test.
Team: the developer's pill says it is the maintenance login and that only owners can see it.

Builds index-tws2610hd.js from index-tws2610rz.js and payroll-tws2610hd.js from payroll-tws2610sl.js,
and points public/index.html and public/404.html at them.
Run from the repo root: python3 tools/hide-developer/patch_hidedev.py
"""
import pathlib, re

ROOT = pathlib.Path(__file__).resolve().parents[2]
A = ROOT / 'public' / 'assets'
MAIN_SRC, MAIN_DST = A / 'index-tws2610rz.js', A / 'index-tws2610hd.js'
PAY_SRC, PAY_DST = A / 'payroll' / 'payroll-tws2610sl.js', A / 'payroll' / 'payroll-tws2610hd.js'


def rep(s, old, new, n=1):
    assert s.count(old) == n, f'{old[:80]!r} found {s.count(old)} times, expected {n}'
    return s.replace(old, new)


# ---------------------------------------------------------------- main bundle
s = MAIN_SRC.read_text(encoding='utf-8')

HELPERS = (
    '\n// Developer maintenance login: only owners may know it exists (Andy, 30 Oct). One test, one staff query.\n'
    'function __twsIsDev(d){return!!d&&(d.developer===!0||d.role==="developer")}\n'
    'function __twsByName(a,b){var x=String(a.name||""),y=String(b.name||"");return x<y?-1:x>y?1:0}\n'
    'function __twsStaffQ(){var c=window.__twsCtx||{};if(c.isOwner)return Ze(Fe(Ee,"staff"),An("name"));'
    'if(c.isManager||c.canPayroll){var q=Ze(Fe(Ee,"staff"),ot("developer","==",!1));q.__twsSortName=!0;return q}'
    'return Ze(Fe(Ee,"directory"),An("name"))}\n'
)
s = rep(s, '\nfunction __twsStaffCol(){', HELPERS + 'function __twsStaffCol(){')

# every staff list goes through the one query (Rota grid + print, swap picker, payslips, unavailability, Team)
assert s.count('Ze(Fe(Ee,__twsStaffCol()),An("name"))') == 5
s = s.replace('Ze(Fe(Ee,__twsStaffCol()),An("name"))', '__twsStaffQ()')
assert '__twsStaffCol()' not in s.replace('function __twsStaffCol()', '')
assert 'Object.assign(__twsStaffQ(),{__twsKeepDev:n.isOwner})' in s, 'Team opt-in missing'

# the live-data hook: one test, and name order for the filtered manager/payroll query
s = rep(s, 'r({docs:l.docs.filter(d=>i.__twsKeepDev===!0||d.data().developer!==!0).map(d=>({id:d.id,...d.data()})),error:null})',
        'r({docs:((x)=>i.__twsSortName?x.sort(__twsByName):x)(l.docs.filter(d=>i.__twsKeepDev===!0||!__twsIsDev(d.data())).map(d=>({id:d.id,...d.data()}))),error:null})')

# Team (owners only ever get the record): say what it is
s = rep(s, 'n.developer&&f.jsxs(f.Fragment,{children:[" ",f.jsx("span",{className:"pill amber","data-testid":"dev-pill",children:"Developer maintenance login. It can\u2019t see any staff information"})]})',
        '__twsIsDev(n)&&f.jsxs(f.Fragment,{children:[" ",f.jsx("span",{className:"pill amber","data-testid":"dev-pill",children:n.role==="developer"?"Developer maintenance login. It can\u2019t see any staff information. Only owners can see it":"Developer maintenance login. Only owners can see it"})]})')

MAIN_DST.write_text(s, encoding='utf-8')

# ---------------------------------------------------------------- payroll module
p = PAY_SRC.read_text(encoding='utf-8')
p = rep(p, 'function R(e){return I().collection(I().db,e)}',
        'function R(e){return I().collection(I().db,e)}'
        'function __twsIsDev(d){return!!d&&(d.developer===!0||d.role==="developer")}'
        'function __twsStaffQ(){if(X()==="owner")return I().query(R("staff"),I().orderBy("name"));'
        'let q=I().query(R("staff"),I().where("developer","==",!1));q.__twsSortName=!0;return q}')
assert p.count('I().query(R("staff"),I().orderBy("name"))') == 5  # 4 pages + the owner branch above
p = p.replace('U(()=>I().query(R("staff"),I().orderBy("name")),[])', 'U(()=>__twsStaffQ(),[])')
assert p.count('__twsStaffQ(),[]') == 4
p = rep(p, 'I().onSnapshot(l,o=>n({docs:o.docs.filter(i=>i.data().developer!==!0).map(i=>({id:i.id,...i.data()})),error:null})',
        'I().onSnapshot(l,o=>n({docs:((x)=>l.__twsSortName?x.sort((a,b)=>{let c=String(a.name||""),d=String(b.name||"");return c<d?-1:c>d?1:0}):x)(o.docs.filter(i=>!__twsIsDev(i.data())).map(i=>({id:i.id,...i.data()}))),error:null})')
PAY_DST.write_text(p, encoding='utf-8')

# ---------------------------------------------------------------- html
for name in ['index.html', '404.html']:
    f = ROOT / 'public' / name
    h = f.read_text(encoding='utf-8')
    h, k = re.subn(r'/assets/index-tws2610(hs|rz)\.js', '/assets/index-tws2610hd.js', h)
    assert k == 1, f'{name}: main bundle reference found {k} times'
    h = rep(h, '/assets/payroll/payroll-tws2610sl.js', '/assets/payroll/payroll-tws2610hd.js')
    if 'rotaprint-tws2610pa' not in h:  # 404.html never got the print files
        h = h.replace('</head>', '  <link rel="stylesheet" href="/assets/rotaprint-tws2610pa.css">\n'
                      '  <script defer src="/assets/rotaprint-tws2610pa.js"></script>\n</head>', 1)
    f.write_text(h, encoding='utf-8')
print('wrote', MAIN_DST.name, PAY_DST.name, '; index.html and 404.html updated')
