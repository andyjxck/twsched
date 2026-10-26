// Placeholder for the normal (server) build. The GitHub Pages build (vite.pages.config.js)
// swaps this file for demo/backend.js, which runs the server routes in the browser.
const off = () => { throw new Error('Demo backend is only in the GitHub Pages build.') }
export const handle = off
export const start = off
export const resetDemo = off
export const hasSession = () => false
