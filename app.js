import {initializeApp} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getDatabase,ref,onValue,get,update,push,runTransaction,
  query,orderByChild,limitToLast,increment,serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
import {firebaseConfig} from "./firebase-config.js";

const CONFIGURED=!!(firebaseConfig.databaseURL&&firebaseConfig.databaseURL!=='PASTE_HERE');
let db=null;
if(CONFIGURED){db=getDatabase(initializeApp(firebaseConfig));}

const CAP=50000;
const MIN_CODE=8;
const FUELS=[
  {id:'enz',name:'ئەنزەلی',sub:'',pumps:1,color:'var(--f-enz)'},
  {id:'gaz',name:'گاز',sub:'ئێرانی',pumps:2,color:'var(--f-gaz)'},
  {id:'super',name:'سوپەر',sub:'',pumps:2,color:'var(--f-super)'},
  {id:'mohsen',name:'محەسەن',sub:'',pumps:4,color:'var(--f-mohsen)'},
  {id:'normal',name:'نۆڕماڵ',sub:'',pumps:4,color:'var(--f-normal)'},
  {id:'lpg',name:'غاز',sub:'LPG',pumps:2,color:'var(--f-lpg)'}
];
const PUMPS=[];let pc=0;
FUELS.forEach((f,i)=>{f.idx=i;for(let k=0;k<f.pumps;k++){pc++;PUMPS.push({id:'p'+pc,n:pc,f:f.id});}});
const FBY={};FUELS.forEach(f=>{FBY[f.id]=f;});

const $=s=>document.querySelector(s);
const toEn=s=>String(s).replace(/[٠-٩]/g,d=>d.charCodeAt(0)-1632).replace(/[۰-۹]/g,d=>d.charCodeAt(0)-1776);
const num=s=>{const t=toEn(s).replace(/[^\d]/g,'');return t===''?'':Number(t);};
const fmt=n=>Math.round(n).toLocaleString('en-US');
const fmtM=n=>(n/1e6).toFixed(1);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const p2=n=>String(n).padStart(2,'0');
const dateStr=d=>d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());
const WD=['یەکشەممە','دووشەممە','سێشەممە','چوارشەممە','پێنجشەممە','هەینی','شەممە'];
const MN=['کانوونی دووەم','شوبات','ئازار','نیسان','ئایار','حوزەیران','تەمموز','ئاب','ئەیلوول','تشرینی یەکەم','تشرینی دووەم','کانوونی یەکەم'];
function niceDate(id){const [y,m,d]=id.split('-').map(Number);const dt=new Date(y,m-1,d);return WD[dt.getDay()]+'، '+d+'ی '+MN[m-1]+' '+y;}
function niceTime(ts){
  const d=typeof ts==='number'?new Date(ts):null;if(!d)return '';
  return p2(d.getHours())+':'+p2(d.getMinutes())+' · '+d.getDate()+'/'+(d.getMonth()+1);
}
/* ڕۆژی کار: شەفتی ١ (شەو) بۆ ڕۆژی دواتر دەژمێردرێت ئەگەر لە ١٨:٠٠ بەدواوە بکرێتەوە */
function labelFor(kind){const d=new Date();if(kind===1&&d.getHours()>=18)d.setDate(d.getDate()+1);return dateStr(d);}
const guessKind=()=>{const h=new Date().getHours();return (h>=22||h<9)?1:2;};

/* ---------- access code and paths ---------- */
const CK='fuel-access-code';
const readCode=()=>{try{return localStorage.getItem(CK)||'';}catch(e){return '';}};
const writeCode=v=>{try{if(v)localStorage.setItem(CK,v);else localStorage.removeItem(CK);}catch(e){}};
let code=readCode();
const P=p=>'s/'+code+'/'+p;
const R=p=>ref(db,P(p));
/* ڕێگای ناو داتابەیس: {p:'shifts/000001',id:'000001'} */
const D=(...p)=>({p:p.join('/'),id:p[p.length-1]});
const C=(...p)=>({p:p.join('/')});
const doc=c=>{const k=push(R(c.p)).key;return {p:c.p+'/'+k,id:k};};
/* چەند نووسینێک بە یەکجار و هاوکات (atomic) */
function writeBatch(){
  const o={};
  const put=(p,v)=>{o[P(p)]=v;};
  return {
    set(r,data,opt){if(opt&&opt.merge)Object.keys(data).forEach(k=>put(r.p+'/'+k,data[k]));else put(r.p,data);},
    update(r,data){Object.keys(data).forEach(k=>put(r.p+'/'+k.replace(/\./g,'/'),data[k]));},
    delete(r){put(r.p,null);},
    commit(){return update(ref(db),o);}
  };
}
const sid=n=>String(n).padStart(6,'0');

/* ---------- state ---------- */
const S={screen:'loading',cur:null,prev:null,vk:1,entries:[],customers:[],tab:'pumps',rmode:'day',hist:null,histKey:null,repDay:null,err:'',closeForce:false,viewKey:'',entFor:null};
const ui={delFuel:'normal',delLit:'',cName:'',cFuel:'normal',cLit:'',pCust:'',pAmt:'',xT:'exp',xA:'',xN:''};
const draft={};const timers={};
const unsubs={shift:null,ent:null,cust:null};

/* ---------- shift math ---------- */
function view(d){
  if(!S.cur||d.id!==S.cur.id)return d;
  const c=Object.assign({},d,{ends:Object.assign({},d.ends),prices:Object.assign({},d.prices),actual:Object.assign({},d.actual)});
  Object.keys(draft).forEach(k=>{
    const [a,b]=k.split('.');
    if(!c[a])return;
    if(draft[k]==='')delete c[a][b];else c[a][b]=draft[k];
  });
  return c;
}
function calcShift(d){
  const L={},A={};let tot=0;FUELS.forEach(f=>{L[f.id]=0;});
  PUMPS.forEach(p=>{
    const o=(d.openMeters||{})[p.id],e=(d.ends||{})[p.id];
    if(o!==undefined&&e!==undefined&&e>=o)L[p.f]+=e-o;
  });
  FUELS.forEach(f=>{A[f.id]=L[f.id]*(Number((d.prices||{})[f.id])||0);tot+=A[f.id];});
  return {L,A,tot};
}
function closingMeters(d){
  const m={};PUMPS.forEach(p=>{const e=(d.ends||{})[p.id];m[p.id]=e!==undefined?e:(d.openMeters||{})[p.id];});return m;
}
function closingTanks(d){
  const c=calcShift(d),t={};
  FUELS.forEach(f=>{
    const a=(d.actual||{})[f.id];
    t[f.id]=a!==undefined?a:((d.openTanks||{})[f.id]||0)+Number((d.deliv||{})[f.id]||0)-c.L[f.id];
  });
  return t;
}
function val(path){
  if(path in draft)return draft[path];
  const [a,b]=path.split('.');
  const o=S.cur&&S.cur[a];
  return (o&&o[b]!==undefined)?o[b]:'';
}
const price=fid=>Number(val('prices.'+fid))||0;
function litersOf(pid){const e=val('ends.'+pid);if(e==='')return null;return e-S.cur.openMeters[pid];}
function soldOf(fid){let t=0;PUMPS.forEach(p=>{if(p.f!==fid)return;const l=litersOf(p.id);if(l!==null&&l>0)t+=l;});return t;}
const delivered=fid=>Number((S.cur.deliv||{})[fid]||0);
const expected=fid=>(S.cur.openTanks[fid]||0)+delivered(fid)-soldOf(fid);
const owed=c=>{const a=c.totalSales||0,p=c.totalPaid||0;return {sales:a,paid:p,rest:a-p};};

function days(){
  const m=new Map();
  const all=(S.hist||[]).filter(d=>!S.cur||d.id!==S.cur.id);
  if(S.cur)all.push(S.cur);
  all.forEach(d=>{
    let e=m.get(d.dayNo);
    if(!e){e={dayNo:d.dayNo,label:d.dayLabel,s:{}};m.set(d.dayNo,e);}
    e.s[d.kind]=d;
  });
  return Array.from(m.values()).sort((a,b)=>b.dayNo-a.dayNo);
}
function dayStats(day){
  const sh=[1,2].map(k=>day.s[k]?view(day.s[k]):null);
  const cs=sh.map(s=>s?calcShift(s):null);
  const rows=[];let tl=0,ta=0;
  FUELS.forEach(f=>{
    const a=cs[0]?cs[0].L[f.id]:0,b=cs[1]?cs[1].L[f.id]:0;
    const m=(cs[0]?cs[0].A[f.id]:0)+(cs[1]?cs[1].A[f.id]:0);
    rows.push({f,a,b,l:a+b,m});tl+=a+b;ta+=m;
  });
  const sum=k=>sh.reduce((t,s)=>t+(s?(s[k]||0):0),0);
  const credit=sum('sumCredit'),paid=sum('sumDebtPay'),card=sum('sumCard'),exp=sum('sumExp');
  return {rows,tl,ta,credit,paid,card,exp,cash:ta-credit-card-exp+paid,sh};
}

/* ---------- status ---------- */
function status(msg){const el=$('#dayNote');if(el)el.textContent=msg||'';}
function onlineBadge(){$('#sync').hidden=navigator.onLine;}
addEventListener('online',onlineBadge);addEventListener('offline',onlineBadge);

/* ---------- writes ---------- */
const curRef=()=>D('shifts',S.cur.id);
const entRef=id=>id?D('entries',S.cur.id,id):doc(C('entries',S.cur.id));
function setField(path,value){
  draft[path]=value;clearTimeout(timers[path]);
  timers[path]=setTimeout(()=>commit(path),500);
}
async function commit(path){
  clearTimeout(timers[path]);
  if(!(path in draft)||!S.cur)return;
  const orig=draft[path];
  let v=orig;
  if(path.startsWith('prices.')&&v==='')v=0;
  try{
    await update(R('shifts/'+S.cur.id),{[path.replace('.','/')]:v===''?null:v});
    status('');
  }catch(e){status('پاشەکەوت نەکرا: '+(e.code||e.message));}
  if(path in draft&&draft[path]===orig)delete draft[path];
}
const flushDrafts=()=>Promise.all(Object.keys(draft).map(commit));

async function createFirstShift(prices,tankInit,meters,kind){
  const res=await runTransaction(R('shifts/'+sid(1)),cur=>{
    if(cur!==null)return;
    return {seq:1,kind,dayNo:1,dayLabel:labelFor(kind),status:'open',openMeters:meters,openTanks:tankInit,
      prices,sumCredit:0,sumCard:0,sumExp:0,sumDebtPay:0,openedAt:serverTimestamp()};
  });
  if(!res.committed)throw new Error('already');
}
async function closeShift(){
  await flushDrafts();
  const id=S.cur.id;
  const snap=await get(R('shifts/'+id));
  if(!snap.exists())throw new Error('missing');
  const d=snap.val();
  if(d.status!=='open')return;
  const ends={};
  PUMPS.forEach(p=>{ends[p.id]=(d.ends||{})[p.id]!==undefined?d.ends[p.id]:d.openMeters[p.id];});
  const dd=Object.assign({},d,{ends});
  const kind=d.kind===1?2:1;
  /* شەفتی نوێ تەنها یەک جار دروست دەبێت، ئەگەر دوو کەس هاوکات دایبخەن */
  await runTransaction(R('shifts/'+sid(d.seq+1)),cur=>{
    if(cur!==null)return;
    return {seq:d.seq+1,kind,dayNo:kind===1?d.dayNo+1:d.dayNo,dayLabel:kind===1?labelFor(1):d.dayLabel,
      status:'open',openMeters:closingMeters(dd),openTanks:closingTanks(dd),prices:d.prices,
      sumCredit:0,sumCard:0,sumExp:0,sumDebtPay:0,openedAt:serverTimestamp()};
  });
  await update(R('shifts/'+id),{ends,status:'closed',closedAt:serverTimestamp()});
}

/* ---------- subscriptions ---------- */
function stopAll(){Object.keys(unsubs).forEach(k=>{if(unsubs[k]){unsubs[k]();unsubs[k]=null;}});}
function subEntries(){
  if(unsubs.ent){unsubs.ent();unsubs.ent=null;}
  S.entries=[];S.entFor=S.cur?S.cur.id:null;
  if(!S.cur)return;
  unsubs.ent=onValue(R('entries/'+S.cur.id),s=>{
    const a=[];s.forEach(c=>{a.push({id:c.key,...c.val()});});
    S.entries=a.sort((x,y)=>(x.ts||Infinity)-(y.ts||Infinity));
    refresh();
  });
}
function startApp(){
  stopAll();S.screen='loading';S.cur=null;render();
  unsubs.shift=onValue(query(R('shifts'),orderByChild('seq'),limitToLast(2)),s=>{
    if(!s.exists()){S.cur=null;S.prev=null;S.screen='setup';render();return;}
    const arr=[];s.forEach(c=>{arr.push({id:c.key,...c.val()});});
    arr.sort((x,y)=>x.seq-y.seq);
    S.cur=arr[arr.length-1];
    S.prev=arr.length>1?arr[arr.length-2]:null;
    S.screen='app';
    if(S.entFor!==S.cur.id){subEntries();S.closeForce=false;S.vk=S.cur.kind;}
    refresh();
  },e=>{
    S.err='ناتوانرێت داتا بخوێنرێتەوە ('+(e.code||e.message)+'). کۆدەکە دەبێت وەک ئەوەی لە Rules نووسراوە بێت.';
    S.screen='code';render();
  });
  unsubs.cust=onValue(R('customers'),s=>{
    const a=[];s.forEach(c=>{a.push({id:c.key,...c.val()});});
    S.customers=a;
    if(S.screen==='app'&&S.tab==='credit')refresh();
  },()=>{});
}
async function loadHist(){
  const key=S.cur.seq;
  try{
    const snap=await get(query(R('shifts'),orderByChild('seq'),limitToLast(200)));
    const a=[];snap.forEach(c=>{a.push({id:c.key,...c.val()});});
    S.hist=a;S.histKey=key;
  }catch(e){S.hist=[];S.histKey=key;status('هەڵە: '+(e.code||e.message));}
  render();
}

/* ---------- views ---------- */
function fuelOptions(sel){return FUELS.map(f=>'<option value="'+f.id+'"'+(f.id===sel?' selected':'')+'>'+f.name+(f.sub?' ('+f.sub+')':'')+'</option>').join('');}

function vNoConfig(){
  return '<div class="card login"><h2>ڕێکخستنی Firebase تەواو نییە</h2><p class="hint">فایلی <b dir="ltr">firebase-config.js</b> بکەرەوە و زانیارییەکانی Firebase لە جێگەی <b dir="ltr">PASTE_HERE</b> دابنێ.</p></div>';
}
function vCode(){
  return '<div class="card login"><h2>کۆدی دەستپێگەیشتن</h2>'+
    '<p class="hint">کۆدێک بنووسە (لانیکەم '+MIN_CODE+' پیت یان ژمارە، درێژتر باشترە). هەر ٣ کەسەکە دەبێت هەمان کۆد بنووسن. تەنها یەک جار لەسەر هەر مۆبایلێک دەنووسرێت و دواتر لەسەر مۆبایلەکە دەمێنێتەوە. کەسێک کۆدەکە نەزانێت ناتوانێت داتاکان ببینێت. کۆدەکە لە GitHub مەنووسە.</p>'+
    '<label class="fld"><span>کۆد</span><input class="in" id="code-in" dir="ltr" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" style="text-align:left"></label>'+
    '<button class="btn" data-act="saveCode">بەردەوام بە</button><p class="msg bad" id="msg-code">'+esc(S.err)+'</p></div>';
}
function vSetup(){
  let h='<div class="card"><h2>ڕێکخستنی سەرەتایی</h2><p class="hint">تەنها یەک جار. ئەگەر ئەمە یەکەم جارتە، بەردەوام بە. ئەگەر پێشتر داتات تۆمار کردووە، کۆدەکەت هەڵەیە: دوگمەی «گۆڕینی کۆد» بەکاربهێنە (کۆدی ئێستا: <b class="n">'+esc(code.slice(0,3))+'•••</b>، '+code.length+' پیت).</p>'+
    '<label class="fld"><span>ئێستا کام شەفتە؟</span><select class="in" id="s-kind"><option value="1"'+(guessKind()===1?' selected':'')+'>شەفتی ١ (شەو)</option><option value="2"'+(guessKind()===2?' selected':'')+'>شەفتی ٢ (ڕۆژ)</option></select></label></div>';
  FUELS.forEach(f=>{
    h+='<section class="card" style="--fc:'+f.color+'"><div class="sub-h"><i></i>'+f.name+(f.sub?' ('+f.sub+')':'')+'</div><div class="form">'+
      '<label class="fld"><span>نرخی لیترێک (دینار)</span><input class="in" id="s-price-'+f.id+'" inputmode="numeric"></label>'+
      '<label class="fld"><span>ئاستی تانک (لیتر، زۆرینە '+fmt(CAP)+')</span><input class="in" id="s-tank-'+f.id+'" inputmode="numeric"></label></div><div class="grid2">';
    PUMPS.forEach(p=>{if(p.f===f.id)h+='<label class="fld"><span>میتەری ئێستای پەمپی '+p.n+'</span><input class="in" id="s-meter-'+p.id+'" inputmode="numeric"></label>';});
    h+='</div></section>';
  });
  return h+'<button class="btn" data-act="setup">پاشەکەوتکردن و دەستپێکردن</button><p class="msg" id="msg-setup"></p>';
}

/* شەفتەکانی ئەم ڕۆژە: {1: شەفتی شەو, 2: شەفتی ڕۆژ} (null ئەگەر هێشتا دەستی پێنەکردبێت) */
function dayShifts(){
  const m={1:null,2:null};
  if(S.cur)m[S.cur.kind]=S.cur;
  if(S.prev&&S.cur&&S.prev.dayNo===S.cur.dayNo&&S.prev.kind!==S.cur.kind)m[S.prev.kind]=S.prev;
  return m;
}
const viewShift=()=>dayShifts()[S.vk];
function shVal(sh,path){
  if(sh===S.cur)return val(path);
  const [a,b]=path.split('.');const o=sh[a];
  return (o&&o[b]!==undefined)?o[b]:'';
}
function shLit(sh,pid){const e=shVal(sh,'ends.'+pid);if(e==='')return null;return e-sh.openMeters[pid];}
const shPrice=(sh,fid)=>Number(shVal(sh,'prices.'+fid))||0;

function vPumps(){
  const sh=viewShift(),isCur=sh===S.cur;
  let h='<div class="seg" role="group" aria-label="شەفت">'+
    '<button data-act="shift" data-v="1" aria-pressed="'+(S.vk===1)+'"><b>شەفتی ١</b><small>١٠ی شەو تا ٩ی بەیانی</small></button>'+
    '<button data-act="shift" data-v="2" aria-pressed="'+(S.vk===2)+'"><b>شەفتی ٢</b><small>٩ی بەیانی تا ١٠ی شەو</small></button></div>';
  if(!sh){
    return h+'<div class="empty">شەفتی '+S.vk+'ی ئەم ڕۆژە هێشتا دەستی پێنەکردووە.<br>دوای داخستنی شەفتی ئێستا دەست پێدەکات.</div>';
  }
  h+='<div class="sum"><div class="stat"><small>کۆی لیتر</small><b class="n" id="sum-l">0</b></div>'+
    '<div class="stat"><small>کۆی پارە (دینار)</small><b class="n" id="sum-a">0</b></div></div>'+
    '<p class="note" id="sum-note"></p>';
  FUELS.forEach(f=>{
    h+='<section class="grp" style="--fc:'+f.color+'"><div class="grp-h"><span class="dot"></span>'+
      '<div class="grp-t"><b>'+f.name+'</b><small>'+(f.sub?f.sub+' · ':'')+f.pumps+' پەمپ</small></div>'+
      '<label class="price">نرخ <input class="in sm" id="price-'+f.id+'" inputmode="numeric" data-in="price" data-fid="'+f.id+'" value="'+shPrice(sh,f.id)+'"'+(isCur?'':' disabled')+'></label></div>'+
      '<div class="rows"><div class="prow h"><span>پەمپ</span><span style="text-align:center">سەرەتا</span><span style="text-align:center">کۆتایی</span><span style="text-align:center">لیتر</span></div>';
    PUMPS.forEach(p=>{
      if(p.f!==f.id)return;
      h+='<div class="prow"><span class="pn">'+p.n+'</span><span class="st n">'+sh.openMeters[p.id]+'</span>'+
        '<input class="in" id="e-'+p.id+'" inputmode="numeric" aria-label="کۆتایی پەمپی '+p.n+'" data-in="end" data-pid="'+p.id+'" value="'+shVal(sh,'ends.'+p.id)+'"'+(isCur?'':' disabled')+'>'+
        '<span class="lit n" id="l-'+p.id+'">—</span></div>';
    });
    h+='</div><div class="grp-f"><span>کۆ <b class="n" id="g-l-'+f.id+'">0</b> لیتر</span><span><b class="n" id="g-a-'+f.id+'">0</b> دینار</span></div></section>';
  });
  if(isCur){
    const next=S.cur.kind===1?2:1;
    h+='<div class="card"><h2>داخستنی شەفت</h2><p class="hint">کاتێک حساباتی ئەم شەفتە تەواو بوو دایبخە، با کاتژمێرەکە هەرچی بێت. ژمارەی کۆتایی هەر پەمپێک دەبێتە سەرەتای شەفتی دواتر و ئاستی تانکەکان دەگوازرێنەوە.</p>'+
      '<button class="btn" id="closeBtn" data-act="closeShift">'+(S.closeForce?'بەهەرحاڵ دابخە':'داخستنی شەفتی '+S.cur.kind+' و دەستپێکردنی شەفتی '+next)+'</button>'+
      '<p class="msg" id="msg-close"></p></div>';
  }
  return h;
}
function calcPumps(){
  const sh=viewShift();if(!sh)return;
  const isCur=sh===S.cur;
  let tl=0,ta=0,neg=0;
  FUELS.forEach(f=>{
    let gl=0;
    PUMPS.forEach(p=>{
      if(p.f!==f.id)return;
      const l=shLit(sh,p.id),c=document.getElementById('l-'+p.id),inp=document.getElementById('e-'+p.id);
      if(!c)return;
      if(l===null){c.textContent='—';c.className='lit n';if(inp)inp.classList.remove('err');}
      else{c.textContent=fmt(l);c.className='lit n'+(l<0?' bad':'');if(inp)inp.classList.toggle('err',l<0);if(l<0)neg++;else gl+=l;}
    });
    const m=gl*shPrice(sh,f.id);
    document.getElementById('g-l-'+f.id).textContent=fmt(gl);
    document.getElementById('g-a-'+f.id).textContent=fmt(m);
    tl+=gl;ta+=m;
  });
  $('#sum-l').textContent=fmt(tl);$('#sum-a').textContent=fmt(ta);
  const n=$('#sum-note');
  if(neg){n.className='note bad';n.textContent='ژمارەی کۆتایی لە ژمارەی سەرەتا کەمترە. دووبارە بیپشکنە.';}
  else if(!isCur){n.className='note';n.textContent='ئەم شەفتە داخراوە و تەنها دەتوانیت ببینیت. '+(sh.openedAt?'کراوەتەوە: '+niceTime(sh.openedAt):'');}
  else{n.className='note';n.textContent='لیتر = ژمارەی کۆتایی − ژمارەی سەرەتا. هەموو شتێک خۆکار دەژمێردرێت.';}
}
function syncPumps(){
  const sh=viewShift();if(!sh)return;
  if(sh===S.cur){
    const act=document.activeElement;
    PUMPS.forEach(p=>{const i=document.getElementById('e-'+p.id);if(i&&i!==act)i.value=val('ends.'+p.id);});
    FUELS.forEach(f=>{const i=document.getElementById('price-'+f.id);if(i&&i!==act)i.value=price(f.id);});
  }
  calcPumps();
}

function vTanks(){
  let h='<div class="card"><h2>هاتنی سوتەمەنی</h2><div class="form">'+
    '<label class="fld"><span>جۆر</span><select class="in" id="del-f" data-in="delFuel">'+fuelOptions(ui.delFuel)+'</select></label>'+
    '<label class="fld"><span>لیتری هاتوو</span><input class="in" id="del-l" inputmode="numeric" data-in="delLit" value="'+ui.delLit+'" placeholder="20000"></label>'+
    '<button class="btn full" data-act="addDel">زیادکردن بۆ تانک</button></div><p class="msg" id="msg-del"></p>';
  S.entries.filter(e=>e.kind==='delivery').forEach(e=>{h+='<div class="xrow"><span class="xt">'+esc(FBY[e.fuel].name)+'</span><span class="xn"></span><b class="n">+'+fmt(e.l)+'</b><button data-act="delEntry" data-id="'+e.id+'" aria-label="سڕینەوە">✕</button></div>';});
  h+='</div>';
  FUELS.forEach(f=>{
    const ex=expected(f.id),pct=Math.max(0,Math.min(100,ex/CAP*100)),dl=delivered(f.id),sold=soldOf(f.id),low=ex<CAP*0.2;
    h+='<section class="tank" style="--fc:'+f.color+'"><div class="tank-h"><span class="dot"></span>'+
      '<div><b>'+f.name+'</b><small>'+(f.sub?f.sub+' · ':'')+'تانک '+(f.idx+1)+' · '+fmt(CAP)+' لیتر</small></div>'+
      '<span class="pill '+(low?'low':'ok')+'">'+(low?'نزمە':Math.round(pct)+'٪')+'</span></div>'+
      '<div class="big"><span class="n">'+fmt(ex)+'</span> <small>لیتر ماوە بە حیساب</small></div>'+
      '<div class="bar"><i style="width:'+pct+'%"></i></div>'+
      '<div class="trio"><div><small>سەرەتای شەفت</small><span class="n">'+fmt(S.cur.openTanks[f.id]||0)+'</span></div>'+
      '<div><small>هاتوو</small><span class="n">+'+fmt(dl)+'</span></div>'+
      '<div><small>فرۆشراو</small><span class="n">−'+fmt(sold)+'</span></div></div>'+
      '<div class="form"><label class="fld"><span>پێوانی ڕاستەقینە (ئارەزوومەندانە)</span><input class="in" inputmode="numeric" data-in="actual" data-fid="'+f.id+'" value="'+val('actual.'+f.id)+'" placeholder="لیتر"></label>'+
      '<div class="fld"><span>جیاوازی</span><span class="diff" id="diff-'+f.id+'"></span></div></div></section>';
  });
  return h;
}
function calcDiff(fid){
  const el=document.getElementById('diff-'+fid);if(!el)return;
  const a=val('actual.'+fid);
  if(a===''){el.className='diff';el.textContent='—';return;}
  const dd=a-expected(fid);
  el.className='diff '+(Math.abs(dd)<=100?'ok':'bad');
  el.innerHTML='<span class="n">'+(dd>0?'+':dd<0?'−':'')+fmt(Math.abs(dd))+'</span> لیتر';
}

function vCredit(){
  let tot=0;S.customers.forEach(c=>{tot+=owed(c).rest;});
  const open=S.customers.filter(c=>owed(c).rest>0);
  if(!ui.pCust||!S.customers.some(c=>c.id===ui.pCust))ui.pCust=open.length?open[0].id:(S.customers[0]?S.customers[0].id:'');
  let h='<div class="sum"><div class="stat"><small>کڕیاری قەرزدار</small><b class="n">'+open.length+'</b></div>'+
    '<div class="stat"><small>کۆی قەرزی ماوە (دینار)</small><b class="n">'+fmt(tot)+'</b></div></div>'+
    '<div class="card"><h2>قەرزی نوێ</h2><div class="form">'+
    '<label class="fld full"><span>ناوی کڕیار</span><input class="in txt" id="c-name" list="custlist" data-in="cName" value="'+esc(ui.cName)+'" autocomplete="off"></label>'+
    '<datalist id="custlist">'+S.customers.map(c=>'<option value="'+esc(c.name)+'">').join('')+'</datalist>'+
    '<label class="fld"><span>جۆری سوتەمەنی</span><select class="in" id="c-fuel" data-in="cFuel">'+fuelOptions(ui.cFuel)+'</select></label>'+
    '<label class="fld"><span>لیتر</span><input class="in" id="c-lit" inputmode="numeric" data-in="cLit" value="'+ui.cLit+'" placeholder="50"></label>'+
    '<p class="note full" id="c-prev"></p>'+
    '<button class="btn full" data-act="addCredit">تۆمارکردنی قەرز</button></div><p class="msg" id="msg-cred"></p></div>'+
    '<div class="card"><h2>وەرگرتنەوەی قەرز</h2><div class="form">'+
    '<label class="fld full"><span>کڕیار</span><select class="in" id="p-cust" data-in="pCust">'+S.customers.map(c=>'<option value="'+c.id+'"'+(c.id===ui.pCust?' selected':'')+'>'+esc(c.name)+' — '+fmt(owed(c).rest)+'</option>').join('')+'</select></label>'+
    '<label class="fld"><span>بڕی وەرگیراو (دینار)</span><input class="in" id="p-amt" inputmode="numeric" data-in="pAmt" value="'+ui.pAmt+'" placeholder="100000"></label>'+
    '<div class="fld"><span>&nbsp;</span><button class="btn" data-act="pay">وەرگرتنەوە</button></div>'+
    '<button class="btn ghost full" data-act="payAll">هەموو قەرزەکە وەربگرە</button></div><p class="msg" id="msg-pay"></p></div>';
  const today=S.entries.filter(e=>e.kind==='credit'||e.kind==='debtpay');
  if(today.length){
    h+='<div class="card"><h2>تۆمارەکانی ئەم شەفتە</h2>';
    today.forEach(e=>{h+='<div class="xrow"><span class="xt">'+(e.kind==='credit'?'قەرز':'وەرگیرایەوە')+'</span><span class="xn">'+esc(e.custName||'')+(e.kind==='credit'?' · '+fmt(e.l)+' لیتر':'')+'</span><b class="n">'+fmt(e.a)+'</b><button data-act="delEntry" data-id="'+e.id+'" aria-label="سڕینەوە">✕</button></div>';});
    h+='</div>';
  }
  S.customers.slice().sort((a,b)=>owed(b).rest-owed(a).rest).forEach(c=>{
    const o=owed(c);
    h+='<section class="cust"><div class="cust-h"><b>'+esc(c.name)+'</b>'+
      (o.rest>0?'<span class="bal n">'+fmt(o.rest)+'</span>':'<span class="bal zero">قەرزی نەماوە</span>')+'</div>'+
      '<div class="cust-d"><div><small>لیتری وەرگیراو</small><span class="n">'+fmt(c.totalLiters||0)+'</span></div>'+
      '<div><small>کۆی قەرز</small><span class="n">'+fmt(o.sales)+'</span></div>'+
      '<div><small>دراوەتەوە</small><span class="n">'+fmt(o.paid)+'</span></div></div></section>';
  });
  return h;
}
function calcPrev(){
  const el=document.getElementById('c-prev');if(!el)return;
  const l=ui.cLit===''?0:Number(ui.cLit),p=price(ui.cFuel);
  el.innerHTML=l>0?'بڕی قەرز: <b class="n">'+fmt(l*p)+'</b> دینار (نرخ <span class="n">'+fmt(p)+'</span>)':'نرخی ئێستا: <span class="n">'+fmt(p)+'</span> دینار بۆ هەر لیترێک';
}

function extraHTML(){
  let h='<div class="card"><h2>خەرجی و پارەدان بە کارت</h2><p class="hint">بۆ شەفتی ئێستا تۆمار دەکرێت.</p><div class="form">'+
    '<label class="fld"><span>جۆر</span><select class="in" id="x-t" data-in="xT"><option value="exp"'+(ui.xT==='exp'?' selected':'')+'>خەرجی</option><option value="card"'+(ui.xT==='card'?' selected':'')+'>پارەدان بە کارت</option></select></label>'+
    '<label class="fld"><span>بڕ (دینار)</span><input class="in" id="x-a" inputmode="numeric" data-in="xA" value="'+ui.xA+'"></label>'+
    '<label class="fld full"><span>تێبینی</span><input class="in txt" id="x-n" data-in="xN" value="'+esc(ui.xN)+'" autocomplete="off"></label>'+
    '<button class="btn full" data-act="addExtra">تۆمارکردن</button></div><p class="msg" id="msg-x"></p>';
  S.entries.filter(e=>e.kind==='exp'||e.kind==='card').forEach(e=>{
    h+='<div class="xrow"><span class="xt">'+(e.kind==='exp'?'خەرجی':'کارت')+'</span><span class="xn">'+esc(e.n||'بێ تێبینی')+'</span><b class="n">'+fmt(e.a)+'</b>'+
      '<button data-act="delEntry" data-id="'+e.id+'" aria-label="سڕینەوە">✕</button></div>';
  });
  return h+'</div>';
}
function cashHTML(s){
  return '<div class="cash"><div><span>کۆی فرۆشتن</span><b class="n">'+fmt(s.ta)+'</b></div>'+
    '<div><span>قەرزی دراو</span><b class="n">−'+fmt(s.credit)+'</b></div>'+
    '<div><span>قەرزی وەرگیراوەتەوە</span><b class="n">+'+fmt(s.paid)+'</b></div>'+
    '<div><span>پارەدان بە کارت</span><b class="n">−'+fmt(s.card)+'</b></div>'+
    '<div><span>خەرجی</span><b class="n">−'+fmt(s.exp)+'</b></div>'+
    '<div class="final"><span>پارەی نەقد</span><b class="n">'+fmt(s.cash)+'</b></div></div>';
}

function vReport(){
  if(S.histKey!==S.cur.seq){loadHist();return '<div class="empty">بارکردن...</div>';}
  const ds=days();
  const sel=ds.find(d=>d.dayNo===S.repDay)||ds[0];
  const isCur=sel.dayNo===S.cur.dayNo;
  const m=S.rmode;
  let h='<div class="seg" role="group" aria-label="جۆری ڕاپۆرت">'+
    '<button data-act="rmode" data-v="day" aria-pressed="'+(m==='day')+'"><b>ڕۆژانە</b></button>'+
    '<button data-act="rmode" data-v="month" aria-pressed="'+(m==='month')+'"><b>مانگانە</b></button></div>'+
    '<label class="fld"><span>'+(m==='day'?'ڕۆژ':'مانگ بەپێی ئەم ڕۆژە')+'</span><select class="in day" id="rep-day" data-in="repDay">'+
    ds.map(d=>'<option value="'+d.dayNo+'"'+(d.dayNo===sel.dayNo?' selected':'')+'>'+niceDate(d.label)+(d.dayNo===S.cur.dayNo?' (ئێستا)':'')+'</option>').join('')+'</select></label>';
  if(m==='day'){
    const s=dayStats(sel);
    h+='<div class="tbl"><div class="tr h"><span>جۆر</span><span>شەفتی ١</span><span>شەفتی ٢</span><span>کۆ (لیتر)</span><span>پارە (دینار)</span></div>';
    s.rows.forEach(r=>{h+='<div class="tr" style="--fc:'+r.f.color+'"><span class="fn"><i></i>'+r.f.name+'</span><span class="n">'+fmt(r.a)+'</span><span class="n">'+fmt(r.b)+'</span><b class="n">'+fmt(r.l)+'</b><span class="n">'+fmt(r.m)+'</span></div>';});
    h+='<div class="tr t"><span>کۆی گشتی</span><span></span><span></span><span class="n">'+fmt(s.tl)+'</span><span class="n">'+fmt(s.ta)+'</span></div></div>'+cashHTML(s);
    if(isCur)h+=extraHTML();
    const last=s.sh[1]||s.sh[0];
    if(last){
      const ct=closingTanks(last);
      h+='<div class="tbl"><div class="tr m h"><span>تانک</span><span>ماوە (لیتر)</span><span>پێوانی ڕاستەقینە</span></div>';
      FUELS.forEach(f=>{const a=(last.actual||{})[f.id];
        h+='<div class="tr m" style="--fc:'+f.color+'"><span class="fn"><i></i>'+f.name+'</span><b class="n">'+fmt(closingTanks(Object.assign({},last,{actual:{}}))[f.id])+'</b><span class="n">'+(a===undefined?'—':fmt(a))+'</span></div>';});
      h+='</div>';
    }
  }else{
    const key=sel.label.slice(0,7);
    const md=ds.filter(d=>d.label.slice(0,7)===key).sort((a,b)=>a.dayNo-b.dayNo);
    const st=md.map(d=>({d,s:dayStats(d)}));
    const mx=Math.max.apply(null,st.map(x=>x.s.ta).concat([1]));
    const tot={ta:0,credit:0,paid:0,card:0,exp:0,cash:0};
    st.forEach(x=>{Object.keys(tot).forEach(k=>{tot[k]+=x.s[k];});});
    h+='<div class="card"><h2>فرۆشتنی ڕۆژانە <small style="font-weight:400;color:var(--muted);font-size:12.5px">(ملیۆن دینار)</small></h2><div class="chart axis">';
    st.forEach(x=>{h+='<div class="col'+(x.d.dayNo===sel.dayNo?' now':'')+'"><span>'+fmtM(x.s.ta)+'</span><i style="height:'+Math.max(2,x.s.ta/mx*78)+'%"></i><em>'+Number(x.d.label.slice(8))+'</em></div>';});
    h+='</div></div><div class="tbl"><div class="tr m h"><span>جۆر</span><span>لیتر</span><span>پارە (دینار)</span></div>';
    let sumL=0;
    FUELS.forEach(f=>{
      let l=0,a=0;st.forEach(x=>{const r=x.s.rows[f.idx];l+=r.l;a+=r.m;});sumL+=l;
      h+='<div class="tr m" style="--fc:'+f.color+'"><span class="fn"><i></i>'+f.name+'</span><span class="n">'+fmt(l)+'</span><span class="n">'+fmt(a)+'</span></div>';
    });
    h+='<div class="tr m t"><span>کۆی مانگ</span><span class="n">'+fmt(sumL)+'</span><span class="n">'+fmt(tot.ta)+'</span></div></div>'+cashHTML(tot);
  }
  return h;
}

/* ---------- render ---------- */
function viewKey(){return [S.screen,S.tab,S.vk,S.cur?S.cur.id:'',S.prev?S.prev.id:'',S.rmode,S.repDay,S.histKey,S.hist?1:0].join('|');}
function render(scroll){
  document.body.dataset.screen=S.screen;
  $('#codeBtn').hidden=!(code&&S.screen!=='code');
  let html,who='';
  if(!CONFIGURED)html=vNoConfig();
  else if(S.screen==='loading')html='<div class="empty">بارکردن...</div>';
  else if(S.screen==='code')html=vCode();
  else if(S.screen==='setup')html=vSetup();
  else{
    who=niceDate(S.cur.dayLabel);
    html=({pumps:vPumps,tanks:vTanks,credit:vCredit,report:vReport})[S.tab]();
  }
  $('#who').textContent=who;
  $('#view').innerHTML=html;
  document.querySelectorAll('.tab').forEach(b=>b.setAttribute('aria-selected',String(S.screen==='app'&&b.dataset.v===S.tab)));
  if(S.screen==='app'){
    if(S.tab==='pumps')calcPumps();
    if(S.tab==='tanks')FUELS.forEach(f=>calcDiff(f.id));
    if(S.tab==='credit')calcPrev();
  }
  S.viewKey=viewKey();
  if(scroll)window.scrollTo(0,0);
}
function refresh(){
  if(S.screen!=='app'){render();return;}
  if(viewKey()!==S.viewKey){render();return;}
  if(S.tab==='pumps'){syncPumps();return;}
  const a=document.activeElement;
  if(a&&a.matches&&a.matches('input,select')&&$('#view').contains(a))return;
  render();
}
function say(id,txt,cls){const el=document.getElementById(id);if(el){el.textContent=txt;el.className='msg '+(cls||'');}}

/* ---------- actions ---------- */
document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-act]');if(!b)return;
  const a=b.dataset.act,v=b.dataset.v;
  if(a==='tab'){if(S.screen==='app'){S.tab=v;S.closeForce=false;render(true);}return;}
  if(a==='rmode'){S.rmode=v;render(false);return;}
  if(a==='shift'){S.vk=Number(v);S.closeForce=false;render(false);return;}
  if(a==='saveCode'){
    const c=($('#code-in').value||'').trim();
    if(c.length<MIN_CODE){say('msg-code','کۆدەکە دەبێت لانیکەم '+MIN_CODE+' پیت یان ژمارە بێت.','bad');return;}
    if(c.indexOf('/')>=0){say('msg-code','نیشانەی / ڕێگەپێنەدراوە.','bad');return;}
    code=c;writeCode(c);S.err='';startApp();return;
  }
  if(a==='changeCode'){
    if(b.dataset.sure!=='1'){b.dataset.sure='1';b.textContent='دڵنیایی؟';setTimeout(()=>{b.dataset.sure='';b.textContent='گۆڕینی کۆد';},3000);return;}
    stopAll();writeCode('');code='';S.cur=null;S.hist=null;S.histKey=null;S.screen='code';b.dataset.sure='';b.textContent='گۆڕینی کۆد';render();return;
  }
  if(a==='setup'){
    const prices={},tankInit={},meters={};let bad=false;
    FUELS.forEach(f=>{
      const p=num($('#s-price-'+f.id).value),t=num($('#s-tank-'+f.id).value);
      if(p===''||t===''||t>CAP)bad=true;prices[f.id]=p;tankInit[f.id]=t;
    });
    PUMPS.forEach(p=>{const m=num($('#s-meter-'+p.id).value);if(m==='')bad=true;meters[p.id]=m;});
    if(bad){say('msg-setup','هەموو خانەکان پڕ بکەرەوە. ئاستی تانک نابێت لە '+fmt(CAP)+' زیاتر بێت.','bad');return;}
    b.disabled=true;
    try{await createFirstShift(prices,tankInit,meters,Number($('#s-kind').value));}
    catch(err){b.disabled=false;say('msg-setup',err.message==='already'?'پێشتر ڕێکخراوە.':'پاشەکەوت نەکرا: '+(err.code||err.message),'bad');}
    return;
  }
  if(S.screen!=='app')return;
  try{
    if(a==='closeShift'){
      await flushDrafts();
      const v2=view(S.cur);
      const miss=PUMPS.filter(p=>(v2.ends||{})[p.id]===undefined),negs=PUMPS.filter(p=>{const e=(v2.ends||{})[p.id];return e!==undefined&&e<v2.openMeters[p.id];});
      if(negs.length){say('msg-close','کۆتایی ئەم پەمپانە لە سەرەتا کەمترە: '+negs.map(p=>p.n).join('، '),'bad');return;}
      if(miss.length&&!S.closeForce){
        S.closeForce=true;$('#closeBtn').textContent='بەهەرحاڵ دابخە';
        say('msg-close','کۆتایی ئەم پەمپانە نەنووسراوە: '+miss.map(p=>p.n).join('، ')+'. ئەگەر دایبخەیت وەک «بێ فرۆشتن» دەژمێردرێن.','bad');return;
      }
      b.disabled=true;
      try{await closeShift();S.closeForce=false;S.tab='pumps';window.scrollTo(0,0);}
      catch(err){b.disabled=false;say('msg-close','داخستن سەرنەکەوت (ئینتەرنێتت هەیە؟): '+(err.code||err.message),'bad');}
      return;
    }
    const batch=()=>writeBatch(db);
    if(a==='addDel'){
      const l=ui.delLit===''?0:Number(ui.delLit);
      if(!(l>0)){say('msg-del','لیتری هاتوو بنووسە.','bad');return;}
      const free=CAP-expected(ui.delFuel);
      if(l>free){say('msg-del','تانکەکە ئەم بڕەی ناگرێت. تەنها '+fmt(Math.max(0,free))+' لیتر شوێنی ماوە.','bad');return;}
      const wb=batch();
      wb.set(entRef(),{kind:'delivery',fuel:ui.delFuel,l,ts:serverTimestamp()});
      wb.update(curRef(),{['deliv.'+ui.delFuel]:increment(l)});
      ui.delLit='';await wb.commit();
    }else if(a==='addCredit'){
      const nm=ui.cName.trim(),l=ui.cLit===''?0:Number(ui.cLit);
      if(!nm){say('msg-cred','ناوی کڕیار بنووسە.','bad');return;}
      if(!(l>0)){say('msg-cred','لیترەکە بنووسە.','bad');return;}
      const ex=S.customers.find(c=>c.name.trim().toLowerCase()===nm.toLowerCase());
      const cref=ex?D('customers',ex.id):doc(C('customers'));
      const amt=l*price(ui.cFuel);
      const wb=batch();
      wb.set(cref,{name:ex?ex.name:nm,totalSales:increment(amt),totalLiters:increment(l),totalPaid:increment(0)},{merge:true});
      wb.set(entRef(),{kind:'credit',cust:cref.id,custName:ex?ex.name:nm,fuel:ui.cFuel,l,a:amt,ts:serverTimestamp()});
      wb.update(curRef(),{sumCredit:increment(amt)});
      ui.cName='';ui.cLit='';await wb.commit();
    }else if(a==='pay'||a==='payAll'){
      const cu=S.customers.find(c=>c.id===ui.pCust);
      if(!cu){say('msg-pay','کڕیارێک هەڵبژێرە.','bad');return;}
      const rest=owed(cu).rest,pay=a==='payAll'?rest:(ui.pAmt===''?0:Number(ui.pAmt));
      if(!(pay>0)){say('msg-pay',a==='payAll'?'ئەم کڕیارە قەرزی نەماوە.':'بڕی وەرگیراو بنووسە.','bad');return;}
      if(pay>rest){say('msg-pay','بڕەکە زیاترە لە قەرزی ماوە ('+fmt(rest)+' دینار).','bad');return;}
      const wb=batch();
      wb.update(D('customers',cu.id),{totalPaid:increment(pay)});
      wb.set(entRef(),{kind:'debtpay',cust:cu.id,custName:cu.name,a:pay,ts:serverTimestamp()});
      wb.update(curRef(),{sumDebtPay:increment(pay)});
      ui.pAmt='';await wb.commit();
    }else if(a==='addExtra'){
      const x=ui.xA===''?0:Number(ui.xA);
      if(!(x>0)){say('msg-x','بڕەکە بنووسە.','bad');return;}
      const wb=batch();
      wb.set(entRef(),{kind:ui.xT,a:x,n:ui.xN.trim(),ts:serverTimestamp()});
      wb.update(curRef(),{[ui.xT==='exp'?'sumExp':'sumCard']:increment(x)});
      ui.xA='';ui.xN='';await wb.commit();
    }else if(a==='delEntry'){
      if(b.dataset.sure!=='1'){
        b.dataset.sure='1';const old=b.textContent;b.textContent='دڵنیایی؟';
        setTimeout(()=>{b.dataset.sure='';b.textContent=old;},3000);return;
      }
      const en=S.entries.find(x=>x.id===b.dataset.id);if(!en)return;
      const wb=batch();
      if(en.kind==='delivery')wb.update(curRef(),{['deliv.'+en.fuel]:increment(-en.l)});
      else if(en.kind==='exp')wb.update(curRef(),{sumExp:increment(-en.a)});
      else if(en.kind==='card')wb.update(curRef(),{sumCard:increment(-en.a)});
      else if(en.kind==='credit'){
        wb.update(curRef(),{sumCredit:increment(-en.a)});
        wb.set(D('customers',en.cust),{totalSales:increment(-en.a),totalLiters:increment(-en.l)},{merge:true});
      }else if(en.kind==='debtpay'){
        wb.update(curRef(),{sumDebtPay:increment(-en.a)});
        wb.set(D('customers',en.cust),{totalPaid:increment(-en.a)},{merge:true});
      }
      wb.delete(entRef(en.id));
      await wb.commit();return;
    }else return;
    render(false);
    const ok={addDel:['msg-del','هاتنی سوتەمەنی تۆمار کرا.'],addCredit:['msg-cred','قەرزەکە تۆمار کرا.'],pay:['msg-pay','وەرگرتنەوە تۆمار کرا.'],payAll:['msg-pay','وەرگرتنەوە تۆمار کرا.'],addExtra:['msg-x','تۆمار کرا.']}[a];
    if(ok)say(ok[0],ok[1],'ok');
  }catch(err){status('پاشەکەوت نەکرا: '+(err.code||err.message));}
});

function cleanNum(el){const n=num(el.value);if(el.value!==String(n))el.value=n;return n;}
document.addEventListener('input',e=>{
  const el=e.target,k=el.dataset.in;if(!k)return;
  if(k==='end'){setField('ends.'+el.dataset.pid,cleanNum(el));calcPumps();}
  else if(k==='price'){setField('prices.'+el.dataset.fid,cleanNum(el));calcPumps();}
  else if(k==='actual'){setField('actual.'+el.dataset.fid,cleanNum(el));calcDiff(el.dataset.fid);}
  else if(k==='repDay'){S.repDay=Number(el.value);render(false);}
  else if(k==='delLit'||k==='cLit'||k==='pAmt'||k==='xA'){const n=cleanNum(el);ui[k]=n===''?'':String(n);if(k==='cLit')calcPrev();}
  else{ui[k]=el.value;if(k==='cFuel')calcPrev();}
});
document.addEventListener('change',e=>{
  const el=e.target,k=el.dataset.in;if(!k)return;
  if(k==='end')commit('ends.'+el.dataset.pid);
  else if(k==='price')commit('prices.'+el.dataset.fid);
  else if(k==='actual')commit('actual.'+el.dataset.fid);
});
addEventListener('pagehide',()=>{Object.keys(draft).forEach(p=>commit(p));});

/* ---------- start ---------- */
onlineBadge();
if(!CONFIGURED){render();}
else if(code.length>=MIN_CODE){startApp();}
else{S.screen='code';render();}
