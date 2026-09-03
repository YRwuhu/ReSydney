import React, { useEffect } from 'react'
import { useSetAtom } from 'jotai'
import { BingReturnType } from '@/lib/hooks/use-bing'
import VoiceIcon from '@/assets/images/voice.svg?react'
import VoiceButton from './ui/voice'
import { SR } from '@/lib/bots/bing/sr'
import { voiceListenAtom } from '@/state'
import { cn } from '@/lib/utils'

const sr = new SR(['发送', '清空', '退出'])

const Voice = ({ setInput, input, sendMessage, isSpeaking, className }: Pick<BingReturnType, 'setInput' | 'sendMessage' | 'input' | 'isSpeaking'> & { className?: string }) => {
  const setListen = useSetAtom(voiceListenAtom)
  useEffect(() => {
    if (sr.listening) return
    sr.transcript = !isSpeaking
  }, [isSpeaking])

  useEffect(() => {
    setListen(sr.listening)
  }, [sr.listening, setListen])

  useEffect(() => {
    sr.onchange = (msg: string, command?: string) => {
      switch (command) {
        case '退出':
          sr.stop()
          break;
        case '发送':
          sendMessage(input)
          break;
        case '清空':
          setInput('')
          break;
        default:
          setInput(input + msg)
      }
    }
  }, [input, setInput, sendMessage])

  const switchSR = (enable: boolean = false) => {
    setListen(enable)
    if (enable) {
      sr.start()
    } else {
      sr.stop()
    }
  }

  return (
    <div className={cn('voice-container -mt-2 -mr-2', className)}>
      {
        sr.listening ? (
          <VoiceButton className="voice-button-theme" onClick={() => switchSR(false)} />
        ) : (
          <VoiceIcon
            className="cursor-pointer"
            width={20}
            height={20}
            fill="var(--cib-color-foreground-neutral-primary)"
            onClick={() => switchSR(true)}
          />
        )
      }
    </div>
  )
};

export default Voice;
