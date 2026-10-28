#!/usr/bin/env python3
"""Handover recovery fixes for the payroll module.

payroll-tws2610hf.js = payroll-tws2610rp.js + this patch. Anchors must match exactly once.

  5  Team > pay/holiday: clearer headings, two-column form (one column on phones). CSS only.
  6  Unapproved weeks: "This week hasn't been approved" for a single-week period; otherwise
     each week is named, e.g. "Week of 12 Oct hasn't been approved".
  7  Payslips upload: Pay date input lines up with the field beside it, incl. iPhone Safari. CSS.
  8  PDF matching: file name once at the top; each row = page / status / who; the page's text is
     shown only when someone has to choose the match.
  9  Payroll settings: Pay calendar / Holiday and overtime / Export columns as separate sections;
     holiday year start picked with day + month dropdowns (still saved as MM-DD).
"""
import re
import sys

SRC, DST = sys.argv[1], sys.argv[2]
s = open(SRC, encoding='utf-8').read()
MARK = '/* tws-handover-fixes-v1 */'
if MARK in s:
    sys.exit('already patched')


def rep(old, new):
    global s
    n = s.count(old)
    if n != 1:
        sys.exit(f'anchor found {n} times (want 1): {old[:100]!r}')
    s = s.replace(old, new)


# ------------------------------------------------------------------ 6. unapproved week wording
rep('function zt(e){return`The week of ${L(e.week,{day:"numeric",month:"short"})} hasn\\u2019t been approved`}',
    'function zt(e,one){return one?"This week hasn\\u2019t been approved":`Week of ${L(e.week,{day:"numeric",month:"short"})} hasn\\u2019t been approved`}'
    'function __tws1w(p,b){return!!(p&&b&&b.length===1&&C.daysBetween(p.start,p.end)<7)}')
# overview checks list (period = e, unapproved weeks = b)
rep('for(let s of b)o.push({level:"warn",title:zt(s),', 'for(let s of b)o.push({level:"warn",title:zt(s,__tws1w(e,b)),')
# export warning (period = t, unapproved weeks = b)
rep('children:b.map(y=>r("div",{children:[zt(y),', 'children:b.map(y=>r("div",{children:[zt(y,__tws1w(t,b)),')

# ------------------------------------------------------------------ 8. PDF matching rows
rep('r("h2",{children:"Check the matches"}),r("p",{class:"tiny muted",children:[m.length," payslip",m.length===1?"":"s"," found."]}),r("ul",{class:"tws-match",',
    'r("h2",{children:"Check the matches"}),r("p",{class:"tws-match-file","data-testid":"match-file",children:[r("b",{children:b&&b.name?b.name:"Payslips PDF"}),r("span",{class:"tiny muted",children:[" \u00b7 ",m.length," payslip",m.length===1?"":"s"," found"]})]}),r("ul",{class:"tws-match tws-match-rows",')
rep('return r("li",{class:`card ${x.staffId?"":"tws-unmatched"}`,children:[r("div",{class:"row between",children:[r("b",{children:["Page",',
    'let __need=x.how==="none"||x.how==="ambiguous"||x.how==="conflict",__pg=x.pages.length>1?`${x.pages[0]+1}-${x.pages[x.pages.length-1]+1}`:x.pages[0]+1;'
    'return r("li",{class:`tws-mrow ${x.staffId?"":"tws-unmatched"} ${__need?"need":""}`,children:[r("div",{class:"tws-mrow-main",children:[r("b",{class:"tws-mrow-page",children:["Page",')
rep('r("label",{class:"field",children:[r("span",{children:"Person"}),r("select",{value:x.staffId,',
    'r("label",{class:"tws-mrow-who",children:[r("span",{class:"sr-only",children:`Who is page ${__pg}?`}),r("select",{value:x.staffId,')
# close the main row after the select's label (the label is followed by the replace-warning)
rep(']})]}),W&&Ae[W]?r("p",{class:"tiny warn",children:["Replaces the payslip',
    ']})]})]}),W&&Ae[W]?r("p",{class:"tiny warn",children:["Replaces the payslip')
rep('r("p",{class:"tiny muted",children:x.text?`\\u201C${x.text}\\u2026\\u201D`:"No readable text on this page."})',
    '__need?r("p",{class:"tiny muted tws-mrow-text",children:x.text?`\\u201C${x.text}\\u2026\\u201D`:"No readable text on this page."}):null')
# the old header row had row/between and closed before the label; it now stays open (see above)
rep('`Matched by ${x.how}`})]}),r("label",{class:"tws-mrow-who"', '`Matched by ${x.how}`}),r("label",{class:"tws-mrow-who"')

# ------------------------------------------------------------------ 9. settings sections + day/month dropdowns
OLD_GROUP = (',r("label",{class:"field",children:[r("span",{children:"Holiday year starts (MM-DD)"}),r("input",{type:"text",pattern:"\\\\d{2}-\\\\d{2}",value:a.holidayYearStart,onInput:u("holidayYearStart")})]}),'
             'r("label",{class:"field",children:[r("span",{children:"Overtime pay multiplier"}),r("input",{type:"number",step:"0.05",min:"1",max:"3",value:a.overtimeMultiplier,onInput:u("overtimeMultiplier")})]}),'
             'r("label",{class:"field",children:[r("span",{children:"Holiday accrual for irregular hours (%)"}),r("input",{type:"number",step:"0.01",min:"0",max:"20",value:a.accrualRate,onInput:u("accrualRate")})]})')
rep(OLD_GROUP, '')
dd = ('r("fieldset",{class:"field tws-hys",children:[r("legend",{children:"Holiday year starts"}),r("div",{class:"tws-hys-row",children:(function(){'
      'var v=String(a.holidayYearStart||"01-01"),mm=Math.min(12,Math.max(1,Number(v.slice(0,2))||1)),dd=Number(v.slice(3,5))||1,'
      'MN=["January","February","March","April","May","June","July","August","September","October","November","December"],'
      'MX=[31,28,31,30,31,30,31,31,30,31,30,31],p2=function(n){return String(n).padStart(2,"0")},'
      'put=function(M,D){D=Math.min(D,MX[M-1]);u("holidayYearStart")({target:{value:p2(M)+"-"+p2(D)}})};'
      'return[r("label",{children:[r("span",{class:"sr-only",children:"Day"}),r("select",{"data-testid":"hys-day",value:String(Math.min(dd,MX[mm-1])),onChange:function(ev){put(mm,Number(ev.target.value))},'
      'children:Array.from({length:MX[mm-1]},function(_,i){return r("option",{value:String(i+1),children:i+1})})})]}),'
      'r("label",{children:[r("span",{class:"sr-only",children:"Month"}),r("select",{"data-testid":"hys-month",value:String(mm),onChange:function(ev){put(Number(ev.target.value),dd)},'
      'children:MN.map(function(n,i){return r("option",{value:String(i+1),children:n})})})]})]})()})]})')
group = dd + OLD_GROUP[OLD_GROUP.index('),r("label",{class:"field",children:[r("span",{children:"Overtime pay multiplier"})') + 1:]
# new section straight after the Pay calendar section, before Export columns
exp = s.index('r("section",{class:"card stack",children:[r("h2",{children:"Export columns"}')
if s.count('r("section",{class:"card stack",children:[r("h2",{children:"Export columns"}') != 1:
    sys.exit('Export columns section anchor changed')
s = s[:exp] + 'r("section",{class:"card stack tws-holot","data-testid":"settings-holot",children:[r("h2",{children:"Holiday and overtime"}),r("div",{class:"tws-form",children:[' + group + ']})]}),' + s[exp:]

# ------------------------------------------------------------------ CSS (5, 7, 8, 9) appended to the module's own style block
CSS = MARK + r'''
.tws-payset h4,.tws-payset h3{margin:20px 0 10px;font-size:1rem;line-height:1.3}
.tws-payset h4:first-child,.tws-payset h3:first-child{margin-top:4px}
.tws-payset .tws-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px;align-items:end}
.tws-payset .tws-form>.check,.tws-payset .tws-form>.actions,.tws-payset .tws-form>p,.tws-payset .tws-form>.full{grid-column:1/-1}
.tws-payset .tws-form .field{margin:0;min-width:0}
@media (max-width:560px){.tws-payset .tws-form{grid-template-columns:minmax(0,1fr)}}
.tws-payroll input[type=date]{-webkit-appearance:none;appearance:none;display:block;box-sizing:border-box;width:100%;min-width:0;max-width:100%;height:44px;min-height:44px;padding-top:0;padding-bottom:0;line-height:44px;font-size:16px;text-align:left;background-clip:padding-box}
.tws-payroll input[type=date]::-webkit-date-and-time-value{text-align:left;margin:0;min-height:1.3em;line-height:1.3}
.tws-payroll input[type=date]::-webkit-datetime-edit{padding:0;line-height:1.3}
.tws-payroll input[type=date]::-webkit-calendar-picker-indicator{margin:0}
.tws-payroll .row>.field{min-width:0}
.tws-match-file{margin:0;overflow-wrap:anywhere}
.tws-match-rows{list-style:none;padding:0;margin:8px 0 0;display:flex;flex-direction:column;gap:6px}
.tws-mrow{border:1px solid var(--line);border-radius:10px;padding:8px 10px;background:var(--card)}
.tws-mrow.need{border-color:var(--amber)}
.tws-mrow-main{display:grid;grid-template-columns:auto auto minmax(0,1fr);gap:10px;align-items:center}
.tws-mrow-page{white-space:nowrap}
.tws-mrow-who select{width:100%;min-width:0}
.tws-mrow-text{margin:6px 0 0;overflow-wrap:anywhere}
@media (max-width:560px){.tws-mrow-main{grid-template-columns:auto minmax(0,1fr)}.tws-mrow-who{grid-column:1/-1}}
.tws-hys{border:0;padding:0;margin:0;min-width:0}
.tws-hys legend{padding:0;margin-bottom:6px}
.tws-hys-row{display:grid;grid-template-columns:5.5em minmax(0,1fr);gap:8px}
.tws-hys-row select{width:100%}
.sr-only{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
'''
rep('/* tws-align-v1 */', CSS.replace('\\', '\\\\').replace('`', '\\`') + '/* tws-align-v1 */')

open(DST, 'w', encoding='utf-8').write(s)
print('ok', DST, len(s))
