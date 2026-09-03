import { bingSpriteStyle } from '@/lib/sprite'

export function ChatHeader() {
  return (
    <div className="b_wlcmHdr">
      <div className="b_wlcmLogoCont">
        <span className="b_wlcmLogo" style={bingSpriteStyle(48)} aria-hidden="true" />
        <div className="b_wlcmName">欢迎使用新必应</div>
      </div>
      <div className="b_wlcmDesc">AI支持的应答引擎</div>
    </div>
  )
}
