// storage.js — JSON 文件存储（零依赖，原子写；API Key 加密落盘）
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

// ---- API Key 加密（AES-256-GCM，密钥存 data/.secret，首次启动生成；与云端版同源） ----
let secretKey = null; // null=未加载

function getSecretKey() {
  if (secretKey !== null) return secretKey;
  try {
    const file = path.join(DATA_DIR, '.secret');
    if (fs.existsSync(file)) {
      const k = fs.readFileSync(file, 'utf8').trim();
      if (k.length === 64) { secretKey = k; return secretKey; }
      console.error('[storage] .secret 文件格式无效，将重新生成（已有加密的 Key 将无法解密）');
    }
    const key = crypto.randomBytes(32).toString('hex');
    ensureDataDir();
    fs.writeFileSync(file, key, { encoding: 'utf8', mode: 0o600 });
    secretKey = key;
    return secretKey;
  } catch (e) {
    console.error('[storage] 无法创建加密密钥文件（API Key 将明文存储）:', e.message);
    secretKey = '';
    return secretKey;
  }
}

/** 加密 API Key（空值原样返回；无密钥时明文存储并告警） */
function encryptSecret(plain) {
  if (!plain) return plain;
  const key = getSecretKey();
  if (!key) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return 'enc:v1:' + iv.toString('base64') + ':' + tag.toString('base64') + ':' + enc.toString('base64');
}

/** 解密 API Key（非 enc: 前缀的旧明文原样返回，兼容历史 settings.json） */
function decryptSecret(stored) {
  const s = String(stored || '');
  if (!s.startsWith('enc:v1:')) return stored;
  const key = getSecretKey();
  if (!key) return ''; // 密钥文件丢失：无法解密，视为未配置 Key
  try {
    const parts = s.split(':');
    if (parts.length < 5) return '';
    const iv = Buffer.from(parts[2], 'base64');
    const tag = Buffer.from(parts[3], 'base64');
    const data = Buffer.from(parts.slice(4).join(':'), 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (e) {
    console.error('[storage] API Key 解密失败:', e.message);
    return '';
  }
}

function loadSettings() {
  const s = Object.assign({}, DEFAULT_SETTINGS, loadJSON('settings.json', {}));
  if (s.apiKey) s.apiKey = decryptSecret(s.apiKey);
  return s;
}
function saveSettings(s) {
  const out = Object.assign({}, s);
  if (out.apiKey) {
    const enc = encryptSecret(out.apiKey);
    if (enc === out.apiKey) {
      // 加密失败（.secret 不可用）：拒绝明文落盘，宁可不保存也不泄露 Key
      throw new Error('无法加密 API Key（加密密钥不可用），已拒绝保存；请检查数据目录权限');
    }
    out.apiKey = enc;
  }
  saveJSON('settings.json', out);
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

// ---- 回收站（软删除的笔记，整体保留含 summary；可恢复或彻底删除） ----
function loadTrash() {
  const d = loadJSON('trash.json', { trash: [] });
  return Array.isArray(d.trash) ? d.trash : [];
}
function saveTrash(trash) {
  saveJSON('trash.json', { trash });
}

module.exports = { DATA_DIR, loadNotes, saveNotes, loadSettings, saveSettings, loadReviews, saveReviews, loadReviewHistory, saveReviewHistory, loadTrash, saveTrash };
