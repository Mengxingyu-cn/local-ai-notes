# 本地 AI 笔记（Local AI Notes）

> A zero-dependency, local-first AI note app with AI summarization and quiz-based review.

一个**完全本地运行**的 AI 笔记应用：Markdown 笔记管理 + AI 总结 + 多 AI 厂商接入 + **提问式复盘**（AI 出题 → 你回答 → AI 依据笔记原文评判对错）。

**零依赖**：后端只用 Node.js 内置模块，前端是原生 HTML/CSS/JS，**不需要 npm install**，数据全部保存在你自己的电脑上。

## 功能

| 功能 | 说明 |
|---|---|
| 📝 笔记管理 | 新建 / 编辑 / 删除（软删除进回收站）/ 搜索 / 标签筛选，1 秒自动保存，支持撤销重做（Ctrl+Z / Ctrl+Y） |
| 🖥 实时渲染编辑 | Typora 同款所见即所得：文档始终显示排版效果；光标所在的**标题/列表/引用/代码块/表格**显示 Markdown 源码（`# `、`- `、`> `、``` 围栏、`\| 表格 \|` 可见），光标离开立刻渲染；支持图片、表格、分割线、行内代码、加粗斜体；中文输入法、粘贴、Tab 流畅支持 |
| 🖱 Markdown 工具栏 | 加粗 / 斜体 / 标题 / 列表 / 引用 / 代码 / 链接 / 图片 / 分割线，一键插入，支持字号调节（A⁻/A⁺） |
| 📑 侧边栏目录 | 一键生成标题大纲（H1-H3），点击跳转 |
| 🏷 标签分类 | 标签筛选 + 快捷标签一键添加/移除 + 列表显示标签 |
| 🔀 笔记排序 | 按时间（默认）/ 名称 A-Z / 自定义（拖动排序） |
| 🗑 回收站 | 删除的笔记先进回收站（含 AI 总结一并保留），可恢复或彻底删除 |
| 💾 导出 | 单篇导出 .md 文件；全部笔记一键导出为一个 .md 文件 |
| ✨ AI 总结 | 一键生成结构化总结，自动保存到笔记，重新打开可见；已总结笔记再次点击会询问是否重新生成 |
| 🔌 多 AI 接入 | 预设 DeepSeek / Kimi / OpenAI / 通义千问 / 智谱 / OpenRouter / Anthropic / Ollama + 自定义 OpenAI 兼容端点 |
| 🧠 标签组复盘 | 按标签组聚合笔记内容，AI 逐题提问 → 你回答 → AI 判定 对/部分对/不对并引用笔记原文；一轮 8 题 |
| 📚 复盘历史 | 每次复盘报告自动保存：统计、薄弱点、学习建议 + **答题详情**（题目/你的回答/评判/原文引用，支持错题回看） |

## 快速开始

### 第一步：安装 Node.js

需要 [Node.js](https://nodejs.org/) **18 或更高版本**（v22 已测试）。官网下载 LTS 版安装即可，安装完成后在终端验证：

```bash
node -v   # 应显示 v18 或更高
```

### 第二步：获取代码

- **方式 A（推荐，方便升级）：** `git clone https://github.com/<你的用户名>/local-ai-notes.git`
- **方式 B：** 在仓库页面点击 Code → Download ZIP，解压到任意目录

### 第三步：启动

**Windows**：双击 `start.bat`（自动检查 Node、自动打开浏览器）。

**macOS / Linux**：在项目目录下打开终端：

```bash
node server.js
# 或者（已安装依赖管理器时）：
npm start
```

然后浏览器访问 **http://localhost:3000**。

自定义端口（按你的系统选择）：

- macOS / Linux：`PORT=8080 node server.js`
- Windows cmd：`set PORT=8080 && node server.js`
- Windows PowerShell：`$env:PORT=8080; node server.js`

> ⚠️ **安全提示**：服务只监听本机（127.0.0.1），这是有意设计——应用没有登录认证，**请勿修改代码将监听地址改为 0.0.0.0**，否则局域网任何人都能读写你的笔记并消耗你的 API 配额。

### 第四步：配置 AI Key

1. 点击右上角 **⚙️ 设置**，选择 AI 提供商，填入 API Key 和模型名，先点 **🔌 测试连接** 验证，再点 **保存**。
2. 各厂商 Key 获取地址：
   - DeepSeek：<https://platform.deepseek.com>
   - Kimi：<https://platform.moonshot.cn>
   - 通义千问（百炼）：<https://bailian.console.aliyun.com>
   - 智谱：<https://open.bigmodel.cn>（GLM 免费档模型）
   - Ollama 本地：先 `ollama pull qwen3:8b` 再启动 `ollama serve`，Key 随便填

> ⚠️ **模型名时效提示**：应用内置的预设模型名以发布时官方文档为准，厂商迭代快，可能已过期。报"模型不存在"时请到对应厂商官方文档查询最新模型名，在设置页直接修改即可（也可选"自定义（OpenAI 兼容）"填任意端点）。

## 常见问题（FAQ）

**打不开 http://localhost:3000？**
1. 确认启动窗口还在（关掉窗口 = 停止服务）；2. 确认端口没被占用（见下一条）；3. 用浏览器无痕窗口再试。

**端口被占用？**
换端口启动（见"快速开始"的 PORT 说明），或关掉占用 3000 端口的程序（Windows 可在启动窗口看到提示）。

**AI 报错各是什么意思？**
- 401：API Key 无效或未配置 → 去设置页重新填 Key
- 402：账户余额不足 → 去厂商控制台充值
- 403：无权限访问该模型 → 检查账号的模型权限
- 404：接口地址或模型不存在 → 检查 Base URL 与模型名
- 429：请求频率超限或配额不足 → 稍后再试或换模型
- 5xx / 503：AI 服务端暂时不可用 → 稍后重试，或换一家提供商
- "请求超时"：网络慢或模型慢 → 换更快的模型或检查网络

**AI 总结后刷新就没了？**
总结会自动保存到笔记里（笔记对象含 `summary` 字段）。如果你修改过代码，请重启 `node server.js`（后端改动必须重启进程才生效）并硬刷新浏览器（Ctrl+Shift+R）。

## 数据、备份与升级

- **所有数据都在项目目录的 `data/` 文件夹里**（这也是唯一需要备份的东西）：
  - `notes.json`：笔记内容（含 AI 总结）
  - `settings.json`：AI 配置（含 API Key）
  - `reviews.json`：进行中的复盘会话
  - `review-history.json`：复盘历史记录
  - `trash.json`：回收站
- **备份/迁移**：直接复制 `data/` 目录即可。换电脑 = 装 Node + 拷贝项目（或新安装后把 `data/` 放回）。
- **升级**：`git pull` 不会碰你的数据（`data/` 已被 .gitignore 排除）；下载新版覆盖时，先备份 `data/`，覆盖除 `data/` 外的文件后把 `data/` 放回。
- **数据保护**：写入采用原子替换，存储文件损坏时自动备份为 `data/*.bak-时间戳` 并回退默认值（不会静默覆盖丢数据）。
- 另外应用内置 **导出功能**：顶栏"⬇ 导出"导出当前笔记 .md，侧边栏"💾 全部导出"把全部笔记导出为一个 .md 文件。

## 数据与隐私

- **API Key 明文保存在本地** `data/settings.json`——只在你自己的电脑上使用，不要在共享账户/公共电脑上使用，不要把这个文件发给任何人。
- 笔记内容**只在调用 AI 总结/复盘时**发送给你配置的 AI 厂商。
- 复盘评判严格锚定笔记原文：提示词内置规则，笔记内容中的任何指令都不会被执行（防提示词注入）。

## 项目结构

```
local-ai-notes/
├── server.js      # HTTP 服务入口：静态文件 + 全部 API 路由
├── storage.js     # JSON 文件存储（原子写入 + 损坏自动备份）
├── ai.js          # 统一 OpenAI 兼容调用 + 8 家厂商预设
├── review.js      # 提问式复盘引擎（出题/评判/报告）+ AI 总结 + 复盘历史
├── start.bat      # Windows 双击启动脚本
├── public/        # 前端（原生三件套）
│   ├── index.html
│   ├── app.css
│   └── app.js
└── data/          # 运行时生成：笔记与设置（已被 .gitignore 排除）
```

## API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/notes | 笔记列表（按更新时间排序） |
| POST | /api/notes | 新建笔记 `{title, content, tags}` |
| GET | /api/notes/:id | 单篇笔记详情 |
| PUT | /api/notes/:id | 更新笔记（title/content/tags，部分更新） |
| DELETE | /api/notes/:id | 软删除笔记（移入回收站） |
| POST | /api/notes/reorder | 自定义排序 `{ids: [...]}` |
| GET | /api/trash | 回收站列表 |
| POST | /api/trash/:id/restore | 恢复回收站笔记 |
| DELETE | /api/trash/:id | 彻底删除回收站笔记 |
| POST | /api/trash/clear | 清空回收站 |
| GET | /api/settings | 读 AI 配置（脱敏，不返回 Key） |
| PUT | /api/settings | 保存 AI 配置 |
| GET | /api/providers | 厂商预设列表 |
| POST | /api/ai/test | 连通性测试（不保存） |
| POST | /api/ai/summarize | `{noteId}` → `{summary}`（自动持久化） |
| POST | /api/ai/review/start | `{tag}` 或 `{noteId}` → `{sessionId, question, noteTitle}` |
| POST | /api/ai/review/answer | `{sessionId, answer}` → `{verdict, nextQuestion, done, stats}` |
| POST | /api/ai/review/end | `{sessionId}` → `{report}`（自动存入复盘历史） |
| GET | /api/review-history | 复盘历史列表 |
| GET | /api/review-history/:id | 单条复盘记录详情 |
| DELETE | /api/review-history/:id | 删除复盘记录 |

## 修改指南

- **换 AI 厂商 / 改默认模型**：`ai.js` 顶部的 `PROVIDERS` 数组（注意与 `storage.js` 的 `DEFAULT_SETTINGS` 保持一致）；运行中可直接在设置页改（优先级更高）。
- **一轮复盘题数**：`review.js` 顶部 `MAX_QUESTIONS`（默认 8）。
- **笔记上下文上限**：`review.js` 顶部 `MAX_NOTE_CHARS`（默认 12000 字符，标签组复盘为 2 倍）。
- **端口**：`PORT` 环境变量。
- **界面文案/样式**：`public/index.html`（结构）、`public/app.css`（样式）、`public/app.js`（逻辑）。
- **工具栏按钮与插入规则**：`public/app.js` 的 `MD_RULES` 对象。
- **Markdown 渲染规则**：`public/app.js` 的 `renderMarkdown` / `inlineMd` 函数。

## 已知限制

- 单用户本地版：无登录、无多端同步、无协作。
- 界面与注释为中文（i18n 在路线图中）。
- 复盘评判质量取决于所选模型：国产大模型（DeepSeek/GLM/通义）中文评判效果好。
- 预设模型名可能随厂商迭代过期（见 FAQ）。

## 许可证

[MIT](LICENSE) © 2026 Mengxingyu

## 测试情况（2026-08-18）

- 后端 API 冒烟测试：笔记 CRUD、回收站全链路（软删除/恢复/彻底删除/清空）、复盘历史、设置读写脱敏、参数校验 4xx、路径穿越拦截、超大请求体 413。
- 编辑器回归：Markdown 渲染（含表格/图片/分割线）与 DOM↔Markdown 往返一致性、光标映射、撤销重做逻辑，均通过自动化脚本验证。
- AI 真实调用需配置 Key 后验证。
