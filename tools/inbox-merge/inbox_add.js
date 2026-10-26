
/* tws-inbox-merge-v1 */
var __twsIbxPtr=["New private hire enquiry","Time off request","Shift swap request","Problem with a shift"];
function __twsIbxIsPtr(t,x){return !!(t&&t.isManager&&x&&__twsIbxPtr.indexOf(x.title)>=0)}
function __twsIbxOpenEnq(x){return !x.status||x.status==="new"||x.status==="replied"}
function __twsIbxMs(v){var d=Nl(v);return d?+d||0:0}
function __twsUseIC(t,p,T){
  var q=He(function(){return t.isManager?Ze(Fe(Ee,"enquiries"),ot("status","in",["new","replied"]),Vr(50)):null},[t.isManager]);
  var u=(p.docs||[]).filter(function(x){return !x.dismissed&&!__twsIbxIsPtr(t,x)}).length;
  return (t.isManager?(T||0)+(q.docs?q.docs.length:0):0)+u;
}
function __twsGo({to:n}){
  var t=ht();
  G.useEffect(function(){
    var k=n==="enquiries"&&!t.isManager?"":n;
    window.location.replace(window.location.pathname+window.location.search+"#/inbox"+(k?"?f="+k:""));
  },[n,t.isManager]);
  return f.jsx(yn,{});
}
function __twsIbxSetF(k){window.location.replace(window.location.pathname+window.location.search+"#/inbox"+(k&&k!=="all"?"?f="+k:""))}
function __twsIbxEnqWhat(n){
  return [n.date?mt(n.date,{weekday:"short",day:"numeric",month:"short",year:"numeric"}):"No date given",n.guests?n.guests+(n.guests===1?" guest":" guests"):"",n.space||""].filter(Boolean).join(" \u00B7 ");
}
function __twsIbxEnqKind(n){
  return f.jsxs("span",{className:"kind k-enquiry",children:[f.jsx(gr,{name:"mail"}),"Enquiry"+(n.occasion?" \u00B7 "+n.occasion:"")]});
}
function __twsIbxEnq({e:n}){
  var t=ht(),toast=en(),[o,setO]=G.useState(!1),[b,setB]=G.useState(!1);
  async function tick(){
    setB(!0);
    try{await fk(_t(Ee,"enquiries",n.id),{status:"closed",handledBy:t.user.uid,handledAt:Ji()});toast("Marked as dealt with. It\u2019s in Done.")}
    catch(x){toast(nt(x),"warn");setB(!1)}
  }
  async function del(){
    if(!window.confirm("Delete the enquiry from "+n.name+"? This can\u2019t be undone."))return;
    try{await Yo(_t(Ee,"enquiries",n.id))}catch(x){toast(nt(x),"warn")}
  }
  var subj=encodeURIComponent("Your "+(n.occasion||"private hire")+" enquiry - "+nf),tel=n.phone?String(n.phone).replace(/\s/g,""):"",did="ibx-enq-"+n.id;
  return f.jsxs("li",{className:"req ibx-card k-enquiry","data-testid":"ibx-enquiry",children:[
    f.jsxs("div",{className:"req-top",children:[__twsIbxEnqKind(n),f.jsx("span",{className:"req-when",children:Jy(n.createdAt)})]}),
    f.jsx("div",{className:"req-who",children:n.name}),
    f.jsx("div",{className:"req-what",children:__twsIbxEnqWhat(n)}),
    n.message&&!o&&f.jsx("p",{className:"ibx-msg",children:n.message}),
    o&&f.jsxs("dl",{className:"kv ibx-kv",id:did,children:[
      f.jsx("dt",{children:"Occasion"}),f.jsx("dd",{children:n.occasion||"\u2014"}),
      n.space&&f.jsxs(f.Fragment,{children:[f.jsx("dt",{children:"Space"}),f.jsx("dd",{children:n.space})]}),
      f.jsx("dt",{children:"Date"}),f.jsx("dd",{children:n.date?mt(n.date,{weekday:"long",day:"numeric",month:"long",year:"numeric"}):"Not given"}),
      f.jsx("dt",{children:"Guests"}),f.jsx("dd",{children:n.guests||"\u2014"}),
      f.jsx("dt",{children:"Email"}),f.jsx("dd",{children:n.email?f.jsx("a",{href:"mailto:"+n.email+"?subject="+subj,children:n.email}):"\u2014"}),
      f.jsx("dt",{children:"Phone"}),f.jsx("dd",{children:tel?f.jsx("a",{href:"tel:"+tel,children:n.phone}):"\u2014"}),
      f.jsx("dt",{children:"Message"}),f.jsx("dd",{className:"ibx-full",children:n.message||"\u2014"}),
      f.jsx("dt",{children:"Sent"}),f.jsx("dd",{children:Rc(n.createdAt)}),
      n.staffNote&&f.jsxs(f.Fragment,{children:[f.jsx("dt",{children:"Team note"}),f.jsx("dd",{children:n.staffNote})]})
    ]}),
    o&&n.emailError&&f.jsxs("div",{className:"warn tiny",style:{marginTop:6},children:["Email alert failed: ",n.emailError]}),
    f.jsxs("div",{className:"ibx-actions",children:[
      n.email&&f.jsxs("a",{className:"btn secondary sm",href:"mailto:"+n.email+"?subject="+subj,"aria-label":"Email "+n.name,children:[f.jsx(gr,{name:"mail"}),"Email"]}),
      tel&&f.jsx("a",{className:"btn secondary sm",href:"tel:"+tel,"aria-label":"Call "+n.name,children:"Call"}),
      f.jsx("button",{type:"button",className:"btn ghost sm","aria-expanded":o,"aria-controls":did,onClick:function(){setO(!o)},children:o?"Less":"More"}),
      o&&f.jsx("button",{type:"button",className:"btn ghost sm",onClick:del,children:"Delete"}),
      f.jsxs("button",{type:"button",className:"btn sm ibx-tick",disabled:b,"data-testid":"ibx-tick","aria-label":"Mark "+n.name+"\u2019s enquiry as dealt with",onClick:tick,children:[f.jsx(ef,{name:"check",size:18}),"Done"]})
    ]})
  ]});
}
function __twsIbxDone({items:a}){
  var t=ht(),toast=en(),[m,setM]=G.useState(!1);
  async function undo(n){
    try{await fk(_t(Ee,"enquiries",n.id),{status:"new",handledBy:t.user.uid,handledAt:Ji()});toast("Moved back to the Inbox.")}catch(x){toast(nt(x),"warn")}
  }
  var list=m?a:a.slice(0,8);
  return f.jsxs("details",{className:"ibx-done","data-testid":"ibx-done",children:[
    f.jsxs("summary",{children:[f.jsx("span",{children:"Done"}),f.jsx("span",{className:"ibx-n",children:a.length})]}),
    a.length===0?f.jsx("p",{className:"muted ibx-pad",children:"Nothing here yet."}):f.jsxs(f.Fragment,{children:[
      f.jsx("ul",{className:"reqs compact",children:list.map(function(x){
        return x.__enq?f.jsxs("li",{className:"req compact k-enquiry","data-testid":"ibx-done-enquiry",children:[
          f.jsxs("div",{className:"req-top",children:[__twsIbxEnqKind(x),f.jsx("span",{className:"req-when",children:Jy(x.handledAt||x.createdAt)})]}),
          f.jsx("div",{className:"req-who",children:x.name}),
          f.jsx("div",{className:"req-what",children:__twsIbxEnqWhat(x)}),
          f.jsxs("div",{className:"ibx-actions",children:[
            x.email&&f.jsx("a",{className:"btn ghost sm",href:"mailto:"+x.email+"?subject="+encodeURIComponent("Your "+(x.occasion||"private hire")+" enquiry - "+nf),children:"Email"}),
            f.jsx("button",{type:"button",className:"btn ghost sm","aria-label":"Move "+x.name+"\u2019s enquiry back to the Inbox",onClick:function(){undo(x)},children:"Move back"})
          ]})
        ]},"e"+x.id):f.jsxs("li",{className:"req compact k-"+x.type,"data-testid":"ibx-done-request",children:[
          f.jsxs("div",{className:"req-top",children:[f.jsx(tv,{x:x}),f.jsx("span",{className:"pill "+$k(x),children:Zh(x)})]}),
          f.jsx("div",{className:"req-who",children:x.staffName}),
          f.jsx("div",{className:"req-what",children:ev(x)}),
          (x.decidedByName||x.managerNote)&&f.jsx("p",{className:"req-meta muted",children:[x.decidedByName?"By "+x.decidedByName:"",x.managerNote?"\u201C"+x.managerNote+"\u201D":""].filter(Boolean).join(" \u00B7 ")})
        ]},x.kind+x.id)
      })}),
      a.length>list.length&&f.jsx("button",{type:"button",className:"btn ghost sm",onClick:function(){setM(!0)},children:"Show "+(a.length-list.length)+" more"})
    ]})
  ]});
}
function __twsIbxUpd({q:t2,me:n,few:few}){
  var toast=en(),[h,sH]=G.useState([]);
  var V=t2.docs?t2.docs.filter(function(a){return !a.dismissed&&!h.includes(a.id)&&!__twsIbxIsPtr(n,a)}):null;
  async function readAll(){
    var a=(V||[]).filter(function(d){return !d.read});if(!a.length)return;
    var l=IT(Ee);a.forEach(function(d){l.update(_t(Ee,"notifications",d.id),{read:!0})});
    try{await l.commit()}catch(d){toast(nt(d),"warn")}
  }
  function open(a){
    if(!a.read){var l=IT(Ee);l.update(_t(Ee,"notifications",a.id),{read:!0});l.commit().catch(function(){})}
    a.link&&a.link.startsWith("#/")&&(window.location.hash=a.link);
  }
  async function rm(a,ev2){
    var li=ev2&&ev2.currentTarget&&ev2.currentTarget.closest("li"),nx=li&&(li.nextElementSibling||li.previousElementSibling),ft=nx&&nx.querySelector(".up-remove");
    sH(function(x){return x.concat(a.id)});
    requestAnimationFrame(function(){var m=ft||document.getElementById("main");m&&m.focus()});
    try{await Yo(_t(Ee,"notifications",a.id))}
    catch(d){try{await IT(Ee).update(_t(Ee,"notifications",a.id),{read:!0}).commit()}catch(x){sH(function(y){return y.filter(function(z){return z!==a.id})});toast(nt(x),"warn")}}
  }
  async function clearAll(){
    var a=V||[];if(!a.length)return;
    if(!window.confirm(a.length===1?"Clear this update? This can\u2019t be undone.":"Clear all "+a.length+" updates? This can\u2019t be undone."))return;
    var ids=a.map(function(q){return q.id});sH(function(y){return y.concat(ids)});
    try{var b=IT(Ee);a.forEach(function(q){b.delete(_t(Ee,"notifications",q.id))});await b.commit()}
    catch(d){sH(function(y){return y.filter(function(z){return !ids.includes(z)})});toast(nt(d),"warn")}
  }
  var L=V&&few?V.slice(0,few):V;
  return f.jsxs("div",{className:"ibx-upd",children:[
    !few&&V&&V.length>0&&f.jsxs("div",{className:"ibx-tools",children:[V.some(function(a){return !a.read})&&f.jsx("button",{type:"button",className:"btn ghost sm",onClick:readAll,children:"Mark all as read"}),f.jsx("button",{type:"button",className:"btn ghost sm","data-testid":"notif-clear-all",onClick:clearAll,children:"Clear all"})]}),
    f.jsx(xn,{error:t2.error}),
    V?V.length===0?f.jsx("p",{className:"muted ibx-pad",children:"No updates."}):f.jsx("ol",{className:"updates full",children:L.map(function(a){return f.jsxs("li",{className:a.read?"":"unread","data-testid":"ibx-update",children:[
      f.jsxs("button",{type:"button",onClick:function(){open(a)},children:[f.jsx("span",{className:"up-dot","aria-hidden":"true"}),f.jsxs("span",{className:"up-body",children:[f.jsxs("span",{className:"up-title",children:[a.title,!a.read&&f.jsx("span",{className:"sr",children:" (new)"})]}),a.body&&f.jsx("span",{className:"up-text",children:a.body})]}),f.jsx("span",{className:"up-when",children:Rc(a.createdAt)})]}),
      f.jsx("button",{type:"button",className:"up-remove",title:"Clear","aria-label":"Clear update: "+(a.title||""),"data-testid":"notif-remove",onClick:function(e2){rm(a,e2)},children:f.jsx(gr,{name:"close"})})
    ]},a.id)})}):f.jsx(yn,{label:"Loading updates"}),
    few&&V&&V.length>few&&f.jsx("button",{type:"button",className:"btn ghost sm",onClick:function(){__twsIbxSetF("updates")},children:"See all "+V.length+" updates"})
  ]});
}
function __twsIbxSec({id:id,title:title,count:c,children:ch}){
  return f.jsxs("section",{className:"ibx-sec","aria-labelledby":id,children:[f.jsxs("h2",{id:id,className:"ibx-h",children:[title,c?f.jsx("span",{className:"ibx-n",children:c}):null]}),ch]});
}
function __twsInbox(){
  var t=ht(),R=wO(),want=R.params&&R.params.get("f")||"all",isM=!!t.isManager,isPay=t.role==="payroll";
  var to=He(function(){return isM?Ze(Fe(Ee,"timeOff"),An("from","desc")):null},[isM]);
  var rq=He(function(){return isM?Ze(Fe(Ee,"requests"),An("createdAt","desc")):null},[isM]);
  var eq=He(function(){return isM?Ze(Fe(Ee,"enquiries"),An("createdAt","desc"),Vr(200)):null},[isM]);
  var nq=He(function(){return Ze(Fe(Ee,"notifications"),ot("uid","==",t.user.uid),...(isM?[]:[ot("managerOnly","==",!1)]),An("createdAt","desc"),Vr(50))},[t.user.uid,isM]);
  G.useEffect(function(){
    if(!isM||!nq.docs)return;
    var a=nq.docs.filter(function(x){return !x.read&&__twsIbxIsPtr(t,x)});if(!a.length)return;
    var b=IT(Ee);a.forEach(function(x){b.update(_t(Ee,"notifications",x.id),{read:!0})});b.commit().catch(function(){});
  },[isM,nq.docs]);
  var reqs=isM&&to.docs&&rq.docs?[].concat(to.docs.map(function(r){return Object.assign({},r,{kind:"timeOff",type:"holiday"})}),rq.docs.map(function(r){return Object.assign({},r,{type:r.kind,kind:"request"})})):null;
  var pend=(reqs||[]).filter(function(x){return x.status==="pending"});
  var decided=(reqs||[]).filter(function(x){return ["approved","declined","resolved"].includes(x.status)});
  var enqs=eq.docs||[],openE=enqs.filter(__twsIbxOpenEnq),doneE=enqs.filter(function(x){return !__twsIbxOpenEnq(x)}).map(function(x){return Object.assign({},x,{__enq:!0})});
  var unread=(nq.docs||[]).filter(function(x){return !x.read&&!x.dismissed&&!__twsIbxIsPtr(t,x)}).length;
  var chips=isPay?[]:isM?[["all","All",pend.length+openE.length+unread],["requests","Requests",pend.length],["enquiries","Enquiries",openE.length],["updates","Updates",unread]]:[["all","All",unread],["requests","Your requests",0],["updates","Updates",unread]];
  var fl=isPay?"updates":chips.some(function(c){return c[0]===want})?want:"all";
  var showR=isM&&(fl==="all"||fl==="requests"),showE=isM&&(fl==="all"||fl==="enquiries");
  var todo=[].concat(showR?pend.map(function(x){return {k:"r",x:x,ms:__twsIbxMs(x.createdAt)}}):[],showE?openE.map(function(x){return {k:"e",x:x,ms:__twsIbxMs(x.createdAt)}}):[]).sort(function(a,b){return b.ms-a.ms});
  var done=[].concat(showR?decided:[],showE?doneE:[]).sort(function(a,b){return __twsIbxMs(b.__enq?b.handledAt||b.createdAt:b.decidedAt||b.createdAt)-__twsIbxMs(a.__enq?a.handledAt||a.createdAt:a.decidedAt||a.createdAt)}).slice(0,60);
  var loading=isM&&((showR&&!reqs)||(showE&&!eq.docs)),err=(showR&&(to.error||rq.error))||(showE&&eq.error)||null;
  var empty=fl==="enquiries"?"No enquiries waiting.":fl==="requests"?"Nothing waiting for a decision.":"All caught up. Nothing is waiting for you.";
  return f.jsx("div",{className:"inbox",children:f.jsxs("div",{className:"inbox-main ibx","data-testid":"ibx",children:[
    chips.length>0&&f.jsx("div",{className:"ibx-chips",role:"group","aria-label":"Show",children:chips.map(function(c){return f.jsxs("button",{type:"button",className:"ibx-chip"+(fl===c[0]?" on":""),"aria-pressed":fl===c[0],"data-testid":"ibx-chip-"+c[0],onClick:function(){__twsIbxSetF(c[0])},children:[c[1],c[2]>0&&f.jsxs("span",{className:"ibx-n",children:[c[2],f.jsx("span",{className:"sr",children:" new"})]})]},c[0])})}),
    isM&&fl!=="updates"&&f.jsxs(__twsIbxSec,{id:"ibx-todo",title:fl==="enquiries"?"Enquiries":fl==="requests"?"Waiting for a decision":"Needs doing",children:[
      f.jsx(xn,{error:err}),
      loading?f.jsx(yn,{}):todo.length===0?f.jsxs("div",{className:"allclear",children:[f.jsx("span",{className:"ic",children:f.jsx(ef,{name:"check"})}),f.jsx("span",{children:empty})]}):f.jsx("ul",{className:"reqs",children:todo.map(function(i){return i.k==="r"?f.jsx(a2,{x:i.x},i.x.kind+i.x.id):f.jsx(__twsIbxEnq,{e:i.x},"e"+i.x.id)})})
    ]}),
    !isPay&&(fl==="all"||fl==="requests")&&f.jsx(zk,{always:!isM}),
    (fl==="all"||fl==="updates")&&f.jsx(__twsIbxSec,{id:"ibx-upd",title:"Updates",children:f.jsx(__twsIbxUpd,{q:nq,me:t,few:fl==="all"?5:0})}),
    isM&&fl!=="updates"&&!loading&&f.jsx(__twsIbxDone,{items:done})
  ]})});
}
;(function(){try{if(document.getElementById("tws-ibx-css"))return;var s=document.createElement("style");s.id="tws-ibx-css";s.textContent=".ibx-chips{display:flex;flex-wrap:wrap;gap:8px;margin:2px 0 18px}.ibx-chip{display:inline-flex;align-items:center;gap:8px;min-height:40px;padding:6px 14px;border:1px solid var(--line-2);border-radius:999px;background:var(--paper);color:var(--ink);font:inherit;font-size:.9rem;font-weight:550;cursor:pointer}.ibx-chip:hover{border-color:var(--green-3)}.ibx-chip.on{background:var(--green);border-color:var(--green);color:var(--cream)}.ibx-chip:focus-visible{outline:none;box-shadow:var(--focus)}.ibx-n{display:inline-grid;place-items:center;min-width:22px;height:22px;padding:0 7px;border-radius:999px;background:var(--gold-tint);color:#4a3510;font-size:.75rem;font-weight:700;line-height:1}.ibx-chip.on .ibx-n{background:var(--cream);color:var(--green)}.ibx-sec{margin:0 0 24px}.ibx-h{display:flex;align-items:center;gap:8px;margin:0 0 10px;font-size:.95rem;font-weight:650;letter-spacing:.01em}.ibx .reqs{margin-bottom:0}.ibx-card .req-what{color:var(--muted)}.ibx-msg{margin:8px 0 0;padding:7px 10px;border-radius:8px;background:var(--bg);font-size:.9rem;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}.ibx-kv{margin:10px 0 0}.ibx-kv dd{overflow-wrap:anywhere}.ibx-full{white-space:pre-wrap;line-height:1.5}.ibx-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px}.ibx-actions .btn svg{width:16px;height:16px;margin-right:6px;vertical-align:-3px}.ibx-actions .btn{display:inline-flex;align-items:center}.ibx-tick{margin-left:auto;gap:6px}.ibx-tick svg{margin-right:0}.kind.k-enquiry{color:var(--brass)}.kind.k-enquiry svg{width:18px;height:18px}.ibx-tools{display:flex;justify-content:flex-end;gap:8px;margin:-4px 0 6px}.ibx-pad{margin:4px 2px 0}.ibx-done{margin:6px 0 24px;border-top:1px solid var(--line)}.ibx-done>summary{display:flex;align-items:center;gap:8px;min-height:48px;padding:6px 2px;font-weight:650;font-size:.95rem;cursor:pointer;list-style:none}.ibx-done>summary::-webkit-details-marker{display:none}.ibx-done>summary:before{content:'';width:8px;height:8px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(-45deg);margin:0 6px 0 4px;transition:transform .15s}.ibx-done[open]>summary:before{transform:rotate(45deg)}.ibx-done>summary .ibx-n{background:var(--sand);color:var(--muted)}.ibx-done>summary:focus-visible{outline:none;box-shadow:var(--focus);border-radius:8px}.ibx-done .req-meta{margin:4px 0 0;font-size:.85rem}.ibx-done .ibx-actions{margin-top:6px}@media(max-width:560px){.ibx-chip{padding:6px 12px}.ibx-tick{margin-left:0}.ibx-actions .btn{flex:1 1 auto;justify-content:center}}";(document.head||document.documentElement).appendChild(s)}catch(e){}})();
