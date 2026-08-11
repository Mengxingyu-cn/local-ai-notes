// storage.js — JSON 文件存储（零依赖，原子写）
'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJSON(name, fallback) {
  ensureDataDir();
  const file = path.join(DATA_DIR, name);
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {
    // 文件损坏：先备份再回退默认值，避免下次保存静默覆盖丢数据
    console.error(`[storage] 读取 ${name} 失败，已备份原文件:`, e.message);
    try {
      const backup = `${file}.bak-${Date.now()}`;
      fs.copyFileSync(file, backup);
    } catch (_) { /* 备份失败不阻塞启动 */ }
  }
  return fallback;
}

function saveJSON(name, data) {
  ensureDataDir();
  const file = path.join(DATA_DIR, name);
  const tmp = `${file}.${process.pid}.tmp`; // 带 pid，双开进程不互相踩
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file); // 原子替换，避免写一半损坏
}

// ---- 笔记 ----
function loadNotes() {
  const d = loadJSON('notes.json', { notes: [] });
  return Array.isArray(d.notes) ? d.notes : [];
}
function saveNotes(notes) {
  saveJSON('notes.json', { notes });
}

// ---- 设置 ----
// 默认值必须与 ai.js PROVIDERS 中 deepseek 预设保持一致（2026-08 官方 V4 命名）
const DEFAULT_SETTINGS = {
  provider: 'deepseek',
  baseURL: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  apiKey: ''
};
function loadSettings() {
  return Object.assign({}, DEFAULT_SETTINGS, loadJSON('settings.json', {}));
}
function saveSettings(s) {
  saveJSON('settings.json', s);
}

// ---- 复盘会话 ----
function loadReviews() {
  const d = loadJSON('reviews.json', { sessions: {} });
  return d && typeof d === 'object' && d.sessions ? d.sessions : {};
}
function saveReviews(sessions) {
  saveJSON('reviews.json', { sessions });
}

// ---- 复盘历史记录（复盘结束后持久化保存的报告，供“设置 → 复盘历史记录”查看） ----
function loadReviewHistory() {
  const d = loadJSON('review-history.json', { history: [] });
  return Array.isArray(d.history) ? d.history : [];
}
function saveReviewHistory(history) {
  saveJSON('review-history.json', { history });
}

module.exports = { loadNotes, saveNotes, loadSettings, saveSettings, loadReviews, saveReviews, loadReviewHistory, saveReviewHistory };
