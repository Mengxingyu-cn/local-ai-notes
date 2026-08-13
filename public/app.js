'use strict';

/* ============================================================
   本地 AI 笔记 — 前端逻辑（零依赖，原生 JS）
   API 契约见任务说明：相对路径 fetch('/api/...')
   ============================================================ */

/* ================= 工具函数 ================= */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** 统一请求封装：自动 JSON 序列化 / 解析，非 2xx 抛错 */
async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    throw new Error('网络错误，无法连接本地服务');
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* 空响应体 */ }
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `请求失败（HTTP ${res.status}）`;
    throw new Error(msg);
  }
  return data;
}

/** 轻量 Toast：info / success / error */
function toast(msg, type = 'info', ms = 2800) {
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  $('#toastContainer').appendChild(el);
  setTimeout(() => {
    el.classList.add('toast-out');
    setTimeout(() => el.remove(), 320);
  }, ms);
}

/** Promise 化确认框，返回 boolean */
function confirmDialog(text, okLabel = '确定') {
  return new Promise((resolve) => {
    const dlg = $('#confirmDialog');
    $('#confirmText').textContent = text;
    $('#confirmOkBtn').textContent = okLabel;
    dlg.classList.remove('hidden');
    const done = (v) => { dlg.classList.add('hidden'); cleanup(); resolve(v); };
    function cleanup() {
      $('#confirmOkBtn').onclick = null;
      $('#confirmCancelBtn').onclick = null;
      dlg.onclick = null;
    }
    $('#confirmOkBtn').onclick = () => done(true);
    $('#confirmCancelBtn').onclick = () => done(false);
    dlg.onclick = (e) => { if (e.target === dlg) done(false); };
  });
}

/** 标签输入 → 数组（兼容中英文逗号） */
function parseTags(str) {
  return String(str || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
}

const pad2 = (n) => String(n).padStart(2, '0');
const hm = (t) => { const d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 / 日期 */
function relTime(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '';
  const diff = Date.now() - t;
  const min = 60000, hour = 3600000, day = 86400000;
  if (diff < min) return '刚刚';
  if (diff < hour) return Math.floor(diff / min) + ' 分钟前';
  if (diff < day) return Math.floor(diff / hour) + ' 小时前';
  if (diff < 2 * day) return '昨天';
  const d = new Date(t);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function noteTime(n) {
  const d = new Date(n.updatedAt);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

/* ================= 极简 Markdown 渲染（零依赖） =================
   支持：标题、粗体、斜体、行内代码、代码块、无序/有序列表、引用、链接
   先整体 HTML 转义，再还原受保护的代码块/行内代码，杜绝 XSS。 */

function inlineMd(s) {
  const spans = [];
  s = s.replace(/`([^`]+)`/g, (m, c) => {
    spans.push(c);
    return '\u0000CS' + (spans.length - 1) + '\u0000';
  });
  s = s
    .replace(/!\[([^\]]*)\]\((https?:[^)\s]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return s.replace(/\u0000CS(\d+)\u0000/g, (m, i) => '<code>' + spans[+i] + '</code>');
}

function renderMarkdown(src, opts) {
  if (!src || !src.trim()) return '<p class="empty-preview">（无内容）</p>';
  const blankLines = !!(opts && opts.blankLines); // 覆盖编辑态：空行输出占位 div，保证与 textarea 行对齐

  // 先按原始文本识别块级结构（避免 HTML 转义破坏 >、# 等标记），
  // 再对每个片段 esc() + inlineMd()，保证输出安全且内联语法可用。
  // 同时按“源行”累计每个块在原文中的字符偏移（data-off），供点击定位到原文光标。
  const lines = src.split('\n');
  let html = '';
  let list = null;      // 'ul' | 'ol' | null（当前列表容器）
  let para = [];        // 段落缓冲
  let paraOffset = 0;   // 段落首行的源偏移
  let lineStart = 0;    // 当前行的源偏移（逐行累计）
  let i = 0;

  const closeList = () => { if (list) { html += '</' + list + '>'; list = null; } };
  const flushPara = () => {
    if (para.length) {
      html += '<p data-off="' + paraOffset + '">' + inlineMd(para.map(esc).join('<br>')) + '</p>';
      para = [];
    }
  };

  while (i < lines.length) {
    const raw = lines[i];
    const curOffset = lineStart;
    lineStart += raw.length + 1; // 本行处理完后累计下一行偏移（\n 占 1）

    // 围栏式代码块（跨行累积；contenteditable 模式下无需围栏行占位，pre 本身对应整块）
    // 语言标识保留进 data-lang（反序列化还原，避免围栏相邻删除丢数据）
    if (/^\s*```/.test(raw)) {
      flushPara(); closeList();
      const langMatch = raw.match(/^\s*```([^\s`]*)/);
      const lang = langMatch ? langMatch[1] : '';
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buf.push(lines[i]);
        lineStart += lines[i].length + 1;
        i++;
      }
      if (i < lines.length) { lineStart += lines[i].length + 1; i++; } // 跳过闭合围栏
      html += '<pre data-off="' + curOffset + '"' + (lang ? ' data-lang="' + esc(lang) + '"' : '') + '><code>' + esc(buf.join('\n')) + '</code></pre>';
      continue;
    }

    const h = raw.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara(); closeList();
      const lvl = h[1].length;
      html += '<h' + lvl + ' data-off="' + curOffset + '">' + inlineMd(esc(h[2])) + '</h' + lvl + '>';
      i++; continue;
    }

    // 分割线：--- / *** / ___（三个相同标记符，可选空格分隔）
    if (/^\s*([-*_])\s*\1\s*\1\s*$/.test(raw)) {
      flushPara(); closeList();
      html += '<hr data-off="' + curOffset + '">';
      i++; continue;
    }

    const ul = raw.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) {
      flushPara();
      if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; }
      html += '<li data-off="' + curOffset + '">' + inlineMd(esc(ul[1])) + '</li>';
      i++; continue;
    }

    const ol = raw.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) {
      flushPara();
      if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; }
      html += '<li data-off="' + curOffset + '">' + inlineMd(esc(ol[1])) + '</li>';
      i++; continue;
    }

    const bq = raw.match(/^>\s?(.*)$/);
    if (bq) {
      flushPara(); closeList();
      html += '<blockquote data-off="' + curOffset + '">' + inlineMd(esc(bq[1])) + '</blockquote>';
      i++; continue;
    }

    if (!raw.trim()) { flushPara(); closeList(); if (blankLines) html += '<div class="md-blank"></div>'; i++; continue; }

    if (!para.length) paraOffset = curOffset; // 记录段落首行源偏移
    para.push(raw);
    i++;
  }
  flushPara();
  closeList();
  return html;
}

/* ================= 全局状态 ================= */

const state = {
  notes: [],
  currentId: null,
  query: '',
  activeTag: '全部',
  loaded: false,

  // 编辑器保存状态
  dirty: false,        // 有未保存修改
  saving: false,       // PUT 请求进行中
  saveTimer: null,     // 防抖定时器
  lastSavedAt: null,

  // 复盘会话
  review: null,        // { sessionId, question, qIndex, correctCount, answered, done, nextQuestion, verdict }
  report: null,

  // 设置
  settings: null,
  providers: [],
  clearKey: false,     // 用户点击了"清除"API Key
  lastProvider: '',    // 设置页上一次选中的 provider（custom 表单缓存用）
  formCache: { baseURL: '', model: '' },

  // 复盘历史记录（设置 → 复盘历史记录 Tab）
  history: null,       // 历史列表 [{id, noteTitle, total, correct, partial, wrong, accuracy, finishedAt, ...}]
  historyDetail: null, // 当前查看的详情记录
  historyLoaded: false,// 历史是否已加载（懒加载标记）

  // 回收站（设置 → 回收站 Tab）
  trash: null,         // 回收站列表 [{id, title, deletedAt, summary, ...}]

  // 编辑器视图状态
  previewScroll: 0,    // 渲染层滚动位置记忆（保留字段，兼容旧引用）
  toc: [],             // 当前笔记目录（{level,text,off}[]）
  tocSig: '',          // 目录签名（守卫：标题结构未变不重建）
  sortMode: localStorage.getItem('noteapp.sortMode') || 'time', // time | az | custom
};

let lastEditEnd = 0;   // 覆盖编辑记忆的选区终点（配合 lastEditOffset）

const getNote = (id) => state.notes.find((n) => n.id === id);

/** 兼容两种响应形态：{note: {...}}（后端实际实现）与直接返回笔记（契约描述） */
const unwrapNote = (data) => (data && typeof data === 'object' && data.note !== undefined ? data.note : data);

/* ================= 数据加载 ================= */

async function loadNotes() {
  try {
    const data = await api('/api/notes');
    state.notes = data.notes || [];
    state.loaded = true;
    sortNotes();
    renderNoteList();
    renderTags();
    $('#mainLoading').classList.add('hidden');
    if (state.notes.length) {
      await selectNote(state.notes[0].id, { saveCurrent: false });
    } else {
      showEmpty();
    }
  } catch (e) {
    $('#mainLoading').classList.add('hidden');
    $('#noteList').innerHTML =
      '<div class="list-empty error" id="retryLoad">加载失败：' + esc(e.message) + '<br>点此重试</div>';
    $('#retryLoad').addEventListener('click', loadNotes);
  }
}

/* ================= 列表 / 标签 / 搜索 ================= */

function sortNotes() {
  const mode = state.sortMode;
  if (mode === 'az') {
    state.notes.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'zh'));
  } else if (mode === 'custom') {
    state.notes.sort((a, b) => {
      const oa = a.order != null ? a.order : Number.MAX_SAFE_INTEGER;
      const ob = b.order != null ? b.order : Number.MAX_SAFE_INTEGER;
      if (oa !== ob) return oa - ob;
      return noteTime(b) - noteTime(a); // 未设置 order 的旧笔记按时间兜底
    });
  } else {
    state.notes.sort((a, b) => noteTime(b) - noteTime(a));
  }
}

function filteredNotes() {
  const q = state.query.trim().toLowerCase();
  return state.notes
    .filter((n) => state.activeTag === '全部' || (n.tags || []).includes(state.activeTag))
    .filter((n) =>
      !q ||
      String(n.title || '').toLowerCase().includes(q) ||
      String(n.content || '').toLowerCase().includes(q)
    );
}

function renderNoteList() {
  const list = $('#noteList');
  if (!state.loaded) {
    list.innerHTML = '<div class="skeleton"></div>'.repeat(6);
    return;
  }
  const notes = filteredNotes();
  if (!notes.length) {
    list.innerHTML = '<div class="list-empty">' +
      (state.notes.length ? '无匹配结果' : '暂无笔记，点击下方「新建笔记」') +
      '</div>';
    return;
  }
  list.innerHTML = notes.map((n) => {
    const title = (n.title || '').trim();
    const tagChips = (n.tags || []).slice(0, 3).map((t) =>
      '<span class="note-tag" title="' + esc(t) + '">' + esc(t) + '</span>'
    ).join('');
    const more = (n.tags || []).length > 3
      ? '<span class="note-tag" title="' + esc((n.tags || []).slice(3).join(', ')) + '">+' + ((n.tags || []).length - 3) + '</span>'
      : '';
    return '<div class="note-item' + (n.id === state.currentId ? ' active' : '') + '" data-id="' + esc(n.id) + '"' +
      (state.sortMode === 'custom' ? ' draggable="true" title="拖动可排序"' : '') + '>' +
      '<div class="note-item-main">' +
        '<div class="note-item-title">' + (title ? esc(title) : '<span class="untitled">无标题</span>') + '</div>' +
        '<div class="note-item-meta">' + esc(relTime(n.updatedAt)) + tagChips + more + '</div>' +
      '</div>' +
      '<button class="note-del" type="button" title="删除笔记">🗑</button>' +
    '</div>';
  }).join('');

  $$('.note-item', list).forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.note-del')) return;
      if (state.review) { toast('复盘进行中，请先结束复盘', 'info'); return; }
      selectNote(el.dataset.id);
    });
    el.querySelector('.note-del').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteNote(el.dataset.id);
    });
  });

  const active = list.querySelector('.note-item.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function renderTags() {
  const counts = new Map();
  state.notes.forEach((n) => (n.tags || []).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
  const tags = Array.from(counts.keys()).sort((a, b) => a.localeCompare(b, 'zh'));
  const chips = [
    '<button class="tag-chip' + (state.activeTag === '全部' ? ' active' : '') + '" type="button" data-tag="全部">全部</button>',
    ...tags.map((t) =>
      '<button class="tag-chip' + (state.activeTag === t ? ' active' : '') + '" type="button" data-tag="' + esc(t) + '">' +
      esc(t) + ' <span class="tag-count">' + counts.get(t) + '</span></button>'
    ),
  ];
  $('#tagList').innerHTML = chips.join('');
  $$('.tag-chip', $('#tagList')).forEach((b) => {
    b.addEventListener('click', () => {
      if (state.review) { toast('复盘进行中，请先结束复盘', 'info'); return; }
      state.activeTag = b.dataset.tag;
      renderTags();
      renderNoteList();
    });
  });
  renderQuickTags(); // 侧边栏标签变化时同步编辑器快捷标签
}

// 编辑器快捷标签：点击添加/移除当前笔记的标签（分类用）
function renderQuickTags() {
  const box = $('#quickTags');
  if (!box) return;
  const all = Array.from(new Set(state.notes.flatMap((n) => n.tags || []))).sort((a, b) => a.localeCompare(b, 'zh'));
  if (!all.length) {
    box.innerHTML = '<span class="qt-empty">暂无标签，可在下方输入框添加</span>';
    return;
  }
  const current = new Set(parseTags($('#tagsInput').value));
  box.innerHTML = '<span class="qt-label">快捷标签：</span>' + all.map((t) =>
    '<button type="button" class="qt-chip' + (current.has(t) ? ' on' : '') + '" data-qt="' + esc(t) + '">' + esc(t) + '</button>'
  ).join('');
  $$('.qt-chip', box).forEach((b) => {
    b.addEventListener('click', () => {
      if (!state.currentId) return;
      const tags = new Set(parseTags($('#tagsInput').value));
      if (tags.has(b.dataset.qt)) tags.delete(b.dataset.qt);
      else tags.add(b.dataset.qt);
      $('#tagsInput').value = Array.from(tags).join(', ');
      $('#tagsInput').dispatchEvent(new Event('input', { bubbles: true })); // 触发自动保存
      renderQuickTags();
    });
  });
}

/* ================= 排序（时间 / A-Z / 自定义拖动） ================= */

function applySortMode(mode) {
  state.sortMode = mode;
  localStorage.setItem('noteapp.sortMode', mode);
  sortNotes();
  renderNoteList();
}

async function saveCustomOrder() {
  try {
    await api('/api/notes/reorder', { method: 'POST', body: { ids: state.notes.map((n) => n.id) } });
  } catch (e) {
    toast('排序保存失败：' + e.message, 'error');
  }
}

// 自定义排序拖拽（HTML5 DnD，桌面端）
function initDragSort() {
  const list = $('#noteList');
  let dragId = null;

  list.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.note-item');
    if (!item || state.sortMode !== 'custom') { e.preventDefault(); return; }
    if (e.target.closest('.note-del')) { e.preventDefault(); return; } // 删除按钮不触发拖拽
    dragId = item.dataset.id;
    item.classList.add('drag-src');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', dragId); } catch (_) { /* 兼容 */ }
  });

  list.addEventListener('dragover', (e) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    list.querySelectorAll('.note-item.drag-over').forEach((el) => el.classList.remove('drag-over'));
    const target = e.target.closest('.note-item');
    if (target && target.dataset.id !== dragId) target.classList.add('drag-over');
  });

  list.addEventListener('drop', (e) => {
    if (!dragId) return;
    e.preventDefault();
    const target = e.target.closest('.note-item');
    if (target && target.dataset.id !== dragId) {
      const from = state.notes.findIndex((n) => n.id === dragId);
      const to = state.notes.findIndex((n) => n.id === target.dataset.id);
      if (from >= 0 && to >= 0) {
        const [moved] = state.notes.splice(from, 1);
        state.notes.splice(to, 0, moved);
        saveCustomOrder();
        renderNoteList();
      }
    }
  });

  list.addEventListener('dragend', () => {
    dragId = null;
    list.querySelectorAll('.note-item.drag-src, .note-item.drag-over')
      .forEach((el) => el.classList.remove('drag-src', 'drag-over'));
  });
}

/* ================= 侧边栏（收起 / 展开 / 拖拽调宽） ================= */

function applySidebarPrefs() {
  // 移动端抽屉模式：不应用收起/宽度偏好（CSS 已隔离，这里双保险）
  if (window.matchMedia('(max-width: 768px)').matches) {
    $('#app').classList.remove('sidebar-collapsed');
    return;
  }
  const w = parseInt(localStorage.getItem('noteapp.sidebarW'), 10);
  if (w && w >= 180 && w <= 420) {
    document.documentElement.style.setProperty('--sidebar-w', w + 'px');
  }
  const collapsed = localStorage.getItem('noteapp.sidebarCollapsed') === '1';
  $('#app').classList.toggle('sidebar-collapsed', collapsed);
  syncCollapseBtn(collapsed);
}

/* ================= 字体大小调节 ================= */

function applyFontSize(size) {
  // 不传参：从 localStorage 读
  if (size == null) size = parseInt(localStorage.getItem('noteapp.fontSize'), 10) || 15;
  size = Math.max(12, Math.min(24, size));
  const lineHeight = 1.75;
  const blankH = 0; // 空行占位高度归零，段落间距由 CSS margin 控制（对齐 Typora）；光标可见性由 min-height 保证
  document.documentElement.style.setProperty('--editor-font-size', size + 'px');
  document.documentElement.style.setProperty('--editor-line-height', String(lineHeight));
  document.documentElement.style.setProperty('--blank-height', blankH + 'px');
  $('#fontSizeLabel').textContent = String(size);
  localStorage.setItem('noteapp.fontSize', String(size));
}

function changeFontSize(delta) {
  const cur = parseInt(localStorage.getItem('noteapp.fontSize'), 10) || 15;
  applyFontSize(cur + delta);
}

function initFontSize() {
  applyFontSize();
  $('#fontSizeDown').addEventListener('click', () => changeFontSize(-2));
  $('#fontSizeUp').addEventListener('click', () => changeFontSize(2));
}

function syncCollapseBtn(collapsed) {
  $('#collapseBtn').title = collapsed ? '展开侧边栏' : '收起侧边栏';
  $('#collapseBtn').setAttribute('aria-label', collapsed ? '展开侧边栏' : '收起侧边栏');
}

function setSidebarCollapsed(collapsed) {
  $('#app').classList.toggle('sidebar-collapsed', collapsed);
  localStorage.setItem('noteapp.sidebarCollapsed', collapsed ? '1' : '0');
  syncCollapseBtn(collapsed);
}

function initSidebar() {
  applySidebarPrefs();

  $('#collapseBtn').addEventListener('click', () => {
    setSidebarCollapsed(!$('#app').classList.contains('sidebar-collapsed'));
  });

  // 拖拽调宽（桌面端）
  const resizer = $('#sidebarResizer');
  let dragging = false;
  let startX = 0;
  let startW = 300;
  resizer.addEventListener('mousedown', (e) => {
    dragging = true;
    startX = e.clientX;
    startW = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w'), 10) || 300;
    document.body.classList.add('sidebar-resizing');
    resizer.classList.add('resizing');
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const w = Math.max(180, Math.min(420, startW + (e.clientX - startX)));
    document.documentElement.style.setProperty('--sidebar-w', w + 'px');
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('sidebar-resizing');
    resizer.classList.remove('resizing');
    const w = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w'), 10) || 300;
    localStorage.setItem('noteapp.sidebarW', String(w));
  });
}

/* ================= 笔记选择 / 视图切换 ================= */

async function selectNote(id, opts = {}) {
  const { saveCurrent = true } = opts;
  if (saveCurrent) await flushSave();

  let note = getNote(id);
  if (!note) return;

  // 防御：若列表接口未返回 content，则回退拉取单条
  if (note.content == null) {
    try {
      const full = unwrapNote(await api('/api/notes/' + id));
      const i = state.notes.findIndex((n) => n.id === id);
      if (i >= 0) state.notes[i] = Object.assign({}, note, full);
      note = state.notes[i];
    } catch (e) { /* 沿用列表数据 */ }
  }

  state.currentId = id;
  hideSummary();
  showEditor();
  fillEditor(note);
  renderNoteList();
  if (window.matchMedia('(max-width: 768px)').matches) toggleSidebar(false);
}

function showEmpty() {
  $('#emptyState').classList.remove('hidden');
  $('#editorView').classList.add('hidden');
  $('#summarizeBtn').disabled = true;
  $('#reviewBtn').disabled = true;
}

function showEditor() {
  $('#emptyState').classList.add('hidden');
  $('#editorView').classList.remove('hidden');
  $('#summarizeBtn').disabled = false;
  $('#reviewBtn').disabled = false;
}

function hideSummary() {
  $('#summaryPanel').classList.add('hidden');
}

function fillEditor(note) {
  if (mode === 'edit') syncFromRenderEdit(); // IME 组合中跳过的最后输入兜底同步（防丢）
  $('#titleInput').value = note.title || '';
  $('#contentInput').value = note.content || '';
  $('#tagsInput').value = (note.tags || []).join(', ');
  lastEditOffset = 0;
  lastEditEnd = 0;
  state.previewScroll = 0;
  state.tocSig = '';
  if (heavyRenderTimer) { clearTimeout(heavyRenderTimer); heavyRenderTimer = null; } // 大文档防抖定时器清理
  setMode('edit'); // 若已在 edit 会提前 return
  renderEditFromTextarea(null); // 无焦点加载：不置源码态（聚焦后按光标渲染）
  state.dirty = false;
  state.lastSavedAt = null;
  updateSaveStatus();
  renderQuickTags(); // 切换笔记后刷新快捷标签选中态
  toggleToc(false);   // 切换笔记后收起目录面板
  // 已有 AI 总结：直接展示；无总结则隐藏面板
  if (note.summary) {
    $('#summaryPanel').classList.remove('hidden');
    $('#summaryToggle').textContent = '收起';
    $('#summaryBody').classList.remove('hidden');
    $('#summaryBody').innerHTML = renderMarkdown(note.summary);
    $('#summarizeBtn').textContent = '🔄 重新总结';
  } else {
    hideSummary();
    $('#summarizeBtn').textContent = '✨ AI 总结';
  }
}

/* ================= 自动保存（1s 防抖） ================= */

function onEditorInput(e) {
  if (!state.currentId) return;
  state.dirty = true;
  if (state.saveTimer) clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveCurrent, 1000);
  updateSaveStatus();
  // 仅 contentInput 的输入触发编辑器重建（标题/标签输入不弹回编辑器光标）
  if (mode === 'edit' && e && e.target === $('#contentInput')) {
    // 大文档（>50KB）重建统一防抖（keydown/工具栏路径也纳入，避免每键 200ms+）
    if ($('#contentInput').value.length > 50000) {
      if (heavyRenderTimer) clearTimeout(heavyRenderTimer);
      heavyRenderTimer = setTimeout(() => {
        heavyRenderTimer = null;
        renderEditFromTextarea(lastEditOffset);
      }, 80);
    } else {
      renderEditFromTextarea(lastEditOffset);
    }
  }
}

async function saveCurrent(opts = {}) {
  const { silent = false } = opts;
  if (!state.currentId || !state.dirty) return;
  if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }

  const note = getNote(state.currentId);
  if (!note) return;

  const payload = {
    title: $('#titleInput').value.trim(),
    content: $('#contentInput').value,
    tags: parseTags($('#tagsInput').value),
  };

  state.saving = true;
  updateSaveStatus();
  try {
    const saved = unwrapNote(await api('/api/notes/' + state.currentId, { method: 'PUT', body: payload }));
    Object.assign(note, saved);
    state.dirty = false;
    state.lastSavedAt = Date.now();
    sortNotes();
    renderNoteList();
    renderTags();
    if (!silent) toast('已保存', 'success', 1400);
  } catch (e) {
    toast('保存失败：' + e.message, 'error');
    // 保存失败不重置 dirty 标记，重新启动防抖定时器允许下次重试
    state.saveTimer = setTimeout(saveCurrent, 5000);
  } finally {
    state.saving = false;
    updateSaveStatus();
  }
}

/** 切换笔记前冲刷未保存内容 */
async function flushSave() {
  if (state.dirty) await saveCurrent({ silent: true });
}

function updateSaveStatus() {
  const el = $('#saveStatus');
  el.className = 'save-status';
  if (!state.currentId) { el.textContent = ''; return; }
  if (state.saving) { el.textContent = '保存中…'; el.classList.add('saving'); }
  else if (state.dirty) { el.textContent = '未保存'; el.classList.add('dirty'); }
  else { el.textContent = state.lastSavedAt ? '已保存 ' + hm(state.lastSavedAt) : '已保存'; el.classList.add('saved'); }
}

/* ================= 新建 / 删除 ================= */

async function createNote() {
  if (state.review) { toast('复盘进行中，请先结束复盘', 'info'); return; }
  await flushSave(); // 新建前冲刷当前笔记，防 1s 防抖窗口内丢输入（P1-8）
  try {
    const note = unwrapNote(await api('/api/notes', { method: 'POST', body: { title: '', content: '', tags: [] } }));
    state.notes.push(note);
    sortNotes();
    renderNoteList();
    renderTags();
    await selectNote(note.id, { saveCurrent: false });
    $('#titleInput').focus();
  } catch (e) {
    toast('创建失败：' + e.message, 'error');
  }
}

async function deleteNote(id) {
  if (state.review) { toast('复盘进行中，请先结束复盘', 'info'); return; }
  const ok = await confirmDialog('删除这条笔记？笔记将移入回收站，可随时恢复（AI 总结一并保留）。', '删除');
  if (!ok) return;
  await flushSave(); // 冲刷防抖窗口内的输入，避免删除后 PUT 打在已删 id 上返回 404
  try {
    await api('/api/notes/' + id, { method: 'DELETE' });
    state.notes = state.notes.filter((n) => n.id !== id);
    renderTags();
    if (state.currentId === id) {
      state.dirty = false;
      state.currentId = null;
      hideSummary();
      if (state.notes.length) {
        await selectNote(state.notes[0].id, { saveCurrent: false });
      } else {
        showEmpty();
        renderNoteList();
      }
    } else {
      renderNoteList();
    }
    toast('已删除', 'success', 1400);
  } catch (e) {
    toast('删除失败：' + e.message, 'error');
  }
}

/* ================= 编辑 / 源码切换（Typora 式所见即所得） =================
 * 编辑模式：显示渲染文档；点击任意位置进入覆盖式编辑（textarea 叠在渲染层上），
 *           输入实时刷新渲染层，失焦 / Esc 返回渲染视图。
 * 源码模式：直接编辑 Markdown 原文。
 */

let mode = 'edit';
let lastEditOffset = 0;      // 编辑光标源码偏移记忆（用于工具栏插入/模式切换）
let composing = false;        // 中文输入法组合中（组合期间不重建渲染）

/* ================= Typora 式渲染编辑核心 =================
 * 编辑模式：contenteditable（#renderEdit）直接显示渲染 HTML，所见即光标；
 * 每次输入立即反序列化为 Markdown（可逆），重建渲染并精确恢复光标。
 */

// renderEdit DOM → Markdown 文本 + 光标源码偏移（anchorNode/anchorOffset 来自 Selection）
function htmlToMarkdown(root, anchorNode, anchorOffset) {
  let md = '';
  let caretOffset = -1;
  let pendingBoundaryStart = -1; // 元素边界待定（遍历结束后按起/终解析）
  let pendingBoundaryEnd = false;
  let pendingBoundaryBlank = false; // 边界元素是空行占位（结束边界 = 自身终点 +1，不是文档末尾）
  const walk = (node, inList, inPre) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const start = md.length;
      md += node.textContent;
      // 光标只在首次命中时记录（必须遍历完整棵树，光标后的内容不能丢）
      if (caretOffset < 0 && anchorNode === node) {
        caretOffset = start + Math.min(anchorOffset || 0, node.textContent.length);
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.classList && node.classList.contains('md-blank')) {
      // 元素边界记录（光标在空行占位元素本身，如点击空白处）
      if (caretOffset < 0 && anchorNode === node) {
        pendingBoundaryStart = md.length;
        pendingBoundaryEnd = anchorOffset >= node.childNodes.length;
        pendingBoundaryBlank = true; // 空行元素：结束边界 = 自身终点（+1），不是文档末尾
      }
      // 空行占位：无内容 → 一个换行；用户输入了内容 → 合并到上一行（软换行，不产生段落空行）
      if (!node.textContent.trim()) { md += '\n'; return; }
      node.childNodes.forEach((c) => walk(c, inList, inPre));
      md += '\n'; // 补行尾（中段空行输入后与后续行分离，不粘行）
      return;
    }
    if (node.classList && node.classList.contains('md-source')) {
      // 元素边界记录（光标在源码块元素本身）
      if (caretOffset < 0 && anchorNode === node) {
        pendingBoundaryStart = md.length;
        pendingBoundaryEnd = anchorOffset >= node.childNodes.length;
      }
      // 延迟渲染的源码块：遍历子节点（保持光标跟踪），文本即源码片段（浏览器已解码实体）
      node.childNodes.forEach((c) => walk(c, inList, inPre));
      md += '\n'; // 补块尾行尾（源码切片已去尾换行，保证块边界在往返中不丢失）
      return;
    }
    if (caretOffset < 0 && anchorNode === node) {
      // 光标在元素边界：anchorOffset 0 → 元素起始；>= 子节点数 → 元素结束（遍历结束后解析）
      pendingBoundaryStart = md.length;
      pendingBoundaryEnd = anchorOffset >= node.childNodes.length;
      // 空元素（无子节点）：结束边界 = 自身起始（防止点击空块时光标被解析到文档末尾）
      pendingBoundaryBlank = node.childNodes.length === 0;
    }
    const tag = node.tagName;
    if (tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4' || tag === 'H5' || tag === 'H6') {
      md += '#'.repeat(parseInt(tag[1], 10)) + ' ';
      // 空标题：光标直接映射到标记后（`# ` 之后），避免边界解析到文末或标记前
      if (caretOffset < 0 && anchorNode === node && !node.childNodes.length) caretOffset = md.length;
      node.childNodes.forEach((c) => walk(c, inList, inPre));
      md += '\n';
    } else if (tag === 'P') {
      node.childNodes.forEach((c) => walk(c, inList, inPre));
      md += '\n';
    } else if (tag === 'UL' || tag === 'OL') {
      const ol = tag === 'OL';
      node.childNodes.forEach((c) => walk(c, ol, inPre));
    } else if (tag === 'LI') {
      md += inList ? '1. ' : '- ';
      // 空列表项：光标直接映射到标记后（`- ` 之后），防止边界解析到文末或标记前
      if (caretOffset < 0 && anchorNode === node && !node.childNodes.length) caretOffset = md.length;
      node.childNodes.forEach((c) => walk(c, inList, inPre));
      md += '\n';
    } else if (tag === 'BLOCKQUOTE') {
      md += '> ';
      // 空引用：光标直接映射到标记后（`> ` 之后）
      if (caretOffset < 0 && anchorNode === node && !node.childNodes.length) caretOffset = md.length;
      node.childNodes.forEach((c) => walk(c, inList, inPre));
      md += '\n';
    } else if (tag === 'HR') {
      md += '---\n';
      // 分割线不可编辑：点击后光标映射到其后
      if (caretOffset < 0 && anchorNode === node) caretOffset = md.length;
    } else if (tag === 'IMG') {
      // 图片往返：与渲染正则字符数对称（![ + alt + ]( + src + ) = 5 + alt + src）
      md += '![' + (node.getAttribute('alt') || '') + '](' + (node.getAttribute('src') || '') + ')';
      if (caretOffset < 0 && anchorNode === node) caretOffset = md.length;
    } else if (tag === 'PRE') {
      // 语言标识还原（围栏相邻删除等场景下数据不丢）
      const lang = node.getAttribute && node.getAttribute('data-lang');
      md += '```' + (lang || '') + '\n';
      node.childNodes.forEach((c) => walk(c, inList, true));
      md += '\n```\n'; // 闭合围栏行尾（行结构完整，尾部由裁剪归一）
    } else if (tag === 'BR') {
      md += '\n';
    } else if (tag === 'DIV') {
      node.childNodes.forEach((c) => walk(c, inList, inPre));
      md += '\n';
    } else if (tag === 'STRONG') {
      md += '**';
      node.childNodes.forEach((c) => walk(c, inList, inPre));
      md += '**';
    } else if (tag === 'EM') {
      md += '*';
      node.childNodes.forEach((c) => walk(c, inList, inPre));
      md += '*';
    } else if (tag === 'CODE') {
      if (inPre) { node.childNodes.forEach((c) => walk(c, inList, true)); }
      else { md += '`'; node.childNodes.forEach((c) => walk(c, inList, inPre)); md += '`'; }
    } else if (tag === 'A') {
      md += '[';
      node.childNodes.forEach((c) => walk(c, inList, inPre));
      md += '](' + (node.getAttribute('href') || '') + ')';
    } else {
      node.childNodes.forEach((c) => walk(c, inList, inPre));
    }
  };
  root.childNodes.forEach((c) => walk(c, false, false));
  // 先裁掉最后一个结构终止换行（块尾行尾），元素边界解析必须用裁剪后的 md.length
  md = md.replace(/\n$/, '');
  // 元素边界（anchor 是元素节点）：anchorOffset 0 → 元素起始；否则 → 元素结束
  // 空行元素结束边界 = 空行起始（不 +1，防止落入下一块区间误归属，如图 2）
  if (caretOffset < 0 && pendingBoundaryStart >= 0) {
    caretOffset = pendingBoundaryEnd
      ? (pendingBoundaryBlank ? pendingBoundaryStart : md.length)
      : pendingBoundaryStart;
  }
  // 光标在根容器边界（如 selectNodeContents 后）：映射到文档末尾
  if (caretOffset < 0 && anchorNode === root) caretOffset = md.length;
  // 防御：偏移不得超过文档长度（元素边界解析可能越界）
  if (caretOffset > md.length) caretOffset = md.length;
  return { md, caretOffset };
}

// 源码偏移 → renderEdit DOM 位置（与 htmlToMarkdown 对称的偏移累计）
function locateOffset(root, targetOffset) {
  let acc = 0;
  let hit = null;
  let lastText = null;   // 兜底：最近的文本节点
  let lastEl = null;     // 兜底：最后遇到的元素节点（空行占位/空块等）
  const visit = (node, inList, inPre) => {
    if (hit) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent;
      lastText = node;
      if (targetOffset >= acc && targetOffset <= acc + t.length) {
        hit = { node, offset: Math.min(targetOffset - acc, t.length) };
        return;
      }
      acc += t.length;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    lastEl = node;
    if (node.classList && node.classList.contains('md-blank')) {
      // 空行命中：光标定位到占位内（Enter 后落在新空行，可继续输入）
      if (targetOffset >= acc && targetOffset < acc + 1) {
        hit = { node, offset: 0 };
        return;
      }
      // 带内容（用户输入后合并为软换行）：按文本遍历，补行尾换行（与 htmlToMarkdown 对称）
      if (node.textContent.trim()) {
        for (const c of node.childNodes) visit(c, inList, inPre);
        acc += 1;
        return;
      }
      acc += 1;
      return;
    }
    if (node.classList && node.classList.contains('md-source')) {
      // 源码块：文本即源码片段，偏移对齐 data-off 后累计文本长度；补块尾行尾（与 htmlToMarkdown 对称）
      const base = parseInt(node.dataset.off, 10) || 0;
      acc = base; // 无条件对齐（防 acc>base 时漂移）
      for (const c of node.childNodes) visit(c, inList, inPre);
      acc += 1;
      return;
    }
    const tag = node.tagName;
    if (tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4' || tag === 'H5' || tag === 'H6') {
      acc += parseInt(tag[1], 10) + 1;
      for (const c of node.childNodes) visit(c, inList, inPre);
      acc += 1;
    } else if (tag === 'P') {
      for (const c of node.childNodes) visit(c, inList, inPre);
      acc += 1;
    } else if (tag === 'UL' || tag === 'OL') {
      const ol = tag === 'OL';
      for (const c of node.childNodes) visit(c, ol, inPre);
    } else if (tag === 'LI') {
      acc += inList ? 3 : 2;
      for (const c of node.childNodes) visit(c, inList, inPre);
      acc += 1;
    } else if (tag === 'BLOCKQUOTE') {
      acc += 2;
      for (const c of node.childNodes) visit(c, inList, inPre);
      acc += 1;
    } else if (tag === 'HR') {
      acc += 4; // '---' + '\n'
    } else if (tag === 'IMG') {
      const alt = node.getAttribute('alt') || '';
      const src = node.getAttribute('src') || '';
      const len = 5 + alt.length + src.length; // 与 htmlToMarkdown 对称
      // 光标偏移落在图片语法区间内 → 命中图片元素本身（供渲染时替换为源码 span 编辑）
      if (targetOffset >= acc && targetOffset <= acc + len) {
        hit = { node, offset: 0 };
        return;
      }
      acc += len;
    } else if (tag === 'PRE') {
      const lang = node.getAttribute && node.getAttribute('data-lang');
      acc += 4 + (lang ? lang.length : 0); // '```' + lang + '\n'
      for (const c of node.childNodes) visit(c, inList, true);
      acc += 5; // '\n```\n'
    } else if (tag === 'BR') {
      acc += 1;
    } else if (tag === 'DIV') {
      for (const c of node.childNodes) visit(c, inList, inPre);
      acc += 1;
    } else if (tag === 'STRONG') {
      acc += 2;
      for (const c of node.childNodes) visit(c, inList, inPre);
      acc += 2;
    } else if (tag === 'EM') {
      acc += 1;
      for (const c of node.childNodes) visit(c, inList, inPre);
      acc += 1;
    } else if (tag === 'CODE') {
      if (inPre) { for (const c of node.childNodes) visit(c, inList, true); }
      else { acc += 1; for (const c of node.childNodes) visit(c, inList, inPre); acc += 1; }
    } else if (tag === 'A') {
      acc += 1;
      for (const c of node.childNodes) visit(c, inList, inPre);
      acc += 2 + (node.getAttribute('href') || '').length + 1;
    } else {
      for (const c of node.childNodes) visit(c, inList, inPre);
    }
  };
  visit(root, false, false);
  // 未命中：偏移在文档末尾且最后元素为空内容（空行占位）时定位到该元素，否则兜底最近文本节点
  if (!hit && targetOffset >= acc && lastEl && !lastEl.textContent.trim()) {
    hit = { node: lastEl, offset: 0 };
  }
  if (!hit && lastText) hit = { node: lastText, offset: lastText.textContent.length };
  return hit; // 仍为 null → 调用方跳过恢复
}

// 编辑模式：contentInput → renderEdit 重建渲染 + 恢复光标（diff：内容未变不重建）
// 行内标记元素 → Markdown 源码（strong/em/code/a）
function inlineToSource(el) {
  const text = el.textContent;
  const tag = el.tagName;
  if (tag === 'STRONG') return '**' + text + '**';
  if (tag === 'EM') return '*' + text + '*';
  if (tag === 'CODE') return '`' + text + '`';
  if (tag === 'A') return '[' + text + '](' + (el.getAttribute('href') || '') + ')';
  if (tag === 'IMG') return '![' + (el.getAttribute('alt') || '') + '](' + (el.getAttribute('src') || '') + ')';
  return text;
}

function renderEditFromTextarea(offset) {
  const re = $('#renderEdit');
  if (!re || mode !== 'edit') return;
  const md = $('#contentInput').value;
  // 仅真正空文档才留空（纯空白内容不清零）；空文档由 CSS :empty 显示占位
  // 空白文档（含纯空白）不渲染占位，避免 empty-preview 文本进入正文；由 CSS :empty 显示占位
  let html = md.trim() === '' ? '' : renderMarkdown(md, { blankLines: true });
  // Typora 式延迟渲染：光标所在块显示 Markdown 源码（输入 #/** 时先看到字符），其他块保持渲染
  if (offset != null && md) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const blocks = $$('[data-off]', tmp).sort((a, b) => (parseInt(a.dataset.off, 10) || 0) - (parseInt(b.dataset.off, 10) || 0));
    let start = -1;
    for (let i = 0; i < blocks.length; i++) {
      const off = parseInt(blocks[i].dataset.off, 10) || 0;
      const next = i + 1 < blocks.length ? (parseInt(blocks[i + 1].dataset.off, 10) || 0) : md.length;
      // 块归属含上界：光标在空行/块间空白时不归属任何块（不替换，保持渲染）
      if (off <= offset && offset < next) {
        // 光标在空行（前一字符与后一字符都是换行，或后无字符）→ 不归属
        const atBlank = offset > off && md[offset - 1] === '\n' && (md[offset] === '\n' || offset >= md.length);
        if (!atBlank) { start = off; break; }
      }
    }
    // 光标在文档末尾且末尾不是换行（紧贴最后块文本，如输入 '# ' 未回车时）：归属最后块显示源码
    if (start < 0 && offset >= md.length && !md.endsWith('\n') && blocks.length) {
      start = parseInt(blocks[blocks.length - 1].dataset.off, 10) || 0;
    }
    if (start >= 0) {
      let nextOff = md.length;
      for (const b of blocks) {
        const off = parseInt(b.dataset.off, 10) || 0;
        if (off > start) { nextOff = off; break; }
      }
      // 块源码（去掉尾部行尾换行，保持块内多行）
      const source = md.slice(start, nextOff).replace(/\n+$/, '');
      const target = tmp.querySelector('[data-off="' + start + '"]');
      if (target) {
        // Typora 机制：有标记块（标题/列表/引用/代码块）整块显示源码；普通段落保持渲染
        const MARKED = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE'];
        if (MARKED.includes(target.tagName)) {
          if (source !== '') {
            // 保留原标签（li/blockquote/pre/h 结构不破坏，浏览器不会把元素移出容器）
            target.className = 'md-source';
            target.setAttribute('data-off', String(start));
            target.textContent = source; // textContent 自动转义，浏览器解码后是原始 markdown 字符
          }
        } else if (target.tagName === 'P') {
          // 普通段落：保持渲染，仅光标所在的行内标记（strong/em/code/a/img）临时显示源码字符
          const caretNode = locateOffset(tmp, Math.max(0, Math.min(offset, md.length)));
          if (caretNode && caretNode.node) {
            let el = caretNode.node.nodeType === Node.TEXT_NODE ? caretNode.node.parentElement : caretNode.node;
            while (el && el !== target) {
              if (el.nodeType === Node.ELEMENT_NODE &&
                  (['STRONG', 'EM', 'CODE', 'A', 'IMG'].includes(el.tagName) ||
                   el.classList.contains('md-inline-src'))) break;
              el = el.parentElement;
            }
            if (el && el !== target &&
                (['STRONG', 'EM', 'CODE', 'A', 'IMG'].includes(el.tagName) ||
                 el.classList.contains('md-inline-src'))) {
              const span = document.createElement('span');
              span.className = 'md-inline-src';
              span.textContent = inlineToSource(el);
              el.replaceWith(span);
            }
          }
        }
      }
    }
    html = tmp.innerHTML;
  }
  const changed = re.innerHTML !== html;
  if (changed) re.innerHTML = html;
  // 仅重建后恢复光标；DOM 未变时保留用户当前 Selection
  if (changed && offset != null) {
    const target = locateOffset(re, Math.max(0, Math.min(offset, md.length)));
    const node = target ? target.node : re.firstChild;
    const off = target ? target.offset : 0;
    if (node) {
      try {
        const range = document.createRange();
        if (node.nodeType === Node.TEXT_NODE) {
          range.setStart(node, Math.min(off, node.textContent.length));
        } else {
          range.setStart(node, 0);
        }
        range.collapse(true);
        // innerHTML 替换导致 contenteditable 失焦：先 focus，再拿全新 Selection 设光标
        if (document.activeElement !== re) re.focus({ preventScroll: true });
        const freshSel = window.getSelection();
        freshSel.removeAllRanges();
        freshSel.addRange(range);
        node.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      } catch (_) { /* 定位失败忽略 */ }
    }
  }
  buildToc();
}

// 编辑模式输入入口：renderEdit → 反序列化 → contentInput（触发保存）→ 重建渲染 + 恢复光标
let heavyRenderTimer = null; // 大文档降级：防抖合并重建

function syncFromRenderEdit() {
  const re = $('#renderEdit');
  if (!re || mode !== 'edit') return;
  const sel = window.getSelection();
  const anchorNode = sel && sel.rangeCount && sel.anchorNode ? sel.anchorNode : null;
  const anchorOffset = sel && sel.rangeCount ? sel.anchorOffset : 0;
  const { md, caretOffset } = htmlToMarkdown(re, anchorNode, anchorOffset);
  const ta = $('#contentInput');
  if (md !== ta.value) {
    ta.value = md;
    const pos = Math.max(0, Math.min(caretOffset >= 0 ? caretOffset : md.length, md.length));
    ta.selectionStart = pos;
    ta.selectionEnd = pos;
    lastEditOffset = pos;
    lastEditEnd = pos;
    ta.dispatchEvent(new Event('input', { bubbles: true })); // 自动保存 + 渲染（diff 幂等）
  } else if (caretOffset >= 0) {
    lastEditOffset = caretOffset;
    lastEditEnd = caretOffset;
  }
  // 大文档（>50KB）输入重建降级为 80ms 防抖，避免每键 200ms+ 卡顿
  if (ta.value.length > 50000) {
    if (heavyRenderTimer) clearTimeout(heavyRenderTimer);
    heavyRenderTimer = setTimeout(() => {
      heavyRenderTimer = null;
      renderEditFromTextarea(caretOffset >= 0 ? caretOffset : null);
    }, 80);
  } else {
    renderEditFromTextarea(caretOffset >= 0 ? caretOffset : null);
  }
}

function setMode(m) {
  if (m === mode) return; // 点已激活的 tab 无操作（防陈旧光标插入错位）
  mode = m;
  $$('.mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
  if (m === 'source') {
    syncFromRenderEdit(); // 编辑内容同步到 textarea（保底，输入路径已同步）
    $('#editorArea').classList.add('source-mode');
  } else {
    $('#editorArea').classList.remove('source-mode');
    // 用 textarea 当前光标（源码模式移动过光标的情况）
    const ta = $('#contentInput');
    const pos = ta.selectionStart != null ? ta.selectionStart : lastEditOffset;
    renderEditFromTextarea(pos);
    lastEditOffset = pos;
  }
}

/* ================= 目录（TOC） ================= */

function buildToc() {
  // 统一用源码临时渲染提取标题（renderEdit 中光标块可能被替换为源码，不能直接取 DOM）
  const tmp = document.createElement('div');
  tmp.innerHTML = renderMarkdown($('#contentInput').value, { blankLines: true });
  const heads = $$('h1, h2, h3', tmp);
  // 签名守卫：标题结构未变不重建（大文档性能）
  const sig = heads.map((h) => h.tagName + h.dataset.off + '|' + h.textContent).join('\x01');
  if (sig === state.tocSig) return;
  state.tocSig = sig;
  state.toc = heads.map((h) => ({
    level: parseInt(h.tagName.slice(1), 10),
    text: h.textContent.trim(),
    off: h.dataset.off !== undefined ? parseInt(h.dataset.off, 10) || 0 : null,
  }));
  renderToc();
}

let lastTocSignature = ''; // TOC diff 守卫：内容未变不重建 DOM（防覆盖态首击死区与面板闪烁）

function renderToc() {
  const list = $('#tocList');
  if (!list) return;
  let html;
  if (!state.toc.length) {
    html = '<div class="toc-empty">暂无标题（使用 # 创建）</div>';
  } else {
    html = state.toc.map((t, i) =>
      '<button type="button" class="toc-item lv-' + t.level + '" data-toc-idx="' + i + '">' + esc(t.text) + '</button>'
    ).join('');
  }
  if (html === lastTocSignature) return; // 内容未变：不重建 innerHTML，保持已有按钮可点击
  lastTocSignature = html;
  list.innerHTML = html;
}

function toggleToc(force) {
  const panel = $('#tocPanel');
  const show = force !== undefined ? force : panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !show);
  if (show) buildToc(); // 打开时刷新（标题可能已变）
}

function tocJump(idx) {
  const t = state.toc[idx];
  if (!t || t.off === null) return;
  const ta = $('#contentInput');
  if (mode === 'source') {
    // 源码模式：preview 不可见，直接定位 textarea 光标（跳转死区修复）
    ta.focus();
    ta.setSelectionRange(t.off, t.off);
    ta.scrollTop = Math.max(0, (t.off / Math.max(1, ta.value.length)) * ta.scrollHeight - 80);
    lastEditOffset = t.off;
    lastEditEnd = t.off;
    toggleToc(false);
    return;
  }
  const el = $('#renderEdit').querySelector('[data-off="' + t.off + '"]');
  if (!el) return;
  el.scrollIntoView({ block: 'start', behavior: 'auto' });
  // 编辑模式：光标跟随到标题处，可直接继续打字
  try {
    const range = document.createRange();
    range.setStart(el, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    $('#renderEdit').focus();
  } catch (_) { /* ignore */ }
  lastEditOffset = t.off;
  lastEditEnd = t.off;
  toggleToc(false);
}

/* ================= Markdown 工具栏 ================= */

// 确保有可编辑的目标（编辑模式：把 renderEdit 光标/选区映射为 contentInput 的 selection）
function ensureCaretTarget() {
  const ta = $('#contentInput');
  if (mode === 'source') {
    ta.focus();
    return ta;
  }
  // 编辑模式：先同步 renderEdit → contentInput，再取光标/选区源码偏移（anchor+focus 双向）
  syncFromRenderEdit();
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    const re = $('#renderEdit');
    const len = ta.value.length;
    // 全选（Selection 覆盖全部可见内容，含根级 anchor）→ 整篇选区（range.toString 不裁剪尾空白）
    const selText = sel && sel.rangeCount ? sel.getRangeAt(0).toString() : '';
    if (selText && selText.length >= (re.textContent || '').length && re.textContent) {
      ta.selectionStart = 0;
      ta.selectionEnd = len;
      lastEditOffset = 0;
      lastEditEnd = len;
      return ta;
    }
    const a = htmlToMarkdown(re, sel.anchorNode, sel.anchorOffset).caretOffset;
    const f = htmlToMarkdown(re, sel.focusNode, sel.focusOffset).caretOffset;
    const o1 = a >= 0 ? Math.min(a, len) : len;
    const o2 = f >= 0 ? Math.min(f, len) : len;
    ta.selectionStart = Math.min(o1, o2);
    ta.selectionEnd = Math.max(o1, o2);
    lastEditOffset = ta.selectionStart;
    lastEditEnd = ta.selectionEnd;
  } else {
    const pos = Math.max(0, Math.min(lastEditOffset, ta.value.length));
    ta.selectionStart = pos;
    ta.selectionEnd = pos;
  }
  return ta;
}

const MD_RULES = {
  bold:      { inline: true,  before: '**', after: '**', sel: '加粗文字' },
  italic:    { inline: true,  before: '*',  after: '*',  sel: '斜体文字' },
  h1:        { line: '# ' },
  h2:        { line: '## ' },
  h3:        { line: '### ' },
  ul:        { line: '- ' },
  ol:        { line: '1. ' },
  quote:     { line: '> ' },
  code:      { inline: true,  before: '`', after: '`', sel: '代码' },
  codeblock: { block: '```\n', blockEnd: '\n```' },
  link:      { inline: true,  before: '[', middle: '](https://', after: ')', sel: '链接文字', sel2: 'example.com' },
  image:     { inline: true,  before: '![', middle: '](https://', after: ')', sel: '图片说明', sel2: 'example.com/image.png' },
};

function toolbarInsert(md) {
  const ta = ensureCaretTarget();
  const v = ta.value;
  let start = ta.selectionStart != null ? ta.selectionStart : v.length;
  let end = ta.selectionEnd != null ? ta.selectionEnd : v.length;

  // 分割线：始终独立成行
  if (md === 'hr') {
    const lineStart = v.lastIndexOf('\n', start - 1) + 1;
    const atLineStart = lineStart === start;
    const insertion = (atLineStart ? '' : '\n') + '---\n';
    ta.value = v.slice(0, start) + insertion + v.slice(end);
    ta.setSelectionRange(start + insertion.length, start + insertion.length);
    lastEditOffset = start + insertion.length;
    lastEditEnd = lastEditOffset;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  const rule = MD_RULES[md];
  if (!rule) return;

  // 行级语法：光标所在行行首插入（若已存在该标记则移除，形成开关）
  // 标题切换：已有其他级别标题时，替换为新级别（而非叠加成 ## # 1）
  if (rule.line !== undefined) {
    const lineStart = v.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = v.indexOf('\n', end);
    const lineEndPos = lineEnd === -1 ? v.length : lineEnd;
    let line = v.slice(lineStart, lineEndPos);
    const marker = rule.line;
    // 标题级别切换：先剥离已有标题标记（任意级别），再判断是否与新标记相同
    if (/^#{1,6}\s/.test(marker) && /^#{1,6}\s/.test(line)) {
      const stripped = line.replace(/^#{1,6}\s/, '');
      if (line.startsWith(marker)) {
        // 同级别：移除标记（关闭标题）
        line = stripped;
      } else {
        // 不同级别：替换为新的标题标记
        line = marker + stripped;
      }
    } else if (line.startsWith(marker)) {
      line = line.slice(marker.length);
    } else {
      line = marker + line;
    }
    ta.value = v.slice(0, lineStart) + line + v.slice(lineEndPos);
    // 光标定位到新行行末（不选中），用户可直接追加输入
    ta.setSelectionRange(lineStart + line.length, lineStart + line.length);
    lastEditOffset = ta.selectionStart;
    lastEditEnd = ta.selectionEnd;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  // 整块包裹（代码块；光标不在行首时先换行，保证独立成行）
  if (rule.block !== undefined) {
    const selected = v.slice(start, end) || '代码';
    const lineStart2 = v.lastIndexOf('\n', start - 1) + 1;
    const needsBreak = start === end && start > 0 && lineStart2 < start && v.slice(lineStart2, start).trim() !== '';
    const lead = needsBreak ? '\n' : '';
    const insertion = lead + rule.block + selected + (rule.blockEnd || '');
    ta.value = v.slice(0, start) + insertion + v.slice(end);
    ta.setSelectionRange(start + lead.length + rule.block.length, start + lead.length + rule.block.length + selected.length);
    lastEditOffset = ta.selectionStart;
    lastEditEnd = ta.selectionEnd;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  // 行内包裹
  const before = rule.before || '';
  const after = rule.after || '';
  const middle = rule.middle || '';
  const selText = v.slice(start, end) || (rule.sel || '文字');
  const tailText = rule.sel2 || '';
  const insertion = before + selText + middle + tailText + after;
  ta.value = v.slice(0, start) + insertion + v.slice(end);
  const selStart = start + before.length;
  const selEnd = selStart + selText.length;
  ta.setSelectionRange(selStart, selEnd);
  lastEditOffset = ta.selectionStart;
  lastEditEnd = ta.selectionEnd;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

/* ================= AI 总结 ================= */

async function summarize() {
  const note = getNote(state.currentId);
  if (!note) return;
  if (!note.content || !note.content.trim()) { toast('这条笔记还没有内容，先写点东西吧', 'info'); return; }
  // 已有总结：确认是否重新生成（不打断用户，确认后才继续）
  if (note.summary) {
    const ok = await confirmDialog('此笔记已经总结，是否重新生成总结？', '重新生成');
    if (!ok) return;
  }
  await flushSave(); // 冲刷防抖窗口内的输入，确保总结基于最新内容（后端按保存后的内容总结）
  const targetId = state.currentId;
  const prevSummary = note.summary || '';
  const btn = $('#summarizeBtn');
  btn.disabled = true;
  btn.textContent = '⏳ 总结中…';
  $('#summaryPanel').classList.remove('hidden');
  $('#summaryBody').classList.remove('hidden');
  $('#summaryToggle').textContent = '收起';
  $('#summaryBody').innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div>';
  try {
    const data = await api('/api/ai/summarize', { method: 'POST', body: { noteId: targetId } });
    note.summary = data.summary || ''; // 同步本地状态（后端已持久化）
    if (state.currentId !== targetId) return; // 总结期间切走了笔记，不污染当前面板
    $('#summaryBody').innerHTML = renderMarkdown(data.summary || '（没有返回内容）');
  } catch (e) {
    if (state.currentId !== targetId) return;
    // 生成失败：恢复旧总结（如有），避免 loading/错误态覆盖已保存内容
    if (prevSummary) {
      $('#summaryBody').innerHTML = renderMarkdown(prevSummary);
      $('#summaryBody').classList.remove('hidden');
      $('#summaryToggle').textContent = '收起';
    } else {
      $('#summaryBody').innerHTML = '<div class="error-box">总结失败：' + esc(e.message) + '</div>';
    }
  } finally {
    btn.disabled = false;
    btn.textContent = note.summary ? '🔄 重新总结' : '✨ AI 总结';
  }
}

/* ================= 提问式复盘 =================
   状态机：idle → start 请求 → 答题中(第 qIndex 题) → 已作答(展示评判) → 下一题 / 结束 → 报告 → idle
   状态全部集中在 state.review，视图是它的投影。 */

async function startReview() {
  // 按标签组复盘：当前选中的标签（"全部"时提示先选标签组）
  const tag = state.activeTag === '全部' ? '' : state.activeTag;
  if (!tag) {
    toast('请先在侧边栏选择一个标签组，再开始复盘', 'info');
    return;
  }
  const groupNotes = state.notes.filter((n) => (n.tags || []).includes(tag));
  if (!groupNotes.length) { toast('该标签组下没有笔记', 'info'); return; }
  const ok = await confirmDialog('即将对标签组「' + tag + '」进行复盘（共 ' + groupNotes.length + ' 篇笔记），是否开始？', '开始复盘');
  if (!ok) return;
  await flushSave(); // 冲刷防抖窗口内的输入，确保复盘基于最新笔记内容

  const btn = $('#reviewBtn');
  btn.disabled = true;
  btn.textContent = '⏳ 准备中…';
  try {
    const data = await api('/api/ai/review/start', { method: 'POST', body: { tag } });
    state.review = {
      sessionId: data.sessionId,
      question: data.question,
      qIndex: 1,
      correctCount: 0,
      answered: 0,
      done: false,
      nextQuestion: null,
      verdict: null,
      noteTitle: data.noteTitle || (getNote(state.currentId) || {}).title || '',
    };
    state.report = null;
    openReviewView();
  } catch (e) {
    toast('开始复盘失败：' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🧠 开始复盘';
  }
}

function openReviewView() {
  $('#editorView').classList.add('hidden');
  $('#emptyState').classList.add('hidden');
  $('#reviewView').classList.remove('hidden');
  $('#reviewReportStage').classList.add('hidden');
  $('#reviewQuestionStage').classList.remove('hidden');
  $('#summarizeBtn').disabled = true;
  $('#reviewBtn').disabled = true;
  const note = getNote(state.currentId);
  const title = (state.review && state.review.noteTitle) || (note ? note.title : '') || '';
  $('#reviewNoteTitle').textContent = title ? '「' + title + '」' : '';
  renderReviewQuestion();
}

function renderReviewQuestion() {
  const r = state.review;
  $('#reviewQuestionCard').innerHTML =
    '<div class="review-q-label">问题 ' + r.qIndex + '</div>' +
    '<div class="review-q-text">' + esc(r.question || '（无问题内容）') + '</div>';
  $('#reviewProgress').textContent = '第 ' + r.qIndex + ' 题 · 已答对 ' + r.correctCount + ' 题';
  $('#reviewAnswerInput').value = '';
  $('#verdictArea').classList.add('hidden');
  $('#submitAnswerBtn').disabled = false;
  $('#reviewAnswerInput').focus();
}

async function submitAnswer() {
  const r = state.review;
  if (!r) return;
  const answer = $('#reviewAnswerInput').value.trim();
  if (!answer) { toast('请先输入你的回答', 'info'); return; }

  const btn = $('#submitAnswerBtn');
  btn.disabled = true;
  btn.textContent = '⏳ 评判中…';
  try {
    const data = await api('/api/ai/review/answer', {
      method: 'POST',
      body: { sessionId: r.sessionId, answer },
    });
    r.answered++;
    r.verdict = data.verdict || {};
    if (r.verdict.correct === 'yes') r.correctCount++;
    r.done = !!data.done;
    r.nextQuestion = data.nextQuestion || null;
    if (data.stats) {
      // 后端实际返回 {yes,partial,no}；契约描述为 {correct}，两种都兼容
      if (typeof data.stats.yes === 'number') r.correctCount = data.stats.yes;
      else if (typeof data.stats.correct === 'number') r.correctCount = data.stats.correct;
    }
    showVerdict(data);
  } catch (e) {
    toast('提交失败：' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = '提交回答';
  }
}

function showVerdict(data) {
  const v = state.review.verdict || {};
  const map = {
    yes: { label: '✅ 回答正确', cls: 'yes' },
    partial: { label: '⚠️ 部分正确', cls: 'partial' },
    no: { label: '❌ 回答不对', cls: 'no' },
  };
  const m = map[v.correct] || map.no;
  $('#verdictBadge').className = 'verdict-badge ' + m.cls;
  $('#verdictBadge').textContent = m.label;

  $('#verdictComment').innerHTML = renderMarkdown(v.comment || '（没有评语）');

  let ref = v.reference || '';
  if (Array.isArray(ref)) ref = ref.join('\n\n');
  $('#referenceBody').innerHTML = ref ? renderMarkdown(ref) : '<p class="muted">（无参考要点）</p>';
  $('#referenceBody').classList.add('hidden');
  $('#referenceToggle').textContent = '📎 参考要点（引用笔记原文）';

  $('#verdictArea').classList.remove('hidden');
  $('#submitAnswerBtn').disabled = true;
  $('#submitAnswerBtn').textContent = '提交回答';

  const r = state.review;
  $('#reviewProgress').textContent = '第 ' + r.qIndex + ' 题 · 已答对 ' + r.correctCount + ' 题';
  if (r.done) {
    $('#showReportBtn').classList.remove('hidden');
    $('#nextQuestionBtn').classList.add('hidden');
  } else {
    $('#showReportBtn').classList.add('hidden');
    $('#nextQuestionBtn').classList.remove('hidden');
  }
}

function nextQuestion() {
  const r = state.review;
  if (!r) return;
  if (r.nextQuestion) { r.question = r.nextQuestion; r.qIndex++; }
  r.nextQuestion = null;
  r.verdict = null;
  renderReviewQuestion();
}

/** 结束复盘：showReport=true 展示报告；false 仅静默结束会话 */
async function endReview(showReport) {
  const r = state.review;
  if (!r) return;
  const btn = $('#endReviewBtn');
  btn.disabled = true;
  btn.textContent = '⏳ 生成报告中…';
  try {
    const data = await api('/api/ai/review/end', { method: 'POST', body: { sessionId: r.sessionId } });
    // 兼容两种形态：契约 {report:{...}} 与后端直接返回 report 对象
    state.report = (data && data.report) || data || {};
    if (showReport) {
      showReportView();
    } else {
      closeReviewView();
      toast('已结束复盘', 'success', 1500);
    }
  } catch (e) {
    toast('结束复盘失败：' + e.message, 'error');
    if (showReport) closeReviewView(); // 拿不到报告，别把用户困在复盘页
  } finally {
    btn.disabled = false;
    btn.textContent = '结束复盘';
  }
}

function showReportView() {
  try {
    const rep = state.report || {};
    const fallbackTotal = state.review ? state.review.answered : 0;
    $('#reportTotal').textContent = rep.total != null ? rep.total : fallbackTotal;
    $('#reportCorrect').textContent = rep.correct != null ? rep.correct : 0;
    $('#reportPartial').textContent = rep.partial != null ? rep.partial : 0;
    $('#reportWrong').textContent = rep.wrong != null ? rep.wrong : 0;

    const weak = rep.weakTopics || [];
    $('#weakTopicsBox').innerHTML = weak.length
      ? weak.map((w) => '<span class="chip">' + esc(w) + '</span>').join('')
      : '<span class="muted">暂无薄弱点，继续保持！</span>';

    // 兼容字符串与数组两种形态（后端返回数组；旧缓存可能为字符串）
    const sug = Array.isArray(rep.suggestions)
      ? rep.suggestions
      : String(rep.suggestions || '').split('\n').map((s) => s.trim()).filter(Boolean);
    $('#suggestionsList').innerHTML = sug.length
      ? sug.map((s) => '<li>' + esc(s) + '</li>').join('')
      : '<li class="muted">暂无建议</li>';

    $('#reviewQuestionStage').classList.add('hidden');
    $('#reviewReportStage').classList.remove('hidden');
  } catch (e) {
    console.error('复盘报告渲染失败', e);
    closeReviewView(); // 渲染失败强制退出复盘视图，避免困住用户
    toast('复盘报告渲染失败，已退出复盘', 'error');
  }
}

function closeReviewView() {
  $('#reviewView').classList.add('hidden');
  $('#reviewQuestionStage').classList.remove('hidden');
  $('#reviewReportStage').classList.add('hidden');
  state.review = null;
  state.report = null;
  if (getNote(state.currentId)) showEditor(); else showEmpty();
  renderNoteList();
}

/* ================= 设置 ================= */

async function openSettings() {
  state.clearKey = false;
  $('#clearKeyBtn').disabled = false;
  $('#settingsModal').classList.remove('hidden');
  switchSettingsTab('api'); // 每次打开默认回到 API 设置 Tab

  const saveBtn = $('#saveSettingsBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = '⏳ 加载中…';
  try {
    const [settings, providersData] = await Promise.all([
      api('/api/settings'),
      api('/api/providers'),
    ]);
    state.settings = settings;
    // 兼容两种形态：契约 [{...}] 与后端实际 {providers:[...]}
    state.providers = Array.isArray(providersData) ? providersData : (providersData && providersData.providers) || [];

    const sel = $('#providerSelect');
    sel.innerHTML = state.providers.length
      ? state.providers.map((p) =>
          '<option value="' + esc(p.id) + '" title="' + esc(p.note || '') + '">' + esc(p.name) + '</option>'
        ).join('')
      : '<option value="">（无可用提供商）</option>';
    sel.value = settings.provider || (state.providers[0] && state.providers[0].id) || '';

    $('#baseURLInput').value = settings.baseURL || '';
    $('#modelInput').value = settings.model || '';

    const hasKey = !!settings.hasKey;
    $('#apiKeyInput').value = '';
    $('#apiKeyInput').placeholder = hasKey ? '已配置（留空则不修改）' : 'sk-…';
    $('#clearKeyBtn').classList.toggle('hidden', !hasKey);
    state.lastProvider = settings.provider || ''; // 初始化 provider 切换基线
    state.formCache = { baseURL: '', model: '' };
    // 确保 prescription 与已保存值一致后，触发 provider 变更刷新 baseURL/model 输入框
    onProviderChange();
  } catch (e) {
    toast('加载设置失败：' + e.message, 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '保存';
  }
}

function closeSettings() {
  $('#settingsModal').classList.add('hidden');
  state.clearKey = false;
  $('#apiKeyInput').value = '';
  // 关闭时重置各 Tab 视图状态，下次打开重新从 API Tab 开始
  state.history = null;
  state.historyDetail = null;
  state.trash = null;
  $('#historyDetail').classList.add('hidden');
  $('#historyList').classList.remove('hidden');
}

/* ================= 设置 Tab 切换（API 设置 / 复盘历史记录） ================= */

function switchSettingsTab(tab) {
  const isApi = tab === 'api';
  $$('.settings-tab').forEach((b) => {
    const active = b.dataset.tab === tab;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', String(active));
  });
  $('#apiSettingsPanel').classList.toggle('hidden', !isApi);
  $('#historyPanel').classList.toggle('hidden', tab !== 'history');
  $('#trashPanel').classList.toggle('hidden', tab !== 'trash');
  // footer 按钮：仅 API Tab 显示 测试连接/保存；取消（关闭弹窗）始终可用
  $('#testConnBtn').classList.toggle('hidden', !isApi);
  $('#saveSettingsBtn').classList.toggle('hidden', !isApi);
  if (isApi) {
    $('#historyDetail').classList.add('hidden');
    $('#historyList').classList.remove('hidden');
  } else if (tab === 'history') {
    loadReviewHistory(); // 切到历史 Tab 时懒加载列表
  } else if (tab === 'trash') {
    loadTrashItems(); // 切到回收站 Tab 时懒加载列表
  }
}

/* ================= 复盘历史记录 ================= */

let historyRenderSeq = 0; // 历史列表渲染序列号（防异步竞态：旧响应不覆盖新列表）

async function loadReviewHistory() {
  const listEl = $('#historyList');
  const seq = ++historyRenderSeq;
  listEl.innerHTML = '<div class="history-empty">加载中…</div>';
  try {
    const data = await api('/api/review-history');
    if (seq !== historyRenderSeq) return; // 已被更新的请求覆盖
    state.history = data.history || [];
    renderHistoryList();
  } catch (e) {
    if (seq !== historyRenderSeq) return;
    listEl.innerHTML = '<div class="history-empty">加载失败：' + esc(e.message) + '</div>';
  }
}

function renderHistoryList() {
  const listEl = $('#historyList');
  const items = state.history || [];
  if (!items.length) {
    listEl.innerHTML = '<div class="history-empty">暂无复盘记录<br>完成一次复盘后，报告会自动保存在这里</div>';
    return;
  }
  listEl.innerHTML = items.map((h, i) => {
    const d = new Date(h.finishedAt);
    const timeStr = isNaN(d.getTime()) ? '' : d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    const accCls = h.accuracy >= 80 ? 'good' : (h.accuracy >= 50 ? 'mid' : 'bad');
    return '<button type="button" class="history-item" data-idx="' + i + '">' +
      '<div class="history-item-head">' +
        '<span class="history-item-title">' + esc(h.noteTitle || '无标题笔记') + '</span>' +
        '<span class="history-item-time">' + esc(timeStr) + '</span>' +
      '</div>' +
      '<div class="history-item-meta">共 ' + (h.total || 0) + ' 题 · 对 ' + (h.correct || 0) + ' · 部分对 ' + (h.partial || 0) + ' · 错 ' + (h.wrong || 0) + '</div>' +
      '<div class="history-item-acc ' + accCls + '">正确率 ' + (h.accuracy || 0) + '%</div>' +
    '</button>';
  }).join('');
  $$('.history-item', listEl).forEach((b) => {
    b.addEventListener('click', () => showHistoryDetail(parseInt(b.dataset.idx, 10)));
  });
}

function showHistoryDetail(idx) {
  const items = state.history || [];
  const h = items[idx];
  if (!h) return;
  state.historyDetail = h;
  $('#historyList').classList.add('hidden');
  $('#historyDetail').classList.remove('hidden');

  const accCls = h.accuracy >= 80 ? 'good' : (h.accuracy >= 50 ? 'mid' : 'bad');
  const weak = Array.isArray(h.weakTopics) ? h.weakTopics : [];
  const sug = Array.isArray(h.suggestions) ? h.suggestions : [];
  const d = new Date(h.finishedAt);
  const timeStr = isNaN(d.getTime()) ? '' : d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());

  $('#historyDetailBody').innerHTML =
    '<div class="history-detail-title">' + esc(h.noteTitle || '无标题笔记') + '</div>' +
    '<div class="history-detail-time">' + esc(timeStr) + '</div>' +
    '<div class="history-stats">' +
      '<div class="history-stat"><span class="num">' + (h.total || 0) + '</span><span class="lbl">总题数</span></div>' +
      '<div class="history-stat good"><span class="num">' + (h.correct || 0) + '</span><span class="lbl">✅ 正确</span></div>' +
      '<div class="history-stat partial"><span class="num">' + (h.partial || 0) + '</span><span class="lbl">⚠️ 部分</span></div>' +
      '<div class="history-stat bad"><span class="num">' + (h.wrong || 0) + '</span><span class="lbl">❌ 错误</span></div>' +
      '<div class="history-stat ' + accCls + '"><span class="num">' + (h.accuracy || 0) + '%</span><span class="lbl">正确率</span></div>' +
    '</div>' +
    '<div class="history-section"><div class="history-section-title">薄弱点</div>' +
      (weak.length ? weak.map((w) => '<div class="history-chip">' + esc(w) + '</div>').join('') : '<div class="muted">暂无薄弱点，继续保持！</div>') +
    '</div>' +
    '<div class="history-section"><div class="history-section-title">学习建议</div>' +
      (sug.length ? '<ul class="history-suggestions">' + sug.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ul>' : '<div class="muted">暂无建议</div>') +
    '</div>';
}

async function deleteHistoryItem() {
  const h = state.historyDetail;
  if (!h) return;
  const ok = await confirmDialog('删除这条复盘记录？删除后不可恢复。', '删除');
  if (!ok) return;
  try {
    await api('/api/review-history/' + h.id, { method: 'DELETE' });
    state.history = (state.history || []).filter((x) => x.id !== h.id);
    toast('已删除', 'success', 1400);
    state.historyDetail = null;
    $('#historyDetail').classList.add('hidden');
    $('#historyList').classList.remove('hidden');
    renderHistoryList();
  } catch (e) {
    toast('删除失败：' + e.message, 'error');
  }
}

function showHistoryList() {
  state.historyDetail = null;
  $('#historyDetail').classList.add('hidden');
  $('#historyList').classList.remove('hidden');
}

/* ================= 回收站（设置 → 回收站 Tab） ================= */

let trashSeq = 0; // 回收站列表渲染序列号（防异步竞态）

async function loadTrashItems() {
  const listEl = $('#trashList');
  const seq = ++trashSeq;
  listEl.innerHTML = '<div class="trash-empty">加载中…</div>';
  try {
    const data = await api('/api/trash');
    if (seq !== trashSeq) return;
    state.trash = data.trash || [];
    renderTrashList();
  } catch (e) {
    if (seq !== trashSeq) return;
    listEl.innerHTML = '<div class="trash-empty">加载失败：' + esc(e.message) + '</div>';
  }
}

function renderTrashList() {
  const listEl = $('#trashList');
  const items = state.trash || [];
  $('#trashCount').textContent = items.length ? '共 ' + items.length + ' 篇笔记' : '';
  $('#trashClearBtn').classList.toggle('hidden', !items.length);
  if (!items.length) {
    listEl.innerHTML = '<div class="trash-empty">回收站是空的<br>删除的笔记会先放到这里，可随时恢复（AI 总结一并保留）</div>';
    return;
  }
  listEl.innerHTML = items.map((n, i) => {
    const d = new Date(n.deletedAt);
    const timeStr = isNaN(d.getTime()) ? '' : d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    const hasSummary = !!(n.summary && n.summary.trim());
    return '<div class="trash-item">' +
      '<div class="trash-item-main">' +
        '<div class="trash-item-title">' + esc(n.title || '无标题笔记') +
          (hasSummary ? ' <span class="trash-summary-badge">已总结</span>' : '') + '</div>' +
        '<div class="trash-item-time">删除于 ' + esc(timeStr) + '</div>' +
      '</div>' +
      '<div class="trash-item-actions">' +
        '<button type="button" class="btn trash-restore" data-idx="' + i + '">恢复</button>' +
        '<button type="button" class="btn danger-ghost trash-purge" data-idx="' + i + '">彻底删除</button>' +
      '</div>' +
    '</div>';
  }).join('');
  $$('.trash-restore', listEl).forEach((b) => b.addEventListener('click', () => restoreTrashItem(parseInt(b.dataset.idx, 10))));
  $$('.trash-purge', listEl).forEach((b) => b.addEventListener('click', () => purgeTrashItem(parseInt(b.dataset.idx, 10))));
}

async function restoreTrashItem(idx) {
  const items = state.trash || [];
  const n = items[idx];
  if (!n) return;
  try {
    const data = await api('/api/trash/' + n.id + '/restore', { method: 'POST' });
    state.trash = items.filter((x) => x.id !== n.id);
    renderTrashList();
    // 恢复的笔记加入本地列表（不整表重拉，避免切走当前笔记）；summary 随笔记一并恢复
    const restored = (data && data.note) || n;
    if (!getNote(restored.id)) state.notes.push(restored);
    sortNotes();
    renderNoteList();
    renderTags();
    toast('已恢复「' + (restored.title || '无标题') + '」', 'success', 1600);
  } catch (e) {
    toast('恢复失败：' + e.message, 'error');
  }
}

async function purgeTrashItem(idx) {
  const items = state.trash || [];
  const n = items[idx];
  if (!n) return;
  const ok = await confirmDialog('彻底删除「' + (n.title || '无标题') + '」？删除后不可恢复（包括 AI 总结）。', '彻底删除');
  if (!ok) return;
  try {
    await api('/api/trash/' + n.id, { method: 'DELETE' });
    state.trash = items.filter((x) => x.id !== n.id);
    renderTrashList();
    toast('已彻底删除', 'success', 1400);
  } catch (e) {
    toast('删除失败：' + e.message, 'error');
  }
}

async function clearTrash() {
  const items = state.trash || [];
  if (!items.length) return;
  const ok = await confirmDialog('清空回收站？共 ' + items.length + ' 篇笔记将被彻底删除，不可恢复（包括 AI 总结）。', '清空');
  if (!ok) return;
  try {
    await api('/api/trash/clear', { method: 'POST' });
    state.trash = [];
    renderTrashList();
    toast('回收站已清空', 'success', 1400);
  } catch (e) {
    toast('清空失败：' + e.message, 'error');
  }
}

function onProviderChange() {
  const sel = $('#providerSelect');
  const prev = state.lastProvider;
  const cur = sel.value;
  const p = state.providers.find((x) => x.id === cur);
  // 离开 custom 时缓存表单值，切回时还原（P1-9）
  if (prev === 'custom' && cur !== 'custom') {
    state.formCache = { baseURL: $('#baseURLInput').value.trim(), model: $('#modelInput').value.trim() };
  }
  if (cur === 'custom') {
    if (state.formCache.baseURL) $('#baseURLInput').value = state.formCache.baseURL;
    if (state.formCache.model) $('#modelInput').value = state.formCache.model;
  } else if (p) {
    // 自定义提供商：不覆盖用户已填的 Base URL / 模型名
    if (p.baseURL) $('#baseURLInput').value = p.baseURL;
    if (p.model) $('#modelInput').value = p.model;
  }
  state.lastProvider = cur;
}

async function saveSettings() {
  const provider = $('#providerSelect').value;
  const baseURL = $('#baseURLInput').value.trim();
  const model = $('#modelInput').value.trim();
  if (!baseURL) { toast('Base URL 不能为空（自定义提供商也需要填写端点）', 'error'); return; }
  if (!model) { toast('模型名不能为空', 'error'); return; }
  const body = {
    provider,
    baseURL,
    model,
  };
  const typedKey = $('#apiKeyInput').value;
  if (state.clearKey) {
    body.apiKey = '';        // 清除已保存 Key
    body.clearKey = true;
  } else if (typedKey.trim()) {
    body.apiKey = typedKey.trim();  // 填写了新 Key（纯空格视为未填写，避免误清 Key）
  }
  // 其余情况不传 apiKey → 后端应保留原值

  const btn = $('#saveSettingsBtn');
  btn.disabled = true;
  btn.textContent = '⏳ 保存中…';
  try {
    await api('/api/settings', { method: 'PUT', body });
    toast('设置已保存', 'success');
    closeSettings();
  } catch (e) {
    toast('保存设置失败：' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '保存';
  }
}

// 测试连接：用表单当前填写的配置发一个最小请求，不保存
async function testConnection() {
  const baseURL = $('#baseURLInput').value.trim();
  const model = $('#modelInput').value.trim();
  if (!baseURL) { toast('请先填写 Base URL 再测试', 'error'); return; }
  if (!model) { toast('请先填写模型名再测试', 'error'); return; }
  const body = {
    baseURL,
    model,
  };
  const typedKey = $('#apiKeyInput').value.trim();
  if (typedKey) body.apiKey = typedKey;
  else if (state.clearKey) { body.apiKey = ''; body.clearKey = true; }
  // 未填新 Key 时由后端使用已保存的 Key

  const btn = $('#testConnBtn');
  btn.disabled = true;
  btn.textContent = '⏳ 测试中…';
  try {
    const data = await api('/api/ai/test', { method: 'POST', body });
    toast('连接成功：' + (data.reply || '模型响应正常'), 'success', 4000);
  } catch (e) {
    toast('连接失败：' + e.message, 'error', 6000);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔌 测试连接';
  }
}

/* ================= 移动端侧边栏 ================= */

function toggleSidebar(open) {
  $('#sidebar').classList.toggle('open', open);
  $('#sidebarBackdrop').classList.toggle('hidden', !open);
}

/* ================= 事件绑定 & 启动 ================= */

function bindEvents() {
  $('#searchInput').addEventListener('input', (e) => {
    state.query = e.target.value;
    renderNoteList();
  });

  // 排序控件
  const sortSel = $('#sortSelect');
  sortSel.value = state.sortMode;
  sortSel.addEventListener('change', () => applySortMode(sortSel.value));
  initDragSort();

  // 字体大小
  initFontSize();

  // 侧边栏（收起 / 调宽）
  initSidebar();

  $('#newNoteBtn').addEventListener('click', createNote);
  $('#emptyNewBtn').addEventListener('click', createNote);
  $('#menuBtn').addEventListener('click', () => {
    // 桌面端：收起态下菜单按钮 = 展开侧边栏入口；移动端：抽屉开关
    if (window.matchMedia('(min-width: 769px)').matches) {
      if ($('#app').classList.contains('sidebar-collapsed')) setSidebarCollapsed(false);
      return;
    }
    toggleSidebar(!$('#sidebar').classList.contains('open'));
  });
  $('#sidebarBackdrop').addEventListener('click', () => toggleSidebar(false));

  ['titleInput', 'contentInput', 'tagsInput'].forEach((id) => {
    $('#' + id).addEventListener('input', onEditorInput);
  });
  $$('.mode-btn').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  // Markdown 工具栏
  $$('.md-btn').forEach((b) => b.addEventListener('click', () => toolbarInsert(b.dataset.md)));

  // Typora 式渲染编辑：输入即反序列化重建（无防抖延迟）；中文输入法组合期间跳过重建
  $('#renderEdit').addEventListener('input', () => {
    if (composing) return;
    syncFromRenderEdit();
  });
  $('#renderEdit').addEventListener('compositionstart', () => { composing = true; });
  $('#renderEdit').addEventListener('compositionend', () => {
    composing = false;
    syncFromRenderEdit(); // IME 组合结束同步一次（含候选上屏）
  });
  // 结构敏感按键（Enter/Backspace/Delete/Tab）全部走源码编辑路径：
  // 在 contentInput 上改 Markdown 再重建，避免与浏览器原生 DOM 删除/换行行为竞态（P0-2/P0-3/P2-1）
  $('#renderEdit').addEventListener('keydown', (e) => {
    if (composing) return; // IME 组合中（Enter 用于选词）不拦截
    if (e.key !== 'Enter' && e.key !== 'Backspace' && e.key !== 'Delete' && e.key !== 'Tab') return;
    e.preventDefault();
    const ta = $('#contentInput');
    // 选区偏移必须在 sync（可能重建 DOM 塌缩选区）之前映射
    const sel0 = window.getSelection();
    const re0 = $('#renderEdit');
    const hasSel = sel0 && sel0.rangeCount && !sel0.isCollapsed && (e.key === 'Backspace' || e.key === 'Delete');
    let selStart = -1, selEnd = -1;
    if (hasSel) {
      const selText = sel0.rangeCount ? sel0.getRangeAt(0).toString() : '';
      if (selText && selText.length >= (re0.textContent || '').length && re0.textContent) {
        selStart = 0; selEnd = Number.MAX_SAFE_INTEGER; // 全选
      } else {
        const a = htmlToMarkdown(re0, sel0.anchorNode, sel0.anchorOffset).caretOffset;
        const f = htmlToMarkdown(re0, sel0.focusNode, sel0.focusOffset).caretOffset;
        const len = ta.value.length;
        selStart = Math.max(0, Math.min(a >= 0 ? a : len, f >= 0 ? f : len, len));
        selEnd = Math.max(a >= 0 ? a : len, f >= 0 ? f : len, 0);
      }
    }
    syncFromRenderEdit(); // 确保 value 与光标最新
    const sel = window.getSelection();
    const re = $('#renderEdit');
    // 选区删除（用 sync 前映射的偏移区间）
    if (hasSel && selEnd > selStart) {
      const len = ta.value.length;
      const lo = Math.min(selStart, len);
      const hi = Math.min(selEnd, len);
      if (hi > lo) {
        ta.value = ta.value.slice(0, lo) + ta.value.slice(hi);
        ta.selectionStart = lo;
        ta.selectionEnd = lo;
        lastEditOffset = lo;
        lastEditEnd = lo;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
    }
    const { caretOffset } = htmlToMarkdown(
      re,
      sel && sel.rangeCount ? sel.anchorNode : null,
      sel && sel.rangeCount ? sel.anchorOffset : 0
    );
    // 兜底：光标恢复失败或偏移计算失败时，使用 lastEditOffset 避免按键被静默吞掉
    let pos = caretOffset >= 0 ? caretOffset : (lastEditOffset >= 0 ? lastEditOffset : ta.value.length);
    if (pos < 0) return;
    let value = ta.value;
    if (e.key === 'Enter') {
      // 列表自动续表：无序列表续 `- `，有序列表序号 +1；空列表项回车退出列表
      // 光标在行首时退化为普通换行（避免生成 `\n- - foo` 错误结构）
      const lineStart = value.lastIndexOf('\n', pos - 1) + 1;
      const lineEndIdx = value.indexOf('\n', pos);
      const lineEndPos = lineEndIdx === -1 ? value.length : lineEndIdx;
      const line = value.slice(lineStart, lineEndPos);
      const ulMatch = pos > lineStart ? line.match(/^(\s*)([-*+])(\s+)(.*)$/) : null;
      const olMatch = pos > lineStart ? line.match(/^(\s*)(\d+)([.)])(\s+)(.*)$/) : null;
      if (ulMatch && !ulMatch[4].trim()) {
        // 空无序项：移除标记退出列表，光标留在空行
        const prefixLen = ulMatch[1].length + ulMatch[2].length + ulMatch[3].length;
        value = value.slice(0, lineStart) + value.slice(lineStart + prefixLen);
        pos = lineStart;
      } else if (ulMatch) {
        const insert = '\n' + ulMatch[1] + ulMatch[2] + ' ';
        value = value.slice(0, pos) + insert + value.slice(pos);
        pos += insert.length;
      } else if (olMatch && !olMatch[5].trim()) {
        // 空有序项：移除标记退出列表
        const prefixLen = olMatch[1].length + olMatch[2].length + olMatch[3].length + olMatch[4].length;
        value = value.slice(0, lineStart) + value.slice(lineStart + prefixLen);
        pos = lineStart;
      } else if (olMatch) {
        const n = parseInt(olMatch[2], 10) + 1;
        const insert = '\n' + olMatch[1] + n + olMatch[3] + ' ';
        value = value.slice(0, pos) + insert + value.slice(pos);
        pos += insert.length;
      } else {
        value = value.slice(0, pos) + '\n' + value.slice(pos);
        pos += 1;
      }
    } else if (e.key === 'Backspace') {
      if (pos === 0) return;
      // 空标记行（列表/引用/标题）：一键删除整行，光标回到上一行行末
      const lineStart = value.lastIndexOf('\n', pos - 1) + 1;
      const lineEndIdx = value.indexOf('\n', pos);
      const lineEndPos = lineEndIdx === -1 ? value.length : lineEndIdx;
      const line = value.slice(lineStart, lineEndPos);
      const emptyMarked = /^(\s*)([-*+]\s+|>\s?|#{1,6}\s|\d+[.)]\s+)$/.test(line);
      if (emptyMarked && pos > lineStart && pos <= lineEndPos) {
        const rmEnd = lineEndIdx === -1 ? value.length : lineEndIdx + 1; // 含行尾换行
        value = value.slice(0, lineStart) + value.slice(rmEnd);
        pos = lineStart;
      } else {
        value = value.slice(0, pos - 1) + value.slice(pos);
        pos -= 1;
      }
    } else if (e.key === 'Delete') {
      if (pos >= value.length) return;
      value = value.slice(0, pos) + value.slice(pos + 1);
    } else { // Tab → 两个空格（避免 execCommand 产生 nbsp）
      value = value.slice(0, pos) + '  ' + value.slice(pos);
      pos += 2;
    }
    ta.value = value;
    ta.selectionStart = pos;
    ta.selectionEnd = pos;
    lastEditOffset = pos;
    lastEditEnd = pos;
    ta.dispatchEvent(new Event('input', { bubbles: true })); // onEditorInput：保存 + 重建 + 光标恢复
  });
  $('#renderEdit').addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    if (text) document.execCommand('insertText', false, text); // 纯文本粘贴，input 事件触发同步
  });
  // 链接点击：普通点击放光标进链接文字（编辑）；Ctrl/Cmd+点击才打开新标签
  // 光标在链接内时链接会显示为 md-inline-src 源码 span（无 <a> 元素），需从源码文本解析 href
  $('#renderEdit').addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    // 普通点击图片：切换为源码编辑态（img 是空元素无法直接编辑 alt/src，显示 ![alt](url) 供修改）
    if (!e.metaKey && !e.ctrlKey) {
      const img = t.closest('img');
      if (img) {
        e.preventDefault();
        const span = document.createElement('span');
        span.className = 'md-inline-src';
        span.textContent = inlineToSource(img);
        img.replaceWith(span);
        // 光标定位到源码末尾，用户可直接修改链接/说明
        const range = document.createRange();
        const tn = span.firstChild;
        if (tn) range.setStart(tn, tn.textContent.length);
        else range.setStart(span, 0);
        range.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        suppressSourceRefresh = true; // 抑制紧随其后的 rAF 重建（保持源码编辑态）
        return;
      }
      return;
    }
    const a = t.closest('a');
    if (a && a.href) {
      e.preventDefault();
      window.open(a.href, '_blank', 'noopener');
      return;
    }
    const src = t.closest('.md-inline-src');
    if (src) {
      const m = src.textContent.match(/\[([^\]]*)\]\((\S+?)\)/);
      if (m && m[2]) {
        e.preventDefault();
        window.open(m[2], '_blank', 'noopener');
      }
    }
  });

  // 光标移动（点击/方向键）后刷新“光标所在块显示源码”（Typora 式延迟渲染）
  let sourceRefreshQueued = false;
  let suppressSourceRefresh = false; // 点击图片切源码后抑制一次 rAF 重建
  const refreshSourceBlock = () => {
    if (sourceRefreshQueued) return;
    sourceRefreshQueued = true;
    requestAnimationFrame(() => {
      sourceRefreshQueued = false;
      if (suppressSourceRefresh) { suppressSourceRefresh = false; return; } // 图片源码编辑态：跳过本次重建
      if (mode !== 'edit' || !state.currentId || composing) return; // IME 组合期不重建（防丢候选）
      const sel = window.getSelection();
      if (sel && sel.rangeCount && !sel.isCollapsed) return; // 有选区不刷新（防塌缩跨块选区）
      const { caretOffset } = htmlToMarkdown(
        $('#renderEdit'),
        sel && sel.rangeCount ? sel.anchorNode : null,
        sel && sel.rangeCount ? sel.anchorOffset : 0
      );
      if (caretOffset >= 0) renderEditFromTextarea(caretOffset);
    });
  };
  $('#renderEdit').addEventListener('click', refreshSourceBlock);
  $('#renderEdit').addEventListener('keyup', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
      refreshSourceBlock();
    }
  });

  $('#summarizeBtn').addEventListener('click', summarize);
  $('#reviewBtn').addEventListener('click', startReview);
  $('#settingsBtn').addEventListener('click', openSettings);

  // 目录
  $('#tocBtn').addEventListener('click', () => toggleToc());
  $('#tocClose').addEventListener('click', () => toggleToc(false));
  $('#tocList').addEventListener('click', (e) => {
    const item = e.target.closest('.toc-item');
    if (item) tocJump(parseInt(item.dataset.tocIdx, 10));
  });

  $('#summaryToggle').addEventListener('click', () => {
    const hidden = $('#summaryBody').classList.toggle('hidden');
    $('#summaryToggle').textContent = hidden ? '展开' : '收起';
  });

  // 复盘
  $('#submitAnswerBtn').addEventListener('click', submitAnswer);
  $('#nextQuestionBtn').addEventListener('click', nextQuestion);
  $('#showReportBtn').addEventListener('click', () => endReview(true));
  $('#endReviewBtn').addEventListener('click', () => endReview(true));
  $('#closeReviewBtn').addEventListener('click', async () => {
    const r = state.review;
    if (r && r.answered > 0) {
      const ok = await confirmDialog('当前已答 ' + r.answered + ' 题，结束并关闭复盘？', '结束');
      if (!ok) return;
    }
    endReview(false);
  });
  $('#reportCloseBtn').addEventListener('click', closeReviewView);
  $('#referenceToggle').addEventListener('click', () => {
    const hidden = $('#referenceBody').classList.toggle('hidden');
    $('#referenceToggle').textContent = hidden ? '📎 参考要点（引用笔记原文）' : '📎 收起参考要点';
  });

  // 设置
  $('#closeSettingsBtn').addEventListener('click', closeSettings);
  $('#cancelSettingsBtn').addEventListener('click', closeSettings);
  $('#saveSettingsBtn').addEventListener('click', saveSettings);
  $('#testConnBtn').addEventListener('click', testConnection);

  // 设置 Tab 切换 + 复盘历史记录 + 回收站
  $$('.settings-tab').forEach((b) => b.addEventListener('click', () => switchSettingsTab(b.dataset.tab)));
  $('#historyBackBtn').addEventListener('click', showHistoryList);
  $('#historyDeleteBtn').addEventListener('click', deleteHistoryItem);
  $('#trashClearBtn').addEventListener('click', clearTrash);
  $('#clearKeyBtn').addEventListener('click', () => {
    state.clearKey = true;
    $('#apiKeyInput').value = '';
    $('#apiKeyInput').placeholder = '保存后将清除已配置的 Key';
    $('#clearKeyBtn').disabled = true;
  });
  $('#providerSelect').onchange = onProviderChange;
  $('#settingsModal').addEventListener('click', (e) => {
    if (e.target === $('#settingsModal')) closeSettings();
  });

  // 全局键盘
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#settingsModal').classList.contains('hidden')) closeSettings();
    else if (!$('#confirmDialog').classList.contains('hidden')) $('#confirmCancelBtn').click();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  loadNotes();
});

// 有未保存修改时，关闭页面前提醒
window.addEventListener('beforeunload', (e) => {
  if (state.dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});
