#!/usr/bin/env python3
"""Idempotent patch: merge Inbox, Enquiries and Notifications into one Inbox page.
Usage: patch_inbox.py <in.js> <out.js>"""
import sys, re
src = open(sys.argv[1], encoding='utf-8').read()
MARK = '/* tws-inbox-merge-v1 */'
if MARK in src:
    print('already patched'); open(sys.argv[2], 'w', encoding='utf-8').write(src); sys.exit(0)

def rep(old, new, count=1):
    global src
    n = src.count(old)
    if n != count:
        sys.exit(f'anchor count {n} != {count}: {old[:90]!r}')
    src = src.replace(old, new)

# 1. Inbox page body -> merged inbox
m = re.search(r'function WT\(\)\{.*?\}(?=function i2\(\))', src)
if not m: sys.exit('WT not found')
src = src[:m.start()] + 'function WT(){return f.jsx(__twsInbox,{})}' + src[m.end():]

# 2. App shell (O2): combined count, routes, nav, bell
rep('T=(_.docs?_.docs.length:0)+(w.docs?w.docs.length:0),k=__twsRoutes(',
    'T=(_.docs?_.docs.length:0)+(w.docs?w.docs.length:0),twIC=__twsUseIC(t,p,T),k=__twsRoutes(')
rep('enquiries:f.jsx(h2,{}),', 'enquiries:f.jsx(__twsGo,{to:"enquiries"}),')
rep('notifications:f.jsx(D2,{})}', 'notifications:f.jsx(__twsGo,{to:"updates"})}')
rep('{p:"inbox",label:"Inbox",icon:"inbox",badge:t.isManager?T:0,badgeLabel:"waiting for a decision",testid:"inbox-badge"}',
    '{p:"inbox",label:"Inbox",icon:"inbox",badge:twIC,badgeLabel:"new",testid:"inbox-badge"}')
rep('...t.isManager?[{p:"enquiries",label:"Enquiries",icon:"mail"}]:[],', '')
rep('ie=[{p:"notifications",label:"Notifications",icon:"bell",badge:g,badgeLabel:"unread"},{p:"more",label:"Account",icon:"user"}]',
    'ie=[{p:"more",label:"Account",icon:"user"}]')
rep('b=f.jsxs("a",{className:"iconbtn bell",href:"#/notifications","aria-label":`Notifications${g?`, ${g} unread`:""}`,children:[f.jsx(gr,{name:"bell"}),g>0&&f.jsx("span",{className:"badge dot","aria-hidden":"true",children:g})]})',
    'b=f.jsxs("a",{className:"iconbtn bell",href:"#/inbox","aria-label":`Inbox${twIC?`, ${twIC} new`:""}`,"data-testid":"mbar-inbox",children:[f.jsx(gr,{name:"inbox"}),twIC>0&&f.jsx("span",{className:"badge dot","aria-hidden":"true",children:twIC})]})')
rep('(t.isManager?T:0)>0&&f.jsx("span",{className:"badge dot","aria-hidden":"true",children:T})', '!1')

# 3. Routes + nav helpers: payroll users get the Inbox (their updates)
rep('password:k.password,notifications:k.notifications};', 'password:k.password,notifications:k.notifications,inbox:k.inbox,timeoff:k.inbox};')
rep('if(t.role==="payroll")return w===0?[{p:"",label:"Payroll",icon:"rota"},H,{p:"payslips",label:"Payslips",icon:"pay"}]:[];',
    'if(t.role==="payroll")return w===0?[{p:"",label:"Payroll",icon:"rota"}].concat(l.filter(function(x){return x.p==="inbox"}),[H,{p:"payslips",label:"Payslips",icon:"pay"}]):[];')

# 4. Page header text
m = re.search(r'inbox:e\.isManager\?\["Inbox","Holiday, swaps, problems and unavailability\."\]:\["Inbox","See what(?:\u2019|\\u2019)s been decided\."\]', src)
if not m: sys.exit('j2 inbox anchor not found')
src = src[:m.start()] + 'inbox:e.isManager?["Inbox","Requests, enquiries and updates in one place."]:["Inbox","Your requests and updates."]' + src[m.end():]

# 5. Home links and enquiry count
rep('f.jsx(MT,{href:"#/enquiries",count:a.docs', 'f.jsx(MT,{href:"#/inbox?f=enquiries",count:a.docs')
rep('f.jsx(MT,{href:"#/inbox",count:M,testid:"home-requests"', 'f.jsx(MT,{href:"#/inbox?f=requests",count:M,testid:"home-requests"')
rep('a=He(()=>n.isManager?Ze(Fe(Ee,"enquiries"),ot("status","==","new"),Vr(50)):null,[n.isManager])',
    'a=He(()=>n.isManager?Ze(Fe(Ee,"enquiries"),ot("status","in",["new","replied"]),Vr(50)):null,[n.isManager])')
rep('{className:"morelink",href:"#/notifications",children:["See all"', '{className:"morelink",href:"#/inbox?f=updates",children:["See all"')
rep('F.link&&F.link.startsWith("#/")?F.link:"#/notifications"', 'F.link&&F.link.startsWith("#/")?F.link:"#/inbox?f=updates"')

# 6. New components + styles
src = src.rstrip('\n') + '\n' + open(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)),'inbox_add.js'), encoding='utf-8').read()
if '#/notifications' in src.replace('notifications:k.notifications', ''):
    pass
open(sys.argv[2], 'w', encoding='utf-8').write(src)
print('patched ok')
