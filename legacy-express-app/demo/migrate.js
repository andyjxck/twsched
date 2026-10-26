// Demo only: replaces server/migrate.js, applying the same SQL files from server/migrations.
import { getPg } from './db.js'

const files = import.meta.glob('../server/migrations/*.sql', { query: '?raw', import: 'default', eager: true })

export async function migrate() {
  const pg = getPg()
  await pg.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
  const done = new Set((await pg.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name))
  for (const path of Object.keys(files).sort()) {
    const name = path.split('/').pop()
    if (done.has(name)) continue
    await pg.exec('BEGIN')
    try {
      await pg.exec(files[path])
      await pg.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name])
      await pg.exec('COMMIT')
    } catch (e) {
      await pg.exec('ROLLBACK')
      throw e
    }
  }
}
