/* =====================================================================
   桃園市交通局 派工管理系統 × 改善成果地圖 外掛模組 (map-addon.js)
   安裝：在 index.html 的 </body> 前加入一行
         <script type="module" src="./map-addon.js"></script>
   功能：1) 全站 UI 優化  2) 道路考評數量統計新增「改善成果地圖」分頁
   不修改原系統任何資料與權限邏輯；地圖資料存於新集合 mapFeatures / mapStyles / mapRoads
   ===================================================================== */
import {collection,doc,setDoc,deleteDoc,getDocs,onSnapshot} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
const W=window,$=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const PAL=['#e5484d','#f59f00','#2f9e44','#1971c2','#9c36b5','#0ca678','#e8590c','#495057','#d6336c','#1098ad'];
const EDIT_ROLES=['系統管理員','機關/監造'];
const canEdit=()=>EDIT_ROLES.includes(W.currentUser?.role);
const uid=()=>'m'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);

/* ---------------- 1. UI 優化（純樣式，不動原功能） ---------------- */
const font=document.createElement('link');font.rel='stylesheet';font.href='https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&display=swap';document.head.appendChild(font);
const st=document.createElement('style');st.textContent=`
body{font-family:'Noto Sans TC','PingFang TC','Microsoft JhengHei',system-ui,sans-serif!important;background:#eef2f7!important;letter-spacing:.01em}
#sidebar{background:linear-gradient(185deg,#0b1220 0%,#16213a 60%,#1b2a4a 100%)!important}
#sidebar nav button{border-radius:12px!important;font-weight:500;color:#cbd5e1;transition:all .18s}
#sidebar nav button:hover{background:rgba(129,140,248,.16)!important;color:#fff;transform:translateX(2px)}
#sidebar nav button.nav-active{background:linear-gradient(90deg,rgba(99,102,241,.38),rgba(99,102,241,.08))!important;color:#fff;box-shadow:inset 3px 0 0 #818cf8}
main>header{background:rgba(255,255,255,.86)!important;backdrop-filter:blur(10px);box-shadow:0 1px 0 #e2e8f0!important}
#page-title{font-weight:900!important;background:linear-gradient(90deg,#1e293b,#4338ca);-webkit-background-clip:text;background-clip:text;color:transparent}
.bg-white.rounded-xl,.bg-white.rounded-2xl{box-shadow:0 1px 2px rgba(15,23,42,.04),0 4px 16px rgba(15,23,42,.05)!important;border-color:#e6ebf2!important}
table thead th{font-size:12px;letter-spacing:.04em;color:#475569;text-transform:none}
table tbody tr{transition:background .12s}
button{transition:filter .15s,transform .1s,background-color .15s}
button:active{transform:scale(.98)}
.tab-btn{border-radius:999px!important;font-size:13px}
input:focus,select:focus,textarea:focus{box-shadow:0 0 0 3px rgba(99,102,241,.18)}
::-webkit-scrollbar-thumb{background:#c3cbd8}
#emap button.em-b{border:1px solid #d5dce8;background:#fff;border-radius:8px;padding:4px 10px;font-size:13px;color:#334155}
#emap button.em-b:hover{background:#f1f5f9}#emap button.em-p{background:#4f46e5;border-color:#4f46e5;color:#fff}#emap button.em-p:hover{background:#4338ca}
#em-modal input,#em-modal select,#em-modal textarea{width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:6px 8px;font-size:14px;background:#fff}
#em-modal input[type=color]{padding:0;height:34px;width:48px}#em-modal label{display:block;font-size:12px;font-weight:600;color:#64748b;margin:8px 0 2px}
`;document.head.appendChild(st);
const oShow=W.showSection;
W.showSection=function(sec){const r=oShow?.apply(this,arguments);
  document.querySelectorAll('#sidebar nav button').forEach(b=>b.classList.toggle('nav-active',(b.getAttribute('onclick')||'').includes(`'${sec}'`)));
  if(sec==='eval-stats')afterOpenEval();return r};

/* ---------------- 2. 資料層（雲端 Firestore / 離線記憶體） ---------------- */
const cloud=()=>!!W.db;
const LS={mapFeatures:[],mapStyles:[],mapRoads:[]},LL={};
try{const d=JSON.parse(localStorage.getItem('tyDispatchMap')||'{}');LS.mapFeatures=d.f||[];LS.mapStyles=d.s||[]}catch(e){}
const saveLS=()=>{try{localStorage.setItem('tyDispatchMap',JSON.stringify({f:LS.mapFeatures,s:LS.mapStyles}))}catch(e){}};
function sub(col,fn){if(cloud())return onSnapshot(collection(W.db,col),s=>fn(s.docs.map(d=>({id:d.id,...d.data()}))),e=>W.customAlert?.('地圖資料讀取失敗：'+e.code,'error'));(LL[col]=LL[col]||[]).push(fn);fn(LS[col])}
const notify=c=>(LL[c]||[]).forEach(f=>f([...LS[c]]));
async function put(col,id,o){try{if(cloud())await setDoc(doc(W.db,col,id),o);else{const i=LS[col].findIndex(x=>x.id===id),r={id,...o};i<0?LS[col].push(r):LS[col][i]=r;saveLS();notify(col)}}catch(e){W.customAlert?.('儲存失敗：'+(e.code||e.message),'error')}}
async function del(col,id){try{if(cloud())await deleteDoc(doc(W.db,col,id));else{LS[col]=LS[col].filter(x=>x.id!==id);saveLS();notify(col)}}catch(e){W.customAlert?.('刪除失敗','error')}}

/* ---------------- 3. 狀態與類別（直接取自「道路考評項目」） ---------------- */
let F=[],S={},R=[],on={},V={x:121.2,y:24.93,z:2000},dirty=1,inited=false,fitted=false,sel=null,mode=null,pts=[],cw=0,ch=0;
const K=Math.cos(24.95*Math.PI/180);
const items=()=>W.evalItems||[];
function style(id){if(S[id])return S[id];const its=items(),i=Math.max(0,its.findIndex(x=>x.docId===id)),u=String(its[i]?.unit||'').trim();const line=/^(m|km|公尺|米|公里)$/i.test(u);return{type:line?'line':'point',color:PAL[i%PAL.length],size:line?4:6,shape:'circle',dash:false}}
const toG=a=>a.map(p=>p[0].toFixed(6)+','+p[1].toFixed(6)).join(';'),fromG=s=>String(s||'').split(';').map(t=>t.split(',').map(Number)).filter(p=>p.length>1&&isFinite(p[0])&&isFinite(p[1]));
const G=f=>f._g||(f._g=fromG(f.g));

/* ---------------- 4. 介面建立 ---------------- */
let sec,tabBar,statEls=[],wrap,cv,cx;
function build(){sec=$('section-eval-stats');if(!sec||$('emap'))return;
  statEls=[...sec.children];
  tabBar=document.createElement('div');tabBar.className='flex gap-2 mb-1';
  tabBar.innerHTML=`<button data-t="stat" class="tab-btn px-4 py-2 bg-indigo-600 text-white font-bold shadow-sm"><i class="fas fa-chart-bar mr-1"></i>數量統計</button><button data-t="map" class="tab-btn px-4 py-2 bg-slate-100 text-slate-600 hover:bg-slate-200"><i class="fas fa-map-location-dot mr-1"></i>改善成果地圖</button>`;
  sec.insertBefore(tabBar,sec.firstChild);
  wrap=document.createElement('div');wrap.id='emap';wrap.className='hidden relative bg-white rounded-xl border border-slate-200 overflow-hidden';wrap.style.cssText='height:calc(100vh - 210px);min-height:480px';
  wrap.innerHTML=`<canvas id="emc" style="position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:grab"></canvas>
  <div id="em-bar" class="absolute top-3 left-3 right-3 flex flex-wrap gap-2 items-center pointer-events-none"></div>
  <div id="em-layers" class="absolute top-14 right-3 w-60 max-h-[62%] overflow-auto bg-white/95 border border-slate-200 rounded-xl shadow-lg p-3 text-sm"></div>
  <div id="em-info" class="hidden absolute bottom-3 left-3 w-80 max-w-[calc(100%-1.5rem)] bg-white/95 border border-slate-200 rounded-xl shadow-lg p-3 text-sm"></div>
  <div class="absolute bottom-3 right-3 flex flex-col bg-white/95 border border-slate-200 rounded-xl shadow overflow-hidden"><button id="em-zi" class="w-9 h-9 text-lg hover:bg-slate-100">＋</button><button id="em-zo" class="w-9 h-9 text-lg hover:bg-slate-100 border-t">－</button><button id="em-zf" class="w-9 h-9 text-xs hover:bg-slate-100 border-t">全市</button></div>`;
  sec.appendChild(wrap);cv=$('emc');cx=cv.getContext('2d');
  const m=document.createElement('div');m.id='em-modal';m.className='hidden fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[130] flex items-center justify-center p-3';m.innerHTML='<div id="em-mb" class="bg-white rounded-2xl shadow-2xl p-5 w-full max-w-lg max-h-[90vh] overflow-auto"></div>';document.body.appendChild(m);
  m.addEventListener('mousedown',e=>{if(e.target===m)closeM()});
  tabBar.querySelectorAll('button').forEach(b=>b.onclick=()=>tab(b.dataset.t));
  $('em-zi').onclick=()=>zoomAt(cw/2,ch/2,1.6);$('em-zo').onclick=()=>zoomAt(cw/2,ch/2,.62);$('em-zf').onclick=fit;
  new ResizeObserver(resize).observe(wrap);bindPointer();if(innerWidth<768)$('em-layers').classList.add('hidden');
  renderBar();renderLayers();requestAnimationFrame(loop)}
function tab(t){const isMap=t==='map';statEls.forEach(e=>e.classList.toggle('hidden',isMap));wrap.classList.toggle('hidden',!isMap);
  tabBar.querySelectorAll('button').forEach(b=>{const a=b.dataset.t===t;b.className='tab-btn px-4 py-2 '+(a?'bg-indigo-600 text-white font-bold shadow-sm':'bg-slate-100 text-slate-600 hover:bg-slate-200')});
  if(isMap){init();resize();renderBar();renderLayers();if(!fitted)fit()}}
function afterOpenEval(){build();decorate()}
const openM=h=>{$('em-mb').innerHTML=h;$('em-modal').classList.remove('hidden')},closeM=()=>$('em-modal').classList.add('hidden');
W.__emClose=closeM;

function init(){if(inited)return;inited=true;
  sub('mapFeatures',a=>{F=a;F.forEach(f=>f._g=null);if(sel)sel=F.find(f=>f.id===sel.id)||null;refresh()});
  sub('mapStyles',a=>{S={};a.forEach(s=>S[s.id]=s);refresh()});
  sub('mapRoads',a=>{R=[];a.sort((x,y)=>x.id<y.id?-1:1).forEach(r=>{try{JSON.parse(r.s).forEach(addRoad)}catch(e){}});if(R.length&&!fitted)fit();dirty=1})}
function refresh(){renderBar();renderLayers();showInfo();decorate();dirty=1}

/* 與原「數量統計」卡片整合：每張卡片加上地圖連結 */
function decorate(){const box=$('eval-dashboard-results');if(!box)return;
  box.querySelectorAll('[onclick^="window.openEvalDetail"]').forEach(card=>{if(card.querySelector('.em-link'))return;const id=(card.getAttribute('onclick').match(/'([^']+)'/)||[])[1];if(!id)return;
    const n=inited?F.filter(f=>f.item===id).length:null,a=document.createElement('div');a.className='em-link text-[11px] text-sky-600 font-bold mt-1 hover:underline';a.innerHTML=`<i class="fas fa-location-dot mr-1"></i>地圖位置${n===null?'':' '+n+' 處'}`;
    a.onclick=e=>{e.stopPropagation();on[id]=true;tab('map')};card.appendChild(a)})}
const oRender=W.renderEvalDashboard;
W.renderEvalDashboard=function(){const r=oRender?.apply(this,arguments);decorate();if(inited){renderBar();renderLayers()}return r};

/* ---------------- 5. 圖層面板與工具列 ---------------- */
function swatch(s){return s.type==='line'?`<svg width="24" height="14"><line x1="2" y1="7" x2="22" y2="7" stroke="${s.color}" stroke-width="${Math.min(6,s.size)}" ${s.dash?'stroke-dasharray="5 3"':''} stroke-linecap="round"/></svg>`:`<svg width="24" height="14"><circle cx="12" cy="7" r="5" fill="${s.color}"/></svg>`}
function renderLayers(){const el=$('em-layers');if(!el)return;const its=items();
  if(!its.length){el.innerHTML='<div class="text-slate-400 text-xs">尚無考評項目。請先到「系統設定 → 道路考評項目管理」建立。</div>';return}
  const groups={};(W.evalCategories||[]).forEach(c=>groups[c.name]=[]);groups['未分類']=[];its.forEach(i=>{(groups[i.category]||groups['未分類']).push(i)});
  el.innerHTML=`<div class="flex justify-between items-center mb-2"><b class="text-slate-700">改善類別圖層</b><span><button class="em-b" data-all="1">全開</button> <button class="em-b" data-all="0">全關</button></span></div>`+
   Object.entries(groups).filter(([k,v])=>v.length).map(([k,v])=>`<div class="mt-2"><div class="text-[11px] font-bold text-indigo-700 bg-indigo-50 inline-block px-2 py-0.5 rounded">${esc(k)}</div>`+v.map(i=>{const s=style(i.docId),n=F.filter(f=>f.item===i.docId).length;
     return `<div class="flex items-center gap-2 py-1 cursor-pointer select-none ${on[i.docId]?'':'opacity-45'}" data-l="${i.docId}"><span class="w-6 flex-none">${swatch(s)}</span><span class="flex-1 truncate" title="${esc(i.name)}">${esc(i.name)}</span><span class="text-xs text-slate-400">${inited?n:''}</span>${canEdit()?`<i class="fas fa-sliders text-slate-400 hover:text-indigo-600" data-s="${i.docId}" title="樣式設定"></i>`:''}</div>`}).join('')+'</div>').join('');
  el.querySelectorAll('[data-l]').forEach(r=>r.onclick=e=>{if(e.target.dataset.s)return;on[r.dataset.l]=!on[r.dataset.l];renderLayers();dirty=1});
  el.querySelectorAll('[data-s]').forEach(b=>b.onclick=e=>{e.stopPropagation();styleDlg(b.dataset.s)});
  el.querySelectorAll('[data-all]').forEach(b=>b.onclick=()=>{items().forEach(i=>on[i.docId]=b.dataset.all==='1');renderLayers();dirty=1})}
function renderBar(){const b=$('em-bar');if(!b)return;const ed=canEdit(),its=items(),it=its.find(i=>i.docId===mode);
  let h=`<button class="em-b pointer-events-auto" id="em-tg"><i class="fas fa-layer-group mr-1"></i>圖層</button>`;
  if(ed){if(mode&&it){const s=style(mode);h+=`<span class="pointer-events-auto bg-white border rounded-lg px-3 py-1 text-xs shadow">${s.type==='line'?`在地圖逐點點選「${esc(it.name)}」路段（${pts.length} 點）`:`點選地圖位置新增「${esc(it.name)}」`}</span>`+(s.type==='line'?`<button class="em-b pointer-events-auto" id="em-un">復原</button><button class="em-b em-p pointer-events-auto" id="em-fin">完成</button>`:'')+`<button class="em-b pointer-events-auto" id="em-cx">取消</button>`}
   else h+=`<select id="em-add" class="pointer-events-auto border border-slate-300 rounded-lg px-2 py-1 text-sm bg-white shadow"><option value="">＋ 新增位置（選擇類別）</option>${its.map(i=>`<option value="${i.docId}">${esc(i.name)}（${style(i.docId).type==='line'?'線':'點'}）</option>`).join('')}</select><button class="em-b pointer-events-auto" id="em-io"><i class="fas fa-file-arrow-up mr-1"></i>匯入／匯出</button>`}
  else h+=`<button class="em-b pointer-events-auto" id="em-io"><i class="fas fa-file-arrow-down mr-1"></i>匯出</button>`;
  b.innerHTML=h;$('em-tg').onclick=()=>$('em-layers').classList.toggle('hidden');
  $('em-add')&&($('em-add').onchange=e=>{if(!e.target.value)return;mode=e.target.value;pts=[];on[mode]=true;renderBar();renderLayers();dirty=1});
  $('em-cx')&&($('em-cx').onclick=()=>{mode=null;pts=[];renderBar();dirty=1});$('em-un')&&($('em-un').onclick=()=>{pts.pop();renderBar();dirty=1});
  $('em-fin')&&($('em-fin').onclick=()=>{if(pts.length<2)return W.customAlert('請至少點選兩點','error');featDlg({item:mode,g:toG(pts)},true)});
  $('em-io')&&($('em-io').onclick=ioDlg)}
function showInfo(){const b=$('em-info');if(!b)return;if(!sel){b.classList.add('hidden');return}const it=items().find(i=>i.docId===sel.item),wo=sel.wo?(W.workOrders||[]).find(w=>w.docId===sel.wo):null;
  b.classList.remove('hidden');b.innerHTML=`<div class="flex justify-between items-start"><div><div class="font-bold text-slate-800">${esc(sel.name||'（未命名）')}</div><div class="text-xs text-indigo-600 font-semibold">${esc(it?.name||'')}${sel.date?' · '+esc(sel.date):''}</div></div><button class="text-slate-400 hover:text-rose-500" id="em-xi"><i class="fas fa-times"></i></button></div>${sel.desc?`<div class="mt-2 text-slate-600 whitespace-pre-wrap">${esc(sel.desc)}</div>`:''}${wo?`<div class="mt-2"><button class="em-b" id="em-wo"><i class="fas fa-file-alt mr-1 text-indigo-500"></i>派工單 ${esc(wo.id||'尚未編號')}</button></div>`:''}${canEdit()?`<div class="mt-2 text-right"><button class="em-b" id="em-ed"><i class="fas fa-pen mr-1"></i>編輯</button></div>`:''}`;
  $('em-xi').onclick=()=>{sel=null;showInfo();dirty=1};$('em-wo')&&($('em-wo').onclick=()=>W.openWoModal?.(wo.docId,true));$('em-ed')&&($('em-ed').onclick=()=>featDlg(sel,false))}

/* ---------------- 6. 對話框 ---------------- */
function featDlg(f,isNew){const its=items(),wos=[...(W.workOrders||[])].sort((a,b)=>String(a.id||'').localeCompare(String(b.id||'')));
  openM(`<h2 class="text-lg font-bold mb-2">${isNew?'新增':'編輯'}改善成果位置</h2><label>改善類別（考評項目）</label><select id="f-i">${its.map(i=>`<option value="${i.docId}" ${i.docId===f.item?'selected':''}>${esc(i.name)}</option>`).join('')}</select><label>名稱（路口／路段）</label><input id="f-n" value="${esc(f.name)}"><div class="grid grid-cols-2 gap-2"><div><label>改善日期</label><input id="f-d" value="${esc(f.date)}" placeholder="例：115/06"></div><div><label>連結派工單（選填）</label><select id="f-w"><option value="">不連結</option>${wos.map(w=>`<option value="${w.docId}" ${w.docId===f.wo?'selected':''}>${esc(w.id||'尚未編號')}　${esc((w.location||'').slice(0,14))}</option>`).join('')}</select></div></div><label>說明</label><textarea id="f-x" rows="3">${esc(f.desc)}</textarea><label>座標（緯度,經度；線以分號分隔多點）</label><textarea id="f-g" rows="2">${esc(f.g)}</textarea>
  <div class="flex gap-2 justify-end mt-4">${isNew?'':'<button class="em-b" style="color:#e11d48;border-color:#e11d48" id="f-del">刪除</button><span class="flex-1"></span>'}<button class="em-b" id="f-cx">取消</button><button class="em-b em-p" id="f-ok">儲存</button></div>`);
  $('f-cx').onclick=()=>{closeM();if(isNew){mode=null;pts=[];renderBar();dirty=1}};
  if(!isNew)$('f-del').onclick=()=>W.customConfirm('確定刪除此位置？',async()=>{await del('mapFeatures',f.id);sel=null;closeM();showInfo()});
  $('f-ok').onclick=async()=>{const g=fromG($('f-g').value);if(!g.length)return W.customAlert('座標格式不正確','error');const iid=$('f-i').value;if(style(iid).type==='point')g.length=1;
    await put('mapFeatures',f.id||uid(),{item:iid,name:$('f-n').value.trim(),date:$('f-d').value.trim(),desc:$('f-x').value,wo:$('f-w').value,g:toG(g),by:W.currentUser?.username||'',at:Date.now()});closeM();if(isNew){mode=null;pts=[];renderBar()}}}
function styleDlg(id){const it=items().find(i=>i.docId===id),s=style(id);
  openM(`<h2 class="text-lg font-bold mb-1">樣式設定：${esc(it?.name||'')}</h2><div class="text-xs text-slate-500">此類別即為「道路考評項目」，名稱與單位請至系統設定修改。</div>
  <div class="grid grid-cols-2 gap-2"><div><label>型態</label><select id="s-t"><option value="point" ${s.type==='point'?'selected':''}>點</option><option value="line" ${s.type==='line'?'selected':''}>線</option></select></div><div><label>顏色</label><input id="s-c" type="color" value="${s.color}"></div><div><label>大小（點半徑／線寬）</label><input id="s-z" type="number" min="2" max="20" value="${s.size}"></div><div><label>樣式</label><select id="s-h"></select></div></div>
  <div class="text-xs text-amber-600 mt-2">已建立的點位改為「線」後需重新編輯座標才會顯示為線。</div>
  <div class="flex gap-2 justify-end mt-4"><button class="em-b" id="s-rs">還原預設</button><span class="flex-1"></span><button class="em-b" id="s-cx">取消</button><button class="em-b em-p" id="s-ok">儲存</button></div>`);
  const fill=()=>{const l=$('s-t').value==='line';$('s-h').innerHTML=l?`<option value="0" ${!s.dash?'selected':''}>實線</option><option value="1" ${s.dash?'selected':''}>虛線</option>`:['circle:圓','square:方','diamond:菱','triangle:三角'].map(x=>{const[v,t]=x.split(':');return`<option value="${v}" ${s.shape===v?'selected':''}>${t}</option>`}).join('')};fill();$('s-t').onchange=fill;
  $('s-cx').onclick=closeM;$('s-rs').onclick=async()=>{await del('mapStyles',id);closeM()};
  $('s-ok').onclick=async()=>{const l=$('s-t').value==='line',h=$('s-h').value;await put('mapStyles',id,{type:l?'line':'point',color:$('s-c').value,size:+$('s-z').value||6,shape:l?'circle':h,dash:l&&h==='1'});closeM()}}
function ioDlg(){const ed=canEdit();
  openM(`<h2 class="text-lg font-bold mb-2">匯入／匯出</h2>${ed?`<label>① 匯入改善成果（Excel／CSV）</label><input id="io-x" type="file" accept=".xlsx,.xls,.csv"><div class="text-xs text-slate-500 mt-1">欄位：類別（須與考評項目名稱相同）、名稱、說明、日期、派工單編號、座標（緯度,經度；線以分號分隔）。<a href="#" id="io-t" class="text-indigo-600 underline">下載範本</a></div>
  <label>② 匯入全市道路 GIS（GeoJSON，WGS84 或 TWD97）</label><input id="io-r" type="file" accept=".json,.geojson"><div class="text-xs text-slate-500 mt-1">匯入會取代現有道路圖，建議先簡化至 10 MB 內。</div>`:''}
  <label>${ed?'③ ':''}匯出</label><div class="flex gap-2"><button class="em-b" id="io-ex">匯出 Excel</button><button class="em-b" id="io-eg">匯出 GeoJSON</button></div><div id="io-m" class="text-xs text-indigo-600 mt-2 whitespace-pre-wrap"></div><div class="text-right mt-4"><button class="em-b" onclick="window.__emClose()">關閉</button></div>`);
  const m=t=>$('io-m').textContent=t;
  $('io-ex').onclick=()=>{const nm=id=>items().find(i=>i.docId===id)?.name||'';const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['類別','名稱','說明','日期','派工單編號','座標'],...F.map(f=>[nm(f.item),f.name,f.desc,f.date,(W.workOrders||[]).find(w=>w.docId===f.wo)?.id||'',f.g])]),'改善成果');XLSX.writeFile(wb,`改善成果地圖_${Date.now()}.xlsx`);m('已匯出 Excel')};
  $('io-eg').onclick=()=>{const feats=F.map(f=>{const s=style(f.item),g=fromG(f.g).map(p=>[p[1],p[0]]);return{type:'Feature',properties:{類別:items().find(i=>i.docId===f.item)?.name,名稱:f.name,說明:f.desc,日期:f.date},geometry:s.type==='line'?{type:'LineString',coordinates:g}:{type:'Point',coordinates:g[0]}}});const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({type:'FeatureCollection',features:feats})]));a.download='改善成果地圖.geojson';a.click();m('已匯出 GeoJSON')};
  if(!ed)return;
  $('io-t').onclick=e=>{e.preventDefault();const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['類別','名稱','說明','日期','派工單編號','座標'],[items()[0]?.name||'標線型人行道','○○路與△△路口','增設行人專用號誌','115/06','','24.9936,121.3010']]),'範本');XLSX.writeFile(wb,'改善成果匯入範本.xlsx')};
  $('io-x').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const wb=XLSX.read(await f.arrayBuffer(),{type:'array'}),rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);let n=0,miss=new Set();
    for(const r of rows){const it=items().find(i=>i.name===String(r['類別']||'').trim());if(!it){miss.add(r['類別']);continue}const g=fromG(r['座標']);if(!g.length){miss.add('（缺座標）');continue}if(style(it.docId).type==='point')g.length=1;
      await put('mapFeatures',uid(),{item:it.docId,name:String(r['名稱']||''),desc:String(r['說明']||''),date:String(r['日期']||''),wo:(W.workOrders||[]).find(w=>w.id&&w.id===String(r['派工單編號']||'').trim())?.docId||'',g:toG(g),by:W.currentUser?.username||'',at:Date.now()});n++}
    m(`已匯入 ${n} 筆`+(miss.size?`\n略過（找不到類別或座標）：${[...miss].join('、')}`:''))}catch(err){m('讀取失敗：'+err.message)}};
  $('io-r').onchange=e=>impRoad(e.target.files[0],m)}

/* ---------------- 7. 道路 GIS 匯入 ---------------- */
function tw(x,y){const a=6378137,e2=.00669438002290,ep=e2/(1-e2),M=y/.9998,mu=M/(a*(1-e2/4-3*e2*e2/64-5*e2**3/256)),e1=(1-Math.sqrt(1-e2))/(1+Math.sqrt(1-e2));
 const p1=mu+(3*e1/2-27*e1**3/32)*Math.sin(2*mu)+(21*e1*e1/16-55*e1**4/32)*Math.sin(4*mu)+(151*e1**3/96)*Math.sin(6*mu)+(1097*e1**4/512)*Math.sin(8*mu);
 const s=Math.sin(p1),c=Math.cos(p1),N=a/Math.sqrt(1-e2*s*s),T=Math.tan(p1)**2,C=ep*c*c,Rr=a*(1-e2)/Math.pow(1-e2*s*s,1.5),D=(x-250000)/(N*.9998);
 const la=p1-(N*Math.tan(p1)/Rr)*(D*D/2-(5+3*T+10*C-4*C*C-9*ep)*D**4/24+(61+90*T+298*C+45*T*T-252*ep-3*C*C)*D**6/720);
 const lo=121*Math.PI/180+(D-(1+2*T+C)*D**3/6+(5-2*C+28*T+8*ep-3*C*C+24*T*T)*D**5/120)/c;return[lo*180/Math.PI,la*180/Math.PI]}
function addRoad(f){let a=1e9,b=-1e9,c=1e9,d=-1e9;for(let i=0;i<f.length;i+=2){if(f[i]<a)a=f[i];if(f[i]>b)b=f[i];if(f[i+1]<c)c=f[i+1];if(f[i+1]>d)d=f[i+1]}R.push({b:[a,b,c,d],p:f})}
async function impRoad(f,m){if(!f)return;m('處理道路資料⋯');try{const j=JSON.parse(await f.text()),lines=[];
  const add=cs=>{if(!cs.length)return;const t=cs[0][0]>1000,fl=[];for(const p of cs){let x=p[0],y=p[1];if(t)[x,y]=tw(x,y);fl.push(+x.toFixed(5),+y.toFixed(5))}lines.push(fl)};
  const geo=g=>{if(!g)return;if(g.type==='LineString')add(g.coordinates);else if(g.type==='MultiLineString')g.coordinates.forEach(add);else if(g.type==='GeometryCollection')g.geometries.forEach(geo)};
  (j.features||[j]).forEach(x=>geo(x.geometry||x));if(!lines.length)return m('找不到線型資料');
  if(!cloud()){R=[];lines.forEach(addRoad);fit();return m(`已載入 ${lines.length} 條道路（離線模式，僅此頁面暫存）`)}
  const old=await getDocs(collection(W.db,'mapRoads'));for(const d of old.docs)await deleteDoc(d.ref);
  let buf=[],len=0,k=0;const flush=async()=>{if(buf.length){await setDoc(doc(W.db,'mapRoads','r'+String(k++).padStart(4,'0')),{s:JSON.stringify(buf)});buf=[];len=0}};
  for(const l of lines){const z=l.length*9;if(len+z>300000)await flush();buf.push(l);len+=z}await flush();m(`已匯入 ${lines.length} 條道路，分 ${k} 份儲存`)}catch(e){m('匯入失敗：'+(e.message||e.code))}}

/* ---------------- 8. 地圖繪製與操作 ---------------- */
const X=lng=>(lng-V.x)*K*V.z+cw/2,Y=lat=>(V.y-lat)*V.z+ch/2,LLp=(px,py)=>[V.y-(py-ch/2)/V.z,V.x+(px-cw/2)/(K*V.z)];
function fit(){fitted=true;let b=[121.0,121.5,24.7,25.15];if(R.length){b=[1e9,-1e9,1e9,-1e9];R.forEach(r=>{b[0]=Math.min(b[0],r.b[0]);b[1]=Math.max(b[1],r.b[1]);b[2]=Math.min(b[2],r.b[2]);b[3]=Math.max(b[3],r.b[3])})}
  V.x=(b[0]+b[1])/2;V.y=(b[2]+b[3])/2;if(cw){V.z=Math.min(cw/((b[1]-b[0])*K),ch/(b[3]-b[2]))*.9}dirty=1}
function resize(){if(!cv||!wrap||wrap.classList.contains('hidden'))return;const r=devicePixelRatio||1,w=wrap.clientWidth,h=wrap.clientHeight;if(!w||!h)return;const first=!cw;cw=w;ch=h;cv.width=w*r;cv.height=h*r;cx.setTransform(r,0,0,r,0,0);if(first&&fitted)fit();dirty=1}
function shp(x,y,s,sh){cx.beginPath();if(sh==='square')cx.rect(x-s,y-s,2*s,2*s);else if(sh==='diamond'){cx.moveTo(x,y-s*1.3);cx.lineTo(x+s*1.3,y);cx.lineTo(x,y+s*1.3);cx.lineTo(x-s*1.3,y);cx.closePath()}else if(sh==='triangle'){cx.moveTo(x,y-s*1.3);cx.lineTo(x+s*1.2,y+s);cx.lineTo(x-s*1.2,y+s);cx.closePath()}else cx.arc(x,y,s,0,7)}
function draw(){dirty=0;if(!cw)return;cx.fillStyle='#eef2f7';cx.fillRect(0,0,cw,ch);
  const step=V.z>20000?.01:V.z>4000?.05:.1,[la0,lo0]=LLp(0,ch),[la1,lo1]=LLp(cw,0);cx.strokeStyle='#dde4ee';cx.lineWidth=1;cx.fillStyle='#94a3b8';cx.font='11px sans-serif';
  for(let l=Math.ceil(lo0/step)*step;l<lo1;l+=step){const x=Math.round(X(l))+.5;cx.beginPath();cx.moveTo(x,0);cx.lineTo(x,ch);cx.stroke();cx.fillText(l.toFixed(2)+'°E',x+2,ch-4)}
  for(let l=Math.ceil(la0/step)*step;l<la1;l+=step){const y=Math.round(Y(l))+.5;cx.beginPath();cx.moveTo(0,y);cx.lineTo(cw,y);cx.stroke();cx.fillText(l.toFixed(2)+'°N',2,y-2)}
  const sk=Math.max(1,Math.floor(1.2/(V.z*1e-4)));cx.strokeStyle='#8793a6';cx.lineWidth=Math.min(3,Math.max(.6,Math.log10(Math.max(V.z,1000)/1000)*.9));cx.lineJoin='round';cx.beginPath();
  for(const r of R){if(r.b[1]<lo0||r.b[0]>lo1||r.b[3]<la0||r.b[2]>la1)continue;const p=r.p,n=p.length;cx.moveTo(X(p[0]),Y(p[1]));for(let i=2;i<n-2;i+=2*sk)cx.lineTo(X(p[i]),Y(p[i+1]));cx.lineTo(X(p[n-2]),Y(p[n-1]))}cx.stroke();
  for(const f of F){if(!on[f.item])continue;const s=style(f.item),g=G(f);if(!g.length)continue;const sl=sel&&sel.id===f.id,z=+s.size||6;
    if(s.type==='line'){if(g.length<2)continue;cx.beginPath();g.forEach((p,i)=>i?cx.lineTo(X(p[1]),Y(p[0])):cx.moveTo(X(p[1]),Y(p[0])));cx.lineCap='round';if(sl){cx.strokeStyle='#fff';cx.lineWidth=z+4;cx.setLineDash([]);cx.stroke()}cx.strokeStyle=s.color;cx.lineWidth=z;cx.setLineDash(s.dash?[z*2,z*1.5]:[]);cx.stroke();cx.setLineDash([])}
    else{shp(X(g[0][1]),Y(g[0][0]),z+(sl?3:0),s.shape);cx.fillStyle=s.color;cx.fill();cx.strokeStyle='#fff';cx.lineWidth=sl?3:1.5;cx.stroke()}}
  if(pts.length&&mode){const s=style(mode);cx.beginPath();pts.forEach((p,i)=>i?cx.lineTo(X(p[1]),Y(p[0])):cx.moveTo(X(p[1]),Y(p[0])));cx.strokeStyle=s.color;cx.lineWidth=+s.size||4;cx.setLineDash([6,4]);cx.stroke();cx.setLineDash([]);pts.forEach(p=>{cx.beginPath();cx.arc(X(p[1]),Y(p[0]),4,0,7);cx.fillStyle='#fff';cx.fill();cx.stroke()})}
  if(!R.length){cx.fillStyle='#94a3b8';cx.font='14px sans-serif';cx.textAlign='center';cx.fillText('尚未匯入全市道路 GIS 底圖'+(canEdit()?'（匯入／匯出 → 道路 GIS）':'，請洽管理者匯入'),cw/2,ch/2);cx.textAlign='left'}}
function loop(){if(dirty)draw();requestAnimationFrame(loop)}
function zoomAt(px,py,f){const[la,lo]=LLp(px,py);V.z=Math.min(4e6,Math.max(300,V.z*f));V.x=lo-(px-cw/2)/(K*V.z);V.y=la+(py-ch/2)/V.z;dirty=1}
function segD(px,py,ax,ay,bx,by){const dx=bx-ax,dy=by-ay,L=dx*dx+dy*dy,t=L?Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/L)):0;return Math.hypot(px-ax-t*dx,py-ay-t*dy)}
function hit(px,py){let best=null,bd=14;for(const f of F){if(!on[f.item])continue;const s=style(f.item),g=G(f);let d=1e9;if(s.type==='line'){for(let i=0;i<g.length-1;i++)d=Math.min(d,segD(px,py,X(g[i][1]),Y(g[i][0]),X(g[i+1][1]),Y(g[i+1][0])))}else if(g[0])d=Math.hypot(px-X(g[0][1]),py-Y(g[0][0]));if(d<bd){bd=d;best=f}}return best}
function mclick(px,py){const ll=LLp(px,py);
  if(mode&&canEdit()){if(style(mode).type==='line'){pts.push(ll);renderBar();dirty=1}else featDlg({item:mode,g:toG([ll])},true);return}
  sel=hit(px,py);showInfo();dirty=1}
function bindPointer(){const ptr=new Map();let mv=0,pd=0;const dd=()=>{const a=[...ptr.values()];return Math.hypot(a[0][0]-a[1][0],a[0][1]-a[1][1])},rc=e=>{const r=cv.getBoundingClientRect();return[e.clientX-r.left,e.clientY-r.top]};
  cv.addEventListener('pointerdown',e=>{cv.setPointerCapture(e.pointerId);ptr.set(e.pointerId,rc(e));mv=0;if(ptr.size===2)pd=dd()});
  cv.addEventListener('pointermove',e=>{if(!ptr.has(e.pointerId))return;const o=ptr.get(e.pointerId),n=rc(e);ptr.set(e.pointerId,n);
    if(ptr.size===2){const d=dd(),a=[...ptr.values()];zoomAt((a[0][0]+a[1][0])/2,(a[0][1]+a[1][1])/2,d/pd);pd=d;mv=99}else{const dx=n[0]-o[0],dy=n[1]-o[1];mv+=Math.abs(dx)+Math.abs(dy);V.x-=dx/(K*V.z);V.y+=dy/V.z;dirty=1}});
  cv.addEventListener('pointerup',e=>{const was=ptr.size,p=rc(e);ptr.delete(e.pointerId);if(was===1&&mv<6)mclick(p[0],p[1])});
  cv.addEventListener('pointercancel',e=>ptr.delete(e.pointerId));
  cv.addEventListener('wheel',e=>{e.preventDefault();const p=rc(e);zoomAt(p[0],p[1],e.deltaY<0?1.25:.8)},{passive:false})}

/* ---------------- 9. 啟動 ---------------- */
build();
