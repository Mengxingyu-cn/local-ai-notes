// ai.js — 统一 OpenAI 兼容接口调用（零依赖，Node 18+ 内置 fetch）
'use strict';

// 预设提供商（设置页下拉数据源；baseURL 均按 OpenAI 兼容 /chat/completions 设计）
// 端点/模型名已于 2026-08 按各厂商官方文档核实；模型迭代快，用户可在设置页自行修改。
const PROVIDERS = [
  { id: 'deepseek',   name: 'DeepSeek（深度求索）',  baseURL: 'https://api.deepseek.com',            model: 'deepseek-v4-flash',     note: '国产，中文好，推荐默认；V4 默认开思考' },
  { id: 'moonshot',   name: 'Moonshot Kimi（月之暗面）', baseURL: 'https://api.moonshot.cn/v1',     model: 'kimi-k3',               note: '国产，1M 长上下文' },
  { id: 'openai',     name: 'OpenAI',               baseURL: 'https://api.openai.com/v1',           model: 'gpt-5.6',               note: '国际；若报模型不存在请到官方文档查最新模型名' },
  { id: 'qwen',       name: '通义千问（阿里）',       baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3.5-plus', note: '国产，DashScope 兼容模式' },
  { id: 'zhipu',      name: '智谱 GLM',              baseURL: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.7-flash',        note: '国产，免费档模型' },
  { id: 'openrouter', name: 'OpenRouter（聚合）',     baseURL: 'https://openrouter.ai/api/v1',        model: '~openai/gpt-latest',    note: '一个 Key 用多家模型，~ 为最新别名' },
  { id: 'anthropic',  name: 'Anthropic（Claude）',   baseURL: 'https://api.anthropic.com/v1',        model: 'claude-sonnet-4-6',     note: '官方 OpenAI 兼容层（非生产定位，JSON mode 无效）' },
  { id: 'ollama',     name: 'Ollama（本地）',         baseURL: 'http://localhost:11434/v1',           model: 'qwen3:8b',              note: '完全本地免费，需先装 Ollama 并拉取模型' },
  { id: 'custom',     name: '自定义（OpenAI 兼容）',   baseURL: '',                              model: '',                      note: '任意 OpenAI 兼容端点：SiliconFlow、Groq、Together、vLLM 等，自行填写 Base URL 与模型名' },
];

// 需要特殊鉴权 header 的提供商（默认都是 Authorization: Bearer）
// 注：Anthropic OpenAI 兼容层官方确认走 Bearer（非 x-api-key）；Ollama 忽略 key。
const AUTH_HEADER_OVERRIDES = {};

function normalizeBaseURL(baseURL) {
  let u = String(baseURL || '').trim().replace(/\/+$/, '');
  return u;
}

async function callChatCompletion({ baseURL, apiKey, model, messages, temperature = 0.3, timeoutMs = 90000 }) {
  const url = normalizeBaseURL(baseURL) + '/chat/completions';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };
  const override = AUTH_HEADER_OVERRIDES[providerIdFromURL(baseURL)];
  if (override) {
    delete headers['Authorization'];
    Object.assign(headers, override(apiKey));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        temperature,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      let detail = '';
      try { detail = JSON.stringify((await resp.json()).error || {}); } catch (_) { /* ignore */ }
      const msg = classifyError(resp.status);
      throw new Error(`${msg}（HTTP ${resp.status}${detail ? '：' + detail : ''}）`);
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('AI 返回内容为空，请检查模型名与配额');
    return content;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('AI 请求超时（90 秒），请检查网络或改用更快的模型');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function providerIdFromURL(baseURL) {
  const u = String(baseURL || '');
  for (const p of PROVIDERS) {
    if (u.includes(p.baseURL)) return p.id;
  }
  return '';
}

function classifyError(status) {
  if (status === 401) return 'API Key 无效或未配置';
  if (status === 402) return '账户余额不足';
  if (status === 403) return '无权限访问该模型';
  if (status === 404) return '接口地址或模型不存在，请检查 baseURL 与模型名';
  if (status === 429) return '请求频率超限或配额不足';
  if (status >= 500) return 'AI 服务端错误，请稍后重试';
  return 'AI 请求失败';
}

module.exports = { PROVIDERS, callChatCompletion, normalizeBaseURL };
