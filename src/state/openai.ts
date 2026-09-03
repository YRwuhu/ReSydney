import { atomWithStorage } from 'jotai/utils'

export interface OpenAIConfig {
  baseURL: string
  apiKey: string
  model: string
  searchProvider?: SearchProvider
  serperApiKey?: string
  tavilyApiKey?: string
  /** 当模型为 Kimi（moonshot）时，使用其自带的联网搜索（web_search）而非自建搜索 */
  useKimiSearch?: boolean
  /** 启用自定义系统提示词 */
  useCustomSystemPrompt?: boolean
  /** 自定义系统提示词内容（启用时生效） */
  customSystemPrompt?: string
  /** 启用 Partial Mode（Kimi 专有）：让模型顺着指定前缀继续生成，而非从头开始 */
  usePartialMode?: boolean
  /** Partial Mode 的回复前缀（模型强制以该内容开头继续生成） */
  partialPrefix?: string
  /** Partial Mode 的可选角色名（name 字段，固定回复口吻） */
  partialName?: string
  /** 三个对话样式各自的模型参数（高级模型设置） */
  advanced?: StyleModelParamsMap
}

/** 单个对话样式的模型参数 */
export interface StyleModelParams {
  temperature: number
  topP?: number
  maxTokens?: number
  frequencyPenalty?: number
  presencePenalty?: number
  /** 是否开启思考（推理模式），默认 false（关闭思考）；true 则显式开启 */
  enableThinking?: boolean
  /** 开启思考时，是否在界面上显示思考过程 */
  showThinking?: boolean
  /** 推理强度（reasoning_effort），如 kimi-k3 支持 low/high/max，默认不设置由模型决定 */
  reasoningEffort?: 'low' | 'high' | 'max'
}

/** 三种对话样式各自的模型参数 */
export type StyleModelParamsMap = {
  Creative: StyleModelParams
  Balanced: StyleModelParams
  Precise: StyleModelParams
}

/** 默认模型参数（temperature 默认 1，兼容只允许 temperature=1 的模型，可在高级模型设置中调整） */
export const DEFAULT_STYLE_MODEL_PARAMS: StyleModelParamsMap = {
  // 默认关闭思考（reasoning），避免推理模型（如 deepseek 系列）在回答前产生大量思考输出
  Creative: { temperature: 1, enableThinking: false },
  Balanced: { temperature: 1, enableThinking: false },
  Precise: { temperature: 1, enableThinking: false },
}

/** 搜索提供方：serper/tavily 需各自填 Key；free 为无需 Key 的本地抓取（Bing） */
export type SearchProvider = 'free' | 'serper' | 'tavily'

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_OPENAI_API_KEY = ''
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini'

export const defaultOpenAIConfig: OpenAIConfig = {
  baseURL: DEFAULT_OPENAI_BASE_URL,
  apiKey: DEFAULT_OPENAI_API_KEY,
  model: DEFAULT_OPENAI_MODEL,
  searchProvider: 'free',
  serperApiKey: '',
  tavilyApiKey: '',
  useKimiSearch: false,
  useCustomSystemPrompt: false,
  customSystemPrompt: '',
  usePartialMode: false,
  partialPrefix: '',
  partialName: '',
  advanced: DEFAULT_STYLE_MODEL_PARAMS,
}

// 用户自定义的 AI 接口配置，保存在浏览器本地（localStorage）。
// 桌面版：配置持久化到 Rust 本地 SQLite，启动时覆盖到该原子。
export const openAIConfigAtom = atomWithStorage<OpenAIConfig>(
  'openaiConfig',
  defaultOpenAIConfig, undefined,
)
