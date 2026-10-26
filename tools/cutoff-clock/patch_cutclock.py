#!/usr/bin/env python3
"""Payroll > Pay calendar: replace the 'today' / 'in N days' pill under Hours cut-off
with a small clock icon beside the cut-off date (green / orange / red).

Anchor-based and idempotent: re-run on top of any newer payroll-tws*.js.
  usage: patch_cutclock.py <in.js> <out.js>

Colours:
  red    = cut-off is today (or has passed)
  orange = inside the payroll reminder window (settings 'Remind payroll this many
           days before cut-off', default 2 = the old pill's warning threshold), min 1 day
  green  = further away
Status text is in title + aria-label (colour is not the only cue).
"""
import re, sys

src = open(sys.argv[1], encoding='utf-8').read()
if 'tws-cutclock' in src:
    open(sys.argv[2], 'w', encoding='utf-8').write(src)
    print('already patched')
    sys.exit(0)

# 1) the date + pill inside the Hours cut-off item
pill = re.compile(
    r'(?P<h>[A-Za-z_$][\w$]*)\(\s*"b"\s*,\s*\{\s*children\s*:\s*(?P<F>[A-Za-z_$][\w$]*)\(\s*(?P<n>[A-Za-z_$][\w$]*)\.cutoff\s*\)\s*\}\s*\)\s*,\s*'
    r'" "\s*,\s*'
    r'(?P=h)\(\s*"span"\s*,\s*\{\s*class\s*:\s*`pill \$\{\s*(?P<l>[A-Za-z_$][\w$]*)\s*<=\s*2\s*\?\s*"warn"\s*:\s*""\s*\}`\s*,\s*'
    r'children\s*:\s*(?P=l)\s*<=\s*0\s*\?\s*"today"\s*:\s*`in \$\{\s*(?P=l)\s*\} day\$\{\s*(?P=l)\s*===\s*1\s*\?\s*""\s*:\s*"s"\s*\}`\s*\}\s*\)'
)
ms = list(pill.finditer(src))
if len(ms) != 1:
    sys.exit(f'pill anchor matched {len(ms)} times, expected 1')
m = ms[0]
h, F, n, l = m['h'], m['F'], m['n'], m['l']
repl = (f'{h}("span",{{class:"tws-cutdate",children:[{h}("b",{{children:{F}({n}&&{n}.cutoff)}}),'
        f'__twsCutClock({h},{n},{l})]}})')
src = src[:m.start()] + repl + src[m.end():]

# 2) helper, defined at module scope just before the component that uses it
# find the enclosing 'function X({settings:e}){' that contains the anchor
head = src[:m.start()]
fm = None
for fm in re.finditer(r'function\s+[A-Za-z_$][\w$]*\s*\(\s*\{\s*settings\s*:\s*[A-Za-z_$][\w$]*\s*\}\s*\)\s*\{', head):
    pass
if fm is None:
    sys.exit('component anchor not found')
# daysBetween helper object used in the component (C.daysBetween)
db = re.search(r'([A-Za-z_$][\w$]*)\.daysBetween\(', src[fm.start():m.start()+len(repl)])
if not db:
    sys.exit('daysBetween anchor not found')
C = db.group(1)
helper = (
    'function __twsCutClock(h,p,d){'
    'if(!p||!p.cutoff||typeof d!=="number"||d!==d)return null;'
    f'var w=p.reminder?{C}.daysBetween(p.reminder,p.cutoff):2;if(typeof w!=="number"||w!==w)w=2;w=Math.max(1,w);'
    'var s=d<=0?"red":d<=w?"orange":"green";'
    'var t=d<0?"Hours cut-off has passed":d===0?"Hours cut-off is today":"Hours cut-off in "+d+" day"+(d===1?"":"s");'
    'return h("span",{class:"tws-cutclock is-"+s,role:"img","aria-label":t,title:t,"data-status":s,'
    'children:h("svg",{viewBox:"0 0 24 24",width:"18",height:"18","aria-hidden":"true",focusable:"false",children:['
    'h("circle",{cx:"12",cy:"12",r:"9",fill:"currentColor","fill-opacity":"0.14",stroke:"currentColor","stroke-width":"2.2"}),'
    'h("path",{d:"M12 7.2V12l3.3 2.1",fill:"none",stroke:"currentColor","stroke-width":"2.2","stroke-linecap":"round","stroke-linejoin":"round"})'
    ']})})}'
)
src = src[:fm.start()] + helper + src[fm.start():]

# 3) CSS, appended after the existing .tws-cal .kv>div rule in the module's stylesheet
css_anchor = re.compile(r'\.tws-cal \.kv>div\s*\{\s*display\s*:\s*grid\s*;?\s*\}')
cm = css_anchor.search(src)
if not cm:
    sys.exit('css anchor not found')
css = ('\n.tws-cal .tws-cutdate{display:inline-flex;align-items:center;gap:.4rem;flex-wrap:nowrap;min-width:0}'
       '\n.tws-cal .tws-cutdate>b{white-space:nowrap}'
       '\n.tws-cutclock{display:inline-flex;flex:none;line-height:0;cursor:help}'
       '\n.tws-cutclock svg{display:block;width:18px;height:18px}'
       '\n.tws-cutclock.is-green{color:#2e7d32}'
       '\n.tws-cutclock.is-orange{color:#d97706}'
       '\n.tws-cutclock.is-red{color:#c62828}')
src = src[:cm.end()] + css + src[cm.end():]

open(sys.argv[2], 'w', encoding='utf-8').write(src)
print('patched', dict(h=h, F=F, n=n, l=l, C=C))
