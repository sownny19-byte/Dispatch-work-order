// stats-settings.js — 公告通報、契約執行統計、道路考評、系統設定與 Excel 匯出模組
// System Designed by Sownny © 2026
window.initStatsSettings = function(ctx) {
  const { db, collection, doc, addDoc, updateDoc, deleteDoc, _authVault } = ctx;

    window.renderAnnouncements = () => {
      if(!window.currentUser) return;
      document.getElementById('announcement-actions').innerHTML = window.currentUser.role==='施工廠商' ? `<button onclick="window.openReportModal()" class="bg-emerald-600 text-white px-3 py-1.5 rounded-lg shadow-sm"><i class="fas fa-edit mr-1"></i>發布今日通報</button>` : `<button onclick="document.getElementById('general-announcement-modal').classList.remove('hidden')" class="bg-amber-600 text-white px-3 py-1.5 rounded-lg shadow-sm"><i class="fas fa-bullhorn mr-1"></i>發布機關公告</button>`;
      const gl = document.getElementById('general-announcements-list'), rl = document.getElementById('report-announcements-list'); gl.innerHTML=''; rl.innerHTML='';
      let gAnns = window.announcements.filter(a=>a.type==='general'); if(window.currentUser.role==='施工廠商') gAnns = gAnns.filter(a=>a.target==='全部'||a.target===window.currentUser.zone);
      gAnns.sort((a,b)=>b.timestamp-a.timestamp).forEach(a => { gl.innerHTML+=`<div class="bg-white p-4 rounded-xl border border-amber-100 shadow-sm relative"><div class="text-xs text-slate-400 mb-2">發布者: ${a.author} | ${new Date(a.timestamp).toLocaleString()}</div><div class="font-medium whitespace-pre-wrap">${a.content}</div>${window.currentUser.role==='系統管理員'?`<button onclick="window.deleteAnnouncement('${a.docId}')" class="absolute top-2 right-2 text-rose-400 hover:text-rose-600"><i class="fas fa-trash"></i></button>`:''}</div>`; });
      let rAnns = window.announcements.filter(a=>a.type==='report');
      rAnns.sort((a,b)=>b.timestamp-a.timestamp).forEach(a => { rl.innerHTML+=`<div class="bg-white p-4 rounded-xl border border-emerald-100 shadow-sm relative"><div class="text-xs text-emerald-700 font-bold mb-2 border-b pb-1">${a.date} | ${a.author}</div>${a.wos&&a.wos.length>0?`<ul class="list-disc pl-5 text-indigo-600 text-sm">`+a.wos.map(w=>`<li>${w}</li>`).join('')+`</ul>`:''}<div class="mt-2 text-sm text-slate-600 whitespace-pre-wrap">${a.note||'無補充事項'}</div>${(window.currentUser.role==='系統管理員' || window.currentUser.username===a.author)?`<button onclick="window.openReportModal('${a.docId}')" class="absolute top-2 right-8 text-indigo-400 hover:text-indigo-600"><i class="fas fa-edit"></i></button><button onclick="window.deleteAnnouncement('${a.docId}')" class="absolute top-2 right-2 text-rose-400 hover:text-rose-600"><i class="fas fa-trash"></i></button>`:''}</div>`; });
    };
    window.openReportModal = (id = null) => { window.currentReportId = id; const existing = id ? window.announcements.find(a=>a.docId===id) : null; const vwos = window.workOrders.filter(wo => wo.vendor === window.currentUser.username && wo.status !== '已完工'); document.getElementById('report-wo-list').innerHTML = vwos.map(wo => `<label class="flex items-center space-x-3 p-3 hover:bg-emerald-50 cursor-pointer report-wo-item border-b border-slate-100"><input type="checkbox" value="${wo.id||wo.location}" class="report-wo-cb w-4 h-4 text-emerald-600 rounded" ${existing?.wos?.includes(wo.id||wo.location)?'checked':''}><span class="text-sm text-slate-700"><b class="text-indigo-700">${wo.id||'尚未編號'}</b> - ${wo.location}</span></label>`).join(''); document.getElementById('report-search').value = ''; document.getElementById('report-note').value = existing ? (existing.note||'') : ''; document.getElementById('report-modal').classList.remove('hidden'); };
    window.filterReportWOs = () => { const q = document.getElementById('report-search').value.toLowerCase(); document.querySelectorAll('.report-wo-item').forEach(el => { el.style.display = el.innerText.toLowerCase().includes(q) ? 'flex' : 'none'; }); };
    window.saveReport = async () => { const selected = Array.from(document.querySelectorAll('.report-wo-cb:checked')).map(cb=>cb.value), note = document.getElementById('report-note').value; if(selected.length===0 && !note.trim()) return window.customAlert("請勾選案件或填寫說明！",'error'); const data = {type:'report', date:new Date().toISOString().split('T')[0], author:window.currentUser.username, wos:selected, note, timestamp:Date.now()}; try { if(window.currentReportId) await updateDoc(doc(db,"announcements",window.currentReportId), data); else await addDoc(collection(db,"announcements"), data); document.getElementById('report-modal').classList.add('hidden'); } catch(e){window.customAlert('儲存失敗','error');} };
    window.saveGeneralAnnouncement = async () => { const t = document.getElementById('announcement-target').value, c = document.getElementById('announcement-content').value; if(!c) return window.customAlert("請填寫內容！",'error'); try{ await addDoc(collection(db,"announcements"),{type:'general', target:t, content:c, author:window.currentUser.username, timestamp:Date.now()}); document.getElementById('general-announcement-modal').classList.add('hidden'); } catch(e){} };
    window.deleteAnnouncement = (id) => window.customConfirm('確定刪除此紀錄？', async () => { try{ await deleteDoc(doc(db,"announcements",id)); } catch(e){} });

    window.renderStatistics = () => {
      if(!window.currentUser) return;
      const sYr = document.getElementById('stat-year').value, sDist = document.getElementById('stat-district').value, sDept = document.getElementById('stat-dept').value, sBat = document.getElementById('stat-batch').value.trim();
      const con = document.getElementById('stat-results'); con.innerHTML = '';
      let tZones = [...window.sysZones]; if(sDist && sDist.startsWith('[區] ')) tZones = tZones.filter(z => z.name === sDist.replace('[區] ', '')); else if(sDist) tZones = tZones.filter(z => z.districts.includes(sDist)); if(window.currentUser.role === '施工廠商') tZones = tZones.filter(z => z.name === window.currentUser.zone);
      let found = false;
      tZones.forEach(z => {
        let tyrs = [...window.sysYears]; if(sYr) tyrs = tyrs.filter(y => y.name === sYr); if(window.currentUser.role === '施工廠商') tyrs = tyrs.filter(y => y.name === window.currentUser.year);
        tyrs.forEach(y => {
          found = true;
          let wos = window.workOrders.filter(w => {
            if (w.year !== (y.name||'')) return false;
            if (w.zone) return w.zone === z.name;
            return (z.districts||[]).includes(w.district);
          });
          if(sDist && !sDist.startsWith('[區] ')) wos = wos.filter(w => w.district === sDist); if(sDept !== '全部') wos = wos.filter(w => w.dept === sDept); if(sBat) wos = wos.filter(w => w.batch === sBat);
          const dTot = wos.reduce((s,w)=>s+(parseFloat(w.dispatchAmount)||0),0), cTot = wos.reduce((s,w)=>s+(parseFloat(w.completeAmount)||0),0);
          const cAmt = parseFloat(z.contract)||1, ext1 = parseFloat(z.ext1)||0, ext2 = parseFloat(z.ext2)||0, grandTot = cAmt + ext1 + ext2;
          const dPct = Math.min(100,(dTot/grandTot*100)).toFixed(1), cPct = Math.min(100,(cTot/grandTot*100)).toFixed(1);
          con.innerHTML += `<div class="bg-white p-5 rounded-xl shadow-sm border border-slate-200"><h4 class="font-bold text-lg text-indigo-900 border-b pb-3 mb-4 flex justify-between items-center"><span class="flex items-center"><i class="fas fa-chart-pie mr-2 text-indigo-500"></i>${y.name||'無名稱'} 年度 - ${z.name||'無名稱'} 分區合約</span>${window.currentUser.role!=='施工廠商'?`<button onclick="window.openBudgetModal('${z.docId}')" class="text-sm bg-indigo-50 text-indigo-600 hover:bg-indigo-100 px-3 py-1 rounded shadow-sm">額度設定</button>`:''}</h4><div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4 text-sm"><div class="bg-slate-50 p-3 rounded-xl border border-slate-100"><span class="text-slate-500 text-xs font-bold">總可用額度 (原+增購+後擴)</span><br><span class="font-bold text-lg text-slate-800">${grandTot.toLocaleString()}</span></div><div class="bg-indigo-50 p-3 rounded-xl border border-indigo-100"><span class="text-indigo-600 text-xs font-bold">派工總計</span><br><span class="font-bold text-lg text-indigo-700">${dTot.toLocaleString()}</span></div><div class="bg-rose-50 p-3 rounded-xl border border-rose-100"><span class="text-rose-600 text-xs font-bold">派工剩餘</span><br><span class="font-bold text-lg text-rose-700">${(grandTot-dTot).toLocaleString()}</span></div><div class="bg-emerald-50 p-3 rounded-xl border border-emerald-100"><span class="text-emerald-700 text-xs font-bold">竣工總計</span><br><span class="font-bold text-lg text-emerald-800">${cTot.toLocaleString()}</span></div><div class="bg-rose-50 p-3 rounded-xl border border-rose-100"><span class="text-rose-600 text-xs font-bold">竣工剩餘</span><br><span class="font-bold text-lg text-rose-700">${(grandTot-cTot).toLocaleString()}</span></div></div>${(sDept!=='全部'||sBat) ? `<div class="mb-3 text-xs text-indigo-700 bg-indigo-50 p-2 rounded flex items-center border border-indigo-100"><i class="fas fa-filter mr-2"></i>條件過濾：包含 ${wos.length} 件 (派工金額 ${dTot.toLocaleString()})</div>`:''}<div class="space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-100"><div><div class="flex justify-between text-xs mb-1 font-semibold text-slate-600"><span>派工進度 (${dPct}%)</span><span>${dTot.toLocaleString()} / ${grandTot.toLocaleString()}</span></div><div class="w-full bg-slate-200 rounded-full h-3 overflow-hidden"><div class="bg-indigo-500 h-3" style="width: ${dPct}%"></div></div></div><div><div class="flex justify-between text-xs mb-1 font-semibold text-slate-600"><span>竣工進度 (${cPct}%)</span><span>${cTot.toLocaleString()} / ${grandTot.toLocaleString()}</span></div><div class="w-full bg-slate-200 rounded-full h-3 overflow-hidden"><div class="bg-emerald-500 h-3" style="width: ${cPct}%"></div></div></div></div></div>`;
        });
      });
      if(!found) con.innerHTML = '<div class="p-8 text-center text-slate-500 bg-white rounded-xl border">無符合資料</div>';
    };

    window.renderEvalAdmin = () => { document.getElementById('eval-items-body').innerHTML = window.evalItems.map(i => `<tr class="hover:bg-slate-50"><td class="p-3 font-bold text-indigo-800">${i.name}</td><td class="p-3"><span class="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-xs">${i.category||'未分類'}</span></td><td class="p-3 text-slate-600">${i.unit}</td><td class="p-3 text-center"><button onclick="window.openEvalItemModal('${i.docId}')" class="text-indigo-500 hover:text-indigo-700 px-2 py-1"><i class="fas fa-edit"></i></button> <button onclick="window.deleteEvalItem('${i.docId}')" class="text-rose-400 hover:text-rose-600 px-2 py-1"><i class="fas fa-trash"></i></button></td></tr>`).join(''); };
    window.openEvalItemModal = (id = null) => { document.getElementById('eval-item-id').value = id||''; document.getElementById('eval-item-category').innerHTML = window.evalCategories.map(c=>`<option value="${c.name}">${c.name}</option>`).join(''); if(id) { const i=window.evalItems.find(x=>x.docId===id); document.getElementById('eval-item-name').value=i.name; document.getElementById('eval-item-unit').value=i.unit; document.getElementById('eval-item-category').value=i.category; } else { document.getElementById('eval-item-name').value=''; document.getElementById('eval-item-unit').value=''; } document.getElementById('eval-item-modal').classList.remove('hidden'); };
    window.saveEvalItem = async () => { const id=document.getElementById('eval-item-id').value, name=document.getElementById('eval-item-name').value.trim(), category=document.getElementById('eval-item-category').value, unit=document.getElementById('eval-item-unit').value.trim(); if(!name||!unit) return window.customAlert('欄位不可空白','error'); try { if(id) await updateDoc(doc(db,"evalItems",id),{name,category,unit}); else await addDoc(collection(db,"evalItems"),{name,category,unit,timestamp:Date.now()}); document.getElementById('eval-item-modal').classList.add('hidden'); } catch(e){} };
    window.deleteEvalItem = (id) => window.customConfirm('確定刪除此項目？', async () => { try{await deleteDoc(doc(db,"evalItems",id));} catch(e){} });
    window.openEvalCategoryModal = () => { window.renderEvalCategories(); document.getElementById('eval-category-name').value=''; document.getElementById('eval-category-modal').classList.remove('hidden'); };
    window.renderEvalCategories = () => { document.getElementById('eval-category-list').innerHTML = window.evalCategories.map(c=>`<div class="flex justify-between items-center bg-white p-2 border rounded"><span class="font-bold text-slate-700 pl-2">${c.name}</span><button onclick="window.deleteEvalCategory('${c.docId}')" class="text-rose-400"><i class="fas fa-trash"></i></button></div>`).join(''); };
    window.saveEvalCategory = async () => { const n=document.getElementById('eval-category-name').value.trim(); if(!n) return; try{await addDoc(collection(db,"evalCategories"),{name:n, timestamp:Date.now()}); document.getElementById('eval-category-name').value='';} catch(e){} };
    window.deleteEvalCategory = (id) => window.customConfirm('確定刪除此分類？', async () => { try{await deleteDoc(doc(db,"evalCategories",id));} catch(e){} });

    window.parseEvalPositiveNum = (val) => {
      if (val === undefined || val === null || val === '') return 0;
      const n = parseFloat(String(val).replace(/,/g, '').trim());
      if (isNaN(n) || n < 0) return 0;
      return n;
    };

    window.getFilteredEvalWorkOrders = (yr, dst) => {
      let wos = window.workOrders.filter(w => String(w.status || '').trim() === '已完工' && w.evalData && typeof w.evalData === 'object');
      if (yr) wos = wos.filter(w => String(w.year || '').trim() === String(yr).trim());
      if (dst && dst.startsWith('[區] ')) {
        const zName = dst.replace('[區] ', '');
        const z = window.sysZones.find(x => x.name === zName);
        if (z) {
          wos = wos.filter(w => w.zone ? w.zone === z.name : (z.districts || []).includes(w.district));
        }
      } else if (dst) {
        wos = wos.filter(w => String(w.district || '').trim() === String(dst).trim());
      }
      return wos;
    };

    window.renderEvalDashboard = () => {
      if(!window.currentUser) return;
      const yr = document.getElementById('eval-stat-year').value, dst = document.getElementById('eval-stat-district').value;
      const wos = window.getFilteredEvalWorkOrders(yr, dst);
      const sums = {};
      const counts = {};
      window.evalItems.forEach(i => { sums[i.docId] = 0; counts[i.docId] = 0; });
      wos.forEach(w => {
        Object.keys(w.evalData).forEach(k => {
          if (sums[k] !== undefined) {
            const val = window.parseEvalPositiveNum(w.evalData[k]);
            if (val > 0) {
              sums[k] = Math.round((sums[k] + val) * 1000) / 1000;
              counts[k]++;
            }
          }
        });
      });
      const grouped = {};
      window.evalCategories.forEach(c => { if (c.name) grouped[c.name.trim()] = []; });
      grouped['未分類'] = [];
      window.evalItems.forEach(i => {
        const catKey = i.category ? i.category.trim() : '';
        const c = (catKey && grouped[catKey]) ? catKey : '未分類';
        grouped[c].push(i);
      });
      let html = '';
      for(const [cat, items] of Object.entries(grouped)) {
        if(items.length===0) continue;
        html += `<div class="mb-4"><h4 class="font-bold text-slate-700 mb-2 border-b border-indigo-200 inline-block pb-1"><i class="fas fa-tag text-indigo-500 mr-2 text-sm"></i>${cat}</h4><div class="grid grid-cols-2 md:grid-cols-5 gap-4">`;
        html += items.map(i => `<div class="bg-white border p-3 rounded-xl text-center shadow-sm hover:shadow-md hover:border-emerald-400 transition-all cursor-pointer group" onclick="window.openEvalDetail('${i.docId}', '${yr}', '${dst}')"><div class="text-slate-600 font-bold text-sm mb-1 group-hover:text-emerald-700 transition-colors">${i.name}</div><div class="text-2xl font-black text-emerald-600 group-hover:scale-110 transition-transform">${sums[i.docId].toLocaleString()}</div><div class="text-xs text-slate-400 mt-1">單位: ${i.unit} (${counts[i.docId]}件)</div></div>`).join(''); 
        html += `</div></div>`;
      }
      document.getElementById('eval-dashboard-results').innerHTML = html || '<div class="text-slate-500 text-sm">暫無已完工的考評數據</div>';
      window.evalMap?.onDashboardRendered();
    };

    window.currentEvalDetailData = [];
    window.currentEvalDetailName = '';
    window.currentEvalDetailParams = null;

    window.openCurrentEvalStyleEditor = () => {
      if (window.currentEvalDetailParams?.itemId) {
        window.evalMap?.openStyleEditor(window.currentEvalDetailParams.itemId);
      }
    };
    window.openCurrentEvalOnMap = () => {
      if (window.currentEvalDetailParams?.itemId) {
        document.getElementById('eval-detail-modal').classList.add('hidden');
        window.evalMap?.focusCategoryOnMap(window.currentEvalDetailParams.itemId);
      }
    };

    window.openEvalDetail = (itemId, yr, dst) => {
      window.evalMap?.ensureInit();
      const item = window.evalItems.find(i => i.docId === itemId);
      if(!item) return;
      window.currentEvalDetailName = item.name;
      window.currentEvalDetailParams = { itemId, yr, dst };
      
      const wos = window.getFilteredEvalWorkOrders(yr, dst).filter(w => window.parseEvalPositiveNum(w.evalData[itemId]) > 0);

      window.currentEvalDetailData = wos.map(w => {
        const feat = window.evalMap?.getFeatureForWo(itemId, w.docId) || null;
        return {
          id: w.id || '尚未編號', docId: w.docId, district: w.district, location: w.location, vendor: w.vendor, actualDate: w.actualDate,
          value: window.parseEvalPositiveNum(w.evalData[itemId]),
          mapCoord: feat?.g || '',
          mapType: feat ? (window.evalMap?.getEffectiveType(feat, itemId) === 'line' ? '路段線' : '點位') : '未標註'
        };
      }).sort((a,b) => new Date(b.actualDate||0) - new Date(a.actualDate||0));

      const catStyle = window.evalMap?.getStyle(itemId);
      const styleTag = catStyle ? `<span class="inline-flex items-center gap-1 ml-2 px-2 py-0.5 rounded-full text-xs font-bold border bg-white text-slate-700"><span style="width:10px;height:10px;border-radius:${catStyle.type==='line'?'2px':'99px'};background:${catStyle.color};display:inline-block"></span>${catStyle.type==='line'?'路段線':'點位'}</span>` : '';
      document.getElementById('eval-detail-title').innerHTML = `<i class="fas fa-list-alt mr-2 text-emerald-600"></i>考評明細：${item.name}${styleTag}`;
      
      const tbody = document.getElementById('eval-detail-body');
      let total = 0;
      let plottedCount = 0;
      tbody.innerHTML = window.currentEvalDetailData.map(d => {
        total = Math.round((total + d.value) * 1000) / 1000;
        const feat = window.evalMap?.getFeatureForWo(itemId, d.docId);
        const hasGeo = Boolean(feat && feat.g && feat.g.trim());
        if (hasGeo) plottedCount++;
        const ptCount = hasGeo ? feat.g.split(';').filter(Boolean).length : 0;
        const effType = feat ? window.evalMap?.getEffectiveType(feat, itemId) : (catStyle?.type || 'point');
        const mapStatusBadge = hasGeo
          ? `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 mr-1" title="${feat.g}"><i class="fas fa-check-circle mr-1"></i>${effType==='line'?`線·${ptCount}點`:'點位'}</span>`
          : `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 mr-1"><i class="fas fa-map-pin mr-1"></i>未標註</span>`;
        const mapActions = hasGeo
          ? `<button type="button" onclick="event.stopPropagation(); window.evalMap?.focusWoOnMap('${itemId}', '${d.docId}')" class="bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 px-2 py-1 rounded text-xs font-bold mr-1" title="在地圖上定位並檢視"><i class="fas fa-crosshairs mr-1"></i>定位</button>` +
            `<button type="button" onclick="event.stopPropagation(); window.evalMap?.startWoMapPick('${itemId}', '${d.docId}')" class="bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 px-2 py-1 rounded text-xs font-bold mr-1" title="在地圖上重新點選位置或繪製路段"><i class="fas fa-draw-polygon mr-1"></i>重繪</button>` +
            `<button type="button" onclick="event.stopPropagation(); window.evalMap?.openWoMapEditor('${itemId}', '${d.docId}')" class="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 px-2 py-1 rounded text-xs font-bold" title="編輯此派工單地圖資訊與座標"><i class="fas fa-pen mr-1"></i>編輯地圖</button>`
          : `<button type="button" onclick="event.stopPropagation(); window.evalMap?.startWoMapPick('${itemId}', '${d.docId}')" class="bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 rounded text-xs font-bold mr-1 shadow-sm" title="前往地圖點選位置或繪製路段"><i class="fas fa-map-marker-alt mr-1"></i>地圖點選</button>` +
            `<button type="button" onclick="event.stopPropagation(); window.evalMap?.openWoMapEditor('${itemId}', '${d.docId}')" class="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 px-2 py-1 rounded text-xs font-bold" title="直接輸入座標與地圖資訊"><i class="fas fa-pen mr-1"></i>編輯地圖</button>`;

        return `<tr class="hover:bg-slate-100 cursor-pointer transition-colors" onclick="window.openWoModal('${d.docId}', true)" title="點擊檢視派工單詳細內容"><td class="p-3 font-bold text-indigo-700">${d.id}</td><td class="p-3">${d.district||'-'}</td><td class="p-3 truncate max-w-xs" title="${d.location}">${d.location}</td><td class="p-3 text-slate-600">${d.vendor||'-'}</td><td class="p-3 text-sm">${d.actualDate||'-'}</td><td class="p-3 text-right font-bold text-emerald-600 text-lg">${d.value}</td><td class="p-3 text-center whitespace-nowrap" onclick="event.stopPropagation()">${mapStatusBadge}${mapActions}</td></tr>`;
      }).join('');
      
      if(window.currentEvalDetailData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-500"><i class="fas fa-folder-open text-3xl mb-2 text-slate-300 block"></i>無相關派工單明細</td></tr>`;
      }

      document.getElementById('eval-detail-total').innerText = `共包含 ${window.currentEvalDetailData.length} 件派工單 (已標註地圖 ${plottedCount} 件) / 數量總計: ${total.toLocaleString()} ${item.unit}`;
      document.getElementById('eval-detail-modal').classList.remove('hidden');
    };

    window.renderSysYears = () => { document.getElementById('sys-year-body').innerHTML = [...window.sysYears].sort((a,b)=>((b.name||'').localeCompare(a.name||''))).map(y => `<tr class="hover:bg-slate-50"><td class="p-3 font-bold">${y.name||'無名稱'}</td><td class="p-3 text-center"><button onclick="window.deleteSysYear('${y.docId}')" class="text-rose-400 hover:text-rose-600"><i class="fas fa-trash"></i></button></td></tr>`).join(''); };
    window.openSysYearModal = () => { document.getElementById('sys-year-input').value=''; document.getElementById('sys-year-modal').classList.remove('hidden'); };
    window.saveSysYear = async () => { const v=document.getElementById('sys-year-input').value.trim(); if(!v) return window.customAlert('不可空白','error'); try{await addDoc(collection(db,"sysYears"), {name:v, timestamp:Date.now()}); document.getElementById('sys-year-modal').classList.add('hidden');} catch(e){} };
    window.deleteSysYear = (id) => window.customConfirm('確定刪除此年度？', async () => { try{await deleteDoc(doc(db,"sysYears",id));} catch(e){} });

    window.renderSysZones = () => { document.getElementById('sys-zone-body').innerHTML = [...window.sysZones].sort((a,b)=>((a.name||'').localeCompare(b.name||''))).map(z => `<tr class="hover:bg-slate-50"><td class="p-3 font-bold text-indigo-700">${z.name||'無名稱'}</td><td class="p-3 text-sm text-slate-600 max-w-[200px] truncate" title="${(z.districts||[]).join(', ')}">${(z.districts||[]).join(', ')}</td><td class="p-3 text-center whitespace-nowrap"><button onclick="window.openSysZoneModal('${z.docId}')" class="text-indigo-500 hover:text-indigo-700 px-2 py-1" title="編輯分區"><i class="fas fa-edit"></i></button> <button onclick="window.deleteSysZone('${z.docId}')" class="text-rose-400 hover:text-rose-600 px-2 py-1" title="刪除分區"><i class="fas fa-trash"></i></button></td></tr>`).join(''); };
    window.openSysZoneModal = (id = null) => {
      document.getElementById('sys-zone-id').value = id || '';
      const titleEl = document.getElementById('sys-zone-modal-title');
      if (id) {
        const z = window.sysZones.find(x => x.docId === id);
        if (titleEl) titleEl.innerText = '編輯分區設定';
        document.getElementById('sys-zone-name').value = z ? (z.name || '') : '';
        const dists = (z && Array.isArray(z.districts)) ? z.districts : [];
        document.querySelectorAll('#zone-district-cbs input').forEach(cb => { cb.checked = dists.includes(cb.value); });
      } else {
        if (titleEl) titleEl.innerText = '新增分區設定';
        document.getElementById('sys-zone-name').value = '';
        document.querySelectorAll('#zone-district-cbs input').forEach(cb => cb.checked = false);
      }
      document.getElementById('sys-zone-modal').classList.remove('hidden');
    };
    window.saveSysZone = async () => {
      const id = document.getElementById('sys-zone-id').value;
      const n = document.getElementById('sys-zone-name').value.trim();
      const dists = Array.from(document.querySelectorAll('#zone-district-cbs input:checked')).map(cb=>cb.value);
      if(!n || dists.length<1) return window.customAlert('請填寫分區名稱且至少勾選1個行政區','error');
      try {
        if(id) {
          const oldZone = window.sysZones.find(x => x.docId === id);
          const oldName = oldZone ? oldZone.name : '';
          await updateDoc(doc(db,"sysZones",id), {name:n, districts:dists});
          if (oldName && oldName !== n) {
            for (const u of window.users.filter(u => u.zone === oldName)) {
              await updateDoc(doc(db, "users", u.docId), { zone: n });
            }
            for (const w of window.workOrders.filter(w => w.zone === oldName)) {
              await updateDoc(doc(db, "workOrders", w.docId), { zone: n });
            }
          }
        } else {
          await addDoc(collection(db,"sysZones"), {name:n, districts:dists, timestamp:Date.now()});
        }
        document.getElementById('sys-zone-modal').classList.add('hidden');
      } catch(e){ window.customAlert('儲存分區失敗','error'); }
    };
    window.deleteSysZone = (id) => window.customConfirm('確定刪除此分區？', async () => { try{await deleteDoc(doc(db,"sysZones",id));} catch(e){} });
    
    window.openBudgetModal = (id) => { const z=window.sysZones.find(x=>x.docId===id); if(!z) return; document.getElementById('budget-zone-id').value=id; document.getElementById('budget-modal-title').innerText = `額度設定: ${z.name||'無名稱'}`; document.getElementById('budget-contract').value=z.contract||''; document.getElementById('budget-ext1').value=z.ext1||''; document.getElementById('budget-ext2').value=z.ext2||''; document.getElementById('budget-modal').classList.remove('hidden'); };
    window.saveBudget = async () => { const id=document.getElementById('budget-zone-id').value; try{ await updateDoc(doc(db,"sysZones",id), {contract:document.getElementById('budget-contract').value||0, ext1:document.getElementById('budget-ext1').value||0, ext2:document.getElementById('budget-ext2').value||0}); document.getElementById('budget-modal').classList.add('hidden'); } catch(e){} };

    window.renderUsers = () => { document.getElementById('user-table-body').innerHTML = window.users.map(u => `<tr class="hover:bg-slate-50"><td class="p-3 font-bold">${u.username}</td><td class="p-3 font-mono text-xs text-slate-500">***</td><td class="p-3"><span class="px-2 py-1 rounded text-xs ${u.role==='系統管理員'?'bg-indigo-100 text-indigo-700':u.role==='施工廠商'?'bg-emerald-100 text-emerald-700':'bg-slate-200'}">${u.role}</span></td><td class="p-3 text-sm">${u.role==='施工廠商'?`${u.year||''} - ${u.zone||''}`:'-'}</td><td class="p-3 text-center whitespace-nowrap"><button onclick="window.openUserModal('${u.docId}')" class="text-indigo-500 hover:text-indigo-700 px-2 py-1" title="編輯帳號"><i class="fas fa-edit"></i></button> <button onclick="window.deleteUser('${u.docId}')" class="text-rose-400 hover:text-rose-600 px-2 py-1" title="刪除帳號"><i class="fas fa-trash"></i></button></td></tr>`).join(''); };
    window.openUserModal = (id = null) => {
      window.updateDropdowns();
      document.getElementById('user-doc-id').value = id || '';
      const titleEl = document.getElementById('user-modal-title');
      const pwdInput = document.getElementById('user-password');
      const pwdHint = document.getElementById('user-pwd-hint');
      pwdInput.value = '';
      if (id) {
        const u = window.users.find(x => x.docId === id);
        if (titleEl) titleEl.innerText = '編輯帳號';
        if (pwdHint) pwdHint.innerText = '(留空代表不變更密碼)';
        pwdInput.placeholder = '若不修改密碼請留空';
        document.getElementById('user-username').value = u ? (u.username || '') : '';
        document.getElementById('user-role').value = u ? (u.role || '機關/監造') : '機關/監造';
        window.toggleUserVendorFields();
        if (u && u.role === '施工廠商') {
          if (u.year) document.getElementById('user-year').value = u.year;
          if (u.zone) document.getElementById('user-zone').value = u.zone;
        }
      } else {
        if (titleEl) titleEl.innerText = '新增帳號';
        if (pwdHint) pwdHint.innerText = '';
        pwdInput.placeholder = '請輸入密碼';
        document.getElementById('user-username').value = '';
        document.getElementById('user-role').value = '機關/監造';
        window.toggleUserVendorFields();
      }
      document.getElementById('user-modal').classList.remove('hidden');
    };
    window.toggleUserVendorFields = () => { document.getElementById('user-vendor-fields').classList.toggle('hidden', document.getElementById('user-role').value!=='施工廠商'); };
    window.saveUser = async () => {
      const id = document.getElementById('user-doc-id').value;
      const u = document.getElementById('user-username').value.trim();
      const inputPwd = document.getElementById('user-password').value.trim();
      const p = id ? (inputPwd || _authVault.get(id) || '') : inputPwd;
      const r = document.getElementById('user-role').value;
      const yr = r === '施工廠商' ? document.getElementById('user-year').value : '';
      const zn = r === '施工廠商' ? document.getElementById('user-zone').value : '';
      if(!u||!p) return window.customAlert('帳號密碼不可空白','error');
      try {
        if (id) {
          const oldUser = window.users.find(x => x.docId === id);
          const oldUsername = oldUser ? oldUser.username : '';
          await updateDoc(doc(db,"users",id), {username:u, password:p, role:r, year:yr, zone:zn});
          if (oldUsername && oldUsername !== u) {
            for (const w of window.workOrders.filter(w => w.vendor === oldUsername)) {
              await updateDoc(doc(db, "workOrders", w.docId), { vendor: u });
            }
          }
          if (window.currentUser && window.currentUser.docId === id) {
            window.currentUser = { ...window.currentUser, username: u, role: r, year: yr, zone: zn };
            document.getElementById('sidebar-user-name').innerText = u;
            document.getElementById('sidebar-user-role').innerText = r;
          }
        } else {
          await addDoc(collection(db,"users"), {username:u, password:p, role:r, year:yr, zone:zn});
        }
        document.getElementById('user-modal').classList.add('hidden');
      } catch(e){ window.customAlert('儲存帳號失敗','error'); }
    };
    window.deleteUser = (id) => window.customConfirm('確定刪除帳號？', async () => { try{await deleteDoc(doc(db,"users",id));} catch(e){} });

    window.exportEvalDetailExcel = () => {
       if(!window.currentEvalDetailData || window.currentEvalDetailData.length === 0) return window.customAlert('沒有資料可匯出', 'error');
       const ws = XLSX.utils.json_to_sheet(window.currentEvalDetailData.map(d => ({
         '派工單編號': d.id,
         '行政區': d.district,
         '派工地點': d.location,
         '施工廠商': d.vendor,
         '完工日期': d.actualDate,
         '考評數量': d.value,
         '地圖型態': d.mapType || '未標註',
         '地圖座標': d.mapCoord || ''
       })));
       const wb = XLSX.utils.book_new(); 
       XLSX.utils.book_append_sheet(wb, ws, "數量明細"); 
       XLSX.writeFile(wb, `${window.currentEvalDetailName}_明細匯出_${Date.now()}.xlsx`);
    };

    window.currentExportData = [];
    window.exportToExcel = () => {
      if(window.currentExportData.length === 0) return window.customAlert('沒有資料可匯出', 'error');
      const ws = XLSX.utils.json_to_sheet(window.currentExportData.map(w => ({
        '流水號': w.seqNo || '', '派工單編號': w.id || '', '年度': w.year, '派工科室': w.dept, '派別': w.batch, '行政區': w.district, '跨區支援': (w.crossZone || (w.attributes||[]).includes('跨區支援')) ? '是' : '否', '廠商流水號': w.serial, '負責廠商': w.vendor,
        '狀態': w.status, '狀態說明': w.statusNote || '', '收單日期': w.recvDate, '派工日期': w.dispatchDate, '預計完工日': w.expectedDate, '實際完工日': w.actualDate,
        '派工人員': w.dispatcher || '', '案件來源': w.source || '一般派工', '服務處 / 單位名稱 / 其他說明': w.sourceDetail || '', '里辦公處': w.village || '', '派工地點': w.location, '內容說明': w.content, '備註': w.note || '',
        '屬性': (w.attributes||[]).join(', '), '學校名稱': w.schoolName || '', '派工金額': w.dispatchAmount, '竣工金額': w.completeAmount,
        '派工單雲端網址': w.docUrl || '', '完工照片網址': w.photoUrl || '', '竣工圖雲端網址': w.asbuiltUrl || ''
      })));
      const wb = XLSX.utils.book_new(); 
      XLSX.utils.book_append_sheet(wb, ws, "派工單篩選結果"); 
      XLSX.writeFile(wb, `派工系統匯出_${Date.now()}.xlsx`);
    };

};
