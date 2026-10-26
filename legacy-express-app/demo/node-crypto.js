// Demo only: the two node:crypto calls the routes use, in the browser.
import { sha256 } from 'js-sha256'
export function createHash() {
  const h = sha256.create()
  const o = { update(d) { h.update(typeof d === 'string' ? d : new Uint8Array(d)); return o }, digest() { return h.hex() } }
  return o
}
export function randomBytes(n) { return Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(n))) }
export default { createHash, randomBytes }
