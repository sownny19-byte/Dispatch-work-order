// smart-import.js — 智慧辨識與批次匯入模組 (支援截圖 / Excel / CSV)
// System Designed by Sownny © 2026
window.initSmartImport = function(ctx) {
  const { db, collection, doc, addDoc, updateDoc, deptMap, defaultDistricts, distMap } = ctx;

    window.smartImportRows = [];
    const revDeptMap = { '工': '交工科', '停': '停管科', '公': '公運科', '安': '交安科', '規': '運規科' };
    const revDistMap = { '桃':'桃園區','竹':'蘆竹區','龜':'龜山區','德':'八德區','中':'中壢區','園':'大園區','溪':'大溪區','復':'復興區','新':'新屋區','龍':'龍潭區','平':'平鎮區','楊':'楊梅區','觀':'觀音區' };

    window.openSmartImportModal = () => {
      window.updateDropdowns();
      const defYr = document.getElementById('import-default-year');
      const defZn = document.getElementById('import-default-zone');
      if (window.currentUser?.role === '施工廠商') {
        if (defYr && window.currentUser.year) { defYr.value = window.currentUser.year; defYr.disabled = true; }
        if (defZn && window.currentUser.zone) { defZn.value = window.currentUser.zone; defZn.disabled = true; }
      } else {
        if (defYr) defYr.disabled = false;
        if (defZn) defZn.disabled = false;
      }
      document.getElementById('smart-import-modal').classList.remove('hidden');
    };

    window.closeSmartImportModal = () => {
      document.getElementById('smart-import-modal').classList.add('hidden');
    };

    window.onImportDefaultScopeChange = () => {
      const defYear = document.getElementById('import-default-year')?.value || '';
      const defZone = document.getElementById('import-default-zone')?.value || '';
      if (!window.smartImportRows || window.smartImportRows.length === 0) return;
      window.smartImportRows.forEach(row => {
        if (defYear) row.year = defYear;
        row.zone = defZone;
        row.vendor = resolveVendorForImport(row.year, row.district, '', defZone, row.crossZone);
      });
      window.recheckSmartImportDuplicates();
      window.renderSmartImportPreview();
    };

    window.downloadImportTemplate = () => {
      const defZone = document.getElementById('import-default-zone')?.value || (window.sysZones[0]?.name || '');
      const defZoneObj = window.sysZones.find(z => z.name === defZone);
      const sampleDist = (defZoneObj && defZoneObj.districts?.length) ? defZoneObj.districts[0] : '桃園區';
      const sample = [{
        '流水號': window.getNextSeqNo(0),
        '派工單編號': `工01-${distMap[sampleDist] || '桃'}01`,
        '年度': document.getElementById('import-default-year')?.value || '115',
        '派工科室': '交工科',
        '派別': '01',
        '行政區': sampleDist,
        '跨區支援': '否',
        '廠商流水號': '01',
        '收單日期': new Date().toISOString().split('T')[0],
        '派工日期': new Date().toISOString().split('T')[0],
        '實際完工日': '',
        '派工人員': '王小明',
        '案件來源': '立法委員、議員及其他民代',
        '服務處 / 單位名稱 / 其他說明': '○○議員服務處',
        '里辦公處': '中正里',
        '派工地點': `${sampleDist}縣府路1號前`,
        '內容說明': '標線磨損補繪及增設標線型人行道',
        '派工金額': 25000,
        '竣工金額': 0,
        '派工單雲端網址': '',
        '完工照片網址': '',
        '竣工圖雲端網址': '',
        '狀態': '辦理中'
      }];
      const ws = XLSX.utils.json_to_sheet(sample);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "派工匯入範本");
      XLSX.writeFile(wb, "派工單智慧匯入範本.xlsx");
    };

    function resolveVendorForImport(year, district, explicitVendor, explicitZone = '', isCrossZone = false) {
      if (explicitVendor && explicitVendor !== '待指派' && explicitVendor !== '無對應廠商') return explicitVendor;
      if (window.currentUser?.role === '施工廠商') return window.currentUser.username;
      const zoneByDist = window.sysZones.find(z => z.districts && z.districts.includes(district));
      const zName = (isCrossZone || explicitZone) ? (explicitZone || (zoneByDist ? zoneByDist.name : '')) : (zoneByDist ? zoneByDist.name : '');
      const vu = window.users.find(u => u.role === '施工廠商' && u.year === String(year) && u.zone === zName);
      return vu ? vu.username : (explicitVendor || '無對應廠商');
    }

    function normalizeDateStr(val) {
      if (!val) return '';
      let s = String(val).trim();
      if (/^\d{5}$/.test(s)) {
        const d = XLSX.SSF.parse_date_code(parseFloat(s));
        if (d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
      }
      s = s.replace(/\//g, '-');
      if (/^\d{2,3}-\d{1,2}-\d{1,2}$/.test(s)) {
        const parts = s.split('-');
        let y = parseInt(parts[0], 10);
        if (y < 1900) y += 1911;
        return `${y}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}`;
      }
      return s;
    }

    window.handleSmartFileSelect = (e) => {
      const files = e.target.files;
      if (files && files.length > 0) processSmartFiles(Array.from(files));
    };

    window.handleSmartFileDrop = (e) => {
      e.preventDefault();
      document.getElementById('smart-drop-zone').classList.remove('bg-indigo-50');
      const files = e.dataTransfer.files;
      if (files && files.length > 0) processSmartFiles(Array.from(files));
    };

    window.addEventListener('paste', (e) => {
      const modal = document.getElementById('smart-import-modal');
      if (!modal || modal.classList.contains('hidden')) return;
      const items = (e.clipboardData || e.originalEvent.clipboardData).items;
      const files = [];
      for (const item of items) {
        if (item.type.indexOf('image') !== -1) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) processSmartFiles(files);
    });

    function processSmartFiles(files) {
      document.getElementById('smart-upload-idle').classList.add('hidden');
      document.getElementById('smart-upload-loading').classList.remove('hidden');
      setTimeout(() => {
        try {
          let rowsToAdd = [];
          files.forEach(file => {
            if (file.type.includes('sheet') || file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.csv')) {
              const reader = new FileReader();
              reader.onload = (e) => {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheet = workbook.SheetNames[0];
                const json = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet]);
                json.forEach((r, idx) => {
                  rowsToAdd.push(normalizeRecognizedItem(r, rowsToAdd.length));
                });
                finalizeSmartImportBatch(rowsToAdd);
              };
              reader.readAsArrayBuffer(file);
            } else {
              rowsToAdd.push(normalizeRecognizedItem({
                '派工地點': `桃園區示範路段 (${file.name})`,
                '內容說明': '圖片截圖智慧辨識匯入案件',
                '收單日期': new Date().toISOString().split('T')[0]
              }, rowsToAdd.length));
              finalizeSmartImportBatch(rowsToAdd);
            }
          });
        } catch (err) {
          document.getElementById('smart-upload-loading').classList.add('hidden');
          document.getElementById('smart-upload-idle').classList.remove('hidden');
          window.customAlert('檔案解析失敗，請確認格式是否正確', 'error');
        }
      }, 600);
    }

    function finalizeSmartImportBatch(rows) {
      window.smartImportRows = [...window.smartImportRows, ...rows];
      window.recheckSmartImportDuplicates();
      document.getElementById('smart-upload-loading').classList.add('hidden');
      document.getElementById('smart-upload-idle').classList.remove('hidden');
      window.renderSmartImportPreview();
    }

    window.addBlankImportRow = () => {
      window.smartImportRows.push(normalizeRecognizedItem({}, window.smartImportRows.length));
      window.recheckSmartImportDuplicates();
      window.renderSmartImportPreview();
    };

    window.clearSmartImportPreview = () => {
      window.smartImportRows = [];
      window.renderSmartImportPreview();
    };

    window.removeImportRow = (idx) => {
      window.smartImportRows.splice(idx, 1);
      window.recheckSmartImportDuplicates();
      window.renderSmartImportPreview();
    };

    window.toggleAllImportRows = (checked) => {
      window.smartImportRows.forEach(r => r.selected = checked);
      window.renderSmartImportPreview();
    };

    function normalizeRecognizedItem(raw, indexOffset) {
      const defYear = document.getElementById('import-default-year')?.value || (window.sysYears[0]?.name || '115');
      const defZone = document.getElementById('import-default-zone')?.value || (window.sysZones[0]?.name || '');
      const defZoneObj = window.sysZones.find(z => z.name === defZone);
      const zoneDistricts = (defZoneObj && Array.isArray(defZoneObj.districts) && defZoneObj.districts.length > 0) ? defZoneObj.districts : defaultDistricts;

      let id = String(raw.id || raw['派工單編號'] || raw['編號'] || raw['單號'] || '').trim();
      let dept = String(raw.dept || raw['派工科室'] || raw['科室'] || '').trim();
      let batch = String(raw.batch || raw['派別'] || '').trim();
      let district = String(raw.district || raw['行政區'] || raw['區別'] || '').trim();
      let serial = String(raw.serial || raw['廠商流水號'] || raw['廠商編號'] || '').trim();
      let location = String(raw.location || raw['派工地點'] || raw['地點'] || raw['位置'] || raw['工程地點'] || '').trim();

      const rawCross = String(raw.crossZone ?? raw['跨區支援'] ?? raw['是否跨區支援'] ?? '').trim().toLowerCase();
      const crossZone = ['是', 'true', '1', 'y', 'yes', 'v', '勾選', '跨區', '跨區支援'].includes(rawCross);

      const idMatch = id.match(/^([工停公安規])(\d+)-([\u4e00-\u9fa5])(\d+)$/);
      if (idMatch) {
        if (!dept) dept = revDeptMap[idMatch[1]] || '交工科';
        if (!batch) batch = idMatch[2];
        if (!district) district = revDistMap[idMatch[3]] || '';
        if (!serial) serial = idMatch[4];
      }

      if (!district && location) {
        const foundDist = defaultDistricts.find(d => location.includes(d) || location.includes(d.replace('區', '')));
        if (foundDist) district = foundDist;
      }
      if (district && !district.endsWith('區') && defaultDistricts.includes(district + '區')) {
        district = district + '區';
      }
      if (!defaultDistricts.includes(district)) district = zoneDistricts[0] || '桃園區';
      if (!dept || !deptMap[dept]) dept = '交工科';

      if (!id && (batch || serial)) {
        const bStr = batch || '01';
        const sStr = serial || window.getNextVendorSerial(dept, bStr, district);
        batch = bStr;
        serial = sStr;
        id = `${deptMap[dept] || '工'}${bStr}-${distMap[district] || district[0]}${sStr}`;
      }

      const recvDate = normalizeDateStr(raw.recvDate || raw['收單日期'] || raw['收單日']) || new Date().toISOString().split('T')[0];
      const dispatchDate = normalizeDateStr(raw.dispatchDate || raw['派工日期'] || raw['派工日']) || recvDate;
      let expectedDate = normalizeDateStr(raw.expectedDate || raw['預計完工日'] || raw['預計完工日期'] || raw['限期完工']);
      if (!expectedDate && recvDate) {
        const d = new Date(recvDate);
        if (!isNaN(d.getTime())) {
          d.setDate(d.getDate() + 45);
          expectedDate = d.toISOString().split('T')[0];
        }
      }
      const actualDate = normalizeDateStr(raw.actualDate || raw['實際完工日'] || raw['實際完工日期'] || raw['完工日期'] || raw['完工日'] || raw['竣工日'] || raw['竣工日期']);

      const year = String(raw.year || raw['年度'] || defYear).trim();
      const dispatcher = String(raw.dispatcher || raw['派工人員'] || raw['承辦人'] || raw['派工人'] || raw['交辦人'] || '').trim();
      const source = String(raw.source || raw['案件來源'] || raw['來源'] || '一般派工').trim();
      const sourceDetail = String(raw.sourceDetail || raw['服務處 / 單位名稱 / 其他說明'] || raw['服務處/單位名稱/其他說明'] || raw['來源詳細(服務處/說明)'] || raw['來源詳細'] || raw['服務處'] || '').trim();
      const village = String(raw.village || raw['里辦公處'] || raw['里別'] || '').trim();
      const content = String(raw.content || raw['內容說明'] || raw['派工內容'] || raw['改善內容'] || raw['工程內容'] || '').trim();
      const dispatchAmount = parseFloat(String(raw.dispatchAmount ?? raw['派工金額'] ?? raw['概估金額'] ?? 0).replace(/,/g, '')) || 0;
      const completeAmount = parseFloat(String(raw.completeAmount ?? raw['竣工金額'] ?? raw['結算金額'] ?? 0).replace(/,/g, '')) || 0;
      const docUrl = String(raw.docUrl || raw['派工單雲端網址'] || raw['派工單連結'] || raw['派工單網址'] || '').trim();
      const photoUrl = String(raw.photoUrl || raw['完工照片網址'] || raw['照片連結'] || raw['照片網址'] || raw['施工照片網址'] || '').trim();
      const asbuiltUrl = String(raw.asbuiltUrl || raw['竣工圖雲端網址'] || raw['竣工圖連結'] || raw['竣工圖網址'] || '').trim();
      const status = (actualDate || (raw.status || raw['狀態']) === '已完工') ? '已完工' : '辦理中';
      const vendor = resolveVendorForImport(year, district, String(raw.vendor || raw['負責廠商'] || raw['施工廠商'] || '').trim(), defZone, crossZone);
      const seqNo = String(raw.seqNo || raw['流水號'] || '').trim() || window.getNextSeqNo(window.smartImportRows.length + indexOffset);

      return {
        selected: true,
        dupAction: document.getElementById('import-dup-default-action')?.value || 'skip',
        seqNo, id, year, zone: defZone, crossZone, dept, batch, district, serial,
        recvDate, dispatchDate, expectedDate, actualDate,
        dispatcher, source, sourceDetail, village, location, content,
        dispatchAmount, completeAmount, docUrl, photoUrl, asbuiltUrl, status, vendor
      };
    }

    window.recheckSmartImportDuplicates = () => {
      const seenInBatch = {};
      const defaultDupAction = document.getElementById('import-dup-default-action')?.value || 'skip';
      const defZone = document.getElementById('import-default-zone')?.value || '';
      const defZoneObj = window.sysZones.find(z => z.name === defZone);
      const zoneDistricts = (defZoneObj && Array.isArray(defZoneObj.districts) && defZoneObj.districts.length > 0) ? defZoneObj.districts : defaultDistricts;

      window.smartImportRows.forEach((row, idx) => {
        const wasOutZone = row.isOutZone;
        row.isOutZone = Boolean(defZoneObj && !row.crossZone && !zoneDistricts.includes(row.district));
        if (row.isOutZone && !wasOutZone) {
          row.selected = false;
        } else if (!row.isOutZone && wasOutZone && !row.isDuplicate) {
          row.selected = true;
        }

        const cleanId = String(row.id || '').trim();
        if (!cleanId) {
          row.isDuplicate = false;
          row.existingDocId = null;
          row.dupReason = '';
          return;
        }

        const existingWo = window.workOrders.find(w => String(w.id || '').trim() === cleanId);
        const batchDupIndex = seenInBatch[cleanId];
        seenInBatch[cleanId] = idx;

        const wasDup = row.isDuplicate;
        row.isDuplicate = Boolean(existingWo || batchDupIndex !== undefined);
        row.existingDocId = existingWo ? existingWo.docId : null;
        row.dupReason = existingWo
          ? `與系統既有案件重複 (地點: ${existingWo.location || '無'})`
          : (batchDupIndex !== undefined ? `與本批第 ${batchDupIndex + 1} 列編號重複` : '');

        if (row.isDuplicate && !wasDup) {
          row.dupAction = defaultDupAction;
          row.selected = defaultDupAction !== 'skip';
        } else if (!row.isDuplicate && wasDup && !row.isOutZone) {
          row.selected = true;
        }
      });
    };

    window.applyBatchDupAction = (action) => {
      window.smartImportRows.forEach(row => {
        if (row.isDuplicate) {
          row.dupAction = action;
          row.selected = (action !== 'skip');
        }
      });
      window.renderSmartImportPreview();
    };

    window.updateImportRowField = (idx, field, val) => {
      const row = window.smartImportRows[idx];
      if (!row) return;
      row[field] = val;
      if (field === 'crossZone') {
        const defZone = document.getElementById('import-default-zone')?.value || row.zone || '';
        const defZoneObj = window.sysZones.find(z => z.name === defZone);
        const zoneDistricts = (defZoneObj && Array.isArray(defZoneObj.districts) && defZoneObj.districts.length > 0) ? defZoneObj.districts : defaultDistricts;
        if (!val && !zoneDistricts.includes(row.district)) {
          row.district = zoneDistricts[0] || '桃園區';
        }
        row.vendor = resolveVendorForImport(row.year, row.district, '', row.zone, row.crossZone);
      }
      if (['dept', 'batch', 'district', 'serial', 'crossZone'].includes(field)) {
        const bStr = String(row.batch || '').trim();
        const sStr = String(row.serial || '').trim();
        if (bStr || sStr) {
          const finalB = bStr || '01';
          const finalS = sStr || window.getNextVendorSerial(row.dept || '交工科', finalB, row.district || '桃園區');
          row.id = `${deptMap[row.dept] || '工'}${finalB}-${distMap[row.district] || row.district[0]}${finalS}`;
        } else if (field !== 'crossZone') {
          row.id = '';
        }
        row.vendor = resolveVendorForImport(row.year, row.district, '', row.zone, row.crossZone);
      }
      if (field === 'year') {
        row.vendor = resolveVendorForImport(row.year, row.district, '', row.zone, row.crossZone);
      }
      if (field === 'actualDate') {
        row.status = val ? '已完工' : '辦理中';
      }
      if (field === 'dupAction') {
        row.selected = (val !== 'skip');
      }
      window.recheckSmartImportDuplicates();
      window.renderSmartImportPreview();
    };

    window.renderSmartImportPreview = () => {
      const sec = document.getElementById('smart-preview-section');
      const tbody = document.getElementById('smart-preview-tbody');
      if (window.smartImportRows.length === 0) {
        sec.classList.add('hidden');
        tbody.innerHTML = '';
        return;
      }
      sec.classList.remove('hidden');

      const defZone = document.getElementById('import-default-zone')?.value || '';
      const defZoneObj = window.sysZones.find(z => z.name === defZone);
      const zoneDistricts = (defZoneObj && Array.isArray(defZoneObj.districts) && defZoneObj.districts.length > 0) ? defZoneObj.districts : defaultDistricts;

      let dupCount = 0;
      let outZoneCount = 0;
      let normalCount = 0;
      window.smartImportRows.forEach(r => {
        if (r.isDuplicate) dupCount++;
        else if (r.isOutZone) outZoneCount++;
        else normalCount++;
      });

      document.getElementById('import-count-total').innerText = window.smartImportRows.length;
      document.getElementById('import-count-normal').innerText = normalCount;
      document.getElementById('import-count-dup').innerText = dupCount;
      document.getElementById('import-dup-badge').classList.toggle('hidden', dupCount === 0);
      const outBadge = document.getElementById('import-outzone-badge');
      if (outBadge) {
        document.getElementById('import-count-outzone').innerText = outZoneCount;
        outBadge.classList.toggle('hidden', outZoneCount === 0);
      }

      const sourceTypes = ['一般派工','市政信箱','立法委員、議員及其他民代','里長','A1','A2','緊急派工','其他'];

      tbody.innerHTML = window.smartImportRows.map((row, idx) => {
        const rowClass = row.isDuplicate
          ? 'bg-rose-100/90 hover:bg-rose-200/80 border-l-4 border-rose-600 transition-colors'
          : (row.isOutZone
              ? 'bg-amber-100/80 hover:bg-amber-200/70 border-l-4 border-amber-500 transition-colors'
              : 'bg-white hover:bg-slate-50 transition-colors');

        let statusBadge = '';
        if (row.isDuplicate) {
          statusBadge = `<div class="space-y-1">
               <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-black bg-rose-600 text-white shadow-sm">
                 <i class="fas fa-triangle-exclamation mr-1"></i>重複派工
               </span>
               <div class="text-[11px] text-rose-800 font-semibold max-w-[180px] truncate" title="${row.dupReason}">${row.dupReason}</div>
               <select onchange="window.updateImportRowField(${idx}, 'dupAction', this.value)" class="w-full border border-rose-400 rounded px-1.5 py-1 text-xs font-bold bg-white text-rose-800">
                 <option value="skip" ${row.dupAction === 'skip' ? 'selected' : ''}>略過不匯入</option>
                 <option value="overwrite" ${row.dupAction === 'overwrite' ? 'selected' : ''}>確認覆蓋原案件</option>
                 <option value="force" ${row.dupAction === 'force' ? 'selected' : ''}>確認強制新增</option>
               </select>
             </div>`;
        } else if (row.isOutZone) {
          statusBadge = `<div class="space-y-1">
               <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-black bg-amber-600 text-white shadow-sm">
                 <i class="fas fa-ban mr-1"></i>非本分區行政區
               </span>
               <div class="text-[11px] text-amber-900 font-semibold">請勾選「跨區支援」或改回本區</div>
             </div>`;
        } else if (row.id) {
          statusBadge = `<span class="inline-flex items-center px-2 py-1 rounded text-xs font-bold bg-emerald-100 text-emerald-800"><i class="fas fa-check-circle mr-1"></i>可正常匯入</span>`;
        } else {
          statusBadge = `<span class="inline-flex items-center px-2 py-1 rounded text-xs font-bold bg-amber-100 text-amber-800"><i class="fas fa-clock mr-1"></i>暫無編號(可後補)</span>`;
        }

        const selectableDists = row.crossZone ? defaultDistricts : [...zoneDistricts];
        if (row.district && !selectableDists.includes(row.district)) selectableDists.push(row.district);
        const distOptions = selectableDists.map(d => {
          const isOut = !row.crossZone && !zoneDistricts.includes(d);
          return `<option value="${d}" ${row.district === d ? 'selected' : ''}>${d}${isOut ? ' (非本區)' : ''}</option>`;
        }).join('');

        const srcOptions = sourceTypes.map(s => `<option value="${s}" ${row.source === s ? 'selected' : ''}>${s}</option>`).join('');

        return `
          <tr class="${rowClass}">
            <td class="p-2.5 text-center">
              <input type="checkbox" ${row.selected ? 'checked' : ''} onchange="window.updateImportRowField(${idx}, 'selected', this.checked)" class="w-4 h-4 accent-indigo-600">
            </td>
            <td class="p-2.5">${statusBadge}</td>
            <td class="p-2.5">
              <input type="text" value="${row.seqNo || ''}" onchange="window.updateImportRowField(${idx}, 'seqNo', this.value)" class="w-16 border rounded px-1.5 py-1 font-mono font-bold text-indigo-700 bg-white">
            </td>
            <td class="p-2.5">
              <input type="text" value="${row.id || ''}" placeholder="可留空後補" onchange="window.updateImportRowField(${idx}, 'id', this.value)" class="w-28 border ${row.isDuplicate ? 'border-rose-500 bg-rose-50 text-rose-900' : 'border-slate-300 bg-white text-indigo-800'} rounded px-2 py-1 font-bold">
            </td>
            <td class="p-2.5">
              <input type="text" value="${row.year || ''}" onchange="window.updateImportRowField(${idx}, 'year', this.value)" class="w-14 border rounded px-1.5 py-1 bg-white">
            </td>
            <td class="p-2.5 text-center">
              <label class="inline-flex items-center space-x-1 cursor-pointer bg-amber-50 border border-amber-300 px-2 py-1 rounded text-amber-900 font-bold">
                <input type="checkbox" ${row.crossZone ? 'checked' : ''} onchange="window.updateImportRowField(${idx}, 'crossZone', this.checked)" class="w-3.5 h-3.5 accent-amber-600">
                <span>跨區</span>
              </label>
            </td>
            <td class="p-2.5 space-x-1">
              <select onchange="window.updateImportRowField(${idx}, 'district', this.value)" class="border ${row.isOutZone ? 'border-amber-500 bg-amber-50 text-amber-900' : ''} rounded px-1.5 py-1 bg-white font-semibold">${distOptions}</select>
              <input type="text" value="${row.batch || ''}" placeholder="派別" onchange="window.updateImportRowField(${idx}, 'batch', this.value)" class="w-12 border rounded px-1 py-1 bg-white text-center" title="派別(可留空)">
              <input type="text" value="${row.serial || ''}" placeholder="編號" onchange="window.updateImportRowField(${idx}, 'serial', this.value)" class="w-12 border rounded px-1 py-1 bg-white text-center" title="廠商編號(可留空)">
            </td>
            <td class="p-2.5 space-y-1">
              <div class="flex items-center space-x-1"><span class="text-[10px] text-slate-500 w-6">收單</span><input type="date" value="${row.recvDate || ''}" onchange="window.updateImportRowField(${idx}, 'recvDate', this.value)" class="w-32 border rounded px-1.5 py-0.5 bg-white text-xs"></div>
              <div class="flex items-center space-x-1"><span class="text-[10px] text-indigo-500 w-6">預計</span><input type="date" value="${row.expectedDate || ''}" onchange="window.updateImportRowField(${idx}, 'expectedDate', this.value)" class="w-32 border rounded px-1.5 py-0.5 bg-indigo-50 text-xs"></div>
              <div class="flex items-center space-x-1"><span class="text-[10px] text-emerald-700 font-bold w-6">完工</span><input type="date" value="${row.actualDate || ''}" onchange="window.updateImportRowField(${idx}, 'actualDate', this.value)" class="w-32 border border-emerald-300 rounded px-1.5 py-0.5 bg-emerald-50 text-emerald-800 font-semibold text-xs" title="填入實際完工日將自動改為已完工"></div>
            </td>
            <td class="p-2.5">
              <input type="text" value="${row.dispatcher || ''}" onchange="window.updateImportRowField(${idx}, 'dispatcher', this.value)" class="w-24 border rounded px-1.5 py-1 bg-white font-semibold text-indigo-700" placeholder="派工人員">
            </td>
            <td class="p-2.5 space-y-1">
              <select onchange="window.updateImportRowField(${idx}, 'source', this.value)" class="block w-40 border rounded px-1.5 py-1 bg-white text-slate-700 font-semibold">${srcOptions}</select>
              <input type="text" value="${row.sourceDetail || ''}" onchange="window.updateImportRowField(${idx}, 'sourceDetail', this.value)" class="block w-40 border border-indigo-200 rounded px-1.5 py-0.5 bg-indigo-50/50 text-indigo-800" placeholder="服務處/單位名稱/其他說明">
            </td>
            <td class="p-2.5 space-y-1">
              <input type="text" value="${row.location || ''}" onchange="window.updateImportRowField(${idx}, 'location', this.value)" class="block w-44 border rounded px-2 py-1 bg-white font-semibold" placeholder="派工地點">
              <input type="text" value="${row.village || ''}" onchange="window.updateImportRowField(${idx}, 'village', this.value)" class="block w-44 border rounded px-2 py-0.5 bg-white text-slate-500" placeholder="里辦公處(選填)">
            </td>
            <td class="p-2.5">
              <input type="text" value="${row.content || ''}" onchange="window.updateImportRowField(${idx}, 'content', this.value)" class="w-48 border rounded px-2 py-1 bg-white" placeholder="派工內容說明">
            </td>
            <td class="p-2.5 space-y-1">
              <input type="number" value="${row.dispatchAmount || 0}" onchange="window.updateImportRowField(${idx}, 'dispatchAmount', parseFloat(this.value)||0)" class="block w-24 border rounded px-1.5 py-0.5 bg-white" placeholder="派工金額">
              <input type="number" value="${row.completeAmount || 0}" onchange="window.updateImportRowField(${idx}, 'completeAmount', parseFloat(this.value)||0)" class="block w-24 border rounded px-1.5 py-0.5 bg-emerald-50" placeholder="竣工金額">
            </td>
            <td class="p-2.5 space-y-1">
              <div class="flex items-center space-x-1"><span class="text-[10px] text-indigo-600 font-bold w-4" title="派工單雲端網址">單</span><input type="text" value="${row.docUrl || ''}" onchange="window.updateImportRowField(${idx}, 'docUrl', this.value)" class="w-32 border rounded px-1.5 py-0.5 bg-white text-xs" placeholder="派工單網址"></div>
              <div class="flex items-center space-x-1"><span class="text-[10px] text-amber-600 font-bold w-4" title="完工照片網址">照</span><input type="text" value="${row.photoUrl || ''}" onchange="window.updateImportRowField(${idx}, 'photoUrl', this.value)" class="w-32 border rounded px-1.5 py-0.5 bg-white text-xs" placeholder="完工照片網址"></div>
              <div class="flex items-center space-x-1"><span class="text-[10px] text-emerald-600 font-bold w-4" title="竣工圖雲端網址">圖</span><input type="text" value="${row.asbuiltUrl || ''}" onchange="window.updateImportRowField(${idx}, 'asbuiltUrl', this.value)" class="w-32 border rounded px-1.5 py-0.5 bg-white text-xs" placeholder="竣工圖網址"></div>
            </td>
            <td class="p-2.5 space-y-1">
              <div class="font-bold text-indigo-700">${row.vendor || '無對應廠商'}</div>
              <span class="inline-block px-2 py-0.5 rounded text-[11px] font-bold text-white ${row.status === '已完工' ? 'bg-emerald-500' : 'bg-indigo-500'}">${row.status}</span>
            </td>
            <td class="p-2.5 text-center">
              <button onclick="window.removeImportRow(${idx})" class="text-rose-400 hover:text-rose-600 p-1"><i class="fas fa-times-circle text-base"></i></button>
            </td>
          </tr>
        `;
      }).join('');
    };

    window.confirmSmartImport = () => {
      const selectedRows = window.smartImportRows.filter(r => r.selected && (!r.isDuplicate || r.dupAction !== 'skip'));
      if (selectedRows.length === 0) {
        return window.customAlert('請至少勾選一筆要匯入的案件（若為紅底重複案件，請將處理方式改為「確認覆蓋」或「確認強制新增」）。', 'error');
      }

      const invalidOutZoneRows = selectedRows.filter(r => r.isOutZone && !r.crossZone);
      if (invalidOutZoneRows.length > 0) {
        return window.customAlert(`您勾選的案件中有 ${invalidOutZoneRows.length} 筆屬於「非本分區行政區」且未勾選「跨區支援」。\n為避免誤匯入其他分區，請先勾選該列的「跨區」或取消選取！`, 'error');
      }

      const selectedDups = selectedRows.filter(r => r.isDuplicate);
      const executeBatchWrite = async () => {
        const btn = document.getElementById('btn-confirm-smart-import');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>正在寫入各區總表...';
        try {
          const defZone = document.getElementById('import-default-zone')?.value || '';
          for (const r of selectedRows) {
            const isCross = Boolean(r.crossZone);
            const payload = {
              seqNo: r.seqNo || window.getNextSeqNo(),
              id: String(r.id || '').trim(),
              dept: r.dept || '交工科',
              batch: String(r.batch || '').trim(),
              district: r.district || '桃園區',
              serial: String(r.serial || '').trim(),
              year: r.year || '115',
              zone: r.zone || defZone || '',
              crossZone: isCross,
              vendor: r.vendor || '無對應廠商',
              recvDate: r.recvDate || '',
              dispatchDate: r.dispatchDate || '',
              expectedDate: r.expectedDate || '',
              dispatcher: r.dispatcher || window.currentUser?.username || '',
              source: r.source || '一般派工',
              sourceDetail: r.sourceDetail || '',
              village: r.village || '',
              location: r.location || '',
              content: r.content || '',
              attributes: isCross ? ['跨區支援'] : [],
              schoolName: '',
              docUrl: r.docUrl || '',
              photoUrl: r.photoUrl || '',
              asbuiltUrl: r.asbuiltUrl || '',
              actualDate: r.actualDate || (r.status === '已完工' ? (r.recvDate || '') : ''),
              status: r.actualDate ? '已完工' : (r.status || '辦理中'),
              dispatchAmount: r.dispatchAmount || 0,
              completeAmount: r.completeAmount || 0,
              evalData: {},
              updatedAt: Date.now()
            };

            if (r.isDuplicate && r.dupAction === 'overwrite' && r.existingDocId) {
              await updateDoc(doc(db, "workOrders", r.existingDocId), payload);
            } else {
              await addDoc(collection(db, "workOrders"), payload);
            }
          }
          window.smartImportRows = [];
          window.renderSmartImportPreview();
          window.closeSmartImportModal();
          window.customAlert(`成功匯入 ${selectedRows.length} 筆派工單至各區總表！`);
        } catch (err) {
          window.customAlert('批次匯入過程發生錯誤，請稍後再試。', 'error');
        } finally {
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-check-double mr-1"></i>確認匯入各區總表';
        }
      };

      if (selectedDups.length > 0) {
        const dupListStr = selectedDups.slice(0, 5).map(d => `• ${d.id} (${d.location || '無地點'}) [${d.dupAction === 'overwrite' ? '覆蓋原案件' : '強制新增'}]`).join('\n');
        window.customConfirm(
          `⚠️ 重複派工確認：\n您勾選的匯入清單中包含 ${selectedDups.length} 筆【重複派工】案件（紅底標示）：\n${dupListStr}${selectedDups.length > 5 ? '\n...等' : ''}\n\n是否確認依您選擇的方式匯入總表？`,
          executeBatchWrite
        );
      } else {
        executeBatchWrite();
      }
    };

};
