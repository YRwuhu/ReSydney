import React, { useEffect } from 'react'
import { atom, useAtom } from 'jotai'
import HelpIcon from '@/assets/images/help.svg?react'
import DismissFillIcon from '@/assets/images/dismiss-fill.svg?react'
import { SuggestedResponse } from '@/lib/bots/bing/types'
import { BingReturnType } from '@/lib/hooks/use-bing'

type Suggestions = SuggestedResponse[]
const helpSuggestions = ['为什么不回应某些主题', '告诉我更多关于必应的资迅', '必应如何使用 AI?'].map((text) => ({ text }))
const suggestionsAtom = atom<Suggestions>([])

type ChatSuggestionsProps = React.ComponentProps<'div'> & Pick<BingReturnType, 'setInput'> & { suggestions?: Suggestions }

export function ChatSuggestions({ setInput, suggestions = [] }: ChatSuggestionsProps) {
  const [currentSuggestions, setSuggestions] = useAtom(suggestionsAtom)
  const toggleSuggestions = (() => {
    if (currentSuggestions === helpSuggestions) {
      setSuggestions(suggestions)
    } else {
      setSuggestions(helpSuggestions)
    }
  })

  useEffect(() => {
    setSuggestions(suggestions)
  }, [suggestions, setSuggestions])

  useEffect(() => {
    setTimeout(() => {
      window.scrollBy(0, 800)
    }, 200)
  }, [])

  return currentSuggestions?.length ? (
    <div className="py-6">
      <div className="suggestion-items">
        <button className="rai-button" type="button" aria-label="这是什么?" onClick={toggleSuggestions}>
          {currentSuggestions === helpSuggestions ? (
            <DismissFillIcon width={24} fill="var(--cib-color-foreground-accent-primary)" />
          ) : (
            <HelpIcon width={24} fill="var(--cib-color-foreground-accent-primary)" />
          )}
        </button>
        {
          currentSuggestions.map(suggestion => (
            <button key={suggestion.text} className="body-1-strong suggestion-container" type="button" onClick={() => setInput(suggestion.text)}>
              {suggestion.text}
            </button>
          ))
        }
      </div>
    </div>
  ) : null
}
