#!/usr/bin/env python3
"""Rota hours/break flags + contracted hours in the staff form.
Usage: patch_hours.py in.js out.js   (idempotent: refuses to double-apply)"""
import sys

src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding="utf-8").read()
if "__twsWeek(" in s:
    sys.exit("already patched")


def rep(old, new):
    global s
    n = s.count(old)
    if n != 1:
        sys.exit(f"anchor found {n} times: {old[:90]}")
    s = s.replace(old, new)


# 1. Rota person row: total keeps showing (shifts + holiday); flags underneath.
rep('f.jsx("div",{className:`hrs ${ee>48?"over":""}`,children:Li(ee)})',
    '(function(){var tw=__twsWeek(V.id,l,$r,fs,twC);return f.jsxs(f.Fragment,{children:['
    'f.jsx("div",{className:`hrs ${tw.level?"over":""}`,title:__twsHrsTitle(tw),children:Li(ee)}),'
    '__twsRowFlags(tw)]})})()')

# 2. Shift chip: long shift with no / short break.
rep('ir(et)&&f.jsxs("div",{className:"chip-clash"',
    '__twsChipFlag(et),ir(et)&&f.jsxs("div",{className:"chip-clash"')

# 3. Summary above the rota grid.
rep('f.jsx(xn,{error:te.error||F.error||ne.error||ie.error})',
    '__twsHoursNote(Oe,l,$r,fs,twC),f.jsx(xn,{error:te.error||F.error||ne.error||ie.error})')

# 4. Shift editor: live warning under the break fields.
rep('"data-testid":"pop-derived"',
    '"data-testid":"pop-derived","data-tws-h":"1"')
i = s.index('"data-tws-h":"1"')
# find the end of the f.jsx("div",{...pop-derived...}) call that contains the marker
start = s.rfind('f.jsx', 0, i)
depth = 0
j = s.index('(', start)
k = j
while True:
    c = s[k]
    if c == '(':
        depth += 1
    elif c == ')':
        depth -= 1
        if depth == 0:
            break
    elif c in '"\'`':
        q = c
        k += 1
        while s[k] != q:
            if s[k] == '\\':
                k += 1
            k += 1
    k += 1
s = s[:k + 1] + ',__twsPopBreak(w)' + s[k + 1:]
s = s.replace(',"data-tws-h":"1"', '')

# 5. Staff form (R2): contracted hours a week.
rep('O=ie=>H=>l({...a,[ie]:H.target.value});async function M(ie){',
    'O=ie=>H=>l({...a,[ie]:H.target.value}),'
    'twCQ=He(()=>n.id&&(r.isOwner||r.role==="payroll")?_t(Ee,"contracts",n.id):null,[n.id]),'
    'twCD=twCQ.docs&&twCQ.docs[0]||null,[twCI,twCS]=G.useState(null),'
    'twCV=twCI!=null?twCI:twCD&&typeof twCD.contractHours=="number"?String(twCD.contractHours):"";'
    'async function M(ie){')
rep('M(async()=>{if(w){const ie=await mn("createStaff",',
    'M(async()=>{const twP=r.isOwner&&twCI!=null&&a.role!=="payroll"?__twsParseContract(twCI):null;'
    'if(twP&&!twP.ok)throw new Error(twP.msg);if(w){const ie=await mn("createStaff",')
rep('t({...ie,name:a.name,email:a.email.trim().toLowerCase(),isNew:!0})',
    'if(twP&&twP.value!=null&&ie&&ie.uid){try{await __twsSaveContract(ie.uid,twP.value,null,r.user.uid)}'
    'catch(twE){i("Login created, but the contracted hours didn\u2019t save. Add them from Edit.","warn")}}'
    't({...ie,name:a.name,email:a.email.trim().toLowerCase(),isNew:!0})')
rep('r.isOwner&&!T&&a.role!==n.role&&(ie.role=a.role),await mn("updateStaff",ie),i("Saved."),e()',
    'r.isOwner&&!T&&a.role!==n.role&&(ie.role=a.role);await mn("updateStaff",ie);'
    'twP&&await __twsSaveContract(n.id,twP.value,twCD,r.user.uid);i("Saved."),e()')
rep('!r.isOwner&&f.jsx("p",{className:"tiny muted",children:"Only an owner can change someone\u2019s access."}),',
    '!r.isOwner&&f.jsx("p",{className:"tiny muted",children:"Only an owner can change someone\u2019s access."}),'
    'r.isOwner&&a.role!=="payroll"&&f.jsx(Ve,{label:"Contracted hours a week",children:f.jsx("input",'
    '{type:"number",inputMode:"decimal",min:"0",max:"80",step:"0.25",placeholder:"Blank for irregular hours",'
    'value:twCV,onChange:ev=>twCS(ev.target.value),"data-testid":"contract-hours"})}),')

HELPERS = r'''
var __twsHW=48,__twsHN=50,__twsHL=52;
function __twsR2(x){return Math.round(x*100)/100}
function __twsLongNoBreak(s){if(!s||!s.start||!s.end)return null;var span=Jh(s.start,s.end);if(!(span>360))return null;var b=kO(s);return b>=20?null:b>0?"short":"none"}
function __twsChipFlag(s){var k=__twsLongNoBreak(s);return k?f.jsx("div",{className:"tws-chipflag",title:k==="none"?"Over 6 hours with no break on the rota":"Over 6 hours with a break under 20 minutes",children:k==="none"?"No break":"Short break"}):null}
function __twsWeek(id,days,byCell,blocks,contracts){var worked=0,draft=0,hol=0,nb=0;(days||[]).forEach(function(d){(byCell[id+"|"+d]||[]).forEach(function(s){var h=Fi(s);worked+=h;s.published||(draft+=h);__twsLongNoBreak(s)&&nb++});var b=blocks&&blocks[id+"|"+d];b&&b.hours&&(hol+=b.hours)});var c=contracts&&contracts.docs?contracts.docs.find(function(d){return d.id===id}):null;var ch=c&&typeof c.contractHours=="number"&&c.contractHours>0?c.contractHours:null;worked=__twsR2(worked);draft=__twsR2(draft);hol=__twsR2(hol);var total=__twsR2(worked+hol);var level=worked>__twsHL?"over52":worked>=__twsHN?"near":worked>__twsHW?"over":"";return{worked:worked,draft:draft,hol:hol,total:total,contract:ch,under:ch!=null&&total<ch-.005,level:level,noBreak:nb}}
function __twsHrsTitle(w){var t="Worked "+Li(w.worked);w.draft&&(t+=" ("+Li(w.draft)+" draft)");w.hol&&(t+=", holiday "+Li(w.hol));w.contract!=null&&(t+=", contract "+Li(w.contract));return t}
function __twsLevelText(w){return w.level==="over52"?"Over 52h":w.level==="near"?"Near 52h":w.level==="over"?"Over 48h":""}
function __twsRowFlags(w){var o=[];w.level&&o.push(f.jsx("div",{className:"tws-hflag "+(w.level==="over"?"tws-hflag-amber":"tws-hflag-red"),title:Li(w.worked)+" on shift this week"+(w.draft?", "+Li(w.draft)+" of it draft":""),children:__twsLevelText(w)},"l"));w.under&&o.push(f.jsx("div",{className:"tws-hflag tws-hflag-blue",title:Li(w.total)+" of "+Li(w.contract)+" contracted"+(w.hol?" (holiday included)":""),children:"Under contract "+Li(w.total)+"/"+Li(w.contract)},"u"));w.noBreak&&o.push(f.jsx("div",{className:"tws-hflag tws-hflag-amber",title:"Shifts over 6 hours with no break, or a break under 20 minutes",children:w.noBreak===1?"1 shift no break":w.noBreak+" shifts no break"},"b"));return o}
function __twsHoursNote(people,days,byCell,blocks,contracts){var items=[],dr=!1;(people||[]).forEach(function(p){if(!p||p.gone)return;var w=__twsWeek(p.id,days,byCell,blocks,contracts),nm=p.name||"Someone",bits=[];w.level&&bits.push(Li(w.worked)+", "+(w.level==="over52"?"over 52":w.level==="near"?"near 52":"over 48"));w.under&&bits.push(Li(w.total)+" of "+Li(w.contract)+" contracted");w.noBreak&&bits.push(w.noBreak===1?"1 long shift with no break":w.noBreak+" long shifts with no break");if(bits.length){items.push({k:p.id,t:nm+": "+bits.join(", "),r:w.level==="over52"?3:w.level==="near"?2:w.level?1:0});w.draft&&(dr=!0)}});if(!items.length)return null;items.sort(function(a,b){return b.r-a.r});return f.jsxs("div",{className:"warn rota-note tws-hoursnote",role:"status","data-testid":"hours-note",children:[f.jsx("strong",{children:"Hours to check this week"}),f.jsx("ul",{children:items.map(function(x){return f.jsx("li",{children:x.t},x.k)})}),dr&&f.jsx("div",{className:"tiny",children:"Includes draft shifts."})]})}
function __twsPopBreak(w){if(!w||!w.start||!w.end)return null;var span=Jh(w.start,w.end);if(!(span>360))return null;var b=0;if(w.breakStart){var m=parseInt(w.breakMins,10);b=isFinite(m)&&m>0?m:0}if(b>=20)return null;return f.jsx("div",{className:"tws-popflag",role:"status","data-testid":"pop-nobreak",children:b?"Over 6 hours with a break under 20 minutes.":"Over 6 hours with no break. Add a break of at least 20 minutes."})}
function __twsParseContract(v){var t=String(v==null?"":v).trim();if(!t)return{ok:!0,value:null};var n=Number(t);if(!isFinite(n)||n<0||n>80)return{ok:!1,msg:"Contracted hours must be a number from 0 to 80, or blank for irregular hours."};return{ok:!0,value:Math.round(n*100)/100}}
async function __twsSaveContract(id,val,prev,uid){var old=prev&&typeof prev.contractHours=="number"?prev.contractHours:null;if(prev&&val===old)return!1;if(!prev&&val==null)return!1;await Ac(_t(Ee,"contracts",id),{staffId:id,contractHours:val,updatedAt:Ji(),updatedBy:uid},{merge:!0});return!0}
(function(){try{if(typeof document>"u"||document.getElementById("tws-hours-css"))return;var e=document.createElement("style");e.id="tws-hours-css";e.textContent=".tws-hflag{display:block;width:max-content;max-width:100%;margin-top:3px;font-size:.7rem;font-weight:700;border-radius:5px;padding:1px 6px;line-height:1.35;white-space:normal}.tws-hflag-amber{background:#fdf2d6;color:#6e4a00;border:1px solid #e9cf88}.tws-hflag-red{background:#b42318;color:#fff;border:1px solid #b42318}.tws-hflag-blue{background:#e6eef7;color:#1d4a7a;border:1px solid #c3d4e8}.tws-chipflag{display:inline-block;margin:2px 0;font-size:.68rem;font-weight:700;color:#6e4a00;background:#fdf2d6;border:1px solid #e9cf88;border-radius:4px;padding:0 5px}.tws-popflag{font-size:.85rem;font-weight:600;color:#6e4a00;background:#fdf2d6;border:1px solid #e9cf88;border-radius:8px;padding:6px 10px;margin:6px 0}.tws-hoursnote ul{margin:4px 0 2px;padding-left:18px}.tws-hoursnote li{margin:1px 0}";(document.head||document.documentElement).appendChild(e)}catch(x){}})();
'''

# append helpers before the sourcemap comment / at end
marker = "\n//# sourceMappingURL"
if marker in s:
    idx = s.rindex(marker)
    s = s[:idx] + HELPERS + s[idx:]
else:
    s = s.rstrip("\n") + "\n" + HELPERS
open(dst, "w", encoding="utf-8").write(s)
print("ok", len(s))
