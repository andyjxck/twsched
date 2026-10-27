#!/usr/bin/env python3
"""Handover recovery fixes for the main Staff Hub bundle.

index-tws2610hf.js = index-tws2610pb.js + this patch.
Every replacement is anchored and asserts its anchor appears exactly once, so a changed
bundle fails loudly instead of being patched in the wrong place.

Fixes in this file (numbers from the recovery handover):
  1  Right to Work: missing docs = small "!" by the name on the rota (hover / tap / keyboard).
  2  Payslips: monthly payslips as tiles, two per row; "who can open these" note hidden.
  3  Holidays: "Ask for holiday" / "Mark someone unavailable" as small top-right buttons.
  4  Events: on desktop Coming up / Every week / Past all show at once as rows; phone keeps tabs.
 10  Account > Your details: change your own name and login email (email needs current password).
 11  Account: Email settings tab removed (server callables removed too, see functions/).
 12  Developer maintenance login: blank Maintenance screen, nothing else mounts; Team can't edit it.
  +  Rota: a person can't be given two shifts that overlap (editor save and drag-copy).
"""
import sys

SRC, DST = sys.argv[1], sys.argv[2]
s = open(SRC, encoding='utf-8').read()


def func_end(src, start):
    """index just past the closing brace of the function that starts at `start` (string/template aware)."""
    i = src.index('{', start)
    depth = 0
    q = None
    tmpl = []  # brace depth stack inside template literals
    while i < len(src):
        c = src[i]
        if q:
            if c == '\\':
                i += 2
                continue
            if q == '`' and c == '$' and src[i + 1] == '{':
                tmpl.append(depth)
                depth += 1
                q = None
                i += 2
                continue
            if c == q:
                q = None
        else:
            if c in '"\'`':
                q = c
            elif c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
                if tmpl and depth == tmpl[-1]:
                    tmpl.pop()
                    q = '`'
                elif depth == 0:
                    return i + 1
        i += 1
    raise SystemExit('unbalanced function at %d' % start)


def rep(old, new):
    global s
    n = s.count(old)
    if n != 1:
        sys.exit(f'anchor found {n} times (want 1): {old[:90]!r}')
    s = s.replace(old, new)


MARK = '/*tws-handover-fixes-v1*/'
if MARK in s:
    sys.exit('already patched')

# ------------------------------------------------------------------ helpers (top level)
# Fix 1 uses the same accessible "!" control as the hours warning (__TwsBang): button with an
# aria-label that carries the full text, tooltip on hover/focus/tap, Escape closes, aria-describedby.
b0 = s.index('function __TwsBang(p){')
b1 = func_end(s, b0)
bang = s[b0:b1]
note = bang.replace('function __TwsBang(p){', 'function __TwsNote(p){', 1)
for old, new in [
    ('var lines=__twsBangLines(p.w,p.days,p.cells,p.id)', 'var lines=p.lines||[]'),
    ('var label="Hours to check for "+(p.name||"this person")+": "+lines.join(". "),tipId="tws-bang-"+p.id;',
     'var label=(p.label||"Check")+(p.name?" for "+p.name:"")+": "+lines.join(". "),tipId="tws-note-"+p.id;'),
    ('className:"tws-bang","aria-label":label', 'className:"tws-bang tws-note","aria-label":label'),
]:
    if note.count(old) != 1:
        sys.exit('TwsBang shape changed: ' + old)
    note = note.replace(old, new)
# label, ids and test ids: make them distinct from the hours warning
note = note.replace('"tws-bang-tip-"', '"tws-note-tip-"').replace('"tws-bang-tip-"+', '"tws-note-tip-"+')
import re
note = re.sub(r'"data-testid":"([a-z-]*)bang"', '"data-testid":"rtw-bang"', note)
note = re.sub(r'"data-testid":"([a-z-]*)tip"', '"data-testid":"rtw-tip"', note)

helpers = MARK + note + r'''
function __twsOverlap(list,staffId,date,start,end,excludeId){
  if(!staffId||!date||!start||!end||!Array.isArray(list))return null;
  function mins(t){var m=/^(\d{1,2}):(\d{2})$/.exec(String(t||""));return m?Number(m[1])*60+Number(m[2]):null}
  function day(d){var t=Date.parse(String(d)+"T12:00:00Z");return isNaN(t)?null:Math.round(t/864e5)}
  function span(d,a,b){var D=day(d),A=mins(a),B=mins(b);if(D==null||A==null||B==null)return null;var s0=D*1440+A,e0=D*1440+B;if(e0<=s0)e0+=1440;return[s0,e0]}
  var me=span(date,start,end);if(!me)return null;
  for(var i=0;i<list.length;i++){var o=list[i];if(!o||o.staffId!==staffId||(excludeId&&o.id===excludeId))continue;
    var ot=span(o.date,o.start,o.end);if(!ot)continue;
    if(me[0]<ot[1]&&ot[0]<me[1]){var lbl;try{lbl=new Date(String(o.date)+"T12:00:00").toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"})}catch(x){lbl=o.date}return lbl+" "+o.start+"\u2013"+o.end}}
  return null;
}
function TwsMyDetails(){const n=ht(),e=en(),[t,r]=G.useState(()=>({name:n.profile&&n.profile.name||"",email:n.user&&n.user.email||"",current:""})),[i,a]=G.useState(!1),[l,d]=G.useState(""),[ok,setOk]=G.useState("");
  const was=String(n.user&&n.user.email||"").toLowerCase(),chEmail=t.email.trim().toLowerCase()!==was;
  G.useEffect(function(){if(n.profile&&n.profile.name&&!t.name)r(function(o){return{...o,name:n.profile.name}})},[n.profile&&n.profile.name]);
  async function p(g){g.preventDefault();d("");setOk("");const nm=t.name.trim();if(nm.length<2){d("Enter your name.");return}
    if(chEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t.email.trim())){d("Check the new email address.");return}
    if(chEmail&&!t.current){d("Enter your current password to change your email.");return}
    a(!0);try{const q={name:nm};if(chEmail){q.email=t.email.trim();q.currentPassword=t.current}
      const res=await mn("updateMyDetails",q);
      if(res&&res.emailChanged){try{await n.user.reload();await n.user.getIdToken(!0)}catch(x){}}
      r(function(o){return{...o,current:"",email:chEmail?o.email.trim().toLowerCase():o.email}});
      const msg=!res||!res.changed?"Nothing to change.":res.emailChanged?"Saved. Sign in with your new email from now on. We\u2019ve told your old address.":"Saved.";setOk(msg);e(msg)}
    catch(x){d(nt(x))}finally{a(!1)}}
  return f.jsxs("form",{className:"card stack tws-details",onSubmit:p,"aria-labelledby":"det-h","data-testid":"my-details",noValidate:!0,children:[
    f.jsx("h2",{id:"det-h",className:"card-title",children:"Your details"}),
    f.jsx("p",{className:"small muted",style:{margin:0},children:"Your name shows on the rota. Your email is the one you sign in with."}),
    f.jsx(Ve,{label:"Name",children:f.jsx("input",{value:t.name,onChange:g=>r({...t,name:g.target.value}),maxLength:80,autoComplete:"name","data-testid":"det-name"})}),
    f.jsx(Ve,{label:"Email",children:f.jsx("input",{type:"email",inputMode:"email",value:t.email,onChange:g=>r({...t,email:g.target.value}),maxLength:120,autoComplete:"email",autoCapitalize:"none",spellCheck:!1,"data-testid":"det-email"})}),
    chEmail&&f.jsx(Ve,{label:"Current password",hint:"Needed to change your email. We\u2019ll send a note to your old address.",children:f.jsx("input",{type:"password",value:t.current,onChange:g=>r({...t,current:g.target.value}),autoComplete:"current-password","data-testid":"det-current"})}),
    l&&f.jsx("div",{className:"err",role:"alert",children:l}),
    ok&&f.jsx("div",{className:"tiny muted",role:"status",children:ok}),
    f.jsx("div",{className:"actions",children:f.jsx("button",{className:"btn",disabled:i,"data-testid":"det-save",children:i?"Saving\u2026":"Save"})})]})}
function TwsMaintenance({user:n}){return f.jsx("div",{className:"login tws-maint","data-testid":"maintenance",children:f.jsxs("div",{className:"card stack",children:[f.jsx("h1",{className:"card-title",children:"Maintenance login"}),f.jsx("p",{className:"small muted",children:"This login can\u2019t see any staff information."}),f.jsx("button",{className:"btn secondary block",onClick:()=>Oo(Mr),children:"Sign out"})]})})}
'''
rep('function __TwsBang(p){', helpers + 'function __TwsBang(p){')

# ------------------------------------------------------------------ 1. Right to Work "!" by the name
rep('!V.open&&!V.gone&&!N(V.id)&&f.jsx("div",{className:"rtw-missing",title:"Right to Work documents not uploaded yet. They can still be put on the rota; management can add them in Team",children:"No Right to Work docs"}),', '')
rep('!V.open&&!V.gone&&f.jsx(__TwsBang,{w:__twsWeek(V.id,l,$r,fs,twC),days:l,cells:$r,id:V.id,name:V.name}),',
    '!V.open&&!V.gone&&f.jsx(__TwsBang,{w:__twsWeek(V.id,l,$r,fs,twC),days:l,cells:$r,id:V.id,name:V.name}),'
    '!V.open&&!V.gone&&!N(V.id)&&f.jsx(__TwsNote,{id:"rtw-"+V.id,name:V.name,label:"Right to Work",lines:["No Right to Work documents uploaded yet","They can still be put on the rota","Management can add them in Team, Edit on their name"]}),')

# ------------------------------------------------------------------ 2. payslip tiles, no "who can open" note
rep('t&&f.jsx("div",{className:"warn",style:{marginTop:8},children:t})', '!1&&t')
rep('p.docs?f.jsx("ul",{className:"list",children:ie.map(', 'p.docs?f.jsx("ul",{className:"list tws-slip-tiles","data-testid":"slip-tiles",children:ie.map(')

# ------------------------------------------------------------------ 3. Holidays: small top-right buttons
rep('F&&f.jsx("div",{className:"pagehead",children:f.jsx("h1",{children:F[0]})})',
    'F&&f.jsxs("div",{className:"pagehead",children:[f.jsx("h1",{children:F[0]}),f.jsx("div",{className:"tws-ph-actions",id:"tws-ph-actions"})]})')
h0 = s.index('function TwHolAsk(){')
h1 = func_end(s, h0)
hol = s[h0:h1]
old_head = 'function TwHolAsk(){const n=ht(),[e,t]=G.useState(""),r=i=>t(e===i?"":i);'
if not hol.startswith(old_head):
    sys.exit('TwHolAsk head changed')
a0 = hol.index('f.jsxs("div",{className:"inbox-actions"')
# end of the buttons group = the first form toggle that follows it
a1 = hol.index(',e==="holiday"&&', a0)
btn_group = hol[a0:a1]
new_group = (btn_group
             .replace('className:"inbox-actions"', 'className:"tws-holbtns"', 1)
             .replace('className:"actcard"', 'className:"btn secondary sm"'))
new_group = re.sub(r'f\.jsx\("span",\{className:"ic",children:f\.jsx\(ef,\{name:"([a-z]+)"\}\)\}\),f\.jsx\("span",\{children:f\.jsx\("strong",\{children:',
                   r'f.jsx(ef,{name:"\1",size:16}),f.jsx("span",{children:f.jsx(f.Fragment,{children:', new_group)
if new_group.count('size:16') != 2 or 'actcard' in new_group:
    sys.exit('holiday buttons shape changed')
hol2 = hol.replace(old_head,
                   'function TwHolAsk(){const n=ht(),[e,t]=G.useState(""),r=i=>t(e===i?"":i),[__hh,__sh]=G.useState(null);G.useLayoutEffect(function(){__sh(document.getElementById("tws-ph-actions"))},[]);', 1)
hol2 = hol2.replace(btn_group, '(function(__b){return __hh&&Vn.createPortal?Vn.createPortal(__b,__hh):__b})(' + new_group + ')', 1)
rep(hol, hol2)

# ------------------------------------------------------------------ 4. Events: desktop shows all three as rows
rep('function XO(){const n=ht(),e=Un(),[t,r]=G.useState(null),[i,a]=G.useState("upcoming"),',
    'function XO(){const n=ht(),e=Un(),[t,r]=G.useState(null),[i,a]=G.useState("upcoming"),__wide=TO(EO),')
rep('f.jsx(Df,{items:[{key:"upcoming",label:"Coming up"', '!__wide&&f.jsx(Df,{items:[{key:"upcoming",label:"Coming up"')
rep('l.docs?f.jsxs(jf,{idBase:"events",value:i,children:[',
    'l.docs&&__wide?f.jsx("div",{className:"tws-ev-rows","data-testid":"events-rows",children:[["upcoming","Coming up",g,"No one-off events booked."],["weekly","Every week",p,"No weekly events."],["past","Past",_,"No past events."]].map(function(R){return f.jsxs("section",{className:"tws-ev-row","aria-labelledby":"ev-h-"+R[0],children:[f.jsxs("h2",{id:"ev-h-"+R[0],className:"tws-ev-h",children:[R[1],f.jsx("span",{className:"tws-ev-count",children:R[2].length})]}),R[2].length===0?f.jsx("p",{className:"muted",children:R[3]}):f.jsx("div",{className:"cardgrid",children:R[2].map(w=>f.jsx(Lm,{e:w,past:R[0]==="past",onEdit:n.isManager?()=>r(w):null},w.id))})]},R[0])})}):l.docs?f.jsxs(jf,{idBase:"events",value:i,children:[')

# ------------------------------------------------------------------ 10 + 11. Account: Your details, no Email settings
rep('settings:f.jsx(Um,{tab:"settings"})', 'settings:f.jsx(Um,{tab:"details"}),details:f.jsx(Um,{tab:"details"})')
rep('more:f.jsx(Um,{tab:"password"})', 'more:f.jsx(Um,{tab:"details"})')
rep('children:i==="settings"?f.jsx(P2,{}):f.jsx(C2,{})', 'children:i==="details"?f.jsx(TwsMyDetails,{}):f.jsx(C2,{})')
rep('function P2(){', 'function P2(){return null;')  # old Email settings screen: never renders
# tab list: whatever it was, it becomes Your details + Password
u0 = s.index('function Um(')
u1 = s.index('children:i==="details"?f.jsx(TwsMyDetails', u0)
um = s[u0:u1]
# The whole list, including the owner-only spread: everyone gets Your details + Password (fix 10).
# (27 Oct preview: the first version replaced only the inner owner-only array, so team members never
# saw Your details and owners got two Password tabs.)
m = re.search(r'\[\{key:"password",label:"Password"\},\.\.\.e\.isOwner\?\[\{key:"settings",label:"Email settings"\}\]:\[\]\]', um)
if not m:
    sys.exit('Account tabs shape changed')
um2 = um.replace(m.group(0), '[{key:"details",label:"Your details"},{key:"password",label:"Password"}]', 1)
rep(um, um2)

# ------------------------------------------------------------------ 12. developer maintenance login
rep('const p={user:n,role:t,', 'if(t==="developer")return f.jsx(TwsMaintenance,{user:n});const p={user:n,role:t,')
rep('payroll:"Payroll"}', 'payroll:"Payroll",developer:"Developer"}')
rep('e&&f.jsx("button",{className:"btn ghost sm",onClick:e,children:"Edit"})',
    'e&&!(n.developer===!0||n.role==="developer")&&f.jsx("button",{className:"btn ghost sm",onClick:e,children:"Edit"})')
d0 = s.index('"data-testid":"dev-pill"')
d1 = s.index('children:', d0)
d2 = s.index('})', d1)
rep(s[d0:d2], '"data-testid":"dev-pill",children:"Developer maintenance login. It can\u2019t see any staff information"')

# ------------------------------------------------------------------ overlapping shifts
rep('avail:{timeOff:ne.docs,unav:ie.docs,rtw:H.docs}', 'avail:{timeOff:ne.docs,unav:ie.docs,rtw:H.docs,shifts:Br}')
rep('if(ce){F(`${Vk(Z?Z.name:w.staffName,ce)} Pick someone else, change the day or times, or make it an open shift.`);return}',
    'if(ce){F(`${Vk(Z?Z.name:w.staffName,ce)} Pick someone else, change the day or times, or make it an open shift.`);return}'
    'const __ov=__twsOverlap(i&&i.shifts,w.staffId,w.date,w.start,w.end,_.id);if(__ov){F(`${Z?Z.name:w.staffName||"They"} already has a shift that overlaps (${__ov}). Change the times or pick someone else.`);return}')

# drag-copy onto someone (rota grid): same overlap rule
rep('const Me=xg(V,ee,ae,be,ne.docs,ie.docs);return Me?(t(`${Vk(vn(V),Me)} Pick someone else or make it an open shift.`,"warn"),!1):!0}',
    'const Me=xg(V,ee,ae,be,ne.docs,ie.docs);if(Me)return t(`${Vk(vn(V),Me)} Pick someone else or make it an open shift.`,"warn"),!1;'
    'const __ov=ae&&be?__twsOverlap(Br,V,ee,ae,be,null):null;return __ov?(t(`${vn(V)} already has a shift that overlaps (${__ov}). Pick someone else or change the times.`,"warn"),!1):!0}')

open(DST, 'w', encoding='utf-8').write(s)
print('ok', DST, len(s))
