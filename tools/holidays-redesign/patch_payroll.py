import re, sys
src, out = sys.argv[1], sys.argv[2]
s = open(src).read()
comp = open('tools/holidays-redesign/new_components.js').read()
pages = open('tools/holidays-redesign/new_pages.js').read()

def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n != count:
        raise SystemExit(f'anchor count {n}!={count}: {old[:80]!r}')
    s = s.replace(old, new)

def cut_fn(name, nxt):
    """remove from 'function name(' up to the start of nxt"""
    global s
    a = s.index(f'function {name}(')
    b = s.index(nxt, a)
    s = s[:a] + s[b:]

# replace Zn, Hx, Jn with new versions; insert components before Zn
cut_fn('Zn', 'function Hx(')
cut_fn('Hx', 'function Jn(')
cut_fn('Jn', 'var Xn = `')
rep('var Xn = `', comp + pages + 'var Xn = `')

# person slot for the Team page
rep(': o === "holidays" && me(n(Hx, {}), t);',
    ': o === "holidays"\n          ? me(n(Hx, {}), t)\n          : o === "person" &&\n            me(n(TwPerson, { staffId: t.getAttribute("data-staff") }), t);')

# CSS: drop left accent bars, add ring / pay card / person panel styles
rep('.tws-person.ok{border-left:4px solid #3a7d44}\n', '')
rep('.tws-probs li.warn{background:#fff4e0;border-left:4px solid #c77700}', '.tws-probs li.warn{background:#fff4e0}')
rep('.tws-probs li.info{border-left:4px solid #8a8a8a}\n', '')
css = r'''
.tws-rings{display:flex;flex-wrap:wrap;gap:1.25rem 2rem;justify-content:center;padding:.5rem 0 .25rem}
.tws-ring{margin:0;display:grid;justify-items:center;gap:.5rem;position:relative;width:9.5rem}
.tws-ring svg{width:9.5rem;height:9.5rem;display:block}
.tws-ring circle{fill:none;stroke-width:11}
.tws-ring-track{stroke:var(--sand,#efeee9)}
.tws-ring-fill{stroke:var(--green-3,#3d6a55);stroke-linecap:round;transition:stroke-dasharray .5s ease}
.tws-ring.used .tws-ring-fill{stroke:var(--gold,#b8893b)}
.tws-ring.over .tws-ring-fill{stroke:var(--red,#a3241c)}
.tws-ring-mid{position:absolute;top:0;left:0;width:9.5rem;height:9.5rem;display:grid;place-content:center;text-align:center;line-height:1.1}
.tws-ring-mid b{font-size:1.6rem;font-weight:700;color:var(--ink,#1c1f1b)}
.tws-ring-mid span{font-size:.8rem;color:var(--muted,#5d6058);text-transform:uppercase;letter-spacing:.06em}
.tws-ring figcaption{font-size:.85rem;color:var(--muted,#5d6058);text-align:center}
.tws-holcard h2{margin-bottom:.25rem}
.tws-paycard .tws-payhero{display:grid;gap:1rem;grid-template-columns:minmax(0,auto) minmax(0,1fr);align-items:center;margin:.5rem 0 .25rem}
.tws-payamt{display:grid;gap:.1rem;padding:.9rem 1.1rem;border-radius:12px;background:var(--green-tint,#ebf2ed)}
.tws-payamt b{font-size:2rem;line-height:1.1;font-weight:700;color:var(--green,#1f3a2e)}
.tws-label{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted,#5d6058)}
.tws-paywhen{display:grid;gap:.4rem}
.tws-paydate{font-weight:600;display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin:0}
.tws-pill{font-size:.75rem;font-weight:600;padding:.15rem .55rem;border-radius:999px;background:var(--gold-tint,#f7efdc);color:var(--brass,#7d5a1c)}
.tws-bar{height:8px;border-radius:999px;background:var(--sand,#efeee9);overflow:hidden}
.tws-bar span{display:block;height:100%;background:var(--green-3,#3d6a55);border-radius:999px}
.tws-sub{font-size:.85rem;color:var(--muted,#5d6058);margin:0}
.tws-stats{list-style:none;padding:0;margin:.75rem 0 0;display:grid;gap:.5rem;grid-template-columns:repeat(auto-fit,minmax(8rem,1fr))}
.tws-stats li{display:grid;gap:.1rem;padding:.6rem .75rem;border:1px solid var(--line,#e6e5df);border-radius:10px}
.tws-stats b{font-size:1.15rem}.tws-stats span,.tws-stats a{font-size:.8rem;color:var(--muted,#5d6058)}
.tws-personpanel{display:grid;gap:.75rem;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));margin-top:.75rem;padding-top:.75rem;border-top:1px solid var(--line,#e6e5df)}
.tws-tile{display:grid;align-content:start;justify-items:center;text-align:center;gap:.25rem;padding:.75rem;border-radius:10px;background:var(--cream,#f7f5ef)}
.tws-tile h4{margin:0 0 .25rem;font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted,#5d6058)}
.tws-tile p{margin:0}
.tws-tile .tws-ring,.tws-tile .tws-ring svg,.tws-tile .tws-ring-mid{width:7.5rem}
.tws-tile .tws-ring svg,.tws-tile .tws-ring-mid{height:7.5rem}
.tws-tile .tws-ring-mid b{font-size:1.3rem}
.tws-big{font-size:1.4rem;font-weight:700}
.tws-amt{font-size:1.2rem;font-weight:700;color:var(--green,#1f3a2e)}.tws-amt span{font-size:.8rem;font-weight:400;color:var(--muted,#5d6058)}
.tws-person-load{margin-top:.5rem}
.tws-teamli{flex-wrap:wrap}
.tws-teamslot{flex:1 0 100%;min-width:0}
.tws-namebtn{background:none;border:0;padding:0;margin:0;font:inherit;color:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:.35rem;min-height:32px;text-align:left}
.tws-namebtn:hover strong{text-decoration:underline}
.tws-namebtn:focus-visible{outline:2px solid currentColor;outline-offset:2px;border-radius:4px}
.tws-chev{font-size:.8rem;color:var(--muted,#5d6058)}
.tws-holask{margin-top:4px}
@media (max-width:600px){.tws-paycard .tws-payhero{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){.tws-ring-fill{transition:none}}
'''
rep('@media (max-width:600px){.tws-people', css.lstrip('\n') + '@media (max-width:600px){.tws-people')
# --- strip unnecessary hint text ---
def drop_p(start_marker):
    """remove the n("p", {...}) node (and its trailing comma) that contains start_marker"""
    global s
    i = s.index(start_marker)
    a = s.rindex('n("p", {', 0, i)
    depth = 0; j = a
    while True:
        ch = s[j]
        if ch == '(': depth += 1
        elif ch == ')':
            depth -= 1
            if depth == 0: break
        j += 1
    j += 1
    if s[j] == ',': j += 1
    s = s[:a] + 'null' + (',' if s[j-1] == ',' else '') + s[j:]

for m in ['Upload the one PDF your payroll software',
          ' pay. Payroll users get a reminder ',
          'Compare each person\\u2019s rostered hours',
          'You can see these hours; ',
          'Lock unlocks once everyone is approved.',
          'Columns and their names can be changed',
          '". Irregular hours build up "',
          'Tick the columns your payroll software wants',
          'Pay rate and payroll ID go into the export.',
          'Pay periods, signed-off hours, exports']:
    drop_p(m)
rep('" found. Anything not matched needs a person picked, or leave it on \\u201CDon\\u2019t post\\u201D."', '" found."')
rep('        detail: "Payroll only gets final numbers once the period is locked.",\n', '')
open(out, 'w').write(s)
print('ok')
