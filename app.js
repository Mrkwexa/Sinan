/*CALC-START*/
const FUELS=[
  {k:'diesel',n:'ئەنزەلی',pumps:1},{k:'gaz',n:'گاز',pumps:2},{k:'ghaz',n:'غاز',pumps:2},
  {k:'normal',n:'نۆڕماڵ',pumps:4},{k:'mohasan',n:'محەسەن',pumps:4},{k:'super',n:'سوپەر',pumps:2}];
const FUEL=Object.fromEntries(FUELS.map(f=>[f.k,f]));
const PUMPS=[]; {let n=0; FUELS.forEach(f=>{for(let i=0;i<f.pumps;i++){n++;PUMPS.push({id:'p'+n,no:n,fuel:f.k});}});}
const TANKS=FUELS.map((f,i)=>({id:'t'+(i+1),no:i+1,fuel:f.k,cap:50000}));
function N(v){
  if(v===null||v===undefined) return null;
  if(typeof v==='number') return isFinite(v)?v:null;
  let s=String(v).trim(); if(!s) return null;
  s=s.replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
     .replace(/[٬,،\s]/g,'').replace(/٫/g,'.');
  const n=Number(s); return isFinite(n)?n:null;
}
function shiftCalc(sh){
  const pumps=sh.pumps||{}, tanks=sh.tanks||{}, prices=sh.prices||{};
  const pumpL={}, bad={}, fuelL={}, fuelAmt={}, fuelHas={};
  FUELS.forEach(f=>{fuelL[f.k]=0;fuelAmt[f.k]=0;fuelHas[f.k]=false;});
  PUMPS.forEach(p=>{
    const r=pumps[p.id]||{}, o=N(r.o), c=N(r.c);
    pumpL[p.id]=null;
    if(o!=null&&c!=null){
      if(c<o){bad[p.id]=true;}
      else{const l=Math.round((c-o)*1000)/1000; pumpL[p.id]=l; fuelL[p.fuel]+=l; fuelHas[p.fuel]=true;}
    }
  });
  let totalL=0,totalAmt=0;
  FUELS.forEach(f=>{const pr=N(prices[f.k])||0; fuelAmt[f.k]=fuelL[f.k]*pr; totalL+=fuelL[f.k]; totalAmt+=fuelAmt[f.k];});
  const delT={};
  (sh.deliveries||[]).forEach(d=>{const l=N(d.l); if(l!=null&&d.tank) delT[d.tank]=(delT[d.tank]||0)+l;});
  const tank={};
  TANKS.forEach(t=>{
    const r=tanks[t.id]||{}, open=N(r.o), close=N(r.c), del=delT[t.id]||0, sold=fuelL[t.fuel];
    const expected=open!=null?open+del-sold:null;
    const diff=(expected!=null&&close!=null)?Math.round((close-expected)*100)/100:null;
    tank[t.id]={open,close,del,sold,expected,diff};
  });
  return {pumpL,bad,fuelL,fuelAmt,fuelHas,totalL,totalAmt,tank};
}
function tankState(diff,sold){
  if(diff==null) return null;
  const tol=Math.max(20,(sold||0)*0.003);
  if(Math.abs(diff)<=tol) return 'ok';
  return diff<0?'short':'over';
}
/*CALC-END*/

const TS={ok:['ڕێکە','good'],short:['کەمی','bad'],over:['زیادی','warn']};
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const nf0=new Intl.NumberFormat('en-US',{maximumFractionDigits:0});
const nf2=new Intl.NumberFormat('en-US',{maximumFractionDigits:2});
const fmt=n=>n==null?'—':nf0.format(Math.round(n));
const fmtL=n=>n==null?'—':nf2.format(n);
const sgn=n=>n==null?'—':(n>0?'+':'')+nf2.format(n);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const today=()=>{const d=new Date();return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());};
const shiftDay=(d,n)=>{const x=new Date(d+'T12:00:00');x.setDate(x.getDate()+n);return x.getFullYear()+'-'+pad(x.getMonth()+1)+'-'+pad(x.getDate());};
const curMonth=()=>today().slice(0,7);
const sw=k=>`<i class="swatch" style="background:var(--f-${k})"></i>`;
const SHIFT_NAME={1:'شەفتی یەکەم',2:'شەفتی دووەم'};

let db=null, dl=null;
let cfg={prices:{},start:null};
let customers=[];
const credit={months:new Map()};
let expenses=[], repExp=[], priceList=[];
let S=null, dirty=false, loadTok=0, repTok=0, view='shift', selCust=null, REP=null, saving=false;
let tt;
function toast(msg,kind){const t=$('#toast');t.textContent=msg;t.className='toast show '+(kind||'');clearTimeout(tt);tt=setTimeout(()=>{t.className='toast';},3000);}
async function guard(fn){
  try{return await fn();}
  catch(e){console.error(e);toast(e&&e.code==='invalid_argument'?'ڕێگەپێدانی نووسینت نییە':'هەڵەیەک ڕوویدا، دووبارە هەوڵبدەرەوە','bad');return undefined;}
}

/* ---------- data ---------- */
async function loadCfg(){
  if(!db) return;
  const s=await db.doc('config/main').get();
  if(s.exists){const d=s.data();cfg={prices:d.prices||{},start:d.start||null};}
}
async function saveCfg(patch){
  cfg={...cfg,...patch};
  await db.doc('config/main').set({prices:cfg.prices,start:cfg.start});
}
async function loadCustomers(){
  if(!db) return;
  const q=await db.collection('customers').orderBy('name').limit(500).get();
  customers=q.docs.map(d=>({id:d.id,...d.data()}));
}
function monthList(a,b){
  const out=[]; let [y,m]=a.split('-').map(Number); const [y2,m2]=b.split('-').map(Number);
  while(y<y2||(y===y2&&m<=m2)){out.push(y+'-'+pad(m));m++;if(m>12){m=1;y++;}}
  return out;
}
async function refreshMonth(m){
  const q=await db.collection('credit').where('m','==',m).get();
  credit.months.set(m,q.docs.map(d=>({id:d.id,...d.data()})));
}
async function loadCredit(){
  if(!db) return;
  const cm=curMonth(), start=(cfg.start&&cfg.start<=cm)?cfg.start:cm;
  await Promise.all(monthList(start,cm).map(m=>(m<cm&&credit.months.has(m))?null:refreshMonth(m)));
}
const allEntries=()=>{const a=[];credit.months.forEach(v=>a.push(...v));return a;};
function balances(){
  const b={}; customers.forEach(c=>{b[c.id]=N(c.open)||0;});
  allEntries().forEach(e=>{if(e.customerId in b) b[e.customerId]+=(e.kind==='sale'?1:-1)*(+e.amount||0);});
  return b;
}
const custName=id=>{const c=customers.find(x=>x.id===id);return c?c.name:'(کڕیارێکی سڕاوە)';};
const fuelLabel=k=>FUEL[k]?FUEL[k].n:'نەقد / شتی دیکە';
const credDesc=e=>fuelLabel(e.fuel)+(e.liters?` · <span class="num">${fmtL(e.liters)}</span> لیتر`:'')+(e.due?` · کاتی دانەوە <span class="num">${esc(e.due)}</span>`:'')+(e.note?` · ${esc(e.note)}`:'');
const EXP_CATS=['مووچە','کارەبا و گەنەراتۆر','چاککردنەوە','خواردن و چا','پاککردنەوە','دیکە'];
function dueInfo(cid){
  const c=customers.find(x=>x.id===cid); if(!c) return {next:null,overdue:false};
  const ents=allEntries().filter(e=>e.customerId===cid);
  let paid=ents.filter(e=>e.kind==='pay').reduce((a,e)=>a+(+e.amount||0),0)-Math.max(0,N(c.open)||0);
  const sales=ents.filter(e=>e.kind==='sale').sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:(a.ts||0)-(b.ts||0));
  let next=null;
  for(const e of sales){
    const amt=+e.amount||0;
    if(paid>=amt){paid-=amt;continue;}
    if(e.due&&(!next||e.due<next)) next=e.due;
    paid=0;
  }
  return {next,overdue:!!next&&next<today()};
}
async function loadPrices(){
  if(!db) return;
  const q=await db.collection('prices').get();
  priceList=q.docs.map(d=>({id:d.id,from:d.data().from||d.id,prices:d.data().prices||{}})).sort((a,b)=>a.from<b.from?-1:a.from>b.from?1:0);
}
const priceFor=key=>{let r=null;for(const p of priceList){if(p.from<=key) r=p.prices;else break;}return r;};
async function savePriceEntry(from,prices){
  await db.doc('prices/'+from).set({from,prices,ts:Date.now()});
  await loadPrices();
  const last=priceList[priceList.length-1];
  if(last) await saveCfg({prices:last.prices});
}
async function loadExpenses(date){
  if(!db) return [];
  const q=await db.collection('expenses').where('date','==',date).get();
  return q.docs.map(d=>({id:d.id,...d.data()}));
}

/* ---------- shift ---------- */
function newState(date,no,doc,prev){
  const sv=v=>v==null?'':String(v);
  const st={date,no,key:date+'_'+no,worker:doc?(doc.worker||''):'',prices:{},pumps:{},tanks:{},deliveries:[],exists:!!doc};
  PUMPS.forEach(p=>{
    const d=doc&&doc.pumps&&doc.pumps[p.id], pv=prev&&prev.pumps&&prev.pumps[p.id];
    st.pumps[p.id]=doc?{o:sv(d&&d.o),c:sv(d&&d.c)}:{o:sv(pv&&pv.c),c:''};
  });
  TANKS.forEach(t=>{
    const d=doc&&doc.tanks&&doc.tanks[t.id], pv=prev&&prev.tanks&&prev.tanks[t.id];
    st.tanks[t.id]=doc?{o:sv(d&&d.o),c:sv(d&&d.c)}:{o:sv(pv&&pv.c),c:''};
  });
  const hp=priceFor(st.key)||{};
  st.prevPrices=(prev&&prev.prices)||null;
  FUELS.forEach(f=>{
    const pv=prev&&prev.prices&&prev.prices[f.k];
    st.prices[f.k]=doc?sv(doc.prices&&doc.prices[f.k])
      :sv(hp[f.k]!=null?hp[f.k]:(pv!=null?pv:cfg.prices[f.k]));
  });
  if(doc) st.deliveries=(doc.deliveries||[]).map(x=>({tank:x.tank,l:sv(x.l),sup:x.sup||'',ref:x.ref||''}));
  return st;
}
function setStatus(kind){
  const el=$('#st');
  const map={loading:['کردنەوە…',''],new:['شەفتی نوێیە و هێشتا پاشەکەوت نەکراوە','warn'],dirty:['گۆڕانکارییەکانت پاشەکەوت نەکراون','warn'],saved:['پاشەکەوت کراوە','good'],nodb:['پەیوەندی بە داتابەیسەوە نییە','bad']};
  const [t,c]=map[kind]; el.textContent=t; el.className='pill '+c;
}
function setSeg(no){$$('.seg button').forEach(b=>b.setAttribute('aria-checked',String(+b.dataset.shift===no)));}
function markDirty(){dirty=true;setStatus('dirty');}
async function openShift(date,no){
  const my=++loadTok; setStatus('loading'); setSeg(no);
  let doc=null, prev=null;
  if(db){
    const key=date+'_'+no;
    try{
      const s=await db.doc('shifts/'+key).get();
      if(s.exists) doc=s.data();
      const q=await db.collection('shifts').where('key','<',key).orderBy('key','desc').limit(1).get();
      if(!q.empty) prev=q.docs[0].data();
      await loadCredit();
      await loadPrices();
      expenses=await loadExpenses(date);
    }catch(e){console.error(e);}
  }
  if(my!==loadTok) return;
  S=newState(date,no,doc,prev); dirty=false;
  $('#shiftDate').value=S.date; setSeg(S.no); $('#worker').value=S.worker;
  buildShift();
  setStatus(!db?'nodb':(S.exists?'saved':'new'));
}
function buildShift(){
  const noPrice=FUELS.some(f=>!N(S.prices[f.k]));
  let h='';
  const chg=S.prevPrices?FUELS.filter(f=>{const a=N(S.prevPrices[f.k]),b=N(S.prices[f.k]);return a!=null&&b!=null&&a!==b;}):[];
  if(chg.length) h+=`<div class="banner">نرخ لە شەفتی پێشوو گۆڕاوە: `+chg.map(f=>`${f.n} <span class="num">${fmt(N(S.prevPrices[f.k]))} ← ${fmt(N(S.prices[f.k]))}</span>`).join(' · ')+`</div>`;
  if(!FUELS.some(f=>N(cfg.prices[f.k]))) h+=`<div class="banner">نرخی سوتەمەنی هێشتا دانەنراوە. لە بەشی <a href="#prices">نرخەکان</a> دایبنێ، یان لێرە بۆ ئەم شەفتە بینووسە.</div>`;
  h+=`<details class="card" id="priceBox" ${noPrice?'open':''}><summary>نرخی ئەم شەفتە (دینار بۆ هەر لیترێک)</summary><div class="pgrid">`+
    FUELS.map(f=>`<label class="fld"><span>${f.n}</span><input class="in num" id="pr-${f.k}" inputmode="decimal" dir="ltr"></label>`).join('')+`</div><button class="btn" type="button" id="priceApply">ئەم نرخانە لەم شەفتەوە بەدواوە بکە بە نرخی نوێ</button><p class="note">ئەگەر نرخ لە نێوان شەفتەکان گۆڕدرا، نرخی نوێ لێرە بنووسە و ئەم دوگمەیە بگرە، تاکو شەفتی دواتریش بەم نرخە دەست پێبکات.</p></details>`;
  h+=`<div class="sec-h" id="sec-pumps"><h2>پەمپەکان</h2><span class="muted"><small>کۆی لیتر:</small> <b id="s-liters" class="num">0</b></span></div><p class="note" style="padding-inline:4px;margin-top:-6px">ژمارەکانی سەر ئامێری هەر پەمپێک بنووسە. لیتر خۆی دەژمێردرێت.</p>`;
  FUELS.forEach(f=>{
    h+=`<div class="card"><div class="ghead">${sw(f.k)}<h3>${f.n}</h3><div class="gtot"><b class="num" id="gs-${f.k}">0</b><small class="muted">لیتر</small></div></div>
      <div class="pcol"><span></span><span>سەرەتا</span><span>کۆتایی</span><span>لیتر</span></div>`;
    PUMPS.filter(p=>p.fuel===f.k).forEach(p=>{
      h+=`<div class="prow"><span class="plabel">پەمپ <span class="num">${p.no}</span></span>
        <input class="in num" id="po-${p.id}" inputmode="decimal" dir="ltr" aria-label="ژمارەی سەرەتای پەمپی ${p.no}">
        <input class="in num" id="pc-${p.id}" inputmode="decimal" dir="ltr" aria-label="ژمارەی کۆتایی پەمپی ${p.no}">
        <span class="lit num" id="pl-${p.id}">—</span></div>`;
    });
    h+=`</div>`;
  });
  let tk='';
  tk+=`<div class="sec-h" id="sec-tanks"><h2>تانکییەکان</h2><small class="muted">هەر تانکێک 50,000 لیترە</small></div><div class="card">`;
  TANKS.forEach(t=>{
    tk+=`<div class="tank"><div class="thead"><span class="tn">${sw(t.fuel)}تانکی <span class="num">${t.no}</span> · ${FUEL[t.fuel].n}</span><span id="tp-${t.id}" class="pill">—</span></div>
      <div class="tgrid">
        <label class="fld"><span>لیتری سەرەتا</span><input class="in num" id="to-${t.id}" inputmode="decimal" dir="ltr"></label>
        <label class="fld"><span>پێوانەی کۆتایی</span><input class="in num" id="tc-${t.id}" inputmode="decimal" dir="ltr"></label>
      </div>
      <div class="level"><i id="tb-${t.id}"></i></div>
      <div class="tstats">
        <div><small>هاتوو</small><b class="num" id="tdel-${t.id}">0</b></div>
        <div><small>فرۆشراو</small><b class="num" id="tsold-${t.id}">0</b></div>
        <div><small>پێشبینی</small><b class="num" id="texp-${t.id}">—</b></div>
        <div><small>جیاوازی</small><b class="num" id="tdiff-${t.id}">—</b></div>
      </div></div>`;
  });
  tk+=`<p class="note">پێشبینی = لیتری سەرەتا + هاتوو − فرۆشراو. جیاوازی = پێوانەی کۆتایی − پێشبینی.</p></div>`;
  tk+=`<div class="sec-h" id="sec-del"><h2>هاتنی سوتەمەنی</h2></div><div class="card"><div id="delBox"></div><button class="btn" id="delAdd">+ سوتەمەنییەکی نوێ هاتووە</button></div>`;
  h+=`<div class="sec-h" id="sec-credit"><h2>قەرزی ئەم شەفتە</h2></div><div class="card"><div id="crBox"></div></div><div class="sec-h" id="sec-exp"><h2>خەرجییەکانی ئەم شەفتە</h2></div><div class="card"><div id="expBox"></div></div><div class="sec-h" id="sec-chg"><h2>گۆڕینی نرخ و ژمارەی پەمپ</h2></div><div class="card"><div id="chgBox"></div></div>`;
  $('#shiftBody').innerHTML=h; $('#tankBody').innerHTML=tk;
  FUELS.forEach(f=>{$('#pr-'+f.k).value=S.prices[f.k];});
  PUMPS.forEach(p=>{$('#po-'+p.id).value=S.pumps[p.id].o;$('#pc-'+p.id).value=S.pumps[p.id].c;});
  TANKS.forEach(t=>{$('#to-'+t.id).value=S.tanks[t.id].o;$('#tc-'+t.id).value=S.tanks[t.id].c;});
  renderDel(); renderShiftCredit(); renderShiftExp(); renderChg(); recalc();
}
function renderDel(){
  const box=$('#delBox');
  box.innerHTML=S.deliveries.length?S.deliveries.map((d,i)=>`<div class="drow">
    <select class="in" data-di="${i}" data-f="tank" aria-label="تانک">${TANKS.map(t=>`<option value="${t.id}" ${d.tank===t.id?'selected':''}>تانکی ${t.no} · ${FUEL[t.fuel].n}</option>`).join('')}</select>
    <input class="in num" dir="ltr" inputmode="decimal" placeholder="چەند لیتر" value="${esc(d.l)}" data-di="${i}" data-f="l" aria-label="چەند لیتر">
    <button class="icon x" data-deldel="${i}" aria-label="لابردن">×</button>
    <input class="in sup" placeholder="ناوی دابینکەر" value="${esc(d.sup)}" data-di="${i}" data-f="sup" aria-label="ناوی دابینکەر">
    <input class="in ref" placeholder="ژمارەی پسوولە" value="${esc(d.ref)}" data-di="${i}" data-f="ref" aria-label="ژمارەی پسوولە">
  </div>`).join(''):`<p class="empty">لەم شەفتەدا سوتەمەنی نەهاتووە.</p>`;
}
const shiftCredit=()=>(credit.months.get(S.date.slice(0,7))||[]).filter(e=>e.kind==='sale'&&e.shiftKey===S.key);
function renderShiftCredit(){
  const list=shiftCredit();
  let h='';
  if(!customers.length){
    h+=`<p class="empty">هێشتا هیچ کڕیارێک تۆمار نەکراوە. یەکەم کڕیار لە بەشی <a href="#credit">قەرزەکان</a> زیاد بکە.</p>`;
  }else{
    h+=`<div class="formgrid">
      <label class="fld"><span>کڕیار</span><select class="in" id="crCust">${customers.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label>
      <label class="fld"><span>جۆر</span><select class="in" id="crFuel">${FUELS.map(f=>`<option value="${f.k}">${f.n}</option>`).join('')}<option value="cash">نەقد / شتی دیکە</option></select></label>
      <label class="fld"><span>چەند لیتر</span><input class="in num" id="crL" inputmode="decimal" dir="ltr"></label>
      <label class="fld"><span>بڕی پارە (دینار)</span><input class="in num" id="crAmt" inputmode="decimal" dir="ltr" placeholder="خۆکار دەژمێردرێت"></label>
      <label class="fld"><span>کاتی دانەوە</span><input class="in num" id="crDue" type="date"></label></div>
      <button class="btn primary" id="crAdd">قەرزەکە تۆمار بکە</button>`;
  }
  h+=`<div class="list">`+(list.length?list.map(e=>`<div class="li"><div class="grow"><b>${esc(custName(e.customerId))}</b><br><small class="muted">${credDesc(e)}</small></div>
    <span class="amt num">${fmt(e.amount)}</span><button class="icon" data-del="credit:${esc(e.id)}" aria-label="لابردن">×</button></div>`).join('')
    :`<p class="empty">لەم شەفتەدا قەرز نەدراوە.</p>`)+`</div>`;
  $('#crBox').innerHTML=h;
}
function recalc(){
  if(!S) return;
  const C=shiftCalc(S);
  PUMPS.forEach(p=>{
    const bad=!!C.bad[p.id], o=$('#pl-'+p.id);
    o.textContent=bad?'هەڵەیە':fmtL(C.pumpL[p.id]); o.classList.toggle('err',bad); $('#pc-'+p.id).classList.toggle('err',bad);
  });
  FUELS.forEach(f=>{$('#gs-'+f.k).textContent=fmtL(C.fuelL[f.k]);});
  TANKS.forEach(t=>{
    const x=C.tank[t.id], st=tankState(x.diff,x.sold);
    $('#tdel-'+t.id).textContent=fmtL(x.del); $('#tsold-'+t.id).textContent=fmtL(x.sold);
    $('#texp-'+t.id).textContent=fmtL(x.expected); $('#tdiff-'+t.id).textContent=sgn(x.diff);
    const pill=$('#tp-'+t.id);
    pill.textContent=st?TS[st][0]:'—'; pill.className='pill '+(st?TS[st][1]:'');
    const lv=x.close!=null?x.close:x.expected;
    $('#tb-'+t.id).style.width=(lv==null?0:Math.max(0,Math.min(100,lv/t.cap*100)))+'%';
  });
  const cr=shiftCredit().reduce((a,e)=>a+(+e.amount||0),0);
  $('#s-liters').textContent=fmtL(C.totalL);
  $('#s-sales').textContent=fmt(C.totalAmt); $('#s-credit').textContent=fmt(cr); const ex=shiftExp().reduce((a,e)=>a+(+e.amount||0),0); $('#s-cash').textContent=fmt(C.totalAmt-cr-ex);
}
let chgFuel=FUELS[0].k;
function renderChg(){
  const ps=PUMPS.filter(p=>p.fuel===chgFuel), curPrice=S.prices[chgFuel];
  $('#chgBox').innerHTML=`<p class="note">سوتەمەنییەک هەڵبژێرە، ژمارەی ئێستای هەر پەمپێکی ئەو جۆرە بنووسە و نرخی نوێ دابنێ. ژمارەکان دەبنە «سەرەتا»ی پەمپەکان لەم شەفتەدا.</p>
    <label class="fld"><span>جۆری سوتەمەنی</span><select class="in" id="chgFuel">${FUELS.map(x=>`<option value="${x.k}" ${x.k===chgFuel?'selected':''}>${x.n} (${x.pumps} پەمپ)</option>`).join('')}</select></label>
    <div class="list">`+ps.map(p=>`<div class="li"><span class="plabel">پەمپ <span class="num">${p.no}</span></span><div class="grow"><input class="in num" id="cg-${p.id}" inputmode="decimal" dir="ltr" aria-label="ژمارەی ئێستای پەمپی ${p.no}" placeholder="${esc(S.pumps[p.id].o||'ژمارەی ئێستا')}"></div></div>`).join('')+`</div>
    <label class="fld"><span>نرخی نوێ (دینار بۆ هەر لیترێک)</span><input class="in num" id="cgPrice" inputmode="decimal" dir="ltr" placeholder="${esc(curPrice||'نرخ')}"></label>
    <button class="btn primary" id="cgApply" type="button">جێبەجێ بکە بۆ ${FUEL[chgFuel].n}</button>`;
}
async function applyChg(){
  const ps=PUMPS.filter(p=>p.fuel===chgFuel), vals={};
  for(const p of ps){
    const raw=$('#cg-'+p.id).value.trim();
    if(raw==='') continue;
    const v=N(raw); if(v==null||v<0) return toast('ژمارەی پەمپی '+p.no+' دروست نییە','warn');
    vals[p.id]=v;
  }
  const rawP=$('#cgPrice').value.trim(), price=rawP===''?null:N(rawP);
  if(rawP!==''&&!(price>0)) return toast('نرخێکی دروست بنووسە','warn');
  if(!Object.keys(vals).length&&price==null) return toast('ژمارەی پەمپ یان نرخی نوێ بنووسە','warn');
  Object.keys(vals).forEach(id=>{S.pumps[id].o=String(vals[id]); $('#po-'+id).value=String(vals[id]);});
  let saved=false;
  if(price!=null){
    S.prices[chgFuel]=String(price); $('#pr-'+chgFuel).value=String(price);
    if(db){
      const all={}; FUELS.forEach(f=>{all[f.k]=N(S.prices[f.k]);});
      saved=!!(await guard(async()=>{await savePriceEntry(S.key,all);return true;}));
    }
  }
  markDirty(); recalc(); renderChg();
  toast(FUEL[chgFuel].n+': '+(Object.keys(vals).length?'ژمارەی سەرەتا نوێ کرایەوە':'')+(Object.keys(vals).length&&price!=null?' و ':'')+(price!=null?(saved?'نرخ لەم شەفتەوە بەدواوە پاشەکەوت کرا':'نرخ گۆڕدرا'):'')+'. شەفتەکە پاشەکەوت بکە.');
}
async function applyPriceFromShift(){
  if(!db) return toast('پەیوەندی بە داتابەیسەوە نییە','bad');
  const p={}; FUELS.forEach(f=>{p[f.k]=N(S.prices[f.k]);});
  if(!FUELS.some(f=>p[f.k])) return toast('یەکەم نرخەکان بنووسە','warn');
  await guard(async()=>{await savePriceEntry(S.key,p);toast('نرخەکان لەم شەفتەوە بەدواوە پاشەکەوت کران');});
}
async function syncCreditPrices(){
  let n=0;
  try{
    for(const e of shiftCredit()){
      if(!e.fuel||e.fuel==='cash'||!e.liters) continue;
      const np=N(S.prices[e.fuel])||0; if(!np||e.price===np) continue;
      if(Math.round((+e.liters)*(+e.price||0))!==(+e.amount)) continue;
      await db.doc('credit/'+e.id).update({price:np,amount:Math.round(e.liters*np)}); n++;
    }
    if(n){await refreshMonth(S.date.slice(0,7)); renderShiftCredit(); recalc();}
  }catch(err){console.error(err);}
  return n;
}
async function saveShift(){
  if(!db) return toast('پەیوەندی بە داتابەیسەوە نییە','bad');
  if(saving) return;
  const doc={key:S.key,date:S.date,no:S.no,worker:(S.worker||'').trim(),prices:{},pumps:{},tanks:{},deliveries:[],updatedAt:new Date().toISOString()};
  FUELS.forEach(f=>{doc.prices[f.k]=N(S.prices[f.k]);});
  PUMPS.forEach(p=>{doc.pumps[p.id]={o:N(S.pumps[p.id].o),c:N(S.pumps[p.id].c)};});
  TANKS.forEach(t=>{doc.tanks[t.id]={o:N(S.tanks[t.id].o),c:N(S.tanks[t.id].c)};});
  doc.deliveries=S.deliveries.filter(d=>N(d.l)>0).map(d=>({tank:d.tank,l:N(d.l),sup:d.sup||'',ref:d.ref||''}));
  const nBad=Object.keys(shiftCalc(S).bad).length;
  saving=true; $('#save').disabled=true;
  const ok=await guard(async()=>{await db.doc('shifts/'+S.key).set(doc);return true;});
  saving=false; $('#save').disabled=false;
  if(!ok) return;
  S.exists=true; dirty=false; setStatus('saved');
  const nSync=await syncCreditPrices();
  toast((nBad?`پاشەکەوت کرا، بەڵام ${nBad} پەمپ ژمارەی کۆتاییان لە سەرەتا کەمترە`:'شەفتەکە پاشەکەوت کرا')+(nSync?` · بڕی ${nSync} قەرز بەپێی نرخی نوێ نوێ کرایەوە`:''),nBad?'warn':'');
}
async function addShiftCredit(){
  const cid=$('#crCust').value, fuel=$('#crFuel').value, l=N($('#crL').value), manual=N($('#crAmt').value), due=$('#crDue').value||null;
  if(!cid) return toast('کڕیار دیاری بکە','warn');
  let amount, price=null;
  if(fuel==='cash'){ if(!(manual>0)) return toast('بڕی پارەکە بنووسە','warn'); amount=Math.round(manual); }
  else{
    if(!(l>0)) return toast('چەند لیتر بنووسە','warn');
    price=N(S.prices[fuel])||0;
    amount=manual>0?Math.round(manual):Math.round(l*price);
    if(!(amount>0)) return toast('یەکەم نرخی '+FUEL[fuel].n+' دابنێ','warn');
  }
  if(!db) return toast('پەیوەندی بە داتابەیسەوە نییە','bad');
  await guard(async()=>{
    const m=S.date.slice(0,7);
    if(!cfg.start||m<cfg.start) await saveCfg({start:m});
    await db.collection('credit').add({kind:'sale',customerId:cid,date:S.date,m,shiftKey:S.key,fuel,liters:fuel==='cash'?null:l,price,amount,due,ts:Date.now()});
    await refreshMonth(m);
    renderShiftCredit(); recalc(); toast('قەرزەکە تۆمار کرا');
  });
}
const shiftExp=()=>expenses.filter(e=>e.shiftKey===S.key);
function renderShiftExp(){
  const list=shiftExp();
  $('#expBox').innerHTML=`<div class="formgrid">
    <label class="fld"><span>جۆری خەرجی</span><select class="in" id="exCat">${EXP_CATS.map(c=>`<option>${c}</option>`).join('')}</select></label>
    <label class="fld"><span>بڕی پارە (دینار)</span><input class="in num" id="exAmt" inputmode="decimal" dir="ltr"></label>
    <label class="fld"><span>تێبینی</span><input class="in" id="exNote" placeholder="بۆ چی بوو؟"></label></div>
    <button class="btn primary" id="exAdd">خەرجییەکە تۆمار بکە</button><div class="list">`+
    (list.length?list.map(e=>`<div class="li"><div class="grow"><b>${esc(e.cat)}</b>${e.note?`<br><small class="muted">${esc(e.note)}</small>`:''}</div><span class="amt num">${fmt(e.amount)}</span><button class="icon" data-del="expense:${esc(e.id)}" aria-label="لابردن">×</button></div>`).join(''):`<p class="empty">لەم شەفتەدا خەرجی تۆمار نەکراوە.</p>`)+`</div>`;
}
async function addShiftExp(){
  const amt=N($('#exAmt').value); if(!(amt>0)) return toast('بڕی خەرجییەکە بنووسە','warn');
  if(!db) return toast('پەیوەندی بە داتابەیسەوە نییە','bad');
  await guard(async()=>{
    await db.collection('expenses').add({date:S.date,shiftKey:S.key,cat:$('#exCat').value,amount:Math.round(amt),note:$('#exNote').value.trim(),ts:Date.now()});
    expenses=await loadExpenses(S.date); renderShiftExp(); recalc(); toast('خەرجییەکە تۆمار کرا');
  });
}

/* ---------- report ---------- */
const normShift=s=>({pumps:s.pumps||{},tanks:s.tanks||{},prices:s.prices||{},deliveries:s.deliveries||[]});
async function loadReport(){
  const d=$('#repDate').value||today(), box=$('#repBody');
  if(!db){box.innerHTML=`<div class="card"><p class="empty">پەیوەندی بە داتابەیسەوە نییە.</p></div>`;return;}
  box.innerHTML=`<div class="card"><p class="empty">کردنەوە…</p></div>`;
  const tok=++repTok; let shifts;
  await guard(async()=>{
    const q=await db.collection('shifts').where('date','==',d).get();
    shifts=q.docs.map(x=>x.data()).sort((a,b)=>a.no-b.no);
    await loadCustomers(); await loadCredit(); repExp=await loadExpenses(d);
  });
  if(tok!==repTok) return;
  if(!shifts){box.innerHTML=`<div class="card"><p class="empty">نەتوانرا ڕاپۆرتەکە بکرێتەوە.</p></div>`;return;}
  REP={d,shifts,calcs:shifts.map(s=>shiftCalc(normShift(s)))};
  renderReport();
}
function repNumbers(){
  const {d,shifts,calcs}=REP;
  const entries=allEntries().filter(e=>e.date===d);
  const creditAmt=entries.filter(e=>e.kind==='sale').reduce((a,e)=>a+(+e.amount||0),0);
  const payAmt=entries.filter(e=>e.kind==='pay').reduce((a,e)=>a+(+e.amount||0),0);
  const totalL=calcs.reduce((a,c)=>a+c.totalL,0), totalAmt=calcs.reduce((a,c)=>a+c.totalAmt,0);
  const tanks=TANKS.map(t=>{
    const first=calcs[0].tank[t.id], last=calcs[calcs.length-1].tank[t.id];
    const del=calcs.reduce((a,c)=>a+c.tank[t.id].del,0), sold=calcs.reduce((a,c)=>a+c.tank[t.id].sold,0);
    const open=first.open, close=last.close;
    const expected=open!=null?open+del-sold:null;
    const diff=(expected!=null&&close!=null)?Math.round((close-expected)*100)/100:null;
    return {t,open,del,sold,expected,close,diff};
  });
  const perShift=shifts.map((s,i)=>{
    const cr=entries.filter(e=>e.kind==='sale'&&e.shiftKey===s.key).reduce((a,e)=>a+(+e.amount||0),0);
    const ex=repExp.filter(e=>e.shiftKey===s.key).reduce((a,e)=>a+(+e.amount||0),0);
    return {s,l:calcs[i].totalL,amt:calcs[i].totalAmt,cr,ex,cash:calcs[i].totalAmt-cr-ex};
  });
  const expAmt=repExp.reduce((a,e)=>a+(+e.amount||0),0);
  return {entries,creditAmt,payAmt,expAmt,totalL,totalAmt,cash:totalAmt-creditAmt,tanks,perShift,drawer:totalAmt-creditAmt+payAmt-expAmt};
}
function renderReport(){
  const box=$('#repBody'), {d,shifts,calcs}=REP;
  if(!shifts.length){box.innerHTML=`<div class="card"><p class="empty">بۆ ڕۆژی <span class="num">${esc(d)}</span> هیچ شەفتێک پاشەکەوت نەکراوە.</p></div>`;return;}
  const R=repNumbers();
  let h=`<div class="tiles">
    <div class="tile"><small>کۆی لیتری فرۆشراو</small><b class="num">${fmtL(R.totalL)}</b></div>
    <div class="tile"><small>کۆی فرۆشتن (دینار)</small><b class="num">${fmt(R.totalAmt)}</b></div>
    <div class="tile"><small>قەرزی ئەم ڕۆژە</small><b class="num">${fmt(R.creditAmt)}</b></div>
    <div class="tile"><small>نەقدی فرۆشتن</small><b class="num">${fmt(R.cash)}</b></div>
    <div class="tile"><small>پارەی وەرگیراو لە قەرز</small><b class="num">${fmt(R.payAmt)}</b></div>
    <div class="tile"><small>خەرجی ئەم ڕۆژە</small><b class="num">${fmt(R.expAmt)}</b></div>
    <div class="tile key"><small>نەقدی کۆتایی ناو سندوق</small><b class="num">${fmt(R.drawer)}</b></div></div>`;
  h+=`<div class="card"><h2>حسابی کۆتایی</h2><div class="list">`+[['کۆی فرۆشتن',R.totalAmt,''],['قەرزی دراو',-R.creditAmt,'−'],['پارەی وەرگیراو لە قەرزەکان',R.payAmt,'+'],['خەرجییەکان',-R.expAmt,'−']].map(r=>`<div class="li"><div class="grow">${r[0]}</div><span class="amt num">${r[2]} ${fmt(Math.abs(r[1]))}</span></div>`).join('')+`<div class="li"><div class="grow"><b>نەقدی ناو سندوق</b></div><span class="pill good num">${fmt(R.drawer)}</span></div></div></div>`;
  h+=`<div class="card"><h2>حسابی هەر شەفتێک</h2><div class="scroll"><table class="tbl"><thead><tr><th>شەفت</th><th>لیتر</th><th>فرۆشتن</th><th>قەرز</th><th>خەرجی</th><th>نەقد</th></tr></thead><tbody>`+
    R.perShift.map(x=>`<tr><td>${SHIFT_NAME[x.s.no]||('شەفتی '+x.s.no)}${x.s.worker?`<br><small class="muted">${esc(x.s.worker)}</small>`:''}</td><td class="num">${fmtL(x.l)}</td><td class="num">${fmt(x.amt)}</td><td class="num">${fmt(x.cr)}</td><td class="num">${fmt(x.ex)}</td><td class="num"><b>${fmt(x.cash)}</b></td></tr>`).join('')+
    `</tbody></table></div></div>`;
  h+=`<div class="card"><h2>فرۆشتن بەپێی جۆری سوتەمەنی (لیتر)</h2><div class="scroll"><table class="tbl"><thead><tr><th>جۆر</th>`+
    shifts.map(s=>`<th>${SHIFT_NAME[s.no]||('شەفتی '+s.no)}</th>`).join('')+`<th>کۆ</th><th>بڕی پارە</th></tr></thead><tbody>`;
  FUELS.forEach(f=>{
    const tot=calcs.reduce((a,c)=>a+c.fuelL[f.k],0), amt=calcs.reduce((a,c)=>a+c.fuelAmt[f.k],0);
    h+=`<tr><td>${sw(f.k)} ${f.n}</td>`+calcs.map(c=>`<td class="num">${c.fuelHas[f.k]?fmtL(c.fuelL[f.k]):'—'}</td>`).join('')+`<td class="num"><b>${fmtL(tot)}</b></td><td class="num">${fmt(amt)}</td></tr>`;
  });
  h+=`</tbody><tfoot><tr><td>کۆی گشتی</td>`+calcs.map(c=>`<td class="num">${fmtL(c.totalL)}</td>`).join('')+`<td class="num">${fmtL(R.totalL)}</td><td class="num">${fmt(R.totalAmt)}</td></tr></tfoot></table></div></div>`;
  h+=`<div class="card"><h2>هاوسەنگی تانکییەکان (لیتر)</h2><div class="scroll"><table class="tbl" style="min-width:640px"><thead><tr><th>تانک</th><th>سەرەتا</th><th>هاتوو</th><th>فرۆشراو</th><th>پێشبینی</th><th>پێوانەی کۆتایی</th><th>جیاوازی</th></tr></thead><tbody>`;
  R.tanks.forEach(x=>{
    const st=tankState(x.diff,x.sold);
    h+=`<tr><td>${sw(x.t.fuel)} ${FUEL[x.t.fuel].n}</td><td class="num">${fmtL(x.open)}</td><td class="num">${fmtL(x.del)}</td><td class="num">${fmtL(x.sold)}</td><td class="num">${fmtL(x.expected)}</td><td class="num">${fmtL(x.close)}</td>
      <td>${st?`<span class="pill ${TS[st][1]}"><span class="num">${sgn(x.diff)}</span> ${TS[st][0]}</span>`:'—'}</td></tr>`;
  });
  h+=`</tbody></table></div><p class="note">جیاوازی ڕێکە ئەگەر لە 0.3٪ی فرۆشراو، یان لە 20 لیتر کەمتر بێت.</p></div>`;
  const sales=R.entries.filter(e=>e.kind==='sale'), pays=R.entries.filter(e=>e.kind==='pay');
  h+=`<div class="card"><h2>قەرز و پارەی وەرگیراو</h2><div class="list">`+
    (sales.length||pays.length?
      sales.map(e=>`<div class="li"><div class="grow"><b>${esc(custName(e.customerId))}</b><br><small class="muted">قەرز · ${credDesc(e)}</small></div><span class="amt num">${fmt(e.amount)}</span></div>`).join('')+
      pays.map(e=>`<div class="li"><div class="grow"><b>${esc(custName(e.customerId))}</b><br><small class="muted">پارەی وەرگیراو${e.note?' · '+esc(e.note):''}</small></div><span class="pill good num">${fmt(e.amount)}</span></div>`).join('')
    :`<p class="empty">لەم ڕۆژەدا قەرز نەدراوە و پارەش وەرنەگیراوە.</p>`)+`</div></div>`;
  h+=`<div class="card"><h2>خەرجییەکان</h2><div class="list">`+(repExp.length?repExp.map(e=>`<div class="li"><div class="grow"><b>${esc(e.cat)}</b><br><small class="muted">${esc(SHIFT_NAME[+String(e.shiftKey).split('_')[1]]||'')}${e.note?' · '+esc(e.note):''}</small></div><span class="amt num">${fmt(e.amount)}</span><button class="icon" data-del="expense:${esc(e.id)}" aria-label="لابردن">×</button></div>`).join(''):`<p class="empty">لەم ڕۆژەدا خەرجی تۆمار نەکراوە.</p>`)+`</div></div>`;
  box.innerHTML=h;
}
function csvRow(a){return a.map(x=>{const s=x==null?'':String(x);return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}).join(',');}
async function exportCsv(){
  if(!REP||!REP.shifts.length) return toast('یەکەم ڕۆژێک بکەرەوە کە شەفتی تێدا پاشەکەوت کرابێت','warn');
  if(!dl) return toast('دابەزاندن لێرە بەردەست نییە','warn');
  const {d,shifts,calcs}=REP, R=repNumbers(), rows=[];
  rows.push(['Date',d]); rows.push([]);
  rows.push(['Fuel',...shifts.map(s=>'Shift '+s.no+' liters'),'Total liters','Amount IQD']);
  FUELS.forEach(f=>rows.push([f.n,...calcs.map(c=>c.fuelHas[f.k]?c.fuelL[f.k]:''),calcs.reduce((a,c)=>a+c.fuelL[f.k],0),calcs.reduce((a,c)=>a+c.fuelAmt[f.k],0)]));
  rows.push(['Total',...calcs.map(c=>c.totalL),R.totalL,R.totalAmt]); rows.push([]);
  rows.push(['Shift','Liters','Sales','Credit','Expenses','Cash']);
  R.perShift.forEach(x=>rows.push(['Shift '+x.s.no,x.l,x.amt,x.cr,x.ex,x.cash])); rows.push([]);
  rows.push(['Tank','Open','Delivered','Sold','Expected','Measured close','Difference']);
  R.tanks.forEach(x=>rows.push([FUEL[x.t.fuel].n,x.open,x.del,x.sold,x.expected,x.close,x.diff]));
  rows.push([]); rows.push(['Credit sales',R.creditAmt]); rows.push(['Payments received',R.payAmt]); rows.push(['Cash sales',R.cash]); rows.push(['Expenses',R.expAmt]); rows.push(['Cash in drawer',R.drawer]);
  try{await dl.save({filename:'daily-report-'+d+'.csv',data:'﻿'+rows.map(csvRow).join('\n')});}
  catch(e){if(!e||e.code!=='declined') toast('دابەزاندن سەرنەکەوت','bad');}
}

/* ---------- credit ---------- */
function renderCredit(){
  const box=$('#crBody'), bal=balances();
  if(!db){box.innerHTML=`<div class="card"><p class="empty">پەیوەندی بە داتابەیسەوە نییە.</p></div>`;return;}
  if(selCust){
    const c=customers.find(x=>x.id===selCust);
    if(!c){selCust=null;return renderCredit();}
    const b=bal[c.id]||0;
    const di=b>0?dueInfo(c.id):{next:null,overdue:false};
    const ents=allEntries().filter(e=>e.customerId===c.id).sort((a,b2)=>(b2.ts||0)-(a.ts||0));
    let h=`<div><button class="btn ghost" data-act="back">→ گەڕانەوە بۆ کڕیارەکان</button></div>
      <div class="card"><div class="hint"><h2>${esc(c.name)}</h2></div>
      <div class="tiles"><div class="tile key"><small>قەرزی ماوە (دینار)</small><b class="num">${fmt(b)}</b></div>
            <div class="tile"><small>کاتی دانەوە</small><b class="num">${di.next||'—'}</b>${di.overdue?'<span class="pill bad">کاتەکەی تێپەڕیوە</span>':''}</div></div>
      <p class="note">${c.phone?`ژمارەی مۆبایل: <span class="num">${esc(c.phone)}</span> · `:''}قەرزی کۆن: <span class="num">${fmt(N(c.open)||0)}</span></p></div>
      <div class="card"><h3>قەرزی نوێ</h3><div class="formgrid">
        <label class="fld"><span>بەروار</span><input class="in num" id="nDate" type="date" value="${today()}"></label>
        <label class="fld"><span>شەفت</span><select class="in" id="nShift"><option value="1">شەفتی یەکەم</option><option value="2">شەفتی دووەم</option></select></label>
        <label class="fld"><span>جۆر</span><select class="in" id="nFuel">${FUELS.map(f=>`<option value="${f.k}">${f.n}</option>`).join('')}<option value="cash">نەقد / شتی دیکە</option></select></label>
        <label class="fld"><span>چەند لیتر</span><input class="in num" id="nL" inputmode="decimal" dir="ltr"></label>
        <label class="fld"><span>بڕی پارە (دینار)</span><input class="in num" id="nAmt" inputmode="decimal" dir="ltr" placeholder="خۆکار دەژمێردرێت"></label>
        <label class="fld"><span>کاتی دانەوە</span><input class="in num" id="nDue" type="date"></label>
        <label class="fld"><span>تێبینی</span><input class="in" id="nNote"></label></div>
        <button class="btn primary" data-act="newcredit">قەرزەکە تۆمار بکە</button></div>
      <div class="card"><h3>وەرگرتنی پارە</h3><div class="formgrid">
        <label class="fld"><span>بڕی پارە (دینار)</span><input class="in num" id="pAmt" inputmode="decimal" dir="ltr"></label>
        <label class="fld"><span>بەروار</span><input class="in num" id="pDate" type="date" value="${today()}"></label>
        <label class="fld"><span>تێبینی</span><input class="in" id="pNote"></label></div>
        <button class="btn primary" data-act="pay">پارەکە تۆمار بکە</button></div>
      <div class="card"><h3>کەشف حساب</h3><div class="list">`+
      (ents.length?ents.map(e=>`<div class="li"><div class="grow"><b class="num">${esc(e.date)}</b><br><small class="muted">${e.kind==='sale'?`قەرز · ${credDesc(e)}`:`پارەی وەرگیراو${e.note?' · '+esc(e.note):''}`}</small></div>
        <span class="amt num ${e.kind==='sale'?'':'pill good'}">${e.kind==='sale'?'':'−'}${fmt(e.amount)}</span><button class="icon" data-del="credit:${esc(e.id)}" aria-label="لابردن">×</button></div>`).join('')
       :`<p class="empty">هێشتا هیچ قەرزێک یان پارەیەک تۆمار نەکراوە.</p>`)+`</div></div>
      <div class="card"><h3>سڕینەوەی کڕیار</h3><p class="note">کڕیارەکە لەگەڵ هەموو قەرز و پارە وەرگیراوەکانی دەسڕدرێتەوە و ناگەڕێتەوە.</p><button class="btn" data-del="cust:${esc(c.id)}">سڕینەوەی کڕیار و هەموو قەرزەکانی</button></div>`;
    box.innerHTML=h; return;
  }
  const total=customers.reduce((a,c)=>a+(bal[c.id]||0),0);
  const od=c=>((bal[c.id]||0)>0&&dueInfo(c.id).overdue)?1:0;
  const sorted=[...customers].sort((a,b)=>od(b)-od(a)||(bal[b.id]||0)-(bal[a.id]||0));
  let h=`<div class="tiles"><div class="tile key"><small>کۆی قەرزی ماوە (دینار)</small><b class="num">${fmt(total)}</b></div>
    <div class="tile"><small>ژمارەی کڕیار</small><b class="num">${customers.length}</b></div>
    <div class="tile"><small>کاتی دانەوەیان هاتووە</small><b class="num">${customers.filter(c=>od(c)).length}</b></div></div>
    <details class="card" ${customers.length?'':'open'}><summary>+ کڕیاری نوێ</summary><div class="formgrid">
      <label class="fld"><span>ناو</span><input class="in" id="cName" autocomplete="off"></label>
      <label class="fld"><span>ژمارەی مۆبایل</span><input class="in num" id="cPhone" inputmode="tel" dir="ltr"></label>
      <label class="fld"><span>قەرزی کۆن (دینار)</span><input class="in num" id="cOpen" inputmode="decimal" dir="ltr"></label></div>
      <button class="btn primary" data-act="addcust">کڕیارەکە زیاد بکە</button></details>
    <div class="card"><h2>کڕیارەکان</h2><div class="list">`+
    (sorted.length?sorted.map(c=>{const b=bal[c.id]||0;
      return `<button class="li" data-cust="${esc(c.id)}"><div class="grow"><b>${esc(c.name)}</b>${c.phone?`<br><small class="muted num">${esc(c.phone)}</small>`:''}</div>${b>0&&dueInfo(c.id).overdue?`<span class="pill bad">کاتی دانەوەی هاتووە</span>`:(b>0&&dueInfo(c.id).next?`<span class="pill">دانەوە <span class="num">${dueInfo(c.id).next}</span></span>`:'')}<span class="amt num">${fmt(b)}</span></button>`;}).join('')
      :`<p class="empty">هێشتا هیچ کڕیارێک تۆمار نەکراوە.</p>`)+`</div></div>`;
  box.innerHTML=h;
}
async function addCustomer(){
  const name=$('#cName').value.trim(); if(!name) return toast('ناوی کڕیار بنووسە','warn');
  await guard(async()=>{
    await db.collection('customers').add({name,phone:$('#cPhone').value.trim(),open:N($('#cOpen').value)||0,ts:Date.now()});
    await loadCustomers(); renderCredit(); toast('کڕیارەکە زیاد کرا');
  });
}
async function addPayment(){
  const amt=N($('#pAmt').value), date=$('#pDate').value||today();
  if(!(amt>0)) return toast('بڕی پارەکە بنووسە','warn');
  await guard(async()=>{
    const m=date.slice(0,7);
    if(!cfg.start||m<cfg.start) await saveCfg({start:m});
    await db.collection('credit').add({kind:'pay',customerId:selCust,date,m,amount:Math.round(amt),note:$('#pNote').value.trim(),ts:Date.now()});
    await refreshMonth(m); renderCredit(); toast('پارەکە تۆمار کرا');
  });
}
async function addCustomerCredit(){
  const date=$('#nDate').value||today(), no=+$('#nShift').value, fuel=$('#nFuel').value, l=N($('#nL').value), manual=N($('#nAmt').value), due=$('#nDue').value||null, note=$('#nNote').value.trim();
  let amount, price=null;
  if(fuel==='cash'){ if(!(manual>0)) return toast('بڕی پارەکە بنووسە','warn'); amount=Math.round(manual); }
  else{
    if(!(l>0)) return toast('چەند لیتر بنووسە','warn');
    price=N((priceFor(date+'_'+no)||cfg.prices||{})[fuel])||0;
    amount=manual>0?Math.round(manual):Math.round(l*price);
    if(!(amount>0)) return toast('نرخی '+FUEL[fuel].n+' لە بەشی نرخەکان دابنێ، یان بڕی پارەکە بنووسە','warn');
  }
  await guard(async()=>{
    const m=date.slice(0,7);
    if(!cfg.start||m<cfg.start) await saveCfg({start:m});
    await db.collection('credit').add({kind:'sale',customerId:selCust,date,m,shiftKey:date+'_'+no,fuel,liters:fuel==='cash'?null:l,price,amount,due,note,ts:Date.now()});
    await refreshMonth(m); renderCredit(); toast('قەرزەکە تۆمار کرا');
  });
}
async function doDelete(spec){
  const [kind,id]=spec.split(':');
  if(!db) return;
  if(kind==='expense'){
    await guard(async()=>{
      await db.doc('expenses/'+id).delete();
      if(view==='shift'){expenses=await loadExpenses(S.date);renderShiftExp();recalc();}
      else if(view==='report') await loadReport();
      toast('لابرا');
    });
    return;
  }
  if(kind==='price'){
    await guard(async()=>{
      await db.doc('prices/'+id).delete(); await loadPrices();
      const last=priceList[priceList.length-1]; if(last) await saveCfg({prices:last.prices});
      renderPrices(); toast('لابرا');
    });
    return;
  }
  if(kind==='cust'){
    await guard(async()=>{
      const ents=allEntries().filter(e=>e.customerId===id), months=[...new Set(ents.map(e=>e.m))];
      for(const e of ents) await db.doc('credit/'+e.id).delete();
      await db.doc('customers/'+id).delete();
      for(const m of months) await refreshMonth(m);
      selCust=null; await loadCustomers(); renderCredit(); toast('کڕیارەکە سڕایەوە');
    });
    return;
  }
  if(kind!=='credit') return;
  await guard(async()=>{
    const e=allEntries().find(x=>x.id===id);
    await db.doc('credit/'+id).delete();
    if(e) await refreshMonth(e.m);
    if(view==='credit') renderCredit(); else if(view==='shift'){renderShiftCredit();recalc();}
    toast('لابرا');
  });
}

/* ---------- prices ---------- */
function renderPrices(){
  const defNo=new Date().getHours()<15?1:2, base=priceFor(today()+'_'+defNo)||cfg.prices||{};
  const hist=[...priceList].reverse();
  let h=`<div class="card"><h2>گۆڕینی نرخ</h2><p class="note">کاتێک نرخی سوتەمەنی دەگۆڕدرێت، نرخی نوێ بنووسە و دیاری بکە لە کام شەفتەوە دەست پێبکات. شەفتە پێشووەکان ناگۆڕدرێن.</p>
    <div class="pgrid">`+FUELS.map(f=>`<label class="fld"><span>${f.n}</span><input class="in num" id="pp-${f.k}" inputmode="decimal" dir="ltr" value="${esc(base[f.k]==null?'':base[f.k])}"></label>`).join('')+
    `</div><div class="formgrid">
      <label class="fld"><span>لە بەرواری</span><input class="in num" id="ppDate" type="date" value="${today()}"></label>
      <label class="fld"><span>لە شەفتی</span><select class="in" id="ppShift"><option value="1" ${defNo===1?'selected':''}>شەفتی یەکەم</option><option value="2" ${defNo===2?'selected':''}>شەفتی دووەم</option></select></label></div>
    <button class="btn primary" id="priceSave">نرخی نوێ پاشەکەوت بکە</button></div>
    <div class="card"><h2>مێژووی نرخەکان</h2><div class="list">`+
    (hist.length?hist.map(p=>{const [d,no]=p.from.split('_');return `<div class="li"><div class="grow"><b class="num">${esc(d)}</b> · ${SHIFT_NAME[+no]||''}<br><small class="muted">${FUELS.filter(f=>N(p.prices[f.k])).map(f=>`${f.n} <span class="num">${fmt(N(p.prices[f.k]))}</span>`).join(' · ')}</small></div><button class="icon" data-del="price:${esc(p.id)}" aria-label="لابردن">×</button></div>`;}).join('')
      :`<p class="empty">هێشتا هیچ گۆڕانکارییەکی نرخ تۆمار نەکراوە.</p>`)+`</div></div>
    <div class="card"><h2>پەمپ و تانکییەکان</h2><div class="scroll"><table class="tbl" style="min-width:380px"><thead><tr><th>جۆر</th><th>پەمپەکان</th><th>تانک</th><th>گنجایش</th></tr></thead><tbody>`+
    FUELS.map(f=>`<tr><td>${sw(f.k)} ${f.n}</td><td class="num">${PUMPS.filter(p=>p.fuel===f.k).map(p=>p.no).join(' · ')}</td><td class="num">${TANKS.find(t=>t.fuel===f.k).no}</td><td class="num">50,000</td></tr>`).join('')+
    `</tbody></table></div><p class="note">هەر جۆرە سوتەمەنییەک تانکێکی تایبەت بە خۆی هەیە.</p></div>`;
  $('#prBody').innerHTML=h;
}
async function savePrices(){
  if(!db) return toast('پەیوەندی بە داتابەیسەوە نییە','bad');
  const p={}; FUELS.forEach(f=>{p[f.k]=N($('#pp-'+f.k).value);});
  if(!FUELS.some(f=>p[f.k])) return toast('نرخەکان بنووسە','warn');
  const date=$('#ppDate').value||today(), no=+$('#ppShift').value;
  await guard(async()=>{await savePriceEntry(date+'_'+no,p);renderPrices();toast('نرخی نوێ پاشەکەوت کرا');});
}

/* ---------- navigation & wiring ---------- */
const VIEWS=['shift','tanks','report','credit','prices'];
async function show(v){
  if(!VIEWS.includes(v)) v='shift';
  view=v;
  VIEWS.forEach(x=>{$('#v-'+x).hidden=x!==v;});
  $$('nav.tabs button').forEach(b=>{if(b.dataset.go===v) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current');});
  $('#act').hidden=!(v==='shift'||v==='tanks');
  $('#ctx').hidden=!(v==='shift'||v==='tanks');
  window.scrollTo(0,0);
  if(v==='report') loadReport();
  else if(v==='credit'){await guard(async()=>{await loadCustomers();await loadCredit();});renderCredit();}
  else if(v==='prices') renderPrices();
  else if(S&&v==='shift'){await guard(async()=>{await loadCustomers();await loadCredit();});renderShiftCredit();recalc();}
}
function pickShift(no,date){
  if(dirty){toast('یەکەم گۆڕانکارییەکانت پاشەکەوت بکە','warn');return;}
  openShift(date||S.date,no);
}
function wire(){
  $$('nav.tabs button').forEach(b=>b.addEventListener('click',()=>{if(location.hash.slice(1)===b.dataset.go) show(b.dataset.go); else location.hash=b.dataset.go;}));
  window.addEventListener('hashchange',()=>show(location.hash.slice(1)));
  $('#save').addEventListener('click',saveShift);
  $('#worker').addEventListener('input',e=>{S.worker=e.target.value;markDirty();});
  $('#shiftDate').addEventListener('change',e=>{
    if(!e.target.value) return;
    if(dirty){toast('یەکەم گۆڕانکارییەکانت پاشەکەوت بکە','warn');e.target.value=S.date;return;}
    openShift(e.target.value,S.no);
  });
  $$('.seg button').forEach(b=>b.addEventListener('click',()=>{const no=+b.dataset.shift; if(no!==S.no) pickShift(no);}));
  $$('.jump button').forEach(b=>b.addEventListener('click',()=>{const el=document.getElementById(b.dataset.jump); if(el) el.scrollIntoView({behavior:'smooth',block:'start'});}));
  $('#app').addEventListener('input',e=>{
    const t=e.target, id=t.id||''; let m;
    if((m=id.match(/^p([oc])-(p\d+)$/))) S.pumps[m[2]][m[1]]=t.value;
    else if((m=id.match(/^t([oc])-(t\d+)$/))) S.tanks[m[2]][m[1]]=t.value;
    else if((m=id.match(/^pr-(\w+)$/))) S.prices[m[1]]=t.value;
    else if(t.dataset.di!==undefined) S.deliveries[+t.dataset.di][t.dataset.f]=t.value;
    else return;
    markDirty(); recalc();
  });
  $('#app').addEventListener('change',e=>{
    const t=e.target;
    if(t.id==='chgFuel'){chgFuel=t.value;renderChg();return;}
    if(t.tagName==='SELECT'&&t.dataset.di!==undefined){S.deliveries[+t.dataset.di][t.dataset.f]=t.value;markDirty();recalc();}
  });
  $('#app').addEventListener('click',e=>{
    const b=e.target.closest('button'); if(!b) return;
    if(b.id==='delAdd'){S.deliveries.push({tank:TANKS[0].id,l:'',sup:'',ref:''});renderDel();markDirty();}
    else if(b.dataset.deldel!==undefined){S.deliveries.splice(+b.dataset.deldel,1);renderDel();markDirty();recalc();}
    else if(b.id==='crAdd') addShiftCredit();
    else if(b.id==='exAdd') addShiftExp();
    else if(b.id==='priceApply') applyPriceFromShift();
    else if(b.id==='cgApply') applyChg();
  });
  $('#app').addEventListener('keydown',e=>{
    if(e.key!=='Enter'||e.target.tagName!=='INPUT') return;
    const box=e.target.closest('#shiftBody,#tankBody'); if(!box) return;
    e.preventDefault();
    const all=$$('input.in',box), i=all.indexOf(e.target);
    if(i>=0&&i<all.length-1){all[i+1].focus();}
    else e.target.blur();
  });
  document.addEventListener('focusin',e=>{
    const t=e.target;
    if(t.tagName==='INPUT'&&t.type==='text'&&t.classList.contains('num')) setTimeout(()=>{try{t.select();}catch(_){}},0);
  });
  $('#repDate').value=today();
  $('#repDate').addEventListener('change',loadReport);
  $('#repPrev').addEventListener('click',()=>{$('#repDate').value=shiftDay($('#repDate').value||today(),1);loadReport();});
  $('#repNext').addEventListener('click',()=>{$('#repDate').value=shiftDay($('#repDate').value||today(),-1);loadReport();});
  $('#repCsv').addEventListener('click',exportCsv);
  $('#crBody').addEventListener('click',e=>{
    const c=e.target.closest('[data-cust]'); if(c){selCust=c.dataset.cust;renderCredit();window.scrollTo(0,0);return;}
    const a=e.target.closest('[data-act]'); if(!a) return;
    if(a.dataset.act==='back'){selCust=null;renderCredit();}
    else if(a.dataset.act==='addcust') addCustomer();
    else if(a.dataset.act==='pay') addPayment();
    else if(a.dataset.act==='newcredit') addCustomerCredit();
  });
  $('#prBody').addEventListener('click',e=>{if(e.target.id==='priceSave') savePrices();});
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-del]'); if(!b) return;
    if(!b.classList.contains('armed')){
      b.classList.add('armed'); b.dataset.t=b.textContent; b.textContent='دڵنیایت؟';
      setTimeout(()=>{b.classList.remove('armed'); if(b.dataset.t) b.textContent=b.dataset.t;},3000);
      return;
    }
    doDelete(b.dataset.del);
  });
}
async function connect(){
  try{
    db=await SB.open(); dl=SB.downloads;
  }catch(e){console.error(e);db=null;}
  const chip=$('#conn');
  chip.textContent=db?'پەیوەستە':'بێ پەیوەندی'; chip.className='chip '+(db?'good':'bad');
  if(db){
    await guard(async()=>{await loadCfg();await loadPrices();await loadCustomers();});
    await openShift(S.date,S.no);
  }else setStatus('nodb');
}
(function init(){
  const date=today(), no=new Date().getHours()<15?1:2;
  S=newState(date,no,null,null);
  $('#shiftDate').value=date; setSeg(no);
  wire(); buildShift(); setStatus('loading');
  const v=location.hash.slice(1);
  show(VIEWS.includes(v)?v:'shift');
  connect();
})();
