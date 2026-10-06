import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import { config } from './config.js';
import { pool } from './db.js';

/**
 * Quem pode entrar: (1) qualquer e-mail dos domínios de ALLOWED_DOMAINS (padrão: @upe.br), (2) os ADMIN_EMAILS e
 * (3) as EXCEÇÕES do arquivo backend/emails-autorizados.txt (e-mails de fora do domínio, ex.: contas de teste).
 *
 * O arquivo é texto simples: um e-mail por linha; linhas com # são comentários. É relido sozinho quando muda.
 * A tela Administração → Usuários também acrescenta/remove e-mails dele.
 */
const EMAIL = /[^\s,;<>"'()[\]]+@[^\s,;<>"'()[\]]+\.[^\s,;<>"'()[\]]+/g;

let cache: { arquivo: string; mtime: number; emails: Set<string> } | null = null;

export function emailsAutorizados(): Set<string> {
  const arquivo = config.authorizedEmailsFile;
  if (!existsSync(arquivo)) return new Set();
  const mtime = statSync(arquivo).mtimeMs;
  if (cache && cache.arquivo === arquivo && cache.mtime === mtime) return cache.emails;
  const texto = readFileSync(arquivo, 'utf8').replace(/^﻿/, '');
  const emails = new Set<string>();
  for (const linha of texto.split(/\r?\n/)) {
    const semComentario = linha.split('#')[0];
    for (const m of semComentario.match(EMAIL) ?? []) emails.add(m.toLowerCase());
  }
  cache = { arquivo, mtime, emails };
  return emails;
}

export const listaAtiva = () => emailsAutorizados().size > 0;

const dominioOk = (email: string) => {
  const dominio = email.split('@')[1] ?? '';
  return config.allowedDomains.some((d) => dominio === d || dominio.endsWith('.' + d));
};

/** Este e-mail pode usar o sistema? */
export function emailPermitido(email: string): boolean {
  const e = email.trim().toLowerCase();
  return config.adminEmails.includes(e) || emailsAutorizados().has(e) || dominioOk(e);
}

export function mensagemNaoAutorizado(): string {
  return `Use sua conta institucional (${config.allowedDomains.map((d) => '@' + d).join(', ')}). Para outro e-mail, fale com o administrador.`;
}

const nomeDoEmail = (email: string) => email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

/**
 * Pré-cadastra no banco todos os e-mails da lista (como usuários que ainda não entraram). Assim eles já aparecem
 * nas sugestões do administrador ao escolher responsáveis; no primeiro login Google a conta é assumida.
 */
export async function sincronizarListaAutorizados(c: Pick<PoolClient, 'query'> = pool): Promise<number> {
  let novos = 0;
  for (const email of emailsAutorizados()) {
    const r = await c.query(
      `INSERT INTO usuario (nome, email, google_id) VALUES ($1,$2,$3) ON CONFLICT (email) DO NOTHING RETURNING id`,
      [nomeDoEmail(email), email, `pre-${email}`],
    );
    if (r.rowCount) {
      novos++;
      await c.query("INSERT INTO usuario_papel (usuario_id, papel) VALUES ($1,'USUARIO') ON CONFLICT DO NOTHING", [r.rows[0].id]);
    }
  }
  return novos;
}

/** Acrescenta um e-mail ao arquivo da lista (usado pela tela de Usuários do administrador). */
export function adicionarEmailNaLista(email: string): void {
  const e = email.trim().toLowerCase();
  if (emailsAutorizados().has(e)) return;
  const arquivo = config.authorizedEmailsFile;
  const pre = existsSync(arquivo) && !readFileSync(arquivo, 'utf8').endsWith('\n') ? '\n' : '';
  appendFileSync(arquivo, `${pre}${e}\n`);
}

/** Tira um e-mail do arquivo (apaga as linhas que o contêm, sem mexer nos comentários). */
export function removerEmailDaLista(email: string): void {
  const e = email.trim().toLowerCase();
  const arquivo = config.authorizedEmailsFile;
  if (!existsSync(arquivo)) return;
  const linhas = readFileSync(arquivo, 'utf8').split(/\r?\n/).filter((l) => {
    const sem = l.split('#')[0];
    return !(sem.match(EMAIL) ?? []).some((m) => m.toLowerCase() === e);
  });
  writeFileSync(arquivo, linhas.join('\n'));
}
