/* Supabase adapter: gives the app the same db.doc()/db.collection() API it used before.
   All documents live in one table: public.docs (path, col, data jsonb). */
(function(){
  const SUPABASE_URL='https://kkrzzdxsbbahsdblxeuk.supabase.co';
  const SUPABASE_KEY='sb_publishable_A7WUrQDc5qJR3QYTOL53tg_rQ9sL-SJ'; // publishable key: safe in the browser
  const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
  const T='docs';
  const colOf=p=>p.split('/')[0];
  const idOf=p=>p.slice(p.indexOf('/')+1);
  const fail=e=>{ if(e){ const err=new Error(e.message||'supabase error'); err.code=e.code; throw err; } };
  const snap=row=>({id:idOf(row.path),exists:true,data:()=>row.data});
  const newId=()=>(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2,10));
  const OPS={'==':'eq','<':'lt','<=':'lte','>':'gt','>=':'gte'};

  function query(col,filters,order,lim){
    return {
      where(f,op,v){return query(col,filters.concat([[f,op,v]]),order,lim);},
      orderBy(f,dir){return query(col,filters,{f,dir:dir||'asc'},lim);},
      limit(n){return query(col,filters,order,n);},
      async get(){
        let q=sb.from(T).select('path,data').eq('col',col);
        filters.forEach(([f,op,v])=>{q=q[OPS[op]]('data->>'+f,String(v));});
        if(order) q=q.order('data->>'+order.f,{ascending:order.dir!=='desc'});
        if(lim) q=q.limit(lim);
        const {data,error}=await q; fail(error);
        const docs=(data||[]).map(snap);
        return {docs,empty:docs.length===0,size:docs.length};
      },
      async add(obj){
        const id=newId();
        await ref(col+'/'+id).set(obj);
        return {id};
      }
    };
  }
  function ref(path){
    return {
      id:idOf(path),
      async get(){
        const {data,error}=await sb.from(T).select('path,data').eq('path',path).maybeSingle(); fail(error);
        return data?snap(data):{id:idOf(path),exists:false,data:()=>undefined};
      },
      async set(obj){
        const {error}=await sb.from(T).upsert({path,col:colOf(path),data:obj,updated_at:new Date().toISOString()}); fail(error);
      },
      async update(patch){
        const cur=await this.get();
        if(!cur.exists){const e=new Error('not found');e.code='not_found';throw e;}
        await this.set({...cur.data(),...patch});
      },
      async delete(){
        const {error}=await sb.from(T).delete().eq('path',path); fail(error);
      }
    };
  }
  const db={doc:ref,collection:col=>query(col,[],null,null)};

  const downloads={async save({filename,data}){
    const blob=new Blob([data],{type:'text/csv;charset=utf-8'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob); a.download=filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  }};

  /* ---------- login ---------- */
  function loginScreen(){
    return new Promise(resolve=>{
      const o=document.createElement('div');
      o.style.cssText='position:fixed;inset:0;z-index:100;background:var(--bg);display:flex;align-items:center;justify-content:center;padding:16px';
      o.innerHTML=`<form class="card" style="width:100%;max-width:380px" dir="rtl" lang="ckb">
        <h2>چوونەژوورەوە</h2>
        <label class="fld"><span>ئیمەیڵ</span><input id="lgE" class="in num" type="email" autocomplete="username" required></label>
        <label class="fld"><span>وشەی نهێنی</span><input id="lgP" class="in num" type="password" autocomplete="current-password" required></label>
        <p id="lgM" class="note" role="alert"></p>
        <button class="btn primary" type="submit">چوونەژوورەوە</button></form>`;
      document.body.appendChild(o);
      const f=o.querySelector('form'), m=o.querySelector('#lgM'), b=f.querySelector('button');
      f.addEventListener('submit',async ev=>{
        ev.preventDefault(); b.disabled=true; m.textContent='';
        const {error}=await sb.auth.signInWithPassword({email:o.querySelector('#lgE').value.trim(),password:o.querySelector('#lgP').value});
        b.disabled=false;
        if(error){m.textContent='ئیمەیڵ یان وشەی نهێنی هەڵەیە';return;}
        o.remove(); resolve();
      });
    });
  }
  async function open(){
    const {data}=await sb.auth.getSession();
    if(!data.session) await loginScreen();
    return db;
  }
  window.SB={open,downloads,client:sb,logout:()=>sb.auth.signOut().then(()=>location.reload())};
})();
