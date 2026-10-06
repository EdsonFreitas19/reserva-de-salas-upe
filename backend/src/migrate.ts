import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

export async function migrate() {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (nome TEXT PRIMARY KEY, aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now())');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const done = await pool.query('SELECT 1 FROM schema_migrations WHERE nome = $1', [f]);
    if (done.rowCount) continue;
    const sql = await readFile(join(dir, f), 'utf8');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations (nome) VALUES ($1)', [f]);
      await c.query('COMMIT');
      console.log('Migration aplicada:', f);
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
