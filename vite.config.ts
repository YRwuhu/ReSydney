import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import svgr from 'vite-plugin-svgr'
import path from 'path'

// Vite config for the Rust+Tauri desktop frontend.
// `@` -> src/, so existing imports like `@/state` keep working.
export default defineConfig({
  plugins: [react(), svgr()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  // Tauri expects a fixed port and no HMR conflicts in production build.
  build: {
    target: 'es2021',
    outDir: 'dist',
  },
})