// Local layout/navigation harness: the real app with Firebase swapped for in-memory fixtures.
// Run: npx vite --config tests/fixture/vite.fixture.config.js   then open /twsched/?as=owner|manager|staff|empty|none
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const f = (p) => fileURLToPath(new URL(`./fake/${p}`, import.meta.url));
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  base: '/twsched/',
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^firebase\/app$/, replacement: f('app.js') },
      { find: /^firebase\/auth$/, replacement: f('auth.js') },
      { find: /^firebase\/firestore$/, replacement: f('firestore.js') },
      { find: /^firebase\/storage$/, replacement: f('storage.js') },
      { find: /^firebase\/functions$/, replacement: f('functions.js') },
    ],
  },
  server: { port: 5199, strictPort: true },
});
