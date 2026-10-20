# 意方通行 · Ihou Tsukou

意方通行（English name: **Ihou Tsukou**）是一个可加载到 Chrome / Edge 的 Manifest V3 扩展，用用户自己配置的 OpenAI 兼容模型翻译网页、划词文本和视频字幕。界面以中文为主，支持浅色 / 深色主题。

- 网页：整页双语对照、仅译文替换、原文恢复、暂停 / 继续、划词翻译、动态内容增量翻译。
- 字幕：页面原生 `TextTrack`、本地 SRT / VTT 导入、三种显示模式、样式设置、多视频切换；语音识别为实验功能。
- 模型：多套配置、连接测试、任务角色、Base URL / 模型 ID / 请求头 / 参数 / 温度 / 最大输出均可手动配置。
- 密钥：只保存在扩展本地存储，内容脚本和网页永远拿不到完整设置；不会写入页面、日志或缓存键。

> 当前版本为 `0.1.0`。项目没有内置任何 API Key 或模型 ID，首次使用必须自行添加可用模型。

---

## 快速开始

### 环境

- Node.js 20 或更新版本（本机验证使用 Node `24.21.0`）
- pnpm 9 或更新版本（本机验证使用 pnpm `11.28.0`）
- Chrome / Edge，Manifest V3 要求 Chrome 114+（本机验证使用 Edge `155.0.4283.62`）

### 安装、检查、构建

```powershell
cd ihou-tsukou
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

`pnpm build` 会依次执行 TypeScript 严格检查、扩展主构建和内容脚本 IIFE 构建。产物在 `dist/`：

```text
dist/
  manifest.json
  background.js          # Service Worker
  content.js             # IIFE 内容脚本
  popup.html
  options.html
  assets/
  icons/
```

> 如果终端里没有 `node` 命令，但已经安装 Node，可以直接用 Node 可执行文件运行项目内的脚本：
>
> ```powershell
> node .\node_modules\typescript\bin\tsc --noEmit
> node .\node_modules\vitest\vitest.mjs run
> node .\node_modules\vite\bin\vite.js build
> node .\node_modules\vite\bin\vite.js build -c vite.content.config.ts
> ```

### 加载扩展

1. 打开 `edge://extensions`（Chrome 为 `chrome://extensions`）。
2. 打开右上角“开发人员模式”。
3. 点击“加载解压缩的扩展”，选择本项目的 `dist` 目录。
4. 建议把意方通行固定到工具栏，然后刷新要翻译的网页。
5. 打开扩展设置，添加模型并点击“测试连接”。

更新代码后重新执行 `pnpm build`，再在扩展管理页点击刷新按钮；已经打开的内容脚本页面需要刷新页面才会使用新版本。

### 配置模型

进入“设置 → 模型与 API → 添加模型”，字段含义：

| 字段 | 说明 |
| --- | --- |
| 配置名称 | 仅用于界面显示，例如“我的翻译模型” |
| 服务商名称 | 自由文本，例如服务商名称 |
| Base URL | API 根地址或完整端点；只允许 HTTPS，或 `http://localhost` / `http://127.0.0.1` 本机调试 |
| API Key | 只保存到 `chrome.storage.local`；编辑时留空表示保留原密钥 |
| 协议 | `OpenAI Chat Completions` 或 `OpenAI Audio Transcriptions` |
| 模型 ID | 手动填写服务商实际提供的模型 ID，扩展不猜测 |
| 自定义请求头 | JSON 对象；可用于自定义鉴权头，不允许 CRLF 和受限请求头 |
| 附加参数 | JSON 对象；会合并进请求体，不能覆盖 `messages`、`model`、`stream` |
| 温度 | 可选，0–2 |
| 最大输出长度 | 可选，1–200000 |
| 最大输出字段 | `max_tokens` 或 `max_completion_tokens` |
| 启用 | 关闭后不会被任务选中 |

Base URL 可以填写：

```text
https://your-provider.example/v1
https://your-provider.example/v1/chat/completions
http://127.0.0.1:8080/v1
```

扩展会自动拼接 `/chat/completions`、`/audio/transcriptions` 或 `/models`，不会重复路径。

任务角色：

- **网页翻译**：popup 中可选择当前网页使用的 Chat 模型。
- **高质量翻译**：长文或质量优先场景；未设置时回退网页模型。
- **字幕翻译**：字幕面板使用；未设置时回退高质量 / 网页模型。
- **语音识别**：必须是 Audio Transcriptions 协议；未设置时 ASR 按钮会明确提示。

保存后请使用“测试连接”。连接测试会发送真实请求：Chat 模型发送一条要求返回 `OK` 的短消息，Audio 模型发送一段 0.25 秒静音 WAV。错误会区分无效密钥、限流、超时、网络错误、响应格式错误等，且服务端返回中的密钥会被脱敏。

---

## 目录结构

```text
ihou-tsukou/
├─ public/
│  ├─ manifest.json              # MV3 清单、权限、命令、CSP
│  └─ icons/                     # 16/32/48/128 图标
├─ src/
│  ├─ background/
│  │  ├─ index.ts                # Service Worker 入口、badge、端口广播、命令
│  │  ├─ router.ts               # 消息路由、发送方权限、tab 命令、状态上报
│  │  ├─ model-service.ts        # 模型 CRUD、任务分配、连接测试
│  │  └─ state.ts                # 页面 / 字幕状态清洗、进度
│  ├─ providers/
│  │  ├─ http.ts                 # URL 规范化、超时、错误分类、脱敏
│  │  ├─ openai.ts               # Chat Completions / Audio 适配器
│  │  ├─ factory.ts              # 按协议创建 provider
│  │  └─ types.ts                # Provider 抽象
│  ├─ translation/
│  │  ├─ service.ts              # 模型选择、缓存、重试、批处理
│  │  ├─ prompt.ts               # 系统提示和 JSON 协议
│  │  ├─ parse.ts                # 模型输出解析和完整性校验
│  │  ├─ placeholder.ts          # URL / 邮箱 / 术语占位保护
│  │  ├─ segments.ts             # 长文本切分与合并
│  │  └─ cache.ts                # 持久化 LRU 翻译缓存
│  ├─ webpage/
│  │  ├─ extract.ts              # TreeWalker 文本抽取、排除规则
│  │  └─ translator.ts           # DOM 改写、批队列、MutationObserver、恢复
│  ├─ subtitles/
│  │  ├─ parser.ts               # SRT / WebVTT 解析与清洗
│  │  ├─ native.ts               # 原生 TextTrack 读取 / 模式恢复
│  │  ├─ timeline.ts             # 按 currentTime 查找活动 cue、分组
│  │  ├─ translator.ts           # 字幕批量翻译
│  │  └─ controller.ts           # 视频发现、会话、ASR、覆盖层调度
│  ├─ asr/
│  │  ├─ types.ts                # 独立 AsrProvider 接口、能力检测
│  │  ├─ openai.ts               # Audio 适配器
│  │  └─ audio-chunker.ts        # captureStream + Web Audio + WAV 分块
│  ├─ settings/
│  │  ├─ defaults.ts             # 默认设置
│  │  ├─ validation.ts           # 模型 / 设置 / Base URL 校验、公共快照
│  │  └─ repository.ts           # 串行化写入、Chrome / 内存存储
│  ├─ content/
│  │  ├─ index.tsx               # 内容脚本挂载、消息、划词、状态上报
│  │  └─ ui/                     # Shadow DOM 内的 React 覆盖层
│  ├─ popup/                     # 工具栏弹窗
│  ├─ options/                   # 设置页（模型 / 翻译 / 字幕 / 通用）
│  └─ shared/                    # 类型、常量、错误、消息、工具、WAV
├─ tests/                        # Vitest（jsdom + Node HTTP mock）
├─ scripts/
│  ├─ edge-probe.mjs             # Edge headless 加载探针
│  └─ e2e-smoke.mjs              # 完整本地 E2E（46 项检查）
├─ artifacts/                    # E2E 证据（截图、结果 JSON）
├─ vite.config.ts                # popup / options / background
├─ vite.content.config.ts        # 单文件 IIFE content.js
├─ vitest.config.ts
└─ package.json
```

---

## 架构与安全边界

- **Service Worker 是唯一能读取完整 API 配置的地方**。内容脚本只能拿到 `PublicSettings`（模型名称、ID、协议、语言、风格等），没有 `apiKey`、`baseUrl`、自定义请求头。
- 内容脚本通过 `chrome.runtime.sendMessage` 请求翻译；API 请求只在 Service Worker 中发出。
- `chrome.storage.local` 调用 `setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })`，阻止内容脚本直接读取设置存储。
- 兼容旧版本：首次读取会加载旧存储键中的设置和缓存，后续保存写入新键，改名升级不会直接丢失已配置模型或缓存。
- 页面 DOM 只接收译文文本；不读取或写入 `innerHTML`，不执行模型返回的 HTML / JavaScript。
- 模型响应按 JSON 协议解析并校验；字幕文本通过 React 文本节点 / `textContent` 渲染，不拼接 HTML。
- 请求跟随重定向被禁用（`redirect: 'error'`），避免把 `Authorization` 带到另一个源。
- API Base URL 仅允许 HTTPS；HTTP 只允许本机回环地址用于开发。
- 密钥不会进入翻译缓存键、页面 DOM、tab 状态快照、日志或错误响应；服务端回显的 `Bearer ...` 也会被脱敏。
- `host_permissions: ["<all_urls>"]` 是为了让用户配置的任意 HTTPS API 可被 Service Worker 访问，以及向普通网页注入内容脚本。这是较宽的权限，安装时请确认你接受；扩展不会把页面内容上传，除非你主动触发翻译。

---

## 状态说明

本文使用以下四种状态，严格区分“代码存在”和“已经验证”：

- **已完成**：功能已实现，主路径可用。
- **已测试**：有自动化测试或真实浏览器 E2E 覆盖。
- **仅实现未验证**：代码已完成，但缺少真实环境或外部服务验证。
- **尚未实现**：当前版本没有该能力。

### 1. 网页翻译

| 能力 | 状态 | 验证情况 |
| --- | --- | --- |
| 当前页整页翻译 | 已完成 / 已测试 | E2E 翻译 5/5 段 |
| 双语对照 | 已完成 / 已测试 | E2E 检查原文与译文并存、链接和事件保留 |
| 仅译文替换 | 已完成 / 已测试 | Vitest 覆盖替换、切回双语、精确恢复 |
| 原文恢复 | 已完成 / 已测试 | E2E 清除所有译文 span，Vitest 校验原文空白 |
| 暂停 / 继续 | 已完成 / 已测试 | E2E 命令状态验证；取消进行中的请求 |
| 重新翻译 | 已完成 / 已测试 | E2E 从 popup 主按钮触发，产生新请求并完成 |
| 划词翻译 | 已完成 / 已测试 | E2E 选中文本 → 触发按钮 → 显示中文译文 |
| 源 / 目标语言 | 已完成 / 已测试 | 设置持久化、popup 更新、请求携带语言 |
| 自动检测 | 已完成 | 源语言 `auto` 交给模型判断，没有本地语言识别器 |
| 默认模型 / 风格 | 已完成 / 已测试 | 设置保存、任务角色回退、缓存键包含风格 |
| TreeWalker 抽取 | 已完成 / 已测试 | 不使用 `innerHTML`；跳过脚本、样式、代码、编辑器、扩展 UI、SVG、iframe 等 |
| 结构 / 事件 / 样式保留 | 已完成 / 已测试 | E2E 点击事件仍为 1；只插入 `<span data-ihou-tsukou="translation">` |
| SPA / 无限滚动增量 | 已完成 / 已测试 | MutationObserver + 350ms 批扫描；E2E 动态插入段落 |
| 重复 / 循环防护 | 已完成 / 已测试 | 扩展节点跳过、记录去重、Vitest 重复 start 检查 |
| 取消 / 暂停 | 已完成 / 已测试 | AbortController、generation 失效、队列清空 |
| 批处理 | 已完成 / 已测试 | 按字符数和条数分组，并发度 2 |
| 原文记录 / 失败重试 | 已完成 / 已测试 | 记录稳定原文；Vitest 模拟失败后 `retryFailed` |
| 进度 / 失败统计 | 已完成 / 已测试 | badge、popup 状态、E2E 完成/失败计数 |
| 不静默上传整页 | 已完成 | 只有用户点击 / 快捷键才启动；之后只对新增变化增量翻译 |

快捷键已注册：`Alt+A` 翻译/暂停/继续/重翻、`Alt+Shift+A` 恢复原文、`Alt+S` 打开字幕面板。真实键盘按键没有在 E2E 中模拟，命令处理逻辑已通过消息路由验证。

### 2. 翻译质量

| 能力 | 状态 | 验证情况 |
| --- | --- | --- |
| 语言与目标语言 | 已完成 / 已测试 | 请求参数、缓存键、同语言拒绝 |
| `natural / accurate / formal / casual / technical` | 已完成 / 已测试 | 风格进入提示与缓存键 |
| 自定义 Prompt | 已完成 / 已测试 | 设置页输入、长度限制、公共快照只暴露是否启用 |
| 术语表 / 保护词 | 已完成 / 已测试 | 占位符保护、恢复校验；Vitest 覆盖术语翻译 |
| 上下文 | 已完成 / 已测试 | 全局上下文 + 划词页面标题；长度受限 |
| 长文本切分 | 已完成 / 已测试 | 1800 字符切分，保持分隔符并合并 |
| 顺序 / 完整性校验 | 已完成 / 已测试 | ID 映射、数量检查、缺失即失败 |
| 格式校验 / 批量回退 | 已完成 / 已测试 | JSON 解析失败时单条重试，避免整批丢失 |
| URL / 邮箱保护 | 已完成 / 已测试 | `⟦P0⟧` 占位；E2E 链接和邮箱原样保留 |

### 3. 视频字幕

| 能力 | 状态 | 验证情况 |
| --- | --- | --- |
| 检测 / 选择多个视频 | 已完成 / 已测试 | E2E 追加第二个视频后检测到 2 个并切换会话 |
| 原生 TextTrack 优先 | 已完成 / 已测试 | E2E 读取 2 条 cue、隐藏原生轨道、翻译并显示覆盖层 |
| SRT 导入 | 已完成 / 已测试 | E2E 导入 2 条、翻译、显示 |
| WebVTT 导入 | 已完成 / 已测试 | Vitest 解析 / 清洗；E2E 原生 VTT 轨道 |
| 原生 > 导入 > ASR 顺序 | 已完成 | 默认启用只尝试原生；导入是显式操作；ASR 是显式实验操作 |
| 保留时间轴 | 已完成 / 已测试 | cue 起止时间不变；Vitest 校验解析 |
| 批量翻译 | 已完成 / 已测试 | 字幕分组、并发 2、缓存 |
| 译文 / 原文 / 双语模式 | 已完成 / 已测试 | E2E 三种模式均验证 |
| 字幕样式 | 已完成 / 已测试 | E2E 字号 30px、颜色 `rgb(255, 204, 0)`、透明度写入 |
| 启用 / 禁用 | 已完成 / 已测试 | E2E 禁用移除覆盖层并恢复原生轨道；重新启用恢复译文 |
| 暂停 / 倍速不漂移 | 已完成 | 覆盖层每 100ms 读取 `video.currentTime`，不按 wall clock 推进；Vitest 校验倍速时间线 |
| 失败保留原文 | 已完成 / 已测试 | Vitest 模拟 API 失败，原文仍在；仅译文模式回退原文显示 |
| HTML 转义 | 已完成 / 已测试 | React 文本节点渲染；解析器剥离标签、解码实体 |
| 翻译缓存 | 已完成 / 已测试 | 与网页共用持久化 LRU 缓存 |
| ASR 音频捕获 / 识别 | 仅实现未验证 | 代码使用 `captureStream` + Web Audio + WAV 分块；未在真实视频/真实 ASR 服务上跑通 |
| DRM / 跨域保护 | 已完成 | 检测 `mediaKeys`、无 `captureStream`、无媒体源；不尝试绕过 |
| YouTube / 自绘播放器 CC 抓取 | 尚未实现 | 当前只读 `video.textTracks`；YouTube 的内置 CC 通常是播放器 DOM，需要专用适配 |
| iframe 内视频 | 尚未实现 | 内容脚本 `all_frames: false`，不进入子 frame |
| 全屏 `<video>` 本身上的覆盖层 | 部分实现 | 覆盖层会移动到全屏容器；若全屏元素就是 `<video>`，浏览器顶层渲染限制下无法保证可见 |

### 4. 语音识别（ASR）

| 能力 | 状态 | 验证情况 |
| --- | --- | --- |
| 独立 Provider 接口 | 已完成 / 已测试 | `AsrProvider`、`OpenAIAsrProvider`；Vitest 校验请求形状 |
| 原生 / 导入 / ASR / 音频不可用状态区分 | 已完成 / 已测试 | `source` 字段、能力检测 reason、面板提示 |
| 优先原生 / 导入 | 已完成 | ASR 只能通过“开始识别”显式触发 |
| 真实音频采集与识别 | 仅实现未验证 | 未在真实媒体上验证音轨、采样、识别质量与时间轴 |
| 真实 ASR 服务兼容 | 仅实现未验证 | 仅本地 mock 验证了 Audio Transcriptions 请求形状 |

ASR 的已知限制会在面板中直接显示：需要 Audio 模型、需要可捕获的非 DRM 媒体、按约 8 秒分块、时间轴为近似值、跨域媒体可能只得到静音。不要把它理解为可靠的实时会议转写。

### 5. 模型与 API

| 能力 | 状态 | 验证情况 |
| --- | --- | --- |
| 多套模型配置 | 已完成 / 已测试 | Vitest CRUD / 并发保存 |
| 名称 / 服务商 / Base URL / Key / 协议 / 模型 ID | 已完成 / 已测试 | 校验与保存 |
| 自定义请求头 / 附加参数 | 已完成 / 已测试 | 合并顺序、CRLF 拦截、受保护字段 |
| 温度 / 最大输出 / 字段名 | 已完成 / 已测试 | 范围校验、字段选择 |
| 测试 / 编辑 / 启用 / 复制 / 删除 / 默认 | 已完成 / 已测试 | Vitest 模型服务；E2E 设置保存和公共快照 |
| 任务角色 webpage / quality / subtitles / asr | 已完成 / 已测试 | 回退逻辑与协议校验 |
| OpenAI Chat Completions 适配器 | 已完成 / 已测试 | 本地 HTTP mock 覆盖请求、响应、错误 |
| Audio Transcriptions 适配器 | 已完成 / 已测试 | multipart、模型、语言、错误 |
| 不假设流式 / 模型列表 / 统一鉴权 | 已完成 | 固定 `stream: false`；模型列表是显式按钮；支持自定义鉴权头 |
| 手动 Base URL / 模型 ID | 已完成 / 已测试 | 无内置模型或密钥 |
| 真实连接测试 | 已完成 / 已测试（本地 mock） | 真实公网服务未验证 |
| 差异化 HTTP 错误 | 已完成 / 已测试 | 401 / 429 / 超时 / 网络 / 响应格式 |
| HTTPS / 本机 HTTP 限制 | 已完成 / 已测试 | Base URL 校验 |
| 密钥隔离与脱敏 | 已完成 / 已测试 | E2E 页面无 `chrome.storage`、DOM 无密钥、错误脱敏 |
| 删除密钥 / 清空数据 | 已完成 / 已测试 | 设置页操作与路由权限 |

### 6. UI

| 能力 | 状态 | 验证情况 |
| --- | --- | --- |
| 中文优先、浅色 / 深色 | 已完成 / 已测试 | E2E 切换深色 / 浅色并校验 `data-theme`；浅色截图 |
| Popup | 已完成 / 已测试 | E2E 渲染当前页面、模型、进度；主按钮触发重翻 |
| 设置页 | 已完成 / 已测试 | E2E 打开、模型持久化、添加模型编辑器 |
| 划词浮层 | 已完成 / 已测试 | E2E 触发与译文；Escape / 外部点击 / 滚动关闭 |
| 字幕面板 | 已完成 / 已测试 | E2E 面板、读取原生、导入、翻译、样式、多视频 |
| 加载 / 成功 / 错误 / 无权限 / 不支持页面 | 已完成 | 组件和错误码齐全；不支持页面分支未做 E2E |
| 所有按钮可用 | 已完成（按代码路径）/ 部分已测试 | 关键路径有 E2E；没有逐个点击所有设置项 |

### 7. 尚未实现 / 明确限制

- 不进入 iframe、不遍历闭合的页面 Shadow DOM。
- 不提供本地语言检测器；`auto` 由模型判断。
- 不提供流式输出；固定非流式请求，避免不同服务端流格式差异。
- 不提供 Firefox / Safari 版本，也没有独立的侧边栏页面。
- 不内置 OCR、图片翻译、PDF 翻译。
- 不提供字幕文件导出、翻译记忆库管理 UI、术语表导入导出。
- 原生字幕是否可读取决于站点、CORS、播放器和 DRM；不可读时会明确报错。
- **YouTube 内置 CC 当前不保证可抓取**：YouTube 通常把字幕绘制在播放器自己的 `.ytp-caption-*` DOM 中，而不是暴露为 `video.textTracks`。当前版本只读标准 TextTrack 和本地 SRT/VTT，尚未实现 YouTube 专用适配；在 YouTube 上可能显示“未检测到原生字幕轨道”。
- 全屏元素为 `<video>` 本身时，覆盖层受浏览器顶层渲染限制。
- ASR 依赖实验性的 `captureStream` + `ScriptProcessorNode`，时间轴粗略，不能保证与语音逐字同步。
- 公网 API 的兼容性、模型 JSON 遵循度、限流策略和实际费用未由本项目验证；请先用自己的密钥做低成本连接测试。

---

## 测试与验证结果

验证日期：2026-10-21（Asia/Shanghai）。

### 自动化测试

```text
Test Files  9 passed (9)
Tests       69 passed (69)
```

覆盖范围：

- 设置与模型 CRUD、并发写入、密钥保留、Base URL / 请求头 / 参数校验。
- OpenAI Chat / Audio 传输：请求形状、鉴权、401、429、超时、网络错误、脱敏、multipart。
- 翻译解析、占位符、长文本切分、缓存键、批处理回退、术语表、同语言拒绝。
- 网页抽取、双语 / 替换 / 恢复、重复防护、动态内容、失败重试、300 节点性能。
- SRT / VTT 解析、异常块、时间线倍速、分组。
- 字幕控制器：无原生字幕、导入、翻译、覆盖层、失败保留原文、停止、ASR 无模型。
- 后台发送方隔离：内容脚本不能读完整设置 / 写模型 / 清数据；UI 不能伪造翻译或状态上报。
- ASR 能力检测、重采样、WAV、Audio Provider 请求、连接测试。
- 缓存清理竞态、旧版设置 / 缓存键迁移、tab 状态清洗、WAV 编码。

### TypeScript

```text
tsc --noEmit
（无输出，退出码 0）
```

### 构建

```text
vite build                         ✓
vite build -c vite.content.config.ts ✓
```

产物约：

- `dist/background.js` 51.25 kB
- `dist/content.js` 300.14 kB
- popup / options / assets / icons

### 真实浏览器 E2E

运行：

```powershell
node .\scripts\e2e-smoke.mjs
```

结果：

```text
Browser: Edg/155.0.4283.62
Extension ID: algdelheolhbceikhdbcnbmaphjnjkdn
46/46 checks passed
```

E2E 使用本机随机端口的 **HTTP mock API**，不是公网服务。已验证：

- MV3 Service Worker、Manifest、设置页、popup、内容脚本挂载；深色 / 浅色主题切换；重复注入内容脚本只保留一个 UI 实例。
- 页面 JS 无法读取 `chrome.storage`，公共快照无密钥。
- 整页翻译 5/5、双语 DOM、链接 / 事件保留、URL / 邮箱占位保护。
- 动态内容、暂停、继续、恢复、划词翻译。
- 通过 popup 主按钮重新翻译并完成。
- 字幕面板、原生 TextTrack 读取与翻译、SRT 导入、覆盖层三种模式、样式、禁用 / 恢复、多个视频切换。
- 错误密钥产生 `INVALID_API_KEY` 且密钥不出现在错误中；修复密钥后重试成功。
- 无未捕获异常、无控制台错误。

证据文件：

- [`artifacts/e2e-results.json`](artifacts/e2e-results.json)
- [`artifacts/options.png`](artifacts/options.png)
- [`artifacts/popup.png`](artifacts/popup.png)
- [`artifacts/page.png`](artifacts/page.png)

截图由 headless Edge 生成，用于记录布局；本机验证没有用人工视觉审查替代自动化断言。

---

## 调试

### Service Worker

`edge://extensions` → 意方通行 → “Service Worker” 链接。可查看：

- 消息路由错误码（只记录错误码，不记录密钥）。
- badge 更新、tab 状态广播。
- 模型测试 / API 传输。

### 内容脚本

页面里扩展 UI 位于：

```html
<div id="ihou-tsukou-ui-host" data-ihou-tsukou-ui="true">
  #shadow-root
</div>
```

在 DevTools 中检查该 Shadow Root；页面正文的译文 span 带有：

```html
<span data-ihou-tsukou="translation" lang="zh-CN">...</span>
```

原文保存在内容脚本内存记录中，恢复时按记录写回，不依赖读取译文反推。

### 常见问题

| 现象 | 处理 |
| --- | --- |
| “没有配置模型” | 设置页添加 Chat 模型，设默认或分配网页任务 |
| 连接测试 401 | 检查 Key、鉴权头、服务商是否需要额外 header |
| 网络错误 | 检查 Base URL 是否 HTTPS / 本机 HTTP、代理、服务端 CORS / 防火墙 |
| 页面不支持 | 浏览器内置页、扩展页、`file://` 不允许内容脚本；换普通网页 |
| 原生字幕读取失败 | 站点可能通过 CORS / 播放器 / DRM 隐藏 cue；改用 SRT/VTT |
| ASR 按钮灰 | 没有 Audio 模型，或当前视频无法捕获音频 |
| 改了代码没生效 | 重新构建 → 扩展管理页刷新 → 再刷新网页 |

---

## 未来建议

1. 增加“站点级启用 / 禁用”与快捷键自定义，减少对全局 `<all_urls>` 的依赖。
2. 为字幕增加导出、时间轴微调、双语样式预设。
3. 用 WebCodecs / AudioWorklet 替代 `ScriptProcessorNode`，改善 ASR 分块和时间戳。
4. 为原生字幕增加 CORS 失败时的用户引导（导入同名字幕文件）。
5. 增加可选的本地语言检测器，减少一次模型判断。
6. 增加更多 Provider 适配器（Anthropic、Gemini 等），但保持“用户手动配置”的安全模型。
7. 为 iframe / Shadow DOM 视频和正文增加可配置的注入策略。
8. 增加 API 费用 / token 预算提示和请求日志导出（不含密钥）。

---

## 许可

本项目为本地工作区交付示例。使用第三方 API 时请遵守对应服务商条款；API 费用由用户自行承担。