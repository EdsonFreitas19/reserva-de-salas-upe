import pg from 'pg';
import { config } from './config.js';

// BIGINT (int8) volta como número em vez de string
pg.types.setTypeParser(20, (v) => Number(v));

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Código do PostgreSQL para violação de EXCLUSION CONSTRAINT */
export const isExclusionViolation = (e: unknown) => (e as { code?: string })?.code === '23P01';
