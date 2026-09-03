'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { getDefaultStore, useAtom, useAtomValue, useSetAtom } from 'jotai'
import { chatFamily, bingConversationStyleAtom, hashAtom, voiceAtom, chatHistoryAtom, isImageOnly, localChatsAtom } from '@/state'
import { ChatMessageModel, BotId, FileItem } from '@/lib/bots/bing/types'
import { saveChat as apiSaveChat, blobGateway, listChats } from '@/lib/bridge'
import { readBingSession } from '@/lib/bots/bing/session'
import { toast } from 'react-hot-toast'
import { nanoid } from '@/lib/utils'
import { TTS } from '@/lib/bots/bing/tts'

export function useBing(botId: BotId = 'bing') {
  const chatAtom = useMemo(() => chatFamily({ botId, page: 'singleton' }), [botId])
  const [chatState, setChatState] = useAtom(chatAtom)
  const setHistoryValue = useSetAtom(chatHistoryAtom)
  const setLocalChats = useSetAtom(localChatsAtom)
  const [enableTTS] = useAtom(voiceAtom)
  const speaker = useMemo(() => new TTS(), [])
  const [hash, setHash] = useAtom(hashAtom)
  const bingConversationStyle = useAtomValue(bingConversationStyleAtom)
  const [input, setInput] = useState('')
  const [attachmentList, setAttachmentList] = useState<FileItem[]>([])

  const updateMessage = useCallback(
    (messageId: string, updater: (message: ChatMessageModel) => void) => {
      setChatState((draft) => {
        const message = draft.messages.find((m) => m.id === messageId)
        if (message) {
          updater(message)
        }
      })
    },
    [setChatState],
  )

  const sendMessage = useCallback(
    async (input: string, options = {}) => {
      // 直接读原子当前值，而非渲染闭包：避免"刚点击样式就立刻发送"时闭包滞后一个版本，
      // 导致历史保存的 tone 与所选样式不一致（表现为偏移相邻样式）
      const currentTone = getDefaultStore().get(bingConversationStyleAtom)
      const botMessageId = nanoid()
      const attachment = attachmentList?.[0]?.status === 'loaded' ? attachmentList[0] : undefined
      // 显示用：附件本身（data URL，OpenAI 模式或 Bing blob 网关取回后均转成 data URL）
      const displayUrl = attachment?.url
      // 发给模型的图片地址：
      //  - OpenAI 模式：attachment.url 即压缩后的 data URL，必须原样发送给模型（不受 isImageOnly 限制）
      //  - Bing 模式：attachment.bcid → bing.com blob URL，仅在非 isImageOnly 时发送
      const isDataUrl = !!attachment?.url?.startsWith('data:')
      const botImageUrl = attachment ? (attachment.bcid ? `https://www.bing.com/images/blob?bcid=${attachment.bcid}` : attachment.url) : undefined

      setChatState((draft) => {
        const text = displayUrl ? `${input}\n\n![image](${displayUrl})` : input
        if (!draft.chatId) {
          draft.chatId = nanoid()
        }
        draft.messages.push({ id: nanoid(), text, author: 'user' }, { id: botMessageId, text: '', author: 'bot' })
        setAttachmentList([])
      })
      const abortController = new AbortController()
      setChatState((draft) => {
        draft.generatingMessageId = botMessageId
        draft.abortController = abortController
      })
      speaker.reset()
      await chatState.bot.sendMessage({
        prompt: input,
        // OpenAI 模式无条件发送图片；Bing 模式仅在未开启 IMAGE_ONLY 时发送
        imageUrl: isDataUrl || !isImageOnly ? botImageUrl : undefined,
        options: {
          ...options,
          bingConversationStyle: currentTone,
          conversation: chatState.conversation,
        },
        signal: abortController.signal,
        onEvent(event) {
          if (event.type === 'UPDATE_ANSWER') {
            updateMessage(botMessageId, (message) => {
              if (event.data.text.length > message.text.length) {
                message.text = event.data.text
              }

              if (enableTTS) {
                speaker.speak(message.text)
              }
              if (event.data.progressText) {
                message.progress = [...(message.progress ?? []), event.data.progressText]
              }
              message.throttling = event.data.throttling || message.throttling
              message.sourceAttributions = event.data.sourceAttributions || message.sourceAttributions
              message.suggestedResponses = event.data.suggestedResponses || message.suggestedResponses
              if (typeof event.data.reasoning === 'string') {
                message.thinking = event.data.reasoning
              }
            })
          } else if (event.type === 'ERROR') {
            updateMessage(botMessageId, (message) => {
              message.error = event.error
            })
            setChatState((draft) => {
              draft.abortController = undefined
              draft.generatingMessageId = ''
            })
          } else if (event.type === 'DONE') {
            let savePayload: any = null
            setChatState((draft) => {
              // 保存前把用户消息里的 base64 图片 Markdown 替换为占位符，避免撑爆本地存储
              for (const m of draft.messages) {
                if (m.author === 'user' && m.text) {
                  m.text = m.text.replace(/!\[image\]\(data:image\/[^)]*\)/g, '[图片]')
                }
              }
              setHistoryValue({
                messages: draft.messages,
              })
              // 保存到本地历史（兼容自定义 AI 接口）
              if (draft.chatId && draft.messages.length) {
                const firstUserMsg = draft.messages.find((m) => m.author === 'user')?.text || '新对话'
                // 深拷贝：immer draft 是 proxy，直接存会导致后续读取时 "proxy revoked" 报错
                const messages = JSON.parse(JSON.stringify(draft.messages))
                const conversation = JSON.parse(JSON.stringify(draft.conversation ?? {}))
                const updateTimeUtc = Date.now()
                savePayload = {
                  id: draft.chatId,
                  chatName: firstUserMsg.slice(0, 30),
                  tone: currentTone,
                  messages,
                  conversation,
                  updateTimeUtc,
                }
                setLocalChats((prev) => {
                  const existing = prev.find((c) => c.id === draft.chatId)
                  const entry = {
                    ...savePayload,
                    createTimeUtc: existing?.createTimeUtc ?? updateTimeUtc,
                  }
                  return [entry, ...prev.filter((c) => c.id !== draft.chatId)].slice(0, 50)
                })
              }
              draft.abortController = undefined
              draft.generatingMessageId = ''
            })
            // 桌面版：持久化到 Rust 本地 SQLite（重启不丢）
            if (savePayload) {
              apiSaveChat({
                id: savePayload.id,
                chat_name: savePayload.chatName,
                tone: savePayload.tone,
                messages: JSON.stringify(savePayload.messages),
                conversation: JSON.stringify(savePayload.conversation),
                create_time_utc: savePayload.createTimeUtc,
                update_time_utc: savePayload.updateTimeUtc,
              }).catch(() => {})
            }
          }
        },
      })
    },
    [attachmentList, chatState.bot, chatState.conversation, enableTTS, setChatState, updateMessage, speaker],
  )

  const uploadImage = useCallback(async (imgUrl: string) => {
    setAttachmentList([{ url: imgUrl, status: 'loading' }])
    const response = await chatState.bot.uploadImage(imgUrl, bingConversationStyle)
    if (response?.blobId) {
      // OpenAI 兼容模式下 blobId 即压缩后的 data URL，直接作为附件地址；
      // Bing 模式下是短 blobId，走 Rust blob 网关取回图片 data URL 用于本地显示
      if (response.blobId.startsWith('data:')) {
        setAttachmentList([{ url: response.blobId, status: 'loaded' }])
      } else {
        const bcid = response.blobId
        try {
          const session = readBingSession()
          const b64 = await blobGateway({
            bing_header: session.bing_header,
            image_only: session.image_only,
            bcid,
            cookie: session.cookie,
          })
          setAttachmentList([{ url: `data:image/jpeg;base64,${b64}`, status: 'loaded', bcid }])
        } catch {
          setAttachmentList([{ url: imgUrl, status: 'error' }])
          toast.error('图片上传失败：无法解析返回的图片数据')
        }
      }
    } else {
      setAttachmentList([{ url: imgUrl, status: 'error' }])
      const session = readBingSession()
      if (!session.bing_header) {
        toast.error('图片上传需要先配置 Bing 凭证（设置页填入对谈令牌）')
      } else {
        toast.error('图片上传失败，请检查 Bing 凭证是否有效')
      }
    }
  }, [chatState.bot])

  const resetConversation = useCallback(() => {
    chatState.bot.resetConversation()
    speaker.abort()
    setChatState((draft) => {
      draft.abortController = undefined
      draft.generatingMessageId = ''
      draft.conversation = {}
      draft.messages = []
      draft.chatId = ''
    })
  }, [chatState.bot, setChatState])

  const stopGenerating = useCallback(() => {
    chatState.abortController?.abort()
    if (chatState.generatingMessageId) {
      updateMessage(chatState.generatingMessageId, (message) => {
        if (!message.text && !message.error) {
          message.text = 'Cancelled'
        }
      })
    }
    setChatState((draft) => {
      draft.generatingMessageId = ''
    })
  }, [chatState.abortController, chatState.generatingMessageId, setChatState, updateMessage])

  useEffect(() => {
    if (hash === 'reset') {
      resetConversation()
      setHash('')
    }
  }, [hash, setHash, resetConversation])

  const chat = useMemo(
    () => ({
      botId,
      bot: chatState.bot,
      isSpeaking: speaker.isSpeaking,
      messages: chatState.messages,
      generatingMessageId: chatState.generatingMessageId,
      sendMessage,
      setInput,
      input,
      resetConversation,
      generating: !!chatState.generatingMessageId,
      stopGenerating,
      uploadImage,
      setAttachmentList,
      attachmentList,
    }),
    [
      botId,
      chatState.bot,
      chatState.generatingMessageId,
      chatState.messages,
      speaker.isSpeaking,
      setInput,
      input,
      setAttachmentList,
      attachmentList,
      resetConversation,
      sendMessage,
      stopGenerating,
    ],
  )

  return chat
}

export type BingReturnType = ReturnType<typeof useBing>
