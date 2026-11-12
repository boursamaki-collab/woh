(function(){
'use strict';
const CFG=window.APP_CONFIG||{};
const live=!!(CFG.SUPABASE_URL&&CFG.SUPABASE_ANON_KEY&&window.supabase);
const sb=live?window.supabase.createClient(CFG.SUPABASE_URL,CFG.SUPABASE_ANON_KEY):null;
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Math.round(n).toLocaleString('en-US');
const MON=['មករា','កុម្ភៈ','មីនា','មេសា','ឧសភា','មិថុនា','កក្កដា','សីហា','កញ្ញា','តុលា','វិច្ឆិកា','ធ្នូ'];
const dt=s=>{if(!s)return'';const[y,m,d]=s.split('-');return `${+d} ${MON[m-1]} ${y}`};
const today=()=>new Date(Date.now()+7*3600e3).toISOString().slice(0,10);
const addMonths=(s,n)=>{let[y,m,d]=s.split('-').map(Number);m+=n;y+=Math.floor((m-1)/12);m=((m-1)%12)+1;const last=new Date(Date.UTC(y,m,0)).getUTCDate();return `${y}-${String(m).padStart(2,'0')}-${String(Math.min(d,last)).padStart(2,'0')}`};
const ACTIVE='កំពុងខ្ចី',DONE='សងរួច';

/* ---------- data layer ---------- */
let S={members:[],savings:[],loans:[],repayments:[],expenses:[],settings:{}};
let db;
if(live){
 db={
  async all(t){let out=[],from=0;for(;;){const{data,error}=await sb.from(t).select('*').range(from,from+999);if(error)throw error;out=out.concat(data);if(data.length<1000)break;from+=1000}return out},
  async insert(t,rows){const{data,error}=await sb.from(t).insert(rows).select();if(error)throw error;return data},
  async update(t,col,val,patch){const{error}=await sb.from(t).update(patch).eq(col,val);if(error)throw error},
  async remove(t,col,val){const{error}=await sb.from(t).delete().eq(col,val);if(error)throw error},
  async upsert(t,rows){const{error}=await sb.from(t).upsert(rows);if(error)throw error}
 };
}else{
 const mem=JSON.parse(JSON.stringify(window.DEMO_DATA||{}));let seq=1e4;
 const rows=t=>t==='settings'?Object.entries(mem.settings).map(([key,value])=>({key,value})):mem[t];
 db={
  async all(t){return JSON.parse(JSON.stringify(rows(t)))},
  async insert(t,r){const out=r.map(x=>({id:++seq,...x}));out.forEach((x,i)=>{if(r[i].id)x.id=r[i].id});mem[t].push(...out);return out},
  async update(t,c,v,p){mem[t].forEach(x=>{if(x[c]==v)Object.assign(x,p)})},
  async remove(t,c,v){mem[t]=mem[t].filter(x=>x[c]!=v);if(t==='loans')mem.repayments=mem.repayments.filter(x=>x.loan_id!==v)},
  async upsert(t,r){r.forEach(x=>{mem.settings[x.key]=x.value})}
 };
}
async function load(){
 const names=['members','savings','loans','repayments','expenses','settings'];
 const res=await Promise.all(names.map(n=>db.all(n)));
 names.forEach((n,i)=>S[n]=res[i]);
 S.settings=Object.fromEntries(S.settings.map(r=>[r.key,+r.value]));
 S.members.sort((a,b)=>a.id.localeCompare(b.id));
 S.loans.sort((a,b)=>a.id.localeCompare(b.id));
}

/* ---------- calculations ---------- */
let C={};
function calc(){
 const P=S.settings.share_price||20000,RES=S.settings.reserve_rate??.15;
 const by={};S.members.forEach(m=>by[m.id]={...m,shares:0,paid:0,months:new Set()});
 let fees=0;const monthly={},mat={};
 S.savings.forEach(s=>{const m=by[s.member_id];if(!m)return;const sh=+s.shares,k=s.date.slice(0,7);
  m.shares+=sh;m.paid+=sh*P+ +s.fee;m.months.add(k);fees+=+s.fee;monthly[k]=(monthly[k]||0)+sh;(mat[m.id]=mat[m.id]||{})[k]=((mat[m.id]||{})[k]||0)+sh});
 const mem=Object.values(by);
 const shares=mem.reduce((a,m)=>a+m.shares,0),savings=shares*P;
 const interest=S.loans.reduce((a,l)=>a+ +l.interest,0),lent=S.loans.reduce((a,l)=>a+ +l.amount,0);
 const repaid=S.repayments.reduce((a,r)=>a+ +r.amount,0),expT=S.expenses.reduce((a,e)=>a+ +e.amount,0);
 const profit=fees+interest-expT,reserve=profit*RES,net=profit-reserve,pps=shares?net/shares:0;
 const rp={};S.repayments.forEach(r=>rp[r.loan_id]=(rp[r.loan_id]||0)+ +r.amount);
 const dates=[...S.savings.map(s=>s.date),...S.repayments.map(r=>r.date),...S.loans.map(l=>l.date)].sort();
 C={P,RES,by,mem,shares,savings,fees,interest,lent,repaid,expT,profit,reserve,net,pps,monthly,mat,rp,outstanding:lent-repaid,cash:savings+fees+interest-expT-lent+repaid,last:dates.pop()||today()};
}

/* ---------- ui helpers ---------- */
let isAdmin=false;
const kp=(l,v)=>`<div class="kpi"><span>${l}</span><b>${v}</b></div>`;
function toast(msg){const t=document.createElement('div');t.className='toast';t.textContent=msg;t.setAttribute('role','status');document.body.appendChild(t);setTimeout(()=>t.remove(),2800)}
function overlay(html,wide){
 const ov=document.createElement('div');ov.className='overlay';
 ov.innerHTML=`<form class="modal${wide?' wide':''}" novalidate>${html}</form>`;document.body.appendChild(ov);
 const form=ov.firstChild,close=()=>{ov.remove();document.removeEventListener('keydown',esc_)};
 const esc_=e=>{if(e.key==='Escape')close()};document.addEventListener('keydown',esc_);
 ov.addEventListener('mousedown',e=>{if(e.target===ov)close()});
 form.querySelectorAll('[data-x]').forEach(b=>b.onclick=close);
 const f=form.querySelector('input,select');if(f)f.focus();
 return{form,close};
}
const fieldHtml=f=>{
 const v=f.value??'';
 if(f.type==='select')return `<label>${f.label}<select name="${f.name}">${f.options.map(o=>`<option value="${esc(o[0])}"${String(o[0])===String(v)?' selected':''}>${esc(o[1])}</option>`).join('')}</select></label>`;
 return `<label>${f.label}<input name="${f.name}" type="${f.type||'text'}" value="${esc(v)}"${f.step?` step="${f.step}"`:''}${f.min!=null?` min="${f.min}"`:''}${f.type==='password'?' autocomplete="current-password"':''}></label>`;
};
function openForm(o){
 const{form,close}=overlay(`<h2>${o.title}</h2>${o.intro?`<p class="d" style="margin:0;color:var(--muted);font-size:13px">${o.intro}</p>`:''}${o.body||o.fields.map(fieldHtml).join('')}<div class="err" role="alert"></div><div class="row"><button type="button" class="btn" data-x>បោះបង់</button><button class="btn primary">${o.submit||'រក្សាទុក'}</button></div>`,o.wide);
 form.onsubmit=async e=>{
  e.preventDefault();const err=form.querySelector('.err'),btn=form.querySelector('.btn.primary');err.textContent='';
  const vals=Object.fromEntries(new FormData(form).entries());
  btn.disabled=true;
  try{await o.onSubmit(vals,form);close();await refresh();toast(o.done||'បានរក្សាទុក')}
  catch(ex){err.textContent=friendly(ex)}finally{btn.disabled=false}
 };
}
function confirmBox(msg,fn){
 const{form,close}=overlay(`<h2>បញ្ជាក់</h2><p style="margin:0">${msg}</p><div class="err" role="alert"></div><div class="row"><button type="button" class="btn" data-x>បោះបង់</button><button class="btn danger">លុប</button></div>`);
 form.onsubmit=async e=>{e.preventDefault();try{await fn();close();await refresh();toast('បានលុប')}catch(ex){form.querySelector('.err').textContent=friendly(ex)}};
}
const friendly=ex=>/foreign key|violates/i.test(ex.message||'')?'មិនអាចលុបបានទេ ព្រោះមានទិន្នន័យផ្សេងទៀតភ្ជាប់នឹងវា (ឧ. កំណត់ត្រាសន្សំ ឬកម្ចី)។':(ex.message||String(ex));
const req=(v,l)=>{if(!String(v??'').trim())throw new Error(`សូមបំពេញ៖ ${l}`)};
const numv=(v,l,min=0)=>{const n=Number(v);if(!isFinite(n)||v===''||n<=min)throw new Error(`${l} ត្រូវតែជាលេខធំជាង ${min}`);return n};
const memberOpts=()=>S.members.map(m=>[m.id,`${m.name} (${m.id})`]);
const delBtn=(act,id,label='លុប')=>`<button class="btn sm danger" data-act="${act}" data-id="${esc(id)}">${label}</button>`;
const nextId=(arr,prefix,w)=>prefix+String(Math.max(0,...arr.map(x=>parseInt(x.id.replace(/\D/g,''))||0))+1).padStart(w,'0');

/* ---------- renderers ---------- */
function renderOverview(){
 $('#asof').textContent='ទិន្នន័យដល់ '+dt(C.last);
 $('#h-cash').textContent=fmt(C.cash);$('#h-save').textContent=fmt(C.savings);$('#h-loan').textContent=fmt(C.outstanding);
 $('#h-mem').textContent=C.mem.length;$('#h-sh').textContent=fmt(C.shares);$('#sp').textContent=fmt(C.P);
 $('#kpis').innerHTML=kp('ថ្លៃរដ្ឋបាលប្រមូលបាន',fmt(C.fees))+kp('ការប្រាក់កម្ចី',fmt(C.interest))+kp('ចំណាយសរុប',fmt(C.expT))+kp('ចំណេញសុទ្ធសម្រាប់ចែក',fmt(C.net))+kp('ចំណេញក្នុងមួយហ៊ុន',C.pps.toFixed(1));
 const ks=Object.keys(C.monthly).sort();
 if(!ks.length){$('#chart').innerHTML='<div class="state">មិនទាន់មានកំណត់ត្រាសន្សំ</div>'}
 else{
  const W=560,H=240,L=36,B=28,T=14,max=Math.max(10,Math.ceil(Math.max(...ks.map(k=>C.monthly[k]))/10)*10),bw=(W-L)/ks.length;let g='';
  for(let i=0;i<=4;i++){const v=max/4*i,y=T+(H-T-B)*(1-i/4);g+=`<line x1="${L}" x2="${W}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="${L-6}" y="${y+4}" text-anchor="end">${v}</text>`}
  ks.forEach((k,i)=>{const v=C.monthly[k],h=(H-T-B)*v/max,x=L+i*bw+bw*.22,w=bw*.56,y=H-B-h;
   g+=`<rect class="b" data-k="${k}" x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="var(--chart1)" tabindex="0"/><text x="${x+w/2}" y="${y-5}" text-anchor="middle" style="fill:var(--ink2)">${v}</text><text x="${x+w/2}" y="${H-8}" text-anchor="middle">${MON[+k.slice(5)-1]}</text>`});
  $('#chart').innerHTML=`<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="ចំនួនហ៊ុនតាមខែ">${g}</svg>`;
  const tip=$('#tip');document.querySelectorAll('.b').forEach(r=>{const k=r.dataset.k;const show=()=>{tip.style.display='block';tip.textContent=`${MON[+k.slice(5)-1]} ${k.slice(0,4)} · ${C.monthly[k]} ហ៊ុន · ${fmt(C.monthly[k]*C.P)} រៀល`;const b=r.getBoundingClientRect();tip.style.left=Math.max(8,b.left-20)+'px';tip.style.top=(b.top-40)+'px'};r.onmouseenter=show;r.onfocus=show;r.onmouseleave=r.onblur=()=>tip.style.display='none'})
 }
 const topM=[...C.mem].sort((a,b)=>b.shares-a.shares).slice(0,5),mx=topM[0]?topM[0].shares||1:1;
 $('#rank').innerHTML=topM.map((m,i)=>`<div><span class="k">${i+1}</span><span class="nm">${esc(m.name)}</span><span class="v">${m.shares}</span><span class="bar"><i style="width:${m.shares/mx*100}%"></i></span></div>`).join('')||'<div class="state">មិនទាន់មានសមាជិក</div>';
}
function renderMembers(){
 const q=($('#q').value||'').trim().toLowerCase();
 $('#mrows').innerHTML=C.mem.filter(m=>!q||m.name.toLowerCase().includes(q)||m.id.toLowerCase().includes(q)).map(m=>`<tr><td><span class="av">${esc([...m.name][0]||'?')}</span>${esc(m.name)} <small style="color:var(--muted)">${esc(m.id)}</small></td><td>${dt(m.joined)}</td><td class="n">${m.months.size}</td><td class="n">${m.shares}</td><td class="n">${fmt(m.paid)}</td><td><div class="bar"><i style="width:${C.shares?Math.min(100,m.shares/C.shares*300):0}%"></i></div></td><td class="n">${fmt(m.shares*C.pps)}</td>${isAdmin?`<td style="white-space:nowrap"><button class="btn sm" data-act="member-edit" data-id="${esc(m.id)}">កែ</button> ${delBtn('member-del',m.id)}</td>`:''}</tr>`).join('')||`<tr><td colspan="8">រកមិនឃើញសមាជិក</td></tr>`;
}
function renderMonthly(){
 const yr=C.last.slice(0,4),keys=[...Array(12)].map((_,i)=>yr+'-'+String(i+1).padStart(2,'0'));
 const cmax=Math.max(1,...Object.values(C.mat).flatMap(o=>Object.values(o)));
 $('#mh').innerHTML='<tr><th>សមាជិក</th>'+MON.map(m=>`<th class="n">${m}</th>`).join('')+'<th class="n">ខែចូលរួម</th><th class="n">ហ៊ុនសរុប</th></tr>';
 $('#mb').innerHTML=C.mem.map(m=>`<tr><td>${esc(m.name)}</td>`+keys.map(k=>{const v=(C.mat[m.id]||{})[k];return v?`<td class="n c" style="background:color-mix(in srgb,var(--chart1) ${Math.round(12+v/cmax*58)}%,transparent)">${v}</td>`:'<td class="n c"></td>'}).join('')+`<td class="n">${m.months.size}</td><td class="n"><b>${m.shares}</b></td></tr>`).join('');
 $('#mf').innerHTML='<tr><td>ចំនួនអ្នកចូលរួម</td>'+keys.map(k=>{const n=C.mem.filter(m=>(C.mat[m.id]||{})[k]).length;return `<td class="n">${n||''}</td>`}).join('')+'<td></td><td></td></tr><tr><td>ហ៊ុនសរុបក្នុងខែ</td>'+keys.map(k=>`<td class="n">${C.monthly[k]||''}</td>`).join('')+`<td></td><td class="n">${C.shares}</td></tr>`;
}
function renderLedger(){
 const fm=$('#fm'),fo=$('#fmo'),cm=fm.value||'',co=fo.value||'';
 fm.innerHTML='<option value="">សមាជិកទាំងអស់</option>'+S.members.map(m=>`<option value="${esc(m.id)}"${m.id===cm?' selected':''}>${esc(m.name)}</option>`).join('');
 fo.innerHTML='<option value="">គ្រប់ខែ</option>'+Object.keys(C.monthly).sort().reverse().map(k=>`<option value="${k}"${k===co?' selected':''}>${MON[+k.slice(5)-1]} ${k.slice(0,4)}</option>`).join('');
 const nm=id=>(C.by[id]||{}).name||id;
 const rows=S.savings.filter(s=>(!cm||s.member_id===cm)&&(!co||s.date.startsWith(co))).sort((a,b)=>b.date.localeCompare(a.date)||String(b.id).localeCompare(String(a.id),'en',{numeric:true}));
 $('#lrows').innerHTML=rows.slice(0,400).map(s=>`<tr><td>${dt(s.date)}</td><td>${esc(nm(s.member_id))}</td><td class="n">${+s.shares}</td><td class="n">${fmt(s.shares*C.P)}</td><td class="n">${fmt(s.fee)}</td><td class="n">${fmt(s.shares*C.P+ +s.fee)}</td>${isAdmin?`<td>${delBtn('save-del',s.id)}</td>`:''}</tr>`).join('')||'<tr><td colspan="7">មិនទាន់មានកំណត់ត្រា</td></tr>';
}
function renderLoans(){
 const act=S.loans.filter(l=>l.status===ACTIVE).length;
 $('#lkpis').innerHTML=kp('កម្ចីសកម្ម',act)+kp('ប្រាក់ខ្ចីសរុប',fmt(C.lent))+kp('បានសងប្រាក់ដើម',fmt(C.repaid))+kp('នៅសល់',fmt(C.outstanding))+kp('ការប្រាក់ត្រូវប្រមូល',fmt(C.interest));
 $('#lcards').innerHTML=S.loans.map(l=>{const name=(C.by[l.member_id]||{}).name||l.member_id,r=C.rp[l.id]||0,p=Math.min(100,r/l.amount*100),paid=l.status!==ACTIVE;
  const hist=S.repayments.filter(x=>x.loan_id===l.id).sort((a,b)=>a.date.localeCompare(b.date));
  return `<div class="card"><h3><span>${esc(name)}</span><span class="pill ${paid?'ok':'on'}">${esc(l.status)}</span></h3><dl><dt>លេខកម្ចី</dt><dd>${esc(l.id)}</dd><dt>ខ្ចីថ្ងៃ</dt><dd>${dt(l.date)}</dd><dt>ត្រូវសង</dt><dd>${dt(l.due)}</dd><dt>ប្រាក់ខ្ចី</dt><dd>${fmt(l.amount)}</dd><dt>ការប្រាក់ (${l.months} ខែ)</dt><dd>${fmt(l.interest)}</dd><dt>នៅសល់</dt><dd>${fmt(l.amount-r)}</dd></dl><div class="bar" title="សងបាន ${p.toFixed(0)}%"><i style="width:${p}%"></i></div><small style="color:var(--muted)">សងប្រាក់ដើមបាន ${p.toFixed(0)}%</small>${hist.length?`<ul class="hist">${hist.map(h=>`<li><span>${dt(h.date)} · ${fmt(h.amount)}</span>${isAdmin?delBtn('repay-del',h.id,'✕'):''}</li>`).join('')}</ul>`:''}${isAdmin?`<div class="actions" style="margin:12px 0 0"><button class="btn sm" data-act="repay-add" data-id="${esc(l.id)}">+ សងប្រាក់ដើម</button><button class="btn sm" data-act="loan-status" data-id="${esc(l.id)}">${paid?'ប្តូរទៅ កំពុងខ្ចី':'កត់ថា សងរួច'}</button>${delBtn('loan-del',l.id)}</div>`:''}</div>`}).join('')||'<div class="state">មិនទាន់មានកម្ចី</div>';
}
function renderFinance(){
 $('#exp').innerHTML=[...S.expenses].sort((a,b)=>a.date.localeCompare(b.date)).map(e=>`<tr><td>${dt(e.date)}</td><td style="white-space:normal">${esc(e.description)}</td><td class="n">${fmt(e.amount)}</td>${isAdmin?`<td>${delBtn('exp-del',e.id)}</td>`:''}</tr>`).join('')+`<tr><td colspan="2"><b>សរុប</b></td><td class="n"><b>${fmt(C.expT)}</b></td>${isAdmin?'<td></td>':''}</tr>`;
}
function renderClosing(){
 const pr=(l,v,b)=>`<tr><td${b?' style="font-weight:700"':''}>${l}</td><td class="n dist"${b?' style="font-weight:700"':''}>${v}</td></tr>`;
 $('#cy').textContent=C.last.slice(0,4);$('#cpps').textContent=C.pps.toFixed(2);$('#rr').textContent=Math.round(C.RES*100)+'%';
 $('#ckpis').innerHTML=kp('ចំណូលសរុប',fmt(C.fees+C.interest))+kp('ចំណេញមុនកាត់',fmt(C.profit))+kp('កាត់ទុក '+Math.round(C.RES*100)+'%',fmt(C.reserve))+kp('ចំណេញសុទ្ធសម្រាប់ចែក',fmt(C.net))+kp('ហ៊ុនសរុប',fmt(C.shares));
 $('#pl').innerHTML=pr('ថ្លៃរដ្ឋបាល',fmt(C.fees))+pr('ការប្រាក់កម្ចី',fmt(C.interest))+pr('ចំណូលសរុប',fmt(C.fees+C.interest),1)+pr('ដក ចំណាយសរុប','−'+fmt(C.expT))+pr('ចំណេញមុនកាត់',fmt(C.profit),1)+pr('កាត់ទុក '+Math.round(C.RES*100)+'%','−'+fmt(C.reserve))+pr('ចំណេញសុទ្ធសម្រាប់ចែក',fmt(C.net),1)+pr('ចែកតាមហ៊ុន ('+C.shares+' ហ៊ុន)',C.pps.toFixed(2)+' រៀល/ហ៊ុន');
 $('#dist').innerHTML=C.mem.map(m=>`<tr><td>${esc(m.name)}</td><td class="n">${m.shares}</td><td class="n">${fmt(m.shares*C.pps)}</td></tr>`).join('')+`<tr><td><b>សរុប</b></td><td class="n"><b>${C.shares}</b></td><td class="n"><b>${fmt(C.net)}</b></td></tr>`;
}
function renderBars(){
 let h='';
 if(!live)h+='<div class="banner">ម៉ូដសាកល្បង៖ កំពុងប្រើទិន្នន័យគំរូ ហើយការកែប្រែមិនត្រូវបានរក្សាទុកទេ។ បំពេញ config.js ដើម្បីភ្ជាប់មូលដ្ឋានទិន្នន័យពិត។</div>';
 if(isAdmin)h+='<div class="adminbar"><b>របៀប Admin</b> អ្នកអាចបន្ថែម កែ និងលុបទិន្នន័យ។ ប៊ូតុងកែប្រែនៅក្នុងផ្នែកនីមួយៗ។</div>';
 $('#bars').innerHTML=h;
 document.body.classList.toggle('is-admin',isAdmin);
 $('#login').textContent=isAdmin?'ចាកចេញ':'ចូលជា Admin';
}
function renderAll(){calc();renderBars();renderOverview();renderMembers();renderMonthly();renderLedger();renderLoans();renderFinance();renderClosing()}
async function refresh(){await load();renderAll()}

/* ---------- admin actions ---------- */
const A={
 'member-add'(){openForm({title:'បន្ថែមសមាជិក',fields:[{name:'name',label:'ឈ្មោះសមាជិក'},{name:'joined',label:'ថ្ងៃចូលរួម',type:'date',value:today()}],
  async onSubmit(v){req(v.name,'ឈ្មោះ');req(v.joined,'ថ្ងៃចូលរួម');await db.insert('members',[{id:nextId(S.members,'M',3),name:v.name.trim(),joined:v.joined}])}})},
 'member-edit'(id){const m=S.members.find(x=>x.id===id);openForm({title:'កែសមាជិក '+esc(id),fields:[{name:'name',label:'ឈ្មោះសមាជិក',value:m.name},{name:'joined',label:'ថ្ងៃចូលរួម',type:'date',value:m.joined}],
  async onSubmit(v){req(v.name,'ឈ្មោះ');await db.update('members','id',id,{name:v.name.trim(),joined:v.joined})}})},
 'member-del'(id){const m=S.members.find(x=>x.id===id);confirmBox(`លុបសមាជិក <b>${esc(m.name)}</b>?`,()=>db.remove('members','id',id))},
 'save-add'(){openForm({title:'កត់ត្រាសន្សំ (ទិញហ៊ុន)',fields:[{name:'member_id',label:'សមាជិក',type:'select',options:memberOpts()},{name:'date',label:'កាលបរិច្ឆេទ',type:'date',value:today()},{name:'shares',label:'ចំនួនហ៊ុន (អាចជា 0.5)',type:'number',step:'0.5',min:0.5,value:1},{name:'fee',label:'ថ្លៃរដ្ឋបាល (រៀល)',type:'number',value:S.settings.admin_fee??1000}],
  async onSubmit(v){req(v.date,'កាលបរិច្ឆេទ');const sh=numv(v.shares,'ចំនួនហ៊ុន');await db.insert('savings',[{member_id:v.member_id,date:v.date,shares:sh,fee:Math.max(0,+v.fee||0)}])}})},
 'save-bulk'(){
  const body=`<label>កាលបរិច្ឆេទ<input name="date" type="date" value="${today()}"></label><label>ថ្លៃរដ្ឋបាលក្នុងម្នាក់ (រៀល)<input name="fee" type="number" value="${S.settings.admin_fee??1000}"></label><div class="bulk"><table><tbody>${S.members.map(m=>`<tr><td>${esc(m.name)}</td><td class="n"><input type="number" step="0.5" min="0" placeholder="0" data-m="${esc(m.id)}" aria-label="ហ៊ុនរបស់ ${esc(m.name)}"></td></tr>`).join('')}</tbody></table></div><small style="color:var(--muted)">ទុកទទេសម្រាប់អ្នកមិនបានមកសន្សំ។</small>`;
  openForm({title:'កត់ត្រាប្រចាំខែ',body,wide:true,submit:'រក្សាទុកទាំងអស់',async onSubmit(v,form){req(v.date,'កាលបរិច្ឆេទ');
   const rows=[...form.querySelectorAll('input[data-m]')].filter(i=>+i.value>0).map(i=>({member_id:i.dataset.m,date:v.date,shares:+i.value,fee:Math.max(0,+v.fee||0)}));
   if(!rows.length)throw new Error('សូមបញ្ចូលចំនួនហ៊ុនយ៉ាងហោចណាស់ម្នាក់');await db.insert('savings',rows)},done:'បានកត់ត្រាប្រចាំខែ'})},
 'save-del'(id){confirmBox('លុបកំណត់ត្រាសន្សំនេះ?',()=>db.remove('savings','id',id))},
 'loan-add'(){openForm({title:'បង្កើតកម្ចីថ្មី',intro:`ការប្រាក់ ${(S.settings.loan_rate??.02)*100}% ក្នុងមួយខែ ត្រូវគណនាស្វ័យប្រវត្តិ`,fields:[{name:'member_id',label:'សមាជិក',type:'select',options:memberOpts()},{name:'date',label:'ថ្ងៃខ្ចី',type:'date',value:today()},{name:'amount',label:'ទឹកប្រាក់ខ្ចី (រៀល)',type:'number',step:'1000',min:1},{name:'months',label:'រយៈពេល (ខែ)',type:'number',step:'1',min:1,value:3}],
  async onSubmit(v){req(v.date,'ថ្ងៃខ្ចី');const amt=numv(v.amount,'ទឹកប្រាក់'),mo=Math.round(numv(v.months,'រយៈពេល')),rate=S.settings.loan_rate??.02;
   await db.insert('loans',[{id:nextId(S.loans,'LOAN',3),date:v.date,member_id:v.member_id,amount:amt,months:mo,rate,interest:Math.round(amt*rate*mo),due:addMonths(v.date,mo),status:ACTIVE}])}})},
 'repay-add'(id){const act=S.loans.filter(l=>l.status===ACTIVE);if(!act.length)return toast('មិនមានកម្ចីសកម្ម');
  openForm({title:'កត់ត្រាការសងប្រាក់ដើម',fields:[{name:'loan_id',label:'កម្ចី',type:'select',value:id,options:act.map(l=>[l.id,`${l.id} · ${(C.by[l.member_id]||{}).name} · នៅសល់ ${fmt(l.amount-(C.rp[l.id]||0))}`])},{name:'date',label:'កាលបរិច្ឆេទសង',type:'date',value:today()},{name:'amount',label:'ប្រាក់ដើមបានសង (រៀល)',type:'number',step:'1000',min:1}],
  async onSubmit(v){req(v.date,'កាលបរិច្ឆេទ');const amt=numv(v.amount,'ទឹកប្រាក់'),l=S.loans.find(x=>x.id===v.loan_id),left=l.amount-(C.rp[l.id]||0);
   if(amt>left)throw new Error(`ទឹកប្រាក់លើសពីប្រាក់ដើមនៅសល់ (${fmt(left)} រៀល)`);
   await db.insert('repayments',[{loan_id:l.id,date:v.date,amount:amt}]);if(amt===left)await db.update('loans','id',l.id,{status:DONE})}})},
 'repay-del'(id){confirmBox('លុបការសងនេះ?',async()=>{const r=S.repayments.find(x=>String(x.id)===String(id));await db.remove('repayments','id',r.id);await db.update('loans','id',r.loan_id,{status:ACTIVE})})},
 async 'loan-status'(id){const l=S.loans.find(x=>x.id===id);try{await db.update('loans','id',id,{status:l.status===ACTIVE?DONE:ACTIVE});await refresh();toast('បានប្តូរស្ថានភាព')}catch(ex){toast(ex.message)}},
 'loan-del'(id){confirmBox(`លុបកម្ចី <b>${esc(id)}</b> និងការសងទាំងអស់របស់វា?`,()=>db.remove('loans','id',id))},
 'exp-add'(){openForm({title:'បន្ថែមចំណាយ',fields:[{name:'date',label:'កាលបរិច្ឆេទ',type:'date',value:today()},{name:'description',label:'បរិយាយ'},{name:'amount',label:'ទឹកប្រាក់ (រៀល)',type:'number',min:1}],
  async onSubmit(v){req(v.date,'កាលបរិច្ឆេទ');req(v.description,'បរិយាយ');await db.insert('expenses',[{date:v.date,description:v.description.trim(),amount:numv(v.amount,'ទឹកប្រាក់')}])}})},
 'exp-del'(id){confirmBox('លុបចំណាយនេះ?',()=>db.remove('expenses','id',id))},
 'set-edit'(){const s=S.settings;openForm({title:'តម្លៃកំណត់',intro:'ការផ្លាស់ប្តូរប៉ះពាល់ការគណនាទាំងអស់។ កម្ចីដែលមានស្រាប់រក្សាអត្រាដើម។',fields:[{name:'share_price',label:'តម្លៃហ៊ុនមួយ (រៀល)',type:'number',value:s.share_price},{name:'admin_fee',label:'ថ្លៃរដ្ឋបាលលំនាំដើម (រៀល)',type:'number',value:s.admin_fee},{name:'loan_rate',label:'អត្រាការប្រាក់ខ្ចីក្នុងមួយខែ (0.02 = 2%)',type:'number',step:'0.001',value:s.loan_rate},{name:'reserve_rate',label:'អត្រាកាត់ទុកចំណេញ (0.15 = 15%)',type:'number',step:'0.01',value:s.reserve_rate}],
  async onSubmit(v){const rows=['share_price','admin_fee','loan_rate','reserve_rate'].map(k=>{const n=Number(v[k]);if(!isFinite(n)||n<0||v[k]==='')throw new Error('តម្លៃកំណត់ត្រូវតែជាលេខ');return{key:k,value:n}});await db.upsert('settings',rows)}})}
};
document.addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(!b||!isAdmin)return;const f=A[b.dataset.act];if(f)f(b.dataset.id)});

/* ---------- auth ---------- */
async function checkAdmin(){
 if(!live)return false;
 const{data:{session}}=await sb.auth.getSession();if(!session)return false;
 const{data,error}=await sb.from('admins').select('email');return !error&&data.length>0;
}
$('#login').onclick=async()=>{
 if(isAdmin){if(live)await sb.auth.signOut();isAdmin=false;renderAll();return toast('បានចាកចេញ')}
 openForm({title:'ចូលជា Admin',intro:live?'សម្រាប់អ្នកគ្រប់គ្រងប៉ុណ្ណោះ។ អ្នកផ្សេងអាចមើលបានដោយមិនចាំបាច់ចូល។':'ម៉ូដសាកល្បង៖ បញ្ចូលអ្វីក៏បាន។',submit:'ចូល',done:'បានចូលជា Admin',
  fields:[{name:'email',label:'អ៊ីមែល',type:'email'},{name:'password',label:'លេខសម្ងាត់',type:'password'}],
  async onSubmit(v){
   if(live){req(v.email,'អ៊ីមែល');req(v.password,'លេខសម្ងាត់');
    const{error}=await sb.auth.signInWithPassword({email:v.email.trim(),password:v.password});
    if(error)throw new Error('អ៊ីមែល ឬលេខសម្ងាត់មិនត្រឹមត្រូវ');
    if(!(await checkAdmin())){await sb.auth.signOut();throw new Error('គណនីនេះមិនមែនជា Admin ទេ')}
   }
   isAdmin=true;
  }});
};

/* ---------- tabs, theme, init ---------- */
const tabs=document.querySelectorAll('#tabs button'),IDS=[...tabs].map(b=>b.dataset.t);
function go(t){tabs.forEach(b=>b.setAttribute('aria-selected',b.dataset.t===t));document.querySelectorAll('main>section').forEach(s=>s.hidden=s.id!==t)}
tabs.forEach(b=>b.onclick=()=>{go(b.dataset.t);try{history.replaceState(null,'','#'+b.dataset.t)}catch(e){}});
$('#q').oninput=renderMembers;$('#fm').onchange=renderLedger;$('#fmo').onchange=renderLedger;
$('#theme').onclick=()=>{const r=document.documentElement,dark=r.dataset.theme?r.dataset.theme==='dark':matchMedia('(prefers-color-scheme:dark)').matches;r.dataset.theme=dark?'light':'dark'};
(async()=>{
 try{
  await load();isAdmin=await checkAdmin();renderAll();
  $('#state').hidden=true;$('#app').hidden=false;
  const h=location.hash.slice(1);if(IDS.includes(h))go(h);
  if(live)sb.auth.onAuthStateChange(async(ev)=>{if(ev==='SIGNED_OUT'&&isAdmin){isAdmin=false;renderAll()}});
 }catch(ex){
  $('#state').innerHTML='មិនអាចផ្ទុកទិន្នន័យបានទេ។ សូមពិនិត្យ config.js និងការតភ្ជាប់អ៊ីនធឺណិត។<br><small>'+esc(ex.message||ex)+'</small>';
 }
})();
})();
