import { useState } from 'react'
import { MemoizedReactMarkdown } from "./markdown"
import { SVG } from "./ui/svg"
import CheckMarkIcon from '@/assets/images/check-mark.svg'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog'

interface ChatProgressProps {
  progress?: string[]
  /** 当前是否处于免费 Bing 搜索模式（其结果可能受反爬影响） */
  bingMode?: boolean
  /** 当前是否处于 Kimi 自带联网搜索模式 */
  kimiMode?: boolean
}

export function ChatProgress({ progress = [], bingMode = false, kimiMode = false }: ChatProgressProps) {
  const [reasonOpen, setReasonOpen] = useState(false)
  const [kimiOpen, setKimiOpen] = useState(false)

  return progress?.length ? (
    <div className="chat-progress my-3">
      {progress.map((item, index) => {
        const isSearchStep = item.startsWith('正在搜索')
        const isKimiSearch = item.startsWith('正在搜索（Kimi')
        return (
          <div key={index} className="chat-progress__item flex items-start gap-1.5">
            <SVG src={CheckMarkIcon} width={28} fill="#13a10e" />
            <div className="body-1 meta-text">
              <MemoizedReactMarkdown>{item}</MemoizedReactMarkdown>
            </div>
            {bingMode && isSearchStep && !isKimiSearch && (
              <button
                type="button"
                onClick={() => setReasonOpen(true)}
                className="shrink-0 cursor-pointer border-none bg-transparent p-0 text-xs text-neutral-400 hover:text-neutral-600 hover:underline"
              >
                搜索结果可能不正确 查看原因-&gt;
              </button>
            )}
            {kimiMode && isKimiSearch && (
              <button
                type="button"
                onClick={() => setKimiOpen(true)}
                className="shrink-0 cursor-pointer border-none bg-transparent p-0 text-xs text-neutral-400 hover:text-neutral-600 hover:underline"
              >
                使用 Kimi 自带联网搜索有暂未解决的细节 查看更多-&gt;
              </button>
            )}
          </div>
        )
      })}
      <Dialog open={reasonOpen} onOpenChange={setReasonOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>为什么搜索结果可能不正确？</DialogTitle>
            <DialogDescription>
              <div>你当前使用的&ldquo;免费&rdquo;搜索是通过抓取 Bing 网页结果页实现的。为防爬虫，Bing 在请求较频繁或无浏览器 Cookie 时，会返回一套固定的&ldquo;填充结果&rdquo;（例如 2026 日历、世界杯、节假日等），这些结果与你的问题并无直接关系；同时，页面结构抓取也可能夹杂一些图片或相关推荐条目，导致来源不够精确。</div>
              <p className="mt-3 text-sm text-neutral-600 leading-relaxed">
                如果遇到这类情况，建议在「设置」中切换到 <b>Serper.dev</b> 或 <b>Tavily</b>（填写对应的 API Key），它们提供更稳定、更准确的付费搜索接口。
              </p>
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
      <Dialog open={kimiOpen} onOpenChange={setKimiOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>关于 Kimi 自带联网搜索</DialogTitle>
            <DialogDescription>
              <p className="text-sm text-neutral-600 leading-relaxed">
                Kimi 会自动进行联网搜索，但本应用目前暂未解析并展示每次搜索的具体来源链接与逐句引用（Kimi 网页版直接展示来源，API 侧暂未完整对接）。答案内容基于 Kimi 的联网结果生成，仅作为参考。
              </p>
              <p className="mt-3 text-sm text-neutral-600 leading-relaxed">
                如需带来源的搜索结果，可在「设置」中将搜索提供方切换为 Serper / Tavily，或关闭 Kimi 原生搜索后改用自建搜索。
              </p>
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </div>
  ) : null
}