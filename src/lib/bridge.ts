//! Rust 后端桥接层：把 /api/... 调用与流式事件统一封装给 bot 层使用。
//! 使用 @tauri-apps/api 的 invoke / event。

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { ChatError, ErrorCode } from './bots/bing/types'

export interface ChatEventPayload {
  type: 'UPDATE_ANSWER' | 'DONE' | 'ERROR'
  data?: Record<string, unknown>
  error?: { message: string; code: ErrorCode }
}

function wrapError(e: unknown): ChatError {
  const message = typeof e === 'string' ? e : e instanceof Error ? e.message : String(e)
  return { message, code: 'NETWORK_ERROR' } as ChatError
}

/** 订阅 Rust 侧流式事件（chat-event）。返回取消订阅函数。 */
export async function onChatEvent(handler: (event: ChatEventPayload) => void): Promise<UnlistenFn> {
  return listen<ChatEventPayload>('chat-event', (e) => handler(e.payload))
}

// ---------------------------------------------------------------------------
// 配置 / 历史（本地 rusqlite）
// ---------------------------------------------------------------------------

export interface AppConfig {
  base_url: string
  api_key: string
  model: string
  search_provider: string
  serper_key: string
  tavily_key: string
  use_kimi_search: boolean
  use_custom_system_prompt: boolean
  custom_system_prompt: string
  use_partial_mode: boolean
  partial_prefix: string
  partial_name: string
  advanced: string
  bing_header: string
}

export interface ChatSummary {
  id: string
  chat_name: string
  tone: string
  messages: string
  conversation: string
  create_time_utc: number
  update_time_utc: number
}

export const loadConfig = () => invoke<AppConfig>('load_config')
export const saveConfig = (config: AppConfig) => invoke<void>('save_config', { config })
export const listChats = () => invoke<ChatSummary[]>('list_chats')
export const saveChat = (chat: ChatSummary) => invoke<void>('save_chat', { chat })
export const renameChat = (id: string, name: string) => invoke<void>('rename_chat', { id, name })
export const deleteChat = (id: string) => invoke<void>('delete_chat', { id })

// ---------------------------------------------------------------------------
// 搜索
// ---------------------------------------------------------------------------

export interface SearchResult {
  title: string
  url: string
  snippet: string
  content?: string
}

export function webSearch(
  q: string,
  provider: string,
  serperApiKey: string,
  tavilyApiKey: string,
): Promise<SearchResult[]> {
  return invoke<SearchResult[]>('search', { q, provider, serperApiKey, tavilyApiKey })
}

// ---------------------------------------------------------------------------
// OpenAI 兼容链路
// ---------------------------------------------------------------------------

export interface OpenAICallArgs {
  base_url: string
  api_key: string
  model: string
  messages: unknown[]
  tone: string
  style_params?: unknown
  use_kimi_search: boolean
  partial_prefix: string
}

/** 非流式辅助调用（搜索判断 / 建议生成 / Kimi 探针）。 */
export const openaiChatOnce = (args: OpenAICallArgs) => invoke<string>('openai_chat', { args }).catch((e) => { throw wrapError(e) })

/** 流式主回答：Rust 侧会持续 emit chat-event，本函数只负责发起。 */
export const openaiStream = (args: OpenAICallArgs) => invoke<void>('stream_openai', { args }).catch((e) => { throw wrapError(e) })

// ---------------------------------------------------------------------------
// Bing（新必应）链路
// ---------------------------------------------------------------------------

export interface BingConversation {
  conversation_id: string
  client_id: string
  conversation_signature: string
  encrypted_conversation_signature?: string
  invocation_id: number
  user_ip_address?: string
}

export interface BingSessionArgs {
  bing_header: string
  image_only: boolean
  conversation_id?: string
  cookie?: string
}

export const bingCreateConversation = (args: BingSessionArgs) =>
  invoke<BingConversation>('bing_create_conversation', { args })

export interface BingStreamArgs {
  bing_header: string
  image_only: boolean
  conversation: Record<string, unknown>
  bing_source?: string
  cookie?: string
}

export const bingStream = (args: BingStreamArgs) => invoke<void>('stream_bing', { args })

export const bingUploadImage = (args: {
  bing_header: string
  image_only: boolean
  knowledge_request: Record<string, unknown>
  image_base64: string
  cookie?: string
}) => invoke<string>('bing_upload_image', { args })

export const bingCreateImage = (args: {
  bing_header: string
  image_only: boolean
  prompt: string
  id: string
  cookie?: string
}) => invoke<string>('bing_create_image', { args })

export const blobGateway = (args: {
  bing_header: string
  image_only: boolean
  bcid: string
  cookie?: string
}) => invoke<string>('blob_gateway', { args })