#!/usr/bin/env python3
"""Adds a Paid break toggle to the rota shift editor. Usage: patch_main.py in.js out.js
The shift editor already keeps breakPaid in its state and saves it (Mk); it just had no control.
Unticked = unpaid, so the break comes off paid hours (payroll ge(): breakPaid === false)."""
import sys
s = open(sys.argv[1], encoding='utf-8').read()
assert 'data-testid":"break-paid"' not in s, 'already patched'
old = '__twsPopBreak(w),f.jsx(Ve,{label:"Area"'
assert s.count(old) == 1, s.count(old)
new = ('__twsPopBreak(w),f.jsxs("label",{className:"check","data-testid":"break-paid-row",children:['
       'f.jsx("input",{type:"checkbox",checked:w.breakPaid!==!1,disabled:x,'
       'onChange:me=>T({...w,breakPaid:me.target.checked}),"data-testid":"break-paid"}),'
       '"Paid break"]}),'
       'f.jsx(Ve,{label:"Area"')
s = s.replace(old, new)
open(sys.argv[2], 'w', encoding='utf-8').write(s)
print('ok')
