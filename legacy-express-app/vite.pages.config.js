// Build for GitHub Pages: `npm run build:pages` -> dist-pages/
// No server there, so the real server routes in /server run inside the browser with demo data:
// PGlite (Postgres in WebAssembly) stands in for the database, and small shims in /demo stand in
// for Express, multer, node:crypto and the file store. Nothing real is ever bundled.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const demo = (f) => path.join(root, 'demo', f)
const SWAP = {
  [path.join(root, 'server', 'config.js')]: demo('config.js'),
  [path.join(root, 'server', 'security.js')]: demo('security.js'),
  [path.join(root, 'server', 'db.js')]: demo('db.js'),
  [path.join(root, 'server', 'migrate.js')]: demo('migrate.js'),
  [path.join(root, 'src', 'demoBackend.js')]: demo('backend.js'),
}

function swapServerModules() {
  return {
    name: 'swan-demo-swap',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.')) return null
      const abs = path.resolve(path.dirname(importer.split('?')[0]), source)
      return SWAP[abs] || null
    },
  }
}

export default defineConfig({
  base: process.env.PAGES_BASE || '/twsched/',
  plugins: [swapServerModules(), react()],
  resolve: {
    alias: [
      { find: /^express$/, replacement: demo('express.js') },
      { find: /^multer$/, replacement: demo('multer.js') },
      { find: /^(node:)?crypto$/, replacement: demo('node-crypto.js') },
    ],
  },
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  build: { outDir: 'dist-pages', sourcemap: false, target: 'es2022', chunkSizeWarningLimit: 4000 },
})
