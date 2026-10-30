#!/usr/bin/env python3
"""Printable weekly rota (Andy, 30 Oct 2026).

Builds index-tws2610rz.js from the live bundle index-tws2610hs.js by adding a "Print" button to the
management Rota toolbar (owners and managers: the Rota page component only renders for isManager).
The button hands the week the page already has loaded to window.__twsRotaPrint, which lives in
assets/rotaprint-tws2610pa.js (source: tools/rota-print/rotaprint.js + rotaprint.css).
The button sits outside the publish/approve actions, so it also shows on approved weeks.
Also copies the module + CSS into public/assets and points public/index.html at the new files.

Run from the repo root: python3 tools/rota-print/patch_rotaprint.py
"""
import pathlib, re, shutil, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
A = ROOT / 'public' / 'assets'
SRC = A / 'index-tws2610hs.js'
DST = A / 'index-tws2610rz.js'
HERE = pathlib.Path(__file__).resolve().parent

s = SRC.read_text()

ANCHOR = 'f.jsx("div",{className:"spacer"}),!D&&f.jsxs("div",{className:"actions",children:[f.jsx("button",{className:"btn sm","data-testid":"publish-rota"'
assert s.count(ANCHOR) == 1, 'rota toolbar anchor not found exactly once'
BTN = ('f.jsx("div",{className:"spacer"}),'
       'f.jsx("button",{type:"button",className:"btn secondary sm","data-testid":"print-rota",disabled:ms,'
       'title:"Print this week\'s rota (A4 landscape) or save it as a PDF",'
       'onClick:()=>window.__twsRotaPrint?window.__twsRotaPrint({weekStart:i,days:l,people:gs,shifts:Br,blocks:fs,'
       'events:l.map(V=>Lk(qs,V)),status:P?"approved":b&&b.status||""}):alert("Print didn\u2019t load. Refresh the page and try again."),children:"Print"}),'
       '!D&&f.jsxs("div",{className:"actions",children:[f.jsx("button",{className:"btn sm","data-testid":"publish-rota"')
s = s.replace(ANCHOR, BTN)

# The names the button uses must exist in the Rota component (qO). Cheap sanity checks.
seg = s[s.find('function qO('):s.find('"data-testid":"print-rota"')]
for name in ['gs=[', 'Br=', 'fs=', 'qs', 'ms', 'P=', 'b=', 'l=']:
    assert name in seg, 'missing in Rota component: ' + name
assert 'function Lk(' in s or 'Lk=' in s

DST.write_text(s)
shutil.copy(HERE / 'rotaprint.js', A / 'rotaprint-tws2610pa.js')
shutil.copy(HERE / 'rotaprint.css', A / 'rotaprint-tws2610pa.css')
# jsPDF (MIT) for Save PDF, loaded by rotaprint only when the preview opens. From npm jspdf@4.2.1 dist/jspdf.umd.min.js.
assert (A / 'jspdf-4.2.1.umd.min.js').exists(), 'copy jspdf.umd.min.js (4.2.1) to public/assets/jspdf-4.2.1.umd.min.js first'

idx = ROOT / 'public' / 'index.html'
h = idx.read_text()
# New file names each time, so no phone keeps an old copy (assets are cached for a year; index.html never).
h = re.sub(r'/assets/index-tws2610(hs|rx)\.js', '/assets/index-tws2610rz.js', h)
h = re.sub(r'/assets/rotaprint-tws2610(rx|rz)\.(css|js)', r'/assets/rotaprint-tws2610pa.\2', h)
assert h.count('/assets/index-tws2610rz.js') == 1
if 'rotaprint-tws2610pa' not in h:
    h = h.replace('</head>', '  <link rel="stylesheet" href="/assets/rotaprint-tws2610pa.css">\n'
                  '  <script defer src="/assets/rotaprint-tws2610pa.js"></script>\n</head>', 1)
idx.write_text(h)
print('wrote', DST.name, len(s), 'bytes; index.html updated')
