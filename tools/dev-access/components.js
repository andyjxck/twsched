function __twsFmt(ms){try{return new Intl.DateTimeFormat("en-GB",{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}).format(new Date(ms))}catch{return""}}
function __twsTs(v){return v&&typeof v.toMillis=="function"?v.toMillis():null}
function __twsErr(x){return x&&x.message?x.message.replace(/^[^:]*:\s*/,""):"That didn’t work."}
function TwsDevGate({user:n,profile:i}){const[st,setSt]=G.useState({k:"loading"}),[now,setNow]=G.useState(Date.now());
G.useEffect(()=>{let un=null,dead=!1;n.getIdTokenResult(!0).then(r=>{if(dead)return;const g=r.claims.devGrant;if(!g){setSt({k:"red"});return}
un=xc(_t(Ee,"devAccess",g),d=>{const x=d.exists()?d.data():null,until=x&&__twsTs(x.expiresAt);setSt(x&&x.status==="active"&&x.devUid===n.uid&&until&&until>Date.now()?{k:"granted",until,by:x.grantedByName||"an owner"}:{k:"red"})},()=>setSt({k:"red"}))}).catch(()=>setSt({k:"red"}));return()=>{dead=!0;un&&un()}},[n]);
G.useEffect(()=>{if(st.k!=="granted")return;const t=setTimeout(()=>setNow(Date.now()),Math.max(1e3,st.until-Date.now()+500));return()=>clearTimeout(t)},[st]);
if(st.k==="loading")return f.jsx("div",{className:"login",children:f.jsx("p",{className:"muted",children:"Loading…"})});
const granted=st.k==="granted"&&st.until>now,base={user:n,profile:i||{id:n.uid},name:i&&i.name||n.displayName||n.email,isPrimaryOwner:!1};
const p=granted?{...base,role:"owner",isManager:!0,isOwner:!0,isPayroll:!1,canPayroll:!0,canSeeHours:!0,devAccess:!0,devUntil:st.until}:{...base,role:"developer",isManager:!1,isOwner:!1,isPayroll:!1,canPayroll:!1,canSeeHours:!1,redacted:!0};
window.__twsCtx=p;
return f.jsxs(G.Fragment,{children:[granted&&f.jsxs("div",{"data-testid":"dev-access-banner",style:{position:"sticky",top:0,zIndex:50,background:"#7a1f1f",color:"#fff",padding:"8px 14px",fontSize:14,textAlign:"center"},children:["Developer access from ",st.by,", until ",__twsFmt(st.until),". Everything you see and change is real staff data."]}),
f.jsx(Kk.Provider,{value:p,children:f.jsx(Dm,{children:f.jsx(O2,{})})},granted?"g":"r")]})}
function __twsBar(w,h){return f.jsx("span",{"aria-hidden":"true",style:{display:"inline-block",width:w,height:h||14,background:"#000",borderRadius:2,verticalAlign:"middle"}})}
function TwsRedacted({path:n}){const[code,setCode]=G.useState(""),[busy,setBusy]=G.useState(!1),[msg,setMsg]=G.useState("");
const go=async e=>{e.preventDefault();setBusy(!0);setMsg("");try{await mn("redeemDevCode",{code});await Mr.currentUser.getIdToken(!0);window.location.reload()}catch(x){setMsg(__twsErr(x));setBusy(!1)}};
const rows=[["38%","22%","16%"],["30%","28%","12%"],["44%","18%","20%"],["26%","30%","14%"],["40%","20%","18%"],["34%","24%","10%"],["28%","26%","22%"]];
return f.jsxs("div",{className:"stack","data-testid":"redacted-page",children:[
f.jsxs("div",{className:"card stack",children:[f.jsx("h3",{children:"Staff information is blacked out"}),
f.jsx("p",{className:"small",children:"This is the developer login, so names, shifts, contact details, pay and documents are hidden. To see them, an owner opens Team, taps the developer and taps Give access. You get a code by email, and access lasts 24 hours."}),
f.jsxs("form",{onSubmit:go,className:"row",style:{gap:8,flexWrap:"wrap"},children:[f.jsx("input",{inputMode:"numeric",autoComplete:"one-time-code",placeholder:"8-digit code",value:code,maxLength:8,onChange:e=>setCode(e.target.value.replace(/\D/g,"")),style:{maxWidth:180},"aria-label":"Access code"}),
f.jsx("button",{className:"btn",disabled:busy||code.length!==8,children:busy?"Checking…":"Enter code"})]}),msg&&f.jsx("p",{className:"small",style:{color:"#c0392b"},children:msg})]}),
f.jsx("div",{className:"card stack",children:rows.map((r,k)=>f.jsxs("div",{className:"row",style:{gap:14,padding:"6px 0",borderBottom:"1px solid rgba(127,127,127,.15)"},children:[__twsBar(28,28),__twsBar(r[0]),__twsBar(r[1]),__twsBar(r[2])]},k))})]})}
function TwsDevAccess({dev:n}){const[busy,setBusy]=G.useState(!1),[msg,setMsg]=G.useState(""),[open,setOpen]=G.useState(!1);
const{docs:L}=He(()=>Ze(Fe(Ee,"devAccess"),ot("devUid","==",n.id)),[n.id]);
const list=[...(L||[])].sort((a,b)=>(__twsTs(b.createdAt)||0)-(__twsTs(a.createdAt)||0));
const act=list.find(g=>g.status==="active"&&__twsTs(g.expiresAt)>Date.now()),pend=list.find(g=>g.status==="pending"&&__twsTs(g.codeExpiresAt)>Date.now());
const call=async(name,data,ok)=>{setBusy(!0);setMsg("");try{await mn(name,data);setMsg(ok)}catch(x){setMsg(__twsErr(x))}setBusy(!1)};
const label=g=>{const s=g.status,ex=__twsTs(g.expiresAt);return s==="active"?(ex>Date.now()?"Active until "+__twsFmt(ex):"Expired "+__twsFmt(ex)):s==="pending"?"Code sent, not used yet":s==="ended"?"Ended early by "+(g.endedByName||"an owner")+(g.endedAt?" "+__twsFmt(__twsTs(g.endedAt)):""):s==="locked"?"Code locked after wrong tries":s==="code-expired"?"Code not used in time":s==="superseded"?"Replaced by a newer code":s==="failed"?"Email failed, nothing given":s==="expired"?"Expired":s};
return f.jsxs("div",{"data-testid":"dev-access",className:"stack",style:{marginTop:8,width:"100%"},onClick:e=>e.stopPropagation(),children:[
f.jsxs("div",{className:"row",style:{gap:8,flexWrap:"wrap",alignItems:"center"},children:[
act?f.jsxs(G.Fragment,{children:[f.jsxs("span",{className:"small",children:["Has access until ",__twsFmt(__twsTs(act.expiresAt))]}),f.jsx("button",{className:"btn secondary",disabled:busy,onClick:()=>call("endDevAccess",{grantId:act.id},"Access ended."),children:"End access"})]})
:f.jsxs(G.Fragment,{children:[f.jsx("button",{className:"btn","data-testid":"give-access",disabled:busy,onClick:()=>call("grantDevAccess",{uid:n.id},"Code emailed to the developer. It works once, within an hour, and gives 24 hours of access."),children:"Give access"}),
pend&&f.jsx("button",{className:"btn secondary",disabled:busy,onClick:()=>call("endDevAccess",{grantId:pend.id},"Code cancelled."),children:"Cancel code"})]}),
list.length>0&&f.jsx("button",{className:"btn secondary",onClick:()=>setOpen(!open),children:open?"Hide access log":"Access log"})]}),
msg&&f.jsx("p",{className:"small",children:msg}),
open&&f.jsx("div",{className:"stack",children:list.slice(0,20).map(g=>f.jsxs("p",{className:"small",children:[f.jsx("strong",{children:label(g)}),". Given by ",g.grantedByName||"an owner",g.createdAt?" "+__twsFmt(__twsTs(g.createdAt)):"",g.usedAt?". Code used "+__twsFmt(__twsTs(g.usedAt)):"",g.wrongAttempts?". Wrong tries: "+g.wrongAttempts:""]},g.id))})]})}
