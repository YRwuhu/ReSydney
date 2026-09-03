/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

declare module '*.png' {
  const content: string
  export default content
}

declare module '*.jpg' {
  const content: string
  export default content
}
