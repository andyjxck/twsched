// Right to Work check picker. Replaces the old multi-file picker `rv` in the main bundle. Same props as before:
// { files, setFiles, disabled }. It keeps the check being filled in to itself and only hands the caller a list
// of files once the check is complete (every required file, the date and the owner's confirmation), so the
// callers' "Upload N files" button only shows then. Each file handed over carries checkId, route, slot,
// checkedOn and declared, which E2 saves with it.
function rv({files:n,setFiles:e,disabled:t}){const i=en(),today=__twsRtwToday(),[st,setSt]=G.useState(()=>__twsRtwBlank()),emitted=G.useRef(!1),refs=G.useRef({}),R=__twsRtwRoutes.find(x=>x.id===st.route)||__twsRtwRoutes[0];
G.useEffect(()=>{__twsRtwCss()},[]);
G.useEffect(()=>{n.length===0&&emitted.current&&(emitted.current=!1,setSt(__twsRtwBlank()))},[n]);
G.useEffect(()=>{const items=__twsRtwItems(st,today);items.length?(emitted.current=!0,e(items)):emitted.current&&(emitted.current=!1,e([]))},[st]);
function setDoc(s,patch){setSt(o=>({...o,docs:o.docs.map((d,k)=>k===s?{...d,...patch}:d)}))}
function pick(s,ev){const g=(ev.target.files||[])[0];ev.target.value="";if(!g)return;const bad=_2(g);if(bad){i(bad,"warn");return}setDoc(s,{file:g})}
const missing=__twsRtwMissing(st,today);
return f.jsxs("div",{className:"rtw-check","data-testid":"rtw-check",children:[
f.jsx(Ve,{label:"Which documents?",children:f.jsx("select",{value:st.route,disabled:t,"data-testid":"rtw-route",onChange:ev=>{const v=ev.target.value;setSt(o=>({...__twsRtwBlank(v),date:o.date}))},children:__twsRtwRoutes.map(r=>f.jsx("option",{value:r.id,children:r.label},r.id))})}),
...R.slots.map((sl,s)=>{const d=st.docs[s],multi=sl.types.length>1,cur=d.docType&&sl.types.includes(d.docType)?d.docType:sl.types[0];return f.jsxs("div",{className:"rtw-slot","data-testid":`rtw-slot-${s+1}`,children:[
f.jsxs("div",{className:"rtw-slot-head",children:[f.jsx("strong",{children:R.slots.length>1?`${s+1}. ${sl.label}`:sl.label}),multi&&f.jsx("select",{"aria-label":`What is document ${s+1}?`,value:cur,disabled:t,"data-testid":`rtw-type-${s+1}`,onChange:ev=>setDoc(s,{docType:ev.target.value}),children:sl.types.map(k=>f.jsx("option",{value:k,children:y2(k)},k))})]}),
sl.note&&f.jsx("span",{className:"tiny muted",children:sl.note}),
d.file?f.jsxs("div",{className:"rtw-slot-file",children:[f.jsxs("span",{className:"fname","data-testid":`rtw-file-${s+1}`,children:[d.file.name," ",f.jsx("span",{className:"tiny muted",children:Hk(d.file.size)})]}),f.jsx("button",{type:"button",className:"btn ghost sm",disabled:t,"aria-label":`Remove ${d.file.name}`,onClick:()=>setDoc(s,{file:null}),children:"Remove"})]}):
f.jsxs("div",{className:"row",style:{gap:8,flexWrap:"wrap"},children:[f.jsx("button",{type:"button",className:"btn secondary sm",disabled:t,"data-testid":`rtw-upload-${s+1}`,onClick:()=>refs.current[`u${s}`]&&refs.current[`u${s}`].click(),children:"Upload scan or file"}),R.online?null:f.jsx("button",{type:"button",className:"btn secondary sm",disabled:t,"data-testid":`rtw-photo-${s+1}`,onClick:()=>refs.current[`c${s}`]&&refs.current[`c${s}`].click(),children:"Take photo"}),f.jsx("span",{className:"tiny muted",children:"PDF or photo, up to 10 MB"})]}),
f.jsx("input",{ref:el=>{refs.current[`u${s}`]=el},type:"file",accept:g2,hidden:!0,onChange:ev=>pick(s,ev),"data-testid":`rtw-input-${s+1}`}),
f.jsx("input",{ref:el=>{refs.current[`c${s}`]=el},type:"file",accept:"image/*",capture:"environment",hidden:!0,onChange:ev=>pick(s,ev),"data-testid":`rtw-camera-${s+1}`})]},`${R.id}-${s}`)}),
f.jsx(Ve,{label:"Date of the check",children:f.jsx("input",{type:"date",value:st.date,max:today,min:"2000-01-01",disabled:t,"data-testid":"rtw-date",onChange:ev=>{const v=ev.target.value;setSt(o=>({...o,date:v}))}})}),
f.jsxs("label",{className:"check",children:[f.jsx("input",{type:"checkbox",checked:st.declared,disabled:t,"data-testid":"rtw-declare",onChange:ev=>{const v=ev.target.checked;setSt(o=>({...o,declared:v}))}}),f.jsx("span",{children:R.online?"I did this online check myself on GOV.UK.":"I checked the original documents with the person there, in person or on a live video call, and these are copies of them."})]}),
f.jsx("span",{className:"tiny muted","data-testid":"rtw-needed",children:missing.length?`Still needed: ${missing.join(", ")}.`:"The app keeps these copies and the date. It doesn’t check the documents for you."})]})}
