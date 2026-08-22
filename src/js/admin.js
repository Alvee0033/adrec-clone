import '../styles/admin.css';

document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('admin_token');
  if (!token) {
    window.location.href = '/admin/login';
    return;
  }
  document.body.style.opacity = '1';

  const contractsListView = document.getElementById('contractsListView');
  const contractFormView = document.getElementById('contractFormView');
  const contractsTableBody = document.getElementById('contractsTableBody');
  const contractForm = document.getElementById('contractForm');
  const formTitle = document.getElementById('formTitle');
  const btnDownloadFormPdf = document.getElementById('btnDownloadFormPdf');
  const pdfDownloadRow = document.getElementById('pdfDownloadRow');
  const cNumberInput = document.getElementById('c_number');
  const statTotal = document.getElementById('statTotal');
  const statActive = document.getElementById('statActive');
  const pdfPreviewIframe = document.getElementById('pdfPreviewIframe');
  const pdfPreviewContainer = document.getElementById('pdfPreviewContainer');
  const pdfUploadStatus = document.getElementById('pdfUploadStatus');

  function setPdfDownloadVisible(visible, number = '') {
    if (!btnDownloadFormPdf || !pdfDownloadRow) return;
    if (visible && number) {
      btnDownloadFormPdf.href = `/api/contracts/${number}/pdf`;
      btnDownloadFormPdf.style.display = 'inline-flex';
      pdfDownloadRow.hidden = false;
    } else if (visible && pendingPdfBlobUrl) {
      btnDownloadFormPdf.href = pendingPdfBlobUrl;
      btnDownloadFormPdf.style.display = 'inline-flex';
      pdfDownloadRow.hidden = false;
    } else {
      btnDownloadFormPdf.href = '#';
      btnDownloadFormPdf.style.display = 'none';
      pdfDownloadRow.hidden = true;
    }
  }

  let contractsCache = {};
  let isCreatingMode = false;
  let pendingPdfFile = null;
  let pendingPdfBlobUrl = null;
  const selectedIds = new Set();

  const selectAllCheckbox = document.getElementById('selectAllContracts');
  const selectionCountEl = document.getElementById('selectionCount');
  const btnBulkDelete = document.getElementById('btnBulkDelete');
  const autoDeleteToggle = document.getElementById('autoDeleteToggle');
  const autoDeleteAtInput = document.getElementById('autoDeleteAtInput');
  const btnApplyAutoDelete = document.getElementById('btnApplyAutoDelete');

  function authHeaders(extra = {}) {
    return { Authorization: token, ...extra };
  }

  function showToast(message, type = 'info', duration = 3000) {
    let container = document.getElementById('adminToastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'adminToastContainer';
      container.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:99999;display:flex;flex-direction:column;gap:10px;pointer-events:none;max-width:380px;';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    const bg = type === 'success' ? '#059669' : type === 'error' ? '#DC2626' : '#2563EB';
    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
    toast.style.cssText = `background:${bg};color:#fff;padding:12px 18px;border-radius:8px;box-shadow:0 10px 25px -5px rgba(0,0,0,0.3);font-size:14px;font-weight:500;display:flex;align-items:center;gap:10px;pointer-events:auto;transition:all 0.25s ease;`;
    toast.innerHTML = `<span style="font-size:16px;font-weight:bold;">${icon}</span><span>${message}</span>`;
    container.appendChild(toast);

    const remove = () => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 250);
    };

    if (duration > 0) setTimeout(remove, duration);

    return {
      update: (newMsg, newType = type) => {
        const newBg = newType === 'success' ? '#059669' : newType === 'error' ? '#DC2626' : '#2563EB';
        const newIcon = newType === 'success' ? '✓' : newType === 'error' ? '✕' : 'ℹ';
        toast.style.background = newBg;
        toast.innerHTML = `<span style="font-size:16px;font-weight:bold;">${newIcon}</span><span>${newMsg}</span>`;
      },
      dismiss: remove,
    };
  }

  function clearPendingPdf() {
    if (pendingPdfBlobUrl) {
      URL.revokeObjectURL(pendingPdfBlobUrl);
      pendingPdfBlobUrl = null;
    }
    pendingPdfFile = null;
  }

  function hidePdfPreview() {
    if (pdfPreviewContainer) {
      pdfPreviewContainer.hidden = true;
      pdfPreviewContainer.style.display = 'none';
    }
    if (pdfPreviewIframe) {
      try {
        pdfPreviewIframe.contentWindow.location.replace('about:blank');
      } catch(e) {
        pdfPreviewIframe.src = '';
      }
    }
    if (pdfUploadStatus) {
      pdfUploadStatus.textContent = 'PDF appears here after OCR or when viewing a saved contract.';
      pdfUploadStatus.style.color = '#6B7280';
    }
  }

  function showPdfPreview(src, statusText, statusColor = '#166534') {
    if (!pdfPreviewIframe || !pdfPreviewContainer) return;
    try {
      pdfPreviewIframe.contentWindow.location.replace(src);
    } catch (e) {
      const newIframe = document.createElement('iframe');
      newIframe.id = pdfPreviewIframe.id;
      newIframe.title = pdfPreviewIframe.title;
      newIframe.src = src;
      pdfPreviewIframe.parentNode.replaceChild(newIframe, pdfPreviewIframe);
      pdfPreviewIframe = newIframe;
    }
    pdfPreviewContainer.hidden = false;
    pdfPreviewContainer.style.display = 'block';
    if (statusText && pdfUploadStatus) {
      pdfUploadStatus.textContent = statusText;
      pdfUploadStatus.style.color = statusColor;
    }
  }

  /** OCR attaches PDF for preview + upload on save (no manual upload UI) */
  function attachPdfFromOcr(file) {
    clearPendingPdf();
    pendingPdfFile = file;
    pendingPdfBlobUrl = URL.createObjectURL(file);
    showPdfPreview(pendingPdfBlobUrl, `Attached from OCR: ${file.name} — will save with the contract`, '#166534');
    setPdfDownloadVisible(true);
  }

  function fileToBase64(blobOrFile) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const resStr = String(reader.result || '');
        const commaIdx = resStr.indexOf(',');
        resolve(commaIdx >= 0 ? resStr.slice(commaIdx + 1) : resStr);
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(blobOrFile);
    });
  }

  async function uploadPdfToServer(number, file, onProgress) {
    // If <= 3MB, send directly in 1 fast single request
    if (file.size <= 3 * 1024 * 1024) {
      if (onProgress) onProgress('Uploading PDF…');
      const base64Data = await fileToBase64(file);
      const res = await fetch(`/api/contracts/${number}/upload-pdf`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ data: base64Data }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || 'PDF upload failed');
      return result;
    }

    // For larger files (>3MB), upload 3MB chunks in parallel
    const CHUNK_SIZE = 3 * 1024 * 1024;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    let completedChunks = 0;

    const uploadChunk = async (i) => {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const slice = file.slice(start, end);
      const base64Data = await fileToBase64(slice);

      const res = await fetch(`/api/contracts/${number}/upload-pdf-chunk`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          chunkIndex: i,
          totalChunks,
          data: base64Data,
        }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || `Chunk ${i + 1}/${totalChunks} upload failed`);
      completedChunks++;
      if (onProgress) onProgress(`Uploading PDF (${completedChunks}/${totalChunks})…`);
      return result;
    };

    if (onProgress) onProgress(`Uploading PDF (0/${totalChunks})…`);
    await Promise.all(Array.from({ length: totalChunks }, (_, i) => uploadChunk(i)));

    if (onProgress) onProgress('Finalizing storage…');
    const completeRes = await fetch(`/api/contracts/${number}/complete-pdf-upload`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ totalChunks }),
    });
    const completeResult = await completeRes.json().catch(() => ({}));
    if (!completeRes.ok) throw new Error(completeResult.error || 'Failed to assemble PDF in MinIO');
    return completeResult;
  }

  const handleLogout = async () => {
    try {
      await fetch('/api/logout', { method: 'POST' });
    } catch (_) {}
    localStorage.removeItem('admin_token');
    window.location.href = '/admin/login';
  };

  document.getElementById('logoutBtn')?.addEventListener('click', handleLogout);
  document.getElementById('dockLogoutBtn')?.addEventListener('click', handleLogout);
  document.getElementById('dockContractsBtn')?.addEventListener('click', () => { window.location.hash = '#/contracts'; });
  document.getElementById('btnBackToList')?.addEventListener('click', () => { window.location.hash = '#/contracts'; });
  document.getElementById('btnCancelForm')?.addEventListener('click', () => { window.location.hash = '#/contracts'; });
  document.getElementById('menuSettingsBtn')?.addEventListener('click', () => { window.location.hash = '#/settings'; });
  document.getElementById('dockSettingsBtn')?.addEventListener('click', () => { window.location.hash = '#/settings'; });
  document.getElementById('btnBackFromSettings')?.addEventListener('click', () => { window.location.hash = '#/contracts'; });
  document.getElementById('btnCancelSettings')?.addEventListener('click', () => { window.location.hash = '#/contracts'; });
  document.getElementById('menuContractsBtn')?.addEventListener('click', () => { window.location.hash = '#/contracts'; });

  document.getElementById('contractSearchInput')?.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    if (!query) {
      renderTable(contractsCache);
      return;
    }
    const filtered = {};
    for (const id in contractsCache) {
      const c = contractsCache[id];
      if (
        c.number.toString().toLowerCase().includes(query) ||
        (c.tenantName || '').toLowerCase().includes(query) ||
        (c.propertyName || '').toLowerCase().includes(query) ||
        (c.tenantEmiratesId || '').toLowerCase().includes(query)
      ) {
        filtered[id] = c;
      }
    }
    renderTable(filtered);
  });

  async function extractTextFromPdf(file) {
    if (typeof window.pdfjsLib === 'undefined') return null;
    try {
      if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      }
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let fullText = '';
      for (let i = 1; i <= Math.min(pdf.numPages, 10); i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        fullText += pageText + '\n';
      }
      return fullText;
    } catch (err) {
      console.warn('Client PDF text extraction error:', err);
      return null;
    }
  }

  async function handleOcrUpload(file, labelElement) {
    const originalHtml = labelElement.innerHTML;
    labelElement.classList.add('is-busy');
    labelElement.innerHTML = `<span class="ocr-spinner"></span><span>Reading PDF…</span>`;

    try {
      let result;
      // 1. Try ultra-fast client-side text extraction first
      const clientText = await extractTextFromPdf(file);
      if (clientText && clientText.trim().length > 30) {
        const res = await fetch('/api/ocr-pdf', {
          method: 'POST',
          headers: {
            ...authHeaders(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text: clientText }),
        });
        result = await res.json();
      } else {
        // 2. Fallback to multipart file upload
        const formData = new FormData();
        formData.append('pdf', file);
        const res = await fetch('/api/ocr-pdf', {
          method: 'POST',
          headers: authHeaders(),
          body: formData,
        });
        result = await res.json();
      }

      labelElement.innerHTML = originalHtml;
      labelElement.classList.remove('is-busy');

      if (!result || !result.success) {
        alert(`OCR Parsing Failed: ${result?.error || 'Could not parse document'}`);
        return;
      }

      const f = result.fields;
      const keepNumber = !isCreatingMode && cNumberInput.readOnly;

      if (isCreatingMode || !keepNumber) {
        isCreatingMode = true;
        formTitle.textContent = 'Register New Tenancy Contract (OCR Filled)';
        cNumberInput.readOnly = false;
        contractForm.reset();
      }

      fillFormFromFields(f, { preserveNumber: keepNumber });

      // OCR PDF preview + store for upload on save
      attachPdfFromOcr(file);

      const num = cNumberInput.value.trim();
      if (!isCreatingMode && num) setPdfDownloadVisible(true, num);
      document.getElementById('btnDeleteContract').style.display = isCreatingMode ? 'none' : 'inline-flex';
      document.getElementById('lblOcrFormUpload').style.display = 'inline-flex';

      showFormView();
      pdfPreviewContainer?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (err) {
      console.error(err);
      labelElement.innerHTML = originalHtml;
      labelElement.classList.remove('is-busy');
      alert('Network error trying to process PDF OCR.');
    }
  }

  function fillFormFromFields(f, { preserveNumber = false } = {}) {
    if (!preserveNumber) cNumberInput.value = f.number || '';
    document.getElementById('c_issueDate').value = f.issueDate || '';
    document.getElementById('c_startDate').value = f.startDate || '';
    document.getElementById('c_endDate').value = f.endDate || '';
    document.getElementById('c_annualRent').value = f.annualRent || '';
    document.getElementById('c_value').value = f.value || '';
    document.getElementById('c_type').value = f.type || 'Residential';
    document.getElementById('c_term').value = f.term || '1 Year';
    document.getElementById('c_payments').value = f.payments || 1;
    document.getElementById('c_occupants').value = f.occupants || 1;

    document.getElementById('t_name').value = f.tenantName || '';
    document.getElementById('t_emiratesId').value = f.tenantEmiratesId || '';
    document.getElementById('t_nationality').value = f.tenantNationality || '';
    document.getElementById('t_mobile').value = f.tenantMobile || '';
    document.getElementById('t_email').value = f.tenantEmail || '';

    document.getElementById('l_company').value = f.lessorCompany || '';
    document.getElementById('l_license').value = f.lessorLicense || '';
    document.getElementById('l_name').value = f.lessorName || '';
    document.getElementById('l_mobile').value = f.lessorMobile || '';
    document.getElementById('l_email').value = f.lessorEmail || '';

    document.getElementById('p_name').value = f.propertyName || '';
    document.getElementById('p_type').value = f.propertyType || 'BUILDING';
    document.getElementById('p_municipality').value = f.municipality || 'Abu Dhabi City';
    document.getElementById('p_zone').value = f.zone || '';
    document.getElementById('p_sector').value = f.sector || '';
    document.getElementById('p_plot').value = f.plot || '';
    document.getElementById('u_premise').value = f.premise || '';
    document.getElementById('u_rooms').value = f.rooms || 2;
    document.getElementById('u_type').value = f.unitType || 'APARTMENT';
    document.getElementById('u_regNo').value = f.unitRegNo || '';
    document.getElementById('u_number').value = f.unitNumber || '';
  }

  document.getElementById('ocr_form_pdf_upload')?.addEventListener('change', async (e) => {
    if (!e.target.files?.length) return;
    const file = e.target.files[0];
    const label = document.getElementById('lblOcrFormUpload');
    await handleOcrUpload(file, label);
    e.target.value = '';
  });

  document.getElementById('btnCreateContract')?.addEventListener('click', () => {
    window.location.hash = '#/contracts/new';
  });

  async function loadContractsList() {
    try {
      const res = await fetch('/api/contracts', { headers: authHeaders() });
      if (res.status === 401) {
        localStorage.removeItem('admin_token');
        window.location.href = '/admin/login';
        return;
      }
      if (res.ok) {
        contractsCache = await res.json();
        renderTable(contractsCache);
        updateStats(contractsCache);
      }
    } catch (err) {
      console.error('Error fetching contracts:', err);
    }
  }

  function updateStats(data) {
    const keys = Object.keys(data);
    const today = new Date().toISOString().slice(0, 10);
    let active = 0;
    keys.forEach((id) => {
      const c = data[id];
      if (c.startDate && c.endDate && c.startDate <= today && c.endDate >= today) active += 1;
    });
    if (statTotal) statTotal.textContent = String(keys.length);
    if (statActive) statActive.textContent = String(active);
  }

  function formatAutoDelete(c) {
    if (!c.autoDeleteEnabled || !c.autoDeleteAt) {
      return '<span class="auto-delete-badge is-off">Off</span>';
    }
    const d = new Date(c.autoDeleteAt);
    if (Number.isNaN(d.getTime())) {
      return '<span class="auto-delete-badge is-off">Off</span>';
    }
    const label = d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const soon = d.getTime() - Date.now() < 24 * 60 * 60 * 1000;
    return `<span class="auto-delete-badge ${soon ? 'is-soon' : 'is-on'}" title="${d.toISOString()}">${label}</span>`;
  }

  function updateSelectionUI() {
    const count = selectedIds.size;
    if (selectionCountEl) selectionCountEl.textContent = `${count} selected`;
    if (btnBulkDelete) btnBulkDelete.disabled = count === 0;
    syncAutoDeleteControls();

    const boxes = document.querySelectorAll('.row-select');
    if (selectAllCheckbox) {
      const total = boxes.length;
      selectAllCheckbox.checked = total > 0 && count === total;
      selectAllCheckbox.indeterminate = count > 0 && count < total;
    }
  }

  function syncAutoDeleteControls() {
    const hasSelection = selectedIds.size > 0;
    const enabled = Boolean(autoDeleteToggle?.checked);
    if (autoDeleteAtInput) autoDeleteAtInput.disabled = !hasSelection || !enabled;
    if (btnApplyAutoDelete) btnApplyAutoDelete.disabled = !hasSelection || (enabled && !autoDeleteAtInput?.value);
    if (autoDeleteToggle) autoDeleteToggle.disabled = !hasSelection;
  }

  function getSelectedIds() {
    return [...selectedIds];
  }

  function renderTable(data) {
    contractsTableBody.innerHTML = '';
    // Drop selections that no longer exist
    for (const id of [...selectedIds]) {
      if (!data[id]) selectedIds.delete(id);
    }

    const keys = Object.keys(data);
    if (keys.length === 0) {
      contractsTableBody.innerHTML = `
        <tr>
          <td colspan="9" class="empty-table-cell">
            No tenancy contracts registered yet. Click <strong>Create New</strong> to add one.
          </td>
        </tr>`;
      updateSelectionUI();
      return;
    }

    keys.forEach((id) => {
      const c = data[id];
      const checked = selectedIds.has(String(c.number)) ? 'checked' : '';
      const tr = document.createElement('tr');
      if (checked) tr.classList.add('is-selected');
      tr.innerHTML = `
        <td data-label="Select" class="col-check">
          <input type="checkbox" class="row-select" data-id="${c.number}" ${checked} aria-label="Select contract ${c.number}" />
        </td>
        <td data-label="Contract No."><span class="contract-id">${c.number}</span></td>
        <td data-label="Tenant Name">${c.tenantName || '—'}</td>
        <td data-label="Emirates ID">${c.tenantEmiratesId || '—'}</td>
        <td data-label="Property">${c.propertyName || '—'} <span class="muted-unit">${c.unitNumber || ''}</span></td>
        <td data-label="Start Date">${c.startDate || '—'}</td>
        <td data-label="End Date">${c.endDate || '—'}</td>
        <td data-label="Auto delete">${formatAutoDelete(c)}</td>
        <td class="cell-actions">
          <div class="table-actions">
            <button type="button" class="btn-tb-edit" data-id="${c.number}">Edit</button>
            <button type="button" class="btn-tb-view" data-id="${c.number}">View</button>
          </div>
        </td>`;
      contractsTableBody.appendChild(tr);
    });

    document.querySelectorAll('.btn-tb-edit, .btn-tb-view').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        window.location.hash = `#/contracts/edit/${e.currentTarget.dataset.id}`;
      });
    });

    document.querySelectorAll('.row-select').forEach((box) => {
      box.addEventListener('change', (e) => {
        const id = String(e.target.dataset.id);
        const row = e.target.closest('tr');
        if (e.target.checked) {
          selectedIds.add(id);
          row?.classList.add('is-selected');
        } else {
          selectedIds.delete(id);
          row?.classList.remove('is-selected');
        }
        updateSelectionUI();
      });
    });

    updateSelectionUI();
  }

  selectAllCheckbox?.addEventListener('change', () => {
    const boxes = document.querySelectorAll('.row-select');
    boxes.forEach((box) => {
      box.checked = selectAllCheckbox.checked;
      const id = String(box.dataset.id);
      if (selectAllCheckbox.checked) selectedIds.add(id);
      else selectedIds.delete(id);
      box.closest('tr')?.classList.toggle('is-selected', selectAllCheckbox.checked);
    });
    updateSelectionUI();
  });

  autoDeleteToggle?.addEventListener('change', () => {
    syncAutoDeleteControls();
    if (autoDeleteToggle.checked && autoDeleteAtInput && !autoDeleteAtInput.value) {
      const soon = new Date(Date.now() + 60 * 60 * 1000);
      const pad = (n) => String(n).padStart(2, '0');
      autoDeleteAtInput.value = `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}T${pad(soon.getHours())}:${pad(soon.getMinutes())}`;
      syncAutoDeleteControls();
    }
  });

  autoDeleteAtInput?.addEventListener('input', syncAutoDeleteControls);

  btnBulkDelete?.addEventListener('click', async () => {
    const ids = getSelectedIds();
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} selected contract(s)? This cannot be undone.`)) return;

    btnBulkDelete.disabled = true;
    btnBulkDelete.textContent = 'Deleting…';
    try {
      const res = await fetch('/api/contracts/bulk-delete', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ ids }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(result.error || 'Bulk delete failed');
        return;
      }
      selectedIds.clear();
      if (autoDeleteToggle) autoDeleteToggle.checked = false;
      await loadContractsList();
    } catch (err) {
      console.error(err);
      alert('Network error during bulk delete.');
    } finally {
      btnBulkDelete.textContent = 'Delete selected';
      updateSelectionUI();
    }
  });

  btnApplyAutoDelete?.addEventListener('click', async () => {
    const ids = getSelectedIds();
    if (!ids.length) return;

    const enabled = Boolean(autoDeleteToggle?.checked);
    let deleteAt = null;
    if (enabled) {
      if (!autoDeleteAtInput?.value) {
        alert('Choose a date and time for auto-delete.');
        return;
      }
      deleteAt = new Date(autoDeleteAtInput.value).toISOString();
      if (new Date(deleteAt).getTime() <= Date.now()) {
        alert('Auto-delete time must be in the future.');
        return;
      }
    }

    const msg = enabled
      ? `Schedule auto-delete for ${ids.length} contract(s) at ${new Date(deleteAt).toLocaleString()}?`
      : `Turn off auto-delete for ${ids.length} contract(s)?`;
    if (!confirm(msg)) return;

    btnApplyAutoDelete.disabled = true;
    btnApplyAutoDelete.textContent = 'Saving…';
    try {
      const res = await fetch('/api/contracts/auto-delete', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ ids, enabled, deleteAt }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(result.error || 'Failed to update auto-delete');
        return;
      }
      await loadContractsList();
    } catch (err) {
      console.error(err);
      alert('Network error updating auto-delete.');
    } finally {
      btnApplyAutoDelete.textContent = 'Apply schedule';
      updateSelectionUI();
    }
  });

  // Refresh list periodically so auto-deleted rows disappear
  setInterval(() => {
    if (contractsListView?.style.display !== 'none') {
      loadContractsList();
    }
  }, 45_000);

  async function showSettingsView() {
    contractsListView.style.display = 'none';
    contractFormView.style.display = 'none';
    const settingsView = document.getElementById('settingsView');
    if (settingsView) settingsView.style.display = 'block';
    // set active menu item
    document.querySelectorAll('.sidebar-btn').forEach((b) => b.classList.remove('active'));
    document.getElementById('menuSettingsBtn')?.classList.add('active');
    document.querySelectorAll('.dock-btn').forEach((b) => b.classList.remove('active'));
    document.getElementById('dockSettingsBtn')?.classList.add('active');
    // populate current username
    try {
      const res = await fetch('/api/admin/me', { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        document.getElementById('admin_username').value = data.username || '';
      }
    } catch (err) {
      console.error('Failed to load admin info', err);
    }
  }

  // openEditForm is now handled dynamically by handleRouting

  document.getElementById('btnDeleteContract')?.addEventListener('click', async () => {
    const number = cNumberInput.value.trim();
    if (!number) return;
    if (!confirm(`Permanently delete Contract No. ${number}? This cannot be undone.`)) return;

    try {
      const res = await fetch(`/api/contracts/${number}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (res.ok) {
        await loadContractsList();
        window.location.hash = '#/contracts';
      } else {
        const errResult = await res.json().catch(() => ({}));
        alert(`Failed to delete: ${errResult.error || 'Server error'}`);
      }
    } catch (err) {
      console.error(err);
      alert('Network error trying to delete contract.');
    }
  });

  // Maximize PDF preview
  let modalScale = 1;
  let startDistance = 0;
  const zoomContainer = document.getElementById('pdfModalZoomContainer');
  const zoomContent = document.getElementById('pdfModalZoomContent');
  const modalOverlay = document.getElementById('pdfModalOverlay');
  const modalIframe = document.getElementById('pdfModalIframe');

  function openPdfMaximize() {
    const number = cNumberInput.value.trim();
    let src = pendingPdfBlobUrl;
    if (!src && number) src = `/api/contracts/${number}/pdf?t=${Date.now()}`;
    if (!src) {
      alert('No PDF available to preview yet.');
      return;
    }
    try {
      modalIframe.contentWindow.location.replace(src);
    } catch (e) {
      const newIframe = document.createElement('iframe');
      newIframe.id = modalIframe.id;
      newIframe.title = modalIframe.title;
      newIframe.src = src;
      modalIframe.parentNode.replaceChild(newIframe, modalIframe);
      modalIframe = newIframe;
    }
    modalScale = 1;
    if (zoomContent) zoomContent.style.transform = 'scale(1)';
    modalOverlay.classList.add('is-open');
    modalOverlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closePdfMaximize() {
    if (!modalOverlay) return;
    if (modalIframe) {
      try {
        modalIframe.contentWindow.location.replace('about:blank');
      } catch(e) {
        modalIframe.src = '';
      }
    }
    modalOverlay.classList.remove('is-open');
    modalOverlay.style.display = 'none';
    document.body.style.overflow = '';
  }

  document.getElementById('btnEnlargePdf')?.addEventListener('click', openPdfMaximize);
  document.getElementById('btnClosePdfModal')?.addEventListener('click', closePdfMaximize);
  modalOverlay?.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closePdfMaximize();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalOverlay?.classList.contains('is-open')) closePdfMaximize();
  });

  zoomContainer?.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      startDistance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  });

  zoomContainer?.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && startDistance > 0 && zoomContent) {
      const currentDistance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      let newScale = modalScale * (currentDistance / startDistance);
      newScale = Math.min(Math.max(newScale, 0.8), 4);
      zoomContent.style.transform = `scale(${newScale})`;
    }
  });

  zoomContainer?.addEventListener('touchend', () => {
    if (!zoomContent) return;
    const match = zoomContent.style.transform.match(/scale\(([^)]+)\)/);
    if (match?.[1]) modalScale = parseFloat(match[1]);
    startDistance = 0;
  });

  contractForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const number = cNumberInput.value.trim();
    if (!number) return;

    const payload = {
      number,
      issueDate: document.getElementById('c_issueDate').value,
      startDate: document.getElementById('c_startDate').value,
      endDate: document.getElementById('c_endDate').value,
      annualRent: parseFloat(document.getElementById('c_annualRent').value),
      value: parseFloat(document.getElementById('c_value').value),
      type: document.getElementById('c_type').value,
      term: document.getElementById('c_term').value,
      payments: parseInt(document.getElementById('c_payments').value, 10),
      occupants: parseInt(document.getElementById('c_occupants').value, 10),
      tenantName: document.getElementById('t_name').value,
      tenantEmiratesId: document.getElementById('t_emiratesId').value,
      tenantNationality: document.getElementById('t_nationality').value,
      tenantMobile: document.getElementById('t_mobile').value,
      tenantEmail: document.getElementById('t_email').value,
      lessorCompany: document.getElementById('l_company').value,
      lessorLicense: document.getElementById('l_license').value,
      lessorName: document.getElementById('l_name').value,
      lessorMobile: document.getElementById('l_mobile').value,
      lessorEmail: document.getElementById('l_email').value,
      propertyName: document.getElementById('p_name').value,
      propertyType: document.getElementById('p_type').value,
      municipality: document.getElementById('p_municipality').value,
      zone: document.getElementById('p_zone').value,
      sector: document.getElementById('p_sector').value,
      plot: document.getElementById('p_plot').value,
      premise: document.getElementById('u_premise').value,
      rooms: parseInt(document.getElementById('u_rooms').value, 10),
      unitType: document.getElementById('u_type').value,
      unitRegNo: document.getElementById('u_regNo').value,
      unitNumber: document.getElementById('u_number').value,
    };

    const saveBtn = contractForm.querySelector('.btn-save-contract');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
    }

    try {
      const res = await fetch(`/api/contracts/${number}`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        alert('Failed to save contract details.');
        return;
      }

      // Optimistically update local cache and table UI instantly
      contractsCache[number] = { ...(contractsCache[number] || {}), ...payload };
      renderContractsTable(contractsCache);
      updateMetrics(contractsCache);

      // Instant UI switch to list view
      showToast(`Contract #${number} saved successfully!`, 'success', 3000);
      const pdfToUpload = pendingPdfFile;
      clearPendingPdf();
      window.location.hash = '#/contracts';

      // Background PDF upload if a file is attached (never blocks the user)
      if (pdfToUpload) {
        (async () => {
          const syncToast = showToast(`Syncing PDF for #${number} to storage…`, 'info', 0);
          try {
            await uploadPdfToServer(number, pdfToUpload, (msg) => {
              syncToast.update(`PDF #${number}: ${msg}`, 'info');
            });
            syncToast.update(`PDF for #${number} synced to MinIO!`, 'success');
            setTimeout(() => syncToast.dismiss(), 3500);

            if (contractsCache[number]) {
              contractsCache[number].pdfUrl = `/api/contracts/${number}/pdf`;
            }
          } catch (uploadErr) {
            console.error('Background PDF upload failed:', uploadErr);
            syncToast.update(`PDF sync failed: ${uploadErr.message}`, 'error');
            setTimeout(() => syncToast.dismiss(), 6000);
          }
        })();
      }
    } catch (err) {
      console.error(err);
      alert('Network error trying to save contract.');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save & Sync Contract';
      }
    }
  });

  function showListView() {
    clearPendingPdf();
    const settingsView = document.getElementById('settingsView');
    if (settingsView) settingsView.style.display = 'none';
    contractFormView.style.display = 'none';
    contractsListView.style.display = 'block';
    document.querySelectorAll('.dock-btn').forEach((b) => b.classList.remove('active'));
    document.getElementById('dockContractsBtn')?.classList.add('active');
    // set sidebar active to contracts
    document.querySelectorAll('.sidebar-btn').forEach((b) => b.classList.remove('active'));
    document.getElementById('menuContractsBtn')?.classList.add('active');
  }

  function showFormView() {
    contractsListView.style.display = 'none';
    contractFormView.style.display = 'block';
  }

  // Admin settings form submit
  document.getElementById('adminSettingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = document.getElementById('admin_username').value.trim();
    const pass = document.getElementById('admin_password').value;
    const pass2 = document.getElementById('admin_password_confirm').value;
    const role = document.getElementById('admin_role')?.value || 'operator';
    if (!user || !pass) return alert('Provide username and password');
    if (pass !== pass2) return alert('Passwords do not match');

    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving…';
    }

    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ username: user, password: pass, role }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(result.error || 'Failed to update settings');
        return;
      }
      // new token returned — force logout to require re-login with new credentials
      alert('Settings saved. You will be logged out and must sign in with the new credentials.');
      localStorage.removeItem('admin_token');
      window.location.href = '/admin/login';
    } catch (err) {
      console.error(err);
      alert('Network error while saving settings');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save changes';
      }
    }
  });

  // Password visibility toggle
  const togglePasswordBtn = document.getElementById('togglePasswordBtn');
  if (togglePasswordBtn) {
    togglePasswordBtn.addEventListener('click', () => {
      const p = document.getElementById('admin_password');
      if (!p) return;
      if (p.type === 'password') {
        p.type = 'text';
        togglePasswordBtn.textContent = 'Hide';
      } else {
        p.type = 'password';
        togglePasswordBtn.textContent = 'Show';
      }
    });
  }

  // Ensure sidebar active toggles back when showing list view
  function setSidebarActiveToContracts() {
    document.querySelectorAll('.sidebar-btn').forEach((b) => b.classList.remove('active'));
    document.getElementById('menuContractsBtn')?.classList.add('active');
  }

  const originalShowList = showListView;
  window.showListView = function () {
    originalShowList();
    setSidebarActiveToContracts();
  };

  async function handleRouting() {
    const hash = window.location.hash;

    // Ensure list is loaded first so we have the cache populated
    if (Object.keys(contractsCache).length === 0) {
      await loadContractsList();
    }

    if (hash === '#/settings') {
      showSettingsView();
    } else if (hash === '#/contracts/new') {
      isCreatingMode = true;
      clearPendingPdf();
      formTitle.textContent = 'Register New Tenancy Contract';
      cNumberInput.readOnly = false;
      cNumberInput.value = '';
      contractForm.reset();

      document.getElementById('c_issueDate').valueAsDate = new Date();
      const start = new Date();
      document.getElementById('c_startDate').valueAsDate = start;
      const end = new Date();
      end.setFullYear(end.getFullYear() + 1);
      document.getElementById('c_endDate').valueAsDate = end;

      document.getElementById('c_type').value = 'Residential';
      document.getElementById('c_term').value = '1 Year';
      document.getElementById('c_payments').value = '1';
      document.getElementById('c_occupants').value = '1';
      document.getElementById('p_municipality').value = 'Abu Dhabi City';
      document.getElementById('p_type').value = 'BUILDING';
      document.getElementById('u_rooms').value = '2';
      document.getElementById('u_type').value = 'APARTMENT';

      setPdfDownloadVisible(false);
      hidePdfPreview();
      document.getElementById('btnDeleteContract').style.display = 'none';
      document.getElementById('lblOcrFormUpload').style.display = 'inline-flex';

      showFormView();
    } else if (hash.startsWith('#/contracts/edit/')) {
      const number = hash.replace('#/contracts/edit/', '');
      isCreatingMode = false;
      clearPendingPdf();
      const c = contractsCache[number];
      if (!c) {
        window.location.hash = '#/contracts';
        return;
      }

      formTitle.textContent = `Contract #${c.number}`;
      cNumberInput.value = c.number;
      cNumberInput.readOnly = true;
      fillFormFromFields(c, { preserveNumber: true });

      setPdfDownloadVisible(true, c.number);
      showPdfPreview(
        `/api/contracts/${c.number}/pdf?t=${Date.now()}`,
        'Stored contract PDF',
        '#6B7280'
      );

      document.getElementById('lblOcrFormUpload').style.display = 'inline-flex';
      document.getElementById('btnDeleteContract').style.display = 'inline-flex';
      showFormView();
    } else {
      window.showListView();
    }
  }

  window.addEventListener('hashchange', handleRouting);

  if (!window.location.hash) {
    window.location.hash = '#/contracts';
  }

  loadContractsList().then(() => {
    handleRouting();
  });
});
