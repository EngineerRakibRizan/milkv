import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, "src") } },
  server: {
    port: 5173,
    // Same-origin in dev: the SPA talks to /api and Vite forwards to Laravel.
    proxy: { '/api': 'http://127.0.0.1:8000', '/broadcasting': 'http://127.0.0.1:8000' },
  },
  build: {
    rollupOptions: {
      output: {
        // Keep heavy vendors in their own long-cached chunks.
        manualChunks(id) {
          if (id.includes('recharts') || id.includes('d3-')) return 'charts'
          if (id.includes('pusher-js') || id.includes('laravel-echo')) return 'realtime'
        },
      },
    },
  },
  test: { environment: 'node' },
} as import('vite').UserConfig)
