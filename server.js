// server.js — 本地 AI 笔记应用入口（零依赖 Node http）
// 启动：node server.js  →  http://localhost:3000
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const storage = require('./storage');
const { PROVIDERS, normalizeBaseURL } = require('./ai');
const review = require('./review');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 5 * 1024 * 1024; // 5MB

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
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '无效的 URL 编码' }));
    return;
  }
  let filePath = path.normalize(path.join(PUBLIC_DIR, decoded));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '禁止访问' }));
    return;
  }
  if (urlPath === '/' || urlPath === '') filePath = path.join(PUBLIC_DIR, 'index.html');
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA 兜底：未匹配到文件时回 index.html
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, idx) => {
        if (e2) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('404 Not Found');
        } else {
          res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
          res.end(idx);
        }
      });
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache', // 本地开发应用一律不缓存，避免浏览器沿用旧版 JS 导致界面新、逻辑旧
    });
    res.end(data);
  });
}

// ---------- JSON 工具 ----------
function sendJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
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
  const msg = err && err.message ? err.message : '服务器内部错误';
  const status = (err && err.statusCode) || 500;
  sendJSON(res, status, { error: msg });
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
        const note = {
          id: crypto.randomBytes(8).toString('hex'),
          title: String(body.title || '无标题笔记').slice(0, 200),
          content: String(body.content || ''),
          tags: Array.isArray(body.tags) ? body.tags.map(String).slice(0, 20) : [],
          createdAt: now,
          updatedAt: now,
        };
        notes.push(note);
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
      if (body.title !== undefined) notes[idx].title = String(body.title).slice(0, 200);
      if (body.content !== undefined) notes[idx].content = String(body.content);
      if (body.tags !== undefined) notes[idx].tags = Array.isArray(body.tags) ? body.tags.map(String).slice(0, 20) : [];
      notes[idx].updatedAt = Date.now();
      storage.saveNotes(notes);
      ok(res, { note: notes[idx] });
    }).catch((e) => fail(res, e));
  }
  if (method === 'DELETE') {
    return readBody(req).then(() => {
      // await 之后重新加载，避免陈旧快照覆盖并发修改
      const notes = storage.loadNotes();
      const idx = notes.findIndex((n) => n.id === id);
      if (idx < 0) return sendJSON(res, 404, { error: '笔记不存在' });
      // 软删除：整体移入回收站（含 AI 总结 summary），不直接删除
      const [note] = notes.splice(idx, 1);
      note.deletedAt = Date.now();
      const trash = storage.loadTrash();
      trash.unshift(note);
      if (trash.length > 200) trash.length = 200; // 回收站容量上限，防无限增长
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
      const trash = storage.loadTrash().sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0)); // 最新删除在前
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
    if (ti < 0) return sendJSON(res, 404, { error: '回收站中没有此笔记' });
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
    // 顺序关键：先写 notes（新位置）再写 trash（移除），任一失败都不会丢笔记
    storage.saveNotes(notes);
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
    history.splice(idx, 1);
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

  // Key 检查前置（Ollama 本地除外）；test 接口除外——它用请求体里的配置，Key 检查在合并后做
  const isLocalOllama = settings.baseURL.includes('localhost') || settings.baseURL.includes('127.0.0.1');
  if (action !== 'test' && !(settings.apiKey || '').trim() && !isLocalOllama) {
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
      const summary = await review.summarizeNote(settings, body.noteId);
      return ok(res, { summary });
    }
    if (action === 'review/start') {
      if (!body.noteId && !body.tag) throw Object.assign(new Error('缺少 noteId 或 tag'), { statusCode: 400 });
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
    return sendJSON(res, 404, { error: '未知的 AI 接口' });
  } catch (e) {
    return fail(res, e);
  }
}

// ---------- 主路由 ----------
const server = http.createServer((req, res) => {
  // Host 白名单校验：防 DNS rebinding（恶意网页域名解析到 127.0.0.1 后读本地数据）
  const host = (req.headers.host || '').toLowerCase().split(':')[0];
  if (host && host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]') {
    sendJSON(res, 403, { error: '仅允许通过 localhost 访问' });
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // API 路由
  if (pathname === '/api/providers') {
    return ok(res, { providers: PROVIDERS });
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
  if (pathname.startsWith('/api/')) {
    return sendJSON(res, 404, { error: '接口不存在' });
  }

  // 静态文件（安全解码）
  return serveStatic(req, res, pathname);
});

// 仅监听本机回环地址：本地应用不暴露到局域网（防 LAN 任意设备读写/烧 API 配额）
server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  📝 AI 笔记复盘 已启动');
  console.log(`  打开浏览器访问:  http://localhost:${PORT}`);
  console.log('  提示: 先点右上角"设置"配置 AI API Key（默认 DeepSeek）');
  console.log('');
});
