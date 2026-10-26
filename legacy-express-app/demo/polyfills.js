// Demo only: the bits of Node the server code expects, provided in the browser.
import { Buffer } from 'buffer'
if (!globalThis.Buffer) globalThis.Buffer = Buffer
if (!globalThis.process) globalThis.process = { argv: [], env: {} }
