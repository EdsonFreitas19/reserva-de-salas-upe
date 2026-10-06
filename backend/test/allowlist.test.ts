import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { migrate } from '../src/migrate.js';
import { pool } from '../src/db.js';
import { emailPermitido, emailsAutorizados, listaAtiva, sincronizarListaAutorizados } from '../src/allowlist.js';

const app = buildApp();
const dir = mkdtempSync(join(tmpdir(), 'lista-'));
const arquivo = join(dir, 'emails.txt');
const original = config.authorizedEmailsFile;
const adminOriginal = [...config.adminEmails];
let tick = 1;
const gravar = (txt: string) => { // grava e garante mtime diferente (o cache é por data de modificação)
  writeFileSync(arquivo, txt);
  const t = new Date(Date.now() + 1000 * tick++); utimesSync(arquivo, t, t);
};
const token = (id: number) => `token=${app.jwt.sign({ sub: id })}`;

let adminId: number, adminCookie: string, ambienteId: number;

beforeAll(async () => {
  await migrate();
  await app.ready();
  config.authorizedEmailsFile = arquivo;
  const a = await pool.query(`INSERT INTO usuario (nome, email, google_id) VALUES ('Adm Lista','adm-lista@teste.local','dev-adm-lista') RETURNING id`);
  adminId = a.rows[0].id;
  await pool.query(`INSERT INTO usuario_papel (usuario_id, papel) VALUES ($1,'USUARIO'),($1,'ADMIN')`, [adminId]);
  adminCookie = token(adminId);
  const amb = await pool.query(`INSERT INTO ambiente (nome, tipo) VALUES ('Sala Lista','Sala de aula') RETURNING id`);
  ambienteId = amb.rows[0].id;
});
afterAll(async () => {
  config.authorizedEmailsFile = original;
  config.adminEmails.splice(0, config.adminEmails.length, ...adminOriginal);
  rmSync(dir, { recursive: true, force: true });
  await pool.query(`DELETE FROM ambiente_autoridade WHERE ambiente_id = $1`, [ambienteId]);
  await pool.query(`DELETE FROM ambiente WHERE id = $1`, [ambienteId]);
  await pool.query(`DELETE FROM usuario_papel WHERE usuario_id IN (SELECT id FROM usuario WHERE email LIKE '%@lista.test' OR email = 'adm-lista@teste.local')`);
  await pool.query(`DELETE FROM usuario WHERE email LIKE '%@lista.test' OR email = 'adm-lista@teste.local'`);
});

describe('lista de e-mails autorizados', () => {
  it('lê e-mails de linhas, ignora comentários e aceita CSV/maiúsculas', () => {
    gravar(['# comentário com fake@x.com', '', 'Prof.Um@lista.test', 'dois@lista.test, tres@lista.test;quatro@lista.test', 'cinco@lista.test # depois do #', '#seis@lista.test'].join('\r\n'));
    expect([...emailsAutorizados()].sort()).toEqual(['cinco@lista.test', 'dois@lista.test', 'prof.um@lista.test', 'quatro@lista.test', 'tres@lista.test']);
  });

  it('entra: e-mail do domínio permitido, ou exceção do arquivo, ou admin; o resto não', () => {
    gravar('w@gmail.test\n');
    expect(emailPermitido('W@gmail.test')).toBe(true);        // exceção do arquivo
    expect(emailPermitido('qualquer@upe.br')).toBe(true);     // domínio permitido
    expect(emailPermitido('outro@gmail.test')).toBe(false);   // nem domínio nem exceção
    gravar('# vazio\n');
    expect(emailPermitido('w@gmail.test')).toBe(false);
    expect(emailPermitido('qualquer@upe.br')).toBe(true);
    expect(emailPermitido('fake@upe.br.mau.com')).toBe(false);
  });

  it('ADMIN_EMAILS sempre pode entrar', () => {
    gravar('so@lista.test\n');
    config.adminEmails.push('chefe@fora.test');
    expect(emailPermitido('chefe@fora.test')).toBe(true);
  });

  it('o arquivo é relido ao mudar, sem reiniciar', () => {
    gravar('a@lista.test\n'); expect(emailPermitido('b@lista.test')).toBe(false);
    gravar('a@lista.test\nb@lista.test\n'); expect(emailPermitido('b@lista.test')).toBe(true);
  });

  it('sincroniza os listados como usuários pré-cadastrados (com papel USUARIO), sem duplicar', async () => {
    gravar('novo1@lista.test\nnovo2@lista.test\n');
    expect(await sincronizarListaAutorizados()).toBe(2);
    expect(await sincronizarListaAutorizados()).toBe(0);
    const r = await pool.query(`SELECT u.google_id, array_agg(p.papel::text) AS papeis FROM usuario u JOIN usuario_papel p ON p.usuario_id = u.id WHERE u.email = 'novo1@lista.test' GROUP BY u.id`);
    expect(r.rows[0].google_id).toBe('pre-novo1@lista.test');
    expect(r.rows[0].papeis).toEqual(['USUARIO']);
  });

  it('GET /api/usuarios (admin) já traz os e-mails novos do arquivo', async () => {
    gravar('novo3@lista.test\n');
    const res = await app.inject({ method: 'GET', url: '/api/usuarios', headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().some((u: { email: string }) => u.email === 'novo3@lista.test')).toBe(true);
  });

  it('admin só indica como responsável quem pode entrar no sistema', async () => {
    gravar('resp@lista.test\n');
    const fora = await app.inject({ method: 'POST', url: `/api/ambientes/${ambienteId}/autoridades`, headers: { cookie: adminCookie }, payload: { email: 'fora@lista.test' } });
    expect(fora.statusCode).toBe(400);
    expect(fora.json().erro).toMatch(/institucional/i);
    const dentro = await app.inject({ method: 'POST', url: `/api/ambientes/${ambienteId}/autoridades`, headers: { cookie: adminCookie }, payload: { email: 'resp@lista.test' } });
    expect(dentro.statusCode).toBe(201);
  });

  it('exceção retirada do arquivo perde o acesso na hora (sessão já aberta)', async () => {
    gravar('prof@lista.test\n');
    const u = await pool.query(`INSERT INTO usuario (nome, email, google_id) VALUES ('Prof','prof@lista.test','google-123') RETURNING id`);
    await pool.query(`INSERT INTO usuario_papel (usuario_id, papel) VALUES ($1,'USUARIO')`, [u.rows[0].id]);
    const cookie = token(u.rows[0].id);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode).toBe(200);
    gravar('outro@lista.test\n');
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(res.statusCode).toBe(401);
    expect(res.json().erro).toMatch(/não está mais autorizado/);
  });
});
