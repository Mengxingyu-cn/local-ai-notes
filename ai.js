// ai.js — 统一 OpenAI 兼容接口调用（零依赖，Node 18+ 内置 fetch）
'use strict';
const dns = require('dns');

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

// ---------- AI 端点防护（与云端版同源，按本地单用户定位简化） ----------
// 本地应用的 AI 配置由使用者本人维护（等同于云端的管理员配置），因此不做内网段封锁，
// 兼容 Clash Fake-IP（198.18/15）、局域网 Ollama/网关等真实场景；
// 但云元数据地址始终拦截（防应用被部署到云服务器后凭据被探测），并拒绝重定向、限制响应体大小。

/** URL.hostname 的 IPv6 字面量带方括号（如 [fc00::1]），判断前必须剥离 */
function stripIpv6Brackets(host) {
  return String(host).replace(/^\[/, '').replace(/\]$/, '');
}

// AI 响应体字节上限（防恶意 AI 端点返回超大 JSON 耗尽内存）
const MAX_AI_RESPONSE_BYTES = 5 * 1024 * 1024;

/** 受限读取响应体：先查 Content-Length 预检，再逐块累积，超限即中止 */
async function readBodyLimited(resp) {
  const declared = parseInt(resp.headers.get('content-length') || '0', 10);
  if (declared > MAX_AI_RESPONSE_BYTES) {
    throw Object.assign(new Error('AI 响应超过大小上限（5MB）'), { statusCode: 502 });
  }
  if (!resp.body || !resp.body.getReader) {
    const text = await resp.text();
    if (Buffer.byteLength(text) > MAX_AI_RESPONSE_BYTES) {
      throw Object.assign(new Error('AI 响应超过大小上限（5MB）'), { statusCode: 502 });
    }
    return text;
  }
  const reader = resp.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_AI_RESPONSE_BYTES) {
      try { await reader.cancel(); } catch (_) { /* 中止即可 */ }
      throw Object.assign(new Error('AI 响应超过大小上限（5MB）'), { statusCode: 502 });
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** 返回 null=允许；返回字符串=拒绝原因
 *  拦截云元数据地址（本机与局域网目标放行）；域名解析失败时拒绝连接（fail-closed）。 */
async function checkTargetBlocked(baseURL) {
  let u;
  try { u = new URL(String(baseURL || '')); } catch (_) { return 'Base URL 格式无效'; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '仅支持 http/https 协议的 Base URL';
  const host = u.hostname;
  // 本机地址放行（Ollama 等本地模型）
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') return null;
  const isLiteral = /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':');
  const ips = [];
  if (isLiteral) {
    ips.push(stripIpv6Brackets(host)); // 剥离 IPv6 方括号后再判断
  } else {
    try {
      const res = await dns.promises.lookup(host, { all: true, verbatim: true });
      res.forEach((x) => ips.push(x.address));
    } catch (_) {
      // fail-closed：域名无法解析时拒绝连接（防 DNS rebinding/TOC-TOU 绕过）
      return '无法解析 Base URL 域名，已拒绝连接';
    }
  }
  for (const ip of ips) {
    // 云元数据地址：始终拦截（应用若被部署到云服务器，防被探测取凭据）
    if (ip === '169.254.169.254' || ip === 'fd00:ec2::254') {
      return '云元数据地址已拦截（该地址不可作为 AI 端点）';
    }
  }
  if (!ips.length) return 'Base URL 域名未解析到有效地址，已拒绝连接'; // fail-closed：无解析结果视为不可达
  // 已知限制：域名在此校验、由 fetch 再次解析（TOCTOU），彻底防 DNS 重绑定需把连接固定到已校验 IP；
  // 当前版本已拦截重定向 + 云元数据字面量 + 云元数据解析结果，重绑定残余风险见 readme「已知限制」。
  return null;
}

async function callChatCompletion({ baseURL, apiKey, model, messages, temperature = 0.3, timeoutMs = 90000 }) {
  const blocked = await checkTargetBlocked(baseURL);
  if (blocked) throw Object.assign(new Error(blocked), { statusCode: 400 });
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
      redirect: 'error', // 拒绝任何重定向：SSRF 防御（重定向可把已校验地址导向内网/元数据）
    });

    if (!resp.ok) {
      let detail = '';
      try {
        const errBody = await readBodyLimited(resp);
        try { detail = JSON.stringify(JSON.parse(errBody).error || {}); } catch (_) { /* 非 JSON 错误体 */ }
      } catch (_) { /* 错误体过大等：忽略详情 */ }
      const msg = classifyError(resp.status);
      // 附带 statusCode：供应商 HTTP 错误按原状态码透传（5xx 归一为 502），fail() 对 <500 的错误会
      // 展示具体消息（如「API Key 无效或未配置」）；真正的服务器内部错误仍隐藏细节
      const sc = resp.status >= 500 ? 502 : resp.status;
      throw Object.assign(new Error(`${msg}（HTTP ${resp.status}${detail ? '：' + detail : ''}）`), { statusCode: sc });
    }

    // 受限读取 + 解析：防超大响应耗尽内存
    const data = JSON.parse(await readBodyLimited(resp));
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('AI 返回内容为空，请检查模型名与配额');
    return content;
  } catch (e) {
    if (e.name === 'AbortError') {
      throw Object.assign(new Error('AI 请求超时（90 秒），请检查网络或改用更快的模型'), { statusCode: 504 });
    }
    // 网络层失败（连接拒绝/DNS 失败等 fetch 抛出的 TypeError）：给出可操作消息而非“内部错误”
    if (e instanceof TypeError && !e.statusCode) {
      throw Object.assign(new Error('无法连接 AI 服务，请检查 Base URL、网络或本地模型服务是否已启动'), { statusCode: 502 });
    }
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
