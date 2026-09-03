import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { Toaster } from 'react-hot-toast'
import { getDefaultStore } from 'jotai'
import { Providers } from '@/components/providers'
import { Header } from '@/components/header'
import { Footer } from '@/components/footer'
import Chat from '@/components/chat'
import { openAIConfigAtom } from '@/state/openai'
import { localChatsAtom, LocalChat } from '@/state/history'
import { loadConfig, listChats } from '@/lib/bridge'

import '@/globals.scss'

const store = getDefaultStore()

/** 启动时从 Rust 本地库恢复配置与历史（桌面版无登录，等价于 Web 版的 auth 同步）。 */
function Bootstrap({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const cfg = await loadConfig()
        if (!cancelled && (cfg.base_url || cfg.model)) {
          let advanced: Record<string, unknown> | undefined
          try {
            advanced = cfg.advanced ? JSON.parse(cfg.advanced) : undefined
          } catch { /* ignore */ }
          store.set(openAIConfigAtom, {
            baseURL: cfg.base_url || '',
            apiKey: cfg.api_key || '',
            model: cfg.model || '',
            searchProvider: (cfg.search_provider || 'free') as any,
            serperApiKey: cfg.serper_key || '',
            tavilyApiKey: cfg.tavily_key || '',
            useKimiSearch: !!cfg.use_kimi_search,
            useCustomSystemPrompt: !!cfg.use_custom_system_prompt,
            customSystemPrompt: cfg.custom_system_prompt || '',
            usePartialMode: !!cfg.use_partial_mode,
            partialPrefix: cfg.partial_prefix || '',
            partialName: cfg.partial_name || '',
            advanced: advanced as any,
          })
        }
        const chats = await listChats()
        if (!cancelled && chats.length) {
          const localChats: LocalChat[] = chats.map((c) => {
            let messages: any[] = []
            let conversation: Record<string, unknown> = {}
            try { messages = JSON.parse(c.messages) } catch { /* ignore */ }
            try { conversation = JSON.parse(c.conversation) } catch { /* ignore */ }
            return {
              id: c.id,
              chatName: c.chat_name,
              tone: c.tone,
              messages,
              conversation,
              createTimeUtc: c.create_time_utc,
              updateTimeUtc: c.update_time_utc,
            }
          })
          store.set(localChatsAtom, localChats)
        }
      } catch {
        // 库不可用（首次运行等）时忽略，继续用默认空状态
      } finally {
        if (!cancelled) {
          setReady(true)
          // 应用已就绪，移除启动遮罩（index.html 中定义，淡出后自删）
          ;(window as Window & { __dismissLaunchMask?: () => void }).__dismissLaunchMask?.()
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="loading-spinner">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className={`bounce${i + 1}`} />)}
        </div>
      </div>
    )
  }
  return <>{children}</>
}

function App() {
  return (
    <Providers attribute="class" defaultTheme="light">
      <Bootstrap>
        <div className="flex flex-col min-h-screen">
          <Header />
          <main className="flex-1">
            <Chat />
          </main>
          <Footer />
        </div>
      </Bootstrap>
      <Toaster />
    </Providers>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
