import { useCallback, useEffect, useState } from 'react'
import { useChatHistory } from '@/lib/hooks/chat-history'
import { IconEdit, IconTrash, IconDownload, IconCheck, IconClose, IconSidebar } from './ui/icons'
import { cn, formatDate } from '@/lib/utils'
import { LocalChat } from '@/state'

interface ConversationTheadProps {
  conversation: LocalChat
  onRename: (conversation: LocalChat, chatName: string) => void
  onDelete: (conversation: LocalChat) => void
  onUpdate: (conversation: LocalChat) => void
  onDownload: (conversation: LocalChat) => void
}

const TONE_COLORS: Record<string, string> = {
  Creative: '#914887',
  Balanced: '#1b4aef',
  Precise: '#006880',
}

export function ConversationThead({ conversation, onRename, onDelete, onUpdate, onDownload }: ConversationTheadProps) {
  const [isEdit, setEdit] = useState(false)
  const [name, setName] = useState(conversation.chatName)
  const handleSave = useCallback(() => {
    if (!name) {
      setName(conversation.chatName)
      return
    }
    setEdit(false)
    onRename(conversation, name)
  }, [conversation, name])
  const handleDelete = useCallback(() => {
    onDelete(conversation)
  }, [conversation])
  const handleDownload = useCallback(() => {
    onDownload(conversation)
  }, [conversation])
  useEffect(() => {
    setName(conversation.chatName)
  }, [conversation])

  return (
    <div className={cn('thread', { active: isEdit })}>
      <div className="primary-row flex w-full">
        <div className="description flex-1">
          {!isEdit ? (
            <h3 className="name" title={name} onClick={() => onUpdate(conversation)}>
              <span
                className="tone-dot"
                style={{ background: TONE_COLORS[conversation.tone] || '#b9b9b9' }}
                aria-hidden="true"
              />
              {name}
            </h3>
          ) : (<input className="input-name" defaultValue={name} onChange={(event) => setName(event.target.value)} />)}
        </div>
        {!isEdit && (<h4 className="time">{formatDate(conversation.updateTimeUtc)}</h4>)}
        <div className="controls">
          {!isEdit ? (<>
            <button className="edit icon-button" type="button" aria-label="重命名" onClick={() => setEdit(true)}>
              <IconEdit />
            </button>

            <button className="delete icon-button" type="button" aria-label="删除" onClick={handleDelete}>
              <IconTrash />
            </button>

            <button className="export icon-button" type="button" aria-label="导出" onClick={handleDownload}>
              <IconDownload />
            </button>
          </>) : (
            <>
              <button className="edit icon-button" type="button" aria-label="保存" onClick={handleSave}>
                <IconCheck />
              </button>
              <button className="edit icon-button" type="button" aria-label="取消" onClick={() => setEdit(false)}>
                <IconClose />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export function ChatHistory({ className, expand, onToggle }: { className?: string, expand: boolean, onToggle: (flag: boolean) => void }) {
  const { chatHistory, deleteChat, renameChat, updateMessage, downloadMessage } = useChatHistory()
  const hasChats = (chatHistory?.length ?? 0) > 0

  return (
    <>
      {!expand && (
        <button
          className="chat-history-toggle"
          type="button"
          aria-label="历史记录"
          title="历史记录"
          onClick={() => onToggle(true)}
        >
          <IconSidebar />
        </button>
      )}
      {expand ? (
        <div className={cn('chat-history right-4 z-50 fixed', className)}>
          <div className="chat-history-header text-sm font-semibold text-left px-4 pb-6">
            <span>历史记录</span>
            <button
              className="chat-history-close"
              type="button"
              aria-label="收起"
              title="收起"
              onClick={() => onToggle(false)}
            >
              <IconClose />
            </button>
          </div>

          <div className="chat-history-main">
            <div className="scroller">
              <div className="surface">
                <div className="threads">
                  {hasChats ? chatHistory!.map((con) => (
                    <ConversationThead
                      key={con.id}
                      conversation={con}
                      onDelete={deleteChat}
                      onRename={renameChat}
                      onUpdate={updateMessage}
                      onDownload={downloadMessage}
                    />
                  )) : (
                    <div className="chat-history-empty">暂无历史记录</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
