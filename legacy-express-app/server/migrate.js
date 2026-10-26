import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { pool } from './db.js'

export async function migrate() {
  const dir = path.join(config.root, 'server', 'migrations')
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
  const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name))
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue
    const sql = fs.readFileSync(path.join(dir, f), 'utf8')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f])
      await client.query('COMMIT')
      console.log('applied', f)
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1) })
}
