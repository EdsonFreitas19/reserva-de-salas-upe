import pg from 'pg';

// Cria (se preciso) e zera o banco de testes, isolado do banco de desenvolvimento.
export default async function setup() {
  const base = process.env.DATABASE_URL ?? 'postgres://reserva:reserva@localhost:5432/reserva_upe';
  const admin = new pg.Client({ connectionString: base.replace(/\/[^/]+$/, '/postgres') });
  await admin.connect();
  const ex = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'reserva_upe_test'");
  if (!ex.rowCount) await admin.query('CREATE DATABASE reserva_upe_test');
  await admin.end();

  const db = new pg.Client({ connectionString: base.replace(/\/[^/]+$/, '/reserva_upe_test') });
  await db.connect();
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await db.end();
}
