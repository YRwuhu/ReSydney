// 桌面版存储适配器：不再依赖 namestorage（那是 Web 版用于跨标签页同步的包），
// 直接使用 localStorage，保持 getItem/setItem/removeItem/subscribe 接口一致。

export default () => {
  return {
    getItem(key: string) {
      const raw = localStorage.getItem(key)
      if (raw === null) return null
      try {
        return JSON.parse(raw)
      } catch {
        return null
      }
    },
    setItem(key: string, value: string) {
      localStorage.setItem(key, JSON.stringify(value))
    },
    removeItem(key: string) {
      localStorage.removeItem(key)
    },
    subscribe(_okey: string, _callback: (value: any) => void) {
      // 桌面单窗口场景无需跨标签页同步
      return () => {}
    },
  }
}
