import { useCallback, useEffect, useState } from 'react'
import { useAtom } from 'jotai'
import { Switch } from '@headlessui/react'
import { toast } from 'react-hot-toast'
import { hashAtom, historyAtom, isImageOnly, voiceAtom } from '@/state'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { ChunkKeys, parseCookies, extraCurlFromCookie, parseHeadersFromCurl, encodeHeadersToCookie, setCookie, resetCookies } from '@/lib/utils'
import { ExternalLink } from './external-link'
import { useCopyToClipboard } from '@/lib/hooks/use-copy-to-clipboard'
import { openAIConfigAtom, DEFAULT_STYLE_MODEL_PARAMS, StyleModelParams, StyleModelParamsMap } from '@/state/openai'
import { saveConfig } from '@/lib/bridge'

export function Settings() {
  const { isCopied, copyToClipboard } = useCopyToClipboard({ timeout: 2000 })
  const [loc, setLoc] = useAtom(hashAtom)
  const [curlValue, setCurlValue] = useState(extraCurlFromCookie(parseCookies(document.cookie, ChunkKeys)))
  const [imageOnly, setImageOnly] = useState(isImageOnly)
  const [enabledHistory, setHistory] = useAtom(historyAtom)
  const [enableTTS, setEnableTTS] = useAtom(voiceAtom)
  const [openAIConfig, setOpenAIConfig] = useAtom(openAIConfigAtom)

  useEffect(() => {
    if (isCopied) {
      toast.success('复制成功')
    }
  }, [isCopied])

  const handleSwitchImageOnly = useCallback((checked: boolean) => {
    let headerValue = curlValue
    if (headerValue) {
      try {
        headerValue = atob(headerValue)
      } catch (e) { }
      if (!/^\s*curl ['"]https:\/\/www\.bing\.com\/turing\/captcha\/challenge['"]/.test(headerValue)) {
        toast.error('用户信息格式不正确')
        return
      }
      setImageOnly(checked)
    } else {
      setImageOnly(checked)
    }
    if (checked) {
      setHistory(false)
    }
  }, [curlValue])

  /** 保存整个 AI 配置并关闭对话框 */
  const saveOpenAIConfig = useCallback(async () => {
    setOpenAIConfig(openAIConfig)
    // 桌面版：持久化到 Rust 本地 SQLite（无登录，纯本地）
    try {
      await saveConfig({
        base_url: openAIConfig.baseURL || '',
        api_key: openAIConfig.apiKey || '',
        model: openAIConfig.model || '',
        search_provider: openAIConfig.searchProvider || 'free',
        serper_key: openAIConfig.serperApiKey || '',
        tavily_key: openAIConfig.tavilyApiKey || '',
        use_kimi_search: !!openAIConfig.useKimiSearch,
        use_custom_system_prompt: !!openAIConfig.useCustomSystemPrompt,
        custom_system_prompt: openAIConfig.customSystemPrompt || '',
        use_partial_mode: !!openAIConfig.usePartialMode,
        partial_prefix: openAIConfig.partialPrefix || '',
        partial_name: openAIConfig.partialName || '',
        advanced: JSON.stringify(openAIConfig.advanced || {}),
        bing_header: curlValue,
      })
    } catch {
      toast.error('本地保存失败')
    }
    toast.success('保存成功')
    setLoc('')
  }, [openAIConfig, setOpenAIConfig, curlValue, setLoc])

  /** 更新高级模型设置里某样式的某参数（布尔/字符串直接写入，undefined 表示不填该字段） */
  const patchStyle = useCallback((tone: 'Creative' | 'Balanced' | 'Precise', patch: Partial<StyleModelParams>) => {
    setOpenAIConfig((prev) => {
      const cur = prev.advanced || DEFAULT_STYLE_MODEL_PARAMS
      return {
        ...prev,
        advanced: {
          ...cur,
          [tone]: { ...(cur[tone] || {}), ...patch },
        },
      }
    })
  }, [setOpenAIConfig])

  if (loc === 'settings') {
    return (
      <Dialog open onOpenChange={() => setLoc('')} modal>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>设置你的用户信息</DialogTitle>
            <DialogDescription>
              请使用 Edge 浏览器
              <ExternalLink
                href="https://www.bing.com"
              >
                打开并登录 Bing
              </ExternalLink>
              ，然后再打开
              <ExternalLink href="https://www.bing.com/turing/captcha/challenge">Challenge 接口</ExternalLink>
              右键 》检查。打开开发者工具，在网络里面找到 Challenge 接口 》右键复制》复制为 cURL(bash)，粘贴到此处，然后保存。
              <div className="h-2" />
              图文示例：
              <ExternalLink href="https://github.com/YRwuhu/ReSydney#如何获取-bing_header">如何获取 BING_HEADER</ExternalLink>
            </DialogDescription>
          </DialogHeader>
          <Input
            value={curlValue}
            placeholder="在此填写用户信息，格式: curl 'https://www.bing.com/turing/captcha/challenge' ..."
            onChange={e => {
              setCurlValue(e.target.value)
            }}
          />
          <div className="flex gap-2">
            <Switch
              checked={imageOnly}
              className={`${imageOnly ? 'bg-blue-600' : 'bg-gray-200'} relative inline-flex h-6 w-11 items-center rounded-full`}
              onChange={(checked: boolean) => handleSwitchImageOnly(checked)}
            >
              <span
                className={`${imageOnly ? 'translate-x-6' : 'translate-x-1'} inline-block h-4 w-4 transform rounded-full bg-white transition`}
              />
            </Switch>
            尝试修复用户信息异常
          </div>

          <div className="flex gap-2">
            <Switch
              checked={enabledHistory}
              className={`${enabledHistory ? 'bg-blue-600' : 'bg-gray-200'} relative inline-flex h-6 w-11 items-center rounded-full`}
              onChange={(checked: boolean) => setHistory(checked)}
            >
              <span
                className={`${enabledHistory ? 'translate-x-6' : 'translate-x-1'} inline-block h-4 w-4 transform rounded-full bg-white transition`}
              />
            </Switch>
            启用历史记录
          </div>

          <Button variant="ghost" className="bg-[#F5F5F5] hover:bg-[#F2F2F2]" onClick={() => copyToClipboard(btoa(curlValue))}>
            转成 BING_HEADER 并复制
          </Button>

          <Button variant="ghost" className="bg-[#F5F5F5] hover:bg-[#F2F2F2]" onClick={() => copyToClipboard(parseHeadersFromCurl(curlValue).cookie)}>
            获取 BING_COOKIE 并复制
          </Button>

          <DialogFooter className="items-center">
            <Button
              variant="secondary"
              className="bg-[#c7f3ff] hover:bg-[#fdc7ff]"
              onClick={() => {
                let headerValue = curlValue
                if (headerValue) {
                  try {
                    headerValue = atob(headerValue)
                  } catch (e) { }
                  if (!/^\s*curl ['"]https:\/\/(www|cn)\.bing\.com\/turing\/captcha\/challenge['"]/.test(headerValue)) {
                    toast.error('用户信息格式不正确')
                    return
                  }
                  encodeHeadersToCookie(headerValue).forEach(cookie => setCookie(cookie))
                } else {
                  resetCookies()
                }
                setCookie('IMAGE_ONLY', RegExp.$1 === 'cn' || imageOnly || !headerValue ? '1' : '0')

                toast.success('保存成功')
                setLoc('')
                // 同时持久化 Bing Header 到本地库
                saveConfig({
                  base_url: openAIConfig.baseURL || '',
                  api_key: openAIConfig.apiKey || '',
                  model: openAIConfig.model || '',
                  search_provider: openAIConfig.searchProvider || 'free',
                  serper_key: openAIConfig.serperApiKey || '',
                  tavily_key: openAIConfig.tavilyApiKey || '',
                  use_kimi_search: !!openAIConfig.useKimiSearch,
                  use_custom_system_prompt: !!openAIConfig.useCustomSystemPrompt,
                  custom_system_prompt: openAIConfig.customSystemPrompt || '',
                  use_partial_mode: !!openAIConfig.usePartialMode,
                  partial_prefix: openAIConfig.partialPrefix || '',
                  partial_name: openAIConfig.partialName || '',
                  advanced: JSON.stringify(openAIConfig.advanced || {}),
                  bing_header: curlValue,
                }).catch(() => {})
              }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  } else if (loc === 'openai') {
    return (
      <Dialog open onOpenChange={() => setLoc('')} modal>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>AI 接口设置</DialogTitle>
            <DialogDescription>
              配置自定义的 AI 接口（OpenAI 兼容格式，如 OpenAI / DeepSeek / 通义千问 / Ollama 等）。
              接口地址和密钥都填写后，对话将使用你配置的接口；留空则继续使用 New Bing。
              <div className="h-2" />
              也可以使用环境变量
              <code className="rounded bg-muted px-1">NEXT_PUBLIC_OPENAI_API_URL</code>、
              <code className="rounded bg-muted px-1">NEXT_PUBLIC_OPENAI_API_KEY</code>、
              <code className="rounded bg-muted px-1">NEXT_PUBLIC_OPENAI_MODEL</code>
              作为默认值。
              <div className="h-2" />
              搜索、自定义系统提示词、按样式的模型参数已拆分为独立设置项，从
              <code className="rounded bg-muted px-1">设置</code>菜单进入。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input
              value={openAIConfig.baseURL}
              placeholder="接口地址，如 https://api.openai.com/v1"
              onChange={e => setOpenAIConfig({ ...openAIConfig, baseURL: e.target.value })}
            />
            <Input
              type="password"
              value={openAIConfig.apiKey}
              placeholder="接口密钥 (API Key)"
              onChange={e => setOpenAIConfig({ ...openAIConfig, apiKey: e.target.value })}
            />
            <Input
              value={openAIConfig.model}
              placeholder="模型名称，如 gpt-4o-mini / deepseek-chat"
              onChange={e => setOpenAIConfig({ ...openAIConfig, model: e.target.value })}
            />
          </div>

          <DialogFooter className="items-center">
            <Button variant="secondary" className="bg-[#c7f3ff] hover:bg-[#fdc7ff]" onClick={saveOpenAIConfig}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  } else if (loc === 'search') {
    return (
      <Dialog open onOpenChange={() => setLoc('')} modal>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>搜索设置</DialogTitle>
            <DialogDescription>
              联网搜索的「搜索提供方」。默认「免费」，无需任何 Key（抓取 Bing）；
              也可选 Serper 或 Tavily（更稳、不受刮取限制，需各自填 Key）。
              <div className="h-2" />
              当接口使用 Kimi 模型时，可勾选下方选项改用 Kimi 自带的联网搜索。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <span className="w-24 shrink-0">搜索提供方</span>
              <select
                value={openAIConfig.searchProvider || 'free'}
                className="flex-1 rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                onChange={e => setOpenAIConfig({ ...openAIConfig, searchProvider: e.target.value as 'free' | 'serper' | 'tavily' })}
              >
                <option value="free">免费（Bing）</option>
                <option value="serper">Serper.dev</option>
                <option value="tavily">Tavily</option>
              </select>
            </div>
            <Input
              type="password"
              value={openAIConfig.serperApiKey || ''}
              placeholder="Serper Key（https://serper.dev，选 Serper 时填）"
              onChange={e => setOpenAIConfig({ ...openAIConfig, serperApiKey: e.target.value })}
            />
            <Input
              type="password"
              value={openAIConfig.tavilyApiKey || ''}
              placeholder="Tavily Key（https://tavily.com，选 Tavily 时填）"
              onChange={e => setOpenAIConfig({ ...openAIConfig, tavilyApiKey: e.target.value })}
            />
            {(() => {
              const m = (openAIConfig.model || '').toLowerCase()
              const b = (openAIConfig.baseURL || '').toLowerCase()
              const isKimi = m.includes('kimi') || b.includes('moonshot') || b.includes('kimi')
              return isKimi ? (
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!openAIConfig.useKimiSearch}
                    onChange={e => setOpenAIConfig({ ...openAIConfig, useKimiSearch: e.target.checked })}
                    className="h-4 w-4"
                  />
                  <span>使用 Kimi 自带联网搜索（绕过 Bing 抓取，结果更稳）</span>
                </label>
              ) : null
            })()}
          </div>

          <DialogFooter className="items-center">
            <Button variant="secondary" className="bg-[#c7f3ff] hover:bg-[#fdc7ff]" onClick={saveOpenAIConfig}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  } else if (loc === 'system-prompt') {
    return (
      <Dialog open onOpenChange={() => setLoc('')} modal>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>自定义系统提示词</DialogTitle>
            <DialogDescription>
              默认使用内置的 Sydney 提示词；开启后可用任意文本自定义 AI 的身份、语气与规则。
              <div className="h-2" />
              Partial Mode（Kimi 专有）让模型顺着指定前缀继续生成，而不是从头开始回复，
              可用于固定回复开头或角色扮演，详见
              <ExternalLink href="https://platform.kimi.com/docs/guide/use-partial-mode-feature-of-kimi-api">Kimi Partial Mode 文档</ExternalLink>。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={!!openAIConfig.useCustomSystemPrompt}
                onChange={e => setOpenAIConfig({ ...openAIConfig, useCustomSystemPrompt: e.target.checked })}
                className="h-4 w-4"
              />
              <span>启用自定义系统提示词</span>
            </label>
            <textarea
              value={openAIConfig.customSystemPrompt || ''}
              disabled={!openAIConfig.useCustomSystemPrompt}
              rows={10}
              placeholder="在此输入自定义系统提示词…"
              className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              onChange={e => setOpenAIConfig({ ...openAIConfig, customSystemPrompt: e.target.value })}
            />

            <div className="mt-2 border-t border-input pt-3">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!openAIConfig.usePartialMode}
                  onChange={e => setOpenAIConfig({ ...openAIConfig, usePartialMode: e.target.checked })}
                  className="h-4 w-4"
                />
                <span>启用 Partial Mode（Kimi）</span>
              </label>
              <textarea
                value={openAIConfig.partialPrefix || ''}
                disabled={!openAIConfig.usePartialMode}
                rows={3}
                placeholder="回复前缀（模型强制以该内容开头继续生成），如：尊敬的用户您好，"
                className="mt-2 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                onChange={e => setOpenAIConfig({ ...openAIConfig, partialPrefix: e.target.value })}
              />
              <Input
                value={openAIConfig.partialName || ''}
                disabled={!openAIConfig.usePartialMode}
                placeholder="角色名（可选，固定回复口吻），如：凯尔希"
                className="mt-2"
                onChange={e => setOpenAIConfig({ ...openAIConfig, partialName: e.target.value })}
              />
              <p className="mt-2 text-xs text-gray-500">
                仅对 Kimi 模型生效。勾选后每次回复都会先输出前缀，再让模型顺着继续生成。
              </p>
            </div>
          </div>

          <DialogFooter className="items-center">
            <Button variant="secondary" className="bg-[#c7f3ff] hover:bg-[#fdc7ff]" onClick={saveOpenAIConfig}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  } else if (loc === 'advanced') {
    const tones: { key: 'Creative' | 'Balanced' | 'Precise'; label: string; desc: string }[] = [
      { key: 'Creative', label: '有创造力', desc: '' },
      { key: 'Balanced', label: '平衡', desc: '' },
      { key: 'Precise', label: '精确', desc: '' },
    ]
    const fields: { key: 'temperature' | 'topP' | 'maxTokens' | 'frequencyPenalty' | 'presencePenalty'; label: string; hint: string }[] = [
      { key: 'temperature', label: 'temperature', hint: '随机性，0~2' },
      { key: 'topP', label: 'top_p', hint: '核采样，0~1' },
      { key: 'maxTokens', label: 'max_tokens', hint: '最大生成长度（正整数）' },
      { key: 'frequencyPenalty', label: 'frequency_penalty', hint: '-2~2' },
      { key: 'presencePenalty', label: 'presence_penalty', hint: '-2~2' },
    ]
    const advanced: StyleModelParamsMap = openAIConfig.advanced || DEFAULT_STYLE_MODEL_PARAMS
    return (
      <Dialog open onOpenChange={() => setLoc('')} modal>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>高级模型设置</DialogTitle>
            <DialogDescription>
              为三种对话样式分别配置模型参数（temperature / top_p / max_tokens 等）。
              留空表示不发送该字段（temperature 留空则用默认值 1）。
              <div className="h-2" />
              思考模型（如 Kimi k3 / k2.6）可控制「是否开启思考」「是否显示思考过程」，以及「推理强度」。
              「推理强度」仅对支持 reasoning_effort 的模型（如 kimi-k3）生效。
              <div className="h-2" />
              当接口报「invalid temperature」等 400 错误时，在这里把当前样式的 temperature 调到模型支持的值。
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {tones.map(tone => (
              <div key={tone.key} className="rounded-md border border-input p-3">
                <div className="mb-1 text-sm font-medium">{tone.label}</div>
                {tone.desc ? <div className="mb-2 text-xs text-gray-500">{tone.desc}</div> : null}
                <div className="flex flex-col gap-2">
                  {fields.map(f => (
                    <label key={String(f.key)} className="flex items-center gap-3 text-sm">
                      <span className="w-36 shrink-0">{f.label}</span>
                      <Input
                        type="number"
                        value={advanced[tone.key][f.key] ?? ''}
                        placeholder={f.hint}
                        onChange={e => patchStyle(tone.key, { [f.key]: e.target.value === '' ? undefined : Number(e.target.value) } as Partial<StyleModelParams>)}
                      />
                    </label>
                  ))}
                  <div className="mt-3 flex flex-col gap-2 border-t border-input pt-3">
                    <label className="flex items-center gap-3 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!advanced[tone.key].enableThinking}
                        onChange={e => patchStyle(tone.key, { enableThinking: e.target.checked })}
                        className="h-4 w-4 shrink-0"
                      />
                      <span className="w-36 shrink-0">开启思考（推理模式）</span>
                    </label>
                    <label className="flex items-center gap-3 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!advanced[tone.key].showThinking}
                        onChange={e => patchStyle(tone.key, { showThinking: e.target.checked })}
                        className="h-4 w-4 shrink-0"
                      />
                      <span className="w-36 shrink-0">显示思考过程</span>
                    </label>
                    <label className="flex items-center gap-3 text-sm">
                      <span className="w-36 shrink-0">推理强度</span>
                      <select
                        value={advanced[tone.key].reasoningEffort || ''}
                        onChange={e => patchStyle(tone.key, { reasoningEffort: (e.target.value || undefined) as 'low' | 'high' | 'max' | undefined })}
                        className="min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                      >
                        <option value="">默认</option>
                        <option value="low">low</option>
                        <option value="high">high</option>
                        <option value="max">max</option>
                      </select>
                    </label>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <DialogFooter className="items-center">
            <Button variant="secondary" className="bg-[#c7f3ff] hover:bg-[#fdc7ff]" onClick={saveOpenAIConfig}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  } else if (loc === 'voice') {
    return (
      <Dialog open onOpenChange={() => setLoc('')} modal>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>语音设置</DialogTitle>
            <DialogDescription>
              目前仅支持 PC 端 Edge 及 Chrome 浏览器
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-2">
            启用语音回答
            <Switch
              checked={enableTTS}
              className={`${enableTTS ? 'bg-blue-600' : 'bg-gray-200'} relative inline-flex h-6 w-11 items-center rounded-full`}
              onChange={(checked: boolean) => setEnableTTS(checked)}
            >
              <span
                className={`${enableTTS ? 'translate-x-6' : 'translate-x-1'} inline-block h-4 w-4 transform rounded-full bg-white transition`}
              />
            </Switch>
          </div>

          <DialogFooter className="items-center">
            <Button
              variant="secondary"
              onClick={() => {
                toast.success('保存成功')
                setLoc('')
              }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }
  return null
}
