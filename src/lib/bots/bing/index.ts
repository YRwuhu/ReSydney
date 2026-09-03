import { ChatBot, ChatError, ChatMessageModel, ErrorCode, SendMessageParams, BingConversationStyle, ConversationInfo, ConversationInfoBase, KBlobResponse } from '@/lib/bots/bing/types'
import {
  bingCreateConversation,
  bingStream,
  bingUploadImage,
  onChatEvent,
  type BingConversation as BridgeConversation,
} from '@/lib/bridge'
import { readBingSession } from './session'
import { extractDrawPrompt, runDrawTool } from './draw'

type Params = SendMessageParams<{ bingConversationStyle: BingConversationStyle, conversation: Partial<ConversationInfoBase> }>

/**
 * 新必应（Sydney）机器人 —— 桌面版实现。
 * 所有网络/WS 请求由 Rust 后端完成；前端只负责把会话上下文传给 command，
 * 并订阅 Rust 推来的 chat-event 事件转成 ChatBot 的 Event。
 */
export class BingWebBot implements ChatBot {
  protected conversationContext?: ConversationInfo
  protected cookie = ''
  private lastText = ''

  constructor(opts: { endpoint?: string; cookie?: string } = {}) {
    this.cookie = opts.cookie || ''
  }

  private buildKnowledgeApiPayload(imageUrl: string, conversationStyle: BingConversationStyle) {
    const imageInfo: Record<string, string> = {}
    let imageBase64: string | undefined = undefined
    const knowledgeRequest = {
      imageInfo,
      knowledgeRequest: {
        invokedSkills: ['ImageById'],
        subscriptionId: 'Bing.Chat.Multimodal',
        invokedSkillsRequestData: { enableFaceBlur: true },
        convoData: {
          convoid: this.conversationContext?.conversationId,
          convotone: conversationStyle,
        },
      },
    }

    if (imageUrl.startsWith('data:image/')) {
      imageBase64 = imageUrl.replace('data:image/', '')
      const partIndex = imageBase64.indexOf(',')
      if (partIndex) {
        imageBase64 = imageBase64.substring(partIndex + 1)
      }
    } else {
      imageInfo.url = imageUrl
    }
    return { knowledgeRequest, imageBase64 }
  }

  async uploadImage(imageUrl: string, conversationStyle: BingConversationStyle = BingConversationStyle.Creative): Promise<KBlobResponse | undefined> {
    if (!imageUrl) {
      return
    }
    const { bing_header, image_only } = await this.sessionArgs()
    const payload = this.buildKnowledgeApiPayload(imageUrl, conversationStyle)
    try {
      const blobId = await bingUploadImage({
        bing_header,
        image_only,
        knowledge_request: payload.knowledgeRequest as unknown as Record<string, unknown>,
        image_base64: payload.imageBase64 || '',
        cookie: this.cookie,
      })
      return { blobId }
    } catch (e) {
      console.error('upload image error', e)
      return undefined
    }
  }

  private async sessionArgs(): Promise<{ bing_header: string; image_only: boolean }> {
    // 桌面版：从 cookie 还原 BING_HEADER 口令（沿用 Web 版机制，配置存于浏览器）
    const { bing_header, image_only } = readBingSession()
    return { bing_header, image_only }
  }

  async createConversation(): Promise<BridgeConversation> {
    const { bing_header, image_only } = await this.sessionArgs()
    const resp = await bingCreateConversation({
      bing_header,
      image_only,
      cookie: this.cookie,
    })
    if (!resp.conversation_id || !resp.conversation_signature) {
      throw new ChatError('会话创建失败', ErrorCode.BING_IP_FORBIDDEN)
    }
    return resp
  }

  async createContext(conversationStyle: BingConversationStyle, conversation?: ConversationInfoBase) {
    if (!this.conversationContext) {
      const conv = conversation?.conversationSignature ? conversation : await this.createConversation() as unknown as ConversationInfo
      this.conversationContext = {
        conversationId: conv.conversationId,
        userIpAddress: conv.userIpAddress || '',
        conversationSignature: conv.conversationSignature,
        encryptedconversationsignature: (conv as any).encryptedconversationsignature,
        clientId: conv.clientId,
        invocationId: conv.invocationId ?? 0,
        conversationStyle,
        prompt: '',
      }
    }
    return this.conversationContext
  }

  async sendMessage(params: Params) {
    // AI 画图工具：输入表达"画图"意图时直接生成图片，不走聊天会话（带附件时不劫持）
    const drawPrompt = extractDrawPrompt(params.prompt)
    if (drawPrompt && !params.imageUrl) {
      return runDrawTool({
        prompt: drawPrompt,
        signal: params.signal,
        onEvent: params.onEvent,
      })
    }
    try {
      await this.createContext(params.options.bingConversationStyle, params.options.conversation as ConversationInfoBase)
      Object.assign(this.conversationContext!, { prompt: params.prompt, imageUrl: params.imageUrl })
      return this.sydneyProxy(params)
    } catch (error) {
      params.onEvent({
        type: 'ERROR',
        error: error instanceof ChatError ? error : new ChatError('Catch Error', ErrorCode.UNKOWN_ERROR),
      })
    }
  }

  private async sydneyProxy(params: Params) {
    this.lastText = ''
    const conversation = this.conversationContext!
    conversation.invocationId++
    const { bing_header, image_only } = await this.sessionArgs()

    return new Promise<void>((resolve, reject) => {
      let done = false
      let unlisten: (() => void) | undefined
      let lastLen = 0

      const finish = (fn: () => void) => {
        if (done) return
        done = true
        unlisten?.()
        fn()
      }
      const abortFn = () => finish(() => resolve())
      params.signal?.addEventListener('abort', abortFn)

      onChatEvent((ev) => {
        if (ev.type === 'UPDATE_ANSWER') {
          const data = ev.data || {}
          const newText = String(data.text || '')
          if (newText.length > lastLen) {
            lastLen = newText.length
            this.lastText = newText
          }
          const eventData: any = { text: this.lastText }
          if (data.progressText) eventData.progressText = String(data.progressText)
          if (data.throttling) eventData.throttling = data.throttling
          if (data.sourceAttributions) eventData.sourceAttributions = data.sourceAttributions
          if (data.suggestedResponses) eventData.suggestedResponses = data.suggestedResponses
          params.onEvent({ type: 'UPDATE_ANSWER', data: eventData })
        } else if (ev.type === 'DONE') {
          finish(() => resolve())
        } else if (ev.type === 'ERROR') {
          finish(() => reject(new ChatError(String(ev.error?.message || '未知错误'), ErrorCode.NETWORK_ERROR)))
        }
      }).then((un) => {
        unlisten = un
        if (done) return
        bingStream({
          bing_header,
          image_only,
          conversation: conversation as unknown as Record<string, unknown>,
          cookie: this.cookie,
        }).catch((err) => {
          finish(() => reject(err instanceof ChatError ? err : new ChatError(String(err), ErrorCode.NETWORK_ERROR)))
        })
      })
    })
  }

  resetConversation() {
    this.conversationContext = undefined
  }

  // Bing 模式通过 conversationId/signature 恢复上下文，无需单独恢复消息
  restoreMessages() {}
}