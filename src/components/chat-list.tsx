import React from 'react'

import { Separator } from '@/components/ui/separator'
import { ChatMessage } from '@/components/chat-message'
import { ChatMessageModel } from '@/lib/bots/bing/types'

export interface ChatList {
  messages: ChatMessageModel[]
  generatingMessageId?: string
}

export function ChatList({ messages, generatingMessageId }: ChatList) {
  if (!messages.length) {
    return null
  }

  return (
    <div className="chat-container relative flex flex-col">
      {messages.map((message, index) => (
        <React.Fragment key={index}>
          <ChatMessage message={message} isGenerating={message.id === generatingMessageId} />
          {index < messages.length - 1 && (
            <Separator className="my-2" />
          )}
        </React.Fragment>
      ))}
    </div>
  )
}
