import pg from 'pg'
import { config } from './config.js'

// Dates come back as 'YYYY-MM-DD' strings and numbers as numbers, so nothing shifts with server time zones.
pg.types.setTypeParser(1082, (v) => v)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)))
pg.types.setTypeParser(20, (v) => Number(v))

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 })

export async function q(text, params = []) {
  const r = await pool.query(text, params)
  return r.rows
}
export async function one(text, params = []) {
  const r = await pool.query(text, params)
  return r.rows[0] || null
}

// Runs fn inside a transaction; fn gets a client with the same q/one helpers.
export async function tx(fn) {
  const client = await pool.connect()
  const c = {
    q: async (t, p = []) => (await client.query(t, p)).rows,
    one: async (t, p = []) => (await client.query(t, p)).rows[0] || null,
  }
  try {
    await client.query('BEGIN')
    const out = await fn(c)
    await client.query('COMMIT')
    return out
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
