#!/usr/bin/env python3
"""Salary option for staff pay (Team > person > Pay and holiday), on top of the handover-fixes payroll module.

Usage: patch_salary.py payroll-tws2610hf.js payroll-tws2610sl.js

- Team pay form: 'Paid by' Hourly rate / Annual salary. Hourly works exactly as before (no new fields are
  written for hourly people). Salaried writes payInfo.payType = 'salary' and payInfo.annualSalary (GBP a year)
  and drops hourlyRate. Same access as hourly rates: owner + payroll edit, each person reads their own.
- Salary per pay day = annual salary / pay days a year from the pay calendar (52, 26, 13 or 12).
- Person panel and Home pay card: salaried people show their salary for the period, not 'no pay rate set'.
- Hours export: hours unchanged; Hourly rate blank for salaried; Gross estimate = salary for the period;
  two new columns at the END of the standard layout: Pay type, Annual salary. Saved custom layouts get the two
  new columns unticked at the bottom (existing behaviour for new columns), so a saved Sage layout is unchanged.
- Checks: 'Missing hourly rate' no longer lists salaried people; new 'Missing annual salary' warning.
"""
import sys

src, out = sys.argv[1], sys.argv[2]
s = open(src, encoding='utf-8').read()


def rep(a, b):
    global s
    n = s.count(a)
    if n != 1:
        sys.exit(f'expected 1 match, found {n}: {a[:90]}')
    s = s.replace(a, b)


if 'twsSal(' in s:
    sys.exit('already patched')

# helpers (function declarations, hoisted)
rep('Zt=["owner"],ue=["owner","payroll"];',
    'Zt=["owner"],ue=["owner","payroll"];'
    'function twsSal(p){return!!(p&&p.payType==="salary"&&typeof p.annualSalary=="number")}'
    'function twsPerYear(s){var f=C.withDefaults(s||{}).frequency;return f==="weekly"?52:f==="fortnightly"?26:f==="fourweekly"?13:12}'
    'function twsPeriodSalary(p,s){return twsSal(p)?O(p.annualSalary/twsPerYear(s)):null}'
    'function twsPay(x,p,s){return x&&twsSal(p)&&(x.rate=null,x.salaried=!0,x.gross=twsPeriodSalary(p,s)),x}'
    'function twsSalHint(v,s){var c=C.withDefaults(s||{}),F=(C.FREQUENCIES[c.frequency]||{label:"Monthly"}).label.toLowerCase(),n=Number(v);'
    'return v===""||v==null||!isFinite(n)||n<=0?"Paid in equal amounts on the "+F+" pay calendar.":'
    '"About "+Qt(n/twsPerYear(c))+" gross each pay day ("+F+" pay calendar). Their hours still go in the export."}')

# export columns
rep('grossEstimate:{label:"Gross estimate",get:e=>e.gross==null?"":O(e.gross).toFixed(2)},',
    'grossEstimate:{label:"Gross estimate",get:e=>e.gross==null?"":O(e.gross).toFixed(2)},'
    'payType:{label:"Pay type",get:e=>e.payType||"Hourly"},'
    'annualSalary:{label:"Annual salary",get:e=>e.annualSalary==null?"":O(e.annualSalary).toFixed(2)},')
rep('"hourlyRate","grossEstimate"].map', '"hourlyRate","grossEstimate","payType","annualSalary"].map')

# export rows
rep('w=a[i.staffId]||{},b=typeof w.hourlyRate=="number"?w.hourlyRate:null',
    'w=a[i.staffId]||{},twsK=twsSal(w),b=!twsK&&typeof w.hourlyRate=="number"?w.hourlyRate:null')
rep('gross:b==null?null:b*(_+h*(Number(l.overtimeMultiplier)||1)+u)}',
    'gross:twsK?twsPeriodSalary(w,l):b==null?null:b*(_+h*(Number(l.overtimeMultiplier)||1)+u),'
    'payType:w.payType==="salary"?"Salaried":"Hourly",annualSalary:twsK?w.annualSalary:null}')

# checks
rep('g=s.filter(y=>!(n[y.staffId]&&typeof n[y.staffId].hourlyRate=="number"))',
    'g=s.filter(y=>!(n[y.staffId]&&(typeof n[y.staffId].hourlyRate=="number"||n[y.staffId].payType==="salary")))')
rep('g.length&&o.push({level:"warn",title:"Missing hourly rate",detail:g.map(y=>y.name).join(", ")})',
    'g.length&&o.push({level:"warn",title:"Missing hourly rate",detail:g.map(y=>y.name).join(", ")}),'
    '(function(){var q=s.filter(y=>n[y.staffId]&&n[y.staffId].payType==="salary"&&typeof n[y.staffId].annualSalary!="number");'
    'q.length&&o.push({level:"warn",title:"Missing annual salary",detail:q.map(y=>y.name).join(", ")})})()')

# person panel + Home pay card
rep('h=!e.shifts.error&&!e.timeOff.error?qr({settings:t,contract:o,rate:p,shifts:n,timeOff:l,staffId:a,period:e.period}):null',
    'h=twsPay(!e.shifts.error&&!e.timeOff.error?qr({settings:t,contract:o,rate:p,shifts:n,timeOff:l,staffId:a,period:e.period}):null,e.payInfo.doc,t)')
rep('n.canRate&&l.pay.rate==null?" \\xB7 no pay rate set":""',
    'n.canRate&&l.pay.salaried?" \\xB7 salaried":n.canRate&&l.pay.rate==null?" \\xB7 no pay rate set":""')
rep('children:" gross estimate"', 'children:l.pay.salaried?" salary this period":" gross estimate"')

# Team pay form
rep('r(Wr,{staffId:e,pay:n.payInfo.doc||null,contract:n.contract.doc||null})',
    'r(Wr,{staffId:e,pay:n.payInfo.doc||null,contract:n.contract.doc||null,settings:a})')
rep('function Wr({staffId:e,pay:t,contract:a}){let n=()=>({payrollId:t&&t.payrollId||"",',
    'function Wr({staffId:e,pay:t,contract:a,settings:twsS}){let n=()=>({payrollId:t&&t.payrollId||"",'
    'payType:t&&t.payType==="salary"?"salary":"hourly",annualSalary:t&&t.annualSalary!=null?t.annualSalary:"",')
rep('async function b(){h(!0),d(null);try{let _={updatedAt:I().serverTimestamp(),updatedBy:ee().uid},m={...Me(t)};delete m.hourlyRate,',
    'async function b(){if(l.payType==="salary"){let q=w(l.annualSalary);if(q==null||q<=0||q>1e6){d({ok:!1,text:"Enter an annual salary between \\xA31 and \\xA31,000,000, or switch Paid by back to Hourly rate."});return}}'
    'h(!0),d(null);try{let _={updatedAt:I().serverTimestamp(),updatedBy:ee().uid},m={...Me(t)};delete m.hourlyRate,delete m.payType,delete m.annualSalary,')
rep('..._}),w(l.hourlyRate)!=null&&(m.hourlyRate=w(l.hourlyRate));let s={...Me(a)};',
    '..._}),l.payType==="salary"?(m.payType="salary",m.annualSalary=O(w(l.annualSalary))):w(l.hourlyRate)!=null&&(m.hourlyRate=w(l.hourlyRate));let s={...Me(a)};')
HR = ('r("label",{class:"field",children:[r("span",{children:"Hourly rate (\\xA3)"}),r("input",{type:"number",step:"0.01",min:"0",'
      'max:"500",inputMode:"decimal",name:"hourlyRate",value:l.hourlyRate,onInput:u("hourlyRate")})]})')
rep(HR,
    'r("label",{class:"field",children:[r("span",{children:"Paid by"}),r("select",{name:"payType","data-testid":"team-paytype",'
    'value:l.payType,onChange:u("payType"),children:[r("option",{value:"hourly",children:"Hourly rate"}),'
    'r("option",{value:"salary",children:"Annual salary"})]})]}),'
    'l.payType==="salary"?r("label",{class:"field",children:[r("span",{children:"Annual salary (\\xA3)"}),'
    'r("input",{type:"number",step:"0.01",min:"0",max:"1000000",inputMode:"decimal",name:"annualSalary",'
    'value:l.annualSalary,onInput:u("annualSalary")}),'
    'r("span",{class:"tiny muted","data-testid":"team-salary-hint",children:twsSalHint(l.annualSalary,twsS)})]}):' + HR)

open(out, 'w', encoding='utf-8').write(s)
print('patched', out)
