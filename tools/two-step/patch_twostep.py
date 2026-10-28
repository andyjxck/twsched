#!/usr/bin/env python3
"""Two-step verification for owners and managers (Andy, 27 Oct). Idempotent anchor patch on the minified
main bundle. Usage: patch_twostep.py <in.js> <out.js>
- public/assets/twostep/*.js uses the app's own Auth instance (window.__tws.auth, already in the bundle).
- Login form: when Firebase says the login needs its second step (auth/multi-factor-auth-required), the
  two-step module asks for the 6-digit code and finishes the sign-in. Any other error is shown as before.
- Account page: a Two-step verification card for owners and managers (isManager), opening the set-up.
The server-side requirement lives in firestore.rules, storage.rules and functions/twoStep.js.
"""
import sys
MARK = '/*tws-two-step*/'

src, out = sys.argv[1], sys.argv[2]
s = open(src, encoding='utf-8').read()
if MARK in s:
    open(out, 'w', encoding='utf-8').write(s)
    print('already patched')
    sys.exit(0)

def rep(old, new):
    global s
    n = s.count(old)
    if n != 1:
        raise SystemExit(f'anchor found {n} times: {old[:80]!r}')
    s = s.replace(old, new)

# 2. Login: second step.
rep('try{Pg(t),await OI(Mr,n.trim(),t)}catch(F){Pg(""),d(nt(F))}',
    'try{Pg(t),await OI(Mr,n.trim(),t)}catch(F){'+MARK+'if(F&&F.code==="auth/multi-factor-auth-required"&&window.__twsTwoStep)'
    '{try{await window.__twsTwoStep.resolveSignIn(F);return}catch(F2){Pg(""),d(nt(F2));return}}Pg(""),d(nt(F))}')

# 3. Account page card (owners and managers only).
CARD = ('function __TwsTwoStepCard(){const n=ht();if(!n.isManager)return null;'
        'return f.jsxs("div",{className:"card stack","aria-labelledby":"tws2s-h",children:['
        'f.jsx("h2",{id:"tws2s-h",className:"card-title",children:"Two-step verification"}),'
        'f.jsx("p",{className:"small muted",children:"A code from an authenticator app on your phone, on top of your password. Managers and owners need it."}),'
        'f.jsx("button",{type:"button",className:"btn secondary",onClick:()=>window.__twsTwoStep&&window.__twsTwoStep.openSetup(),children:"Two-step verification"})]})}')
rep('function C2(){const n=ht(),', CARD + 'function C2(){const n=ht(),')
rep('children:i==="settings"?f.jsx(P2,{}):f.jsx(C2,{})})',
    'children:i==="settings"?f.jsx(P2,{}):f.jsxs(f.Fragment,{children:[f.jsx(C2,{}),f.jsx(__TwsTwoStepCard,{})]})})')

open(out, 'w', encoding='utf-8').write(s)
print('patched')
