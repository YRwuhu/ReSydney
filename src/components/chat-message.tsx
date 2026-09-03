'use client'

import { Fragment, ReactNode, useEffect, useMemo } from 'react'
import { useAtomValue } from 'jotai'
import { openAIConfigAtom } from '@/state/openai'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import supersub from 'remark-supersub'
import remarkBreaks from 'remark-breaks'
import { cn } from '@/lib/utils'
import { CodeBlock } from '@/components/ui/codeblock'
import { MemoizedReactMarkdown } from '@/components/markdown'
import { LearnMore } from './learn-more'
import { ChatMessageModel, Throttling } from '@/lib/bots/bing/types'
import { TurnCounter } from './turn-counter'
import { ChatFeedback } from './chat-feedback'
import { ChatProgress } from './chat-progress'

/**
 * 把文本子节点中的 [1][2] 渲染成蓝色圆徽章。
 * 仅当消息带真实来源（sourceAttributions）时才启用，避免把 AI 的章节号误当成引用。
 */
function renderCitations(children: ReactNode, keyBase: string, enabled: boolean): ReactNode {
  const renderChild = (child: ReactNode, i: number) => {
    if (typeof child === 'string' && enabled) {
      const parts = child.split(/(\[\d+\])/g)
      if (parts.length === 1) {
        return <Fragment key={`${keyBase}-${i}`}>{child}</Fragment>
      }
      return (
        <Fragment key={`${keyBase}-${i}`}>
          {parts.map((p, j) => (
            /^\[\d+\]$/.test(p) ? (
              <sup key={`${keyBase}-${i}-${j}`} className="citation-badge">{p.slice(1, -1)}</sup>
            ) : (
              <Fragment key={`${keyBase}-${i}-${j}`}>{p}</Fragment>
            )
          ))}
        </Fragment>
      )
    }
    return <Fragment key={`${keyBase}-${i}`}>{child}</Fragment>
  }
  return Array.isArray(children) ? children.map((c, i) => renderChild(c, i)) : renderChild(children, 0)
}

export interface ChatMessageProps {
  message: ChatMessageModel
  isGenerating?: boolean
}

/** 把响应文本按空行分隔的段落拆成多张"回复卡"，每句一张卡片 */
function splitIntoCards(text: string): string[] {
  // 用占位符保护 ``` 围栏代码块（可能跨多个空行），避免把代码块从中间切开
  const fences: string[] = []
  let protectedText = text.replace(/```[\s\S]*?```/g, (m) => {
    fences.push(m)
    return `\u0000CARD${fences.length - 1}\u0000`
  })

  // 按空行把段落拆开
  const parts = protectedText.split(/\n\s*\n+/)
  const cards: string[] = []

  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue
    cards.push(trimmed.replace(/\u0000CARD(\d+)\u0000/g, (_, i) => fences[Number(i)]))
  }

  return cards.length > 1 ? cards : [text]
}

/**
 * 根据代码内容派生稳定的 key（而非 Math.random()），
 * 避免流式每次重渲染都因 key 变化导致 CodeBlock 整块 remount（语法高亮反复重建）。
 */
function codeBlockKey(language: string, code: string): string {
  const sample = code.replace(/\s+/g, ' ').slice(0, 40)
  return `${language}:${sample}`
}

/** 构造 react-markdown 的 components（引用徽章 / 浮图 / 代码块），供多卡与单卡两种渲染路径复用 */
function markdownComponents(citationsEnabled: boolean) {
  return {
    p({ children }: any) {
      return <p className="mb-2">{renderCitations(children, 'p', citationsEnabled)}</p>
    },
    li({ children }: any) {
      return <li>{renderCitations(children, 'li', citationsEnabled)}</li>
    },
    img(obj: any) {
      try {
        const uri = new URL(obj.src!)
        const w = uri.searchParams.get('w')
        const h = uri.searchParams.get('h')
        if (w && h) {
          uri.searchParams.delete('w')
          uri.searchParams.delete('h')
          return <a style={{ float: 'left', maxWidth: '50%' }} href={uri.toString()} target="_blank" rel="noopener noreferrer"><img src={obj.src} alt={obj.alt} width={w!} height={h!} /></a>
        }
      } catch (e) {
      }
      return <img src={obj.src} alt={obj.alt} title={obj.title} />
    },
    code({ node, inline, className, children, ...props }: any) {
      const match = /language-(\w+)/.exec(className || '')
      if (inline) {
        return (
          <code className={className} {...props}>
            {children}
          </code>
        )
      }
      const value = String(children).replace(/\n$/, '')
      return (
        <CodeBlock
          key={codeBlockKey((match && match[1]) || '', value)}
          language={(match && match[1]) || ''}
          value={value}
          {...props}
        />
      )
    },
  }
}

/** 单张回复卡渲染 */
function ReplyCard({ text, sourceAttributions, throttling, citationsEnabled = false, className }: { text: string; sourceAttributions?: any[]; throttling?: Throttling; citationsEnabled?: boolean; className?: string }) {
  return (
    <div className={cn('text-message', 'bot', className)}>
      <div className="text-message-content">
        <MemoizedReactMarkdown
          linkTarget="_blank"
          className="prose break-words dark:prose-invert prose-p:leading-relaxed prose-pre:p-0"
          remarkPlugins={[remarkGfm, remarkMath, supersub, remarkBreaks]}
          rehypePlugins={[rehypeKatex]}
          components={markdownComponents(citationsEnabled)}
        >
          {text}
        </MemoizedReactMarkdown>
      </div>
      <div className="text-message-footer">
        <LearnMore sourceAttributions={sourceAttributions} />
        <TurnCounter throttling={throttling} />
      </div>
    </div>
  )
}

export function ChatMessage({ message, isGenerating, ...props }: ChatMessageProps) {
  const openAIConfig = useAtomValue(openAIConfigAtom)
  const bingMode = (openAIConfig.searchProvider || 'free') === 'free'
  const m = (openAIConfig.model || '').toLowerCase()
  const b = (openAIConfig.baseURL || '').toLowerCase()
  const kimiMode = !!openAIConfig.useKimiSearch && (m.includes('kimi') || b.includes('moonshot') || b.includes('kimi'))

  // 对 bot 消息按 [N] 段落拆成多张回复卡
  const cards = useMemo(() => {
    if (message.author === 'bot' && message.text) {
      return splitIntoCards(message.text)
    }
    return null
  }, [message.text, message.author])

  useEffect(() => {
    if (document.body.scrollHeight - window.innerHeight - window.scrollY - 200 < 0) {
      window.scrollBy(0, 200)
    }
  }, [message.text, message.thinking, message.progress?.length])

  return (
    <div className="response-message-group flex flex-col relative">
      {isGenerating && !message.text && !message.thinking && !message.progress?.length ? (
        <div className="generating-indicator">
          <span className="generating-spinner" aria-hidden="true" />
          <span>正在生成答案</span>
        </div>
      ) : (
        <ChatProgress progress={message.progress} bingMode={bingMode} kimiMode={kimiMode} />
      )}

      {message.author === 'bot' && message.thinking ? (
        <div className="thinking-block">
          <div className="thinking-label">思考过程</div>
          <div className="thinking-content">{message.thinking}</div>
        </div>
      ) : null}

      {cards && cards.length > 1 ? (
        // 多卡模式：每张回复卡独立渲染，中间用间距隔开
        <div className="reply-card-stack">
          {cards.map((cardText, idx) => (
            <ReplyCard
              key={idx}
              text={cardText}
              sourceAttributions={idx === 0 ? message.sourceAttributions : undefined}
              throttling={idx === 0 ? message.throttling : undefined}
              citationsEnabled={idx === 0 ? !!message.sourceAttributions?.length : false}
            />
          ))}
        </div>
      ) : message.text ? (
        <div className={cn('text-message', message.author)} {...props}>
          <ChatFeedback text={message.text} />
          <div className="text-message-content">
            <MemoizedReactMarkdown
              linkTarget="_blank"
              className="prose break-words dark:prose-invert prose-p:leading-relaxed prose-pre:p-0"
              remarkPlugins={[remarkGfm, remarkMath, supersub, remarkBreaks]}
              rehypePlugins={[rehypeKatex]}
              components={markdownComponents(!!message.sourceAttributions?.length)}
            >
              {message.text}
            </MemoizedReactMarkdown>
          </div>
          <div className="text-message-footer">
            <LearnMore sourceAttributions={message.sourceAttributions} />
            <TurnCounter throttling={message.throttling} />
          </div>
        </div>
      ) : null}
    </div>
  )
}
