// server.js — 本地 AI 笔记应用入口（单用户、无登录，零依赖 Node http）
// 启动：node server.js  →  http://localhost:3000
// 与云端版（栖屿笔记）保持核心能力同源：笔记配额、安全响应头/CSP、
// AI 端点防护、复盘会话硬化、进程级兜底；登录/多用户/后台/广场按本地定位省略。
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const storage = require('./storage');
const { PROVIDERS, normalizeBaseURL } = require('./ai');
const review = require('./review');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 5 * 1024 * 1024; // 5MB
const NOTE_MAX_LENGTH = parseInt(process.env.NOTE_MAX_LENGTH, 10) || 512 * 1024;  // 单篇笔记内容上限（字符）
const NOTE_MAX_COUNT = parseInt(process.env.NOTE_MAX_COUNT, 10) || 10000;         // 笔记数量上限（下沉 storage.saveNotes 统一强制，此处仅作路由级前置提示）
const TRASH_LIMIT = parseInt(process.env.TRASH_LIMIT, 10) || 200;                 // 回收站容量上限（满则拒绝删除，不静默丢弃）
const USER_NOTE_TOTAL_LIMIT = parseInt(process.env.USER_NOTE_TOTAL_LIMIT, 10) || 20 * 1024 * 1024; // 笔记总量配额（JSON 字节，下沉 storage.saveNotes 统一强制，此处仅作路由级前置提示）

// ---------- 使用说明（内置默认稿；侧栏「使用说明」与设置 Tab 共用此单一真相源） ----------
const DEFAULT_GUIDE = [
  "# 本地 AI 笔记使用说明",
  "",
  "给灵感一个安静的落脚处。这里可以随手记录、整理知识，再用 AI 总结和提问式复盘加深理解。",
  "",
  "## 第一次使用",
  "1. 点击左侧「新建笔记」，填写标题，直接在正文区开始书写。",
  "2. 内容会自动保存。离开页面前，确认上方状态显示「已保存」；出现「未保存」或保存失败提示时，请保留页面，确认本地服务仍在运行后再试。",
  "",
  "## 认识你的工作台",
  "- **左侧找笔记**：上方是「全部笔记」「复盘历史」，中间是搜索、排序和笔记列表；点击列表上方的漏斗图标（标签筛选），即可在弹出面板中按主题筛选；选中后，列表上方会显示当前标签，筛选面板自动收起。",
  "- **右侧写内容**：上方管理当前笔记，下方是标题、标签和正文。桌面端点击上方的专注模式图标可收起左侧列表，再次点击可恢复。",
  "- **常用入口**：侧栏底部的垃圾桶、问号、齿轮图标分别打开「回收站」「使用说明」「设置」，鼠标悬停可查看名称。",
  "- **手机使用**：通过左上角的列表按钮打开笔记列表，选择笔记后回到正文书写。",
  "",
  "## 写作、排版与标签",
  "- 默认「编辑」模式会直接显示 Markdown 的排版效果；切到「源码」可查看和修改原始文本。两种模式编辑的是同一篇笔记。",
  "- 使用正文上方工具栏设置标题、加粗、列表、引用、代码、链接和图片等格式。图片通过链接插入；表格可切到「源码」模式输入 Markdown 表格。",
  "- 点击「目录」查看正文中的标题并跳转；用 A−／A＋ 调整正文字号。正文下方可查看字符、词和行数统计。",
  "- 点击标题下方的「标签与分类」展开标签输入框，用逗号分隔多个标签。已有标签也可通过快捷标签点击添加或移除。",
  "- 桌面端可拖动侧栏与正文之间的分隔线调整宽度；Ctrl+Z 撤销，Ctrl+Y 重做。",
  "",
  "## 找到与整理笔记",
  "- 搜索会匹配笔记标题和正文；选中标签时，只在该标签范围内搜索。",
  "- 在「我的笔记」右侧选择「最近更新」「名称 A–Z」或「手动排序」。选择手动排序后，桌面端可拖动列表中的笔记调整顺序。",
  "- 点击列表上方的密度图标，可选择「自动」「舒适」或「紧凑」。自动模式在窗口较矮时使用紧凑布局；手动选择会在当前浏览器中记住。舒适模式显示正文预览，紧凑模式保留标题、更新时间和标签，让一屏容纳更多笔记；正文字号不受影响。点击笔记即可继续编辑。",
  "- 想查看所有笔记时，点击「全部笔记」，再按需要搜索或筛选。",
  "",
  "## AI 总结",
  "1. 打开一篇有正文的笔记，点击「AI 总结」。",
  "2. 总结会在右侧面板打开，窄屏时以抽屉显示，可一边对照原文一边阅读。",
  "3. 点击面板右上角的关闭按钮即可继续专注书写；已有总结可通过顶栏「查看总结」再次打开，或在面板底部「重新总结」。",
  "4. 修改正文后，如需更新摘要，点击「重新总结」并确认。已有总结不会随着正文修改自动重写。",
  "",
  "**使用哪一个 AI？**",
  "- 在「设置 → AI 设置」选择提供商，填写服务地址、模型名称与 API Key，保存后可「测试连接」。",
  "- 也可以使用本地免费的 Ollama（Base URL 填 http://localhost:11434，无需 Key）。",
  "- API Key 加密保存在本机数据目录；AI 只在你发起总结或复盘等操作时调用，相关笔记内容会交给所选 AI 服务处理，结果请结合原文判断。",
  "",
  "## 提问式复盘",
  "1. 先给需要复盘的笔记添加同一个标签。",
  "2. 点击左侧列表上方的漏斗图标（标签筛选），选择该标签，再点击「开始复盘」。",
  "3. 在弹出的列表里勾选一篇或多篇笔记，确认后进入复盘页面。",
  "4. 根据题目输入回答并提交，查看正确／部分正确／不正确的判断、解释与原文引用，再继续下一题。",
  "5. 完成后查看复盘报告；也可使用「结束复盘」提前结束。复盘过程中先结束当前复盘，再切换笔记。",
  "6. 点击侧栏上方「复盘历史」，查看过往报告和逐题回答。删除的复盘记录会进入回收站，可恢复。",
  "",
  "## 导出、删除与恢复",
  "- 点击工作区右上角「更多操作」（三个圆点），选择「导出当前笔记」，或通过「导出全部笔记」合并导出为 Markdown 文件（.md）。全部导出包括所有笔记，不只当前筛选结果。",
  "- 在列表中使用删除按钮，笔记会先移入回收站，已有 AI 总结会一并保留。",
  "- 点击侧栏底部「回收站」，选择恢复笔记或复盘记录。回收站容量以上方提示为准，满时需要先整理再继续删除。",
  "- 「彻底删除」或「清空回收站」无法在应用内恢复；重要内容可先导出留存。",
  "",
  "## 常见问题",
  "- **总结或复盘失败**：先看具体提示，再检查「设置 → AI 设置」中的模型配置；连接失败时可用「测试连接」排查。",
  "- **找不到笔记**：先回到「全部笔记」，清空搜索、检查标签筛选，再查看回收站。",
  "- **保存失败**：先保留当前页面和内容，确认本地服务仍在运行；等「已保存」出现后再关闭页面。",
  "",
  "> 数据全部保存在本机 data 目录，可随项目整体备份。",
].join('\n');

// ---------- 安全响应头（API 与静态共用） ----------
const CSP_VALUE = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': CSP_VALUE,
};

// ---------- 静态文件 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, urlPath) {
  const decoded = safeDecode(urlPath);
  if (decoded === null) {
    res.writeHead(400, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, SECURITY_HEADERS));
    res.end(JSON.stringify({ error: '无效的 URL 编码' }));
    return;
  }
  let filePath = path.normalize(path.join(PUBLIC_DIR, decoded));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
    res.writeHead(403, Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, SECURITY_HEADERS));
    res.end(JSON.stringify({ error: '禁止访问' }));
    return;
  }
  if (urlPath === '/' || urlPath === '') filePath = path.join(PUBLIC_DIR, 'index.html');
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // 不存在则 404（不回退 index.html，避免任意路径都渲染应用壳）
      res.writeHead(404, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, SECURITY_HEADERS));
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, Object.assign({
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache', // 一律不缓存，避免浏览器沿用旧版 JS 导致界面新、逻辑旧
    }, SECURITY_HEADERS));
    res.end(data);
  });
}

// ---------- JSON 工具 ----------
function sendJSON(res, status, obj, extraHeaders) {
  const headers = Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }, SECURITY_HEADERS, extraHeaders || {});
  res.writeHead(status, headers);
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    // 纵深防御：请求体必须是 JSON（跨站表单提交是 urlencoded/multipart，直接拒绝）
    const ct = String(req.headers['content-type'] || '').toLowerCase();
    if (ct && !ct.includes('application/json')) {
      const err = new Error('请求体必须是 JSON');
      err.statusCode = 415;
      return reject(err);
    }
    let size = 0;
    let overLimit = false;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        overLimit = true;
        chunks.length = 0; // 超限后丢弃内容
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (overLimit) {
        const err = new Error('请求体过大（上限 5MB）');
        err.statusCode = 413;
        return reject(err);
      }
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        const err = new Error('JSON 解析失败');
        err.statusCode = 400;
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// 安全解码（畸形 % 编码时返回 null 而非抛异常打死进程）
function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch (_) {
    return null;
  }
}

function ok(res, obj) { sendJSON(res, 200, obj); }
function fail(res, err) {
  const status = (err && err.statusCode) || 500;
  let msg = '服务器内部错误';
  if (status !== 500) {
    // 非 500 的状态码均为代码内手工构造的用户向消息（含 AI 供应商错误、502/504 上游错误），直接展示
    msg = (err && err.message) ? err.message : msg;
  } else {
    // 真 500（未带 statusCode 的内部异常）不向客户端泄露内部细节，只记日志
    console.error('[server] 内部错误:', err && err.message);
  }
  sendJSON(res, status, { error: msg });
}

// 从 Host 头提取主机名（兼容 [::1]:3000 形式的 IPv6 字面量）
function hostnameOfHostHeader(header) {
  const s = String(header || '').toLowerCase();
  if (s.startsWith('[')) {
    const end = s.indexOf(']');
    return end >= 0 ? s.slice(0, end + 1) : s;
  }
  return s.split(':')[0];
}

// ---------- 笔记路由 ----------
function listNotes() {
  return storage.loadNotes().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function handleNotes(req, res, segments) {
  const method = req.method;

  // /api/notes/reorder —— 自定义排序：按 ids 顺序写入 order 字段
  if (segments.length === 1 && segments[0] === 'reorder') {
    if (method !== 'POST') return sendJSON(res, 405, { error: '方法不支持' });
    return readBody(req).then((body) => {
      if (!Array.isArray(body.ids)) throw Object.assign(new Error('缺少 ids 数组'), { statusCode: 400 });
      const notes = storage.loadNotes();
      const byId = new Map(notes.map((n) => [n.id, n]));
      // 去重后按顺序写入（防御重复/未知 id）
      const seen = new Set();
      body.ids.forEach((id, idx) => {
        const sid = String(id);
        if (seen.has(sid)) return;
        seen.add(sid);
        const n = byId.get(sid);
        if (n) n.order = idx;
      });
      storage.saveNotes(notes);
      ok(res, { ok: true });
    }).catch((e) => fail(res, e));
  }

  // /api/notes
  if (segments.length === 0) {
    if (method === 'GET') return ok(res, { notes: listNotes() });
    if (method === 'POST') {
      return readBody(req).then((body) => {
        const notes = storage.loadNotes();
        const now = Date.now();
        if (notes.length >= NOTE_MAX_COUNT) {
          throw Object.assign(new Error('笔记数量已达上限，请先清理'), { statusCode: 400 });
        }
        if (String(body.content || '').length > NOTE_MAX_LENGTH) {
          throw Object.assign(new Error('笔记内容过长（单篇上限约 500KB）'), { statusCode: 400 });
        }
        const note = {
          id: crypto.randomBytes(8).toString('hex'),
          title: String(body.title || '无标题笔记').slice(0, 200),
          content: String(body.content || ''),
          tags: Array.isArray(body.tags) ? body.tags.map(String).slice(0, 20) : [],
          createdAt: now,
          updatedAt: now,
        };
        notes.push(note);
        // 总量配额（JSON 字节），超限拒绝（不落盘）
        if (Buffer.byteLength(JSON.stringify(notes), 'utf8') > USER_NOTE_TOTAL_LIMIT) {
          throw Object.assign(new Error('笔记总量超出配额，请先清理旧笔记'), { statusCode: 400 });
        }
        storage.saveNotes(notes);
        ok(res, { note });
      }).catch((e) => fail(res, e));
    }
    return sendJSON(res, 405, { error: '方法不支持' });
  }

  // /api/notes/:id
  const id = safeDecode(segments[0]);
  if (id === null) return sendJSON(res, 400, { error: '无效的笔记 ID' });

  if (method === 'GET') {
    const notes = storage.loadNotes();
    const idx = notes.findIndex((n) => n.id === id);
    if (idx < 0) return sendJSON(res, 404, { error: '笔记不存在' });
    return ok(res, { note: notes[idx] });
  }
  if (method === 'PUT') {
    return readBody(req).then((body) => {
      // await 之后重新加载，避免陈旧快照覆盖并发修改
      const notes = storage.loadNotes();
      const idx = notes.findIndex((n) => n.id === id);
      if (idx < 0) return sendJSON(res, 404, { error: '笔记不存在' });
      // F02 乐观并发：客户端声明编辑基线版本，过期即 409（以服务器为准，响应携带服务器版本）
      if (body.baseUpdatedAt !== undefined && body.baseUpdatedAt !== null) {
        if (notes[idx].updatedAt > (Number(body.baseUpdatedAt) || 0)) {
          return sendJSON(res, 409, { error: '该笔记已在其它窗口被修改，已按已保存版本为准', serverNote: notes[idx] });
        }
      }
      if (body.title !== undefined) notes[idx].title = String(body.title).slice(0, 200);
      if (body.content !== undefined) {
        if (String(body.content).length > NOTE_MAX_LENGTH) {
          throw Object.assign(new Error('笔记内容过长（单篇上限约 500KB）'), { statusCode: 400 });
        }
        notes[idx].content = String(body.content);
      }
      if (body.tags !== undefined) notes[idx].tags = Array.isArray(body.tags) ? body.tags.map(String).slice(0, 20) : [];
      notes[idx].updatedAt = Date.now();
      // 总量配额（JSON 字节），超限拒绝（不落盘）
      if (Buffer.byteLength(JSON.stringify(notes), 'utf8') > USER_NOTE_TOTAL_LIMIT) {
        throw Object.assign(new Error('笔记总量超出配额，请先清理旧笔记'), { statusCode: 400 });
      }
      storage.saveNotes(notes);
      ok(res, { note: notes[idx] });
    }).catch((e) => fail(res, e));
  }
  if (method === 'DELETE') {
    return readBody(req).then(() => {
      const notes = storage.loadNotes();
      const idx = notes.findIndex((n) => n.id === id);
      if (idx < 0) return sendJSON(res, 404, { error: '笔记不存在' });
      // 软删除：整体移入回收站（含 AI 总结 summary），不直接删除；回收站满则拒绝（不静默丢弃最旧）
      if (storage.loadTrash().length >= TRASH_LIMIT) {
        throw Object.assign(new Error(`回收站已满（${TRASH_LIMIT} 条），请先清理回收站后再删除`), { statusCode: 400 });
      }
      const [note] = notes.splice(idx, 1);
      note.deletedAt = Date.now();
      const trash = storage.loadTrash();
      trash.unshift(note);
      storage.saveTrash(trash);
      storage.saveNotes(notes);
      return ok(res, { ok: true });
    }).catch((e) => fail(res, e));
  }
  return sendJSON(res, 405, { error: '方法不支持' });
}

// ---------- 回收站路由 ----------
function handleTrash(req, res, segments) {
  // /api/trash
  if (segments.length === 0) {
    if (req.method === 'GET') {
      const trash = storage.loadTrash().sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0)).map((t) => {
        // 复盘记录条目去掉 qa 字段（体积大，列表接口变慢）；笔记条目原样
        if (t && t.trashType === 'review' && t.qa) {
          const { qa, ...rest } = t;
          return rest;
        }
        return t;
      }); // 最新删除在前
      return ok(res, { trash });
    }
    return sendJSON(res, 405, { error: '方法不支持' });
  }

  // /api/trash/clear —— 清空回收站
  if (segments.length === 1 && segments[0] === 'clear') {
    if (req.method !== 'POST') return sendJSON(res, 405, { error: '方法不支持' });
    return readBody(req).then(() => {
      storage.saveTrash([]);
      return ok(res, { ok: true });
    }).catch((e) => fail(res, e));
  }

  // /api/trash/:id[/restore]
  const id = safeDecode(segments[0]);
  if (id === null) return sendJSON(res, 400, { error: '无效的笔记 ID' });
  const restore = segments.length > 1 && segments[1] === 'restore';

  if (restore && req.method === 'POST') {
    const trash = storage.loadTrash();
    const ti = trash.findIndex((n) => n.id === id);
    if (ti < 0) return sendJSON(res, 404, { error: '回收站中没有此记录' });
    // 复盘记录恢复分支：查重幂等，回写复盘历史（trashType === 'review'）
    if (trash[ti].trashType === 'review') {
      const history = storage.loadReviewHistory();
      if (history.some((h) => h.id === id)) {
        // 查重幂等：历史已存在（并发/崩溃残留），仅从回收站移除
        trash.splice(ti, 1);
        storage.saveTrash(trash);
        return ok(res, { ok: true });
      }
      const [entry] = trash.splice(ti, 1);
      delete entry.deletedAt;
      delete entry.trashType;
      history.unshift(entry);
      storage.saveReviewHistory(history);
      storage.saveTrash(trash);
      return ok(res, { ok: true, record: entry });
    }
    // 笔记恢复：放回笔记列表
    const notes = storage.loadNotes();
    if (notes.some((n) => n.id === id)) {
      // 查重幂等：笔记已存在（并发/崩溃残留），仅从回收站移除，不重复添加
      trash.splice(ti, 1);
      storage.saveTrash(trash);
      return ok(res, { ok: true });
    }
    const [note] = trash.splice(ti, 1);
    delete note.deletedAt;      // 恢复后清除删除标记（summary 等字段原样保留）
    delete note.order;          // 清除排序位，custom 模式下按时间兜底排到列表尾部
    note.updatedAt = Date.now(); // 刷新更新时间，按时间排序时恢复的笔记出现在最前
    notes.push(note);
    // 顺序关键：先写 notes（新位置）再写 trash（移除），任一失败都不会丢笔记。
    // saveNotes 含配额检查（F5）可能抛错：本分支是同步代码体，必须就地接住，
    // 否则错误逃逸到进程兜底、请求挂死；失败时 trash 磁盘态未动，回收站记录不丢
    try {
      storage.saveNotes(notes);
    } catch (e) {
      return fail(res, e);
    }
    storage.saveTrash(trash);
    return ok(res, { ok: true, note });
  }
  if (!restore && req.method === 'DELETE') {
    const trash = storage.loadTrash();
    const ti = trash.findIndex((n) => n.id === id);
    if (ti < 0) return sendJSON(res, 404, { error: '回收站中没有此笔记' });
    trash.splice(ti, 1);
    storage.saveTrash(trash);
    return ok(res, { ok: true });
  }
  return sendJSON(res, 405, { error: '方法不支持' });
}

// ---------- 复盘历史路由 ----------
function handleReviewHistory(req, res, segments) {
  // /api/review-history
  if (segments.length === 0) {
    if (req.method === 'GET') {
      return ok(res, { history: storage.loadReviewHistory() });
    }
    return sendJSON(res, 405, { error: '方法不支持' });
  }

  // /api/review-history/:id
  const id = safeDecode(segments[0]);
  if (id === null) return sendJSON(res, 400, { error: '无效的记录 ID' });
  const history = storage.loadReviewHistory();
  const idx = history.findIndex((h) => h.id === id);
  if (idx < 0) return sendJSON(res, 404, { error: '记录不存在' });

  if (req.method === 'GET') return ok(res, { record: history[idx] });
  if (req.method === 'DELETE') {
    // 回收站已满：拒绝并明确告知（不覆盖回收站既有内容）
    const trash = storage.loadTrash();
    if (trash.length >= TRASH_LIMIT) {
      return sendJSON(res, 400, { error: `回收站已满（${TRASH_LIMIT} 条），请先清理回收站后再删除` });
    }
    // 软删除：复盘记录移入回收站（标记类型），可恢复；不直接删除
    // 顺序关键：先写 trash（新位置）再写 history（移除），中途崩溃最多产生重复条目（恢复接口幂等可清）
    const [rec] = history.splice(idx, 1);
    rec.deletedAt = Date.now();
    rec.trashType = 'review';
    trash.unshift(rec);
    storage.saveTrash(trash);
    storage.saveReviewHistory(history);
    return ok(res, { ok: true });
  }
  return sendJSON(res, 405, { error: '方法不支持' });
}

// ---------- 设置路由 ----------
function handleSettings(req, res) {
  if (req.method === 'GET') {
    const s = storage.loadSettings();
    return ok(res, {
      provider: s.provider,
      baseURL: s.baseURL,
      model: s.model,
      hasKey: !!(s.apiKey || '').trim(),
    });
  }
  if (req.method === 'PUT') {
    return readBody(req).then((body) => {
      const s = storage.loadSettings();
      if (body.provider !== undefined) s.provider = String(body.provider);
      if (body.baseURL !== undefined) s.baseURL = normalizeBaseURL(body.baseURL);
      if (body.model !== undefined) s.model = String(body.model).trim();
      if (body.apiKey !== undefined) {
        s.apiKey = String(body.apiKey).trim();
        if (!s.apiKey && body.clearKey) s.apiKey = '';
      }
      // Base URL 必填（自定义提供商也得填端点），空则拒绝保存
      if (!s.baseURL) {
        const err = new Error('Base URL 不能为空');
        err.statusCode = 400;
        throw err;
      }
      if (!s.model) {
        const err = new Error('模型名不能为空');
        err.statusCode = 400;
        throw err;
      }
      storage.saveSettings(s);
      ok(res, { ok: true });
    }).catch((e) => fail(res, e));
  }
  return sendJSON(res, 405, { error: '方法不支持' });
}

// ---------- AI 路由 ----------
async function handleAI(req, res, segments) {
  if (req.method !== 'POST') return sendJSON(res, 405, { error: '方法不支持' });
  const settings = storage.loadSettings();
  const action = segments.join('/');

  // Key 检查前置（Ollama 本地除外）；test 接口除外——它用请求体里的配置，Key 检查在合并后做；
  // F03：查看/放弃活跃复盘会话不依赖 AI 配置，一并豁免
  const AI_MANAGE_ACTIONS = ['review/active', 'review/abandon'];
  const isLocalOllama = settings.baseURL.includes('localhost') || settings.baseURL.includes('127.0.0.1');
  if (action !== 'test' && !AI_MANAGE_ACTIONS.includes(action) && !(settings.apiKey || '').trim() && !isLocalOllama) {
    return sendJSON(res, 400, { error: '尚未配置 API Key，请先到“设置”里配置' });
  }

  try {
    const body = await readBody(req);
    if (action === 'test') {
      // 连通性测试：优先用请求体里的配置（设置页“先测后存”），缺省回退已保存配置
      const { callChatCompletion } = require('./ai');
      const testSettings = {
        baseURL: normalizeBaseURL(body.baseURL !== undefined ? body.baseURL : settings.baseURL),
        apiKey: body.apiKey !== undefined ? String(body.apiKey).trim() : settings.apiKey,
        model: (body.model !== undefined ? String(body.model).trim() : '') || settings.model,
      };
      if (body.clearKey) testSettings.apiKey = '';
      const testIsLocal = testSettings.baseURL.includes('localhost') || testSettings.baseURL.includes('127.0.0.1');
      if (!testSettings.baseURL) throw Object.assign(new Error('Base URL 不能为空'), { statusCode: 400 });
      if (!testSettings.model) throw Object.assign(new Error('模型名不能为空'), { statusCode: 400 });
      if (!testSettings.apiKey && !testIsLocal) throw Object.assign(new Error('尚未配置 API Key，请先填写或保存'), { statusCode: 400 });
      const reply = await callChatCompletion({
        baseURL: testSettings.baseURL,
        apiKey: testSettings.apiKey,
        model: testSettings.model,
        messages: [{ role: 'user', content: '请只回复两个字：正常' }],
        temperature: 0,
        timeoutMs: 30000,
      });
      return ok(res, { ok: true, reply: String(reply).slice(0, 100) });
    }
    if (action === 'summarize') {
      if (!body.noteId) throw Object.assign(new Error('缺少 noteId'), { statusCode: 400 });
      const result = await review.summarizeNote(settings, body.noteId);
      return ok(res, { summary: result.summary, summarizedAt: result.summarizedAt, noteUpdatedAt: result.noteUpdatedAt });
    }
    if (action === 'review/start') {
      if (!body.noteId && !body.tag && !Array.isArray(body.noteIds)) throw Object.assign(new Error('缺少 noteId、tag 或 noteIds'), { statusCode: 400 });
      return ok(res, await review.startReview(settings, body));
    }
    if (action === 'review/answer') {
      if (!body.sessionId) throw Object.assign(new Error('缺少 sessionId'), { statusCode: 400 });
      if (!body.answer || !String(body.answer).trim()) throw Object.assign(new Error('回答不能为空'), { statusCode: 400 });
      return ok(res, await review.answerReview(settings, body.sessionId, String(body.answer)));
    }
    if (action === 'review/end') {
      if (!body.sessionId) throw Object.assign(new Error('缺少 sessionId'), { statusCode: 400 });
      return ok(res, await review.endReview(settings, body.sessionId));
    }
    if (action === 'review/active') {
      // F03：活跃复盘会话列表（供前端“继续上次复盘”；含已完成待生成报告的会话）
      return ok(res, { sessions: review.listActiveSessions() });
    }
    if (action === 'review/abandon') {
      // F03：放弃复盘——不生成 AI 报告，归档进历史并标记「已放弃」，不可续答
      if (!body.sessionId) throw Object.assign(new Error('缺少 sessionId'), { statusCode: 400 });
      return ok(res, review.abandonReview(body.sessionId));
    }
    return sendJSON(res, 404, { error: '未知的 AI 接口' });
  } catch (e) {
    return fail(res, e);
  }
}

// ---------- 主路由 ----------
const server = http.createServer((req, res) => {
  let pathname;
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    pathname = url.pathname;
  } catch (_) {
    // 畸形 Host（非法端口/未闭合 IPv6 等）会让 URL 构造抛异常——必须拦截，否则进程崩溃（远程 DoS）
    return sendJSON(res, 400, { error: '无效的请求' });
  }
  // Host 校验：防 DNS rebinding（恶意网页域名解析到 127.0.0.1 后读本地数据）；
  // 仅接受回环主机名，兼容 [::1]:3000 形式的 IPv6 字面量
  const host = hostnameOfHostHeader(req.headers.host);
  if (host && !['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) {
    return sendJSON(res, 403, { error: '仅允许通过 localhost 访问' });
  }
  // 跨站请求防护（CSRF）：若请求带 Origin 头（浏览器跨站 fetch/form 必带），
  // 来源必须与本应用同源（localhost/127.0.0.1/[::1] 任意端口），否则拒绝。
  // 无 Origin 头的请求（同源 GET、curl、Node 客户端等）直接放行，不影响本地工具。
  const origin = req.headers.origin;
  if (req.method !== 'GET' && req.method !== 'HEAD' && origin) {
    let originHost = '';
    try { originHost = new URL(origin).hostname.toLowerCase(); } catch (_) { /* Origin 解析失败（如 null）→ 按拒绝处理 */ }
    if (originHost !== 'localhost' && originHost !== '127.0.0.1' && originHost !== '[::1]' && originHost !== '::1') {
      return sendJSON(res, 403, { error: '跨站请求被拒绝' });
    }
  }

  // API 路由
  if (pathname.startsWith('/api/')) {
    if (pathname === '/api/health') return ok(res, { ok: true });
    if (pathname === '/api/providers') return ok(res, { providers: PROVIDERS });
    if (pathname === '/api/guide') {
      // 内置默认说明：单一真相源在服务端，前端展示与实际功能同源
      return ok(res, { content: DEFAULT_GUIDE, customized: false });
    }
    if (pathname === '/api/notes' || pathname.startsWith('/api/notes/')) {
      const segments = pathname.slice('/api/notes/'.length).split('/').filter(Boolean);
      return handleNotes(req, res, segments);
    }
    if (pathname === '/api/settings') {
      return handleSettings(req, res);
    }
    if (pathname === '/api/trash' || pathname.startsWith('/api/trash/')) {
      const segments = pathname.slice('/api/trash/'.length).split('/').filter(Boolean);
      return handleTrash(req, res, segments);
    }
    if (pathname === '/api/review-history' || pathname.startsWith('/api/review-history/')) {
      const segments = pathname.slice('/api/review-history/'.length).split('/').filter(Boolean);
      return handleReviewHistory(req, res, segments);
    }
    if (pathname.startsWith('/api/ai/')) {
      const segments = pathname.slice('/api/ai/'.length).split('/').filter(Boolean);
      return handleAI(req, res, segments);
    }
    return sendJSON(res, 404, { error: '接口不存在' });
  }

  // 静态文件（安全解码）
  return serveStatic(req, res, pathname);
});

// 进程级兜底：任何未捕获异常/拒绝都不让服务崩溃（畸形输入等外部因素不应造成 DoS）
process.on('uncaughtException', (err) => {
  console.error('[server] 未捕获异常（服务继续运行）:', err && err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('[server] 未处理的 Promise 拒绝（服务继续运行）:', err && err.message);
});

// 防慢速攻击：请求/头/长连接超时
server.requestTimeout = 30000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;

// 仅监听本机回环地址：本地应用不暴露到局域网（防 LAN 任意设备读写笔记/烧 API 配额）
// 端口占用时给出新手友好的中文提示（替代原始 EADDRINUSE 堆栈）
server.on('error', (e) => {
  if (e && e.code === 'EADDRINUSE') {
    console.error('');
    console.error(`  ⚠️ 端口 ${PORT} 已被占用！`);
    console.error('  请关闭占用该端口的程序，或用环境变量换端口后重启：');
    console.error('  Windows:  set PORT=8080 然后重新运行 start.bat');
    console.error('  Linux/macOS:  PORT=8080 node server.js');
    console.error('');
    process.exit(1);
  }
  throw e;
});
server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  📝 本地 AI 笔记 已启动');
  console.log(`  本机访问:  http://localhost:${PORT}`);
  console.log('  数据目录:  ' + storage.DATA_DIR);
  console.log('  提示: AI 功能需在「设置」中配置模型与 API Key');
  console.log('');
});
