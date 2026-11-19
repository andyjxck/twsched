#!/usr/bin/env python3
"""Show a temporary password on screen (Andy, 19 Nov).

Patches the built staff app bundle: adds a "Show on screen" button next to Resend login / New
password on a staff member's page in Team (owners only, same as the server), a modal that shows
the new temporary password once with a Copy button, a "shown on screen" status pill, and a
clearer label on the first sign-in screen. Renames the bundle so browsers fetch the new one.
Run from the repo root. Fails loudly if any anchor is missing or matches more than once.
"""
import pathlib, sys

OLD = 'index-tws0513hd.js'
NEW = 'index-tws1911sp.js'
root = pathlib.Path('public')
src = root / 'assets' / OLD
dst = root / 'assets' / NEW
s = src.read_text(encoding='utf-8')

def rep(old, new):
    global s
    n = s.count(old)
    if n != 1:
        sys.exit(f'anchor found {n} times: {old[:80]!r}')
    s = s.replace(old, new)

# 1. Status pill on the Team list.
rep('k2={sent:"Not signed in yet","not-sent":"Login email not sent",expired:"Temporary password ran out"}',
    'k2={sent:"Not signed in yet","not-sent":"Login email not sent",shown:"Password shown on screen, not signed in yet",expired:"Temporary password ran out"}')

# 2. The action on the staff member's page.
rep('const ie=await mn("resendStaffLogin",{uid:n.id});t({...ie,name:n.name,email:n.email,isNew:!1})}),Y=()=>',
    'const ie=await mn("resendStaffLogin",{uid:n.id});t({...ie,name:n.name,email:n.email,isNew:!1})}),'
    'twSh=()=>M(async()=>{if(!window.confirm(`Show a new temporary password for ${n.name} on this screen?\n\n'
    'No email is sent. Their current password stops working straight away, and they\u2019ll have to choose a new one when they sign in. '
    'Only do this where you can hand it to them yourself.`))return;const ie=await mn("showStaffLogin",{uid:n.id});'
    't({...ie,name:n.name,email:n.email,isNew:!1,shown:!0})}),Y=()=>')

# 3. The button, next to Resend login / New password.
rep('f.jsx("button",{className:"btn secondary sm",disabled:d||n.active===!1,onClick:F,children:n.pendingFirstLogin?"Resend login":"New password"}),',
    'f.jsx("button",{className:"btn secondary sm",disabled:d||n.active===!1,onClick:F,children:n.pendingFirstLogin?"Resend login":"New password"}),'
    'r.isOwner&&f.jsx("button",{className:"btn secondary sm","data-testid":"show-login",title:"Make a new temporary password and show it here instead of emailing it",disabled:d||n.active===!1,onClick:twSh,children:"Show on screen"}),')

# 4. The modal: a "shown on screen" version, with a Copy button that says when it worked.
rep('function N2({c:n,onClose:e}){const t=',
    'function N2({c:n,onClose:e}){const[twCp,twSetCp]=G.useState(""),twCopy=()=>{const v=n.tempPassword||"";'
    'const ok=()=>twSetCp("Copied."),bad=()=>twSetCp("Couldn\u2019t copy. Select the password and copy it yourself.");'
    'try{navigator.clipboard&&navigator.clipboard.writeText?navigator.clipboard.writeText(v).then(ok,bad):bad()}catch(x){bad()}},t=')
rep('return f.jsx(Of,{title:n.isNew?"Login created":"New temporary password",onClose:e,children:f.jsx("div",{className:"stack",children:n.emailSent?',
    'return f.jsx(Of,{title:n.isNew?"Login created":"New temporary password",onClose:e,children:f.jsx("div",{className:"stack",children:n.shown?'
    'f.jsxs(f.Fragment,{children:[f.jsxs("div",{className:"okbox",role:"status","data-testid":"shown-ok",children:[`${n.name}\u2019s old password has stopped working. `,"No email was sent."]}),'
    'f.jsxs("p",{className:"small",children:["Give them this temporary password yourself, in person. ",r," signs in at tws-rota.co.uk with it, and has to choose their own password before they can see anything."]}),'
    'f.jsxs("div",{className:"kv",children:[f.jsx("dt",{children:"App"}),f.jsx("dd",{children:"tws-rota.co.uk"}),f.jsx("dt",{children:"Email"}),f.jsx("dd",{children:n.email})]}),'
    'f.jsx("div",{className:"temp-pass","data-testid":"shown-password",style:{userSelect:"all"},children:n.tempPassword}),'
    'f.jsxs("p",{className:"small muted",children:["It\u2019s only shown this once and isn\u2019t saved anywhere. Close this when you\u2019ve handed it over.",t?` It works until ${t}.`:""]}),'
    'f.jsx("button",{className:"btn","data-testid":"shown-copy",onClick:twCopy,children:"Copy password"}),'
    'twCp&&f.jsx("p",{className:"small muted",role:"status",children:twCp})]}):n.emailSent?')

# 5. First sign-in screen: the temporary password may have come from a manager, not an email.
rep('f.jsx(Ve,{label:"Temporary password (from your email)",',
    'f.jsx(Ve,{label:"Temporary password (from your email or your manager)",')
rep('"Enter the temporary password from your email."', '"Enter your temporary password."')

# 6. Login email editable by owners on someone else's page (Andy, 19 Nov: "change it site wide").
rep('[k,C]=G.useState([]),O=ie=>', '[k,C]=G.useState([]),[twEC,twSEC]=G.useState(""),twDv=n.developer===!0||n.role==="developer",O=ie=>')
rep('f.jsx(Ve,{label:"Email (their login)",children:f.jsx("input",{type:"email",value:a.email,onChange:O("email"),disabled:!w,maxLength:150})}),',
    'f.jsx(Ve,{label:"Email (their login)",children:f.jsx("input",{type:"email","data-testid":"staff-email",value:a.email,onChange:O("email"),disabled:!w&&(!r.isOwner||T||twDv),maxLength:150,autoCapitalize:"none",inputMode:"email"})}),'
    '!w&&r.isOwner&&!T&&!twDv&&f.jsx("p",{className:"small muted",style:{marginTop:-6},children:"Changing this changes the email they sign in with and where every Hub email goes. They\u2019ll be signed out and sign in again with the new address."}),')
rep('r.isOwner&&!T&&a.role!==n.role&&(ie.role=a.role);await mn("updateStaff",ie);twP&&await __twsSaveContract(n.id,twP.value,twCD,r.user.uid);i("Saved."),e()',
    'r.isOwner&&!T&&a.role!==n.role&&(ie.role=a.role);r.isOwner&&!T&&!twDv&&(a.email||n.email)&&(ie.email=String(a.email||"").trim().toLowerCase());const twR=await mn("updateStaff",ie);twP&&await __twsSaveContract(n.id,twP.value,twCD,r.user.uid);'
    'if(twR&&twR.emailChanged){twSEC(twR.email);l(x=>({...x,email:twR.email}));i("Saved. Login email changed.");return}i("Saved."),e()')
rep('f.jsx("button",{className:"btn",disabled:d,onClick:te,children:w?"Create login":"Save"}),',
    'twEC&&f.jsxs("div",{className:"okbox",role:"status","data-testid":"email-changed",children:["Their login email is now ",f.jsx("strong",{children:twEC}),". They\u2019ve been signed out and sign in with the new address. ",'
    'n.pendingFirstLogin?"They haven\u2019t signed in yet: use Resend login or Show on screen below to give them a login at the new address.":"Their password hasn\u2019t changed. Use New password or Show on screen below if they need a new one."]}),'
    'f.jsx("button",{className:"btn",disabled:d,onClick:te,children:w?"Create login":"Save"}),')
# the login modals show the address it went to
rep('const ie=await mn("resendStaffLogin",{uid:n.id});t({...ie,name:n.name,email:n.email,isNew:!1})',
    'const ie=await mn("resendStaffLogin",{uid:n.id});t({...ie,name:n.name,email:twEC||n.email,isNew:!1})')
rep('t({...ie,name:n.name,email:n.email,isNew:!1,shown:!0})', 't({...ie,name:n.name,email:ie.email||twEC||n.email,isNew:!1,shown:!0})')

dst.write_text(s, encoding='utf-8')
src.unlink()
idx = root / 'index.html'
h = idx.read_text(encoding='utf-8')
if h.count(OLD) != 1:
    sys.exit('index.html reference not found exactly once')
idx.write_text(h.replace(OLD, NEW), encoding='utf-8')
print('patched', dst)
