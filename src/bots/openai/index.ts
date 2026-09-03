import { ChatBot, ChatError, ChatMessageModel, ErrorCode, SendMessageParams } from '@/lib/bots/bing/types'
import { BingConversationStyle } from '@/lib/bots/bing/types'
import { DEFAULT_STYLE_MODEL_PARAMS, OpenAIConfig, StyleModelParams } from '@/state/openai'
import { DEFAULT_SYSTEM_PROMPT, REPLY_CARD_RULE } from './system-prompt'
import {
  SUGGEST_PROMPT,
  buildSearchContext,
  buildSearchDecisionPrompt,
  getTodayString,
  parseAiJson,
  SearchResult,
} from './search'
import { openaiChatOnce, openaiStream, webSearch, onChatEvent } from '@/lib/bridge'
import { extractDrawPrompt, runDrawTool } from '@/lib/bots/bing/draw'

/** OpenAI 兼容接口的图片内容部件（视觉模型用） */
type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | ContentPart[]
  tool_calls?: any[]
  tool_call_id?: string
  name?: string
  /** Kimi Partial Mode：追加在消息尾部，让模型顺着 content（+name）继续生成而非从头开始 */
  partial?: boolean
}

type ApiConfig = { baseURL: string; apiKey: string; model: string }

/**
 * 基于 OpenAI 兼容接口（/chat/completions，支持流式输出）的机器人。
 * 桌面版：所有网络请求由 Rust 后端完成，前端通过 Tauri 事件流接收增量。
 */
export class OpenAIBot implements ChatBot {
  private history: OpenAIMessage[] = []
  private readonly systemPrompt: string
  private readonly config: OpenAIConfig

  constructor(opts: { config?: OpenAIConfig; systemPrompt?: string } = {}) {
    const custom = opts.config?.useCustomSystemPrompt && (opts.config?.customSystemPrompt || '').trim()
    const base = opts.systemPrompt ?? (custom || DEFAULT_SYSTEM_PROMPT)
    this.systemPrompt = `${base.replace(/\s+$/, '')}\n\n${REPLY_CARD_RULE}`
    this.config = {
      ...opts.config,
      baseURL: opts.config?.baseURL ?? '',
      apiKey: opts.config?.apiKey ?? '',
      model: opts.config?.model ?? '',
    }
  }

  private useKimiWebSearch(config: ApiConfig): boolean {
    if (!this.config.useKimiSearch) return false
    const model = (config.model || '').toLowerCase()
    const base = (config.baseURL || '').toLowerCase()
    return model.includes('kimi') || base.includes('moonshot') || base.includes('kimi')
  }

  private resolveConfig(): ApiConfig {
    return {
      baseURL: (this.config.baseURL || '').trim().replace(/\/+$/, ''),
      apiKey: (this.config.apiKey || '').trim(),
      model: (this.config.model || '').trim(),
    }
  }

  private resolveTone(options: any): BingConversationStyle {
    const tone = options?.bingConversationStyle
    return Object.values(BingConversationStyle).includes(tone) ? tone : BingConversationStyle.Balanced
  }

  private resolveModelParams(tone: BingConversationStyle): StyleModelParams {
    const cfg = this.config.advanced?.[tone]
    const d = DEFAULT_STYLE_MODEL_PARAMS[tone] || DEFAULT_STYLE_MODEL_PARAMS.Balanced
    return {
      temperature: typeof cfg?.temperature === 'number' ? cfg.temperature : d.temperature,
      topP: cfg?.topP,
      maxTokens: cfg?.maxTokens,
      frequencyPenalty: cfg?.frequencyPenalty,
      presencePenalty: cfg?.presencePenalty,
      enableThinking: cfg?.enableThinking !== undefined ? cfg?.enableThinking : d.enableThinking,
      showThinking: cfg?.showThinking,
      reasoningEffort: cfg?.reasoningEffort,
    }
  }

  private static flattenContent(content?: string | ContentPart[]): string {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    return content
      .map((part) => (part.type === 'text' ? part.text : '[图片]'))
      .join('\n')
  }

  private static flattenMessages(messages: OpenAIMessage[]): OpenAIMessage[] {
    return messages.map((m) => ({ ...m, content: m.content ? OpenAIBot.flattenContent(m.content) : m.content }))
  }

  private static imageContentPart(imageUrl: string): ContentPart {
    return { type: 'image_url', image_url: { url: imageUrl } }
  }

  async sendMessage(params: SendMessageParams<any>) {
    // AI 画图工具：命中"画图"意图时直接走 Bing 图像生成，与是否配置 OpenAI 接口无关
    const drawPrompt = extractDrawPrompt(params.prompt)
    if (drawPrompt && !params.imageUrl) {
      return runDrawTool({
        prompt: drawPrompt,
        signal: params.signal,
        onEvent: params.onEvent,
      })
    }

    const config = this.resolveConfig()
    if (!config.baseURL || !config.apiKey || !config.model) {
      params.onEvent({
        type: 'ERROR',
        error: new ChatError('请先在设置中配置 AI 接口的 URL、Key 和 Model', ErrorCode.UNKOWN_ERROR),
      })
      return
    }

    const today = getTodayString()
    const userContent: string | ContentPart[] = params.imageUrl
      ? [
          { type: 'text', text: params.prompt },
          OpenAIBot.imageContentPart(params.imageUrl),
        ]
      : params.prompt
    const messages: OpenAIMessage[] = [
      { role: 'system', content: `${this.systemPrompt}\n\n当前日期：${today}` },
      ...this.history,
      { role: 'user', content: userContent },
    ]

    const partialPrefix = this.config.usePartialMode ? this.config.partialPrefix || '' : ''
    const partialMsg: OpenAIMessage | null = this.config.usePartialMode
      ? { role: 'assistant', content: partialPrefix, partial: true, ...(this.config.partialName ? { name: this.config.partialName } : {}) }
      : null

    const abortController = new AbortController()
    const onAbort = () => abortController.abort()
    params.signal?.addEventListener('abort', onAbort)

    const tone = this.resolveTone(params.options)
    const styleParams = this.resolveModelParams(tone)

    try {
      // ---- 1. AI 判断是否需要搜索、搜索什么 ----
      const kimiSearch = this.useKimiWebSearch(config)
      let searchResults: SearchResult[] = []
      let searchQuery = ''
      let kimiMessages: OpenAIMessage[] | null = null
      let kimiDirect = ''
      if (!kimiSearch) {
        try {
          const decision = await this.decideSearch(config, messages, today, abortController.signal)
          if (decision.shouldSearch && decision.query) {
            searchQuery = decision.query
            params.onEvent({ type: 'UPDATE_ANSWER', data: { text: '', progressText: `正在搜索: ${searchQuery}` } })
            searchResults = await this.runSearch(searchQuery, abortController.signal)
            if (searchResults.length) {
              params.onEvent({
                type: 'UPDATE_ANSWER',
                data: {
                  text: '',
                  progressText: '正在为你生成答案...',
                  sourceAttributions: searchResults.map((r) => ({
                    providerDisplayName: r.title,
                    seeMoreUrl: r.url,
                    searchQuery,
                  })),
                },
              })
            }
          }
        } catch (e) {
          // 搜索判断失败不阻塞主回答
        }
      } else {
        // Kimi 原生联网搜索：非流式探针触发 $web_search
        const probe = await this.completeChat(config, messages, abortController.signal, true)
        const searchCalls = (probe.toolCalls || []).filter((t: any) => t?.function?.name === '$web_search')
        if (searchCalls.length) {
          params.onEvent({ type: 'UPDATE_ANSWER', data: { text: '', progressText: '正在搜索（Kimi 自带联网）...' } })
          kimiMessages = [
            ...messages,
            { role: 'assistant', content: probe.content || '', tool_calls: probe.toolCalls },
            ...probe.toolCalls.map((t: any) => ({
              role: 'tool' as const,
              tool_call_id: t.id,
              name: t.function?.name,
              content: t.function?.arguments ?? '{}',
            })),
          ]
        } else {
          kimiDirect = probe.content || ''
        }
      }

      // ---- 2. 主回答（带搜索上下文，流式） ----
      const mainMessages = kimiMessages ? [...kimiMessages] : [...messages]
      if (searchResults.length) {
        mainMessages.splice(messages.length - 1, 0, {
          role: 'system',
          content: buildSearchContext(searchQuery, searchResults),
        })
      }
      if (partialMsg) {
        mainMessages.push(partialMsg)
      }

      let text = ''
      if (kimiDirect) {
        text = partialPrefix + kimiDirect
      } else {
        text = await this.streamChat(config, mainMessages, params, abortController.signal, partialPrefix, styleParams, tone, kimiSearch)
      }

      if (text) {
        this.history.push({ role: 'user', content: userContent }, { role: 'assistant', content: text })
      }

      // ---- 3. 建议追问 ----
      const suggestMessages = partialMsg ? mainMessages.slice(0, -1) : mainMessages
      let suggestions: string[] = []
      if (text) {
        try {
          suggestions = await this.generateSuggestions(config, suggestMessages, text, abortController.signal)
        } catch (e) {
          // 建议生成失败不阻塞
        }
      }

      const finalData: { text: string; suggestedResponses?: any[] } = { text }
      if (suggestions.length) {
        finalData.suggestedResponses = suggestions.map((s) => ({ text: s }))
      }
      params.onEvent({ type: 'UPDATE_ANSWER', data: finalData })
      params.onEvent({ type: 'DONE' })
    } catch (error) {
      if (abortController.signal.aborted) {
        return
      }
      params.onEvent({
        type: 'ERROR',
        error: error instanceof ChatError ? error : new ChatError(String(error), ErrorCode.NETWORK_ERROR),
      })
    } finally {
      params.signal?.removeEventListener('abort', onAbort)
    }
  }

  /** 非流式单次调用（辅助请求用）。带 tools 时启用 Kimi 原生搜索工具。 */
  private async completeChat(
    config: ApiConfig,
    messages: OpenAIMessage[],
    signal: AbortSignal,
    withKimiTools = false,
  ): Promise<{ content: string; toolCalls: any[]; finishReason: string }> {
    const flat = OpenAIBot.flattenMessages(messages)
    const content = await openaiChatOnce({
      base_url: config.baseURL,
      api_key: config.apiKey,
      model: config.model,
      messages: flat as unknown[],
      tone: BingConversationStyle.Balanced,
      style_params: undefined,
      use_kimi_search: withKimiTools,
      partial_prefix: '',
    })
    // Rust 端非流式调用暂不返回 tool_calls，Kimi 探针降级为直接返回文本。
    void signal
    return { content, toolCalls: [], finishReason: '' }
  }

  private async decideSearch(config: ApiConfig, messages: OpenAIMessage[], today: string, signal: AbortSignal): Promise<{ shouldSearch: boolean; query: string }> {
    const content = await this.chatOnce(config, [...messages, { role: 'user', content: buildSearchDecisionPrompt(today) }], signal)
    const parsed = parseAiJson<{ shouldSearch: boolean; query: string }>(content)
    if (parsed && typeof parsed.shouldSearch === 'boolean') {
      return { shouldSearch: parsed.shouldSearch, query: (parsed.query || '').trim() }
    }
    return { shouldSearch: false, query: '' }
  }

  private async chatOnce(config: ApiConfig, messages: OpenAIMessage[], signal: AbortSignal): Promise<string> {
    const flat = OpenAIBot.flattenMessages(messages)
    void signal
    return openaiChatOnce({
      base_url: config.baseURL,
      api_key: config.apiKey,
      model: config.model,
      messages: flat as unknown[],
      tone: BingConversationStyle.Balanced,
      style_params: undefined,
      use_kimi_search: false,
      partial_prefix: '',
    })
  }

  private async runSearch(query: string, signal: AbortSignal): Promise<SearchResult[]> {
    const provider = this.config.searchProvider || 'free'
    void signal
    const results = await webSearch(query, provider, this.config.serperApiKey || '', this.config.tavilyApiKey || '')
    return Array.isArray(results) ? results.slice(0, 6) : []
  }

  private async generateSuggestions(config: ApiConfig, mainMessages: OpenAIMessage[], answerText: string, signal: AbortSignal): Promise<string[]> {
    const content = await this.chatOnce(
      config,
      [
        ...mainMessages,
        { role: 'assistant', content: answerText },
        { role: 'user', content: SUGGEST_PROMPT },
      ],
      signal,
    )
    const parsed = parseAiJson<string[]>(content)
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string').slice(0, 4) : []
  }

  /**
   * 流式主回答：订阅 Rust 端 chat-event 事件，逐段 emit UPDATE_ANSWER。
   * 同一时刻只会有一个进行中的主回答（前端有 generatingMessageId 守卫）。
   */
  private async streamChat(
    config: ApiConfig,
    messages: OpenAIMessage[],
    params: SendMessageParams<any>,
    signal: AbortSignal,
    prefix: string,
    styleParams: StyleModelParams,
    tone: BingConversationStyle,
    kimiSearch: boolean,
  ): Promise<string> {
    const showThinking = styleParams.showThinking === true
    let text = prefix
    let reasoningText = ''
    let lastLen = 0

    return new Promise<string>((resolve, reject) => {
      let done = false
      let unlisten: (() => void) | undefined

      const finish = (fn: () => void) => {
        if (done) return
        done = true
        unlisten?.()
        fn()
      }

      const abortFn = () => {
        finish(() => reject(new Error('Aborted')))
      }
      signal.addEventListener('abort', abortFn)

      onChatEvent((ev) => {
        if (ev.type === 'UPDATE_ANSWER') {
          const data = ev.data || {}
          const newText = String(data.text || '')
          if (newText.length > lastLen) {
            lastLen = newText.length
            text = newText
          }
          if (typeof data.reasoning === 'string') {
            reasoningText = data.reasoning
          }
          if (data.progressText) {
            params.onEvent({ type: 'UPDATE_ANSWER', data: { text: '', progressText: String(data.progressText) } })
          }
          params.onEvent({ type: 'UPDATE_ANSWER', data: { text, reasoning: showThinking ? reasoningText : undefined } })
        } else if (ev.type === 'DONE') {
          finish(() => resolve(text))
        } else if (ev.type === 'ERROR') {
          finish(() => reject(new ChatError(String(ev.error?.message || '未知错误'), ErrorCode.NETWORK_ERROR)))
        }
      }).then((un) => {
        unlisten = un
        if (done) un()
        else {
          openaiStream({
            base_url: config.baseURL,
            api_key: config.apiKey,
            model: config.model,
            messages: messages as unknown[],
            tone,
            style_params: styleParams as unknown,
            use_kimi_search: kimiSearch,
            partial_prefix: prefix,
          }).catch((err) => {
            finish(() => reject(err instanceof ChatError ? err : new ChatError(String(err), ErrorCode.NETWORK_ERROR)))
          })
        }
      })
    })
  }

  async uploadImage(imageUrl: string): Promise<{ blobId?: string } | undefined> {
    return imageUrl ? { blobId: imageUrl } : undefined
  }

  resetConversation() {
    this.history = []
  }

  restoreMessages(messages: ChatMessageModel[]) {
    this.history = messages
      .filter((m) => m.author === 'user' || m.author === 'bot')
      .filter((m) => m.text)
      .map((m) => ({
        role: (m.author === 'user' ? 'user' : 'assistant') as OpenAIMessage['role'],
        content: m.text,
      }))
  }
}