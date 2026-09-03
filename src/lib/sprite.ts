import microsoftLogo from '@/assets/images/microsoft.png'

/**
 * microsoft.png（926×92）是原 1820×184 雪碧图的 0.5 倍缩放版，
 * 坐标直接用 /2 后的值（background-size 为原生 926×92）：
 *   bing                x0    y0，45×65
 *   microsoft           x48   y0，36×36
 *   microsoft-bing-text x93.5 y0，190×38
 *   copilot             x878  y0，32×32
 */
const NATIVE_W = 926
const NATIVE_H = 92

type SpriteIcon = { x: number; y: number; w: number; h: number }

const ICONS = {
  bing: { x: 0, y: 0, w: 45, h: 65 },
  microsoft: { x: 48, y: 0, w: 36, h: 36 },
} satisfies Record<string, SpriteIcon>

function spriteStyle(icon: SpriteIcon, displayHeight: number) {
  const s = displayHeight / icon.h
  return {
    backgroundImage: `url(${microsoftLogo})`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: `${NATIVE_W * s}px ${NATIVE_H * s}px`,
    backgroundPosition: `${-icon.x * s}px ${-icon.y * s}px`,
    width: Math.round(icon.w * s),
    height: Math.round(displayHeight),
  }
}

/** 必应图标（x0 y0，45×65） */
export function bingSpriteStyle(displayHeight = 32) {
  return spriteStyle(ICONS.bing, displayHeight)
}

/** Microsoft 图标（x48 y0，36×36） */
export function microsoftSpriteStyle(displayHeight = 28) {
  return spriteStyle(ICONS.microsoft, displayHeight)
}
