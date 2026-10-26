// Demo only: replaces server/db.js. The same Postgres schema and queries, but the database is
// PGlite (real Postgres compiled to WebAssembly) running in the browser and saved in IndexedDB.
import { PGlite, types } from '@electric-sql/pglite'

let pg = null
export async function openDb(dataDir) {
  pg = await PGlite.create(dataDir, {
    parsers: {
      [types.DATE]: (v) => v,
      [types.NUMERIC]: (v) => (v === null ? null : Number(v)),
      [types.INT8]: (v) => Number(v),
    },
  })
  return pg
}
export const getPg = () => pg
export async function closeDb() { if (pg) { try { await pg.close() } catch { /* ignore */ } pg = null } }

export async function q(text, params = []) { return (await pg.query(text, params)).rows }
export async function one(text, params = []) { return (await pg.query(text, params)).rows[0] || null }

// Requests are run one at a time by the demo backend, so a plain BEGIN/COMMIT on the single
// connection behaves like the server's transactions.
export async function tx(fn) {
  const c = { q, one }
  await pg.exec('BEGIN')
  try {
    const out = await fn(c)
    await pg.exec('COMMIT')
    return out
  } catch (e) {
    try { await pg.exec('ROLLBACK') } catch { /* ignore */ }
    throw e
  }
}

export const pool = { query: async (t, p = []) => pg.query(t, p), end: async () => {} }
