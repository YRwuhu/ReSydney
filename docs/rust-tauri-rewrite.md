# Rust + Tauri 桌面应用重构方案

> 目标：把当前 Next.js 自托管 Web 服务（`lets-bingai-comeback`）重制为**纯本地单机桌面应用**。
> 架构方向：**Tauri 2 + Rust 内核 + 系统 WebView 前端**。
> 定位：去掉对外服务能力（OpenAI 兼容 `/completions` 端点、多用户、自托管），专注个人本地使用。

---

## 1. 现状盘点

### 1.1 两条核心对话链路

| 链路 | 传输 | 流式 | 鉴权 | 依赖 |
|---|---|---|---|---|
| 本地自定义 OpenAI 兼容接口 | HTTP `fetch` → `{baseURL}/chat/completions` | SSE（`data:` 分帧，含 `reasoning_content`）| `Authorization: Bearer <apiKey>` | 前端 `OpenAIBot` |
| 本地 New Bing（Sydney）代理 | HTTP `/api/sydney` 反向代理 → Bing `wss://sydney.bing.com/sydney/ChatHub` | `text/stream`（RS 分隔的 JSON-RPC 帧）| Cookie（`BING_HEADER`/`_U` + 伪造 IP）| 前端 `BingWebBot` + `pages/api/sydney` |

统一抽象：`src/lib/bots/bing/types.ts` 的 `ChatBot` 接口（`sendMessage` / `uploadImage` / `resetConversation` / `restoreMessages`），以及统一事件模型 `Event`（`UPDATE_ANSWER` / `DONE` / `ERROR`）。`createBotInstance()`（`src/state/index.ts`）根据 `openAIConfigAtom` 在 `OpenAIBot` / `BingWebBot` 间运行时切换。**整个 UI 只依赖 `ChatBot`，与具体后端解耦。**

### 1.2 状态管理（Jotai）

- `chatFamily`（atomFamily + Immer）：每个 `{botId, page}` 一个会话 atom，包含 `bot`、`messages`、`generatingMessageId`、`abortController`、`conversation`、`chatId`。
- 偏好原子：`bingConversationStyleAtom`、`voiceAtom`、`historyAtom`、`localPromptsAtom`（均 `atomWithStorage` 落 localStorage）。
- 配置原子：`openAIConfigAtom`（`src/state/openai.ts`）：baseURL / apiKey / model / 搜索提供方 / Kimi 原生搜索 / Partial Mode / 每样式高级模型参数。
- 历史原子：`chatHistoryAtom`、`localChatsAtom`（迁移自 `src/state/history.ts`）。

### 1.3 三层存储

| 层 | 技术 | 用途 |
|---|---|---|
| 浏览器 | IndexedDB（`idb-keyval`，`src/lib/storage.ts`） | 通用 blob / 本地持久化 |
| 浏览器 | localStorage（Jotai `atomWithStorage` / `namestorage`） | 偏好、配置、本地会话历史 |
| 服务端 | SQLite（`node:sqlite`，`src/lib/db.ts`） | 登录用户、session、聊天记录、OpenAI 配置 |

### 1.4 目前承担服务端职责的模块

- `src/pages/api/**`：auth（login/register/me/logout）、search（免费 Bing 抓取 / Serper / Tavily）、sydney（WS 反向代理）、create / image / kblob / blob.jpg、config、history、`openai/chat/completions`（**反向适配器**：OpenAI 入参 → Bing 出参）、proxy、healthz。
- `server.js`：自定义 Node HTTP server，桥接 `/completions`、`/models`、`/api/counts`。

---

## 2. 目标架构

```
┌──────────────────────────────────────────────┐
│  Tauri 2 桌面应用（单进程）                    │
│                                               │
│  ┌─────────────────────────────┐              │
│  │ 前段（系统 WebView 内）      │              │
│  │  React + Jotai（仅在 WebView │              │
│  │  渲染，不再发起网络/WS）      │              │
│  │  ├─ chat/chat-message        │ invoke /     │
│  │  ├─ markdown 渲染            │ listen       │
│  │  └─ 设置 / 历史面板          │ (RPC)        │
│  └───────────────┬─────────────┘              │
│                  │ @tauri-apps/api            │
│  ┌───────────────▼─────────────┐              │
│  │ Rust 内核（业务逻辑全在此）   │              │
│  │  ├─ openai.rs   reqwest 流式 │              │
│  │  ├─ bing.rs     tokio: WS    │              │
│  │  ├─ search.rs   搜索代理     │              │
│  │  ├─ store.rs    rusqlite     │              │
│  │  └─ tts.rs      (可选)       │              │
│  └─────────────────────────────┘              │
└──────────────────────────────────────────────┘
```

- **WebView**：Tauri 2 默认用系统 WebView（macOS WKWebView / Windows WebView2 / Linux webkitgtk），无需打包 Chromium，安装包极小。
- **前端职责收敛**：只做渲染与交互（输入框、消息气泡、markdown 卡片、设置表单、历史列表）。所有网络 / WebSocket / 数据库 / 搜索调用改成调用 Rust command。
- **Rust 端点**：把每一条 `/api/...` 与 bot 方法映射成 `#[tauri::command]`：

| Web/前端现值 | Tauri 目标（Rust） |
|---|---|
| `OpenAIBot.sendMessage`（`fetch` + SSE） | command `stream_chat`：`reqwest` + `bytes_stream`，逐行解析，用 `app_handle.emit()` 向 WebView 推 `UPDATE_ANSWER` 事件 |
| `OpenAIBot.restoreMessages` | command `set_history`：从 SQLite 读取并注入 |
| `BingWebBot.sendMessage`（`/api/sydney`） | command `bing_chat`：`tokio-tungstenite` 连 `wss://sydney.bing.com/sydney/ChatHub`，RS 解帧，`emit` 推事件 |
| `BingWebBot.createConversation` | command `bing_create_conversation`：`reqwest` POST 到 Bing `turing/conversation/create` |
| `CreateImage / uploadImage` | command `bing_create_image` / `bing_upload_image`（`reqwest` multipart 到 `images/kblob`） |
| `/api/search`（免费/Serper/Tavily） | command `web_search`（`reqwest` 抓取 + 可选三方 API） |
| SQLite（auth / history / config） | `rusqlite` 本地库，去掉登录/多用户 |
| TTS / STT | 优先 WebView `speechSynthesis`（现状即这样）；可选移入 Rust `tts` crate |

- **事件流通道**：流式输出不再用 HTTP SSE，改为 Rust → WebView 的 Tauri `emit` 事件 + 前端 `listen`。`Event` 类型（`UPDATE_ANSWER` / `DONE` / `ERROR`）保持与现状一致，`use-bing.ts` 几乎不动。

---

## 3. 状态与存储迁移

1. **`openAIConfigAtom` / 偏好原子**：继续用 localStorage（Tauri 的 WebView 自带 localStorage）。apiKey 复本不再写进 SQLite（那是多用户架构的产物）；桌面端可将 key 存入 OS 钥匙串（`keyring` crate）作为可选增强。
2. **聊天历史 / 会话**：从 IndexedDB + SQLite 统一收敛到 **Rust 端 `rusqlite` 单文件数据库**（`app_data_dir/chats.db`）。新增 command：`list_chats`、`save_chat`、`delete_chat`、`rename_chat`、`get_chat`。
3. **client↔Rust 的载荷序列化**：用 `serde_json`，消息结构对齐现有的 `ChatMessageModel`。

> 迁移说明：IndexedDB 里的历史无法被 Rust 直接读。首版可先**保留前端 IndexedDB 作为历史源**、Rust SQLite 仅保存配置与 Bing 上下文，后续再把历史整体下沉到 Rust。为控制首版风险，建议**分两期**：第一期历史仍留前端（IndexedDB），第二期迁移到 Rust。

---

## 4. 删除项 / 定位收敛

定位定为**纯本地单机桌面应用**后，以下模块直接删除：

- `src/pages/api/**`（auth、search、sydney、create、image、kblob、blob.jpg、config、history、`openai/chat/completions` 反向适配器、proxy、healthz）
- `server.js`、Dockerfile / docker-compose / render.yaml / cloudflare / sync / .github 部署流水线
- `next-auth`、`node:sqlite` 鉴权、`src/lib/auth.ts`、`src/lib/auth-context.tsx`、`src/lib/db.ts`（或改为被 Rust 端取代）
- 所有面向“多用户 / 对外服务”的 UI（登录对话框、UserMenu 里的账号相关项、`/api/counts`）
- 前端里对 `/api/*` 的 `fetch`（search、config、history、image）全部改为 `invoke`，`WebSocket`（`ifw` 的 `WebSocket`、`websocket-as-promised`、`ws`）全部移除

---

## 5. 迁移风险与实施顺序（建议两期）

### 第一期：先把“网络/服务端”下沉到 Rust，前端基调不动

1. Tauri scaffold：`tauri init`，保留 `src/` 前端（`next.config` 里做 SPA 静态导出或改用 `basePath`）。
2. Rust 实现 command 骨架 + `stream_chat`（OpenAI 链路）→ 只保留 OpenAI 一个后端，前端 `createBotInstance` 强制走 Rust。
3. 把 `search.ts` 的搜索逻辑搬到 Rust（`web_search`），前端删除 `/api/search` 调用。
4. 把历史/配置持久化收敛到 Rust（`rusqlite`），前端删除对 `pages/api/config`、`history` 的调用。

> 此期间 Bing 后端仍可用 `BingWebBot` 的浏览器直接 path？——不行。Bing 需要服务器转发头/IP 伪造，必须由 Rust `bing.rs` 实现。因此**第一期内 Bing 链路暂缓，或先用现有 `server.js` sidecar 兜底，二期再迁移**。

### 第二期：Bing 链路 + 清理

5. Rust `bing.rs`（`tokio-tungstenite` 实现 `ChristHub` 协议 + `reqwest` 会话创建/图片）。
6. 删除 `pages/api`、`server.js`、鉴权、多用户、部署文件；定位收敛为纯本地。
7. 前端 `import '@tauri-apps/api'` 全面替换 `fetch('/api/...')` 与 `WebSocket`；删除 `ifw`、`websocket-as-promised`、`ws`、`form-data`、`next-auth` 等不再需要的依赖。

### 工作量估算（相对）

| 项 | 规模 |
|---|---|
| Tauri scaffold + 前端静态化 | 小 |
| Rust OpenAI `stream_chat` + 事件推流 | 中 |
| Rust 搜索 `web_search` | 中 |
| Rust SQLite 会话/历史 | 中 |
| Rust Bing `ChristHub` WS + 会话创建 | 大 |
| 前端 `invoke` 替换 + 删旧后端 | 中 |
| 二期内 Bing 仅本地 Chrome/无头兜底的取舍 | 需决策 |

---

## 6. 关键取舍 / 待决策

- **历史数据源**：一期保留 IndexedDB、二期下沉到 Rust（推荐二期做），避免首版迁移破坏用户现有聊天记录。
- **Bing 链路在二期的可用性**：Bing 反爬（IP 伪造、`BING_HEADER`）仍需服务器级转发。桌面端 Rust 直连 `wss` 是否能稳定过反爬，需原型验证；失败则退化为仅保留 OpenAI 链路。
- **系统权限**：Tauri 需要 `http` / `ws` 能力（连外部 API）、`fs`（读用户 keyring / 存日志），只能把这些 scope 精确到需要的 URL，避免过度放权。
- **打包体积**：`reqwest` / `tokio-tungstenite` / `rusqlite` 三者拉起后约 10~15 MB（vs 现状 Docker ~几百 MB），是主要收益之一。
---

## 7. 实施进度（2026-09-03 已落地）

本方案已按「两条链路一次全上、去掉登录、Vite+React 前端」在 `desktop/` 目录落地，Web 版源码保留可继续运行：

### 已实现
- **目录**：`desktop/`（Vite + React 18 前端）+ `desktop/src-tauri/`（Tauri 2 + Rust 内核）。
- **前端**：从 Web 版迁移 `state/`、`components/`、markdown/消息渲染等；去除登录/多用户（删 auth-context、auth-dialog、token API、SQLite 用户表），`useAuth()` 全部移除；配置/历史读写本地 Rust 库。
- **桥接层** `desktop/src/lib/bridge.ts`：封装 `invoke` 与 `chat-event` 事件订阅。
- **Rust 命令**（`commands.rs`）：
  - 配置/历史：`load_config` / `save_config` / `list_chats` / `save_chat` / `rename_chat` / `delete_chat`（rusqlite 本地库）。
  - OpenAI 链路：`stream_openai`（SSE→chat-event 推流）、`openai_chat`（非流式辅助调用）、`search`（free/Serper/Tavily）。
  - Bing 链路：`bing_create_conversation`、`stream_bing`（ChatHub WS 流式）、`bing_upload_image`、`bing_create_image`、`blob_gateway`。
- **Bing 请求头**：`headers.rs` 移植 mockUser/随机IP（内嵌 cidr.json 数据）/cURL 解析；BING_HEADER 仍由前端设置页录入（存 cookie，读取后传给 Rust 命令）。
- 流式事件模型沿用 Web 版 `ChatBot`/`Event` 抽象（`UPDATE_ANSWER`/`DONE`/`ERROR`），前端 `useBing` 几乎未动。

### 待验证 / 后续
- `cargo build` 与 `npm run build` 已通过；待 `tauri dev` 起桌面窗口实测 OpenAI 对话 / Bing（需真实 BING_HEADER）/历史持久化。
- Bing 反爬稳定性需真机验证（Rust 直连 wss 是否被拦），失败则回退 OpenAI 链路为主。
- 图标/安装包/代码签名、`tauri build` 产物待跑。
