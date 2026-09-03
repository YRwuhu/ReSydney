//! AI 画图工具：识别"画图意图"并调用 Rust 侧 bing_create_image 文生图接口。
//! 两个机器人（BingWebBot / OpenAIBot）共用：命中意图 → 直接走图像生成，
//! 生成结果（4 张图的 markdown）通过标准 Event 流回给前端，复用现有进度/历史/错误 UI。

import { ChatError, ErrorCode, Event } from './types'
import { readBingSession } from './session'
import { bingCreateImage } from '@/lib/bridge'
import { nanoid } from '@/lib/utils'

/** 产出的非图类内容（生成动词后接这些词时不触发工具，避免误伤） */
const NON_IMAGE_OUTPUT = /^(代码|方案|报告|脚本|文本|文案|内容|文章|句子|数据|列表|计划|表格|视频|音频|语音|音乐|标题|摘要)/
/** 内容里含图相关词才算"生成图"类请求 */
const IMAGE_WORDS = /(图|图片|图像|图画|插画|壁纸|海报|头像|漫画|卡通|logo|画|意境)/i
/** "画" 字后接这些首字的多为名词（画风/画面/画家…），不是画图请求 */
const NOUN_FIRST_CHAR = '图风画面家展册卷师稿板框笔纸布纹质法影乐谱重'

function cleanPrompt(s: string): string {
  return s.trim().replace(/[。．！!？?；;、，,.\s]+$/g, '').trim()
}

/**
 * 从用户输入中提取画图请求；不是画图请求时返回 null。
 * 支持：/画 xxx、/draw xxx、/img xxx、"画一只猫"、"帮我画…"、"生成一张…图"、"draw …"
 */
export function extractDrawPrompt(input: string): string | null {
  const text = (input || '').trim()
  if (!text || text.length < 2 || text.length > 500) return null

  // 斜杠命令：/画 xxx、/draw xxx、/img xxx，以及"画图 xxx"
  let m = text.match(/^\/?(?:画|draw|img)[：:\s]+(.+)$/i)
  if (m) {
    const p = cleanPrompt(m[1])
    return p ? p : null
  }
  m = text.match(/^画图[：:\s]+(.+)$/)
  if (m) {
    const p = cleanPrompt(m[1])
    return p ? p : null
  }

  // 画 / 帮我画 / 请画 …（排除"画图/画风/画面…"名词开头，避免误伤）
  m = text.match(
    new RegExp(
      `^(?:帮我|给我|请|麻烦|麻烦你|你帮我)?画(?!图|[${NOUN_FIRST_CHAR}])(?:一下|一张|一个|一幅|一只|一点|张|幅|只|个|条|朵|座|辆)?(.+)$`,
    ),
  )
  if (m) {
    const p = cleanPrompt(m[1])
    if (p) return p
  }

  // 绘制 / 生成 / 创作（仅当内容含图相关词且不以非图产出开头）
  m = text.match(/^(?:帮我|给我|请|麻烦|麻烦你)?(?:绘制|生成|创作)(?:一(?:张|幅|个|只))?(.+)$/)
  if (m) {
    const rest = m[1]
    if (!NON_IMAGE_OUTPUT.test(rest) && IMAGE_WORDS.test(rest)) {
      const p = cleanPrompt(rest)
      if (p) return p
    }
  }

  // 英文：draw/paint 直接触发；generate/create 需带图相关词
  m = text.match(/^(?:draw|paint)\s+(?:me\s+)?(?:a|an|the|one|some)?\s*(.+)$/i)
  if (m) {
    const p = cleanPrompt(m[1])
    if (p) return p
  }
  m = text.match(/^(?:generate|create)\s+(?:a|an|the|one|some)?\s*(.+)$/i)
  if (m) {
    const p = cleanPrompt(m[1])
    if (p && IMAGE_WORDS.test(p)) return p
  }

  return null
}

/**
 * 执行画图工具并驱动标准事件流（进度 → 结果 markdown → DONE / ERROR）。
 * 画图请求与聊天会话无关，不需要先创建对话上下文。
 */
export async function runDrawTool(params: {
  prompt: string
  signal?: AbortSignal
  onEvent: (event: Event) => void
}): Promise<void> {
  const { prompt, signal, onEvent } = params
  const session = readBingSession()
  if (!session.bing_header) {
    onEvent({
      type: 'ERROR',
      error: new ChatError('画图工具需要 Bing 凭证：请打开设置页，登录 Bing 后复制对谈令牌填入', ErrorCode.UNKOWN_ERROR),
    })
    return
  }

  onEvent({ type: 'UPDATE_ANSWER', data: { text: '', progressText: `正在调用画图工具生成：${prompt}` } })
  try {
    const markdown = await bingCreateImage({
      bing_header: session.bing_header,
      // 画图固定走真实请求头路径（已实测可用）；mock 模式仅用于聊天兜底
      image_only: false,
      prompt,
      id: nanoid(8),
      cookie: session.cookie,
    })
    if (signal?.aborted) return
    onEvent({ type: 'UPDATE_ANSWER', data: { text: markdown } })
    onEvent({ type: 'DONE' })
  } catch (err) {
    if (signal?.aborted) return
    const message = err instanceof Error ? err.message : String(err)
    onEvent({ type: 'ERROR', error: new ChatError(message || '画图失败', ErrorCode.NETWORK_ERROR) })
  }
}