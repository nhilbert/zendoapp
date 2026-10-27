import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** Writes dist/sw.js from src/sw.js with the list of built files and a version derived from their contents. */
function serviceWorker(): Plugin {
  let outDir = 'dist'
  return {
    name: 'zendo-service-worker',
    apply: 'build',
    configResolved: (config) => void (outDir = path.resolve(config.root, config.build.outDir)),
    closeBundle() {
      const files = (readdirSync(outDir, { recursive: true, withFileTypes: true }) as import('node:fs').Dirent[])
        .filter((d) => d.isFile())
        .map((d) => path.relative(outDir, path.join(d.parentPath, d.name)).split(path.sep).join('/'))
        .filter((f) => f !== 'sw.js' && !f.endsWith('.map'))
        .sort()
      const hash = createHash('sha256')
      for (const f of files) hash.update(f).update(readFileSync(path.join(outDir, f)))
      const template = readFileSync(fileURLToPath(new URL('./src/sw.js', import.meta.url)), 'utf8')
      const sw = template.replace("'__VERSION__'", JSON.stringify(hash.digest('hex').slice(0, 12))).replace('__FILES__', JSON.stringify(files.map((f) => `/${f}`)))
      writeFileSync(path.join(outDir, 'sw.js'), sw)
    },
  }
}

// Zendo runs on localhost only. The dev server is bound to 127.0.0.1 so the app
// (and the personal data in it) is never exposed on the local network by accident.
export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker()],
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
