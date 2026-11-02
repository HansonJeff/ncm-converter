/* 页面逻辑：文件选择 / 拖拽、批量转换、单个与打包下载 */
(function () {
  'use strict';

  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const fileList = document.getElementById('fileList');
  const listWrap = document.getElementById('listWrap');
  const summary = document.getElementById('summary');
  const btnZip = document.getElementById('btnZip');
  const btnClear = document.getElementById('btnClear');
  const coverTpl = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="18" fill="#2a2d3e"/><path d="M62 28v26.5a9.5 9.5 0 1 1-4-7.7V34l-20 4.4V64a9.5 9.5 0 1 1-4-7.7V36l28-6.2z" fill="#6c7bff"/></svg>');

  /** @type {Array<{id:number, file:File, status:string, error?:string, result?:object, url?:string, coverUrl?:string}>} */
  const items = [];
  let nextId = 1;
  let converting = 0;

  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function updateSummary() {
    const done = items.filter(i => i.status === 'done').length;
    const fail = items.filter(i => i.status === 'error').length;
    const busy = converting > 0;
    if (items.length === 0) {
      listWrap.hidden = true;
      return;
    }
    listWrap.hidden = false;
    summary.textContent = busy
      ? `正在转换…（成功 ${done} / 失败 ${fail} / 共 ${items.length}）`
      : `全部完成：成功 ${done} 个，失败 ${fail} 个`;
    btnZip.disabled = done === 0 || busy;
  }

  function render() {
    fileList.innerHTML = items.map(item => {
      let right = '';
      if (item.status === 'working') {
        right = '<span class="tag tag-working">转换中…</span>';
      } else if (item.status === 'done') {
        let instBtn;
        const inst = item.inst;
        if (inst && inst.status === 'working') {
          instBtn = '<span class="tag tag-working">提取伴奏中…</span>';
        } else if (inst && inst.status === 'done') {
          instBtn = `<a class="btn btn-small btn-alt" href="${inst.url}" download="${escapeHtml(inst.name)}">🎵 下载伴奏</a>`;
        } else if (inst && inst.status === 'error') {
          instBtn = `<button class="btn btn-small btn-ghost" data-act="inst" data-id="${item.id}" title="${escapeHtml(inst.error)}">重试伴奏</button>`;
        } else {
          instBtn = `<button class="btn btn-small btn-alt" data-act="inst" data-id="${item.id}">🎤 提取伴奏</button>`;
        }
        right = `<span class="tag tag-done">${escapeHtml(item.result.format.toUpperCase())}</span>` +
          `<a class="btn btn-small" href="${item.url}" download="${escapeHtml(item.outName)}">下载</a>` +
          instBtn;
      } else if (item.status === 'error') {
        right = `<span class="tag tag-error" title="${escapeHtml(item.error)}">失败</span>`;
      } else {
        right = '<span class="tag">等待中</span>';
      }
      const cover = item.coverUrl || coverTpl;
      const title = item.status === 'done' && item.result.musicName
        ? `<div class="f-title">${escapeHtml(item.result.musicName)}</div>
           <div class="f-sub">${escapeHtml(item.result.artists || '未知艺术家')} · ${escapeHtml(item.result.album || '未知专辑')}</div>`
        : `<div class="f-title">${escapeHtml(item.file.name)}</div>
           <div class="f-sub">${fmtSize(item.file.size)}${item.error ? ' · ' + escapeHtml(item.error) : ''}</div>`;
      return `<div class="file-item" data-id="${item.id}">
        <img class="f-cover" src="${cover}" alt="">
        <div class="f-info">${title}</div>
        <div class="f-action">${right}</div>
      </div>`;
    }).join('');
    updateSummary();
  }

  async function convert(item) {
    item.status = 'working';
    converting++;
    render();
    try {
      const buf = new Uint8Array(await item.file.arrayBuffer());
      const result = NCM_CORE.parseNcm(buf);
      item.result = result;
      item.outName = NCM_CORE.outputName(result, item.file.name);
      const mime = result.format === 'flac' ? 'audio/flac'
        : result.format === 'ogg' ? 'audio/ogg' : 'audio/mpeg';
      item.url = URL.createObjectURL(new Blob([result.audio], { type: mime }));
      if (result.cover) {
        item.coverUrl = URL.createObjectURL(new Blob([result.cover], { type: 'image/jpeg' }));
      }
      item.status = 'done';
    } catch (e) {
      item.status = 'error';
      item.error = e && e.message ? e.message : String(e);
    } finally {
      converting--;
      render();
    }
  }

  function addFiles(files) {
    const list = Array.from(files).filter(f => /\.ncm$/i.test(f.name));
    const skipped = files.length - list.length;
    if (skipped > 0) {
      showToast(`已忽略 ${skipped} 个非 .ncm 文件`);
    }
    if (list.length === 0) return;
    for (const file of list) {
      const item = { id: nextId++, file, status: 'pending' };
      items.push(item);
      convert(item);
    }
    render();
  }

  let toastTimer = null;
  function showToast(msg) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    addFiles(fileInput.files);
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach(ev => dropZone.addEventListener(ev, e => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach(ev => dropZone.addEventListener(ev, e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
  }));
  dropZone.addEventListener('drop', e => addFiles(e.dataTransfer.files));

  // 提取伴奏（事件委托）
  fileList.addEventListener('click', e => {
    const btn = e.target.closest('[data-act="inst"]');
    if (!btn) return;
    const item = items.find(i => i.id === Number(btn.dataset.id));
    if (item && item.status === 'done') makeInstrumental(item);
  });

  async function makeInstrumental(item) {
    item.inst = { status: 'working' };
    render();
    try {
      const wav = await NCM_VOCAL.toInstrumental(item.result.audio);
      const base = item.outName.replace(/\.[^.]+$/, '');
      item.inst = {
        status: 'done',
        url: URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })),
        name: base + ' (伴奏).wav',
      };
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      item.inst = { status: 'error', error: msg };
      showToast('伴奏提取失败：' + msg);
    }
    render();
  }

  btnClear.addEventListener('click', () => {
    for (const item of items) {
      if (item.url) URL.revokeObjectURL(item.url);
      if (item.coverUrl) URL.revokeObjectURL(item.coverUrl);
      if (item.inst && item.inst.url) URL.revokeObjectURL(item.inst.url);
    }
    items.length = 0;
    render();
  });

  btnZip.addEventListener('click', () => {
    const done = items.filter(i => i.status === 'done');
    if (done.length === 0) return;
    const entries = done.map(i => ({ name: i.outName, data: i.result.audio }));
    const zip = NCM_ZIP.createZip(entries);
    const url = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ncm-converted.zip';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });

  render();
})();
