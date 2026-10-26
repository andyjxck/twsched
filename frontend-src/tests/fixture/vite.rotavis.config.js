// Temporary harness for the 'everyone on the rota' check: the normal fixture, with one person
// (Sample Person Three) carrying the old onRota:false flag, to prove the rota no longer hides them.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const f = (p) => fileURLToPath(new URL(`./fake/${p}`, import.meta.url));
const oldFlag = {
  name: 'old-onrota-flag',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('/fake/data.js')) return null;
    return code.replace("'u-s3': { name: 'Sample Person Three', email: 's3@fixture.test', role: 'staff', jobTitle: 'Floor', onRota: true",
      "'u-s3': { name: 'Sample Person Three', email: 's3@fixture.test', role: 'staff', jobTitle: 'Floor', onRota: false");
  },
};
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  base: '/twsched/',
  plugins: [oldFlag, react()],
  resolve: {
    alias: [
      { find: /^firebase\/app$/, replacement: f('app.js') },
      { find: /^firebase\/auth$/, replacement: f('auth.js') },
      { find: /^firebase\/firestore$/, replacement: f('firestore.js') },
      { find: /^firebase\/storage$/, replacement: f('storage.js') },
      { find: /^firebase\/functions$/, replacement: f('functions.js') },
    ],
  },
  server: { port: 5741, strictPort: true, host: '127.0.0.1' },
});
