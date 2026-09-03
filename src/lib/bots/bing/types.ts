export type Author = 'user' | 'system' | 'bot'

export type BotId = 'bing'

export enum BingConversationStyle {
  Creative = 'Creative',
  Balanced = 'Balanced',
  Precise = 'Precise'
}

export enum ErrorCode {
  CONVERSATION_LIMIT = 'CONVERSATION_LIMIT',
  BING_UNAUTHORIZED = 'BING_UNAUTHORIZED',
  BING_IMAGE_UNAUTHORIZED = 'BING_IMAGE_UNAUTHORIZED',
  BING_IP_FORBIDDEN = 'BING_IP_FORBIDDEN',
  BING_TRY_LATER = 'BING_TRY_LATER',
  BING_FORBIDDEN = 'BING_FORBIDDEN',
  BING_CAPTCHA = 'BING_CAPTCHA',
  THROTTLE_LIMIT = 'THROTTLE_LIMIT',
  NOTFOUND_ERROR = 'NOT_FOUND_ERROR',
  UNKOWN_ERROR = 'UNKOWN_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
}

export class ChatError extends Error {
  code: ErrorCode
  constructor(message: string, code: ErrorCode) {
    super(message)
    this.code = code
  }
}

export type ChatMessageModel = {
  id: string
  author: Author
  text: string
  progress?: string[]
  error?: ChatError
  throttling?: Throttling
  sourceAttributions?: SourceAttribution[]
  suggestedResponses?: SuggestedResponse[]
  /** 思考过程（推理模型流式返回，仅在显示思考时填充） */
  thinking?: string
}

export interface ConversationModel {
  messages: ChatMessageModel[]
}

export type Event =
  | {
      type: 'UPDATE_ANSWER'
      data: {
        text: string
        progressText?: string
        sourceAttributions?: SourceAttribution[]
        suggestedResponses?: SuggestedResponse[]
        throttling?: Throttling
        /** 思考过程（推理模型的 reasoning_content） */
        reasoning?: string
      }
    }
  | {
      type: 'DONE'
    }
  | {
      type: 'ERROR'
      error: ChatError
    }

export interface SendMessageParams<T> {
  prompt: string
  imageUrl?: string
  options: T
  onEvent: (event: Event) => void
  signal?: AbortSignal
}

/**
 * 所有聊天机器人（Bing / 自定义 OpenAI 兼容接口）需要实现的最小接口，
 * 前端只依赖这些方法，便于自由切换后端。
 */
export interface ChatBot {
  sendMessage: (params: SendMessageParams<any>) => Promise<void> | void
  uploadImage: (imageUrl: string, conversationStyle?: BingConversationStyle) => Promise<{ blobId?: string } | undefined>
  resetConversation: () => void
  restoreMessages?: (messages: ChatMessageModel[]) => void
}

export interface ConversationResponse extends ConversationInfoBase {
  result: {
    value: string
    message?: string
  }
}

export interface Telemetry {
  metrics?: null
  startTime: string
}

export interface ChatUpdateArgument {
  messages?: ChatResponseMessage[]
  throttling?: Throttling
  requestId: string
  result: null
}

export type ChatUpdateCompleteResponse = {
  type: 2
  invocationId: string
  item: ChatResponseItem
} | {
  type: 1
  target: string
  arguments: ChatUpdateArgument[]
} | {
  type: 3
  invocationId: string
} | {
  type: 6 | 7
}

export interface ChatRequestResult {
  value: string
  serviceVersion: string
  error?: string
}

export interface ChatResponseItem {
  messages: ChatResponseMessage[]
  firstNewMessageIndex: number
  suggestedResponses: null
  conversationId: string
  requestId: string
  conversationExpiryTime: string
  telemetry: Telemetry
  result: ChatRequestResult
  throttling: Throttling
}
export enum InvocationEventType {
  Invocation = 1,
  StreamItem = 2,
  Completion = 3,
  StreamInvocation = 4,
  CancelInvocation = 5,
  Ping = 6,
  Close = 7,
}

export interface ConversationInfoBase {
  conversationId: string
  userIpAddress: string
  clientId: string
  conversationSignature?: string
  encryptedconversationsignature?: string
  invocationId: number
}

export interface ConversationInfo extends ConversationInfoBase {
  conversationStyle: BingConversationStyle
  prompt: string
  imageUrl?: string
  source?: 'cib' | 'WindowsCopilot'
}

export interface Throttling {
  maxNumLongDocSummaryUserMessagesInConversation: number
  maxNumUserMessagesInConversation: number
  numLongDocSummaryUserMessagesInConversation: number
  numUserMessagesInConversation: number
}

export interface ChatResponseMessage {
  text: string
  progressText?: string
  author: string
  createdAt: Date
  timestamp: Date
  messageId: string
  requestId: string
  offense: string
  adaptiveCards: AdaptiveCard[]
  sourceAttributions: SourceAttribution[]
  feedback: Feedback
  contentOrigin: string
  messageType?: string
  contentType?: string
  privacy: null
  suggestedResponses: SuggestedResponse[]
}

export interface AdaptiveCard {
  type: string
  version: string
  body: Body[]
}

export interface Body {
  type: string
  text: string
  wrap: boolean
  size?: string
}

export interface Feedback {
  tag: null
  updatedOn: null
  type: string
}

export interface SourceAttribution {
  providerDisplayName: string
  seeMoreUrl: string
  searchQuery: string
}

export interface SuggestedResponse {
  text: string
  author?: Author
  createdAt?: Date
  timestamp?: Date
  messageId?: string
  messageType?: string
  offense?: string
  feedback?: Feedback
  contentOrigin?: string
  privacy?: null
}

export interface KBlobRequest {
  knowledgeRequest: KnowledgeRequestContext
  imageBase64?: string
}

export interface KBlobResponse {
  blobId: string
  processedBlobId?: string
}

export interface KnowledgeRequestContext {
  imageInfo:        ImageInfo;
  knowledgeRequest: KnowledgeRequest;
}

export interface ImageInfo {
  url?: string;
}

export interface KnowledgeRequest {
  invokedSkills:            string[];
  subscriptionId:           string;
  invokedSkillsRequestData: InvokedSkillsRequestData;
  convoData:                ConvoData;
}

export interface ConvoData {
  convoid:   string;
  convotone: BingConversationStyle;
}

export interface InvokedSkillsRequestData {
  enableFaceBlur: boolean;
}

export interface FileItem {
  url: string;
  status?: 'loading' | 'error' | 'loaded'
  /** Bing 上传返回的 blobId（发送时转 bing.com 图片地址用） */
  bcid?: string
}
