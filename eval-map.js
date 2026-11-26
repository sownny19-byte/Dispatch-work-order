// eval-map.js — 改善成果地圖模組 (與道路考評成果雙向連動)
// System Designed by Sownny © 2026
window.initEvalMap = function(ctx) {
  const { isCloudEnabled, fbCollection, fbSetDoc, fbGetDocs, fbDeleteDoc, fbDoc, fbOnSnapshot, reportCloudError } = ctx;

    /* =====================================================================
       內建「改善成果地圖」模組 (與「道路考評成果」數量統計與明細全面雙向連動)
       功能：1) 導覽高亮連動  2) 道路考評成果「數量統計 / 改善成果地圖」雙分頁
             3) 各考評類別即時連動已完工派工單、自訂顏色與點/線型態、互動標註與拖曳微調
       資料集合：mapFeatures / mapStyles / mapRoads (離線時自動改用本地暫存)
       ===================================================================== */
    (() => {
      const W = window;
      const $ = id => document.getElementById(id);
      const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const PAL = ['#e5484d', '#f59f00', '#2f9e44', '#1971c2', '#9c36b5', '#0ca678', '#e8590c', '#495057', '#d6336c', '#1098ad'];
      // 所有登入使用者皆可編輯改善成果地圖資訊；道路 GIS 底圖由系統管理員/機關/監造或所有登入者維護
      const canEdit = () => Boolean(W.currentUser);
      const uid = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

      // 連動左側選單高亮狀態與道路考評成果頁面初始化
      const oShow = W.showSection;
      W.showSection = function(secName) {
        const r = oShow?.apply(this, arguments);
        document.querySelectorAll('#sidebar nav button').forEach(b =>
          b.classList.toggle('nav-active', (b.getAttribute('onclick') || '').includes(`'${secName}'`))
        );
        if (secName === 'eval-stats') afterOpenEval();
        return r;
      };

      // 資料層：雲端 Firestore / 離線 localStorage
      const cloud = () => Boolean(isCloudEnabled && W.db);
      const LS = { mapFeatures: [], mapStyles: [], mapRoads: [] };
      const LL = {};
      try {
        const d = JSON.parse(localStorage.getItem('tyDispatchMap') || '{}');
        LS.mapFeatures = d.f || [];
        LS.mapStyles = d.s || [];
      } catch (e) {}
      const saveLS = () => {
        try {
          localStorage.setItem('tyDispatchMap', JSON.stringify({ f: LS.mapFeatures, s: LS.mapStyles }));
        } catch (e) {}
      };
      function sub(col, fn) {
        if (cloud()) {
          return fbOnSnapshot(
            fbCollection(W.db, col),
            s => fn(s.docs.map(d => ({ id: d.id, ...d.data() }))),
            e => reportCloudError(`讀取地圖資料(${col})`, e)
          );
        }
        (LL[col] = LL[col] || []).push(fn);
        fn([...LS[col]]);
      }
      const notify = c => (LL[c] || []).forEach(f => f([...LS[c]]));
      async function put(col, id, o) {
        try {
          if (cloud()) {
            await fbSetDoc(fbDoc(W.db, col, id), o);
          } else {
            const i = LS[col].findIndex(x => x.id === id);
            const r = { id, ...o };
            i < 0 ? LS[col].push(r) : (LS[col][i] = r);
            saveLS();
            notify(col);
          }
          return true;
        } catch (e) {
          W.customAlert?.('儲存失敗：' + (e.code || e.message), 'error');
          return false;
        }
      }
      async function del(col, id) {
        try {
          if (cloud()) {
            await fbDeleteDoc(fbDoc(W.db, col, id));
          } else {
            LS[col] = LS[col].filter(x => x.id !== id);
            saveLS();
            notify(col);
          }
          return true;
        } catch (e) {
          W.customAlert?.('刪除失敗：' + (e.code || e.message), 'error');
          return false;
        }
      }

      // 地圖狀態與類別（直接連動「道路考評成果」篩選條件與考評項目）
      let F = [], S = {}, R = [], on = {}, expanded = {};
      let V = { x: 121.22, y: 24.95, z: 2400 };
      let dirty = 1, inited = false, fitted = false, sel = null, drawCtx = null, pts = [], cw = 0, ch = 0;
      let hoverLL = null;
      const K = Math.cos(24.95 * Math.PI / 180);
      const items = () => W.evalItems || [];
      const isLayerOn = id => on[id] !== false;

      function style(id) {
        if (S[id]) return S[id];
        const its = items();
        const i = Math.max(0, its.findIndex(x => x.docId === id));
        const u = String(its[i]?.unit || '').trim();
        const line = /^(m|km|公尺|米|公里)$/i.test(u);
        return { type: line ? 'line' : 'point', color: PAL[i % PAL.length], size: line ? 4 : 6, shape: 'circle', dash: false };
      }
      function featType(f, fallbackItemId) {
        if (f && (f.geomType === 'point' || f.geomType === 'line')) return f.geomType;
        return style(f?.item || fallbackItemId).type;
      }

      const toG = a => a.map(p => p[0].toFixed(6) + ',' + p[1].toFixed(6)).join(';');
      const fromG = s => String(s || '').split(';').map(t => t.split(',').map(Number)).filter(p => p.length > 1 && isFinite(p[0]) && isFinite(p[1]));
      const G = f => f._g || (f._g = fromG(f.g));

      // 取得目前年度與分區篩選後的已完工派工單，確保地圖與「數量統計」100% 同步
      function getFilteredWos() {
        const yr = $('eval-stat-year')?.value || '';
        const dst = $('eval-stat-district')?.value || '';
        return W.getFilteredEvalWorkOrders ? W.getFilteredEvalWorkOrders(yr, dst) : [];
      }
      function getCategoryCaseStats(itemId) {
        const wos = getFilteredWos().filter(w => W.parseEvalPositiveNum(w.evalData?.[itemId]) > 0);
        const woIds = new Set(wos.map(w => w.docId));
        const linkedFeatsByWo = new Map();
        const manualFeats = [];
        F.forEach(f => {
          if (f.item !== itemId) return;
          if (f.wo) {
            if (woIds.has(f.wo) && !linkedFeatsByWo.has(f.wo)) linkedFeatsByWo.set(f.wo, f);
          } else {
            manualFeats.push(f);
          }
        });
        let plottedWo = 0;
        const woRows = wos.map(w => {
          const feat = linkedFeatsByWo.get(w.docId) || null;
          const hasGeo = Boolean(feat && G(feat).length > 0);
          if (hasGeo) plottedWo++;
          return { wo: w, feat, hasGeo, value: W.parseEvalPositiveNum(w.evalData?.[itemId]) };
        });
        const plottedManual = manualFeats.filter(f => G(f).length > 0).length;
        return {
          woRows,
          manualFeats,
          totalCases: woRows.length + manualFeats.length,
          plottedCount: plottedWo + plottedManual
        };
      }
      function getFeatureForWo(itemId, woDocId) {
        return F.find(f => f.item === itemId && f.wo === woDocId) || null;
      }
      function getVisibleFeatures() {
        const filteredWos = getFilteredWos();
        const filteredWoIds = new Set(filteredWos.map(w => w.docId));
        return F.filter(f => {
          if (!isLayerOn(f.item)) return false;
          if (!G(f).length) return false;
          if (f.wo && !filteredWoIds.has(f.wo)) return false;
          return true;
        });
      }

      // 介面建立（將分頁列置於過濾條件卡下方，讓過濾條件同時控制數量統計與成果地圖）
      let sec, tabBar, statPanel, wrap, cv, cx;
      function build() {
        sec = $('section-eval-stats');
        if (!sec || $('emap')) return;
        statPanel = $('eval-stat-panel');
        tabBar = document.createElement('div');
        tabBar.className = 'flex gap-2 mb-1';
        tabBar.innerHTML = `<button data-t="stat" class="tab-btn px-4 py-2 bg-indigo-600 text-white font-bold shadow-sm"><i class="fas fa-chart-bar mr-1"></i>數量統計</button><button data-t="map" class="tab-btn px-4 py-2 bg-slate-100 text-slate-600 hover:bg-slate-200"><i class="fas fa-map-location-dot mr-1"></i>改善成果地圖</button>`;
        if (statPanel) sec.insertBefore(tabBar, statPanel);
        else sec.insertBefore(tabBar, sec.firstChild);

        wrap = document.createElement('div');
        wrap.id = 'emap';
        wrap.className = 'hidden relative bg-white rounded-xl border border-slate-200 overflow-hidden';
        wrap.style.cssText = 'height:calc(100vh - 285px);min-height:480px';
        wrap.innerHTML = `<canvas id="emc" style="position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:grab"></canvas>
          <div id="em-bar" class="absolute top-3 left-3 right-3 flex flex-wrap gap-2 items-center pointer-events-none z-10"></div>
          <div id="em-layers" class="absolute top-14 right-3 w-72 max-w-[calc(100%-1.5rem)] max-h-[72%] overflow-auto bg-white/95 border border-slate-200 rounded-xl shadow-lg p-3 text-sm z-10"></div>
          <div id="em-info" class="hidden absolute bottom-10 left-3 w-80 max-w-[calc(100%-1.5rem)] bg-white/95 border border-slate-200 rounded-xl shadow-lg p-3 text-sm z-10"></div>
          <div id="em-coord" class="absolute bottom-2 left-3 bg-white/90 border border-slate-200 rounded-lg px-2.5 py-1 text-[11px] font-mono text-slate-500 shadow-sm pointer-events-none z-10">座標：移至地圖顯示</div>
          <div class="absolute bottom-3 right-3 flex flex-col bg-white/95 border border-slate-200 rounded-xl shadow overflow-hidden z-10"><button id="em-zi" class="w-9 h-9 text-lg hover:bg-slate-100" title="放大">＋</button><button id="em-zo" class="w-9 h-9 text-lg hover:bg-slate-100 border-t" title="縮小">－</button><button id="em-zf" class="w-9 h-9 text-xs hover:bg-slate-100 border-t" title="縮放至桃園全市">全市</button></div>`;
        sec.appendChild(wrap);
        cv = $('emc');
        cx = cv.getContext('2d');

        const m = document.createElement('div');
        m.id = 'em-modal';
        m.className = 'hidden fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[130] flex items-center justify-center p-3';
        m.innerHTML = '<div id="em-mb" class="bg-white rounded-2xl shadow-2xl p-5 w-full max-w-lg max-h-[90vh] overflow-auto"></div>';
        document.body.appendChild(m);
        m.addEventListener('mousedown', e => { if (e.target === m) closeM(); });

        tabBar.querySelectorAll('button').forEach(b => (b.onclick = () => tab(b.dataset.t)));
        $('em-zi').onclick = () => zoomAt(cw / 2, ch / 2, 1.6);
        $('em-zo').onclick = () => zoomAt(cw / 2, ch / 2, 0.62);
        $('em-zf').onclick = fit;

        new ResizeObserver(resize).observe(wrap);
        bindPointer();
        if (innerWidth < 768) $('em-layers').classList.add('hidden');
        renderBar();
        renderLayers();
        requestAnimationFrame(loop);
      }

      function tab(t) {
        const isMap = t === 'map';
        if (statPanel) statPanel.classList.toggle('hidden', isMap);
        wrap.classList.toggle('hidden', !isMap);
        tabBar.querySelectorAll('button').forEach(b => {
          const a = b.dataset.t === t;
          b.className = 'tab-btn px-4 py-2 ' + (a ? 'bg-indigo-600 text-white font-bold shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200');
        });
        if (isMap) {
          init();
          resize();
          renderBar();
          renderLayers();
          showInfo();
          if (!fitted) fit();
          dirty = 1;
        }
      }

      function afterOpenEval() {
        build();
        init();
        decorate();
        renderBar();
        renderLayers();
        dirty = 1;
      }
      const openM = h => { $('em-mb').innerHTML = h; $('em-modal').classList.remove('hidden'); };
      const closeM = () => $('em-modal').classList.add('hidden');
      W.__emClose = closeM;

      function init() {
        if (inited) return;
        inited = true;
        sub('mapFeatures', a => {
          F = a;
          F.forEach(f => (f._g = null));
          if (sel) sel = F.find(f => f.id === sel.id) || null;
          refresh();
        });
        sub('mapStyles', a => {
          S = {};
          a.forEach(s => (S[s.id] = s));
          refresh();
        });
        sub('mapRoads', a => {
          R = [];
          a.sort((x, y) => (x.id < y.id ? -1 : 1)).forEach(r => {
            try { JSON.parse(r.s).forEach(addRoad); } catch (e) {}
          });
          if (R.length && !fitted) fit();
          dirty = 1;
        });
      }

      function refreshDetailModalIfOpen() {
        const dm = $('eval-detail-modal');
        if (dm && !dm.classList.contains('hidden') && W.currentEvalDetailParams) {
          const { itemId, yr, dst } = W.currentEvalDetailParams;
          W.openEvalDetail(itemId, yr, dst);
        }
      }

      function refresh() {
        renderBar();
        renderLayers();
        showInfo();
        decorate();
        refreshDetailModalIfOpen();
        dirty = 1;
      }

      // 與「數量統計」卡片整合：顯示類別樣式色點與地圖標註進度捷徑
      function decorate() {
        const box = $('eval-dashboard-results');
        if (!box) return;
        box.querySelectorAll('[onclick^="window.openEvalDetail"]').forEach(card => {
          const id = (card.getAttribute('onclick').match(/'([^']+)'/) || [])[1];
          if (!id) return;
          const st = getCategoryCaseStats(id);
          const s = style(id);
          let a = card.querySelector('.em-link');
          if (!a) {
            a = document.createElement('div');
            a.className = 'em-link text-[11px] font-bold mt-1.5 pt-1.5 border-t border-slate-100 flex items-center justify-center gap-1.5 text-sky-600 hover:text-indigo-700';
            a.onclick = e => { e.stopPropagation(); focusCategoryOnMap(id); };
            card.appendChild(a);
          }
          a.innerHTML = `<span style="width:9px;height:9px;border-radius:${s.type==='line'?'2px':'99px'};background:${s.color};display:inline-block"></span><span>地圖 ${st.plottedCount}/${st.totalCases} 筆</span>`;
        });
      }

      function focusCategoryOnMap(itemId) {
        init();
        on[itemId] = true;
        expanded[itemId] = true;
        tab('map');
        renderLayers();
        $('em-layers')?.classList.remove('hidden');
        dirty = 1;
      }

      function focusFeature(feat) {
        if (!feat) return;
        const g = G(feat);
        on[feat.item] = true;
        sel = feat;
        tab('map');
        if (g.length) {
          let la0 = 1e9, la1 = -1e9, lo0 = 1e9, lo1 = -1e9;
          g.forEach(p => { la0 = Math.min(la0, p[0]); la1 = Math.max(la1, p[0]); lo0 = Math.min(lo0, p[1]); lo1 = Math.max(lo1, p[1]); });
          V.y = (la0 + la1) / 2;
          V.x = (lo0 + lo1) / 2;
          if (g.length > 1 && cw) {
            const spanX = Math.max(0.002, (lo1 - lo0) * K);
            const spanY = Math.max(0.002, la1 - la0);
            V.z = Math.min(120000, Math.max(15000, Math.min(cw / spanX, ch / spanY) * 0.45));
          } else {
            V.z = Math.max(V.z, 35000);
          }
        }
        showInfo();
        renderLayers();
        dirty = 1;
      }

      function focusWoOnMap(itemId, woDocId) {
        init();
        $('eval-detail-modal')?.classList.add('hidden');
        const feat = getFeatureForWo(itemId, woDocId);
        if (feat && G(feat).length) {
          focusFeature(feat);
        } else {
          startWoMapPick(itemId, woDocId);
        }
      }

      // 啟動互動式地圖點選 / 路段繪製（支援派工單案件、既有圖徵重繪、或新增獨立位置）
      function startInteractiveDraw({ itemId, woDocId = '', feat = null, geomType = null }) {
        init();
        const resolvedFeat = feat || (woDocId ? getFeatureForWo(itemId, woDocId) : null);
        const wo = woDocId ? (W.workOrders || []).find(w => w.docId === woDocId) : (resolvedFeat?.wo ? (W.workOrders || []).find(w => w.docId === resolvedFeat.wo) : null);
        const gType = geomType || (resolvedFeat ? featType(resolvedFeat, itemId) : style(itemId).type);
        const existingPts = resolvedFeat ? G(resolvedFeat).map(p => [...p]) : [];
        on[itemId] = true;
        drawCtx = {
          itemId,
          woDocId: wo?.docId || resolvedFeat?.wo || '',
          featId: resolvedFeat?.id || '',
          existingFeat: resolvedFeat || null,
          wo: wo || null,
          geomType: gType,
          label: resolvedFeat?.name || (wo ? `${wo.id || '尚未編號'} ${wo.location || ''}`.trim() : (items().find(i => i.docId === itemId)?.name || '新位置'))
        };
        pts = gType === 'point' ? (existingPts.length ? [existingPts[0]] : []) : existingPts;
        sel = null;
        tab('map');
        if (existingPts.length) {
          V.y = existingPts[0][0];
          V.x = existingPts[0][1];
          V.z = Math.max(V.z, 25000);
        }
        cv && (cv.style.cursor = 'crosshair');
        showInfo();
        renderBar();
        renderLayers();
        dirty = 1;
      }

      function startWoMapPick(itemId, woDocId) {
        $('eval-detail-modal')?.classList.add('hidden');
        startInteractiveDraw({ itemId, woDocId });
      }

      function cancelDraw() {
        drawCtx = null;
        pts = [];
        cv && (cv.style.cursor = 'grab');
        renderBar();
        dirty = 1;
      }

      async function saveInteractiveDraw(openDetailAfter = false) {
        if (!drawCtx) return;
        if (drawCtx.geomType === 'line' && pts.length < 2) {
          return W.customAlert('路段線段請至少在地圖上點選 2 個點！', 'error');
        }
        if (drawCtx.geomType === 'point' && pts.length < 1) {
          return W.customAlert('請先在地圖上點選 1 個位置！', 'error');
        }
        const finalPts = drawCtx.geomType === 'point' ? [pts[0]] : pts;
        const gStr = toG(finalPts);
        const ex = drawCtx.existingFeat;
        const wo = drawCtx.wo;
        const draft = {
          id: ex?.id || '',
          item: drawCtx.itemId,
          name: ex?.name || wo?.location || '',
          date: ex?.date || wo?.actualDate || '',
          desc: ex?.desc || wo?.content || '',
          wo: drawCtx.woDocId || '',
          geomType: drawCtx.geomType,
          g: gStr
        };

        // 若是全新無綁定派工單的獨立位置，或使用者點「編輯詳細資料」，先開啟對話框確認名稱與說明
        if (openDetailAfter || (!ex && !wo)) {
          featDlg(draft, !ex, true);
          return;
        }
        const saveId = draft.id || uid();
        const ok = await put('mapFeatures', saveId, {
          item: draft.item,
          name: draft.name,
          date: draft.date,
          desc: draft.desc,
          wo: draft.wo,
          geomType: draft.geomType,
          g: draft.g,
          by: W.currentUser?.username || '',
          at: Date.now()
        });
        if (ok) {
          cancelDraw();
          sel = F.find(f => f.id === saveId) || null;
          showInfo();
          dirty = 1;
        }
      }

      // 圖層面板（顯示各類別樣式編輯、已標/總筆數，並可展開列出所有關聯派工單直接操作）
      function swatch(s) {
        return s.type === 'line'
          ? `<svg width="24" height="14"><line x1="2" y1="7" x2="22" y2="7" stroke="${s.color}" stroke-width="${Math.min(6, s.size)}" ${s.dash ? 'stroke-dasharray="5 3"' : ''} stroke-linecap="round"/></svg>`
          : `<svg width="24" height="14"><circle cx="12" cy="7" r="5" fill="${s.color}"/></svg>`;
      }

      function renderLayers() {
        const el = $('em-layers');
        if (!el) return;
        const its = items();
        if (!its.length) {
          el.innerHTML = '<div class="text-slate-400 text-xs">尚無考評項目。請先到「系統設定 → 道路考評項目管理」建立。</div>';
          return;
        }
        const groups = {};
        (W.evalCategories || []).forEach(c => (groups[c.name] = []));
        groups['未分類'] = [];
        its.forEach(i => (groups[i.category] || groups['未分類']).push(i));

        el.innerHTML = `<div class="flex justify-between items-center mb-2 pb-1.5 border-b border-slate-100"><b class="text-slate-700">改善類別圖層</b><span class="flex gap-1"><button class="em-b text-xs" data-all="1">全開</button><button class="em-b text-xs" data-all="0">全關</button></span></div>` +
          Object.entries(groups).filter(([, v]) => v.length).map(([k, v]) =>
            `<div class="mt-2"><div class="text-[11px] font-bold text-indigo-700 bg-indigo-50 inline-block px-2 py-0.5 rounded mb-1">${esc(k)}</div>` +
            v.map(i => {
              const s = style(i.docId);
              const st = getCategoryCaseStats(i.docId);
              const layerActive = isLayerOn(i.docId);
              const isExp = Boolean(expanded[i.docId]);
              const badgeCls = st.totalCases === 0
                ? 'bg-slate-100 text-slate-400'
                : (st.plottedCount === st.totalCases ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800');

              let casesHtml = '';
              if (isExp) {
                const woListHtml = st.woRows.map(row => {
                  const title = `${row.wo.id || '尚未編號'} ${row.wo.location || ''}`.trim();
                  return `<div class="flex items-center justify-between gap-1 py-1 px-1.5 rounded hover:bg-slate-50 border-b border-slate-100 last:border-0 text-[11px]">
                    <div class="truncate flex-1" title="${esc(title)} (${row.value}${esc(i.unit || '')})">
                      <span class="inline-block w-2 h-2 rounded-full mr-1 ${row.hasGeo ? 'bg-emerald-500' : 'bg-amber-400'}"></span>
                      <span class="font-semibold text-slate-700">${esc(row.wo.id || '尚未編號')}</span>
                      <span class="text-slate-500 ml-1">${esc(row.wo.location || '')}</span>
                    </div>
                    <div class="flex-none flex items-center gap-1">
                      ${row.hasGeo
                        ? `<button type="button" class="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 hover:bg-sky-100 font-bold" data-focus-wo="${i.docId}|${row.wo.docId}" title="定位">定位</button>` +
                          `<button type="button" class="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 hover:bg-amber-100 font-bold" data-pick-wo="${i.docId}|${row.wo.docId}" title="在地圖重設點或路段">重繪</button>`
                        : `<button type="button" class="px-1.5 py-0.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 font-bold" data-pick-wo="${i.docId}|${row.wo.docId}" title="前往地圖標註">標註</button>`}
                      <button type="button" class="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-bold" data-edit-wo="${i.docId}|${row.wo.docId}" title="編輯地圖資訊">編輯</button>
                    </div>
                  </div>`;
                }).join('');

                const manualHtml = st.manualFeats.map(f => {
                  return `<div class="flex items-center justify-between gap-1 py-1 px-1.5 rounded hover:bg-slate-50 border-b border-slate-100 last:border-0 text-[11px]">
                    <div class="truncate flex-1" title="${esc(f.name || '獨立標註')}">
                      <span class="inline-block w-2 h-2 rounded-full mr-1 bg-indigo-500"></span>
                      <span class="font-semibold text-slate-700">${esc(f.name || '（獨立標註）')}</span>
                    </div>
                    <div class="flex-none flex items-center gap-1">
                      <button type="button" class="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 hover:bg-sky-100 font-bold" data-focus-f="${f.id}">定位</button>
                      <button type="button" class="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-bold" data-edit-f="${f.id}">編輯</button>
                    </div>
                  </div>`;
                }).join('');

                casesHtml = `<div class="ml-3 pl-2 border-l-2 border-indigo-100 my-1 space-y-0.5 bg-slate-50/60 rounded-r py-1">${woListHtml}${manualHtml || (!woListHtml ? '<div class="text-[11px] text-slate-400 px-1.5 py-1">目前無已完工案件</div>' : '')}</div>`;
              }

              return `<div class="border-b border-slate-100 last:border-0 py-1">
                <div class="flex items-center gap-1.5 select-none">
                  <button type="button" class="w-4 h-5 flex-none text-slate-400 hover:text-indigo-600 text-xs" data-exp="${i.docId}" title="展開/收合案件列表"><i class="fas fa-chevron-${isExp ? 'down' : 'right'}"></i></button>
                  <div class="flex items-center gap-1.5 flex-1 min-w-0 cursor-pointer ${layerActive ? '' : 'opacity-40'}" data-l="${i.docId}" title="點擊顯示/隱藏圖層">
                    <span class="w-6 flex-none">${swatch(s)}</span>
                    <span class="flex-1 truncate font-medium text-slate-700" title="${esc(i.name)}">${esc(i.name)}</span>
                  </div>
                  <button type="button" class="px-1.5 py-0.5 rounded-full text-[11px] font-bold flex-none ${badgeCls}" data-exp="${i.docId}" title="已標註 / 總案件數（點擊展開案件）">${st.plottedCount}/${st.totalCases}</button>
                  ${canEdit() ? `<button type="button" class="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-indigo-100 text-slate-600 hover:text-indigo-700 text-[11px] font-bold flex-none" data-s="${i.docId}" title="編輯顏色、點/線型態"><i class="fas fa-palette"></i></button>` : ''}
                </div>
                ${casesHtml}
              </div>`;
            }).join('') + '</div>'
          ).join('');

        el.querySelectorAll('[data-l]').forEach(r => (r.onclick = () => {
          on[r.dataset.l] = !isLayerOn(r.dataset.l);
          renderLayers();
          dirty = 1;
        }));
        el.querySelectorAll('[data-exp]').forEach(b => (b.onclick = e => {
          e.stopPropagation();
          expanded[b.dataset.exp] = !expanded[b.dataset.exp];
          renderLayers();
        }));
        el.querySelectorAll('[data-s]').forEach(b => (b.onclick = e => {
          e.stopPropagation();
          styleDlg(b.dataset.s);
        }));
        el.querySelectorAll('[data-all]').forEach(b => (b.onclick = () => {
          items().forEach(i => (on[i.docId] = b.dataset.all === '1'));
          renderLayers();
          dirty = 1;
        }));
        el.querySelectorAll('[data-focus-wo]').forEach(b => (b.onclick = e => {
          e.stopPropagation();
          const [itemId, woDocId] = b.dataset.focusWo.split('|');
          const f = getFeatureForWo(itemId, woDocId);
          if (f) focusFeature(f);
        }));
        el.querySelectorAll('[data-pick-wo]').forEach(b => (b.onclick = e => {
          e.stopPropagation();
          const [itemId, woDocId] = b.dataset.pickWo.split('|');
          startInteractiveDraw({ itemId, woDocId });
        }));
        el.querySelectorAll('[data-edit-wo]').forEach(b => (b.onclick = e => {
          e.stopPropagation();
          const [itemId, woDocId] = b.dataset.editWo.split('|');
          openWoMapEditor(itemId, woDocId);
        }));
        el.querySelectorAll('[data-focus-f]').forEach(b => (b.onclick = e => {
          e.stopPropagation();
          const f = F.find(x => x.id === b.dataset.focusF);
          if (f) focusFeature(f);
        }));
        el.querySelectorAll('[data-edit-f]').forEach(b => (b.onclick = e => {
          e.stopPropagation();
          const f = F.find(x => x.id === b.dataset.editF);
          if (f) featDlg(f, false);
        }));
      }

      function renderBar() {
        const b = $('em-bar');
        if (!b) return;
        const ed = canEdit(), its = items();
        let h = `<button class="em-b pointer-events-auto shadow-sm" id="em-tg"><i class="fas fa-layer-group mr-1 text-indigo-600"></i>圖層與案件</button>`;
        if (ed) {
          if (drawCtx) {
            const isLine = drawCtx.geomType === 'line';
            const hint = isLine
              ? `繪製路段「${esc(drawCtx.label)}」（已點 ${pts.length} 點，點擊新增 / 拖曳紅框節點微調）`
              : `標註點位「${esc(drawCtx.label)}」（${pts.length ? '已定位，可拖曳或重選' : '請點擊地圖放置位置'}）`;
            h += `<span class="pointer-events-auto bg-indigo-50 border border-indigo-300 text-indigo-900 font-bold rounded-lg px-3 py-1 text-xs shadow-sm">${hint}</span>` +
              `<button class="em-b pointer-events-auto shadow-sm" id="em-sw" title="切換點位或路段線段"><i class="fas fa-exchange-alt mr-1"></i>改為${isLine ? '點位' : '路段線'}</button>` +
              (isLine ? `<button class="em-b pointer-events-auto shadow-sm" id="em-un">復原一點</button><button class="em-b pointer-events-auto shadow-sm" id="em-cl">清空重畫</button>` : '') +
              `<button class="em-b em-ok pointer-events-auto shadow-sm" id="em-fin"><i class="fas fa-check mr-1"></i>確認儲存</button>` +
              `<button class="em-b pointer-events-auto shadow-sm" id="em-dt">詳細資料</button>` +
              `<button class="em-b pointer-events-auto shadow-sm" id="em-cx">取消</button>`;
          } else {
            h += `<select id="em-add" class="pointer-events-auto border border-slate-300 rounded-lg px-2.5 py-1 text-sm bg-white shadow-sm"><option value="">＋ 地圖新增位置（選擇考評類別）</option>${its.map(i => `<option value="${i.docId}">${esc(i.name)}（${style(i.docId).type === 'line' ? '線' : '點'}）</option>`).join('')}</select><button class="em-b pointer-events-auto shadow-sm" id="em-io"><i class="fas fa-file-arrow-up mr-1"></i>匯入／匯出</button>`;
          }
        } else {
          h += `<button class="em-b pointer-events-auto shadow-sm" id="em-io"><i class="fas fa-file-arrow-down mr-1"></i>匯出</button>`;
        }
        b.innerHTML = h;
        $('em-tg').onclick = () => $('em-layers').classList.toggle('hidden');
        $('em-add') && ($('em-add').onchange = e => {
          if (!e.target.value) return;
          const itemId = e.target.value;
          e.target.value = '';
          startInteractiveDraw({ itemId });
        });
        $('em-sw') && ($('em-sw').onclick = () => {
          if (!drawCtx) return;
          drawCtx.geomType = drawCtx.geomType === 'line' ? 'point' : 'line';
          if (drawCtx.geomType === 'point' && pts.length > 1) pts = [pts[0]];
          renderBar();
          dirty = 1;
        });
        $('em-cx') && ($('em-cx').onclick = cancelDraw);
        $('em-un') && ($('em-un').onclick = () => { pts.pop(); renderBar(); dirty = 1; });
        $('em-cl') && ($('em-cl').onclick = () => { pts = []; renderBar(); dirty = 1; });
        $('em-fin') && ($('em-fin').onclick = () => saveInteractiveDraw(false));
        $('em-dt') && ($('em-dt').onclick = () => saveInteractiveDraw(true));
        $('em-io') && ($('em-io').onclick = ioDlg);
      }

      function showInfo() {
        const b = $('em-info');
        if (!b) return;
        if (!sel) { b.classList.add('hidden'); return; }
        const it = items().find(i => i.docId === sel.item);
        const wo = sel.wo ? (W.workOrders || []).find(w => w.docId === sel.wo) : null;
        const gType = featType(sel);
        const evalVal = (wo && it) ? W.parseEvalPositiveNum(wo.evalData?.[it.docId]) : 0;
        b.classList.remove('hidden');
        b.innerHTML = `<div class="flex justify-between items-start gap-2"><div><div class="font-bold text-slate-800">${esc(sel.name || wo?.location || '（未命名）')}</div><div class="text-xs text-indigo-600 font-semibold">${esc(it?.name || '')}${evalVal ? ` · ${evalVal} ${esc(it?.unit || '')}` : ''}${sel.date ? ' · ' + esc(sel.date) : ''} · <span class="text-slate-500">${gType === 'line' ? '路段線' : '點位'}</span></div></div><button class="text-slate-400 hover:text-rose-500" id="em-xi"><i class="fas fa-times"></i></button></div>` +
          `${sel.desc ? `<div class="mt-2 text-slate-600 whitespace-pre-wrap text-xs">${esc(sel.desc)}</div>` : ''}` +
          `<div class="mt-2.5 flex flex-wrap gap-1.5 items-center justify-end">` +
          `${wo ? `<button class="em-b text-xs" id="em-wo"><i class="fas fa-file-alt mr-1 text-indigo-500"></i>派工單 ${esc(wo.id || '尚未編號')}</button>` : ''}` +
          `${canEdit() ? `<button class="em-b text-xs" style="color:#b45309;border-color:#fcd34d;background:#fffbeb" id="em-mv"><i class="fas fa-draw-polygon mr-1"></i>調整位置/路段</button><button class="em-b em-p text-xs" id="em-ed"><i class="fas fa-pen mr-1"></i>編輯資料</button>` : ''}` +
          `</div>`;
        $('em-xi').onclick = () => { sel = null; showInfo(); dirty = 1; };
        $('em-wo') && ($('em-wo').onclick = () => W.openWoModal?.(wo.docId, true));
        $('em-mv') && ($('em-mv').onclick = () => startInteractiveDraw({ itemId: sel.item, woDocId: sel.wo || '', feat: sel }));
        $('em-ed') && ($('em-ed').onclick = () => featDlg(sel, false));
      }

      // 開啟指定派工單的地圖編輯視窗（供明細列表與圖層清單呼叫）
      function openWoMapEditor(itemId, woDocId) {
        init();
        const existing = getFeatureForWo(itemId, woDocId);
        if (existing) {
          featDlg(existing, false);
          return;
        }
        const wo = (W.workOrders || []).find(w => w.docId === woDocId);
        featDlg({
          item: itemId,
          wo: woDocId,
          name: wo?.location || '',
          date: wo?.actualDate || '',
          desc: wo?.content || '',
          geomType: '',
          g: ''
        }, true);
      }

      // 對話框（新增/編輯案件地圖資訊、類別樣式設定、匯入/匯出）
      function featDlg(f, isNew, fromDraw = false) {
        const its = items();
        const wos = [...(W.workOrders || [])].sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
        const curGeomType = f.geomType || '';
        const catDefaultType = style(f.item || its[0]?.docId).type;
        openM(`<h2 class="text-lg font-bold mb-2">${isNew ? '新增' : '編輯'}改善成果地圖資訊</h2>
          <div class="grid grid-cols-2 gap-2">
            <div><label>改善類別（考評項目）</label><select id="f-i">${its.map(i => `<option value="${i.docId}" ${i.docId === f.item ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select></div>
            <div><label>此案件顯示型態</label><select id="f-gt"><option value="" ${!curGeomType ? 'selected' : ''}>跟隨類別預設（${catDefaultType === 'line' ? '路段線' : '點位'}）</option><option value="point" ${curGeomType === 'point' ? 'selected' : ''}>點位（單點）</option><option value="line" ${curGeomType === 'line' ? 'selected' : ''}>路段線段（多點連線）</option></select></div>
          </div>
          <label>名稱（路口／路段）</label><input id="f-n" value="${esc(f.name)}" placeholder="例：中正路與復興路口">
          <div class="grid grid-cols-2 gap-2"><div><label>改善日期</label><input id="f-d" value="${esc(f.date)}" placeholder="例：2026-06-15"></div><div><label>連結派工單（選填）</label><select id="f-w"><option value="">不連結</option>${wos.map(w => `<option value="${w.docId}" ${w.docId === f.wo ? 'selected' : ''}>${esc(w.id || '尚未編號')}　${esc((w.location || '').slice(0, 14))}</option>`).join('')}</select></div></div>
          <label>說明</label><textarea id="f-x" rows="2">${esc(f.desc)}</textarea>
          <div class="flex items-center justify-between mt-2"><label style="margin:0">座標（緯度,經度；路段線以分號 ; 分隔多點）</label><button type="button" id="f-pick" class="text-xs bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 rounded font-bold"><i class="fas fa-map-marker-alt mr-1"></i>前往地圖點選/繪製</button></div>
          <textarea id="f-g" rows="2" class="mt-1 font-mono text-xs" placeholder="點位例：24.993600,121.301000&#10;線段例：24.9936,121.3010;24.9950,121.3035">${esc(f.g)}</textarea>
          <div class="flex gap-2 justify-end mt-4">${isNew ? '' : '<button class="em-b" style="color:#e11d48;border-color:#e11d48" id="f-del">刪除標註</button><span class="flex-1"></span>'}<button class="em-b" id="f-cx">取消</button><button class="em-b em-p" id="f-ok">儲存</button></div>`);

        $('f-cx').onclick = () => { closeM(); if (fromDraw) cancelDraw(); };
        $('f-pick').onclick = () => {
          const itemId = $('f-i').value;
          const gt = $('f-gt').value || style(itemId).type;
          const tempFeat = {
            ...(f || {}),
            item: itemId,
            name: $('f-n').value.trim(),
            date: $('f-d').value.trim(),
            desc: $('f-x').value,
            wo: $('f-w').value,
            geomType: $('f-gt').value,
            g: $('f-g').value.trim()
          };
          tempFeat._g = null;
          closeM();
          $('eval-detail-modal')?.classList.add('hidden');
          startInteractiveDraw({ itemId, woDocId: tempFeat.wo, feat: tempFeat, geomType: gt });
        };
        if (!isNew) {
          $('f-del').onclick = () => W.customConfirm('確定刪除此案件的地圖標註？', async () => {
            await del('mapFeatures', f.id);
            sel = null;
            closeM();
            showInfo();
          });
        }
        $('f-ok').onclick = async () => {
          const g = fromG($('f-g').value);
          if (!g.length) return W.customAlert('請輸入正確座標格式（例如 24.9936,121.3010），或點擊「前往地圖點選/繪製」', 'error');
          const iid = $('f-i').value;
          const gt = $('f-gt').value;
          const effType = (gt === 'point' || gt === 'line') ? gt : style(iid).type;
          if (effType === 'point') g.length = 1;
          else if (g.length < 2) return W.customAlert('路段線段需要至少 2 組座標（以分號 ; 分隔），或改選「點位」', 'error');
          const saveId = f.id || uid();
          const ok = await put('mapFeatures', saveId, {
            item: iid,
            name: $('f-n').value.trim(),
            date: $('f-d').value.trim(),
            desc: $('f-x').value,
            wo: $('f-w').value,
            geomType: gt,
            g: toG(g),
            by: W.currentUser?.username || '',
            at: Date.now()
          });
          if (ok) {
            closeM();
            if (fromDraw) cancelDraw();
            sel = F.find(x => x.id === saveId) || null;
            showInfo();
          }
        };
      }

      function styleDlg(id) {
        const it = items().find(i => i.docId === id), s = style(id);
        openM(`<h2 class="text-lg font-bold mb-1">類別地圖樣式設定：${esc(it?.name || '')}</h2><div class="text-xs text-slate-500 mb-2">調整此考評類別在地圖上的顏色、點位或路段線段顯示樣式。</div>
          <div class="grid grid-cols-2 gap-3">
            <div><label>位置型態</label><select id="s-t"><option value="point" ${s.type === 'point' ? 'selected' : ''}>點位（路口／設施點）</option><option value="line" ${s.type === 'line' ? 'selected' : ''}>線段（改善路段）</option></select></div>
            <div><label>圖示／線條顏色</label><div class="flex items-center gap-2"><input id="s-c" type="color" value="${s.color}"><div class="flex flex-wrap gap-1">${PAL.slice(0, 6).map(c => `<button type="button" class="w-5 h-5 rounded-full border border-slate-300" style="background:${c}" data-pal="${c}"></button>`).join('')}</div></div></div>
            <div><label>大小（點半徑／線寬）</label><input id="s-z" type="number" min="2" max="20" value="${s.size}"></div>
            <div><label>細部樣式</label><select id="s-h"></select></div>
          </div>
          <div class="text-xs text-amber-600 mt-3 bg-amber-50 p-2 rounded-lg border border-amber-200">提示：切換為「線段」後，原本僅有 1 點的案件仍會以虛線圓圈顯示，點選後按「調整位置/路段」即可補繪成完整路段。</div>
          <div class="flex gap-2 justify-end mt-4"><button class="em-b" id="s-rs">還原預設</button><span class="flex-1"></span><button class="em-b" id="s-cx">取消</button><button class="em-b em-p" id="s-ok">儲存樣式</button></div>`);
        const fill = () => {
          const l = $('s-t').value === 'line';
          $('s-h').innerHTML = l
            ? `<option value="0" ${!s.dash ? 'selected' : ''}>實線</option><option value="1" ${s.dash ? 'selected' : ''}>虛線</option>`
            : ['circle:圓形', 'square:方形', 'diamond:菱形', 'triangle:三角形'].map(x => {
                const [v, t] = x.split(':');
                return `<option value="${v}" ${s.shape === v ? 'selected' : ''}>${t}</option>`;
              }).join('');
        };
        fill();
        $('s-t').onchange = fill;
        $('em-mb').querySelectorAll('[data-pal]').forEach(btn => (btn.onclick = () => { $('s-c').value = btn.dataset.pal; }));
        $('s-cx').onclick = closeM;
        $('s-rs').onclick = async () => { await del('mapStyles', id); closeM(); };
        $('s-ok').onclick = async () => {
          const l = $('s-t').value === 'line', h = $('s-h').value;
          await put('mapStyles', id, { type: l ? 'line' : 'point', color: $('s-c').value, size: +$('s-z').value || 6, shape: l ? 'circle' : h, dash: l && h === '1' });
          closeM();
        };
      }

      function ioDlg() {
        const ed = canEdit();
        openM(`<h2 class="text-lg font-bold mb-2">匯入／匯出</h2>${ed ? `<label>① 匯入改善成果（Excel／CSV）</label><input id="io-x" type="file" accept=".xlsx,.xls,.csv"><div class="text-xs text-slate-500 mt-1">欄位：類別（須與考評項目名稱相同）、名稱、說明、日期、派工單編號、座標（緯度,經度；線以分號分隔）。<a href="#" id="io-t" class="text-indigo-600 underline">下載範本</a></div>
          <label>② 匯入全市道路 GIS（GeoJSON，WGS84 或 TWD97）</label><input id="io-r" type="file" accept=".json,.geojson"><div class="text-xs text-slate-500 mt-1">匯入會取代現有道路圖，建議先簡化至 10 MB 內。</div>` : ''}
          <label>${ed ? '③ ' : ''}匯出</label><div class="flex gap-2"><button class="em-b" id="io-ex">匯出 Excel</button><button class="em-b" id="io-eg">匯出 GeoJSON</button></div><div id="io-m" class="text-xs text-indigo-600 mt-2 whitespace-pre-wrap"></div><div class="text-right mt-4"><button class="em-b" onclick="window.__emClose()">關閉</button></div>`);
        const m = t => ($('io-m').textContent = t);
        $('io-ex').onclick = () => {
          const nm = id => items().find(i => i.docId === id)?.name || '';
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['類別', '名稱', '說明', '日期', '派工單編號', '型態', '座標'], ...F.map(f => [nm(f.item), f.name, f.desc, f.date, (W.workOrders || []).find(w => w.docId === f.wo)?.id || '', featType(f) === 'line' ? '線' : '點', f.g])]), '改善成果');
          XLSX.writeFile(wb, `改善成果地圖_${Date.now()}.xlsx`);
          m('已匯出 Excel');
        };
        $('io-eg').onclick = () => {
          const feats = F.filter(f => G(f).length > 0).map(f => {
            const tp = featType(f), g = fromG(f.g).map(p => [p[1], p[0]]);
            return { type: 'Feature', properties: { 類別: items().find(i => i.docId === f.item)?.name, 名稱: f.name, 說明: f.desc, 日期: f.date }, geometry: (tp === 'line' && g.length >= 2) ? { type: 'LineString', coordinates: g } : { type: 'Point', coordinates: g[0] } };
          });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([JSON.stringify({ type: 'FeatureCollection', features: feats })]));
          a.download = '改善成果地圖.geojson';
          a.click();
          m('已匯出 GeoJSON');
        };
        if (!ed) return;
        $('io-t').onclick = e => {
          e.preventDefault();
          const wb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['類別', '名稱', '說明', '日期', '派工單編號', '座標'], [items()[0]?.name || '標線型人行道', '○○路與△△路口', '增設行人專用號誌', '115/06', '', '24.9936,121.3010']]), '範本');
          XLSX.writeFile(wb, '改善成果匯入範本.xlsx');
        };
        $('io-x').onchange = async e => {
          const f = e.target.files[0];
          if (!f) return;
          try {
            const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
            const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
            let n = 0, miss = new Set();
            for (const r of rows) {
              const it = items().find(i => i.name === String(r['類別'] || '').trim());
              if (!it) { miss.add(r['類別']); continue; }
              const g = fromG(r['座標']);
              if (!g.length) { miss.add('（缺座標）'); continue; }
              const woDocId = (W.workOrders || []).find(w => w.id && w.id === String(r['派工單編號'] || '').trim())?.docId || '';
              const existing = woDocId ? getFeatureForWo(it.docId, woDocId) : null;
              if (style(it.docId).type === 'point' && g.length === 1) g.length = 1;
              await put('mapFeatures', existing?.id || uid(), {
                item: it.docId, name: String(r['名稱'] || ''), desc: String(r['說明'] || ''), date: String(r['日期'] || ''),
                wo: woDocId, geomType: g.length >= 2 ? 'line' : '', g: toG(g), by: W.currentUser?.username || '', at: Date.now()
              });
              n++;
            }
            m(`已匯入 ${n} 筆` + (miss.size ? `\n略過（找不到類別或座標）：${[...miss].join('、')}` : ''));
          } catch (err) {
            m('讀取失敗：' + err.message);
          }
        };
        $('io-r').onchange = e => impRoad(e.target.files[0], m);
      }

      // 道路 GIS 匯入（支援 WGS84 與 TWD97 座標轉換）
      function tw(x, y) {
        const a = 6378137, e2 = 0.00669438002290, ep = e2 / (1 - e2), M = y / 0.9998;
        const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
        const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
        const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
        const s = Math.sin(p1), c = Math.cos(p1), N = a / Math.sqrt(1 - e2 * s * s), T = Math.tan(p1) ** 2, C = ep * c * c;
        const Rr = a * (1 - e2) / Math.pow(1 - e2 * s * s, 1.5), D = (x - 250000) / (N * 0.9998);
        const la = p1 - (N * Math.tan(p1) / Rr) * (D * D / 2 - (5 + 3 * T + 10 * C - 4 * C * C - 9 * ep) * D ** 4 / 24 + (61 + 90 * T + 298 * C + 45 * T * T - 252 * ep - 3 * C * C) * D ** 6 / 720);
        const lo = 121 * Math.PI / 180 + (D - (1 + 2 * T + C) * D ** 3 / 6 + (5 - 2 * C + 28 * T + 8 * ep - 3 * C * C + 24 * T * T) * D ** 5 / 120) / c;
        return [lo * 180 / Math.PI, la * 180 / Math.PI];
      }

      function addRoad(f) {
        let a = 1e9, b = -1e9, c = 1e9, d = -1e9;
        for (let i = 0; i < f.length; i += 2) {
          if (f[i] < a) a = f[i];
          if (f[i] > b) b = f[i];
          if (f[i + 1] < c) c = f[i + 1];
          if (f[i + 1] > d) d = f[i + 1];
        }
        R.push({ b: [a, b, c, d], p: f });
      }

      async function impRoad(f, m) {
        if (!f) return;
        m('處理道路資料⋯');
        try {
          const j = JSON.parse(await f.text()), lines = [];
          const add = cs => {
            if (!cs.length) return;
            const t = cs[0][0] > 1000, fl = [];
            for (const p of cs) {
              let x = p[0], y = p[1];
              if (t) [x, y] = tw(x, y);
              fl.push(+x.toFixed(5), +y.toFixed(5));
            }
            lines.push(fl);
          };
          const geo = g => {
            if (!g) return;
            if (g.type === 'LineString') add(g.coordinates);
            else if (g.type === 'MultiLineString') g.coordinates.forEach(add);
            else if (g.type === 'GeometryCollection') g.geometries.forEach(geo);
          };
          (j.features || [j]).forEach(x => geo(x.geometry || x));
          if (!lines.length) return m('找不到線型資料');
          if (!cloud()) {
            R = [];
            lines.forEach(addRoad);
            fit();
            return m(`已載入 ${lines.length} 條道路（離線模式，僅此頁面暫存）`);
          }
          const old = await fbGetDocs(fbCollection(W.db, 'mapRoads'));
          for (const d of old.docs) await fbDeleteDoc(d.ref);
          let buf = [], len = 0, k = 0;
          const flush = async () => {
            if (buf.length) {
              await fbSetDoc(fbDoc(W.db, 'mapRoads', 'r' + String(k++).padStart(4, '0')), { s: JSON.stringify(buf) });
              buf = [];
              len = 0;
            }
          };
          for (const l of lines) {
            const z = l.length * 9;
            if (len + z > 300000) await flush();
            buf.push(l);
            len += z;
          }
          await flush();
          m(`已匯入 ${lines.length} 條道路，分 ${k} 份儲存`);
        } catch (e) {
          m('匯入失敗：' + (e.message || e.code));
        }
      }

      // 地圖繪製與觸控/滑鼠互動（含節點拖曳微調與即時經緯度提示）
      const X = lng => (lng - V.x) * K * V.z + cw / 2;
      const Y = lat => (V.y - lat) * V.z + ch / 2;
      const LLp = (px, py) => [V.y - (py - ch / 2) / V.z, V.x + (px - cw / 2) / (K * V.z)];

      function fit() {
        fitted = true;
        let b = [121.0, 121.5, 24.7, 25.15];
        if (R.length) {
          b = [1e9, -1e9, 1e9, -1e9];
          R.forEach(r => {
            b[0] = Math.min(b[0], r.b[0]);
            b[1] = Math.max(b[1], r.b[1]);
            b[2] = Math.min(b[2], r.b[2]);
            b[3] = Math.max(b[3], r.b[3]);
          });
        }
        V.x = (b[0] + b[1]) / 2;
        V.y = (b[2] + b[3]) / 2;
        if (cw) V.z = Math.min(cw / ((b[1] - b[0]) * K), ch / (b[3] - b[2])) * 0.9;
        dirty = 1;
      }

      function resize() {
        if (!cv || !wrap || wrap.classList.contains('hidden')) return;
        const r = devicePixelRatio || 1, w = wrap.clientWidth, h = wrap.clientHeight;
        if (!w || !h) return;
        const first = !cw;
        cw = w;
        ch = h;
        cv.width = w * r;
        cv.height = h * r;
        cx.setTransform(r, 0, 0, r, 0, 0);
        if (first && fitted) fit();
        dirty = 1;
      }

      function shp(x, y, s, sh) {
        cx.beginPath();
        if (sh === 'square') cx.rect(x - s, y - s, 2 * s, 2 * s);
        else if (sh === 'diamond') {
          cx.moveTo(x, y - s * 1.3);
          cx.lineTo(x + s * 1.3, y);
          cx.lineTo(x, y + s * 1.3);
          cx.lineTo(x - s * 1.3, y);
          cx.closePath();
        } else if (sh === 'triangle') {
          cx.moveTo(x, y - s * 1.3);
          cx.lineTo(x + s * 1.2, y + s);
          cx.lineTo(x - s * 1.2, y + s);
          cx.closePath();
        } else {
          cx.arc(x, y, s, 0, 7);
        }
      }

      function draw() {
        dirty = 0;
        if (!cw) return;
        cx.fillStyle = '#eef2f7';
        cx.fillRect(0, 0, cw, ch);

        const step = V.z > 20000 ? 0.01 : V.z > 4000 ? 0.05 : 0.1;
        const [la0, lo0] = LLp(0, ch), [la1, lo1] = LLp(cw, 0);
        cx.strokeStyle = '#dde4ee';
        cx.lineWidth = 1;
        cx.fillStyle = '#94a3b8';
        cx.font = '11px sans-serif';
        for (let l = Math.ceil(lo0 / step) * step; l < lo1; l += step) {
          const x = Math.round(X(l)) + 0.5;
          cx.beginPath(); cx.moveTo(x, 0); cx.lineTo(x, ch); cx.stroke();
          cx.fillText(l.toFixed(2) + '°E', x + 2, ch - 4);
        }
        for (let l = Math.ceil(la0 / step) * step; l < la1; l += step) {
          const y = Math.round(Y(l)) + 0.5;
          cx.beginPath(); cx.moveTo(0, y); cx.lineTo(cw, y); cx.stroke();
          cx.fillText(l.toFixed(2) + '°N', 2, y - 2);
        }

        const sk = Math.max(1, Math.floor(1.2 / (V.z * 1e-4)));
        cx.strokeStyle = '#8793a6';
        cx.lineWidth = Math.min(3, Math.max(0.6, Math.log10(Math.max(V.z, 1000) / 1000) * 0.9));
        cx.lineJoin = 'round';
        cx.beginPath();
        for (const r of R) {
          if (r.b[1] < lo0 || r.b[0] > lo1 || r.b[3] < la0 || r.b[2] > la1) continue;
          const p = r.p, n = p.length;
          cx.moveTo(X(p[0]), Y(p[1]));
          for (let i = 2; i < n - 2; i += 2 * sk) cx.lineTo(X(p[i]), Y(p[i + 1]));
          cx.lineTo(X(p[n - 2]), Y(p[n - 1]));
        }
        cx.stroke();

        const vis = getVisibleFeatures();
        for (const f of vis) {
          if (drawCtx && drawCtx.featId && drawCtx.featId === f.id) continue; // 正在編輯中的案件以編輯預覽樣式繪製
          const s = style(f.item), g = G(f), tp = featType(f);
          if (!g.length) continue;
          const sl = sel && sel.id === f.id, z = +s.size || 6;
          if (tp === 'line' && g.length >= 2) {
            cx.beginPath();
            g.forEach((p, i) => (i ? cx.lineTo(X(p[1]), Y(p[0])) : cx.moveTo(X(p[1]), Y(p[0]))));
            cx.lineCap = 'round';
            if (sl) { cx.strokeStyle = '#fff'; cx.lineWidth = z + 5; cx.setLineDash([]); cx.stroke(); }
            cx.strokeStyle = s.color;
            cx.lineWidth = z;
            cx.setLineDash(s.dash ? [z * 2, z * 1.5] : []);
            cx.stroke();
            cx.setLineDash([]);
            if (sl) {
              g.forEach(p => {
                cx.beginPath();
                cx.arc(X(p[1]), Y(p[0]), 4.5, 0, 7);
                cx.fillStyle = '#fff';
                cx.fill();
                cx.strokeStyle = s.color;
                cx.lineWidth = 2;
                cx.stroke();
              });
            }
          } else {
            const px = X(g[0][1]), py = Y(g[0][0]);
            shp(px, py, z + (sl ? 3 : 0), s.shape);
            cx.fillStyle = s.color;
            cx.fill();
            cx.strokeStyle = '#fff';
            cx.lineWidth = sl ? 3 : 1.5;
            cx.stroke();
            if (tp === 'line') {
              cx.beginPath();
              cx.arc(px, py, z + 5, 0, 7);
              cx.strokeStyle = s.color;
              cx.lineWidth = 1.5;
              cx.setLineDash([3, 3]);
              cx.stroke();
              cx.setLineDash([]);
            }
          }
        }

        // 正在點選/繪製中的即時預覽（含可拖曳節點標記）
        if (drawCtx && pts.length) {
          const s = style(drawCtx.itemId);
          const z = +s.size || 5;
          if (drawCtx.geomType === 'line' && pts.length >= 2) {
            cx.beginPath();
            pts.forEach((p, i) => (i ? cx.lineTo(X(p[1]), Y(p[0])) : cx.moveTo(X(p[1]), Y(p[0]))));
            cx.strokeStyle = '#fff';
            cx.lineWidth = z + 4;
            cx.lineCap = 'round';
            cx.stroke();
            cx.strokeStyle = s.color;
            cx.lineWidth = z;
            cx.setLineDash([7, 4]);
            cx.stroke();
            cx.setLineDash([]);
          }
          pts.forEach((p, idx) => {
            const px = X(p[1]), py = Y(p[0]);
            cx.beginPath();
            cx.arc(px, py, drawCtx.geomType === 'point' ? Math.max(7, z + 2) : 6, 0, 7);
            cx.fillStyle = drawCtx.geomType === 'point' ? s.color : '#fff';
            cx.fill();
            cx.strokeStyle = drawCtx.geomType === 'point' ? '#fff' : '#e11d48';
            cx.lineWidth = 2.5;
            cx.stroke();
            if (drawCtx.geomType === 'line') {
              cx.fillStyle = '#0f172a';
              cx.font = 'bold 10px sans-serif';
              cx.fillText(String(idx + 1), px + 8, py - 6);
            }
          });
        }

        if (!R.length) {
          cx.fillStyle = 'rgba(100,116,139,0.75)';
          cx.font = '12px sans-serif';
          cx.textAlign = 'center';
          cx.fillText('尚未匯入道路 GIS 底圖（仍可直接點選/繪製座標；底圖可至「匯入／匯出 → 道路 GIS」載入）', cw / 2, ch - 18);
          cx.textAlign = 'left';
        }
      }

      function loop() {
        if (dirty) draw();
        requestAnimationFrame(loop);
      }

      function zoomAt(px, py, f) {
        const [la, lo] = LLp(px, py);
        V.z = Math.min(4e6, Math.max(300, V.z * f));
        V.x = lo - (px - cw / 2) / (K * V.z);
        V.y = la + (py - ch / 2) / V.z;
        dirty = 1;
      }

      function segD(px, py, ax, ay, bx, by) {
        const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
        const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
        return Math.hypot(px - ax - t * dx, py - ay - t * dy);
      }

      function hit(px, py) {
        let best = null, bd = 15;
        for (const f of getVisibleFeatures()) {
          const tp = featType(f), g = G(f);
          let d = 1e9;
          if (tp === 'line' && g.length >= 2) {
            for (let i = 0; i < g.length - 1; i++) d = Math.min(d, segD(px, py, X(g[i][1]), Y(g[i][0]), X(g[i + 1][1]), Y(g[i + 1][0])));
          } else if (g[0]) {
            d = Math.hypot(px - X(g[0][1]), py - Y(g[0][0]));
          }
          if (d < bd) { bd = d; best = f; }
        }
        return best;
      }

      function hitDrawVertex(px, py) {
        if (!drawCtx || !pts.length) return -1;
        for (let i = 0; i < pts.length; i++) {
          if (Math.hypot(px - X(pts[i][1]), py - Y(pts[i][0])) <= 12) return i;
        }
        return -1;
      }

      function mclick(px, py) {
        const ll = LLp(px, py);
        if (drawCtx && canEdit()) {
          if (drawCtx.geomType === 'line') {
            pts.push(ll);
          } else {
            pts = [ll];
          }
          renderBar();
          dirty = 1;
          return;
        }
        sel = hit(px, py);
        showInfo();
        dirty = 1;
      }

      function bindPointer() {
        const ptr = new Map();
        let mv = 0, pd = 0, dragVtx = -1;
        const dd = () => { const a = [...ptr.values()]; return Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]); };
        const rc = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
        cv.addEventListener('pointerdown', e => {
          cv.setPointerCapture(e.pointerId);
          const p = rc(e);
          ptr.set(e.pointerId, p);
          mv = 0;
          dragVtx = ptr.size === 1 ? hitDrawVertex(p[0], p[1]) : -1;
          if (ptr.size === 2) pd = dd();
        });
        cv.addEventListener('pointermove', e => {
          const n = rc(e);
          hoverLL = LLp(n[0], n[1]);
          const coordEl = $('em-coord');
          if (coordEl) coordEl.textContent = `座標：${hoverLL[0].toFixed(5)}, ${hoverLL[1].toFixed(5)}`;

          if (!ptr.has(e.pointerId)) return;
          const o = ptr.get(e.pointerId);
          ptr.set(e.pointerId, n);
          if (dragVtx >= 0 && ptr.size === 1) {
            pts[dragVtx] = LLp(n[0], n[1]);
            mv = 99;
            dirty = 1;
            return;
          }
          if (ptr.size === 2) {
            const d = dd(), a = [...ptr.values()];
            zoomAt((a[0][0] + a[1][0]) / 2, (a[0][1] + a[1][1]) / 2, d / pd);
            pd = d;
            mv = 99;
          } else {
            const dx = n[0] - o[0], dy = n[1] - o[1];
            mv += Math.abs(dx) + Math.abs(dy);
            V.x -= dx / (K * V.z);
            V.y += dy / V.z;
            dirty = 1;
          }
        });
        cv.addEventListener('pointerup', e => {
          const was = ptr.size, p = rc(e);
          ptr.delete(e.pointerId);
          const wasVtx = dragVtx >= 0;
          dragVtx = -1;
          if (was === 1 && !wasVtx && mv < 6) mclick(p[0], p[1]);
        });
        cv.addEventListener('pointercancel', e => { ptr.delete(e.pointerId); dragVtx = -1; });
        cv.addEventListener('wheel', e => {
          e.preventDefault();
          const p = rc(e);
          zoomAt(p[0], p[1], e.deltaY < 0 ? 1.25 : 0.8);
        }, { passive: false });
      }

      // 供外部（數量統計卡片與考評明細視窗）呼叫的整合介面
      W.evalMap = {
        ensureInit: init,
        getFeatureForWo,
        getStyle: style,
        getEffectiveType: featType,
        openWoMapEditor,
        startWoMapPick,
        focusWoOnMap,
        focusCategoryOnMap,
        openStyleEditor: styleDlg,
        onDashboardRendered: () => {
          decorate();
          if (inited) {
            renderBar();
            renderLayers();
            dirty = 1;
          }
        }
      };

      // 啟動初始化
      build();
    })();
};
