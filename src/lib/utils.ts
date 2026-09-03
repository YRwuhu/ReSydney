import { clsx, type ClassValue } from 'clsx'
import { customAlphabet } from 'nanoid'
import { twMerge } from 'tailwind-merge'
import dayjs from 'dayjs'

/** 桌面版精简工具：Bing 请求头生成逻辑已移到 Rust 端，浏览器侧只保留 UI 与口令读写所需函数。 */

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: number) {
  const time = dayjs(date)
  if (time > dayjs().startOf('day')) {
    return dayjs(time).format('H:mm')
  } else if (time > dayjs().subtract(1, 'day').startOf('day')) {
    return '昨天'
  } else if (time > dayjs().startOf('year')) {
    return dayjs(time).format('M-DD')
  } else {
    return dayjs(time).format('YYYY-MM-DD')
  }
}

export const nanoid = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  7
) // 7-character random string

export function createChunkDecoder() {
  const decoder = new TextDecoder()
  return function (chunk: Uint8Array | undefined): string {
    if (!chunk) return ''
    return decoder.decode(chunk, { stream: true })
  }
}

export function random(start: number, end: number) {
  return start + Math.floor(Math.random() * (end - start))
}

export function randomString(length: number = 32) {
  const char = 'ABCDEFGHJKMNPQRSTWXYZ1234567890';
  return Array.from({ length }, () => char.charAt(random(0, char.length))).join('')
}

// ---------------------------------------------------------------------------
// BING_HEADER 口令 cookie 读写（仍用于把用户信息传给 Rust 侧构建请求头）
// ---------------------------------------------------------------------------

export function parseHeadersFromCurl(content: string) {
  const re = /-H '([^:]+):\s*([^']+)/mg
  const headers: HeadersInit = {}
  content = content.replaceAll('-H "', '-H \'').replaceAll('" ^', '\'\\').replaceAll('^\\^"', '"') // 将 cmd curl 转成 bash curl
  content.split('curl ')[1]?.replace(re, (_: string, key: string, value: string) => {
    headers[key] = value
    return ''
  })
  return headers
}

export const ChunkKeys = ['BING_HEADER0', 'BING_HEADER1', 'BING_HEADER2']

export function encodeHeadersToCookie(content: string) {
  const base64Content = btoa(content)
  const contentChunks = base64Content.match(/.{1,4000}/g) || []
  return ChunkKeys.map((key, index) => `${key}=${contentChunks[index] ?? ''}`)
}

export function extraCurlFromCookie(cookies: Partial<{ [key: string]: string }> = {}) {
  const base64Content = cookies.BING_HEADER || ChunkKeys.map((key) => cookies[key] || '').join('')
  try {
    return atob(base64Content)
  } catch (e) {
    return ''
  }
}

export function extraHeadersFromCookie(cookies: Partial<{ [key: string]: string }>) {
  return parseHeadersFromCurl(extraCurlFromCookie(cookies))
}

export function parseCookie(cookie: string, cookieName: string) {
  if (!cookie || !cookieName) return ''
  const targetCookie = new RegExp(`(?:[; ]|^)${cookieName}=([^;]*)`).test(cookie) ? RegExp.$1 : cookie
  return targetCookie ? decodeURIComponent(targetCookie).trim() : cookie.indexOf('=') === -1 ? cookie.trim() : ''
}

export function setCookie(key: string, value?: string) {
  const cookie = value === undefined ? key : `${key}=${value || ''}`
  const maxAge = value === '' ? 0 : 86400 * 30
  document.cookie = `${cookie}; Path=/; Max-Age=${maxAge}`
}

export function getCookie(cookieName: string) {
  const re = new RegExp(`(?:[; ]|^)${cookieName}=([^;]*)`)
  return re.test(document.cookie) ? RegExp.$1 : ''
}

export function parseCookies(cookie: string, cookieNames: string[]) {
  const cookies: { [key: string]: string } = {}
  cookieNames.forEach(cookieName => {
    cookies[cookieName] = parseCookie(cookie, cookieName)
  })
  return cookies
}

export function resetCookies() {
  [...ChunkKeys, 'BING_HEADER', '', 'BING_COOKIE', 'BING_UA', '_U', 'BING_IP', 'MUID'].forEach(key => setCookie(key, ''))
}
