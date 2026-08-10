# 本地 AI 笔记（Local AI Notes）

一个**本地运行**的 AI 笔记应用：普通在线笔记功能 + AI 总结 + 多 AI 厂商 API 接入 + **提问式复盘**（AI 出题 → 你回答 → AI 依据笔记原文评判对错）。

零依赖：后端只用 Node.js 内置模块，前端是原生 HTML/CSS/JS，**不需要 npm install**。

## 功能

| 功能 | 说明 |
|---|---|
| 📝 笔记管理 | 新建 / 编辑 / 删除 / 搜索 / 标签筛选，自动保存 |
| 🖥 实时渲染编辑 | Typora 同款机制：文档始终显示排版效果；光标所在的**标题/列表/引用/代码块**显示 Markdown 源码（`# `、`- `、`> `、``` 围栏可见），**行内标记**（`**粗体**`、`*斜体*`、`` `代码` ``、链接）在光标位于其内时显示源码字符，**普通段落保持正常排版**；光标离开（回车/点击/方向键）立刻渲染；**回车 = 换行**（连续输入不自动分段），**连续两次回车 = 分段**（空行分隔），空行可随时删除；中文输入法、粘贴、Tab 均流畅支持；切“源码”模式直接改 Markdown 原文 |
| 🖱 Markdown 工具栏 | 新手不用手打语法：加粗 / 斜体 / 标题 / 列表 / 引用 / 代码 / 链接 / 图片 / 分割线，一键插入 |
| 📑 侧边栏目录 | 一键生成笔记标题大纲（H1-H3），点击跳转到对应位置，编辑/源码/覆盖模式均可用 |
| 🏷 标签分类 | 侧边栏标签筛选 + 编辑器快捷标签一键添加/移除 + 笔记列表显示标签，笔记可按主题分类 |
| 📐 侧边栏自由调节 | 侧边栏可一键收起/展开，边缘拖拽自由调整宽度（180-420px），偏好自动记忆 |
| 🔀 笔记排序 | 三种方式：按时间（默认）/ 按名称 A-Z / 自定义（直接拖动笔记卡片调整顺序，自动保存） |
| ✨ AI 总结 | 选中一篇笔记，一键生成结构化总结（核心要点 / 关键概念 / 易错点） |
| 🔌 多 AI 接入 | 预设 8 家厂商 + “自定义（OpenAI 兼容）”：任意填 Base URL / 模型名 / API Key 即可接入 SiliconFlow、Groq、Together、vLLM 等 |
| 🧠 提问式复盘 | 核心功能：AI 基于笔记原文逐题提问 → 你自由回答 → AI 判定 对/部分对/不对，并引用笔记原文指出依据 → 一轮 8 题 → 生成复盘报告（正确率、薄弱点、学习建议） |

## 运行方式

前置条件：安装 [Node.js](https://nodejs.org/) 18 或更高版本（v22 已测试）。

```bash
# 在项目目录下
node server.js
```

然后打开浏览器访问 **http://localhost:3000**（端口可用环境变量 PORT 修改：`PORT=8080 node server.js`）。

> ⚠️ 服务**只监听本机（127.0.0.1）**，局域网其他设备无法访问——这是本地应用的安全设计，防止别人读写你的笔记、消耗你的 API 额度。

**首次使用三步：**

1. 点击右上角 **⚙️ 设置**，选择 AI 提供商（默认 DeepSeek），填入你的 API Key 和模型名，保存。
   - DeepSeek 控制台：https://platform.deepseek.com （充值后创建 API Key）
   - Kimi：https://platform.moonshot.cn
   - 通义千问（百炼）：https://bailian.console.aliyun.com
   - 智谱：https://open.bigmodel.cn （GLM-4.7-Flash 有免费档）
   - Ollama 本地：先 `ollama pull qwen3:8b` 再启动 `ollama serve`，Key 随便填
2. 新建一篇笔记，写入内容（支持 Markdown）。
3. 选中笔记 → **✨ AI 总结** 或 **🧠 开始复盘**。

> 设置页有 **🔌 测试连接** 按钮：保存前可以先验证 Key/端点/模型是否可用。

> 复盘时：AI 每轮出一道题，你在输入框作答并提交，AI 会给出 对 ✅ / 部分对 ⚠️ / 不对 ❌ 的评判和笔记原文引用。满 8 题自动结束，也可随时"结束复盘"查看报告。

## 数据与隐私

- 所有数据（笔记、设置、复盘会话）都保存在本机项目目录下的 `data/` 文件夹（`notes.json` / `settings.json` / `reviews.json`）。
- API Key 明文保存在本地 `data/settings.json`——**只在你自己的电脑上使用**。若要备份/迁移，直接复制整个项目目录即可。
- 笔记内容只在调用 AI 总结 / 复盘时发送给你配置的 AI 厂商（请求由其 API 处理）。

## 项目结构

```
local-ai-notes/
├── server.js      # HTTP 服务入口：静态文件 + 全部 API 路由
├── storage.js     # JSON 文件存储（原子写入）
├── ai.js          # 统一 OpenAI 兼容调用 + 8 家厂商预设
├── review.js      # 提问式复盘引擎（出题/评判/报告）+ AI 总结
├── public/        # 前端（原生三件套）
│   ├── index.html
│   ├── app.css
│   └── app.js
└── data/          # 运行时生成：笔记与设置
```

## API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET /api/notes | 笔记列表（按更新时间排序） | |
| POST /api/notes | 新建笔记 `{title, content, tags}` | |
| GET/PUT/DELETE /api/notes/:id | 单篇笔记读写删 | |
| GET /api/settings · PUT /api/settings | 读/存 AI 配置（读时脱敏，不返回 Key） | |
| GET /api/providers | 厂商预设列表 | |
| POST /api/ai/summarize | `{noteId}` → `{summary}` | |
| POST /api/ai/review/start | `{noteId}` → `{sessionId, question}` | |
| POST /api/ai/review/answer | `{sessionId, answer}` → `{verdict, nextQuestion, done, stats}` | |
| POST /api/ai/review/end | `{sessionId}` → `{report}` | |

## 修改指南

- **换 AI 厂商 / 改默认模型**：`ai.js` 顶部的 `PROVIDERS` 数组；运行中也可直接在设置页改（优先级更高）。
- **一轮复盘题数**：`review.js` 顶部 `MAX_QUESTIONS`（默认 8）。
- **笔记上下文上限**：`review.js` 顶部 `MAX_NOTE_CHARS`（默认 12000 字符，超出截断）。
- **端口**：`PORT` 环境变量。
- **界面文案/样式**：`public/index.html`（结构）、`public/app.css`（样式）、`public/app.js`（逻辑，含复盘状态管理）。
- **工具栏按钮与插入规则**：`public/app.js` 的 `MD_RULES` 对象（加按钮需同时改 `index.html` 的 `#mdToolbar`）。
- **自定义 AI 提供商**：设置页选择“自定义（OpenAI 兼容）”后手动填 Base URL 与模型名；任何 OpenAI 兼容端点都适用。

## 已知限制

- 单用户本地版：无登录、无多端同步、无协作（后续部署服务器时可加）。
- 复盘评判质量取决于所选模型：国产大模型（DeepSeek/GLM/通义）中文评判效果好；评判严格锚定笔记原文（提示词已内置"只依据笔记原文、禁止外挂知识"规则）。
- Anthropic 官方 OpenAI 兼容层定位为测试用途，其 JSON mode 无效，本应用已用宽松 JSON 解析兜底，但偶发解析失败时会提示重试。
- API Key 明文存储：不要在有共享账户/公共电脑上使用。

## 验证情况（2026-08-08）

- 后端 API 冒烟测试通过：笔记 CRUD（含中文）、设置读写（脱敏）、providers 列表、无 Key 报错、404 处理。
- 静态资源 /、/app.css、/app.js 均 200。
- 反方审稿发现的 2 个 P0 + 5 个 P1 已全部修复，并用 mock AI 做了 26 项回归断言，全部通过：复盘全流程（出题→评判→乱码自动重试→强制结束→报告）、报告建议列表、畸形编码不崩溃、恶意 Host 拒绝、参数错误 4xx、超大请求体 413、路径穿越拦截。
- AI 真实调用需你自己配置 Key 后验证（各家端点已按 2026-08 官方文档核实）。
