import { useCallback, useMemo } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { chatFamily, bingConversationStyleAtom, localChatsAtom } from '@/state'
import { LocalChat } from '@/state'
import { BingConversationStyle } from '@/lib/bots/bing/types'
import { renameChat as bridgeRename, deleteChat as bridgeDelete } from '@/lib/bridge'

// 本地多会话历史记录（兼容 Bing 与自定义 AI 接口，不依赖 Bing 服务端）
export function useChatHistory() {
  const chatAtom = useMemo(() => chatFamily({ botId: 'bing', page: 'singleton' }), [])
  const [chatState, setChatState] = useAtom(chatAtom)
  const setBingStyle = useSetAtom(bingConversationStyleAtom)
  const [chatHistory, setChatHistory] = useAtom(localChatsAtom)

  const renameChat = useCallback(async (conversation: LocalChat, chatName: string) => {
    setChatHistory(prev => prev.map(c => c.id === conversation.id ? { ...c, chatName } : c))
    bridgeRename(conversation.id, chatName).catch(() => {})
  }, [setChatHistory])

  const deleteChat = useCallback(async (conversation: LocalChat) => {
    setChatHistory(prev => prev.filter(c => c.id !== conversation.id))
    bridgeDelete(conversation.id).catch(() => {})
  }, [setChatHistory])

  const downloadMessage = useCallback(async (conversation: LocalChat) => {
    const content = conversation.messages
      .filter(m => m.text)
      .map(m => `##${m.author === 'user' ? '用户' : '必应'}\n${m.text}`)
      .join('\n\n')
    const blob = new Blob([content], { type: 'text/plain' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${conversation.chatName || 'Conversation'}.txt`
    link.click()
  }, [])

  const updateMessage = useCallback(async (conversation: LocalChat) => {
    // 恢复该历史会话保存的对话样式
    if (conversation.tone && (Object.values(BingConversationStyle) as string[]).includes(conversation.tone)) {
      setBingStyle(conversation.tone as BingConversationStyle)
    }
    // 恢复消息与上下文（chatId 一致，继续对话会更新同一历史）
    setChatState((draft) => {
      draft.chatId = conversation.id
      draft.messages = conversation.messages
      draft.conversation = conversation.conversation ?? {}
      draft.abortController = undefined
      draft.generatingMessageId = ''
    })
    // 恢复机器人内部上下文（OpenAI 模式用于继续对话）
    chatState.bot.restoreMessages?.(conversation.messages)
  }, [chatState.bot, setBingStyle, setChatState])

  return {
    chatHistory,
    renameChat,
    deleteChat,
    updateMessage,
    downloadMessage,
  }
}
