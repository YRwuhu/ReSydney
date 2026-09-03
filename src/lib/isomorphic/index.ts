'use client'

/** 桌面版不需要 ifw（网络全部由 Rust 后端完成），仅保留 debug 打印。 */
export const debug: (...args: any[]) => void =
  typeof process !== 'undefined' && (process.env.NEXT_PUBLIC_DEBUG || process.env.DEBUG)
    ? (...args: any[]) => console.info(...args)
    : () => {}
