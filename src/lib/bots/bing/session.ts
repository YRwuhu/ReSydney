import { ChunkKeys, extraCurlFromCookie, getCookie, parseCookies } from '@/lib/utils'

/** 桌面版从 cookie 还原 Bing 会话参数（口令头文本 / 是否仅图模式）。 */
export function readBingSession() {
  const cookies = parseCookies(document.cookie, ChunkKeys)
  const bing_header = extraCurlFromCookie({
    BING_HEADER: getCookie('BING_HEADER') || undefined,
    ...cookies,
  })
  const image_only = getCookie('IMAGE_ONLY') !== '0'
  const cookie = getCookie('BING_COOKIE') || ''
  return { bing_header, image_only, cookie }
}
