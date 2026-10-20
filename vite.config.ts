import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// Zendo runs on localhost only. The dev server is bound to 127.0.0.1 so the app
// (and the personal data in it) is never exposed on the local network by accident.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    open: false,
    // The local calendar service (server/calendar.mjs) answers /api/*; in production the Zendo server will.
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.ZENDO_PORT || 5174}`, changeOrigin: false } },
  },
  preview: { host: '127.0.0.1', port: 4173 },
})
