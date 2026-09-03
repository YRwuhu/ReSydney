import { atomWithStorage, createJSONStorage } from 'jotai/utils'
import { ChatMessageModel, ConversationInfoBase } from '@/lib/bots/bing/types'

// 本地多会话历史记录（兼容自定义 AI 接口，不依赖 Bing 服务端）
// 单独放一个模块，避免引入 namestorage（依赖 window），保证服务端可安全导入
export interface LocalChat {
  id: string
  chatName: string
  tone: string
  messages: ChatMessageModel[]
  conversation?: Partial<ConversationInfoBase>
  createTimeUtc: number
  updateTimeUtc: number
}

export const localChatsAtom = atomWithStorage<LocalChat[]>(
  'localChats',
  [],
  createJSONStorage(() => localStorage), // 用默认 localStorage，保证重启浏览器后仍保留
)
