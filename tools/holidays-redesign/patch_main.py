import sys
src, out = sys.argv[1], sys.argv[2]
s = open(src).read()
skipped = []

def rep(old, new, required=True):
    global s
    n = s.count(old)
    if n != 1:
        if required:
            raise SystemExit(f'anchor count {n}: {old[:90]!r}')
        skipped.append(old[:70]); return
    s = s.replace(old, new)

# 1. Move the holiday / unavailable request buttons out of the Inbox into TwHolAsk
wt = 'function WT(){const n=ht(),[e,t]=G.useState(""),r=i=>t(e===i?"":i);return f.jsxs("div",{className:"inbox",children:['
assert s.count(wt) == 1, 'WT head'
a = s.index(wt) + len(wt)
end_marker = 'e==="unav"&&f.jsx(c2,{onClose:()=>t("")}),'
b = s.index(end_marker, a) + len(end_marker)
actions = s[a:b].rstrip(',')
assert actions.startswith('f.jsxs("div",{className:"inbox-actions"'), actions[:60]
holask = ('function TwHolAsk(){const n=ht(),[e,t]=G.useState(""),r=i=>t(e===i?"":i);'
          'return n.role==="payroll"?null:f.jsxs("section",{className:"tws-holask","aria-label":"Ask for time off",children:[' + actions + ']})}')
s = s[:s.index(wt)] + holask + 'function WT(){const n=ht();return f.jsxs("div",{className:"inbox",children:[' + s[b:]

# 2. Holidays route: progress circles, then the request buttons
rep('k.holidays=hol;', 'k.holidays=f.jsxs(f.Fragment,{children:[hol,f.jsx(TwHolAsk,{},"tws-holask")]});')

# 3. Inbox empty state no longer points at a button that moved
rep('"No requests yet. Use Ask for holiday above."', '"No requests yet."')
rep('["Inbox","Ask for holiday and see what’s been decided."]', '["Inbox","See what’s been decided."]', required=False)

# 4. Team: click a name to open holiday / pay / hours panel (managers and owners)
rep('function b2({p:n,onEdit:e,canDelete:cd}){const tw=en();',
    'function b2({p:n,onEdit:e,canDelete:cd}){const tw=en(),twC=ht(),[twO,twS]=G.useState(!1),twM=!!(twC.isManager||twC.isOwner);')
rep('return f.jsxs("li",{className:"row between",children:[f.jsxs("div",{className:"grow",children:[f.jsx("strong",{children:n.name}),',
    'return f.jsxs("li",{className:"row between tws-teamli",children:[f.jsxs("div",{className:"grow",children:[twM?f.jsxs("button",{type:"button",className:"tws-namebtn","aria-expanded":twO,"aria-label":`${n.name}: ${twO?"hide":"show"} holiday, pay and hours`,onClick:()=>twS(!twO),children:[f.jsx("strong",{children:n.name}),f.jsx("span",{className:"tws-chev","aria-hidden":"true",children:twO?"\u25B4":"\u25BE"})]}):f.jsx("strong",{children:n.name}),')
rep('onClick:twDel,children:"Delete"})]})}',
    'onClick:twDel,children:"Delete"}),twM&&twO&&f.jsx("div",{className:"tws-slot tws-teamslot","data-slot":"person","data-staff":n.id},"tws-p-"+n.id)]})}')

# 5. Unnecessary hints
rep(',n.kind==="swap"&&f.jsx("div",{className:"tiny muted",children:"A manager has to approve it. You stay on the shift until they do."})', '', required=False)
rep(',!r.isOwner&&f.jsx("p",{className:"tiny muted",children:"Private: only you, the owner and payroll can see these."})', '', required=False)
rep(',!e.isOwner&&f.jsx("p",{className:"tiny muted",style:{margin:0},children:"Only the owner can open these once uploaded."})', '', required=False)
rep(',f.jsx("p",{className:"tiny muted",style:{margin:0},children:"Only owners can open these. Keep them for 2 years after someone leaves."})', '', required=False)
rep('T==="left"&&f.jsx("p",{className:"tiny muted",children:"Login removed. Name, past shifts and payslips are kept for payroll records."}),', '', required=False)
rep(',f.jsx("p",{className:"tiny muted",style:{margin:"6px 0 0"},children:"Passport, share code check or permit. Optional now; needed before their first shift."})', '', required=False)
rep(',f.jsx("p",{className:"small muted",children:"If it doesn’t arrive, ask them to check junk mail, then use “Resend login” on their name in Team."})', '', required=False)
rep('f.jsx("span",{className:"small muted",children:"Emails enquiries to you and rota, payslip and login emails to staff."})', 'f.jsx("span",{})', required=False)
rep('f.jsx("p",{className:"tiny muted",children:"The password stays on the server and can’t be read back."}),', '', required=False)

rep(',children:"When a manager publishes the rota, your next shift shows here."})', '})', required=False)
rep(',children:"Nothing is on the events calendar for the next seven days."})', '})', required=False)
rep(',children:"Rota changes, payslips and replies to your requests show up here."})', '})', required=False)
rep(',children:"You’ll get one when the rota is published, a payslip is added or a request is answered."})', '})', required=False)
open(out, 'w').write(s)
print('ok; skipped:', skipped)
