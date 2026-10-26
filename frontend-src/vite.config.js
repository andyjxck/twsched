import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served from GitHub Pages at https://andyjxck.github.io/twsched/
export default defineConfig({
  base: '/twsched/',
  plugins: [react()],
  build: { outDir: 'dist', chunkSizeWarningLimit: 1200 },
});
