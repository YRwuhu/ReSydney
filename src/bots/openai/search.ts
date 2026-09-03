export interface SearchResult {
  title: string
  url: string
  snippet: string
  /** 从结果页提取的正文文本（服务端抓取，可能为空） */
  content?: string
}

/** 今天的日期字符串（如：2026年8月25日（星期二）） */
export function getTodayString(): string {
  const d = new Date()
  const weekdays = ['日', '一', '二', '三', '四', '五', '六']
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（星期${weekdays[d.getDay()]}）`
}

/** 让 AI 判断是否需要联网搜索、以及搜索什么（只输出 JSON），带当前日期 */
export function buildSearchDecisionPrompt(today: string): string {
  return `今天是 ${today}。
你是一个搜索引擎调用器。请根据用户最新的问题和对话历史，判断是否需要联网搜索才能给出准确、及时的答案。

需要搜索的情况：实时信息、新闻、事实核查、网址、商品价格、具体事件、需要外部资料/最新资料的问题等。
不需要搜索的情况：纯闲聊、创意写作、数学计算、常识性问答、写代码、翻译、根据已有对话可回答的问题。

只输出一个 JSON 对象，不要任何其他内容（不要 markdown 代码块）：
{"shouldSearch": true 或 false, "query": "搜索词"}

「搜索词」必须尽量简短，**只保留核心实体名/关键词**，删掉「完整版」「是什么」「怎么做」「如何」「有哪些」这类修饰语——加它们会让搜索引擎(尤其 Bing)匹配失败。示例：
- 问题「2025年苹果发布了哪些新iPhone」→「2025年 新iPhone」
- 问题「怎么让狗听懂自己的口令」→「狗 口令训练」
- 问题「今天北京天气」→「北京 天气」
涉及新闻/最新动态/实时信息时，搜索词必须包含今天的日期，如「${today} 新闻」「${today} 股市」。

⚠️ 过短的搜索词是垃圾结果（尤其词典释义）的常见来源，务必遵守：
- 搜索词太短（如 1 个普通英文单词、或只剩一个形容词/普通名词）时，**必须补上能限定语义的上下文**，否则搜索引擎只会返回该单词的词典释义。
- 作品名/实体名要保留完整：搜「Operation Blade 明日方舟」这首歌曲时，搜索词必须包含「Blade」和「明日方舟」，不能只留「Operation」（那样只能搜到 operation 的释义）。
- 用户写的词是歌名/人名/作品名、且容易与普通词混淆时，追加作品语境（如「Operation Blade 明日方舟」）。`
}

/** 回答结束后，让 AI 生成用户的可能的追问（只输出 JSON 数组） */
export const SUGGEST_PROMPT = `基于你刚才的回答，输出 2-3 个简短的中文追问（每个不超过 20 字），用户可能接着问的话。
只输出一个 JSON 数组，例如 ["追问一", "追问二"]，不要任何其他内容（不要 markdown 代码块）。`

/** 把搜索结果构建成注入上下文 */
export function buildSearchContext(query: string, results: SearchResult[]) {
  if (!results.length) {
    return `用户要求针对「${query}」进行联网搜索，但没有找到相关且可用的结果。
请如实回答：无法从这次搜索结果中找到关于「${query}」的可靠资料，并给出合理的后续建议（如换个说法再搜索、或指出需要哪些更多信息）。不要编造，不要根据搜索词的词面意思（如查歌名却去找单词释义）胡编。`
  }
  const lines = results.map((r, i) => {
    const snippet = r.snippet ? `：${r.snippet}` : '：(无摘要)'
    const content = r.content ? `\n    页面正文摘录：${r.content}` : ''
    return `[${i + 1}] ${r.title}${snippet}（来源：${r.url}）${content}`
  })
  return `以下是针对「${query}」的网页搜索结果（已附带各结果页的正文摘录，可从中提取更详细的信息），请优先基于这些结果回答。

引用规则（必须遵守）：
- 每一条来自搜索结果的陈述（事实、数据、新闻、观点）都要在句子末尾标注来源编号，格式为 [数字]，例如「……2026年被确定为可持续发展志愿者国际年[1]。」
- 编号必须与下方列表的编号一一对应；同一条来源可被多次引用。
- 不要在「引用规则」或其他非陈述位置使用 [数字]。
- 如果搜索结果中没有任何相关内容，就如实说明，不要编造。
- 内容应尽量充分利用「页面正文摘录」中的具体信息，避免只停留在摘要层面。

搜索结果：
${lines.join('\n')}`
}

/** 从 AI 输出中提取 JSON（容忍 markdown 代码块 / 前后杂质） */
export function parseAiJson<T>(raw: string): T | null {
  if (!raw) return null
  let text = raw.trim()
  // 去掉 ```json ... ``` 代码块
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  // 截取第一个 { ... } 或 [ ... ]
  const jsonStart = text.search(/[[{]/)
  if (jsonStart === -1) return null
  text = text.slice(jsonStart)
  const open = text[0]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inStr = false
  let end = -1
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"' && text[i - 1] !== '\\') inStr = !inStr
    if (!inStr) {
      if (ch === open) depth++
      else if (ch === close) {
        depth--
        if (depth === 0) { end = i + 1; break }
      }
    }
  }
  if (end === -1) return null
  try {
    return JSON.parse(text.slice(0, end)) as T
  } catch {
    return null
  }
}
